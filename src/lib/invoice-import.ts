import { CfdiType, InvoiceStatus, Prisma, PrismaClient, SatStatus } from '@prisma/client'

type ContextCache = Map<string, Promise<{ userId: string; issuerFiscalEntityId: string }>>

function attrNs(xml: string, tagNs: string, attrName: string): string | null {
  const re = new RegExp(`<${tagNs}[^>]*\\b${attrName}="([^"]+)"`, 'i')
  const m = xml.match(re)
  return m ? m[1] : null
}

function parseCfdiType(v: string | null): CfdiType | null {
  switch ((v || '').toUpperCase()) {
    case 'I':
      return CfdiType.INGRESO
    case 'E':
      return CfdiType.EGRESO
    case 'T':
      return CfdiType.TRASLADO
    case 'N':
      return CfdiType.NOMINA
    case 'P':
      return CfdiType.PAGO
    default:
      return null
  }
}

function parseDecimal(value: string | null | undefined, fallback = '0'): Prisma.Decimal {
  const normalized = (value || '').replace(/,/g, '').trim()
  if (!normalized) return new Prisma.Decimal(fallback)
  const n = Number(normalized)
  return Number.isFinite(n) ? new Prisma.Decimal(n.toFixed(2)) : new Prisma.Decimal(fallback)
}

function parseDate(value: string | null | undefined, fallback?: Date): Date {
  const d = value ? new Date(value) : undefined
  if (d && !Number.isNaN(d.getTime())) return d
  return fallback || new Date()
}

function extractTaxes(xml: string) {
  const globalIvaTransferred = attrNs(xml, '[^:>]*:?Impuestos', 'TotalImpuestosTrasladados')
  const ivaTransferred = parseDecimal(globalIvaTransferred, '0')

  let ivaWithheldTotal = 0
  let isrWithheldTotal = 0
  let iepsWithheldTotal = 0
  const retencionRegex = /<[^:>]*:?Retencion[^>]*Impuesto="([^"]+)"[^>]*Importe="([^"]+)"/gi
  for (const m of xml.matchAll(retencionRegex)) {
    const imp = String(m[1]).toUpperCase()
    const val = Number(m[2]) || 0
    if (imp === '002' || imp === 'IVA') ivaWithheldTotal += val
    else if (imp === '001' || imp === 'ISR') isrWithheldTotal += val
    else if (imp === '003' || imp === 'IEPS') iepsWithheldTotal += val
  }

  return {
    ivaTransferred,
    ivaWithheld: new Prisma.Decimal(ivaWithheldTotal.toFixed(2)),
    isrWithheld: new Prisma.Decimal(isrWithheldTotal.toFixed(2)),
    iepsWithheld: new Prisma.Decimal(iepsWithheldTotal.toFixed(2)),
  }
}

export function parseInvoiceFromXml(xml: string) {
  const comprobanteTag = xml.includes('<cfdi:Comprobante') ? 'cfdi:Comprobante' : 'Comprobante'
  const emisorTag = xml.includes('<cfdi:Emisor') ? 'cfdi:Emisor' : 'Emisor'
  const receptorTag = xml.includes('<cfdi:Receptor') ? 'cfdi:Receptor' : 'Receptor'
  const timbreTag = xml.includes('<tfd:TimbreFiscalDigital') ? 'tfd:TimbreFiscalDigital' : 'TimbreFiscalDigital'

  const uuid = attrNs(xml, timbreTag, 'UUID')
  if (!uuid) throw new Error('UUID no encontrado en XML')

  const tipoComp = attrNs(xml, comprobanteTag, 'TipoDeComprobante')
  const cfdiType = parseCfdiType(tipoComp)
  if (!cfdiType) throw new Error(`TipoDeComprobante invalido para UUID ${uuid}`)

  const issuerRfc = attrNs(xml, emisorTag, 'Rfc') || ''
  const issuerName = attrNs(xml, emisorTag, 'Nombre') || issuerRfc || 'SIN NOMBRE'
  const receiverRfc = attrNs(xml, receptorTag, 'Rfc') || 'XAXX010101000'
  const receiverName = attrNs(xml, receptorTag, 'Nombre') || receiverRfc || 'SIN NOMBRE'

  const issuanceDate = parseDate(attrNs(xml, comprobanteTag, 'Fecha'))
  const certificationDate = parseDate(attrNs(xml, timbreTag, 'FechaTimbrado'), issuanceDate)

  const { ivaTransferred, ivaWithheld, isrWithheld, iepsWithheld } = extractTaxes(xml)

  const conceptos: Prisma.InvoiceConceptCreateWithoutInvoiceInput[] = []
  const conceptoRegex = /<[^:>]*:?Concepto\b([^>]*)>[\s\S]*?<\/[^:>]*:?Concepto>/gi
  for (const match of xml.matchAll(conceptoRegex)) {
    const attrs = match[1]

    const productServiceKey = attrNs(`<Tag ${attrs}>`, 'Tag', 'ClaveProdServ') || '01010101'
    const identificationNumber = attrNs(`<Tag ${attrs}>`, 'Tag', 'NoIdentificacion') || null
    const unitQuantity = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'Cantidad'), '1')
    const unitKey = attrNs(`<Tag ${attrs}>`, 'Tag', 'ClaveUnidad') || 'H87'
    const unitDescription = attrNs(`<Tag ${attrs}>`, 'Tag', 'Unidad') || null
    const description = attrNs(`<Tag ${attrs}>`, 'Tag', 'Descripcion') || 'Sin descripcion'
    const unitValue = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'ValorUnitario'), '0')
    const amount = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'Importe'), '0')
    const discount = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'Descuento'), '0')
    const objectOfTax = attrNs(`<Tag ${attrs}>`, 'Tag', 'ObjetoImp') || '01'

    conceptos.push({
      productServiceKey,
      identificationNumber,
      unitQuantity,
      unitKey,
      unitDescription,
      description,
      unitValue,
      amount,
      discount,
      objectOfTax,
    })
  }

  const relatedCfdis: Prisma.InvoiceRelatedCfdiCreateWithoutInvoiceInput[] = []
  
  // Buscar relaciones de CFDI estándar
  const cfdiRelacionadosRegex = /<[^:>]*:?CfdiRelacionados\b([^>]*)>([\s\S]*?)<\/[^:>]*:?CfdiRelacionados>/gi
  for (const match of xml.matchAll(cfdiRelacionadosRegex)) {
    const tipoRelacion = attrNs(`<Tag ${match[1]}>`, 'Tag', 'TipoRelacion') || '04'
    const cfdiRelacionadoRegex = /<[^:>]*:?CfdiRelacionado\b([^>]*)>/gi
    for (const relMatch of match[2].matchAll(cfdiRelacionadoRegex)) {
      const relatedUuid = attrNs(`<Tag ${relMatch[1]}>`, 'Tag', 'UUID')
      if (relatedUuid) {
        relatedCfdis.push({
          relationType: tipoRelacion,
          relatedUuid: relatedUuid.toUpperCase()
        })
      }
    }
  }

  // Buscar relaciones del complemento de pagos
  const doctoRelacionadoRegex = /<[^:>]*:?DoctoRelacionado\b([^>]*)>/gi
  for (const match of xml.matchAll(doctoRelacionadoRegex)) {
    const idDocumento = attrNs(`<Tag ${match[1]}>`, 'Tag', 'IdDocumento')
    if (idDocumento) {
      // Evitar duplicados si el mismo XML de pago menciona la factura varias veces (por múltiples parcialidades)
      if (!relatedCfdis.find(r => r.relatedUuid === idDocumento.toUpperCase())) {
        relatedCfdis.push({
          relationType: '04', // Tipo de relación estándar para pago (aunque estrictamente el SAT no pide TipoRelacion aquí, usamos 04 u otro valor genérico)
          relatedUuid: idDocumento.toUpperCase()
        })
      }
    }
  }

  return {
    uuid,
    cfdiType,
    series: attrNs(xml, comprobanteTag, 'Serie') || null,
    folio: attrNs(xml, comprobanteTag, 'Folio') || null,
    currency: attrNs(xml, comprobanteTag, 'Moneda') || 'MXN',
    exchangeRate: (() => {
      const raw = attrNs(xml, comprobanteTag, 'TipoCambio')
      const n = raw ? Number(raw) : null
      return n !== null && Number.isFinite(n) ? n : null
    })(),
    issuerRfc,
    issuerName,
    receiverRfc,
    receiverName,
    subtotal: parseDecimal(attrNs(xml, comprobanteTag, 'SubTotal'), '0'),
    discount: parseDecimal(attrNs(xml, comprobanteTag, 'Descuento'), '0'),
    total: parseDecimal(attrNs(xml, comprobanteTag, 'Total'), '0'),
    ivaTransferred,
    ivaWithheld,
    isrWithheld,
    iepsWithheld,
    xmlContent: xml,
    issuanceDate,
    certificationDate,
    certificationPac: attrNs(xml, timbreTag, 'RfcProvCertif') || 'DESCONOCIDO',
    paymentMethod: attrNs(xml, comprobanteTag, 'MetodoPago') || '',
    paymentForm: attrNs(xml, comprobanteTag, 'FormaPago') || '',
    cfdiUsage: attrNs(xml, receptorTag, 'UsoCFDI') || '',
    placeOfExpedition: attrNs(xml, comprobanteTag, 'LugarExpedicion') || '',
    exportKey: attrNs(xml, comprobanteTag, 'Exportacion') || '01',
    paymentConditions: attrNs(xml, comprobanteTag, 'CondicionesDePago') || null,
    objectTaxComprobante: attrNs(xml, comprobanteTag, 'ObjetoImp') || null,
    conceptos,
    relatedCfdis,
  }
}

async function resolveOrganizationUser(prisma: PrismaClient, organizationId: string, preferredUserId?: string | null) {
  if (preferredUserId) return preferredUserId

  const owner = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ownerId: true },
  })
  if (owner?.ownerId) return owner.ownerId

  const member = await prisma.member.findFirst({
    where: { organizationId, status: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  })

  if (!member?.userId) {
    throw new Error(`No se encontro un usuario aprobado para la organizacion ${organizationId}`)
  }

  return member.userId
}

export async function resolveInvoiceImportContext(
  prisma: PrismaClient,
  issuerRfc: string,
  issuerName: string,
  cache?: ContextCache,
) {
  const cacheKey = issuerRfc.trim().toUpperCase()

  const loader = async () => {
    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc: cacheKey },
      include: { organization: { select: { ownerId: true } } },
    })

    if (fiscalEntity) {
      const userId = await resolveOrganizationUser(prisma, fiscalEntity.organizationId, fiscalEntity.organization.ownerId)
      return { userId, issuerFiscalEntityId: fiscalEntity.id }
    }

    const company = await prisma.company.findUnique({
      where: { rfc: cacheKey },
      select: { id: true, businessName: true, taxRegime: true, postalCode: true, createdBy: true },
    })

    if (!company) {
      throw new Error(`No existe Company/FiscalEntity para RFC ${cacheKey}`)
    }

    let organizationId: string | null = null
    let preferredUserId: string | null = null

    const access = await prisma.companyAccess.findFirst({
      where: { companyId: company.id },
      orderBy: { createdAt: 'asc' },
      include: { member: { select: { userId: true } }, organization: { select: { ownerId: true } } },
    })

    if (access) {
      organizationId = access.organizationId
      preferredUserId = access.organization.ownerId || access.member.userId
    }

    if (!organizationId) {
      const member = await prisma.member.findFirst({
        where: { userId: company.createdBy, status: 'APPROVED' },
        orderBy: { createdAt: 'asc' },
        select: { organizationId: true, userId: true },
      })

      if (member) {
        organizationId = member.organizationId
        preferredUserId = member.userId
      }
    }

    if (!organizationId) {
      throw new Error(`No se pudo resolver una organizacion para la empresa con RFC ${cacheKey}`)
    }

    const createdFiscalEntity = await prisma.fiscalEntity.create({
      data: {
        organizationId,
        rfc: cacheKey,
        businessName: company.businessName || issuerName || cacheKey,
        taxRegime: company.taxRegime || '601',
        postalCode: company.postalCode || '00000',
        isActive: true,
      },
    })

    const userId = await resolveOrganizationUser(prisma, organizationId, preferredUserId)
    return { userId, issuerFiscalEntityId: createdFiscalEntity.id }
  }

  if (!cache) return loader()

  let promise = cache.get(cacheKey)
  if (!promise) {
    promise = loader()
    cache.set(cacheKey, promise)
  }
  return promise
}

export async function createInvoiceFromXml(
  prisma: PrismaClient,
  xml: string,
  cache?: ContextCache,
) {
  const parsed = parseInvoiceFromXml(xml)

  const existing = await prisma.invoice.findUnique({
    where: { uuid: parsed.uuid },
    select: { id: true, uuid: true },
  })

  if (existing) {
    return { status: 'skipped' as const, uuid: parsed.uuid, id: existing.id, message: 'Invoice ya existe' }
  }

  const context = await resolveInvoiceImportContext(prisma, parsed.issuerRfc, parsed.issuerName, cache)

  const invoice = await prisma.invoice.create({
    data: {
      userId: context.userId,
      issuerFiscalEntityId: context.issuerFiscalEntityId,
      uuid: parsed.uuid,
      cfdiType: parsed.cfdiType,
      series: parsed.series,
      folio: parsed.folio,
      currency: parsed.currency,
      exchangeRate: parsed.exchangeRate,
      status: InvoiceStatus.ACTIVE,
      satStatus: SatStatus.VIGENTE,
      issuerRfc: parsed.issuerRfc,
      issuerName: parsed.issuerName,
      receiverRfc: parsed.receiverRfc,
      receiverName: parsed.receiverName,
      subtotal: parsed.subtotal,
      discount: parsed.discount,
      total: parsed.total,
      ivaTransferred: parsed.ivaTransferred,
      ivaWithheld: parsed.ivaWithheld,
      isrWithheld: parsed.isrWithheld,
      iepsWithheld: parsed.iepsWithheld,
      xmlContent: parsed.xmlContent,
      pdfUrl: null,
      issuanceDate: parsed.issuanceDate,
      certificationDate: parsed.certificationDate,
      certificationPac: parsed.certificationPac,
      paymentMethod: parsed.paymentMethod,
      paymentForm: parsed.paymentForm,
      cfdiUsage: parsed.cfdiUsage,
      placeOfExpedition: parsed.placeOfExpedition,
      exportKey: parsed.exportKey,
      paymentConditions: parsed.paymentConditions,
      objectTaxComprobante: parsed.objectTaxComprobante,
      concepts: {
        create: parsed.conceptos,
      },
      relatedCfdis: {
        create: parsed.relatedCfdis,
      },
    },
    select: { id: true, uuid: true },
  })

  return { status: 'created' as const, uuid: invoice.uuid, id: invoice.id }
}

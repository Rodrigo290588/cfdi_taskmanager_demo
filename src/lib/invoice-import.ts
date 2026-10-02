import { CfdiType, InvoiceStatus, Prisma, PrismaClient, SatStatus } from '@prisma/client'
import { upsertInvoiceXmlBlob } from '@/lib/invoice-xml-storage'
import { upsertInvoiceComplementProjection } from '@/lib/cfdi-complement-projection-storage'
import { upsertInvoicePaymentComplementDetails } from '@/lib/invoice-payment-complement-storage'
import { parseCfdiDateTime } from '@/lib/cfdi-date'
import { createConceptoRegexSafe, isStrictRfc4122Uuid, csvCellEscape } from '@/lib/xml-sanitize'
import { safeErrSummary, fingerprint } from '@/lib/security'

type ContextCache = Map<string, Promise<{ userId: string; issuerFiscalEntityId: string }>>

function attrNs(xml: string, tagNs: string, attrName: string): string | null {
  // IMP-002 · Longitud máxima de attrName + value por atributo (256 chars) para prevenir ReDoS
  const re = new RegExp(String.raw`<${tagNs}[^>]{0,4096}?\b${attrName}="([^"]{0,1024})"`, 'i')
  const m = xml.match(re)
  return m ? (m[1] || null) : null
}

function parseCfdiType(v: string | null): CfdiType | null {
  switch ((v || '').toUpperCase()) {
    case 'I': return CfdiType.INGRESO
    case 'E': return CfdiType.EGRESO
    case 'T': return CfdiType.TRASLADO
    case 'N': return CfdiType.NOMINA
    case 'P': return CfdiType.PAGO
    default: return null
  }
}

function parseDecimal(value: string | null | undefined, fallback = '0'): Prisma.Decimal {
  const normalized = (value || '').replace(/,/g, '').trim().slice(0, 64)
  if (!normalized) return new Prisma.Decimal(fallback)
  const n = Number(normalized)
  return Number.isFinite(n) ? new Prisma.Decimal(n.toFixed(2)) : new Prisma.Decimal(fallback)
}

export function extractTaxes(xml: string) {
  const globalIvaTransferred = attrNs(xml, String.raw`(?:\w+:)?Impuestos`, 'TotalImpuestosTrasladados')
  const ivaTransferred = parseDecimal(globalIvaTransferred, '0')

  const retenciones = extractRetenciones(xml)
  const traslados = extractTrasladosDetails(xml)

  return {
    ivaTransferred,
    ivaWithheld: new Prisma.Decimal(retenciones.ivaWithheldTotal.toFixed(2)),
    isrWithheld: new Prisma.Decimal(retenciones.isrWithheldTotal.toFixed(2)),
    iepsWithheld: new Prisma.Decimal(retenciones.iepsWithheldTotal.toFixed(2)),
    iva16Base: new Prisma.Decimal(traslados.iva16BaseTotal.toFixed(2)),
    iva16Tax: new Prisma.Decimal(traslados.iva16TaxTotal.toFixed(2)),
    iva8Base: new Prisma.Decimal(traslados.iva8BaseTotal.toFixed(2)),
    iva8Tax: new Prisma.Decimal(traslados.iva8TaxTotal.toFixed(2)),
    iva0Base: new Prisma.Decimal(traslados.iva0BaseTotal.toFixed(2)),
    ivaExemptBase: new Prisma.Decimal(traslados.ivaExemptBaseTotal.toFixed(2)),
  }
}

function extractRetenciones(xml: string) {
  let ivaWithheldTotal = 0
  let isrWithheldTotal = 0
  let iepsWithheldTotal = 0
  // IMP-002 · Iteración limitada (max 128 impuestos) para evitar ReDoS pathológico retenciones sin cerrar
  const retencionRegex = /<(?:\w+:)?Retencion[^>]{0,1024}?Impuesto="([^"]{1,16})"[^>]{0,1024}?Importe="([^"]{1,32})"/gi
  let iterCount = 0
  const MAX_TAX_ITEMS = 512
  for (const m of xml.matchAll(retencionRegex)) {
    if (++iterCount > MAX_TAX_ITEMS) break
    const imp = String(m[1]).toUpperCase()
    const val = Number(m[2]) || 0
    if (imp === '002' || imp === 'IVA') ivaWithheldTotal += val
    else if (imp === '001' || imp === 'ISR') isrWithheldTotal += val
    else if (imp === '003' || imp === 'IEPS') iepsWithheldTotal += val
  }
  return { ivaWithheldTotal, isrWithheldTotal, iepsWithheldTotal }
}

type TrasladosTotals = {
  iva16BaseTotal: number
  iva16TaxTotal: number
  iva8BaseTotal: number
  iva8TaxTotal: number
  iva0BaseTotal: number
  ivaExemptBaseTotal: number
}

function extractTrasladosDetails(xml: string): TrasladosTotals {
  const totals: TrasladosTotals = {
    iva16BaseTotal: 0,
    iva16TaxTotal: 0,
    iva8BaseTotal: 0,
    iva8TaxTotal: 0,
    iva0BaseTotal: 0,
    ivaExemptBaseTotal: 0
  }

  const conceptosMatch = /<(?:\w+:)?Conceptos[^>]*>([\s\S]*?)<\/(?:\w+:)?Conceptos>/i.exec(xml)
  const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
  const trasladoRegex = /<(?:\w+:)?Traslado([^>]+)>/gi
  const attrRegex = /\b(\w+)="([^"]+)"/g
  
  for (const m of parseTarget.matchAll(trasladoRegex)) {
    processTrasladoNode(m[1], totals, attrRegex)
  }

  return totals
}

function processTrasladoNode(attrsStr: string, totals: TrasladosTotals, attrRegex: RegExp) {
  const attrs: Record<string, string> = {}
  for (const attrMatch of attrsStr.matchAll(attrRegex)) {
    attrs[attrMatch[1]] = attrMatch[2]
  }
  
  if (attrs['Impuesto'] === '002' || attrs['Impuesto'] === 'IVA') {
    applyTrasladoIvaTotals(attrs, totals)
  }
}

function applyTrasladoIvaTotals(attrs: Record<string, string>, totals: TrasladosTotals) {
  const base = Number.parseFloat(attrs['Base'] ?? '0')
  const tax = Number.parseFloat(attrs['Importe'] ?? '0')
  const tasa = Number.parseFloat(attrs['TasaOCuota'] ?? '0')
  const tipo = attrs['TipoFactor']
  
  if (tipo === 'Exento') {
    totals.ivaExemptBaseTotal += base
  } else if (tipo === 'Tasa' || attrs['TasaOCuota']) {
    if (Math.abs(tasa - 0.16) < 0.01) {
      totals.iva16BaseTotal += base
      totals.iva16TaxTotal += tax
    } else if (Math.abs(tasa - 0.08) < 0.01) {
      totals.iva8BaseTotal += base
      totals.iva8TaxTotal += tax
    } else if (Math.abs(tasa - 0.0) < 0.001) {
      totals.iva0BaseTotal += base
    }
  }
}

// IMP-021 · Validación mínima estructural SAT CFDI 4.0 (TimbreFiscalDigital obligatorio)
// Validación criptográfica completa vía PAC queda como step posterior en roadmap (verify Sello SAT).
export const RFC_SAT_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/

export interface SatSignatureCheckResult {
  valid: boolean
  reason?: string
  uuid: string | null
  fechaTimbrado: string | null
  rfcProvCertif: string | null
}

export function verifyTimbreFiscalDigitalBaseline(xml: string): SatSignatureCheckResult {
  const hasComprobante = /<(?:\w+:)?Comprobante\b/i.test(xml.slice(0, 65536))
  const hasTimbre = /<(?:\w+:)?TimbreFiscalDigital\b/i.test(xml)
  const tfdUuidRaw: string | null = attrNs(xml, String.raw`(?:\w+:)?TimbreFiscalDigital`, 'UUID')
  const tfdUuid: string | null = tfdUuidRaw
  const tfdFecha = attrNs(xml, String.raw`(?:\w+:)?TimbreFiscalDigital`, 'FechaTimbrado')
  const tfdPac = attrNs(xml, String.raw`(?:\w+:)?TimbreFiscalDigital`, 'RfcProvCertif')
  const tfdSelloSat = attrNs(xml, String.raw`(?:\w+:)?TimbreFiscalDigital`, 'SelloSAT')
  const tfdSelloCfd = attrNs(xml, String.raw`(?:\w+:)?TimbreFiscalDigital`, 'SelloCFD')
  const tfdNoCertificado = attrNs(xml, String.raw`(?:\w+:)?TimbreFiscalDigital`, 'NoCertificadoSAT')
  if (!hasComprobante) return { valid: false, reason: 'Falta nodo Comprobante', uuid: tfdUuid, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
  if (!hasTimbre) return { valid: false, reason: 'Falta nodo TimbreFiscalDigital (CFDI no timbrado)', uuid: tfdUuid, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
  if (!tfdUuid) return { valid: false, reason: 'TimbreFiscalDigital sin UUID', uuid: null, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
  if (!isStrictRfc4122Uuid(tfdUuid)) return { valid: false, reason: `UUID Timbre no cumple RFC 4122: ${String(tfdUuid).slice(0, 32)}`, uuid: tfdUuid, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
  if (!tfdSelloSat || tfdSelloSat.length < 32) return { valid: false, reason: 'Atributo SelloSAT ausente o inválido', uuid: tfdUuid, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
  if (!tfdSelloCfd || tfdSelloCfd.length < 32) return { valid: false, reason: 'Atributo SelloCFD ausente o inválido', uuid: tfdUuid, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
  if (!tfdNoCertificado || !/^\d{20}$/.test(tfdNoCertificado)) return { valid: false, reason: 'NoCertificadoSAT inválido (deben ser 20 dígitos)', uuid: tfdUuid, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
  return { valid: true, uuid: tfdUuid, fechaTimbrado: tfdFecha, rfcProvCertif: tfdPac }
}

export function parseInvoiceFromXml(xml: string) {
  // IMP-021 · Verificación obligatoria TimbreFiscalDigital antes de parsear
  const timbreCheck = verifyTimbreFiscalDigitalBaseline(xml)
  if (!timbreCheck.valid || !timbreCheck.uuid) {
    throw new Error(`Validación SAT fallida: ${timbreCheck.reason || 'TimbreFiscalDigital inválido'}`)
  }
  const comprobanteTag = xml.includes('<cfdi:Comprobante') ? 'cfdi:Comprobante' : 'Comprobante'
  const emisorTag = xml.includes('<cfdi:Emisor') ? 'cfdi:Emisor' : 'Emisor'
  const receptorTag = xml.includes('<cfdi:Receptor') ? 'cfdi:Receptor' : 'Receptor'
  const timbreTag = xml.includes('<tfd:TimbreFiscalDigital') ? 'tfd:TimbreFiscalDigital' : 'TimbreFiscalDigital'

  const uuid = timbreCheck.uuid.toUpperCase()
  const tipoComp = attrNs(xml, comprobanteTag, 'TipoDeComprobante')
  const cfdiType = parseCfdiType(tipoComp)
  if (!cfdiType) throw new Error(`TipoDeComprobante invalido para UUID ${uuid.slice(0, 8)}`)

  const issuerRfcRaw = (attrNs(xml, emisorTag, 'Rfc') || '').toUpperCase().trim()
  if (!RFC_SAT_REGEX.test(issuerRfcRaw)) {
    throw new Error(`RFC Emisor inválido para UUID ${uuid.slice(0, 8)}`)
  }
  const issuerRfc = issuerRfcRaw
  const issuerName = attrNs(xml, emisorTag, 'Nombre') || issuerRfc || 'SIN NOMBRE'
  const receiverRfcRaw = (attrNs(xml, receptorTag, 'Rfc') || 'XAXX010101000').toUpperCase().trim()
  if (!RFC_SAT_REGEX.test(receiverRfcRaw) && receiverRfcRaw !== 'XAXX010101000') {
    throw new Error(`RFC Receptor inválido para UUID ${uuid.slice(0, 8)}`)
  }
  const receiverRfc = receiverRfcRaw
  const receiverName = attrNs(xml, receptorTag, 'Nombre') || receiverRfc || 'SIN NOMBRE'

  const issuanceDate = parseCfdiDateTime(attrNs(xml, comprobanteTag, 'Fecha'))
  const certificationDate = parseCfdiDateTime(timbreCheck.fechaTimbrado || attrNs(xml, timbreTag, 'FechaTimbrado'), issuanceDate)

  const { ivaTransferred, ivaWithheld, isrWithheld, iepsWithheld } = extractTaxes(xml)

  const conceptos = extractConceptos(xml)
  const relatedCfdis = extractRelatedCfdis(xml)
  const total = extractTotalValue(xml, cfdiType, comprobanteTag)

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
    total,
    ivaTransferred,
    ivaWithheld,
    isrWithheld,
    iepsWithheld,
    xmlContent: xml,
    issuanceDate,
    certificationDate,
    certificationPac: timbreCheck.rfcProvCertif || attrNs(xml, timbreTag, 'RfcProvCertif') || 'DESCONOCIDO',
    paymentMethod: attrNs(xml, comprobanteTag, 'MetodoPago') || '',
    paymentForm: attrNs(xml, comprobanteTag, 'FormaPago') || '',
    cfdiUsage: attrNs(xml, receptorTag, 'UsoCFDI') || '',
    placeOfExpedition: attrNs(xml, comprobanteTag, 'LugarExpedicion') || '',
    exportKey: attrNs(xml, comprobanteTag, 'Exportacion') || '01',
    paymentConditions: attrNs(xml, comprobanteTag, 'CondicionesDePago') || null,
    objectTaxComprobante: attrNs(xml, comprobanteTag, 'ObjetoImp') || null,
    conceptos,
    relatedCfdis,
    _satBaselineValid: timbreCheck.valid
  }
}

function extractConceptos(xml: string) {
  const conceptos: Prisma.InvoiceConceptCreateWithoutInvoiceInput[] = []
  // IMP-002 · Usar parser Concepto safe (no regex backtracking)
  const conceptoSafe = createConceptoRegexSafe()
  const conceptosMatches = conceptoSafe.matchAll(xml)
  for (const match of conceptosMatches) {
    const attrs = match.attrs
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
  return conceptos
}

function extractRelatedCfdis(xml: string) {
  const relatedCfdis: Prisma.InvoiceRelatedCfdiCreateWithoutInvoiceInput[] = []
  processCfdiRelacionados(xml, relatedCfdis)
  processDoctoRelacionado(xml, relatedCfdis)
  return relatedCfdis
}

function processCfdiRelacionados(xml: string, relatedCfdis: Prisma.InvoiceRelatedCfdiCreateWithoutInvoiceInput[]) {
  // IMP-022 · RelatedUuid: validar strict RFC 4122 y escapar celdas CSV en storage si fuera necesario
  const cfdiRelacionadosRegex = /<(?:\w+:)?CfdiRelacionados\b([^>]{0,512})>([\s\S]{0,65536}?)<\/(?:\w+:)?CfdiRelacionados>/gi
  let crCount = 0
  for (const match of xml.matchAll(cfdiRelacionadosRegex)) {
    if (++crCount > 64) break
    const tipoRelacion = attrNs(`<Tag ${match[1]}>`, 'Tag', 'TipoRelacion') || '04'
    processInnerCfdiRelacionado(match[2], tipoRelacion, relatedCfdis)
  }
}

function processInnerCfdiRelacionado(innerXml: string, tipoRelacion: string, relatedCfdis: Prisma.InvoiceRelatedCfdiCreateWithoutInvoiceInput[]) {
  const cfdiRelacionadoRegex = /<(?:\w+:)?CfdiRelacionado\b([^>]{0,512})>/gi
  let inner = 0
  for (const relMatch of innerXml.matchAll(cfdiRelacionadoRegex)) {
    if (++inner > 64) break
    const relatedUuid = attrNs(`<Tag ${relMatch[1]}>`, 'Tag', 'UUID')
    if (relatedUuid && isStrictRfc4122Uuid(relatedUuid)) {
      const up = relatedUuid.toUpperCase()
      if (!relatedCfdis.some(r => r.relatedUuid === up)) {
        relatedCfdis.push({ relationType: tipoRelacion, relatedUuid: csvCellEscape(up) })
      }
    }
  }
}

function processDoctoRelacionado(xml: string, relatedCfdis: Prisma.InvoiceRelatedCfdiCreateWithoutInvoiceInput[]) {
  const doctoRelacionadoRegex = /<(?:\w+:)?DoctoRelacionado\b([^>]{0,512})>/gi
  let drCount = 0
  for (const match of xml.matchAll(doctoRelacionadoRegex)) {
    if (++drCount > 128) break
    const idDocumento = attrNs(`<Tag ${match[1]}>`, 'Tag', 'IdDocumento')
    if (idDocumento && isStrictRfc4122Uuid(idDocumento)) {
      const up = idDocumento.toUpperCase()
      if (!relatedCfdis.some(r => r.relatedUuid === up)) {
        relatedCfdis.push({
          relationType: '04',
          relatedUuid: csvCellEscape(up)
        })
      }
    }
  }
}

function extractTotalValue(xml: string, cfdiType: CfdiType, comprobanteTag: string) {
  let totalValue = parseDecimal(attrNs(xml, comprobanteTag, 'Total'), '0')

  if (cfdiType === CfdiType.PAGO) {
    const totalesMatch = /<(?:\w+:)?Totales\b[^>]{0,1024}?MontoTotalPagos="([^"]{1,32})"/i.exec(xml)
    if (totalesMatch && totalesMatch[1]) {
      totalValue = parseDecimal(totalesMatch[1], '0')
    } else {
      let sumPagos = 0
      const pagoRegex = /<(?:\w+:)?Pago\b[^>]{0,1024}?Monto="([^"]{1,32})"/gi
      let p = 0
      for (const m of xml.matchAll(pagoRegex)) {
        if (++p > 512) break
        sumPagos += Number(String(m[1]).replace(/,/g, '')) || 0
      }
      if (sumPagos > 0) {
        totalValue = new Prisma.Decimal(sumPagos.toFixed(2))
      }
    }
  }
  return totalValue
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
    throw new Error(`No se encontro un usuario aprobado para la organizacion ${fingerprint(organizationId).slice(0, 16)}`)
  }

  return member.userId
}

async function tryResolveFromFiscalEntity(prisma: PrismaClient, cacheKey: string, targetOrganizationId: string) {
  const fiscalEntity = await prisma.fiscalEntity.findFirst({
    where: {
      rfc: cacheKey,
      organizationId: targetOrganizationId
    },
    include: { organization: { select: { ownerId: true, id: true } } },
  })

  if (fiscalEntity) {
    if (fiscalEntity.organizationId !== targetOrganizationId) {
      throw new Error(`BOLA detectado: FiscalEntity RFC ${cacheKey.slice(0, 6)} pertenece a otra organización`)
    }
    const userId = await resolveOrganizationUser(prisma, fiscalEntity.organizationId, fiscalEntity.organization.ownerId)
    return { userId, issuerFiscalEntityId: fiscalEntity.id }
  }
  return null
}

async function resolveFromCompanyAccess(prisma: PrismaClient, company: { createdBy: string; companyAccesses: { organizationId: string; organization: { id: string; ownerId: string | null }; member: { userId: string } }[] }, cacheKey: string, targetOrganizationId: string) {
  let organizationId: string | null = null
  let preferredUserId: string | null = null

  if (company.companyAccesses.length > 0) {
    const access = company.companyAccesses[0]
    if (access.organization.id !== targetOrganizationId) {
      throw new Error(`BOLA detectado: CompanyAccess RFC ${cacheKey.slice(0, 6)} pertenece a org distinta a la solicitada`)
    }
    organizationId = access.organizationId
    preferredUserId = access.organization.ownerId || access.member.userId
  }

  if (!organizationId) {
    const member = await prisma.member.findFirst({
      where: {
        userId: company.createdBy,
        status: 'APPROVED',
        organizationId: targetOrganizationId
      },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true, userId: true },
    })

    if (member) {
      if (member.organizationId !== targetOrganizationId) {
        throw new Error(`BOLA detectado: member RFC ${cacheKey.slice(0, 6)} pertenece a org distinta`)
      }
      organizationId = member.organizationId
      preferredUserId = member.userId
    }
  }

  return { organizationId, preferredUserId }
}

export async function resolveInvoiceImportContext(
  prisma: PrismaClient,
  issuerRfc: string,
  issuerName: string,
  cache?: ContextCache,
  targetOrganizationId?: string,
) {
  const cacheKey = issuerRfc.trim().toUpperCase()
  if (!targetOrganizationId) {
    // IMP-007 · targetOrganizationId debe venir siempre del caller context para multitenant safe
    throw new Error(`Falta targetOrganizationId al resolver contexto de importación para RFC ${cacheKey.slice(0, 6)}`)
  }

  const loader = async () => {
    // IMP-007 · Paso 1: FiscalEntity SCOPEADO a targetOrganizationId
    const entityResult = await tryResolveFromFiscalEntity(prisma, cacheKey, targetOrganizationId)
    if (entityResult) return entityResult

    // IMP-018 · Buscar Company + Access en 1 query usando include, no N queries secuenciales
    const company = await prisma.company.findUnique({
      where: { rfc: cacheKey },
      select: {
        id: true, businessName: true, taxRegime: true, postalCode: true, createdBy: true,
        companyAccesses: {
          where: targetOrganizationId ? { organizationId: targetOrganizationId } : {},
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: { member: { select: { userId: true, organizationId: true } }, organization: { select: { ownerId: true, id: true } } }
        }
      }
    })

    if (!company) {
      throw new Error(`No existe Company/FiscalEntity para RFC ${cacheKey.slice(0, 6)}`)
    }

    const { organizationId, preferredUserId } = await resolveFromCompanyAccess(prisma, company, cacheKey, targetOrganizationId)

    if (!organizationId) {
      throw new Error(`No se pudo resolver una organizacion SCOPEADA para la empresa RFC ${cacheKey.slice(0, 6)}`)
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

    // IMP-007 · ASSERTION FINAL: fiscalEntity creada.organizationId === targetOrganizationId
    if (createdFiscalEntity.organizationId !== targetOrganizationId) {
      throw new Error(`FATAL BOLA cross-org: FiscalEntity creada en org incorrecta para RFC ${cacheKey.slice(0, 6)}`)
    }

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
  targetOrganizationId?: string,
  opts?: {
    importingMemberId?: string
    importingUserId?: string
    importingOrganizationId?: string
  }
) {
  // IMP-007 · targetOrganizationId alias retrocompatibilidad
  const resolvedOrgId = opts?.importingOrganizationId || targetOrganizationId
  if (!resolvedOrgId) {
    throw new Error('createInvoiceFromXml requiere importingOrganizationId/targetOrganizationId')
  }
  const parsed = parseInvoiceFromXml(xml)

  const existing = await prisma.invoice.findUnique({
    where: { uuid: parsed.uuid },
    include: { fiscalEntity: { select: { organizationId: true } } },
  })

  if (existing) {
    // IMP-007 · Invoice existente: validar que pertenezca a la misma org del caller
    if (existing.fiscalEntity && existing.fiscalEntity.organizationId !== resolvedOrgId) {
      return {
        status: 'error' as const,
        uuid: parsed.uuid,
        message: 'El UUID pertenece a otra organización (cross-tenant bloqueado)'
      }
    }
    // IMP-014 · NO devolver Prisma number id
    return { status: 'skipped' as const, uuid: parsed.uuid, message: 'Invoice ya existe' }
  }

  const context = await resolveInvoiceImportContext(prisma, parsed.issuerRfc, parsed.issuerName, cache, resolvedOrgId)

  const invoice = await prisma.$transaction(async tx => {
    const createdInvoice = await tx.invoice.create({
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

    await upsertInvoiceXmlBlob(tx, {
      invoiceId: createdInvoice.id,
      xmlContent: parsed.xmlContent
    }).catch(e => {
      console.error('[createInvoiceFromXml] upsertInvoiceXmlBlob failed:', safeErrSummary(e))
      throw e
    })

    await upsertInvoiceComplementProjection(tx, {
      invoiceId: createdInvoice.id,
      xmlContent: parsed.xmlContent
    }).catch(e => {
      console.error('[createInvoiceFromXml] upsertInvoiceComplementProjection failed:', safeErrSummary(e))
      throw e
    })

    await upsertInvoicePaymentComplementDetails(tx, {
      issuerFiscalEntityId: context.issuerFiscalEntityId,
      paymentInvoiceId: createdInvoice.id,
      paymentInvoiceUuid: parsed.uuid,
      xmlContent: parsed.xmlContent,
      satStatusSnapshot: SatStatus.VIGENTE,
      fallbackPaymentDate: parsed.issuanceDate,
      fallbackCurrency: parsed.currency,
      fallbackSeries: parsed.series,
      fallbackFolio: parsed.folio
    }).catch(e => {
      console.error('[createInvoiceFromXml] upsertInvoicePaymentComplementDetails failed:', safeErrSummary(e))
      throw e
    })

    return createdInvoice
  })

  // IMP-014 · NO devolver Prisma id number; solo UUID y status
  return { status: 'created' as const, uuid: invoice.uuid, message: 'Invoice importada exitosamente' }
}

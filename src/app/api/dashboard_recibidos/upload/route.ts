import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
import JSZip from 'jszip'
import { upsertInvoiceXmlBlob } from '@/lib/invoice-xml-storage'
import { upsertInvoiceComplementProjection } from '@/lib/cfdi-complement-projection-storage'
import { upsertInvoicePaymentComplementDetails } from '@/lib/invoice-payment-complement-storage'
import { parseCfdiDateTime } from '@/lib/cfdi-date'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { DashboardRecibidosUploadFormSchema as UploadDashboardRecibidosFormSchema } from '@/schemas/dashboard-recibidos'
import { createAuditEntry } from '@/lib/audit'
import { getRealClientIp } from '@/lib/security'
import crypto from 'node:crypto'

function attrNs(xml: string, tagNs: string, attrName: string): string | null {
  const re = new RegExp(String.raw`<${tagNs}[^>]*\b${attrName}="([^"]+)"`, 'i')
  const m = re.exec(xml)
  return m ? (m[1] ?? null) : null
}

function parseCfdiType(v: string | null): CfdiType | null {
  switch (v) {
    case 'I': return CfdiType.INGRESO
    case 'E': return CfdiType.EGRESO
    case 'T': return CfdiType.TRASLADO
    case 'N': return CfdiType.NOMINA
    case 'P': return CfdiType.PAGO
    default: return null
  }
}

// DashboardRecibidosUploadFormSchema es estricto. Acepta solo companyId / orgId.
// Para compatibilidad con rawForm que incluye hasFiles, extendemos el schema localmente
// sin necesidad de modificar el original compartido.

function extractTaxesFromXml(xml: string) {
  const result = {
    ivaTransferredTotal: 0,
    ivaWithheldTotal: 0,
    isrWithheldTotal: 0,
    iepsWithheldTotal: 0,
    iva16BaseTotal: 0,
    iva16TaxTotal: 0,
    iva8BaseTotal: 0,
    iva8TaxTotal: 0,
    iva0BaseTotal: 0,
    ivaExemptBaseTotal: 0
  }
  
  const retencionRegex = /<(?:\w+:)?Retencion[^>]*Impuesto="([^"]+)"[^>]*Importe="([^"]+)"/gi
  for (const m of xml.matchAll(retencionRegex)) {
    const imp = String(m[1]).toUpperCase()
    const val = Number(m[2]) || 0
    if (imp === '002' || imp === 'IVA') result.ivaWithheldTotal += val
    else if (imp === '001' || imp === 'ISR') result.isrWithheldTotal += val
    else if (imp === '003' || imp === 'IEPS') result.iepsWithheldTotal += val
  }
  
  // Extraer desglose de IVA de los nodos Traslado a nivel Concepto o Impuestos
  const conceptosMatch = /<(?:\w+:)?Conceptos[^>]*>([\s\S]*?)<\/(?:\w+:)?Conceptos>/i.exec(xml)
  const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
  
  extractTraslados(parseTarget, result)

  return result
}

function extractTraslados(parseTarget: string, result: ReturnType<typeof extractTaxesFromXml>) {
  const trasladoRegex = /<(?:\w+:)?Traslado([^>]+)>/gi
  const attrRegex = /\b(\w+)="([^"]+)"/g
  
  for (const m of parseTarget.matchAll(trasladoRegex)) {
    const attrsStr = m[1]
    const attrs: Record<string, string> = {}
    for (const attrMatch of attrsStr.matchAll(attrRegex)) {
      attrs[attrMatch[1]] = attrMatch[2]
    }
    
    if (attrs['Impuesto'] === '002' || attrs['Impuesto'] === 'IVA') {
      const base = Number.parseFloat(attrs['Base'] ?? '0')
      const tax = Number.parseFloat(attrs['Importe'] ?? '0')
      const tasa = Number.parseFloat(attrs['TasaOCuota'] ?? '0')
      const tipo = attrs['TipoFactor']
      
      result.ivaTransferredTotal += tax
      
      if (tipo === 'Exento') {
        result.ivaExemptBaseTotal += base
      } else if (tipo === 'Tasa' || attrs['TasaOCuota']) {
        if (Math.abs(tasa - 0.16) < 0.01) {
          result.iva16BaseTotal += base
          result.iva16TaxTotal += tax
        } else if (Math.abs(tasa - 0.08) < 0.01) {
          result.iva8BaseTotal += base
          result.iva8TaxTotal += tax
        } else if (Math.abs(tasa - 0.0) < 0.001) {
          result.iva0BaseTotal += base
        }
      }
    }
  }
}

type ProcessXmlResult = { uuid: string | null; status: 'created' | 'skipped' | 'error'; message?: string; id?: string }

async function processXml(xml: string, ctx: { companyRfc: string, userId: string, fe: { id: string } }): Promise<ProcessXmlResult> {
  const comprobanteTag = xml.includes('<cfdi:Comprobante') ? 'cfdi:Comprobante' : 'Comprobante'
  const emisorTag = xml.includes('<cfdi:Emisor') ? 'cfdi:Emisor' : 'Emisor'
  const receptorTag = xml.includes('<cfdi:Receptor') ? 'cfdi:Receptor' : 'Receptor'
  const timbreTag = xml.includes('<tfd:TimbreFiscalDigital') ? 'tfd:TimbreFiscalDigital' : 'TimbreFiscalDigital'

  const uuid = attrNs(xml, timbreTag, 'UUID')
  if (!uuid) return { uuid: null, status: 'error', message: 'UUID no encontrado en XML' }

  const existing = await prisma.invoice.findUnique({ where: { uuid } })
  if (existing) return { uuid, status: 'skipped', message: 'Invoice ya existe' }

  const tipoComp = attrNs(xml, comprobanteTag, 'TipoDeComprobante')
  const cfdiType = parseCfdiType(tipoComp)
  if (!cfdiType) return { uuid, status: 'error', message: 'TipoDeComprobante inválido' }

  const tags = { comprobanteTag, emisorTag, receptorTag, timbreTag }
  return _createInvoiceFromXml(xml, uuid, cfdiType, tags, ctx)
}

async function _createInvoiceFromXml(xml: string, uuid: string, cfdiType: CfdiType, tags: { comprobanteTag: string, emisorTag: string, receptorTag: string, timbreTag: string }, ctx: { companyRfc: string, userId: string, fe: { id: string } }): Promise<ProcessXmlResult> {
  const { comprobanteTag, emisorTag, receptorTag, timbreTag } = tags
  const series = attrNs(xml, comprobanteTag, 'Serie')
  const folio = attrNs(xml, comprobanteTag, 'Folio')
  const moneda = attrNs(xml, comprobanteTag, 'Moneda') ?? 'MXN'
  const tipoCambio = attrNs(xml, comprobanteTag, 'TipoCambio')
  const subtotalStr = attrNs(xml, comprobanteTag, 'SubTotal') ?? '0'
  const descuentoStr = attrNs(xml, comprobanteTag, 'Descuento') ?? '0'
  const totalStr = attrNs(xml, comprobanteTag, 'Total') ?? '0'
  const fecha = attrNs(xml, comprobanteTag, 'Fecha') ?? new Date().toISOString()
  const lugarExp = attrNs(xml, comprobanteTag, 'LugarExpedicion') ?? ''
  const metodoPago = attrNs(xml, comprobanteTag, 'MetodoPago') ?? ''
  const formaPago = attrNs(xml, comprobanteTag, 'FormaPago') ?? ''

  const issuerRfc = attrNs(xml, emisorTag, 'Rfc') ?? ''
  const issuerName = attrNs(xml, emisorTag, 'Nombre') ?? ''
  const receiverRfc = attrNs(xml, receptorTag, 'Rfc') ?? ''
  const receiverName = attrNs(xml, receptorTag, 'Nombre') ?? ''
  
  if (issuerRfc.length < 12 || issuerRfc.length > 13) return { uuid, status: 'error', message: 'RFC Emisor inválido' }
  if (receiverRfc.length < 12 || receiverRfc.length > 13) return { uuid, status: 'error', message: 'RFC Receptor inválido' }

  if (receiverRfc.toUpperCase() !== ctx.companyRfc.toUpperCase()) {
    return { uuid, status: 'error', message: 'RFC Receptor del CFDI no coincide con la empresa seleccionada (BOLA cross-tenant prevenida)' }
  }

  const usoCfdi = attrNs(xml, receptorTag, 'UsoCFDI') ?? ''

  const fechaTimbrado = attrNs(xml, timbreTag, 'FechaTimbrado') ?? fecha
  const pac = attrNs(xml, timbreTag, 'RfcProvCertif') ?? 'DESCONOCIDO'
  if (!pac) return { uuid, status: 'error', message: 'RfcProvCertif faltante' }

  const isPublicGlobal = /<(?:\w+:)?InformacionGlobal/i.test(xml)
  const taxes = extractTaxesFromXml(xml)

  const xmlRedactedHash = '<REDACTED>_' + crypto.createHash('sha256').update(xml).digest('hex').slice(0, 16)

  const invoice = await prisma.$transaction(async tx => {
    const createdInvoice = await tx.invoice.create({
      data: {
        userId: ctx.userId,
        issuerFiscalEntityId: ctx.fe.id,
        uuid,
        cfdiType,
        series: series ?? null,
        folio: folio ?? null,
        currency: moneda,
        exchangeRate: tipoCambio ? Number(tipoCambio) : null,
        status: InvoiceStatus.ACTIVE,
        satStatus: SatStatus.VIGENTE,
        issuerRfc,
        issuerName,
        receiverRfc,
        receiverName,
        subtotal: new Prisma.Decimal(subtotalStr),
        discount: new Prisma.Decimal(descuentoStr),
        total: new Prisma.Decimal(totalStr),
        ivaTransferred: new Prisma.Decimal(taxes.ivaTransferredTotal.toFixed(2)),
        ivaWithheld: new Prisma.Decimal(taxes.ivaWithheldTotal.toFixed(2)),
        isrWithheld: new Prisma.Decimal(taxes.isrWithheldTotal.toFixed(2)),
        iepsWithheld: new Prisma.Decimal(taxes.iepsWithheldTotal.toFixed(2)),
        iva16Base: new Prisma.Decimal(taxes.iva16BaseTotal.toFixed(2)),
        iva16Tax: new Prisma.Decimal(taxes.iva16TaxTotal.toFixed(2)),
        iva8Base: new Prisma.Decimal(taxes.iva8BaseTotal.toFixed(2)),
        iva8Tax: new Prisma.Decimal(taxes.iva8TaxTotal.toFixed(2)),
        iva0Base: new Prisma.Decimal(taxes.iva0BaseTotal.toFixed(2)),
        ivaExemptBase: new Prisma.Decimal(taxes.ivaExemptBaseTotal.toFixed(2)),
        isPublicGlobal,
        xmlContent: xmlRedactedHash,
        pdfUrl: null,
        issuanceDate: parseCfdiDateTime(fecha),
        certificationDate: parseCfdiDateTime(fechaTimbrado),
        certificationPac: pac,
        paymentMethod: metodoPago ?? '',
        paymentForm: formaPago ?? '',
        cfdiUsage: usoCfdi ?? '',
        placeOfExpedition: lugarExp ?? '',
        exportKey: '01',
      }
    })

    await upsertInvoiceXmlBlob(tx, {
      invoiceId: createdInvoice.id,
      xmlContent: xml
    })

    await upsertInvoiceComplementProjection(tx, {
      invoiceId: createdInvoice.id,
      xmlContent: xml
    })

    await upsertInvoicePaymentComplementDetails(tx, {
      issuerFiscalEntityId: ctx.fe.id,
      paymentInvoiceId: createdInvoice.id,
      paymentInvoiceUuid: uuid,
      xmlContent: xml,
      satStatusSnapshot: SatStatus.VIGENTE,
      fallbackPaymentDate: parseCfdiDateTime(fecha),
      fallbackCurrency: moneda,
      fallbackSeries: series ?? null,
      fallbackFolio: folio ?? null
    })

    return createdInvoice
  })

  return { uuid, status: 'created', id: invoice.id }
}

export async function POST(request: NextRequest) {
  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'uploadMassive', requireCompanyId: true })
    const { ctx, enrichedUser, sessionUserId } = scoped
    const companyId = ctx.companyId!

    const rawForm = { companyId }
    const parsedForm = UploadDashboardRecibidosFormSchema.safeParse(rawForm)
    if (!parsedForm.success) {
      return NextResponse.json({ error: 'Parámetros inválidos', issues: parsedForm.error.flatten(issue => issue.message).fieldErrors }, { status: 400 })
    }

    const { company, fe } = await getOrInitFiscalEntity(companyId, sessionUserId, ctx.organizationId)
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const form = await request.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 })
    }

    const MAX_BATCH_FILES = 100
    if (files.length > MAX_BATCH_FILES) {
      return NextResponse.json({ error: `Máximo ${MAX_BATCH_FILES} archivos por lote` }, { status: 413 })
    }

    const results = await processFiles(files, { companyRfc: company.rfc, userId: sessionUserId, fe })

    const summary = {
      total: results.length,
      created: results.filter(r => r.status === 'created').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length
    }

    await logUploadAudit({ results, summary, filesCount: files.length, sessionUserId, enrichedUser, companyId, request })

    return NextResponse.json({ results, summary })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

async function getOrInitFiscalEntity(companyId: string, userId: string, organizationId: string) {
  const member = await prisma.member.findFirst({
    where: { userId, status: 'APPROVED', organizationId },
    include: { organization: true }
  })
  if (!member) throw new Error('Member not found')

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { rfc: true, businessName: true }
  })
  
  if (!company?.rfc) return { company: null, fe: null }

  let fiscalEntity = await prisma.fiscalEntity.findFirst({
    where: { organizationId: member.organization.id, rfc: company.rfc }
  })

  fiscalEntity ??= await prisma.fiscalEntity.create({
    data: {
      organizationId: member.organization.id,
      rfc: company.rfc,
      businessName: company.businessName ?? company.rfc,
      taxRegime: '601',
      postalCode: '00000',
      isActive: true,
    }
  })

  return { company, fe: fiscalEntity }
}

async function processFiles(files: File[], ctx: { companyRfc: string, userId: string, fe: { id: string } }) {
  const results: ProcessXmlResult[] = []
  
  for (const file of files) {
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')
      if (isZip) {
        const buf = await file.arrayBuffer()
        const zip = await JSZip.loadAsync(buf)
        const entries = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.xml'))
        if (entries.length === 0) {
          results.push({ uuid: null, status: 'error', message: 'ZIP sin XML válidos' })
          continue
        }
        for (const entry of entries) {
          const xml = await entry.async('string')
          results.push(await processXml(xml, ctx))
        }
      } else {
        const xml = await file.text()
        results.push(await processXml(xml, ctx))
      }
    } catch (err) {
      results.push({ uuid: null, status: 'error', message: err instanceof Error ? err.message : 'Error desconocido' })
    }
  }
  
  return results
}

type AuditLogParams = {
  results: ProcessXmlResult[]
  summary: { created: number; skipped: number; errors: number; total: number }
  filesCount: number
  sessionUserId: string
  enrichedUser: { email: string | null }
  companyId: string
  request: NextRequest
}

async function logUploadAudit({ results, summary, filesCount, sessionUserId, enrichedUser, companyId, request }: AuditLogParams) {
  const first25Uuids = results.filter((r: ProcessXmlResult) => r.uuid).map((r: ProcessXmlResult) => r.uuid).slice(0, 25)
  try {
    await createAuditEntry({
      tableName: 'invoices',
      action: 'DASHBOARD_RECIBIDOS.upload_massive',
      userId: sessionUserId,
      userEmail: enrichedUser.email,
      description: `Subida masiva dashboard_recibidos: ${summary.created} creados, ${summary.skipped} skip, ${summary.errors} errores.`,
      recordId: crypto.randomUUID(),
      companyId,
      ipAddress: getRealClientIp(request.headers),
      userAgent: request.headers.get('user-agent') || undefined,
      newValues: {
        summary,
        sampleUuids: first25Uuids,
        filesCount
      }
    })
  } catch {}
}

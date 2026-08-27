import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
import JSZip from 'jszip'
import { upsertInvoiceXmlBlob } from '@/lib/invoice-xml-storage'
import { upsertInvoiceComplementProjection } from '@/lib/cfdi-complement-projection-storage'
import { upsertInvoicePaymentComplementDetails } from '@/lib/invoice-payment-complement-storage'
import { parseCfdiDateTime } from '@/lib/cfdi-date'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { SAT_VALID_REGIMES_2026, DashboardRecibidosUploadFormSchema as UploadDashboardRecibidosFormSchema } from '@/schemas/dashboard-recibidos'
import { createAuditEntry } from '@/lib/audit'
import { getRealClientIp } from '@/lib/security'
import crypto from 'node:crypto'

function attrNs(xml: string, tagNs: string, attrName: string): string | null {
  const re = new RegExp(`<${tagNs}[^>]*\\b${attrName}="([^"]+)"`, 'i')
  const m = xml.match(re)
  return m ? m[1] : null
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

export async function POST(request: NextRequest) {
  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'uploadMassive', requireCompanyId: true })
    const { ctx, enrichedUser, sessionUserId } = scoped
    const companyId = ctx.companyId!

    const rawForm = { companyId }
    const parsedForm = UploadDashboardRecibidosFormSchema.safeParse(rawForm)
    if (!parsedForm.success) {
      return NextResponse.json({ error: 'Parámetros inválidos', issues: parsedForm.error.flatten().fieldErrors }, { status: 400 })
    }

    const member = (await prisma.member.findFirst({
      where: { userId: sessionUserId, status: 'APPROVED', organizationId: ctx.organizationId },
      include: { organization: true }
    }))!

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }
    const companyRfc = company.rfc
    const companyBusinessName = company.businessName || companyRfc

    const regimenFromXml: string | null = null
    const lugarExpedicionFirstFilePostalCode: string | null = null

    const regimenFromXmlClean = (regimenFromXml as string | null)?.trim() ?? null
    const postalCodeFromXmlClean = (lugarExpedicionFirstFilePostalCode as string | null)?.trim() ?? null

    let fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { organizationId: member.organization.id, rfc: companyRfc }
    })

    const taxRegimeFromEntity = fiscalEntity?.taxRegime || '601'
    const postalCodeFromEntity = fiscalEntity?.postalCode || '00000'

    const taxRegimeFinal = regimenFromXmlClean && SAT_VALID_REGIMES_2026.has(regimenFromXmlClean)
      ? regimenFromXmlClean
      : taxRegimeFromEntity

    const postalCodeFinal = postalCodeFromXmlClean && /^\d{5}$/.test(postalCodeFromXmlClean)
      ? postalCodeFromXmlClean
      : postalCodeFromEntity

    if (!fiscalEntity) {
      fiscalEntity = await prisma.fiscalEntity.create({
        data: {
          organizationId: member.organization.id,
          rfc: companyRfc,
          businessName: companyBusinessName,
          taxRegime: taxRegimeFinal,
          postalCode: postalCodeFinal,
          isActive: true,
        }
      })
    }
    const fe = fiscalEntity!
    const userId = sessionUserId

    const form = await request.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 })
    }

    const MAX_BATCH_FILES = 100
    if (files.length > MAX_BATCH_FILES) {
      return NextResponse.json({ error: `Máximo ${MAX_BATCH_FILES} archivos por lote` }, { status: 413 })
    }

    const results: Array<{ uuid: string | null; status: 'created' | 'skipped' | 'error'; message?: string; id?: string }> = []

    async function processXml(xml: string) {
        const comprobanteTag = xml.includes('<cfdi:Comprobante') ? 'cfdi:Comprobante' : 'Comprobante'
        const emisorTag = xml.includes('<cfdi:Emisor') ? 'cfdi:Emisor' : 'Emisor'
        const receptorTag = xml.includes('<cfdi:Receptor') ? 'cfdi:Receptor' : 'Receptor'
        const timbreTag = xml.includes('<tfd:TimbreFiscalDigital') ? 'tfd:TimbreFiscalDigital' : 'TimbreFiscalDigital'

        const uuid = attrNs(xml, timbreTag, 'UUID')
        if (!uuid) return results.push({ uuid: null, status: 'error', message: 'UUID no encontrado en XML' })

        const existing = await prisma.invoice.findUnique({ where: { uuid } })
        if (existing) return results.push({ uuid, status: 'skipped', message: 'Invoice ya existe' })

        const tipoComp = attrNs(xml, comprobanteTag, 'TipoDeComprobante')
        const cfdiType = parseCfdiType(tipoComp)
        if (!cfdiType) return results.push({ uuid, status: 'error', message: 'TipoDeComprobante inválido' })

        const series = attrNs(xml, comprobanteTag, 'Serie')
        const folio = attrNs(xml, comprobanteTag, 'Folio')
        const moneda = attrNs(xml, comprobanteTag, 'Moneda') || 'MXN'
        const tipoCambio = attrNs(xml, comprobanteTag, 'TipoCambio')
        const subtotalStr = attrNs(xml, comprobanteTag, 'SubTotal') || '0'
        const descuentoStr = attrNs(xml, comprobanteTag, 'Descuento') || '0'
        const totalStr = attrNs(xml, comprobanteTag, 'Total') || '0'
        const fecha = attrNs(xml, comprobanteTag, 'Fecha') || new Date().toISOString()
        const lugarExp = attrNs(xml, comprobanteTag, 'LugarExpedicion') || ''
        const metodoPago = attrNs(xml, comprobanteTag, 'MetodoPago') || ''
        const formaPago = attrNs(xml, comprobanteTag, 'FormaPago') || ''

        const issuerRfc = attrNs(xml, emisorTag, 'Rfc') || ''
        const issuerName = attrNs(xml, emisorTag, 'Nombre') || ''
        const receiverRfc = attrNs(xml, receptorTag, 'Rfc') || ''
        const receiverName = attrNs(xml, receptorTag, 'Nombre') || ''
        if (issuerRfc.length < 12 || issuerRfc.length > 13) return results.push({ uuid, status: 'error', message: 'RFC Emisor inválido' })
        if (receiverRfc.length < 12 || receiverRfc.length > 13) return results.push({ uuid, status: 'error', message: 'RFC Receptor inválido' })

        if (receiverRfc.toUpperCase() !== companyRfc.toUpperCase()) {
          return results.push({ uuid, status: 'error', message: 'RFC Receptor del CFDI no coincide con la empresa seleccionada (BOLA cross-tenant prevenida)' })
        }

        const usoCfdi = attrNs(xml, receptorTag, 'UsoCFDI') || ''

        const fechaTimbrado = attrNs(xml, timbreTag, 'FechaTimbrado') || fecha
        const pac = attrNs(xml, timbreTag, 'RfcProvCertif') || 'DESCONOCIDO'
        if (!pac) return results.push({ uuid, status: 'error', message: 'RfcProvCertif faltante' })

        let ivaTransferredTotal = 0
        let ivaWithheldTotal = 0
        let isrWithheldTotal = 0
        let iepsWithheldTotal = 0
        const trasladoRegex = /<[^:>]*:?Traslado[^>]*Impuesto="([^"]+)"[^>]*Importe="([^"]+)"/gi
        const retencionRegex = /<[^:>]*:?Retencion[^>]*Impuesto="([^"]+)"[^>]*Importe="([^"]+)"/gi
        for (const m of xml.matchAll(trasladoRegex)) {
          const imp = String(m[1]).toUpperCase()
          const val = Number(m[2]) || 0
          if (imp === '002' || imp === 'IVA') ivaTransferredTotal += val
          else if (imp === '001' || imp === 'ISR') isrWithheldTotal += 0
          else if (imp === '003' || imp === 'IEPS') iepsWithheldTotal += 0
        }
        for (const m of xml.matchAll(retencionRegex)) {
          const imp = String(m[1]).toUpperCase()
          const val = Number(m[2]) || 0
          if (imp === '002' || imp === 'IVA') ivaWithheldTotal += val
          else if (imp === '001' || imp === 'ISR') isrWithheldTotal += val
          else if (imp === '003' || imp === 'IEPS') iepsWithheldTotal += val
        }

        const xmlRedactedHash = '<REDACTED>_' + crypto.createHash('sha256').update(xml).digest('hex').slice(0, 16)

        const invoice = await prisma.$transaction(async tx => {
          const createdInvoice = await tx.invoice.create({
            data: {
              userId,
              issuerFiscalEntityId: fe.id,
              uuid,
              cfdiType,
              series: series || null,
              folio: folio || null,
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
              ivaTransferred: new Prisma.Decimal(ivaTransferredTotal.toFixed(2)),
              ivaWithheld: new Prisma.Decimal(ivaWithheldTotal.toFixed(2)),
              isrWithheld: new Prisma.Decimal(isrWithheldTotal.toFixed(2)),
              iepsWithheld: new Prisma.Decimal(iepsWithheldTotal.toFixed(2)),
              xmlContent: xmlRedactedHash,
              pdfUrl: null,
              issuanceDate: parseCfdiDateTime(fecha),
              certificationDate: parseCfdiDateTime(fechaTimbrado),
              certificationPac: pac,
              paymentMethod: metodoPago || '',
              paymentForm: formaPago || '',
              cfdiUsage: usoCfdi || '',
              placeOfExpedition: lugarExp || '',
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
            issuerFiscalEntityId: fe.id,
            paymentInvoiceId: createdInvoice.id,
            paymentInvoiceUuid: uuid,
            xmlContent: xml,
            satStatusSnapshot: SatStatus.VIGENTE,
            fallbackPaymentDate: parseCfdiDateTime(fecha),
            fallbackCurrency: moneda,
            fallbackSeries: series || null,
            fallbackFolio: folio || null
          })

          return createdInvoice
        })

        results.push({ uuid, status: 'created', id: invoice.id })
    }

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
            await processXml(xml)
          }
        } else {
          const xml = await file.text()
          await processXml(xml)
        }
      } catch (err) {
        results.push({ uuid: null, status: 'error', message: err instanceof Error ? err.message : 'Error desconocido' })
      }
    }

    const summary = {
      total: results.length,
      created: results.filter(r => r.status === 'created').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length
    }

    const first25Uuids = results.filter(r => r.uuid).map(r => r.uuid).slice(0, 25)
    const needsManualReview = !regimenFromXmlClean || !SAT_VALID_REGIMES_2026.has(regimenFromXmlClean) || !postalCodeFromXmlClean || !/^\d{5}$/.test(postalCodeFromXmlClean || '')
    try {
      await createAuditEntry({
        tableName: 'invoices',
        action: 'DASHBOARD_RECIBIDOS.upload_massive',
        userId: sessionUserId,
        userEmail: enrichedUser.email,
        description: `Subida masiva dashboard_recibidos: ${summary.created} creados, ${summary.skipped} skip, ${summary.errors} errores. NeedsManualReview=${needsManualReview}`,
        recordId: crypto.randomUUID(),
        companyId,
        ipAddress: getRealClientIp(request.headers),
        userAgent: request.headers.get('user-agent') || undefined,
        newValues: {
          summary,
          sampleUuids: first25Uuids,
          filesCount: files.length,
          needsManualReview
        }
      })
    } catch {}

    return NextResponse.json({ results, summary })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

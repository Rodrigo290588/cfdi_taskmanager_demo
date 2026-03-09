import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
import JSZip from 'jszip'

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

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!member?.organization) {
      return NextResponse.json({ error: 'Membresía u organización no encontrada' }, { status: 404 })
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } }
    })
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    let fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { organizationId: member.organization.id, rfc: company.rfc }
    })
    if (!fiscalEntity) {
      fiscalEntity = await prisma.fiscalEntity.create({
        data: {
          organizationId: member.organization.id,
          rfc: company.rfc,
          businessName: company.businessName,
          taxRegime: '601',
          postalCode: '00000',
          isActive: true
        }
      })
    }
    const fe = fiscalEntity!
    const userId = session.user!.id

    const form = await request.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 })
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

        const invoice = await prisma.invoice.create({
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
            xmlContent: xml,
            pdfUrl: null,
            issuanceDate: new Date(fecha),
            certificationDate: new Date(fechaTimbrado),
            certificationPac: pac,
            paymentMethod: metodoPago || '',
            paymentForm: formaPago || '',
            cfdiUsage: usoCfdi || '',
            placeOfExpedition: lugarExp || ''
          }
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

    return NextResponse.json({ results, summary })
  } catch (error) {
    console.error('Upload XML error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

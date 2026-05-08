import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, Prisma } from '@prisma/client'
import { DOMParser } from '@xmldom/xmldom'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originParam = searchParams.get('origin') || 'issued'

    if (!companyId) return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })

    const member = await prisma.member.findFirst({ where: { userId: session.user.id, status: 'APPROVED' } })
    if (!member) return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { rfc: true } })
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc } })
    if (!fiscalEntity) return NextResponse.json({ data: [] })

    const dateFilter: Prisma.InvoiceWhereInput = {}
    if (startDateParam && endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      dateFilter.issuanceDate = { gte: new Date(startDateParam), lte: end }
    }

    let baseWhere: Prisma.InvoiceWhereInput
    if (originParam === 'received') {
      baseWhere = { receiverRfc: rfc, cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] }, ...dateFilter }
    } else if (originParam === 'both') {
      baseWhere = { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] }, ...dateFilter }
    } else {
      baseWhere = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: rfc, cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] }, ...dateFilter }
    }

    const invoices = await prisma.invoice.findMany({
      where: { ...baseWhere, satStatus: 'VIGENTE' },
      select: {
        uuid: true,
        folio: true,
        series: true,
        issuanceDate: true,
        issuerRfc: true,
        receiverRfc: true,
        issuerName: true,
        receiverName: true,
        cfdiType: true,
        paymentMethod: true,
        currency: true,
        exchangeRate: true,
        subtotal: true,
        xmlContent: true,
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drilldownData: any[] = []
    const parser = new DOMParser()

    invoices.forEach(inv => {
      const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
      const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
      const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

      if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE') {
        let subtotal = Number(inv.subtotal) || 0
        if (inv.currency && inv.currency !== 'MXN' && inv.exchangeRate) {
          subtotal = subtotal * Number(inv.exchangeRate)
        }
        
        drilldownData.push({
          uuid: inv.uuid,
          uuidRelacionado: '',
          tipo: 'Factura Contado (PUE)',
          fecha: inv.issuanceDate,
          serie: inv.series || '',
          folio: inv.folio || '',
          rfc: rfcOponente,
          razonSocial: nombreOponente || 'Desconocido',
          moneda: inv.currency || 'MXN',
          tipoCambio: Number(inv.exchangeRate) || 1,
          importe: subtotal
        })
      }

      if (inv.cfdiType === 'PAGO' && inv.xmlContent) {
        try {
          const doc = parser.parseFromString(inv.xmlContent, 'text/xml')
          const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
          
          pagos.forEach(pagoNode => {
            const monedaP = pagoNode.getAttribute('MonedaP') || inv.currency || 'MXN'
            
            // Extract related UUIDs
            const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':DoctoRelacionado'))
            const relatedUuids = doctos.map(d => d.getAttribute('IdDocumento')).filter(Boolean).join(', ')

            let totalBaseP = 0
            const impuestosP = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':ImpuestosP'))
            impuestosP.forEach(impNode => {
               const trasladosP = Array.from(impNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':TrasladoP'))
               trasladosP.forEach(trasladoP => {
                  const impuestoP = trasladoP.getAttribute('ImpuestoP')
                  const baseP = parseFloat(trasladoP.getAttribute('BaseP') || '0')
                  if (impuestoP === '002') {
                     totalBaseP += baseP
                  }
               })
            })

            if (totalBaseP > 0) {
              drilldownData.push({
                uuid: inv.uuid,
                uuidRelacionado: relatedUuids,
                tipo: 'Complemento de Pago (CRP)',
                fecha: inv.issuanceDate,
                serie: inv.series || '',
                folio: inv.folio || '',
                rfc: rfcOponente,
                razonSocial: nombreOponente || 'Desconocido',
                moneda: monedaP,
                tipoCambio: Number(inv.exchangeRate) || 1,
                importe: totalBaseP
              })
            }
          })
        } catch {
          // ignore parse error
        }
      }
    })

    // Sort by date descending
    drilldownData.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    return NextResponse.json({ data: drilldownData })
  } catch (error) {
    console.error('Drilldown error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

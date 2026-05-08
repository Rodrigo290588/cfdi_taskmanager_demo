import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { rfc: true } })
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc } })
    if (!fiscalEntity) return NextResponse.json({ data: [] })

    // Date filters apply to the issuance date of the original PPD invoice
    const dateFilter: any = {}
    if (startDateParam && endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      dateFilter.issuanceDate = { gte: new Date(startDateParam), lte: end }
    }

    let baseWhere: any
    if (originParam === 'received') {
      baseWhere = { receiverRfc: rfc, cfdiType: 'INGRESO', paymentMethod: 'PPD', satStatus: 'VIGENTE', ...dateFilter }
    } else if (originParam === 'both') {
      baseWhere = { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], cfdiType: 'INGRESO', paymentMethod: 'PPD', satStatus: 'VIGENTE', ...dateFilter }
    } else {
      baseWhere = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: rfc, cfdiType: 'INGRESO', paymentMethod: 'PPD', satStatus: 'VIGENTE', ...dateFilter }
    }

    // Step 1: Find all valid PPD invoices
    const ppdInvoices = await prisma.invoice.findMany({
      where: baseWhere,
      select: {
        id: true,
        uuid: true,
        folio: true,
        series: true,
        issuanceDate: true,
        issuerRfc: true,
        receiverRfc: true,
        issuerName: true,
        receiverName: true,
        cfdiType: true,
        currency: true,
        exchangeRate: true,
        total: true,
      }
    })

    const ppdUuids = ppdInvoices.map(inv => inv.uuid)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drilldownData: any[] = []

    // Map PPDs as positive rows
    ppdInvoices.forEach(inv => {
      const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
      const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
      const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

      drilldownData.push({
        uuid: inv.uuid,
        uuidRelacionado: '',
        tipo: 'Factura a Crédito (PPD)',
        fecha: inv.issuanceDate,
        serie: inv.series || '',
        folio: inv.folio || '',
        rfc: rfcOponente,
        razonSocial: nombreOponente || 'Desconocido',
        moneda: inv.currency || 'MXN',
        tipoCambio: Number(inv.exchangeRate) || 1,
        importe: Number(inv.total) || 0
      })
    })

    if (ppdUuids.length > 0) {
      // Step 2: Find all CRPs related to these PPDs
      const relatedPagos = await prisma.invoiceRelatedCfdi.findMany({
        where: {
          relatedUuid: { in: ppdUuids },
          invoice: { cfdiType: 'PAGO', satStatus: 'VIGENTE' }
        },
        include: {
          invoice: {
            select: {
              uuid: true,
              folio: true,
              series: true,
              issuanceDate: true,
              issuerRfc: true,
              receiverRfc: true,
              issuerName: true,
              receiverName: true,
              currency: true,
              exchangeRate: true,
              xmlContent: true,
            }
          }
        }
      })

      const parser = new DOMParser()
      
      // Group by invoiceId to avoid parsing the same PAGO XML multiple times if it pays multiple PPDs
      const pagosMap = new Map()
      relatedPagos.forEach(rel => {
        if (!pagosMap.has(rel.invoiceId)) {
          pagosMap.set(rel.invoiceId, {
            invoice: rel.invoice,
            relatedUuids: new Set([rel.relatedUuid])
          })
        } else {
          pagosMap.get(rel.invoiceId).relatedUuids.add(rel.relatedUuid)
        }
      })

      for (const pago of pagosMap.values()) {
        const inv = pago.invoice
        const targetUuids = pago.relatedUuids
        if (!inv.xmlContent) continue

        const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
        const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
        const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

        try {
          const doc = parser.parseFromString(inv.xmlContent, 'text/xml')
          const pagosNodos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
          
          pagosNodos.forEach(pagoNode => {
            const monedaP = pagoNode.getAttribute('MonedaP') || inv.currency || 'MXN'
            const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':DoctoRelacionado'))
            
            doctos.forEach(doctoNode => {
              const idDocumento = doctoNode.getAttribute('IdDocumento')
              if (idDocumento && targetUuids.has(idDocumento.toLowerCase())) {
                const impPagado = parseFloat(doctoNode.getAttribute('ImpPagado') || '0')
                
                if (impPagado > 0) {
                  drilldownData.push({
                    uuid: inv.uuid,
                    uuidRelacionado: idDocumento.toUpperCase(),
                    tipo: 'Complemento de Pago (CRP)',
                    fecha: inv.issuanceDate,
                    serie: inv.series || '',
                    folio: inv.folio || '',
                    rfc: rfcOponente,
                    razonSocial: nombreOponente || 'Desconocido',
                    moneda: monedaP,
                    tipoCambio: Number(inv.exchangeRate) || 1,
                    importe: -impPagado // Negative because it reduces the pending amount
                  })
                }
              }
            })
          })
        } catch {
          // ignore parse error
        }
      }

      // Step 3: Find all Notas de Crédito (EGRESO) related to these PPDs
      const relatedEgresos = await prisma.invoiceRelatedCfdi.findMany({
        where: {
          relatedUuid: { in: ppdUuids },
          invoice: { cfdiType: 'EGRESO', satStatus: 'VIGENTE' }
        },
        include: {
          invoice: {
            select: {
              uuid: true,
              folio: true,
              series: true,
              issuanceDate: true,
              issuerRfc: true,
              receiverRfc: true,
              issuerName: true,
              receiverName: true,
              currency: true,
              exchangeRate: true,
              total: true,
            }
          }
        }
      })

      relatedEgresos.forEach(rel => {
        const inv = rel.invoice
        const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
        const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
        const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

        drilldownData.push({
          uuid: inv.uuid,
          uuidRelacionado: rel.relatedUuid.toUpperCase(),
          tipo: 'Nota de Crédito (Ajuste)',
          fecha: inv.issuanceDate,
          serie: inv.series || '',
          folio: inv.folio || '',
          rfc: rfcOponente,
          razonSocial: nombreOponente || 'Desconocido',
          moneda: inv.currency || 'MXN',
          tipoCambio: Number(inv.exchangeRate) || 1,
          importe: -Number(inv.total) || 0 // Negative because it reduces the pending amount
        })
      })
    }

    // Sort by date descending
    drilldownData.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    return NextResponse.json({ data: drilldownData })

  } catch (error) {
    console.error('Drilldown API Error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
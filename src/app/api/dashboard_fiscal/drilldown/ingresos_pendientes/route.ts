import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DOMParser } from '@xmldom/xmldom'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeUuid(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

export async function GET(request: NextRequest) {
  try {
    const { ctx, searchParams, systemRole: _sr } = await buildDashboardScopedContext(request, { routeKey: 'drilldown', requireCompanyId: true })
    void _sr

    const companyId = searchParams.get('companyId')!
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originParam = searchParams.get('origin') || 'issued'

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { rfc: true } })
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: SECURITY_HEADERS })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc, organizationId: ctx.organizationId } })
    if (!fiscalEntity) return NextResponse.json({ data: [] }, { headers: SECURITY_HEADERS })

    // Date filters apply to the issuance date of the original PPD invoice
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateFilter: any = {}
    if (startDateParam && endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      dateFilter.issuanceDate = { gte: new Date(startDateParam), lte: end }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const paymentDetails = await prisma.invoicePaymentComplementDetail.findMany({
        where: {
          relatedInvoiceUuid: { in: ppdUuids },
          satStatusSnapshot: 'VIGENTE'
        },
        include: {
          paymentInvoice: {
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
              exchangeRate: true
            }
          }
        },
        orderBy: [
          { paymentDate: 'asc' },
          { createdAt: 'asc' }
        ]
      })

      paymentDetails.forEach(detail => {
        const inv = detail.paymentInvoice
        const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
        const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
        const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName
        const impPagado = toNumber(detail.impPagado)

        if (impPagado <= 0) {
          return
        }

        drilldownData.push({
          uuid: inv.uuid,
          uuidRelacionado: normalizeUuid(detail.relatedInvoiceUuid),
          tipo: 'Complemento de Pago (CRP)',
          fecha: inv.issuanceDate,
          serie: inv.series || '',
          folio: inv.folio || '',
          rfc: rfcOponente,
          razonSocial: nombreOponente || 'Desconocido',
          moneda: detail.monedaP || inv.currency || 'MXN',
          tipoCambio: Number(inv.exchangeRate) || 1,
          importe: -impPagado
        })
      })

      const coveredRelatedUuids = new Set(paymentDetails.map(detail => normalizeUuid(detail.relatedInvoiceUuid)))
      const missingRelatedUuids = ppdUuids.filter(uuid => !coveredRelatedUuids.has(normalizeUuid(uuid)))

      if (missingRelatedUuids.length > 0) {
        const relatedPagos = await prisma.invoiceRelatedCfdi.findMany({
          where: {
            relatedUuid: { in: missingRelatedUuids },
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
                exchangeRate: true
              }
            }
          }
        })

        const parser = new DOMParser()

        const pagosMap = new Map()
        relatedPagos.forEach(rel => {
          const normalizedRelatedUuid = normalizeUuid(rel.relatedUuid)

          if (!pagosMap.has(rel.invoiceId)) {
            pagosMap.set(rel.invoiceId, {
              invoice: rel.invoice,
              relatedUuids: new Set([normalizedRelatedUuid])
            })
          } else {
            pagosMap.get(rel.invoiceId).relatedUuids.add(normalizedRelatedUuid)
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
                const normalizedIdDocumento = normalizeUuid(idDocumento)

                if (normalizedIdDocumento && targetUuids.has(normalizedIdDocumento)) {
                  const impPagado = parseFloat(doctoNode.getAttribute('ImpPagado') || '0')

                  if (impPagado > 0) {
                    drilldownData.push({
                      uuid: inv.uuid,
                      uuidRelacionado: normalizedIdDocumento,
                      tipo: 'Complemento de Pago (CRP)',
                      fecha: inv.issuanceDate,
                      serie: inv.series || '',
                      folio: inv.folio || '',
                      rfc: rfcOponente,
                      razonSocial: nombreOponente || 'Desconocido',
                      moneda: monedaP,
                      tipoCambio: Number(inv.exchangeRate) || 1,
                      importe: -impPagado
                    })
                  }
                }
              })
            })
          } catch {
            // ignore parse error
          }
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
          uuidRelacionado: normalizeUuid(rel.relatedUuid),
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

    return NextResponse.json({ data: drilldownData }, { headers: SECURITY_HEADERS })

  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

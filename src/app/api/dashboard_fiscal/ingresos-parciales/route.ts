import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { DOMParser } from '@xmldom/xmldom'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const _SAFE_DOM_PARSER_OPTS = {
  disableEntities: true,
  xmlMode: true,
  errorHandler: { warning() {}, error() {}, fatalError() {} },
} as unknown as ConstructorParameters<typeof DOMParser>[0]
function makeSafeDomParser() { return new DOMParser(_SAFE_DOM_PARSER_OPTS) as DOMParser }

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeUpperText(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

function buildDateRange(startValue: string | null, endValue: string | null) {
  if (!startValue && !endValue) {
    return null
  }

  const range: { gte?: Date; lte?: Date } = {}

  if (startValue) {
    range.gte = new Date(startValue)
  }

  if (endValue) {
    const end = new Date(endValue)
    end.setHours(23, 59, 59, 999)
    range.lte = end
  }

  return range
}

function isDateWithinRange(value: Date, range: { gte?: Date; lte?: Date } | null) {
  if (!range) {
    return true
  }

  if (range.gte && value < range.gte) {
    return false
  }

  if (range.lte && value > range.lte) {
    return false
  }

  return true
}

export async function GET(req: NextRequest) {
  try {
    const { ctx, searchParams, systemRole: _sr } = await buildDashboardScopedContext(req, { routeKey: 'partialReport', requireCompanyId: true })
    void _sr
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const rfc = searchParams.get('rfc')
    const paymentDateStart = searchParams.get('paymentDateStart')
    const paymentDateEnd = searchParams.get('paymentDateEnd')
    const incomeCurrency = searchParams.get('incomeCurrency')
    const paymentCurrency = searchParams.get('paymentCurrency')
    const normalizedPaymentCurrency = paymentCurrency && paymentCurrency !== 'ALL'
      ? normalizeUpperText(paymentCurrency)
      : null
    const paymentDateRange = buildDateRange(paymentDateStart, paymentDateEnd)
    const hasPaymentFilters = Boolean(normalizedPaymentCurrency || paymentDateRange)

    if (!startDate || !endDate || !rfc) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400, headers: SECURITY_HEADERS })
    }

    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { organizationId: ctx.organizationId, rfc: rfc }
    })
    if (!fiscalEntity) {
      return NextResponse.json({ error: 'RFC no encontrado en la organización' }, { status: 404, headers: SECURITY_HEADERS })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    // Adjust end date to include the full day
    end.setHours(23, 59, 59, 999)

    // Build invoice filter
    const invoiceWhere: Record<string, unknown> = {
      issuerRfc: rfc,
      cfdiType: 'INGRESO',
      paymentMethod: 'PPD',
      satStatus: 'VIGENTE',
      issuanceDate: {
        gte: start,
        lte: end,
      },
    }

    if (incomeCurrency && incomeCurrency !== 'ALL') {
      invoiceWhere.currency = incomeCurrency
    }

    // 1. Fetch PPD Invoices (Ingresos)
    const ppdInvoices = await prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        uuid: true,
        series: true,
        folio: true,
        issuerRfc: true,
        issuerName: true,
        receiverRfc: true,
        receiverName: true,
        total: true,
        currency: true,
        exchangeRate: true,
        issuanceDate: true,
        xmlContent: true, // Might need to check if PPD itself has info, but usually no.
      },
      orderBy: {
        issuanceDate: 'asc',
      },
    })

    const ppdUuids = ppdInvoices.map((inv) => inv.uuid)

    // 2. Fetch Related Payments (REPs) from specialized table
    const paymentDetailWhere: Record<string, unknown> = {
      relatedInvoiceUuid: { in: ppdUuids },
      satStatusSnapshot: 'VIGENTE'
    }

    if (normalizedPaymentCurrency) {
      paymentDetailWhere.monedaP = normalizedPaymentCurrency
    }

    if (paymentDateRange) {
      paymentDetailWhere.paymentDate = paymentDateRange
    }

    const paymentDetails = ppdUuids.length > 0
      ? await prisma.invoicePaymentComplementDetail.findMany({
          where: paymentDetailWhere,
          include: {
            paymentInvoice: {
              select: {
                id: true,
                uuid: true,
                series: true,
                folio: true,
                issuanceDate: true,
                xmlContent: true
              }
            }
          },
          orderBy: [
            { paymentDate: 'asc' },
            { createdAt: 'asc' }
          ]
        })
      : []

    const coveredRelatedUuids = new Set(paymentDetails.map(detail => detail.relatedInvoiceUuid.toUpperCase()))
    const missingRelatedUuids = ppdUuids.filter(uuid => !coveredRelatedUuids.has(uuid.toUpperCase()))

    // 2.1. Fetch related Credit Notes (EGRESO) for PPD invoices to align KPI with dashboard fiscal
    const relatedEgresos = ppdUuids.length > 0
      ? await prisma.invoiceRelatedCfdi.findMany({
          where: {
            relatedUuid: { in: ppdUuids },
            invoice: { cfdiType: 'EGRESO', satStatus: 'VIGENTE' }
          },
          select: {
            relatedUuid: true,
            invoiceId: true,
            invoice: {
              select: {
                total: true,
                currency: true
              }
            }
          },
          distinct: ['invoiceId']
        })
      : []

    const creditNotesByRelatedUuid: Record<string, number> = {}
    relatedEgresos.forEach(rel => {
      const relatedUuid = normalizeUpperText(rel.relatedUuid)
      creditNotesByRelatedUuid[relatedUuid] =
        (creditNotesByRelatedUuid[relatedUuid] || 0) + toNumber(rel.invoice.total)
    })

    // 3. Process Payments and Calculate Balances
    type PaymentInfo = {
      paymentUuid: string
      paymentDate: Date
      paymentSeries: string | null
      paymentFolio: string | null
      impPagado: number
      monedaDR: string
      equivalenciaDR: number
      numParcialidad: number
      impSaldoAnt: number
      impSaldoInsoluto: number
      monedaP: string
      paymentXml?: string | null
    }
    const paymentsMap: Record<string, PaymentInfo[]> = {}

    paymentDetails.forEach(detail => {
      const ppdUuid = detail.relatedInvoiceUuid

      if (!paymentsMap[ppdUuid]) {
        paymentsMap[ppdUuid] = []
      }

      paymentsMap[ppdUuid].push({
        paymentUuid: detail.paymentInvoiceUuid,
        paymentDate: detail.paymentDate,
        paymentSeries: detail.paymentSeries,
        paymentFolio: detail.paymentFolio,
        impPagado: toNumber(detail.impPagado),
        monedaDR: detail.monedaDR,
        equivalenciaDR: toNumber(detail.equivalenciaDR) || 1,
        numParcialidad: detail.numParcialidad || 1,
        impSaldoAnt: toNumber(detail.impSaldoAnt),
        impSaldoInsoluto: toNumber(detail.impSaldoInsoluto),
        monedaP: detail.monedaP,
        paymentXml: detail.paymentInvoice.xmlContent
      })
    })

    if (missingRelatedUuids.length > 0) {
      const paymentInvoiceWhere: Record<string, unknown> = {
        cfdiType: 'PAGO',
        satStatus: 'VIGENTE'
      }

      if (paymentDateRange) {
        paymentInvoiceWhere.issuanceDate = paymentDateRange
      }

      const legacyRelations = await prisma.invoiceRelatedCfdi.findMany({
        where: {
          relatedUuid: { in: missingRelatedUuids },
          invoice: paymentInvoiceWhere
        },
        include: {
          invoice: {
            select: {
              uuid: true,
              series: true,
              folio: true,
              issuanceDate: true,
              xmlContent: true
            }
          }
        }
      })

      const parser = makeSafeDomParser()
      const getAttr = (el: Element, name: string) => el.getAttribute(name) || ''

      legacyRelations.forEach(relation => {
        const paymentInvoice = relation.invoice
        const ppdUuid = relation.relatedUuid

        if (!paymentInvoice.xmlContent) return

        try {
          const doc = parser.parseFromString(paymentInvoice.xmlContent, 'text/xml')
          const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => {
            if (!el.nodeName.endsWith(':Pago')) return false
            let curr = el.parentNode
            while (curr) {
              if (curr.nodeName && curr.nodeName.endsWith(':Addenda')) {
                return false
              }
              curr = curr.parentNode
            }
            return true
          })

          pagos.forEach(pagoNode => {
            const monedaP = getAttr(pagoNode, 'MonedaP')
            const normalizedMonedaP = normalizeUpperText(monedaP)

            if (normalizedPaymentCurrency && normalizedMonedaP !== normalizedPaymentCurrency) {
              return
            }

            const fechaPago = new Date(getAttr(pagoNode, 'FechaPago'))

            if (Number.isNaN(fechaPago.getTime()) || !isDateWithinRange(fechaPago, paymentDateRange)) {
              return
            }

            const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter(el =>
              el.nodeName.endsWith(':DoctoRelacionado')
              && getAttr(el, 'IdDocumento').toLowerCase() === ppdUuid.toLowerCase()
            )

            doctos.forEach(doctoNode => {
              if (!paymentsMap[ppdUuid]) {
                paymentsMap[ppdUuid] = []
              }

              paymentsMap[ppdUuid].push({
                paymentUuid: paymentInvoice.uuid,
                paymentDate: fechaPago,
                paymentSeries: paymentInvoice.series,
                paymentFolio: paymentInvoice.folio,
                impPagado: toNumber(getAttr(doctoNode, 'ImpPagado')),
                monedaDR: getAttr(doctoNode, 'MonedaDR') || monedaP,
                equivalenciaDR: toNumber(getAttr(doctoNode, 'EquivalenciaDR')) || 1,
                numParcialidad: Math.trunc(toNumber(getAttr(doctoNode, 'NumParcialidad'))) || 1,
                impSaldoAnt: toNumber(getAttr(doctoNode, 'ImpSaldoAnt')),
                impSaldoInsoluto: toNumber(getAttr(doctoNode, 'ImpSaldoInsoluto')),
                monedaP: normalizedMonedaP || normalizeUpperText(getAttr(doctoNode, 'MonedaDR')),
                paymentXml: paymentInvoice.xmlContent
              })
            })
          })
        } catch (error) {
          console.error('Error parsing legacy payment XML', paymentInvoice.uuid, error)
        }
      })
    }

    // 4. Final Aggregation
    const aggregatedResults = ppdInvoices.map((inv) => {
      const payments = paymentsMap[inv.uuid] || []

      // Calculate total paid
      // We need to be careful with currencies.
      // The PPD total is in inv.currency.
      // The Payment details have ImpPagado (Amount Paid assigned to this doc).
      // ImpPagado is usually expressed in the currency of the *Payment* (MonedaP), 
      // BUT in CFDI 4.0 / 2.0 complement, it might be different.
      // Wait, let's check SAT rules.
      // In REP 1.0: ImpPagado is in the currency of the *Payment* (MonedaP).
      // In REP 2.0: ImpPagado is in the currency of the *Related Document* (MonedaDR)? 
      // NO. ImpPagado is the amount *of the payment* applied to the document.
      // If Payment is USD and Doc is MXN:
      //   ImpPagado is in USD.
      //   EquivalenciaDR is the rate to convert USD to MXN.
      //   Amount Credited to Doc (in Doc Currency) = ImpPagado * EquivalenciaDR.
      //   Wait, usually: ImpPagado * EquivalenciaDR = Amount in Doc Currency.
      // Let's verify standard:
      // "El importe pagado corresponde a la cantidad que se abona al documento relacionado expresada en la moneda del pago."
      // So yes, ImpPagado is in Payment Currency.
      // To get the amount reduced from the Debt (in Doc Currency):
      //   AmountInDocCurrency = ImpPagado * EquivalenciaDR (if currencies differ)
      //   If currencies are same, EquivalenciaDR is 1.
      
      // However, there is a nuance. Sometimes EquivalenciaDR is defined as DocCurrency / PaymentCurrency or vice versa.
      // SAT Guide: "EquivalenciaDR: Es el tipo de cambio conforme con la moneda registrada en el documento relacionado."
      // Formula: ImportePagado * EquivalenciaDR = Importe en moneda del documento relacionado.
      // So yes, we multiply.
      
      const totalOriginal = toNumber(inv.total)
      
      const totalPaidInDocCurrency = payments.reduce((acc, p) => {
        let amountInDocCurrency = 0
        
        if (p.equivalenciaDR && p.equivalenciaDR > 0) {
           amountInDocCurrency = p.impPagado * p.equivalenciaDR
        } else {
           amountInDocCurrency = p.impPagado
        }
        
        return acc + amountInDocCurrency
      }, 0)

      const creditNoteAdjustment = creditNotesByRelatedUuid[normalizeUpperText(inv.uuid)] || 0
      const saldoInsoluto = Math.max(0, totalOriginal - totalPaidInDocCurrency - creditNoteAdjustment)
      
      const isPaid = saldoInsoluto < 0.01

      payments.sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())

      return {
        ...inv,
        total: totalOriginal,
        totalPaid: totalPaidInDocCurrency,
        creditNoteAdjustment,
        saldoInsoluto,
        isPaid,
        payments
      }
    })

    const results = hasPaymentFilters
      ? aggregatedResults.filter(invoice => invoice.payments.length > 0)
      : aggregatedResults

    // Dashboard fiscal calculation: totals in original currency (PPD total - CRP paid - related credit notes)
    const sumFacturasPPD = results.reduce((acc, inv) => acc + toNumber(inv.total), 0)
    const sumComplementosPago = results.reduce((acc, inv) => acc + toNumber(inv.totalPaid), 0)
    const sumNotasCreditoAplicadas = results.reduce((acc, inv) => acc + toNumber(inv.creditNoteAdjustment || 0), 0)
    const ingresosPendientesCobro = Math.max(0, sumFacturasPPD - sumComplementosPago - sumNotasCreditoAplicadas)
    const ingresosCobradosCrp = sumComplementosPago

    // Additional MXN-converted aggregates (kept as reference, but not for main KPI alignment)
    let totalSaldoInsolutoMXN = 0
    let totalPorCobrarMXN = 0

    results.forEach(r => {
      const rate = r.exchangeRate ? toNumber(r.exchangeRate) : 1
      const saldoMXN = r.saldoInsoluto * rate

      totalSaldoInsolutoMXN += saldoMXN

      if (!r.isPaid) {
        totalPorCobrarMXN += (r.total * rate)
      }
    })

    const countPaid = results.filter(r => r.isPaid).length

    return NextResponse.json({
      data: results,
      kpis: {
        ingresosPendientesCobro,
        ingresosCobradosCrp,
        ingresosCobradosTotal: ingresosCobradosCrp + results.reduce((acc, r) => (r.isPaid ? acc + toNumber(r.total) : acc), 0),
        montoPorCobrarBruto: results.filter(r => !r.isPaid).reduce((acc, r) => acc + toNumber(r.total), 0),
        sumNotasCreditoAplicadas,
        totalSaldoInsolutoMXN,
        totalPorCobrarMXN,
        count: results.length,
        countPaid,
        countPending: results.length - countPaid
      }
    }, { headers: SECURITY_HEADERS })

  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

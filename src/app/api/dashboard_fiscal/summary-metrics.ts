import { normalizeUpperText, toNumber } from './heavy-metrics'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

export interface SummaryMetricsOptions {
  startDateParam: string | null
  endDateParam: string | null
  companyId: string
  companyName: string
  rfc: string
  monthsToQuery: Date[]
  effectiveOrigin: string
  issuerFiscalEntityId: string
  organizationId: string

}

class SummaryAccumulator {
  monthMap = new Map<string, {
    label: string
    count: number
    total: number
    taxes: {
      ivaTrasladado: number
      ivaRetenido: number
      isrRetenido: number
      iepsRetenido: number
    }
  }>()
  byTypeMap = new Map<string, { type: string; count: number; total: number }>()
  bySatStatusMap = new Map<string, { status: string; count: number }>()
  paymentMethodsMap = new Map<string, { method: string; count: number; total: number }>()
  topClientsMap = new Map<string, { rfc: string; name: string; total: number; cobrado: number; pendiente: number }>()

  totalCfdis = 0
  totalMonto = 0
  ivaTrasladado = 0
  ivaRetenido = 0
  isrRetenido = 0
  iepsRetenido = 0
  ventasNominativas = 0
  ventasGlobales = 0
  operacionesIndividuales = 0
  ingresosBrutos = 0
  descuentosYBonificaciones = 0
  montoCancelado = 0
  cancelCount = 0
  montoNotasCredito = 0
  montoCanceladoEgresos = 0

  collectedTotal = 0
  collectedPueTotal = 0
  collectedCrpTotal = 0
  pendingTotal = 0
  creditNoteAppliedTotal = 0

  constructor(monthsToQuery: Date[]) {
    monthsToQuery.forEach(start => {
      const monthKey = `${start.getUTCFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
      this.monthMap.set(monthKey, {
        label: `${start.toLocaleString('es-MX', { month: 'short', timeZone: 'UTC' })} ${start.getUTCFullYear()}`,
        count: 0,
        total: 0,
        taxes: {
          ivaTrasladado: 0,
          ivaRetenido: 0,
          isrRetenido: 0,
          iepsRetenido: 0
        }
      })
    })
  }

  processRow(row: Partial<Prisma.InvoiceIssuedDailySummaryGetPayload<Record<string, never>>>) {
    const cfdiType = normalizeUpperText(row.cfdiType)
    const satStatus = normalizeUpperText(row.satStatus)
    const paymentMethod = normalizeUpperText(row.paymentMethod)
    const salesBucket = normalizeUpperText(row.salesBucket)
    const receiverRfc = normalizeUpperText(row.receiverRfc)
    const receiverName = (row.receiverName || '').trim()
    const cfdiCount = row.cfdiCount || 0
    const totalAmount = toNumber(row.totalAmount)
    const subtotalAmount = toNumber(row.subtotalAmount)
    const discountAmount = toNumber(row.discountAmount)
    const ivaTransferredTotal = toNumber(row.ivaTransferredTotal)
    const ivaWithheldTotal = toNumber(row.ivaWithheldTotal)
    const isrWithheldTotal = toNumber(row.isrWithheldTotal)
    const iepsWithheldTotal = toNumber(row.iepsWithheldTotal)
    const collectedAmount = toNumber(row.collectedAmount)
    const pendingAmount = toNumber(row.pendingAmount)
    const creditNoteAppliedAmount = toNumber(row.creditNoteAppliedAmount)

    if (cfdiType === 'INGRESO' || cfdiType === 'PAGO') {
      this.processIncomeAndPayment({
        cfdiType,
        satStatus,
        cfdiCount,
        totalAmount,
        ivaTransferredTotal,
        ivaWithheldTotal,
        isrWithheldTotal,
        iepsWithheldTotal,
        summaryDateRaw: row.summaryDate
      })
      this.processPaymentMethodAndClient({
        cfdiType,
        paymentMethod,
        cfdiCount,
        totalAmount,
        receiverRfc,
        receiverName,
        collectedAmount,
        pendingAmount
      })
    }

    if (cfdiType === 'INGRESO' && satStatus === 'VIGENTE') {
      this.processIngresoVigente({
        paymentMethod,
        salesBucket,
        subtotalAmount,
        discountAmount,
        collectedAmount,
        pendingAmount,
        creditNoteAppliedAmount
      })
    }

    if (cfdiType === 'INGRESO' && satStatus === 'CANCELADO') {
      this.montoCancelado += totalAmount
      this.cancelCount += cfdiCount
    }

    if (cfdiType === 'EGRESO' && satStatus === 'VIGENTE') {
      // Nota: summary-metrics procesa línea por línea pero no tiene la relación cruzada de uuid.
      // Asumimos que la mayoría de egresos vigentes en este bucket de resumen aplican como notas de crédito.
      this.montoNotasCredito += subtotalAmount
    }

    if (cfdiType === 'EGRESO' && satStatus === 'CANCELADO') {
      this.montoCanceladoEgresos += totalAmount
    }
  }

  private processIncomeAndPayment(params: {
    cfdiType: string
    satStatus: string
    cfdiCount: number
    totalAmount: number
    ivaTransferredTotal: number
    ivaWithheldTotal: number
    isrWithheldTotal: number
    iepsWithheldTotal: number
    summaryDateRaw: Date | string | undefined
  }) {
    const { cfdiType, satStatus, cfdiCount, totalAmount, ivaTransferredTotal, ivaWithheldTotal, isrWithheldTotal, iepsWithheldTotal, summaryDateRaw } = params
    this.totalCfdis += cfdiCount
    if (cfdiType === 'INGRESO' && satStatus === 'VIGENTE') {
      this.totalMonto += totalAmount
    }
    this.ivaTrasladado += ivaTransferredTotal
    this.ivaRetenido += ivaWithheldTotal
    this.isrRetenido += isrWithheldTotal
    this.iepsRetenido += iepsWithheldTotal

    const byTypeEntry = this.byTypeMap.get(cfdiType) || { type: cfdiType, count: 0, total: 0 }
    byTypeEntry.count += cfdiCount
    byTypeEntry.total += totalAmount
    this.byTypeMap.set(cfdiType, byTypeEntry)

    if (satStatus === 'VIGENTE' || satStatus === 'CANCELADO') {
      const byStatusEntry = this.bySatStatusMap.get(satStatus) || { status: satStatus, count: 0 }
      byStatusEntry.count += cfdiCount
      this.bySatStatusMap.set(satStatus, byStatusEntry)
    }

    const summaryDate = summaryDateRaw instanceof Date ? summaryDateRaw : new Date(summaryDateRaw || 0)
    const monthKey = `${summaryDate.getUTCFullYear()}-${String(summaryDate.getUTCMonth() + 1).padStart(2, '0')}`
    const monthEntry = this.monthMap.get(monthKey)
    if (monthEntry) {
      monthEntry.count += cfdiCount
      monthEntry.total += totalAmount
      monthEntry.taxes.ivaTrasladado += ivaTransferredTotal
      monthEntry.taxes.ivaRetenido += ivaWithheldTotal
      monthEntry.taxes.isrRetenido += isrWithheldTotal
      monthEntry.taxes.iepsRetenido += iepsWithheldTotal
    }
  }

  private processPaymentMethodAndClient(params: {
    cfdiType: string
    paymentMethod: string
    cfdiCount: number
    totalAmount: number
    receiverRfc: string
    receiverName: string
    collectedAmount: number
    pendingAmount: number
  }) {
    const { cfdiType, paymentMethod, cfdiCount, totalAmount, receiverRfc, receiverName, collectedAmount, pendingAmount } = params
    if (cfdiType === 'INGRESO' && (paymentMethod === 'PUE' || paymentMethod === 'PPD')) {
      const paymentMethodEntry = this.paymentMethodsMap.get(paymentMethod) || { method: paymentMethod, count: 0, total: 0 }
      paymentMethodEntry.count += cfdiCount
      paymentMethodEntry.total += totalAmount
      this.paymentMethodsMap.set(paymentMethod, paymentMethodEntry)
    }

    if (receiverRfc) {
      const topClientEntry = this.topClientsMap.get(receiverRfc) || { rfc: receiverRfc, name: receiverName || receiverRfc, total: 0, cobrado: 0, pendiente: 0 }
      topClientEntry.total += totalAmount
      topClientEntry.cobrado += collectedAmount
      topClientEntry.pendiente += pendingAmount
      if (!topClientEntry.name && receiverName) {
        topClientEntry.name = receiverName
      }
      this.topClientsMap.set(receiverRfc, topClientEntry)
    }
  }

  private processIngresoVigente(params: {
    paymentMethod: string
    salesBucket: string
    subtotalAmount: number
    discountAmount: number
    collectedAmount: number
    pendingAmount: number
    creditNoteAppliedAmount: number
  }) {
    const { paymentMethod, salesBucket, subtotalAmount, discountAmount, collectedAmount, pendingAmount, creditNoteAppliedAmount } = params
    this.ingresosBrutos += subtotalAmount
    this.descuentosYBonificaciones += discountAmount
    this.collectedTotal += collectedAmount
    this.pendingTotal += pendingAmount
    this.creditNoteAppliedTotal += creditNoteAppliedAmount

    if (paymentMethod === 'PUE') {
      this.collectedPueTotal += collectedAmount
    } else if (paymentMethod === 'PPD') {
      this.collectedCrpTotal += collectedAmount
    }

    if (salesBucket === 'NOMINATIVA') {
      this.ventasNominativas += subtotalAmount
    } else if (salesBucket === 'GLOBAL') {
      this.ventasGlobales += subtotalAmount
    } else if (salesBucket === 'INDIVIDUAL') {
      this.operacionesIndividuales += subtotalAmount
    }
  }
}

export async function getDashboardSummaryResponse({
  startDateParam,
  endDateParam,
  companyId,
  companyName,
  rfc,
  monthsToQuery,
  effectiveOrigin,
  issuerFiscalEntityId,
  organizationId
}: SummaryMetricsOptions) { // NOSONAR
if (effectiveOrigin === 'issued') {
  const summaryDateFilter: Prisma.InvoiceIssuedDailySummaryWhereInput = {}
  if (startDateParam && endDateParam) {
    const end = new Date(endDateParam)
    end.setUTCHours(23, 59, 59, 999)
    summaryDateFilter.summaryDate = {
      gte: new Date(startDateParam),
      lte: end
    }
  }

  const summaryRows = await prisma.invoiceIssuedDailySummary.findMany({
    where: {
      organizationId: organizationId,
      issuerFiscalEntityId,
      ...summaryDateFilter
    },
    select: {
      summaryDate: true,
      cfdiType: true,
      satStatus: true,
      receiverRfc: true,
      receiverName: true,
      paymentMethod: true,
      salesBucket: true,
      cfdiCount: true,
      subtotalAmount: true,
      discountAmount: true,
      totalAmount: true,
      ivaTransferredTotal: true,
      ivaWithheldTotal: true,
      isrWithheldTotal: true,
      iepsWithheldTotal: true,
      collectedAmount: true,
      pendingAmount: true,
      overdueAmount: true,
      creditNoteAppliedAmount: true
    }
  })

  const acc = new SummaryAccumulator(monthsToQuery)

  summaryRows.forEach(row => {
    acc.processRow(row)
  })

  const ingresosNetos = Math.max(
    acc.ingresosBrutos - acc.descuentosYBonificaciones - acc.montoNotasCredito - acc.creditNoteAppliedTotal,
    0
  )

  const ratioTransladoANeto = ingresosNetos > 0 ? acc.ivaTrasladado / Math.max(acc.ingresosBrutos, 1) : 0

  const ivaCobradoAproximado = acc.collectedTotal * ratioTransladoANeto
  const ivaPendienteCobroAproximado = acc.pendingTotal * ratioTransladoANeto
  const ivaNetoReales = ingresosNetos * ratioTransladoANeto

  const totalImpuestosRetenidos = acc.ivaRetenido + acc.isrRetenido + acc.iepsRetenido

  const summaryDaysWithCoverage = new Set<string>()
  summaryRows.forEach(row => {
    const d = row.summaryDate instanceof Date ? row.summaryDate : new Date(row.summaryDate)
    summaryDaysWithCoverage.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`)
  })

  let totalRangeDays = 0
  if (startDateParam && endDateParam) {
    const s = new Date(startDateParam)
    const e = new Date(endDateParam)
    s.setUTCHours(0, 0, 0, 0)
    e.setUTCHours(0, 0, 0, 0)
    totalRangeDays = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
  } else {
    totalRangeDays = Math.max(1, summaryDaysWithCoverage.size)
  }

  return NextResponse.json({
    company: { id: companyId, rfc, name: companyName },
    kpis: {
      totalCfdis: acc.totalCfdis,
      totalMonto: acc.totalMonto,
      ventasNominativas: acc.ventasNominativas,
      ventasGlobales: acc.ventasGlobales,
      operacionesIndividuales: acc.operacionesIndividuales,
      ingresosBrutos: acc.ingresosBrutos,
      descuentosYBonificaciones: acc.descuentosYBonificaciones,
      montoNotasCredito: acc.montoNotasCredito,
      ingresosNetosReales: ingresosNetos,
      ingresosCobradosTotal: acc.collectedTotal,
      ingresosCobradosPue: acc.collectedPueTotal,
      ingresosCobradosCrp: acc.collectedCrpTotal,
      ingresosPendientesCobro: acc.pendingTotal, // The summary metrics does not have the granularity for PPD - Payments, relies on Heavy Metrics
      creditNoteAppliedOnPpds: acc.creditNoteAppliedTotal,
      tasaCancelacion: acc.totalCfdis ? Math.round((acc.cancelCount / acc.totalCfdis) * 100) : 0,
      montoCancelado: acc.montoCancelado,
      montoCanceladoEgresos: acc.montoCanceladoEgresos,
      taxes: {
        ivaTrasladado: acc.ivaTrasladado,
        ivaRetenido: acc.ivaRetenido,
        isrRetenido: acc.isrRetenido,
        iepsRetenido: acc.iepsRetenido,
        totalImpuestosRetenidos,
        ivaCobradoTotal: Number(ivaCobradoAproximado.toFixed(2)),
        ivaIngresosNetosReales: Number(ivaNetoReales.toFixed(2)),
        ivaPendienteCobro: Number(ivaPendienteCobroAproximado.toFixed(2)),
        breakdown: {
          tasa16: { base: 0, tax: 0 },
          tasa8: { base: 0, tax: 0 },
          tasa0: { base: 0, tax: 0 },
          exento: { base: 0, tax: 0 }
        },
        heavyMetricsEstimated: summaryRows.length > 0
      }
    },
    byType: Array.from(acc.byTypeMap.values()),
    bySatStatus: Array.from(acc.bySatStatusMap.values()),
    monthly: monthsToQuery.map(start => {
      const monthKey = `${start.getUTCFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
      return acc.monthMap.get(monthKey) || {
        label: `${start.toLocaleString('es-MX', { month: 'short', timeZone: 'UTC' })} ${start.getUTCFullYear()}`,
        count: 0,
        total: 0,
        taxes: {
          ivaTrasladado: 0,
          ivaRetenido: 0,
          isrRetenido: 0,
          iepsRetenido: 0
        }
      }
    }),
    topClients: Array.from(acc.topClientsMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    topProducts: [],
    paymentMethods: Array.from(acc.paymentMethodsMap.values()),
    meta: {
      heavyMetricsIncluded: false,
      heavyMetricsFromSummary: summaryRows.length > 0,
      summaryCoverage: {
        days: summaryDaysWithCoverage.size,
        totalDays: totalRangeDays,
        stale: summaryDaysWithCoverage.size < totalRangeDays
      },
      source: 'summary'
    }
  })
}


}

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type ProviderInvoiceSourceRecord = {
  id: string
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  receiver_rfc: string
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  payment_method: string | null
  currency: string | null
  total: unknown
}

type ProviderPaymentSourceRecord = {
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  receiver_rfc: string
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  payment_links_json: unknown
}

type ProviderPersistedPaymentLink = {
  relatedUuid?: string
  paymentUuid?: string
  paymentDate?: string
  paymentSeries?: string | null
  paymentFolio?: string | null
  montoPagado?: number
  montoTotalPagos?: number
  monedaPago?: string
  equivalenciaDR?: number
  numParcialidad?: number
  impSaldoAnt?: number
  impSaldoInsoluto?: number
}

type InvoicePaymentDetail = {
  relatedUuid: string
  paymentUuid: string
  paymentDate: string
  paymentSeries: string
  paymentFolio: string
  amountPaidRaw: number
  amountPaidNormalized: number
  totalPaymentAmount: number
  paymentCurrency: string
  equivalenciaDR: number
  partialityNumber: number
  previousBalance: number
  outstandingBalanceFromRep: number
  paymentSource: 'REP'
}

type PaymentSummaryInvoice = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  paymentMethod: string
  currency: string
  total: number
  totalPaid: number
  outstandingBalance: number
  payments: InvoicePaymentDetail[]
}

export type PaymentPeriodPaidDrilldownRow = {
  paymentDate: string | null
  invoiceUuid: string
  paymentUuid: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  series: string
  folio: string
  paymentMethod: string
  paymentSource: 'PUE' | 'REP'
  partialityNumber: number
  amountPaid: number
  previousBalance: number
  outstandingBalance: number
  currency: string
}

export type PaymentOutstandingDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  issuanceDate: string | null
  paymentMethod: string
  currency: string
  total: number
  totalPaid: number
  outstandingBalance: number
}

export type PaymentAgingBucketEntry = {
  bucket: string
  amount: number
  count: number
}

export type PaymentAgingDrilldownRow = PaymentOutstandingDrilldownRow & {
  ageDays: number
  ageBucket: string
}

export type PaymentBalancePeriodSummary = {
  totalPaidInPeriod: number
  outstandingBalanceTotal: number
  agingOutstandingTotal: number
  agingBreakdown: PaymentAgingBucketEntry[]
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null

  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseDate(value: Date | string | null | undefined) {
  if (!value) return null

  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isDateWithinRange(dateValue: Date | string | null | undefined, startDate?: Date | null, endDate?: Date | null) {
  const parsed = parseDate(dateValue)
  if (!parsed) {
    return false
  }

  if (startDate && parsed < startDate) {
    return false
  }

  if (endDate && parsed > endDate) {
    return false
  }

  return true
}

function buildBaseInvoice(record: ProviderInvoiceSourceRecord): PaymentSummaryInvoice {
  return {
    uuid: record.uuid,
    fileName: record.file_name,
    issuerRfc: record.issuer_rfc,
    issuerName: record.issuer_name || record.issuer_rfc,
    receiverRfc: record.receiver_rfc,
    cfdiType: record.cfdi_type,
    series: record.series || '',
    folio: record.folio || '',
    issuanceDate: toIsoString(record.issuance_date),
    paymentMethod: normalizeText(record.payment_method).toUpperCase(),
    currency: normalizeText(record.currency) || 'MXN',
    total: toNumber(record.total),
    totalPaid: 0,
    outstandingBalance: 0,
    payments: []
  }
}

function resolveOutstandingBalance(invoice: PaymentSummaryInvoice) {
  if (invoice.payments.length > 0) {
    const sortedPayments = [...invoice.payments].sort((left, right) => {
      const leftTime = parseDate(left.paymentDate)?.getTime() || 0
      const rightTime = parseDate(right.paymentDate)?.getTime() || 0
      if (leftTime !== rightTime) {
        return leftTime - rightTime
      }

      return left.partialityNumber - right.partialityNumber
    })

    const latestPayment = sortedPayments[sortedPayments.length - 1]
    if (latestPayment.outstandingBalanceFromRep > 0) {
      return latestPayment.outstandingBalanceFromRep
    }
  }

  return Math.max(invoice.total - invoice.totalPaid, 0)
}

function getAgingBucket(ageDays: number) {
  if (ageDays <= 30) return '0 a 30 días'
  if (ageDays <= 60) return '31 a 60 días'
  if (ageDays <= 90) return '61 a 90 días'
  return 'Más de 90 días'
}

function getAgeInDays(issuanceDate: string | null) {
  const parsed = parseDate(issuanceDate)
  if (!parsed) {
    return 0
  }

  const now = new Date()
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const utcIssued = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  const diff = Math.floor((utcToday - utcIssued) / (1000 * 60 * 60 * 24))

  return Math.max(diff, 0)
}

async function queryInvoiceRecords(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  return prisma.$queryRaw<ProviderInvoiceSourceRecord[]>(
    Prisma.sql`
      SELECT
        p.id,
        p.uuid,
        p.file_name,
        p.issuer_rfc,
        p.issuer_name,
        p.receiver_rfc,
        p.cfdi_type,
        p.series,
        p.folio,
        p.issuance_date,
        p.payment_method,
        p.currency,
        p.total
      FROM provider_uploaded_cfdis p
      WHERE p.organization_id = ${params.organizationId}
        AND p.receiver_company_id = ${params.companyId}
        AND p.cfdi_type = 'I'
        AND p.validation_status = 'APPROVED'
        AND (p.sat_estado IS NULL OR p.sat_estado <> 'CANCELADO')
        ${params.startDate ? Prisma.sql`AND p.issuance_date >= ${params.startDate}` : Prisma.empty}
        ${params.endDate ? Prisma.sql`AND p.issuance_date <= ${params.endDate}` : Prisma.empty}
    `
  )
}

async function queryPaymentRecords(params: {
  organizationId: string
  companyId: string
}) {
  return prisma.$queryRaw<ProviderPaymentSourceRecord[]>(
    Prisma.sql`
      SELECT
        p.uuid,
        p.file_name,
        p.issuer_rfc,
        p.issuer_name,
        p.receiver_rfc,
        p.cfdi_type,
        p.series,
        p.folio,
        p.issuance_date,
        p.payment_links_json
      FROM provider_uploaded_cfdis p
      WHERE p.organization_id = ${params.organizationId}
        AND p.receiver_company_id = ${params.companyId}
        AND p.cfdi_type = 'P'
        AND p.validation_status = 'APPROVED'
        AND (p.sat_estado IS NULL OR p.sat_estado <> 'CANCELADO')
    `
  )
}

async function buildPaymentBalanceDetails(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const [invoiceRecords, paymentRecords] = await Promise.all([
    queryInvoiceRecords(params),
    queryPaymentRecords(params)
  ])

  const invoices = invoiceRecords.map(buildBaseInvoice)
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.uuid, invoice] as const))

  paymentRecords.forEach((record) => {
    const paymentLinks = Array.isArray(record.payment_links_json)
      ? (record.payment_links_json as ProviderPersistedPaymentLink[])
      : []

    paymentLinks.forEach((link) => {
      const relatedUuid = normalizeText(link.relatedUuid).toUpperCase()
      if (!relatedUuid) {
        return
      }

      const invoice = invoiceMap.get(relatedUuid)
      if (!invoice) {
        return
      }

      const equivalenciaDR = toNumber(link.equivalenciaDR) || 1
      const amountPaidRaw = toNumber(link.montoPagado)
      const amountPaidNormalized = amountPaidRaw * equivalenciaDR

      invoice.payments.push({
        relatedUuid,
        paymentUuid: normalizeText(link.paymentUuid) || record.uuid,
        paymentDate: normalizeText(link.paymentDate),
        paymentSeries: normalizeText(link.paymentSeries),
        paymentFolio: normalizeText(link.paymentFolio),
        amountPaidRaw,
        amountPaidNormalized,
        totalPaymentAmount: toNumber(link.montoTotalPagos),
        paymentCurrency: normalizeText(link.monedaPago) || invoice.currency,
        equivalenciaDR,
        partialityNumber: Math.trunc(toNumber(link.numParcialidad)) || 1,
        previousBalance: toNumber(link.impSaldoAnt),
        outstandingBalanceFromRep: toNumber(link.impSaldoInsoluto),
        paymentSource: 'REP'
      })
    })
  })

  invoices.forEach((invoice) => {
    if (invoice.paymentMethod === 'PUE') {
      invoice.totalPaid = invoice.total
      invoice.outstandingBalance = 0
      return
    }

    invoice.totalPaid = invoice.payments.reduce((acc, payment) => acc + payment.amountPaidNormalized, 0)
    invoice.outstandingBalance = resolveOutstandingBalance(invoice)
  })

  const paidRows: PaymentPeriodPaidDrilldownRow[] = []
  const outstandingRows: PaymentOutstandingDrilldownRow[] = []
  const agingRows: PaymentAgingDrilldownRow[] = []

  invoices.forEach((invoice) => {
    if (invoice.paymentMethod === 'PUE' && isDateWithinRange(invoice.issuanceDate, params.startDate, params.endDate)) {
      paidRows.push({
        paymentDate: invoice.issuanceDate,
        invoiceUuid: invoice.uuid,
        paymentUuid: invoice.uuid,
        issuerRfc: invoice.issuerRfc,
        issuerName: invoice.issuerName,
        receiverRfc: invoice.receiverRfc,
        series: invoice.series,
        folio: invoice.folio,
        paymentMethod: invoice.paymentMethod,
        paymentSource: 'PUE',
        partialityNumber: 1,
        amountPaid: invoice.total,
        previousBalance: invoice.total,
        outstandingBalance: 0,
        currency: invoice.currency
      })
    }

    invoice.payments.forEach((payment) => {
      if (!isDateWithinRange(payment.paymentDate, params.startDate, params.endDate)) {
        return
      }

      paidRows.push({
        paymentDate: toIsoString(payment.paymentDate),
        invoiceUuid: invoice.uuid,
        paymentUuid: payment.paymentUuid,
        issuerRfc: invoice.issuerRfc,
        issuerName: invoice.issuerName,
        receiverRfc: invoice.receiverRfc,
        series: invoice.series,
        folio: invoice.folio,
        paymentMethod: invoice.paymentMethod,
        paymentSource: 'REP',
        partialityNumber: payment.partialityNumber,
        amountPaid: payment.amountPaidNormalized,
        previousBalance: payment.previousBalance,
        outstandingBalance: payment.outstandingBalanceFromRep,
        currency: invoice.currency
      })
    })

    outstandingRows.push({
      uuid: invoice.uuid,
      fileName: invoice.fileName,
      issuerRfc: invoice.issuerRfc,
      issuerName: invoice.issuerName,
      receiverRfc: invoice.receiverRfc,
      issuanceDate: invoice.issuanceDate,
      paymentMethod: invoice.paymentMethod,
      currency: invoice.currency,
      total: invoice.total,
      totalPaid: invoice.totalPaid,
      outstandingBalance: invoice.outstandingBalance
    })

    if (invoice.outstandingBalance > 0) {
      const ageDays = getAgeInDays(invoice.issuanceDate)
      agingRows.push({
        uuid: invoice.uuid,
        fileName: invoice.fileName,
        issuerRfc: invoice.issuerRfc,
        issuerName: invoice.issuerName,
        receiverRfc: invoice.receiverRfc,
        issuanceDate: invoice.issuanceDate,
        paymentMethod: invoice.paymentMethod,
        currency: invoice.currency,
        total: invoice.total,
        totalPaid: invoice.totalPaid,
        outstandingBalance: invoice.outstandingBalance,
        ageDays,
        ageBucket: getAgingBucket(ageDays)
      })
    }
  })

  const agingBreakdownMap = new Map<string, PaymentAgingBucketEntry>()
  ;['0 a 30 días', '31 a 60 días', '61 a 90 días', 'Más de 90 días'].forEach((bucket) => {
    agingBreakdownMap.set(bucket, {
      bucket,
      amount: 0,
      count: 0
    })
  })

  agingRows.forEach((row) => {
    const bucket = agingBreakdownMap.get(row.ageBucket)
    if (!bucket) {
      return
    }

    bucket.amount += row.outstandingBalance
    bucket.count += 1
  })

  return {
    summary: {
      totalPaidInPeriod: paidRows.reduce((acc, row) => acc + row.amountPaid, 0),
      outstandingBalanceTotal: outstandingRows.reduce((acc, row) => acc + row.outstandingBalance, 0),
      agingOutstandingTotal: agingRows.reduce((acc, row) => acc + row.outstandingBalance, 0),
      agingBreakdown: Array.from(agingBreakdownMap.values())
    } satisfies PaymentBalancePeriodSummary,
    paidRows: paidRows.sort((left, right) => {
      const leftTime = parseDate(left.paymentDate)?.getTime() || 0
      const rightTime = parseDate(right.paymentDate)?.getTime() || 0
      return rightTime - leftTime
    }),
    outstandingRows: outstandingRows.sort((left, right) => {
      const leftTime = parseDate(left.issuanceDate)?.getTime() || 0
      const rightTime = parseDate(right.issuanceDate)?.getTime() || 0
      return rightTime - leftTime
    }),
    agingRows: agingRows.sort((left, right) => {
      if (right.ageDays !== left.ageDays) {
        return right.ageDays - left.ageDays
      }

      const leftTime = parseDate(left.issuanceDate)?.getTime() || 0
      const rightTime = parseDate(right.issuanceDate)?.getTime() || 0
      return rightTime - leftTime
    })
  }
}

export async function getPaymentBalancePeriodSummary(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}): Promise<PaymentBalancePeriodSummary> {
  const result = await buildPaymentBalanceDetails(params)
  return result.summary
}

export async function listPaidInPeriodDrilldown(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const result = await buildPaymentBalanceDetails(params)
  return result.paidRows
}

export async function listOutstandingBalanceDrilldown(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const result = await buildPaymentBalanceDetails(params)
  return result.outstandingRows
}

export async function listAgingBalanceDrilldown(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const result = await buildPaymentBalanceDetails(params)
  return result.agingRows
}

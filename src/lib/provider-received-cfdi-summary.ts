import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type PrismaDelegate = Prisma.TransactionClient | typeof prisma

type ProviderReceivedCfdiSummarySource = {
  organizationId: string
  receiverCompanyId: string | null
  issuanceDate: Date | string | null
  cfdiType: string | null
  satEstado: string | null
  issuerRfc: string | null
  issuerName: string | null
  paymentMethod: string | null
  paymentStatusManual: string | null
  total: unknown
  transferredTaxesTotal: unknown
  withheldTaxesTotal: unknown
  validationStatus?: string | null
}

type ProviderReceivedCfdiSummaryDimension = {
  organizationId: string
  receiverCompanyId: string
  summaryDate: Date
  cfdiType: string
  satEstado: string
  issuerRfc: string
  issuerName: string
  paymentMethod: string
  paymentStatusBucket: string
  cfdiCount: number
  totalAmount: number
  transferredTaxesTotal: number
  withheldTaxesTotal: number
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeUpperText(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function toUtcDateOnly(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value)

  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate()
  ))
}

function resolvePaymentStatusBucket(record: ProviderReceivedCfdiSummarySource) {
  const cfdiType = normalizeUpperText(record.cfdiType)
  if (cfdiType !== 'I') {
    return 'NO_APLICA'
  }

  const manualStatus = normalizeUpperText(record.paymentStatusManual)
  if (manualStatus === 'PAGADO' || manualStatus === 'COMPLETO') {
    return 'PAGADO'
  }

  if (normalizeUpperText(record.paymentMethod) === 'PUE') {
    return 'PAGADO'
  }

  return 'PENDIENTE'
}

function buildProviderReceivedCfdiSummaryDimension(
  record: ProviderReceivedCfdiSummarySource | null | undefined
): ProviderReceivedCfdiSummaryDimension | null {
  if (!record?.receiverCompanyId || !record.issuanceDate) {
    return null
  }

  if (record.validationStatus && normalizeUpperText(record.validationStatus) !== 'APPROVED') {
    return null
  }

  return {
    organizationId: record.organizationId,
    receiverCompanyId: record.receiverCompanyId,
    summaryDate: toUtcDateOnly(record.issuanceDate),
    cfdiType: normalizeUpperText(record.cfdiType) || 'SIN_TIPO',
    satEstado: normalizeUpperText(record.satEstado) || 'SIN_ESTATUS',
    issuerRfc: normalizeUpperText(record.issuerRfc),
    issuerName: normalizeText(record.issuerName),
    paymentMethod: normalizeUpperText(record.paymentMethod),
    paymentStatusBucket: resolvePaymentStatusBucket(record),
    cfdiCount: 1,
    totalAmount: toNumber(record.total),
    transferredTaxesTotal: toNumber(record.transferredTaxesTotal),
    withheldTaxesTotal: toNumber(record.withheldTaxesTotal)
  }
}

async function applyProviderReceivedCfdiSummaryDelta(
  db: PrismaDelegate,
  record: ProviderReceivedCfdiSummarySource | null | undefined,
  delta: 1 | -1
) {
  const dimension = buildProviderReceivedCfdiSummaryDimension(record)
  if (!dimension) {
    return
  }

  await db.$executeRaw(
    Prisma.sql`
      INSERT INTO provider_received_cfdi_daily_summary (
        id,
        organization_id,
        receiver_company_id,
        summary_date,
        cfdi_type,
        sat_estado,
        issuer_rfc,
        issuer_name,
        payment_method,
        payment_status_bucket,
        cfdi_count,
        total_amount,
        transferred_taxes_total,
        withheld_taxes_total,
        created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${dimension.organizationId},
        ${dimension.receiverCompanyId},
        ${dimension.summaryDate},
        ${dimension.cfdiType},
        ${dimension.satEstado},
        ${dimension.issuerRfc},
        ${dimension.issuerName},
        ${dimension.paymentMethod},
        ${dimension.paymentStatusBucket},
        ${dimension.cfdiCount * delta},
        ${dimension.totalAmount * delta},
        ${dimension.transferredTaxesTotal * delta},
        ${dimension.withheldTaxesTotal * delta},
        NOW(),
        NOW()
      )
      ON CONFLICT (
        organization_id,
        receiver_company_id,
        summary_date,
        cfdi_type,
        sat_estado,
        issuer_rfc,
        payment_method,
        payment_status_bucket
      )
      DO UPDATE SET
        issuer_name = EXCLUDED.issuer_name,
        cfdi_count = provider_received_cfdi_daily_summary.cfdi_count + EXCLUDED.cfdi_count,
        total_amount = provider_received_cfdi_daily_summary.total_amount + EXCLUDED.total_amount,
        transferred_taxes_total = provider_received_cfdi_daily_summary.transferred_taxes_total + EXCLUDED.transferred_taxes_total,
        withheld_taxes_total = provider_received_cfdi_daily_summary.withheld_taxes_total + EXCLUDED.withheld_taxes_total,
        updated_at = NOW()
    `
  )

  if (delta < 0) {
    await db.$executeRaw(
      Prisma.sql`
        DELETE FROM provider_received_cfdi_daily_summary
        WHERE organization_id = ${dimension.organizationId}
          AND receiver_company_id = ${dimension.receiverCompanyId}
          AND summary_date = ${dimension.summaryDate}
          AND cfdi_type = ${dimension.cfdiType}
          AND sat_estado = ${dimension.satEstado}
          AND issuer_rfc = ${dimension.issuerRfc}
          AND payment_method = ${dimension.paymentMethod}
          AND payment_status_bucket = ${dimension.paymentStatusBucket}
          AND cfdi_count <= 0
      `
    )
  }
}

export async function syncProviderReceivedCfdiSummaryRecordChange(params: {
  db?: PrismaDelegate
  previousRecord?: ProviderReceivedCfdiSummarySource | null
  nextRecord?: ProviderReceivedCfdiSummarySource | null
}) {
  const db = params.db || prisma

  if (params.previousRecord) {
    await applyProviderReceivedCfdiSummaryDelta(db, params.previousRecord, -1)
  }

  if (params.nextRecord) {
    await applyProviderReceivedCfdiSummaryDelta(db, params.nextRecord, 1)
  }
}

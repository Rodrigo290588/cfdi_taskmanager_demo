import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getStoredProviderXmlForSatMonitoring } from '@/lib/provider-cfdi-storage'
import { syncProviderReceivedCfdiSummaryRecordChange } from '@/lib/provider-received-cfdi-summary'
import { queryCfdiStatusWithSat } from '@/services/sat-cfdi-status.service'

type PostLoadCancellationCandidate = {
  id: string
}

type ProviderUploadedCfdiSatRecord = {
  id: string
  organization_id: string
  receiver_company_id: string | null
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  total: unknown
  validation_status: string
  sat_estado: string | null
  sat_initial_estado: string | null
  sat_es_cancelable: string | null
  sat_estatus_cancelacion: string | null
  sat_status_changed_at: Date | string | null
  sat_cancellation_detected_at: Date | string | null
  payment_method: string | null
  payment_status_manual: string | null
  transferred_taxes_total: unknown
  withheld_taxes_total: unknown
}

export type PostLoadCancellationSummary = {
  cancellationCount: number
  cancellationAmount: number
  supplierCount: number
}

export type PostLoadCancellationDrilldownRow = {
  detected_at: Date | string | null
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  total: unknown
  sat_initial_estado: string | null
  sat_estado: string | null
  sat_estatus_cancelacion: string | null
  sat_es_cancelable: string | null
}

export type PostLoadCancellationSyncResult = {
  scannedCandidates: number
  checkedCandidates: number
  detectedCancelled: number
  updatedStatuses: number
  errors: number
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function buildNightlySatValidationMessage(nextState: string) {
  return `Monitoreo nocturno SAT: ${nextState || 'SIN_ESTATUS'}`
}

async function listPostLoadCancellationCandidates(limit: number) {
  return prisma.$queryRaw<PostLoadCancellationCandidate[]>(Prisma.sql`
    SELECT id
    FROM provider_uploaded_cfdis
    WHERE validation_status = 'APPROVED'
      AND receiver_company_id IS NOT NULL
      AND cfdi_type IN ('I', 'E', 'T')
      AND COALESCE(NULLIF(TRIM(sat_initial_estado), ''), NULLIF(TRIM(sat_estado), ''), 'SIN_ESTATUS') = 'VIGENTE'
      AND COALESCE(NULLIF(TRIM(sat_estado), ''), 'SIN_ESTATUS') <> 'CANCELADO'
      AND sat_cancellation_detected_at IS NULL
    ORDER BY COALESCE(sat_status_last_checked_at, last_validated_at, created_at) ASC NULLS FIRST
    LIMIT ${limit}
  `)
}

async function getProviderUploadedCfdiSatRecord(
  tx: Prisma.TransactionClient,
  recordId: string
) {
  const records = await tx.$queryRaw<ProviderUploadedCfdiSatRecord[]>(Prisma.sql`
    SELECT
      id,
      organization_id,
      receiver_company_id,
      uuid,
      file_name,
      issuer_rfc,
      issuer_name,
      cfdi_type,
      series,
      folio,
      issuance_date,
      total,
      validation_status,
      sat_estado,
      sat_initial_estado,
      sat_es_cancelable,
      sat_estatus_cancelacion,
      sat_status_changed_at,
      sat_cancellation_detected_at,
      payment_method,
      payment_status_manual,
      transferred_taxes_total,
      withheld_taxes_total
    FROM provider_uploaded_cfdis
    WHERE id = ${recordId}
    LIMIT 1
  `)

  return records[0] || null
}

async function processPostLoadCancellationCandidate(recordId: string) {
  const monitoringRecord = await getStoredProviderXmlForSatMonitoring({ recordId })
  if (!monitoringRecord) {
    return {
      checked: false,
      detectedCancelled: false,
      updatedStatus: false
    }
  }

  const satStatus = await queryCfdiStatusWithSat({
    fileName: monitoringRecord.fileName,
    xml: monitoringRecord.xmlContent
  })

  const checkedAt = new Date()
  const nextState = normalizeUpperText(satStatus.estado) || 'SIN_ESTATUS'

  return prisma.$transaction(async tx => {
    const currentRecord = await getProviderUploadedCfdiSatRecord(tx, recordId)
    if (!currentRecord) {
      return {
        checked: false,
        detectedCancelled: false,
        updatedStatus: false
      }
    }

    const previousState = normalizeUpperText(currentRecord.sat_estado) || 'SIN_ESTATUS'
    const initialState = normalizeUpperText(currentRecord.sat_initial_estado || previousState)
    const stateChanged = previousState !== nextState
    const detectedCancelled = initialState === 'VIGENTE' && previousState !== 'CANCELADO' && nextState === 'CANCELADO'
    const nextStatusChangedAt = stateChanged ? checkedAt : currentRecord.sat_status_changed_at
    const nextCancellationDetectedAt = detectedCancelled
      ? (currentRecord.sat_cancellation_detected_at || checkedAt)
      : currentRecord.sat_cancellation_detected_at

    await tx.$executeRaw(
      Prisma.sql`
        UPDATE provider_uploaded_cfdis
        SET
          validation_sat = ${buildNightlySatValidationMessage(nextState)},
          sat_codigo_estatus = ${satStatus.codigoEstatus || null},
          sat_estado = ${nextState},
          sat_initial_estado = ${initialState || nextState},
          sat_es_cancelable = ${satStatus.esCancelable || null},
          sat_estatus_cancelacion = ${satStatus.estatusCancelacion || null},
          sat_validacion_efos = ${satStatus.validacionEFOS || null},
          sat_status_last_checked_at = ${checkedAt},
          sat_status_changed_at = ${nextStatusChangedAt ? new Date(nextStatusChangedAt) : null},
          sat_cancellation_detected_at = ${nextCancellationDetectedAt ? new Date(nextCancellationDetectedAt) : null},
          last_validated_at = ${checkedAt},
          updated_at = NOW()
        WHERE id = ${recordId}
      `
    )

    if (stateChanged) {
      await syncProviderReceivedCfdiSummaryRecordChange({
        db: tx,
        previousRecord: {
          organizationId: currentRecord.organization_id,
          receiverCompanyId: currentRecord.receiver_company_id,
          issuanceDate: currentRecord.issuance_date,
          cfdiType: currentRecord.cfdi_type,
          satEstado: currentRecord.sat_estado,
          issuerRfc: currentRecord.issuer_rfc,
          issuerName: currentRecord.issuer_name,
          paymentMethod: currentRecord.payment_method,
          paymentStatusManual: currentRecord.payment_status_manual,
          total: currentRecord.total,
          transferredTaxesTotal: currentRecord.transferred_taxes_total,
          withheldTaxesTotal: currentRecord.withheld_taxes_total,
          validationStatus: currentRecord.validation_status
        },
        nextRecord: {
          organizationId: currentRecord.organization_id,
          receiverCompanyId: currentRecord.receiver_company_id,
          issuanceDate: currentRecord.issuance_date,
          cfdiType: currentRecord.cfdi_type,
          satEstado: nextState,
          issuerRfc: currentRecord.issuer_rfc,
          issuerName: currentRecord.issuer_name,
          paymentMethod: currentRecord.payment_method,
          paymentStatusManual: currentRecord.payment_status_manual,
          total: currentRecord.total,
          transferredTaxesTotal: currentRecord.transferred_taxes_total,
          withheldTaxesTotal: currentRecord.withheld_taxes_total,
          validationStatus: currentRecord.validation_status
        }
      })
    }

    return {
      checked: true,
      detectedCancelled,
      updatedStatus: stateChanged
    }
  })
}

export async function syncProviderPostLoadCancellationAlerts() {
  const batchSize = clamp(Number(process.env.PROVIDER_SAT_CANCELLATION_SCAN_BATCH_SIZE || '200'), 10, 1000)
  const concurrency = clamp(Number(process.env.PROVIDER_SAT_CANCELLATION_SCAN_CONCURRENCY || '3'), 1, 5)
  const candidates = await listPostLoadCancellationCandidates(batchSize)

  const result: PostLoadCancellationSyncResult = {
    scannedCandidates: candidates.length,
    checkedCandidates: 0,
    detectedCancelled: 0,
    updatedStatuses: 0,
    errors: 0
  }

  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    const slice = candidates.slice(offset, offset + concurrency)
    const sliceResults = await Promise.all(
      slice.map(async candidate => {
        try {
          return await processPostLoadCancellationCandidate(candidate.id)
        } catch (error) {
          console.error('[ProviderPostLoadCancellationAlerts] Error procesando CFDI:', candidate.id, error)
          return null
        }
      })
    )

    for (const sliceResult of sliceResults) {
      if (!sliceResult) {
        result.errors += 1
        continue
      }

      if (sliceResult.checked) {
        result.checkedCandidates += 1
      }

      if (sliceResult.detectedCancelled) {
        result.detectedCancelled += 1
      }

      if (sliceResult.updatedStatus) {
        result.updatedStatuses += 1
      }
    }
  }

  return result
}

export async function getPostLoadCancellationSummary(params: {
  organizationId: string
  companyId: string
}) {
  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const rows = await prisma.$queryRaw<Array<{
    cancellation_count: number
    cancellation_amount: unknown
    supplier_count: number
  }>>(Prisma.sql`
    SELECT
      COUNT(*)::int AS cancellation_count,
      COALESCE(SUM(total), 0) AS cancellation_amount,
      COUNT(DISTINCT issuer_rfc)::int AS supplier_count
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type IN ('I', 'E', 'T')
      AND COALESCE(NULLIF(TRIM(sat_initial_estado), ''), NULLIF(TRIM(sat_estado), ''), 'SIN_ESTATUS') = 'VIGENTE'
      AND COALESCE(NULLIF(TRIM(sat_estado), ''), 'SIN_ESTATUS') = 'CANCELADO'
      AND sat_cancellation_detected_at >= ${cutoffDate}
  `)

  const row = rows[0]

  return {
    cancellationCount: Number(row?.cancellation_count || 0),
    cancellationAmount: toNumber(row?.cancellation_amount),
    supplierCount: Number(row?.supplier_count || 0)
  } satisfies PostLoadCancellationSummary
}

export async function listPostLoadCancellationAlerts(params: {
  organizationId: string
  companyId: string
}) {
  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  return prisma.$queryRaw<PostLoadCancellationDrilldownRow[]>(Prisma.sql`
    SELECT
      sat_cancellation_detected_at AS detected_at,
      uuid,
      file_name,
      issuer_rfc,
      issuer_name,
      cfdi_type,
      series,
      folio,
      issuance_date,
      total,
      sat_initial_estado,
      sat_estado,
      sat_estatus_cancelacion,
      sat_es_cancelable
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type IN ('I', 'E', 'T')
      AND COALESCE(NULLIF(TRIM(sat_initial_estado), ''), NULLIF(TRIM(sat_estado), ''), 'SIN_ESTATUS') = 'VIGENTE'
      AND COALESCE(NULLIF(TRIM(sat_estado), ''), 'SIN_ESTATUS') = 'CANCELADO'
      AND sat_cancellation_detected_at >= ${cutoffDate}
    ORDER BY sat_cancellation_detected_at DESC NULLS LAST, issuance_date DESC NULLS LAST, uuid DESC
  `)
}

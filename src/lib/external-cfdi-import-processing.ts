import { Prisma } from '@prisma/client'
import { createInvoiceFromXml } from '@/lib/invoice-import'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import { buildProviderReportFromXmlCandidates } from '@/lib/provider-cfdi-report'
import { syncProviderPaymentComplianceBlocks } from '@/lib/provider-payment-compliance'
import { persistProviderAcceptedCfdis } from '@/lib/provider-cfdi-storage'
import { prisma } from '@/lib/prisma'
import { getCfdiImportDispatchQueue, getCfdiImportItemQueue } from '@/lib/queue'

type ImportRunStatus =
  | 'QUEUED'
  | 'DISPATCHING'
  | 'PROCESSING'
  | 'PROCESSING_WITH_EXTERNAL_WAIT'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELLED'

type ImportRunItemStatus =
  | 'QUEUED'
  | 'PREPARING'
  | 'PREPARED'
  | 'VALIDATING_INTERNAL'
  | 'WAITING_EXTERNAL_VALIDATION'
  | 'VALIDATING_EXTERNAL'
  | 'VALIDATED'
  | 'PERSISTING'
  | 'PERSISTED'
  | 'SKIPPED'
  | 'FAILED'
  | 'CANCELLED'

type ImportRunClassificationResult = 'EMITTED' | 'RECEIVED' | 'BOTH' | 'NONE'
type ImportRunItemDirection = 'EMITTED' | 'RECEIVED'
type ValidationBucket = 'VALIDO' | 'INVALIDO'

type ImportRunRow = {
  id: string
  organizationId: string
  status: ImportRunStatus
}

type ImportRunItemRow = {
  id: string
  importRunId: string
  organizationId: string
  fileName: string
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
  receiverCompanyId: string | null
  classificationResult: ImportRunClassificationResult
  direction: ImportRunItemDirection | null
  status: ImportRunItemStatus
  validationStatus: string | null
  validationBucket: ValidationBucket | null
  errorCode: string | null
  errorMessage: string | null
  emittedInvoiceId: string | null
  receivedProviderUploadedCfdiId: string | null
}

type ImportRunItemBlobRow = {
  ciphertext: string
  iv: string
  authTag: string
  algorithm: string
}

type OrganizationCompanyRow = {
  id: string
  rfc: string
}

type DuplicateImportRunItemRow = {
  id: string
  status: ImportRunItemStatus
  emittedInvoiceId: string | null
  receivedProviderUploadedCfdiId: string | null
}

type RunCounterDelta = {
  processedItems: number
  createdEmitted: number
  createdReceived: number
  skippedItems: number
  errorItems: number
  waitingExternalValidationItems: number
}

type PersistResult = {
  status: Extract<ImportRunItemStatus, 'PERSISTED' | 'SKIPPED' | 'FAILED' | 'WAITING_EXTERNAL_VALIDATION'>
  emittedInvoiceId: string | null
  receivedProviderUploadedCfdiId: string | null
  validationStatus: string | null
  validationBucket: ValidationBucket | null
  errorCode: string | null
  errorMessage: string | null
  counters: RunCounterDelta
}

const TERMINAL_ITEM_STATUSES: ImportRunItemStatus[] = ['PERSISTED', 'SKIPPED', 'FAILED', 'CANCELLED']
const PROCESSABLE_ITEM_STATUSES: ImportRunItemStatus[] = ['QUEUED', 'PREPARING', 'PREPARED', 'PERSISTING']

function normalizeRfc(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

function isTerminalItemStatus(status: ImportRunItemStatus) {
  return TERMINAL_ITEM_STATUSES.includes(status)
}

function buildPersistCounters(result: PersistResult['status'], createdEmitted: number, createdReceived: number): RunCounterDelta {
  return {
    processedItems: 1,
    createdEmitted,
    createdReceived,
    skippedItems: result === 'SKIPPED' ? 1 : 0,
    errorItems: result === 'FAILED' ? 1 : 0,
    waitingExternalValidationItems: result === 'WAITING_EXTERNAL_VALIDATION' ? 1 : 0
  }
}

function toSafeNumber(value: bigint | number | null | undefined) {
  if (typeof value === 'bigint') {
    return Number(value)
  }

  return Number(value ?? 0)
}

async function getImportRunById(importRunId: string) {
  const rows = await prisma.$queryRaw<ImportRunRow[]>(Prisma.sql`
    SELECT
      id,
      organization_id AS "organizationId",
      status
    FROM import_runs
    WHERE id = ${importRunId}
    LIMIT 1
  `)

  return rows[0] || null
}

async function getImportRunItemById(itemId: string) {
  const rows = await prisma.$queryRaw<ImportRunItemRow[]>(Prisma.sql`
    SELECT
      id,
      import_run_id AS "importRunId",
      organization_id AS "organizationId",
      file_name AS "fileName",
      uuid,
      issuer_rfc AS "issuerRfc",
      receiver_rfc AS "receiverRfc",
      receiver_company_id AS "receiverCompanyId",
      classification_result AS "classificationResult",
      direction,
      status,
      validation_status AS "validationStatus",
      validation_bucket AS "validationBucket",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      emitted_invoice_id AS "emittedInvoiceId",
      received_provider_uploaded_cfdi_id AS "receivedProviderUploadedCfdiId"
    FROM import_run_items
    WHERE id = ${itemId}
    LIMIT 1
  `)

  return rows[0] || null
}

async function getImportRunItemXmlById(itemId: string) {
  const rows = await prisma.$queryRaw<ImportRunItemBlobRow[]>(Prisma.sql`
    SELECT
      xml_ciphertext AS ciphertext,
      xml_iv AS iv,
      xml_auth_tag AS "authTag",
      xml_encryption_alg AS algorithm
    FROM import_run_item_blobs
    WHERE import_run_item_id = ${itemId}
    LIMIT 1
  `)

  const blob = rows[0]

  if (!blob) {
    throw new Error(`No se encontró el blob cifrado del item ${itemId}`)
  }

  return decryptInvoiceXmlContent({
    ciphertext: blob.ciphertext,
    iv: blob.iv,
    authTag: blob.authTag,
    algorithm: blob.algorithm
  })
}

async function getOrganizationCompaniesByRfc(organizationId: string) {
  const rows = await prisma.$queryRaw<OrganizationCompanyRow[]>(Prisma.sql`
    SELECT DISTINCT
      c.id,
      c.rfc
    FROM company_access ca
    INNER JOIN companies c
      ON c.id = ca.company_id
    WHERE ca.organization_id = ${organizationId}
  `)

  return new Map(rows.map(company => [normalizeRfc(company.rfc), company]))
}

async function findDuplicateImportRunItem(params: {
  itemId: string
  organizationId: string
  uuid: string
  direction: ImportRunItemDirection
}) {
  const rows = await prisma.$queryRaw<DuplicateImportRunItemRow[]>(Prisma.sql`
    SELECT
      id,
      status,
      emitted_invoice_id AS "emittedInvoiceId",
      received_provider_uploaded_cfdi_id AS "receivedProviderUploadedCfdiId"
    FROM import_run_items
    WHERE organization_id = ${params.organizationId}
      AND uuid = ${params.uuid}
      AND direction = CAST(${params.direction} AS "import_run_item_direction")
      AND id <> ${params.itemId}
    ORDER BY created_at ASC
    LIMIT 1
  `)

  return rows[0] || null
}

async function releaseRetryableDuplicateImportRunItem(itemId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM import_run_item_blobs
      WHERE import_run_item_id = ${itemId}
    `)

    await tx.$executeRaw(Prisma.sql`
      DELETE FROM import_run_items
      WHERE id = ${itemId}
        AND status IN ('FAILED', 'CANCELLED')
        AND emitted_invoice_id IS NULL
        AND received_provider_uploaded_cfdi_id IS NULL
    `)
  })
}

function resolveClassification(params: {
  issuerRfc: string | null
  receiverRfc: string | null
  companiesByRfc: Map<string, OrganizationCompanyRow>
}): {
  classificationResult: ImportRunClassificationResult
  direction: ImportRunItemDirection | null
  receiverCompanyId: string | null
  errorCode: string | null
  errorMessage: string | null
  status: Extract<ImportRunItemStatus, 'PREPARED' | 'FAILED'>
} {
  const issuerCompany = params.companiesByRfc.get(normalizeRfc(params.issuerRfc))
  const receiverCompany = params.companiesByRfc.get(normalizeRfc(params.receiverRfc))

  if (issuerCompany && receiverCompany) {
    return {
      classificationResult: 'BOTH',
      direction: null,
      receiverCompanyId: receiverCompany.id,
      errorCode: null,
      errorMessage: null,
      status: 'PREPARED'
    }
  }

  if (issuerCompany) {
    return {
      classificationResult: 'EMITTED',
      direction: 'EMITTED',
      receiverCompanyId: null,
      errorCode: null,
      errorMessage: null,
      status: 'PREPARED'
    }
  }

  if (receiverCompany) {
    return {
      classificationResult: 'RECEIVED',
      direction: 'RECEIVED',
      receiverCompanyId: receiverCompany.id,
      errorCode: null,
      errorMessage: null,
      status: 'PREPARED'
    }
  }

  return {
    classificationResult: 'NONE',
    direction: null,
    receiverCompanyId: null,
    errorCode: 'RFC_NOT_REGISTERED',
    errorMessage: 'El XML no corresponde a una empresa registrada del tenant',
    status: 'FAILED'
  }
}

async function updateRunCounters(importRunId: string, counters: RunCounterDelta) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE import_runs
    SET
      processed_items = processed_items + ${counters.processedItems},
      created_emitted = created_emitted + ${counters.createdEmitted},
      created_received = created_received + ${counters.createdReceived},
      skipped_items = skipped_items + ${counters.skippedItems},
      error_items = error_items + ${counters.errorItems},
      waiting_external_validation_items = waiting_external_validation_items + ${counters.waitingExternalValidationItems},
      updated_at = NOW()
    WHERE id = ${importRunId}
  `)
}

async function refreshImportRunStatus(importRunId: string) {
  const rows = await prisma.$queryRaw<Array<{
    total_items: bigint
    terminal_items: bigint
    failed_items: bigint
    waiting_items: bigint
  }>>(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total_items,
      COUNT(*) FILTER (
        WHERE status IN ('PERSISTED', 'SKIPPED', 'FAILED', 'CANCELLED')
      )::bigint AS terminal_items,
      COUNT(*) FILTER (
        WHERE status = 'FAILED'
      )::bigint AS failed_items,
      COUNT(*) FILTER (
        WHERE status = 'WAITING_EXTERNAL_VALIDATION'
      )::bigint AS waiting_items
    FROM import_run_items
    WHERE import_run_id = ${importRunId}
  `)

  const counters = rows[0]
  const totalItems = toSafeNumber(counters?.total_items)
  const terminalItems = toSafeNumber(counters?.terminal_items)
  const failedItems = toSafeNumber(counters?.failed_items)
  const waitingItems = toSafeNumber(counters?.waiting_items)

  let nextStatus: ImportRunStatus = 'PROCESSING'
  let finishedAtSql = Prisma.sql`NULL`

  if (totalItems > 0 && terminalItems >= totalItems) {
    nextStatus = failedItems > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
    finishedAtSql = Prisma.sql`NOW()`
  } else if (waitingItems > 0) {
    nextStatus = 'PROCESSING_WITH_EXTERNAL_WAIT'
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE import_runs
    SET
      status = CAST(${nextStatus} AS "import_run_status"),
      finished_at = ${finishedAtSql},
      updated_at = NOW()
    WHERE id = ${importRunId}
      AND status <> 'CANCELLED'
  `)
}

async function finalizeImportRunItem(
  itemId: string,
  importRunId: string,
  result: PersistResult
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE import_run_items
      SET
        status = CAST(${result.status} AS "import_run_item_status"),
        emitted_invoice_id = ${result.emittedInvoiceId},
        received_provider_uploaded_cfdi_id = ${result.receivedProviderUploadedCfdiId},
        validation_status = ${result.validationStatus},
        validation_bucket = CAST(${result.validationBucket} AS "validation_bucket"),
        error_code = ${result.errorCode},
        error_message = ${result.errorMessage},
        processing_finished_at = NOW(),
        updated_at = NOW()
      WHERE id = ${itemId}
    `)
  })

  await updateRunCounters(importRunId, result.counters)
  await refreshImportRunStatus(importRunId)
}

async function classifyPreparedImportRunItem(item: ImportRunItemRow) {
  if (item.status !== 'QUEUED' && item.status !== 'PREPARING') {
    return item
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE import_run_items
    SET
      status = 'PREPARING',
      attempt_count_internal = attempt_count_internal + 1,
      processing_started_at = COALESCE(processing_started_at, NOW()),
      updated_at = NOW()
    WHERE id = ${item.id}
      AND status IN ('QUEUED', 'PREPARING')
  `)

  const companiesByRfc = await getOrganizationCompaniesByRfc(item.organizationId)
  const classification = resolveClassification({
    issuerRfc: item.issuerRfc,
    receiverRfc: item.receiverRfc,
    companiesByRfc
  })

  if (classification.direction && item.uuid) {
    const duplicate = await findDuplicateImportRunItem({
      itemId: item.id,
      organizationId: item.organizationId,
      uuid: item.uuid,
      direction: classification.direction
    })

    if (duplicate?.status === 'PERSISTED' || duplicate?.emittedInvoiceId || duplicate?.receivedProviderUploadedCfdiId) {
      await finalizeImportRunItem(item.id, item.importRunId, {
        status: 'SKIPPED',
        emittedInvoiceId: null,
        receivedProviderUploadedCfdiId: null,
        validationStatus: null,
        validationBucket: null,
        errorCode: 'DUPLICATE_UUID',
        errorMessage: `El CFDI ${item.uuid} ya existe para la dirección ${classification.direction}`,
        counters: buildPersistCounters('SKIPPED', 0, 0)
      })

      const skipped = await getImportRunItemById(item.id)

      if (!skipped) {
        throw new Error(`No se encontró import_run_item ${item.id} después de marcar duplicado`)
      }

      return skipped
    }

    if (duplicate && (duplicate.status === 'FAILED' || duplicate.status === 'CANCELLED')) {
      await releaseRetryableDuplicateImportRunItem(duplicate.id)
    }
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE import_run_items
    SET
      classification_result = CAST(${classification.classificationResult} AS "import_run_classification_result"),
      direction = CAST(${classification.direction} AS "import_run_item_direction"),
      receiver_company_id = ${classification.receiverCompanyId},
      status = CAST(${classification.status} AS "import_run_item_status"),
      error_code = ${classification.errorCode},
      error_message = ${classification.errorMessage},
      updated_at = NOW()
    WHERE id = ${item.id}
  `)

  const refreshed = await getImportRunItemById(item.id)

  if (!refreshed) {
    throw new Error(`No se encontró import_run_item ${item.id} después de clasificar`)
  }

  if (classification.status === 'FAILED') {
    await finalizeImportRunItem(refreshed.id, refreshed.importRunId, {
      status: 'FAILED',
      emittedInvoiceId: null,
      receivedProviderUploadedCfdiId: null,
      validationStatus: null,
      validationBucket: null,
      errorCode: classification.errorCode,
      errorMessage: classification.errorMessage,
      counters: buildPersistCounters('FAILED', 0, 0)
    })
  }

  return refreshed
}

async function resolveReceivedStorageContext(item: ImportRunItemRow) {
  if (!item.receiverCompanyId) {
    throw new Error('No se pudo resolver receiverCompanyId para el CFDI recibido')
  }

  if (!item.issuerRfc) {
    throw new Error('No se pudo resolver issuerRfc para el CFDI recibido')
  }

  const company = await prisma.company.findUnique({
    where: { id: item.receiverCompanyId },
    select: {
      id: true,
      rfc: true,
      businessName: true
    }
  })

  if (!company) {
    throw new Error(`No se encontró la empresa receptora ${item.receiverCompanyId}`)
  }

  const member = await prisma.member.findFirst({
    where: {
      organizationId: item.organizationId,
      status: 'APPROVED',
      companyAccesses: {
        some: {
          companyId: item.receiverCompanyId
        }
      }
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true
    }
  })

  if (!member) {
    throw new Error(`No se encontró una membresía aprobada con acceso a la empresa receptora ${company.rfc}`)
  }

  return {
    uploadedByUserId: member.userId,
    context: {
      organizationId: item.organizationId,
      memberId: member.id,
      providerRfc: normalizeRfc(item.issuerRfc),
      providerName: null,
      allowedCompanies: [
        {
          id: company.id,
          rfc: company.rfc,
          businessName: company.businessName
        }
      ],
      granularPermissions: {
        providerBusinessRulePueForma99: true,
        providerBusinessRuleResicoRetention: true,
        providerBusinessRuleObjetoImpVsIva: true
      }
    }
  }
}

async function persistReceivedImportRunItem(item: ImportRunItemRow, xmlContent: string) {
  const normalizedUuid = (item.uuid || '').trim().toUpperCase()

  if (!normalizedUuid) {
    return {
      storageId: null,
      created: false,
      validationStatus: 'REJECTED',
      validationBucket: 'INVALIDO' as ValidationBucket,
      errorCode: 'MISSING_UUID',
      errorMessage: 'El CFDI recibido no contiene UUID timbrado'
    }
  }

  const existingRecord = await prisma.providerUploadedCfdi.findUnique({
    where: {
      organizationId_uuid: {
        organizationId: item.organizationId,
        uuid: normalizedUuid
      }
    },
    select: {
      id: true
    }
  })

  if (existingRecord) {
    return {
      storageId: existingRecord.id,
      created: false,
      validationStatus: 'APPROVED',
      validationBucket: 'VALIDO' as ValidationBucket,
      errorCode: null,
      errorMessage: null
    }
  }

  const receivedContext = await resolveReceivedStorageContext(item)
  const report = await buildProviderReportFromXmlCandidates({
    candidates: [
      {
        name: item.fileName,
        xml: xmlContent
      }
    ],
    context: receivedContext.context,
    uploadedAt: new Date()
  })

  if (report.acceptedRecords.length === 0) {
    return {
      storageId: null,
      created: false,
      validationStatus: 'REJECTED',
      validationBucket: 'INVALIDO' as ValidationBucket,
      errorCode: 'VALIDATION_FAILED',
      errorMessage: report.errors[0] || 'El CFDI recibido no superó las validaciones del portal de proveedores'
    }
  }

  await persistProviderAcceptedCfdis({
    records: report.acceptedRecords,
    context: receivedContext.context,
    uploadedByUserId: receivedContext.uploadedByUserId
  })

  const persistedRecord = await prisma.providerUploadedCfdi.findUnique({
    where: {
      organizationId_uuid: {
        organizationId: item.organizationId,
        uuid: normalizedUuid
      }
    },
    select: {
      id: true
    }
  })

  if (report.acceptedRecords.some(record => record.cfdiType === 'P')) {
    try {
      await syncProviderPaymentComplianceBlocks({
        organizationId: item.organizationId,
        providerRfc: normalizeRfc(item.issuerRfc)
      })
    } catch (complianceError) {
      console.error('No fue posible sincronizar bloqueo de cumplimiento de pagos tras persistir recibido M2M:', complianceError)
    }
  }

  return {
    storageId: persistedRecord?.id || null,
    created: true,
    validationStatus: 'APPROVED',
    validationBucket: 'VALIDO' as ValidationBucket,
    errorCode: null,
    errorMessage: null
  }
}

async function persistPreparedImportRunItem(item: ImportRunItemRow): Promise<PersistResult> {
  const xmlContent = await getImportRunItemXmlById(item.id)
  let emittedInvoiceId: string | null = item.emittedInvoiceId
  let receivedProviderUploadedCfdiId: string | null = item.receivedProviderUploadedCfdiId
  let validationStatus: string | null = item.validationStatus
  let validationBucket: ValidationBucket | null = item.validationBucket
  let createdEmitted = 0
  let createdReceived = 0

  await prisma.$executeRaw(Prisma.sql`
    UPDATE import_run_items
    SET
      status = 'PERSISTING',
      updated_at = NOW()
    WHERE id = ${item.id}
      AND status IN ('PREPARED', 'PERSISTING')
  `)

  if (item.classificationResult === 'EMITTED' || item.classificationResult === 'BOTH') {
    const emittedResult = await createInvoiceFromXml(prisma, xmlContent, undefined, item.organizationId)
    if (emittedResult.uuid && (emittedResult.status === 'created' || emittedResult.status === 'skipped')) {
      const lookup = await prisma.invoice.findUnique({ where: { uuid: emittedResult.uuid }, select: { id: true } })
      emittedInvoiceId = lookup?.id ?? null
    } else {
      emittedInvoiceId = null
    }
    createdEmitted = emittedResult.status === 'created' ? 1 : 0
  }

  if (item.classificationResult === 'RECEIVED' || item.classificationResult === 'BOTH') {
    try {
      const receivedResult = await persistReceivedImportRunItem(item, xmlContent)

      if (receivedResult.errorCode || receivedResult.errorMessage) {
        return {
          status: 'FAILED',
          emittedInvoiceId,
          receivedProviderUploadedCfdiId: receivedResult.storageId,
          validationStatus: receivedResult.validationStatus,
          validationBucket: receivedResult.validationBucket,
          errorCode: receivedResult.errorCode,
          errorMessage: receivedResult.errorMessage,
          counters: buildPersistCounters('FAILED', createdEmitted, createdReceived)
        }
      }

      receivedProviderUploadedCfdiId = receivedResult.storageId
      validationStatus = receivedResult.validationStatus
      validationBucket = receivedResult.validationBucket
      createdReceived = receivedResult.created ? 1 : 0
    } catch (error) {
      return {
        status: 'FAILED',
        emittedInvoiceId,
        receivedProviderUploadedCfdiId,
        validationStatus,
        validationBucket,
        errorCode: 'RECEIVED_PERSISTENCE_FAILED',
        errorMessage: error instanceof Error ? error.message : 'No fue posible persistir el CFDI recibido',
        counters: buildPersistCounters('FAILED', createdEmitted, createdReceived)
      }
    }
  }

  const nothingCreated = createdEmitted === 0 && createdReceived === 0
  const nextStatus: PersistResult['status'] = nothingCreated ? 'SKIPPED' : 'PERSISTED'

  return {
    status: nextStatus,
    emittedInvoiceId,
    receivedProviderUploadedCfdiId,
    validationStatus,
    validationBucket,
    errorCode: null,
    errorMessage: null,
    counters: buildPersistCounters(nextStatus, createdEmitted, createdReceived)
  }
}

async function failImportRunItem(item: ImportRunItemRow, error: unknown) {
  const message = error instanceof Error ? error.message : 'No fue posible procesar el CFDI'

  if (isTerminalItemStatus(item.status)) {
    return
  }

  await finalizeImportRunItem(item.id, item.importRunId, {
    status: 'FAILED',
    emittedInvoiceId: item.emittedInvoiceId,
    receivedProviderUploadedCfdiId: item.receivedProviderUploadedCfdiId,
    validationStatus: item.validationStatus,
    validationBucket: item.validationBucket,
    errorCode: item.errorCode || 'PROCESSING_ERROR',
    errorMessage: message,
    counters: buildPersistCounters('FAILED', 0, 0)
  })
}

export async function enqueueImportRunDispatch(importRunId: string) {
  await getCfdiImportDispatchQueue().add(
    'dispatch-import-run',
    { importRunId },
    {
      jobId: `cfdi-import-dispatch-${importRunId}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: 1000,
      removeOnFail: 1000
    }
  )
}

export async function dispatchImportRun(importRunId: string) {
  const run = await getImportRunById(importRunId)

  if (!run) {
    throw new Error(`No se encontró import_run ${importRunId}`)
  }

  if (run.status === 'CANCELLED' || run.status === 'FAILED') {
    return { enqueuedItems: 0, skipped: true }
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE import_runs
    SET
      status = 'DISPATCHING',
      started_at = COALESCE(started_at, NOW()),
      updated_at = NOW()
    WHERE id = ${importRunId}
      AND status IN ('QUEUED', 'DISPATCHING', 'PROCESSING')
  `)

  const items = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM import_run_items
    WHERE import_run_id = ${importRunId}
      AND status = 'QUEUED'
    ORDER BY created_at ASC, file_name ASC, id ASC
  `)

  for (const item of items) {
    await getCfdiImportItemQueue().add(
      'classify-import-item',
      { itemId: item.id },
      {
        jobId: `cfdi-import-item-${item.id}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 1000,
        removeOnFail: 1000
      }
    )
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE import_runs
    SET
      status = 'PROCESSING',
      updated_at = NOW()
    WHERE id = ${importRunId}
  `)

  return {
    enqueuedItems: items.length,
    skipped: false
  }
}

export async function classifyImportRunItem(itemId: string) {
  let item = await getImportRunItemById(itemId)

  if (!item) {
    throw new Error(`No se encontró import_run_item ${itemId}`)
  }

  if (!PROCESSABLE_ITEM_STATUSES.includes(item.status)) {
    return { skipped: true }
  }

  try {
    item = await classifyPreparedImportRunItem(item)

    if (isTerminalItemStatus(item.status)) {
      return {
        skipped: item.status === 'FAILED',
        classificationResult: item.classificationResult,
        direction: item.direction,
        status: item.status
      }
    }

    const persistResult = await persistPreparedImportRunItem(item)
    await finalizeImportRunItem(item.id, item.importRunId, persistResult)

    return {
      skipped: false,
      classificationResult: item.classificationResult,
      direction: item.direction,
      status: persistResult.status,
      emittedInvoiceId: persistResult.emittedInvoiceId,
      receivedProviderUploadedCfdiId: persistResult.receivedProviderUploadedCfdiId
    }
  } catch (error) {
    console.error(`Error procesando import_run_item ${itemId}:`, error)
    await failImportRunItem(item, error)

    return {
      skipped: false,
      classificationResult: item.classificationResult,
      direction: item.direction,
      status: 'FAILED' as const
    }
  }
}

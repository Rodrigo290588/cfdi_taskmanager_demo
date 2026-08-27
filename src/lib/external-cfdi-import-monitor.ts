import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import { buildSafeLikePattern, fp32 } from '@/lib/monitor-security-helpers'
import { safeErrSummary, fingerprint } from '@/lib/security'

export const CFDI_IMPORT_SCOPE = 'cfdi.import'

export const IMPORT_RUN_STATUSES = [
  'QUEUED',
  'DISPATCHING',
  'PROCESSING',
  'PROCESSING_WITH_EXTERNAL_WAIT',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED'
] as const

export const IMPORT_RUN_SOURCES = [
  'JAVA_M2M',
  'PROVIDER_PORTAL',
  'MANUAL_ADMIN'
] as const

export const IMPORT_RUN_ITEM_STATUSES = [
  'QUEUED',
  'PREPARING',
  'PREPARED',
  'VALIDATING_INTERNAL',
  'WAITING_EXTERNAL_VALIDATION',
  'VALIDATING_EXTERNAL',
  'VALIDATED',
  'PERSISTING',
  'PERSISTED',
  'SKIPPED',
  'FAILED',
  'CANCELLED'
] as const

export const IMPORT_RUN_ITEM_DIRECTIONS = ['EMITTED', 'RECEIVED'] as const
export const VALIDATION_BUCKETS = ['VALIDO', 'INVALIDO'] as const

type ImportRunSummaryRow = {
  id: string
  organizationId: string
  source: string
  batchId: string | null
  directorySessionId: string | null
  status: string
  totalItems: number
  processedItems: number
  createdEmitted: number
  createdReceived: number
  skippedItems: number
  errorItems: number
  waitingExternalValidationItems: number
  startedAt: Date | null
  finishedAt: Date | null
  directoryExecutionId: string | null
  directoryTotalXmlFiles: number | null
  directorySkippedByProgressFiles: number | null
  directoryNewXmlFiles: number | null
  createdAt: Date
  updatedAt: Date
}

type ImportRunItemRow = {
  id: string
  importRunId?: string
  fileName: string
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
  classificationResult: string
  direction: string | null
  status: string
  validationStatus: string | null
  validationBucket: string | null
  errorCode: string | null
  errorMessage: string | null
  attemptCountInternal: number
  attemptCountExternal: number
  nextExternalRetryAt: Date | null
  processingStartedAt: Date | null
  processingFinishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type ImportErrorDrilldownRawRow = {
  id: string
  importRunId: string
  fileName: string
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
  classificationResult: string
  direction: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: Date
  source: string
  batchId: string | null
  runStatus: string
  runStartedAt: Date | null
  runFinishedAt: Date | null
  xmlCiphertext: string | null
  xmlIv: string | null
  xmlAuthTag: string | null
  xmlEncryptionAlg: string | null
}

type OrganizationImportMonitorTotalsRow = {
  totalItems: number | bigint | null
  processedItems: number | bigint | null
  createdEmitted: number | bigint | null
  createdReceived: number | bigint | null
  skippedItems: number | bigint | null
  errorItems: number | bigint | null
  waitingExternalValidationItems: number | bigint | null
  activeRuns: number | bigint | null
  completedRuns: number | bigint | null
  completedWithErrorsRuns: number | bigint | null
  failedRuns: number | bigint | null
}

type OrganizationDirectoryControlTotalsRow = {
  totalXmlFiles: number | bigint | null
  skippedByProgressFiles: number | bigint | null
  newXmlFiles: number | bigint | null
  acceptedItems: number | bigint | null
  processedItems: number | bigint | null
  matchedDirectorySessions: number | bigint | null
}

type OrganizationRecentImportRunRow = {
  id: string
  batchId: string | null
  source: string
  status: string
  totalItems: number
  processedItems: number
  createdEmitted: number
  createdReceived: number
  errorItems: number
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type OrganizationRecentImportItemRow = {
  id: string
  importRunId: string
  fileName: string
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
  classificationResult: string
  direction: string | null
  status: string
  validationStatus: string | null
  validationBucket: string | null
  errorCode: string | null
  updatedAt: Date
}

export type ImportRunItemFilters = {
  status?: string
  direction?: string
  validationBucket?: string
  hasErrors?: boolean
  waitingExternalValidation?: boolean
}

export type ImportRunFilters = {
  status?: string
  source?: string
  search?: string
  startedFrom?: Date
  finishedTo?: Date
}

export type ImportRunDirectoryControl = {
  hasDirectoryControl: boolean
  executionId: string | null
  totalXmlFiles: number | null
  skippedByProgressFiles: number | null
  newXmlFiles: number | null
  acceptedItems: number
  processedItems: number
  acceptanceGap: number | null
  processingGap: number | null
}

export type DirectoryControlStats = {
  totalXmlFiles: number
  skippedByProgressFiles: number
  newXmlFiles: number
  acceptedItems: number
  processedItems: number
  acceptanceGap: number
  processingGap: number
  matchedDirectorySessions: number
}

export type ImportErrorDrilldownRow = {
  id: string
  importRunId: string
  fileName: string
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
  direction: string | null
  classificationResult: string
  errorCode: string | null
  errorMessage: string | null
  createdAt: Date
  documentDate: string | null
  source: string
  batchId: string | null
  runStatus: string
  runStartedAt: Date | null
  runFinishedAt: Date | null
}

function toNumber(value: number | bigint | null | undefined) {
  if (typeof value === 'bigint') {
    return Number(value)
  }

  return Number(value ?? 0)
}

function buildProgressPercent(processedItems: number, totalItems: number) {
  if (totalItems <= 0) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round((processedItems / totalItems) * 100)))
}

function buildThroughputPerMinute(processedItems: number, startedAt: Date | null, finishedAt: Date | null) {
  const baseDate = startedAt ?? null

  if (!baseDate) {
    return 0
  }

  const endDate = finishedAt ?? new Date()
  const elapsedMs = endDate.getTime() - baseDate.getTime()

  if (elapsedMs <= 0) {
    return 0
  }

  const perMinute = processedItems / (elapsedMs / 60000)
  return Number(perMinute.toFixed(1))
}

function buildRunDirectoryControl(run: {
  directoryExecutionId: string | null
  directoryTotalXmlFiles: number | null
  directorySkippedByProgressFiles: number | null
  directoryNewXmlFiles: number | null
  totalItems: number
  processedItems: number
}): ImportRunDirectoryControl {
  const hasDirectoryControl = Boolean(run.directoryExecutionId)

  if (!hasDirectoryControl) {
    return {
      hasDirectoryControl: false,
      executionId: null,
      totalXmlFiles: null,
      skippedByProgressFiles: null,
      newXmlFiles: null,
      acceptedItems: run.totalItems,
      processedItems: run.processedItems,
      acceptanceGap: null,
      processingGap: null
    }
  }

  const acceptanceGap = (run.directoryNewXmlFiles ?? 0) - run.totalItems
  const processingGap = run.totalItems - run.processedItems

  return {
    hasDirectoryControl: true,
    executionId: run.directoryExecutionId,
    totalXmlFiles: run.directoryTotalXmlFiles,
    skippedByProgressFiles: run.directorySkippedByProgressFiles,
    newXmlFiles: run.directoryNewXmlFiles,
    acceptedItems: run.totalItems,
    processedItems: run.processedItems,
    acceptanceGap,
    processingGap
  }
}

function attrNs(xml: string, tagNs: string, attrName: string): string | null {
  const re = new RegExp(`<${tagNs}[^>]*\\b${attrName}\\s*=\\s*"([^"]+)"`, 'i')
  const match = xml.match(re)
  return match ? match[1].trim() : null
}

function extractXmlDocumentDate(xml: string) {
  const comprobanteTag = xml.includes('<cfdi:Comprobante') ? 'cfdi:Comprobante' : 'Comprobante'

  return (
    attrNs(xml, comprobanteTag, 'Fecha')
    || attrNs(xml, '[^:>]*:?Comprobante', 'Fecha')
    || null
  )
}

export async function getImportRunSummary(importRunId: string, organizationId: string) {
  const rows = await prisma.$queryRaw<ImportRunSummaryRow[]>(Prisma.sql`
    SELECT
      ir.id,
      ir.organization_id AS "organizationId",
      ir.source,
      ir.batch_id AS "batchId",
      ir.directory_session_id AS "directorySessionId",
      ir.status,
      ir.total_items AS "totalItems",
      ir.processed_items AS "processedItems",
      ir.created_emitted AS "createdEmitted",
      ir.created_received AS "createdReceived",
      ir.skipped_items AS "skippedItems",
      ir.error_items AS "errorItems",
      ir.waiting_external_validation_items AS "waitingExternalValidationItems",
      ir.started_at AS "startedAt",
      ir.finished_at AS "finishedAt",
      ids.execution_id AS "directoryExecutionId",
      ids.total_xml_files AS "directoryTotalXmlFiles",
      ids.skipped_by_progress_files AS "directorySkippedByProgressFiles",
      ids.new_xml_files AS "directoryNewXmlFiles",
      ir.created_at AS "createdAt",
      ir.updated_at AS "updatedAt"
    FROM import_runs ir
    LEFT JOIN import_directory_sessions ids
      ON ids.id = ir.directory_session_id
    WHERE ir.id = ${importRunId}
      AND ir.organization_id = ${organizationId}
    LIMIT 1
  `)

  const run = rows[0]

  if (!run) {
    return null
  }

  return {
    ...run,
    directoryControl: buildRunDirectoryControl(run),
    progressPercent: buildProgressPercent(run.processedItems, run.totalItems),
    throughputPerMinute: buildThroughputPerMinute(run.processedItems, run.startedAt, run.finishedAt)
  }
}

export async function getOrganizationImportMonitorStats(
  organizationId: string,
  filters: ImportRunFilters = {}
) {
  const whereClause = buildRunsWhereClause(organizationId, filters, 'ir')
  const [totalsRows, directoryControlRows, recentRuns, recentItems] = await Promise.all([
    prisma.$queryRaw<OrganizationImportMonitorTotalsRow[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(ir.total_items), 0)::bigint AS "totalItems",
        COALESCE(SUM(ir.processed_items), 0)::bigint AS "processedItems",
        COALESCE(SUM(ir.created_emitted), 0)::bigint AS "createdEmitted",
        COALESCE(SUM(ir.created_received), 0)::bigint AS "createdReceived",
        COALESCE(SUM(ir.skipped_items), 0)::bigint AS "skippedItems",
        COALESCE(SUM(ir.error_items), 0)::bigint AS "errorItems",
        COALESCE(SUM(ir.waiting_external_validation_items), 0)::bigint AS "waitingExternalValidationItems",
        COUNT(*) FILTER (
          WHERE ir.status IN ('QUEUED', 'DISPATCHING', 'PROCESSING', 'PROCESSING_WITH_EXTERNAL_WAIT')
        )::bigint AS "activeRuns",
        COUNT(*) FILTER (WHERE ir.status = 'COMPLETED')::bigint AS "completedRuns",
        COUNT(*) FILTER (WHERE ir.status = 'COMPLETED_WITH_ERRORS')::bigint AS "completedWithErrorsRuns",
        COUNT(*) FILTER (WHERE ir.status = 'FAILED')::bigint AS "failedRuns"
      FROM import_runs ir
      ${whereClause}
    `),
    prisma.$queryRaw<OrganizationDirectoryControlTotalsRow[]>(Prisma.sql`
      WITH filtered_runs AS (
        SELECT
          ir.id,
          ir.directory_session_id AS "directorySessionId",
          ir.total_items AS "totalItems",
          ir.processed_items AS "processedItems"
        FROM import_runs ir
        ${whereClause}
      ),
      directory_sessions AS (
        SELECT DISTINCT
          ids.id,
          ids.total_xml_files AS "totalXmlFiles",
          ids.skipped_by_progress_files AS "skippedByProgressFiles",
          ids.new_xml_files AS "newXmlFiles"
        FROM filtered_runs fr
        JOIN import_directory_sessions ids
          ON ids.id = fr."directorySessionId"
      )
      SELECT
        COALESCE((SELECT SUM("totalXmlFiles") FROM directory_sessions), 0)::bigint AS "totalXmlFiles",
        COALESCE((SELECT SUM("skippedByProgressFiles") FROM directory_sessions), 0)::bigint AS "skippedByProgressFiles",
        COALESCE((SELECT SUM("newXmlFiles") FROM directory_sessions), 0)::bigint AS "newXmlFiles",
        COALESCE((SELECT SUM("totalItems") FROM filtered_runs WHERE "directorySessionId" IS NOT NULL), 0)::bigint AS "acceptedItems",
        COALESCE((SELECT SUM("processedItems") FROM filtered_runs WHERE "directorySessionId" IS NOT NULL), 0)::bigint AS "processedItems",
        COALESCE((SELECT COUNT(*) FROM directory_sessions), 0)::bigint AS "matchedDirectorySessions"
    `),
    prisma.$queryRaw<OrganizationRecentImportRunRow[]>(Prisma.sql`
      SELECT
        id,
        batch_id AS "batchId",
        source,
        status,
        total_items AS "totalItems",
        processed_items AS "processedItems",
        created_emitted AS "createdEmitted",
        created_received AS "createdReceived",
        error_items AS "errorItems",
        started_at AS "startedAt",
        finished_at AS "finishedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM import_runs ir
      ${buildRunsWhereClause(organizationId, filters, 'ir')}
      ORDER BY ir.updated_at DESC, ir.created_at DESC
      LIMIT 10
    `),
    prisma.$queryRaw<OrganizationRecentImportItemRow[]>(Prisma.sql`
      SELECT
        iri.id,
        iri.import_run_id AS "importRunId",
        iri.file_name AS "fileName",
        iri.uuid,
        iri.issuer_rfc AS "issuerRfc",
        iri.receiver_rfc AS "receiverRfc",
        iri.classification_result AS "classificationResult",
        iri.direction,
        iri.status,
        iri.validation_status AS "validationStatus",
        iri.validation_bucket AS "validationBucket",
        iri.error_code AS "errorCode",
        iri.updated_at AS "updatedAt"
      FROM import_run_items iri
      INNER JOIN import_runs ir
        ON ir.id = iri.import_run_id
      ${buildRunsWhereClause(organizationId, filters, 'ir')}
        AND iri.organization_id = ${organizationId}
      ORDER BY iri.updated_at DESC, iri.created_at DESC
      LIMIT 10
    `)
  ])

  const totals = totalsRows[0] || {
    totalItems: 0,
    processedItems: 0,
    createdEmitted: 0,
    createdReceived: 0,
    skippedItems: 0,
    errorItems: 0,
    waitingExternalValidationItems: 0,
    activeRuns: 0,
    completedRuns: 0,
    completedWithErrorsRuns: 0,
    failedRuns: 0
  }
  const directoryControlTotals = directoryControlRows[0] || {
    totalXmlFiles: 0,
    skippedByProgressFiles: 0,
    newXmlFiles: 0,
    acceptedItems: 0,
    processedItems: 0,
    matchedDirectorySessions: 0
  }
  const directoryNewXmlFiles = toNumber(directoryControlTotals.newXmlFiles)
  const directoryAcceptedItems = toNumber(directoryControlTotals.acceptedItems)
  const directoryProcessedItems = toNumber(directoryControlTotals.processedItems)

  return {
    totalItems: toNumber(totals.totalItems),
    processedItems: toNumber(totals.processedItems),
    createdEmitted: toNumber(totals.createdEmitted),
    createdReceived: toNumber(totals.createdReceived),
    skippedItems: toNumber(totals.skippedItems),
    errorItems: toNumber(totals.errorItems),
    waitingExternalValidationItems: toNumber(totals.waitingExternalValidationItems),
    activeRuns: toNumber(totals.activeRuns),
    completedRuns: toNumber(totals.completedRuns),
    completedWithErrorsRuns: toNumber(totals.completedWithErrorsRuns),
    failedRuns: toNumber(totals.failedRuns),
    directoryControl: {
      totalXmlFiles: toNumber(directoryControlTotals.totalXmlFiles),
      skippedByProgressFiles: toNumber(directoryControlTotals.skippedByProgressFiles),
      newXmlFiles: directoryNewXmlFiles,
      acceptedItems: directoryAcceptedItems,
      processedItems: directoryProcessedItems,
      acceptanceGap: directoryNewXmlFiles - directoryAcceptedItems,
      processingGap: directoryAcceptedItems - directoryProcessedItems,
      matchedDirectorySessions: toNumber(directoryControlTotals.matchedDirectorySessions)
    },
    recentRuns,
    recentItems,
    timestamp: Date.now()
  }
}

function buildRunsWhereClause(
  organizationId: string,
  filters: ImportRunFilters,
  tableAlias?: string
) {
  const column = (name: string) => Prisma.raw(tableAlias ? `${tableAlias}.${name}` : name)
  const conditions: Prisma.Sql[] = [
    Prisma.sql`${column('organization_id')} = ${organizationId}`
  ]

  if (filters.status) {
    conditions.push(Prisma.sql`${column('status')} = CAST(${filters.status} AS "import_run_status")`)
  }

  if (filters.source) {
    conditions.push(Prisma.sql`${column('source')} = CAST(${filters.source} AS "import_run_source")`)
  }

  if (filters.search) {
    const safe = buildSafeLikePattern(filters.search)
    conditions.push(Prisma.sql`(
      ${column('id')} ILIKE ${safe.pattern} ESCAPE ${safe.escapeChar}
      OR COALESCE(${column('batch_id')}, '') ILIKE ${safe.pattern} ESCAPE ${safe.escapeChar}
    )`)
  }

  if (filters.startedFrom) {
    conditions.push(Prisma.sql`${column('started_at')} IS NOT NULL`)
    conditions.push(Prisma.sql`${column('started_at')} >= ${filters.startedFrom}`)
  }

  if (filters.finishedTo) {
    conditions.push(Prisma.sql`${column('finished_at')} IS NOT NULL`)
    conditions.push(Prisma.sql`${column('finished_at')} <= ${filters.finishedTo}`)
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
}

export async function listOrganizationImportRuns(params: {
  organizationId: string
  page: number
  pageSize: number
  filters: ImportRunFilters
}) {
  const { organizationId, page, pageSize, filters } = params
  const offset = (page - 1) * pageSize
  const whereClause = buildRunsWhereClause(organizationId, filters, 'ir')

  const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM import_runs ir
    ${whereClause}
  `)

  const totalItems = toNumber(countRows[0]?.count)

  const runs = await prisma.$queryRaw<ImportRunSummaryRow[]>(Prisma.sql`
    SELECT
      ir.id,
      ir.organization_id AS "organizationId",
      ir.source,
      ir.batch_id AS "batchId",
      ir.directory_session_id AS "directorySessionId",
      ir.status,
      ir.total_items AS "totalItems",
      ir.processed_items AS "processedItems",
      ir.created_emitted AS "createdEmitted",
      ir.created_received AS "createdReceived",
      ir.skipped_items AS "skippedItems",
      ir.error_items AS "errorItems",
      ir.waiting_external_validation_items AS "waitingExternalValidationItems",
      ir.started_at AS "startedAt",
      ir.finished_at AS "finishedAt",
      ids.execution_id AS "directoryExecutionId",
      ids.total_xml_files AS "directoryTotalXmlFiles",
      ids.skipped_by_progress_files AS "directorySkippedByProgressFiles",
      ids.new_xml_files AS "directoryNewXmlFiles",
      ir.created_at AS "createdAt",
      ir.updated_at AS "updatedAt"
    FROM import_runs ir
    LEFT JOIN import_directory_sessions ids
      ON ids.id = ir.directory_session_id
    ${whereClause}
    ORDER BY ir.updated_at DESC, ir.created_at DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)

  return {
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize)
    },
    runs: runs.map(run => ({
      ...run,
      directoryControl: buildRunDirectoryControl(run),
      progressPercent: buildProgressPercent(run.processedItems, run.totalItems),
      throughputPerMinute: buildThroughputPerMinute(run.processedItems, run.startedAt, run.finishedAt)
    }))
  }
}

function buildItemsWhereClause(importRunId: string, organizationId: string, filters: ImportRunItemFilters) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`import_run_id = ${importRunId}`,
    Prisma.sql`organization_id = ${organizationId}`
  ]

  if (filters.status) {
    conditions.push(Prisma.sql`status = CAST(${filters.status} AS "import_run_item_status")`)
  }

  if (filters.direction) {
    conditions.push(Prisma.sql`direction = CAST(${filters.direction} AS "import_run_item_direction")`)
  }

  if (filters.validationBucket) {
    conditions.push(Prisma.sql`validation_bucket = CAST(${filters.validationBucket} AS "validation_bucket")`)
  }

  if (typeof filters.hasErrors === 'boolean') {
    if (filters.hasErrors) {
      conditions.push(Prisma.sql`(error_code IS NOT NULL OR error_message IS NOT NULL)`)
    } else {
      conditions.push(Prisma.sql`error_code IS NULL AND error_message IS NULL`)
    }
  }

  if (typeof filters.waitingExternalValidation === 'boolean') {
    if (filters.waitingExternalValidation) {
      conditions.push(Prisma.sql`status = 'WAITING_EXTERNAL_VALIDATION'`)
    } else {
      conditions.push(Prisma.sql`status <> 'WAITING_EXTERNAL_VALIDATION'`)
    }
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
}

export async function listImportRunItems(params: {
  importRunId: string
  organizationId: string
  page: number
  pageSize: number
  filters: ImportRunItemFilters
}) {
  const { importRunId, organizationId, page, pageSize, filters } = params
  const offset = (page - 1) * pageSize
  const whereClause = buildItemsWhereClause(importRunId, organizationId, filters)

  const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM import_run_items
    ${whereClause}
  `)

  const totalItems = toNumber(countRows[0]?.count)

  const items = await prisma.$queryRaw<ImportRunItemRow[]>(Prisma.sql`
    SELECT
      id,
      file_name AS "fileName",
      uuid,
      issuer_rfc AS "issuerRfc",
      receiver_rfc AS "receiverRfc",
      classification_result AS "classificationResult",
      direction,
      status,
      validation_status AS "validationStatus",
      validation_bucket AS "validationBucket",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      attempt_count_internal AS "attemptCountInternal",
      attempt_count_external AS "attemptCountExternal",
      next_external_retry_at AS "nextExternalRetryAt",
      emitted_invoice_id AS "emittedInvoiceId",
      received_provider_uploaded_cfdi_id AS "receivedProviderUploadedCfdiId",
      processing_started_at AS "processingStartedAt",
      processing_finished_at AS "processingFinishedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM import_run_items
    ${whereClause}
    ORDER BY created_at ASC, file_name ASC, id ASC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)

  return {
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize)
    },
    items
  }
}

export async function getImportRunItemDetail(itemId: string, organizationId: string) {
  const rows = await prisma.$queryRaw<ImportRunItemRow[]>(Prisma.sql`
    SELECT
      id,
      import_run_id AS "importRunId",
      file_name AS "fileName",
      uuid,
      issuer_rfc AS "issuerRfc",
      receiver_rfc AS "receiverRfc",
      classification_result AS "classificationResult",
      direction,
      status,
      validation_status AS "validationStatus",
      validation_bucket AS "validationBucket",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      attempt_count_internal AS "attemptCountInternal",
      attempt_count_external AS "attemptCountExternal",
      next_external_retry_at AS "nextExternalRetryAt",
      processing_started_at AS "processingStartedAt",
      processing_finished_at AS "processingFinishedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM import_run_items
    WHERE id = ${itemId}
      AND organization_id = ${organizationId}
    LIMIT 1
  `)

  return rows[0] || null
}

export async function listOrganizationImportErrorDrilldown(params: {
  organizationId: string
  page: number
  pageSize: number
  filters: ImportRunFilters
}) {
  const { organizationId, filters } = params
  const pageSafe = Math.max(1, Math.floor(Number(params.page) || 1))
  const pageSizeSafe = Math.min(100, Math.max(1, Math.floor(Number(params.pageSize) || 20)))
  const offset = (pageSafe - 1) * pageSizeSafe

  const conditions: Prisma.Sql[] = [
    Prisma.sql`iri.organization_id = ${organizationId}`,
    Prisma.sql`(iri.error_code IS NOT NULL OR iri.error_message IS NOT NULL)`
  ]

  if (filters.status) {
    conditions.push(Prisma.sql`ir.status = CAST(${filters.status} AS "import_run_status")`)
  }

  if (filters.source) {
    conditions.push(Prisma.sql`ir.source = CAST(${filters.source} AS "import_run_source")`)
  }

  if (filters.search) {
    const safe = buildSafeLikePattern(filters.search)
    conditions.push(Prisma.sql`(
      ir.id ILIKE ${safe.pattern} ESCAPE ${safe.escapeChar}
      OR COALESCE(ir.batch_id, '') ILIKE ${safe.pattern} ESCAPE ${safe.escapeChar}
    )`)
  }

  if (filters.startedFrom) {
    conditions.push(Prisma.sql`ir.started_at IS NOT NULL`)
    conditions.push(Prisma.sql`ir.started_at >= ${filters.startedFrom}`)
  }

  if (filters.finishedTo) {
    conditions.push(Prisma.sql`ir.finished_at IS NOT NULL`)
    conditions.push(Prisma.sql`ir.finished_at <= ${filters.finishedTo}`)
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM import_run_items iri
      INNER JOIN import_runs ir
        ON ir.id = iri.import_run_id
      ${whereClause}
    `),
    prisma.$queryRaw<ImportErrorDrilldownRawRow[]>(Prisma.sql`
      SELECT
        iri.id,
        iri.import_run_id AS "importRunId",
        iri.file_name AS "fileName",
        iri.uuid,
        iri.issuer_rfc AS "issuerRfc",
        iri.receiver_rfc AS "receiverRfc",
        iri.classification_result AS "classificationResult",
        iri.direction,
        iri.error_code AS "errorCode",
        iri.error_message AS "errorMessage",
        iri.created_at AS "createdAt",
        ir.source,
        ir.batch_id AS "batchId",
        ir.status AS "runStatus",
        ir.started_at AS "runStartedAt",
        ir.finished_at AS "runFinishedAt",
        irib.xml_ciphertext AS "xmlCiphertext",
        irib.xml_iv AS "xmlIv",
        irib.xml_auth_tag AS "xmlAuthTag",
        irib.xml_encryption_alg AS "xmlEncryptionAlg"
      FROM import_run_items iri
      INNER JOIN import_runs ir
        ON ir.id = iri.import_run_id
      LEFT JOIN import_run_item_blobs irib
        ON irib.import_run_item_id = iri.id
      ${whereClause}
      ORDER BY iri.created_at DESC, iri.file_name ASC, iri.id ASC
      LIMIT ${pageSizeSafe}
      OFFSET ${offset}
    `)
  ])

  const totalItems = toNumber(countRows[0]?.count)
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSizeSafe)

  const data = rows.map((row) => {
    let documentDate: string | null = null

    if (row.xmlCiphertext && row.xmlIv && row.xmlAuthTag && row.xmlEncryptionAlg) {
      try {
        const xmlContent = decryptInvoiceXmlContent({
          ciphertext: row.xmlCiphertext,
          iv: row.xmlIv,
          authTag: row.xmlAuthTag,
          algorithm: row.xmlEncryptionAlg
        })

        documentDate = extractXmlDocumentDate(xmlContent)
      } catch (error) {
        const rowFp = fp32(fingerprint(`drilldown_decrypt:${organizationId}:${row.importRunId}:${row.uuid ?? row.id}`))
        const errSummary = safeErrSummary(error)
        console.error(`[MON-DRILLDOWN-DECRYPT-${rowFp}] No fue posible descifrar el XML del item para drilldown de errores:`, JSON.stringify(errSummary))
      }
    }

    return {
      id: row.id,
      importRunId: row.importRunId,
      fileName: row.fileName,
      uuid: row.uuid,
      issuerRfc: row.issuerRfc,
      receiverRfc: row.receiverRfc,
      direction: row.direction,
      classificationResult: row.classificationResult,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      documentDate,
      source: row.source,
      batchId: row.batchId,
      runStatus: row.runStatus,
      runStartedAt: row.runStartedAt,
      runFinishedAt: row.runFinishedAt
    }
  })

  return {
    pagination: {
      page: pageSafe,
      pageSize: pageSizeSafe,
      totalItems,
      totalPages
    },
    data
  }
}

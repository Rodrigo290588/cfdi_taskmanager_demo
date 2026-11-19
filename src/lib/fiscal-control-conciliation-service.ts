import { createHash } from 'node:crypto'

import { Prisma, type CfdiType, type SatStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import {
  FISCAL_CONTROL_COLUMN_FILTER_KEYS,
  normalizeFiscalControlUuid,
  type FiscalControlColumnFilterKey,
  type FiscalControlOrigin,
  type FiscalControlReconciliationFilters,
  type FiscalControlReconciliationStatus,
  type FiscalControlStatusDifference,
  type FiscalControlSourceAvailability,
  type FiscalControlXmlStorage,
  type FiscalControlNormalizedRow,
} from '@/lib/fiscal-control-conciliation-types'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const CURSOR_VERSION = 1
const FISCAL_CONTROL_PAGE_CACHE_TTL_SECONDS = 30
const FISCAL_CONTROL_COLUMN_FILTER_KEY_SET = new Set<string>(
  FISCAL_CONTROL_COLUMN_FILTER_KEYS,
)

type DateRange = Readonly<{
  gte?: Date
  lte?: Date
}>

type FiscalControlCursor = Readonly<{
  v: typeof CURSOR_VERSION
  issuanceDate: string
  uuid: string
}>

type SourceCandidate = Readonly<{
  uuid: string
  origin?: FiscalControlOrigin
  hasMetadata: boolean
  hasXml: boolean
  xmlStorage: FiscalControlXmlStorage
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  cfdiType: string
  satStatus: string
  issuanceDate: Date | null
  payrollPaymentDate: Date | null
  total: string | null
}>

type SourceCandidateBatch = Readonly<{
  candidates: readonly SourceCandidate[]
  hasPotentialMore: boolean
}>

export type FiscalControlConciliationPage = Readonly<{
  rows: readonly FiscalControlNormalizedRow[]
  nextCursor: string | null
  summary: FiscalControlGlobalReconciliationSummary
  cacheStatus?: 'BYPASS' | 'HIT' | 'MISS' | 'COALESCED'
}>

export type FiscalControlConciliationPageInput = Readonly<{
  filters: FiscalControlReconciliationFilters
  cursor?: string | null
  pageSize?: number
  cache?: boolean
}>

export type FiscalControlConciliationTotals = Readonly<{
  metadataTotal: number
  xmlTotal: number
  xmlTypeBreakdown: FiscalControlCfdiTypeBreakdown
  byOrigin: Readonly<{
    emitidos: number
    recibidos: number
    nomina: number
  }>
}>

export type FiscalControlGlobalReconciliationSummary = Readonly<{
  scope: 'RANGE'
  sourceCounts: Readonly<{
    metadata: number
    emitidos: number
    recibidos: number
    nomina: number
  }>
  reconciliationSummary: Readonly<{
    totalRows: number
    reconciled: number
    metadataWithoutXml: number
    xmlWithoutMetadata: number
    xmlUnavailable: number
    conflicts: number
  }>
  statusComparison: Readonly<{
    vigentes: Readonly<{ metadata: number; xml: number; difference: number }>
    cancelados: Readonly<{ metadata: number; xml: number; difference: number }>
  }>
}>

type FiscalControlGlobalPageInput = Readonly<{
  cursor: FiscalControlCursor | null
  pageSize: number
}>

type FiscalControlGlobalPageRow = Readonly<{ uuid: string }>

type FiscalControlGlobalReconciliationResult =
  FiscalControlGlobalReconciliationSummary & Readonly<{
    pageRows?: readonly FiscalControlGlobalPageRow[]
  }>

type FiscalControlCfdiTypeKey = 'ingreso' | 'egreso' | 'nomina' | 'pago' | 'traslado'
type FiscalControlCfdiTypeDirectionCounts = Readonly<{ emitidos: number; recibidos: number }>
type FiscalControlCfdiTypeBreakdown = Readonly<
  Record<FiscalControlCfdiTypeKey, FiscalControlCfdiTypeDirectionCounts>
>

function toDecimalString(value: Prisma.Decimal | null | undefined): string | null {
  return value ? value.toFixed() : null
}

function toUtcCursorDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function encodeCursor(cursor: FiscalControlCursor): string {
  return Buffer.from(
    JSON.stringify({ ...cursor, uuid: cursor.uuid.toLowerCase() }),
    'utf8',
  ).toString('base64url')
}

function decodeCursor(value: string | null | undefined): FiscalControlCursor | null {
  if (!value || value.length > 512) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      !parsed
      || typeof parsed !== 'object'
      || (parsed as { v?: unknown }).v !== CURSOR_VERSION
      || typeof (parsed as { issuanceDate?: unknown }).issuanceDate !== 'string'
      || typeof (parsed as { uuid?: unknown }).uuid !== 'string'
    ) {
      return null
    }

    const cursor = parsed as FiscalControlCursor
    if (!toUtcCursorDate(cursor.issuanceDate) || !normalizeFiscalControlUuid(cursor.uuid)) {
      return null
    }

    return {
      v: CURSOR_VERSION,
      issuanceDate: cursor.issuanceDate,
      // Match PostgreSQL's canonical lowercase UUID representation.
      uuid: normalizeFiscalControlUuid(cursor.uuid).toLowerCase(),
    }
  } catch {
    return null
  }
}

function getPageSize(pageSize: number | undefined): number {
  if (!Number.isInteger(pageSize) || !pageSize || pageSize < 1) {
    return DEFAULT_PAGE_SIZE
  }

  return Math.min(pageSize, MAX_PAGE_SIZE)
}

function normalizeCfdiTypeBreakdownKey(value: string): FiscalControlCfdiTypeKey | undefined {
  const normalized = value.trim().toUpperCase()
  const keys: Record<string, FiscalControlCfdiTypeKey> = {
    I: 'ingreso',
    INGRESO: 'ingreso',
    E: 'egreso',
    EGRESO: 'egreso',
    N: 'nomina',
    NOMINA: 'nomina',
    P: 'pago',
    PAGO: 'pago',
    T: 'traslado',
    TRASLADO: 'traslado',
  }
  return keys[normalized]
}

function buildXmlTypeBreakdown(
  issuedGroups: readonly { cfdiType: string; _count: { _all: number } }[],
  receivedGroups: readonly { cfdiType: string; _count: { _all: number } }[],
  payrollTotal: number,
): FiscalControlCfdiTypeBreakdown {
  const breakdown = {
    ingreso: { emitidos: 0, recibidos: 0 },
    egreso: { emitidos: 0, recibidos: 0 },
    nomina: { emitidos: payrollTotal, recibidos: 0 },
    pago: { emitidos: 0, recibidos: 0 },
    traslado: { emitidos: 0, recibidos: 0 },
  }
  for (const group of issuedGroups) {
    const type = normalizeCfdiTypeBreakdownKey(group.cfdiType)
    if (type) {
      breakdown[type].emitidos += group._count._all
    }
  }
  for (const group of receivedGroups) {
    const type = normalizeCfdiTypeBreakdownKey(group.cfdiType)
    if (type) {
      breakdown[type].recibidos += group._count._all
    }
  }
  return breakdown
}

function buildCursorWhere(
  cursor: FiscalControlCursor | null,
  issuanceField: 'issuanceDate' | 'fechaEmision',
): Record<string, unknown> | undefined {
  if (!cursor) {
    return undefined
  }

  const cursorDate = toUtcCursorDate(cursor.issuanceDate)
  if (!cursorDate) {
    return undefined
  }

  return {
    OR: [
      { [issuanceField]: { lt: cursorDate } },
      { [issuanceField]: cursorDate, uuid: { lt: cursor.uuid } },
    ],
  }
}

function buildDateRange(
  startDate: Date | undefined,
  endDate: Date | undefined,
): DateRange | undefined {
  if (!startDate && !endDate) {
    return undefined
  }

  return {
    ...(startDate ? { gte: startDate } : {}),
    ...(endDate ? { lte: endDate } : {}),
  }
}

function createSourceAvailability(
  origin: FiscalControlOrigin,
  hasXml: boolean,
  xmlStorage: FiscalControlXmlStorage,
): FiscalControlSourceAvailability[] {
  if (!hasXml || xmlStorage === 'SIN_XML') {
    return []
  }

  return [{ origin, hasXml: true, xmlStorage }]
}

function getReconciliationStatus(
  hasMetadata: boolean,
  hasXml: boolean,
  metadataTotal: string | null,
  xmlTotals: ReadonlySet<string>,
): FiscalControlReconciliationStatus {
  if (!hasMetadata && !hasXml) {
    return 'XML_NO_DISPONIBLE'
  }

  if (
    hasXml
    && (
      xmlTotals.size > 1
      || (metadataTotal !== null && xmlTotals.size === 1 && !xmlTotals.has(metadataTotal))
    )
  ) {
    return 'CONFLICTO'
  }

  if (hasMetadata && !hasXml) {
    return 'METADATO_SIN_XML'
  }

  if (!hasMetadata && hasXml) {
    return 'XML_SIN_METADATO'
  }

  return 'CONCILIADO'
}

function normalizeCfdiType(value: string | undefined): string | undefined {
  if (!value || value === 'ALL') {
    return undefined
  }

  const normalized = value.trim().toUpperCase()
  const values: Record<string, string> = {
    INGRESO: 'I',
    EGRESO: 'E',
    TRASLADO: 'T',
    NOMINA: 'N',
    PAGO: 'P',
  }

  return values[normalized] ?? normalized
}

function normalizeStoredCfdiType(value: string | undefined): string | undefined {
  const normalized = normalizeCfdiType(value)
  const values: Record<string, string> = {
    I: 'INGRESO',
    E: 'EGRESO',
    T: 'TRASLADO',
    N: 'NOMINA',
    P: 'PAGO',
  }
  return normalized ? (values[normalized] ?? normalized) : undefined
}

function normalizeMetadataSatStatus(value: string | undefined): string | undefined {
  if (!value || value === 'ALL') {
    return undefined
  }

  const normalized = value.trim().toUpperCase()
  if (normalized === 'VIGENTE') {
    return '1'
  }
  if (normalized === 'CANCELADO') {
    return '0'
  }

  return normalized
}

function parseColumnDateRange(value: string): Prisma.DateTimeNullableFilter | undefined {
  const parts = value
    .trim()
    .split(/[/-]/)
    .map(Number)
    .filter(Number.isFinite)

  if (parts.length === 3) {
    const [day, month, year] = parts
    if (year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        gte: new Date(year, month - 1, day),
        lte: new Date(year, month - 1, day, 23, 59, 59, 999),
      }
    }
  }

  if (parts.length === 2) {
    const [month, year] = parts
    if (year > 1900 && month >= 1 && month <= 12) {
      return {
        gte: new Date(year, month - 1, 1),
        lte: new Date(year, month, 0, 23, 59, 59, 999),
      }
    }
  }

  if (parts.length === 1 && parts[0] > 1900 && parts[0] < 2100) {
    return {
      gte: new Date(parts[0], 0, 1),
      lte: new Date(parts[0], 11, 31, 23, 59, 59, 999),
    }
  }

  return undefined
}

function buildColumnFilterConditions(
  columnFilters: FiscalControlReconciliationFilters['columnFilters'],
  fields: Readonly<Partial<Record<FiscalControlColumnFilterKey, string>>>,
): Record<string, unknown>[] {
  if (!columnFilters) {
    return []
  }

  const conditions: Record<string, unknown>[] = []

  for (const [key, rawValue] of Object.entries(columnFilters)) {
    if (!FISCAL_CONTROL_COLUMN_FILTER_KEY_SET.has(key) || typeof rawValue !== 'string') {
      continue
    }

    const value = rawValue.trim()
    const field = fields[key as FiscalControlColumnFilterKey]
    const condition = buildColumnFilterCondition(
      key as FiscalControlColumnFilterKey,
      value,
      field,
    )
    if (condition) {
      conditions.push(condition)
    }
  }

  return conditions
}

function buildColumnFilterCondition(
  key: FiscalControlColumnFilterKey,
  value: string,
  field: string | undefined,
): Record<string, unknown> | undefined {
  if (!value || !field) {
    return undefined
  }

  if (key === 'cfdiType') {
    const cfdiType = normalizeCfdiType(value)
    return cfdiType ? { [field]: cfdiType } : undefined
  }

  if (key === 'total') {
    try {
      const total = new Prisma.Decimal(value.replace(/[^0-9.-]+/g, ''))
      return total.isFinite() ? { [field]: { equals: total } } : undefined
    } catch {
      // Un valor no numérico se ignora; no se degrada a una consulta amplia.
      return undefined
    }
  }

  if (key === 'issuanceDate' || key === 'certificationDate' || key === 'cancelationDate') {
    const range = parseColumnDateRange(value)
    return range ? { [field]: range } : undefined
  }

  return { [field]: { contains: value, mode: 'insensitive' } }
}

function sqlColumn(field: string): Prisma.Sql {
  return Prisma.raw(field.split('.').map(part => `"${part}"`).join('.'))
}

type SqlColumnFilterOptions = Readonly<{
  cfdiTypeStorage?: 'SAT' | 'CFDI'
  castCfdiTypeColumnToText?: boolean
}>

function buildSqlColumnFilterCondition(
  key: FiscalControlColumnFilterKey,
  value: string,
  field: string,
  options: SqlColumnFilterOptions,
): Prisma.Sql | undefined {
  const column = sqlColumn(field)
  if (key === 'cfdiType') {
    const cfdiType = options.cfdiTypeStorage === 'CFDI'
      ? normalizeStoredCfdiType(value)
      : normalizeCfdiType(value)
    if (!cfdiType) {
      return undefined
    }

    const comparisonColumn = options.castCfdiTypeColumnToText
      ? Prisma.sql`${column}::text`
      : column
    return Prisma.sql`${comparisonColumn} = ${cfdiType}`
  }

  if (key === 'total') {
    try {
      const total = new Prisma.Decimal(value.replace(/[^0-9.-]+/g, ''))
      return total.isFinite() ? Prisma.sql`${column} = ${total}` : undefined
    } catch {
      // Conserva la semántica de filtros inválidos: no amplían ni bloquean la consulta.
      return undefined
    }
  }

  if (key === 'issuanceDate' || key === 'certificationDate' || key === 'cancelationDate') {
    const range = parseColumnDateRange(value)
    return range
      ? Prisma.sql`${column} >= ${range.gte} AND ${column} <= ${range.lte}`
      : undefined
  }

  const searchValue = `%${value}%`
  return Prisma.sql`${column} ILIKE ${searchValue}`
}

function buildSqlColumnFilterConditions(
  columnFilters: FiscalControlReconciliationFilters['columnFilters'],
  fields: Readonly<Partial<Record<FiscalControlColumnFilterKey, string>>>,
  options: SqlColumnFilterOptions = {},
): Prisma.Sql[] {
  if (!columnFilters) {
    return []
  }

  const conditions: Prisma.Sql[] = []
  for (const [key, rawValue] of Object.entries(columnFilters)) {
    if (!FISCAL_CONTROL_COLUMN_FILTER_KEY_SET.has(key) || typeof rawValue !== 'string') {
      continue
    }

    const value = rawValue.trim()
    const field = fields[key as FiscalControlColumnFilterKey]
    if (!value || !field) {
      continue
    }

    const condition = buildSqlColumnFilterCondition(
      key as FiscalControlColumnFilterKey,
      value,
      field,
      options,
    )
    if (condition) {
      conditions.push(condition)
    }
  }

  return conditions
}

function buildSqlContainsPattern(value: string): string {
  return `%${value}%`
}

function buildConsolidatedColumnFilterConditions(
  columnFilters: FiscalControlReconciliationFilters['columnFilters'],
): Prisma.Sql[] {
  if (!columnFilters) {
    return []
  }

  const conditions: Prisma.Sql[] = []
  const origin = columnFilters.origins
  if (origin) {
    conditions.push(Prisma.sql`
      CONCAT_WS(' ',
        CASE WHEN has_emitidos THEN 'EMITIDO' END,
        CASE WHEN has_recibidos THEN 'RECIBIDO' END,
        CASE WHEN has_nomina THEN 'NOMINA' END
      ) ILIKE ${buildSqlContainsPattern(origin)}
    `)
  }
  const reconciliationStatus = columnFilters.reconciliationStatus
  if (reconciliationStatus) {
    conditions.push(Prisma.sql`
      (CASE reconciliation_status
        WHEN 'CONCILIADO' THEN 'CONCILIADO'
        WHEN 'METADATO_SIN_XML' THEN 'METADATO SIN XML'
        WHEN 'XML_SIN_METADATO' THEN 'XML SIN METADATO'
        WHEN 'XML_NO_DISPONIBLE' THEN 'XML NO DISPONIBLE'
        WHEN 'CONFLICTO' THEN 'CONFLICTO'
      END) ILIKE ${buildSqlContainsPattern(reconciliationStatus)}
    `)
  }
  const satStatus = columnFilters.satStatus
  if (satStatus) {
    conditions.push(Prisma.sql`
      CONCAT_WS(' ',
        CASE WHEN has_metadata_vigente OR has_xml_vigente THEN 'VIGENTE' END,
        CASE WHEN has_metadata_cancelado OR has_xml_cancelado THEN 'CANCELADO' END
      ) ILIKE ${buildSqlContainsPattern(satStatus)}
    `)
  }
  const hasXml = columnFilters.hasXml
  if (hasXml) {
    conditions.push(
      Prisma.sql`(CASE WHEN has_xml THEN 'XML' ELSE 'META' END) ILIKE ${buildSqlContainsPattern(hasXml)}`,
    )
  }
  return conditions
}

function buildSqlDateRangeConditions(
  field: string,
  range: DateRange | undefined,
): Prisma.Sql[] {
  if (!range) {
    return []
  }

  const column = sqlColumn(field)
  return [
    ...(range.gte ? [Prisma.sql`${column} >= ${range.gte}`] : []),
    ...(range.lte ? [Prisma.sql`${column} <= ${range.lte}`] : []),
  ]
}

function joinSqlConditions(conditions: readonly Prisma.Sql[]): Prisma.Sql {
  return conditions.length ? Prisma.join(conditions, ' AND ') : Prisma.sql`TRUE`
}

function getLatestDate(dates: readonly (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((latest, date) => {
    if (!date || (latest && latest >= date)) {
      return latest
    }

    return date
  }, null)
}

function firstNonEmpty(values: readonly string[]): string {
  return values.find(Boolean) ?? ''
}

function getPayrollXmlStorage(
  hasInvoiceBlob: boolean,
  hasInvoice: boolean,
): FiscalControlXmlStorage {
  if (hasInvoiceBlob) {
    return 'INVOICE_BLOB'
  }

  return hasInvoice ? 'INVOICE_LEGACY_CONTENT' : 'SAT_INVOICE_LEGACY_CONTENT'
}

/**
 * Consolida registros ya filtrados en memoria. El tamaño está acotado por las
 * lecturas keyset de cada origen; no recibe ni materializa el universo fiscal.
 */
export function consolidateFiscalControlCandidates(
  candidates: readonly SourceCandidate[],
): FiscalControlNormalizedRow[] {
  const grouped = new Map<string, SourceCandidate[]>()

  for (const candidate of candidates) {
    const uuid = normalizeFiscalControlUuid(candidate.uuid)
    if (!uuid) {
      continue
    }

    const current = grouped.get(uuid) ?? []
    current.push({ ...candidate, uuid })
    grouped.set(uuid, current)
  }

  return [...grouped.entries()]
    .map(([uuid, rows]) => {
      const metadataRows = rows.filter(row => row.hasMetadata)
      const xmlRows = rows.filter(row => row.origin)
      const origins = [...new Set(xmlRows.flatMap(row => (row.origin ? [row.origin] : [])))]
      const metadataTotal = metadataRows.find(row => row.total !== null)?.total ?? null
      const xmlTotals = new Set(
        xmlRows.flatMap(row => (row.total === null ? [] : [row.total])),
      )
      const xmlTotal = xmlTotals.values().next().value ?? null
      const hasXml = xmlRows.some(row => row.hasXml)
      const xmlStorage = xmlRows.find(row => row.hasXml)?.xmlStorage ?? 'SIN_XML'
      const sourceAvailability = xmlRows.flatMap(row =>
        row.origin
          ? createSourceAvailability(row.origin, row.hasXml, row.xmlStorage)
          : [],
      )

      return {
        uuid,
        origins,
        hasMetadata: metadataRows.length > 0,
        hasXml,
        xmlStorage,
        reconciliationStatus: getReconciliationStatus(
          metadataRows.length > 0,
          hasXml,
          metadataTotal,
          xmlTotals,
        ),
        issuerRfc: firstNonEmpty(rows.map(row => row.issuerRfc)),
        issuerName: firstNonEmpty(rows.map(row => row.issuerName)),
        receiverRfc: firstNonEmpty(rows.map(row => row.receiverRfc)),
        receiverName: firstNonEmpty(rows.map(row => row.receiverName)),
        cfdiType: firstNonEmpty(rows.map(row => row.cfdiType)),
        satStatus: firstNonEmpty(rows.map(row => row.satStatus)),
        issuanceDate: getLatestDate(rows.map(row => row.issuanceDate)),
        payrollPaymentDate: getLatestDate(rows.map(row => row.payrollPaymentDate)),
        total: xmlTotal ?? metadataTotal,
        metadataTotal,
        xmlTotal,
        sourceAvailability,
      } satisfies FiscalControlNormalizedRow
    })
    .sort((left, right) => {
      const byDate =
        (right.issuanceDate?.getTime() ?? Number.NEGATIVE_INFINITY)
        - (left.issuanceDate?.getTime() ?? Number.NEGATIVE_INFINITY)

      return byDate || right.uuid.localeCompare(left.uuid)
    })
}

function createSourceReadContext(
  filters: FiscalControlReconciliationFilters,
  cursor: FiscalControlCursor | null,
) {
  const companyRfc = filters.companyRfc.trim().toUpperCase()
  const scopedRfc = filters.rfc?.trim().toUpperCase()
  const issuanceRange = buildDateRange(filters.issuanceStartDate, filters.issuanceEndDate)
  const requiredIssuanceRange = buildDateRange(
    filters.issuanceStartDate,
    filters.issuanceEndDate,
  )
  const payrollPaymentRange = buildDateRange(
    filters.payrollPaymentStartDate,
    filters.payrollPaymentEndDate,
  )
  const invoiceCursorWhere = buildCursorWhere(cursor, 'issuanceDate')
  const metadataCursorWhere = buildCursorWhere(cursor, 'fechaEmision')
  const payrollCursorWhere = buildCursorWhere(cursor, 'fechaEmision')
  const cfdiType = normalizeCfdiType(filters.cfdiType)
  const type = cfdiType as CfdiType | undefined
  const satStatus = filters.satStatus as SatStatus | undefined
  const metadataSatStatus = normalizeMetadataSatStatus(filters.satStatus)
  const shouldReadPayroll = !cfdiType || cfdiType === 'N'
  const requestedOrigins = filters.origins
  const shouldReadOrigin = (origin: FiscalControlOrigin) =>
    !requestedOrigins?.length || requestedOrigins.includes(origin)
  const metadataColumnFilters = buildColumnFilterConditions(filters.columnFilters, {
    uuid: 'uuid',
    issuerRfc: 'rfcEmisor',
    issuerName: 'nombreEmisor',
    receiverRfc: 'rfcReceptor',
    receiverName: 'nombreReceptor',
    cfdiType: 'efectoComprobante',
    total: 'monto',
    issuanceDate: 'fechaEmision',
    certificationDate: 'fechaCertificacionSat',
    cancelationDate: 'fechaCancelacion',
    certificationPac: 'rfcPac',
  })
  const invoiceColumnFilters = buildColumnFilterConditions(filters.columnFilters, {
    uuid: 'uuid',
    issuerRfc: 'issuerRfc',
    issuerName: 'issuerName',
    receiverRfc: 'receiverRfc',
    receiverName: 'receiverName',
    cfdiType: 'cfdiType',
    total: 'total',
    issuanceDate: 'issuanceDate',
    certificationDate: 'certificationDate',
  })
  const receivedColumnFilters = buildColumnFilterConditions(filters.columnFilters, {
    uuid: 'uuid',
    issuerRfc: 'issuerRfc',
    issuerName: 'issuerName',
    receiverRfc: 'receiverRfc',
    receiverName: 'receiverName',
    cfdiType: 'cfdiType',
    total: 'total',
    issuanceDate: 'issuanceDate',
    certificationDate: 'certificationDate',
  })
  const payrollColumnFilters = buildColumnFilterConditions(filters.columnFilters, {
    uuid: 'uuid',
    issuanceDate: 'fechaEmision',
  })

  return {
    filters,
    companyRfc,
    scopedRfc,
    issuanceRange,
    requiredIssuanceRange,
    payrollPaymentRange,
    invoiceCursorWhere,
    metadataCursorWhere,
    payrollCursorWhere,
    cfdiType,
    type,
    satStatus,
    metadataSatStatus,
    shouldReadPayroll,
    shouldReadOrigin,
    metadataColumnFilters,
    invoiceColumnFilters,
    receivedColumnFilters,
    payrollColumnFilters,
  }
}

type SourceReadContext = ReturnType<typeof createSourceReadContext>

function buildMetadataWhere(context: SourceReadContext): Prisma.SatMetadataWhereInput {
  const {
    companyRfc,
    scopedRfc,
    issuanceRange,
    cfdiType,
    metadataSatStatus,
    metadataCursorWhere,
    metadataColumnFilters,
  } = context

  return {
    AND: [
      { OR: [{ rfcEmisor: companyRfc }, { rfcReceptor: companyRfc }] },
      { fechaEmision: { not: null, ...issuanceRange } },
      ...(scopedRfc
        ? [{ OR: [{ rfcEmisor: scopedRfc }, { rfcReceptor: scopedRfc }] }]
        : []),
      ...(cfdiType ? [{ efectoComprobante: cfdiType }] : []),
      ...(metadataSatStatus ? [{ estatus: metadataSatStatus }] : []),
      ...(metadataCursorWhere ? [metadataCursorWhere] : []),
      ...metadataColumnFilters,
    ],
  }
}

function buildIssuedWhere(context: SourceReadContext): Prisma.InvoiceWhereInput | undefined {
  const {
    filters,
    companyRfc,
    scopedRfc,
    type,
    satStatus,
    requiredIssuanceRange,
    invoiceCursorWhere,
    invoiceColumnFilters,
    shouldReadOrigin,
  } = context
  if (!filters.fiscalEntityId || !shouldReadOrigin('EMITIDO')) {
    return undefined
  }

  return {
    AND: [
      {
        issuerFiscalEntityId: filters.fiscalEntityId,
        issuerRfc: companyRfc,
        ...(scopedRfc
          ? { OR: [{ issuerRfc: scopedRfc }, { receiverRfc: scopedRfc }] }
          : {}),
        ...(type ? { cfdiType: type } : {}),
        ...(satStatus ? { satStatus } : {}),
        ...(requiredIssuanceRange ? { issuanceDate: requiredIssuanceRange } : {}),
      },
      ...(invoiceCursorWhere ? [invoiceCursorWhere] : []),
      ...invoiceColumnFilters,
    ],
  }
}

function buildReceivedWhere(
  context: SourceReadContext,
): Prisma.ProviderUploadedCfdiWhereInput | undefined {
  const {
    filters,
    scopedRfc,
    issuanceRange,
    cfdiType,
    invoiceCursorWhere,
    receivedColumnFilters,
    shouldReadOrigin,
  } = context
  if (!shouldReadOrigin('RECIBIDO')) {
    return undefined
  }

  return {
    AND: [
      {
        organizationId: filters.organizationId,
        receiverCompanyId: filters.companyId,
        issuanceDate: { not: null, ...issuanceRange },
        ...(scopedRfc
          ? { OR: [{ issuerRfc: scopedRfc }, { receiverRfc: scopedRfc }] }
          : {}),
        ...(cfdiType ? { cfdiType } : {}),
        ...(filters.satStatus ? { satEstado: filters.satStatus } : {}),
      },
      ...(invoiceCursorWhere ? [invoiceCursorWhere] : []),
      ...receivedColumnFilters,
    ],
  }
}

function buildPayrollWhere(context: SourceReadContext): Prisma.PayrollReceiptWhereInput | undefined {
  const {
    filters,
    requiredIssuanceRange,
    payrollPaymentRange,
    payrollCursorWhere,
    payrollColumnFilters,
    shouldReadPayroll,
    shouldReadOrigin,
  } = context
  if (!shouldReadPayroll || !shouldReadOrigin('NOMINA')) {
    return undefined
  }

  return {
    AND: [
      {
        organizationId: filters.organizationId,
        companyId: filters.companyId,
        ...(requiredIssuanceRange ? { fechaEmision: requiredIssuanceRange } : {}),
        ...(payrollPaymentRange ? { fechaPago: payrollPaymentRange } : {}),
      },
      ...(payrollCursorWhere ? [payrollCursorWhere] : []),
      ...payrollColumnFilters,
    ],
  }
}

function readMetadataRows(
  context: SourceReadContext,
  take: number,
  uuids?: readonly string[],
) {
  return prisma.satMetadata.findMany({
    where: uuids
      ? { AND: [buildMetadataWhere(context), { uuid: { in: [...uuids] } }] }
      : buildMetadataWhere(context),
    orderBy: [{ fechaEmision: 'desc' }, { uuid: 'desc' }],
    take,
    select: {
      uuid: true,
      rfcEmisor: true,
      nombreEmisor: true,
      rfcReceptor: true,
      nombreReceptor: true,
      efectoComprobante: true,
      estatus: true,
      fechaEmision: true,
      monto: true,
    },
  })
}

function readIssuedRows(
  context: SourceReadContext,
  take: number,
  uuids?: readonly string[],
) {
  const where = buildIssuedWhere(context)
  if (!where) {
    return Promise.resolve([])
  }

  return prisma.invoice.findMany({
    where: uuids ? { AND: [where, { uuid: { in: [...uuids] } }] } : where,
    orderBy: [{ issuanceDate: 'desc' }, { uuid: 'desc' }],
    take,
    select: {
      uuid: true,
      issuerRfc: true,
      issuerName: true,
      receiverRfc: true,
      receiverName: true,
      cfdiType: true,
      satStatus: true,
      issuanceDate: true,
      total: true,
      blob: { select: { invoiceId: true } },
    },
  })
}

function readReceivedRows(
  context: SourceReadContext,
  take: number,
  uuids?: readonly string[],
) {
  const where = buildReceivedWhere(context)
  if (!where) {
    return Promise.resolve([])
  }

  return prisma.providerUploadedCfdi.findMany({
    where: uuids ? { AND: [where, { uuid: { in: [...uuids] } }] } : where,
    orderBy: [{ issuanceDate: 'desc' }, { uuid: 'desc' }],
    take,
    select: {
      uuid: true,
      issuerRfc: true,
      issuerName: true,
      receiverRfc: true,
      receiverName: true,
      cfdiType: true,
      satEstado: true,
      issuanceDate: true,
      total: true,
      xmlBlob: { select: { providerUploadedCfdiId: true } },
    },
  })
}

function readPayrollRows(
  context: SourceReadContext,
  take: number,
  uuids?: readonly string[],
) {
  const where = buildPayrollWhere(context)
  if (!where) {
    return Promise.resolve([])
  }

  return prisma.payrollReceipt.findMany({
    where: uuids ? { AND: [where, { uuid: { in: [...uuids] } }] } : where,
    orderBy: [{ fechaEmision: 'desc' }, { uuid: 'desc' }],
    take,
    select: {
      uuid: true,
      fechaEmision: true,
      fechaPago: true,
      invoice: {
        select: {
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          cfdiType: true,
          satStatus: true,
          total: true,
          blob: { select: { invoiceId: true } },
        },
      },
      satInvoice: {
        select: {
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          cfdiType: true,
          satStatus: true,
          total: true,
        },
      },
    },
  })
}

/**
 * Counts filtered records at the database instead of materializing rows.
 * XML totals include all supported storage origins, matching the detail table.
 */
export async function readFiscalControlConciliationTotals(
  filters: FiscalControlReconciliationFilters,
): Promise<FiscalControlConciliationTotals> {
  const context = createSourceReadContext(filters, null)
  const metadataWhere = buildMetadataWhere(context)
  const issuedWhere = buildIssuedWhere(context)
  const receivedWhere = buildReceivedWhere(context)
  const payrollWhere = buildPayrollWhere(context)

  const [metadataTotal, issuedGroups, receivedGroups, nomina] = await Promise.all([
    prisma.satMetadata.count({ where: metadataWhere }),
    issuedWhere
      ? prisma.invoice.groupBy({
          by: ['cfdiType'],
          where: issuedWhere,
          _count: { _all: true },
        })
      : [],
    receivedWhere
      ? prisma.providerUploadedCfdi.groupBy({
          by: ['cfdiType'],
          where: { AND: [receivedWhere, { xmlBlob: { isNot: null } }] },
          _count: { _all: true },
        })
      : [],
    payrollWhere
      ? prisma.payrollReceipt.count({
          where: {
            AND: [
              payrollWhere,
              { OR: [{ invoice: { isNot: null } }, { satInvoice: { isNot: null } }] },
            ],
          },
        })
      : 0,
  ])
  const xmlTypeBreakdown = buildXmlTypeBreakdown(issuedGroups, receivedGroups, nomina)
  const emitidos = issuedGroups.reduce((total, group) => total + group._count._all, 0)
  const recibidos = receivedGroups.reduce((total, group) => total + group._count._all, 0)

  return {
    metadataTotal,
    xmlTotal: emitidos + recibidos + nomina,
    xmlTypeBreakdown,
    byOrigin: { emitidos, recibidos, nomina },
  }
}

type FiscalControlGlobalSummaryRow = Readonly<{
  totalRows: bigint
  metadata: bigint
  emitidos: bigint
  recibidos: bigint
  nomina: bigint
  reconciled: bigint
  metadataWithoutXml: bigint
  xmlWithoutMetadata: bigint
  xmlUnavailable: bigint
  conflicts: bigint
  metadataVigentes: bigint
  metadataCancelados: bigint
  xmlVigentes: bigint
  xmlCancelados: bigint
}>

function countFromGlobalSummary(row: FiscalControlGlobalSummaryRow, key: keyof FiscalControlGlobalSummaryRow) {
  return Number(row[key])
}

function buildGlobalMetadataConditions(
  context: SourceReadContext,
  filters: FiscalControlReconciliationFilters,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`("rfc_emisor" = ${context.companyRfc} OR "rfc_receptor" = ${context.companyRfc})`,
    Prisma.sql`"fecha_emision" IS NOT NULL`,
    ...buildSqlDateRangeConditions('fecha_emision', context.issuanceRange),
    ...buildSqlColumnFilterConditions(filters.columnFilters, {
      uuid: 'uuid',
      issuerRfc: 'rfc_emisor',
      issuerName: 'nombre_emisor',
      receiverRfc: 'rfc_receptor',
      receiverName: 'nombre_receptor',
      cfdiType: 'efecto_comprobante',
      total: 'monto',
      issuanceDate: 'fecha_emision',
      certificationDate: 'fecha_certificacion_sat',
      cancelationDate: 'fecha_cancelacion',
      certificationPac: 'rfc_pac',
    }),
  ]
  if (context.scopedRfc) {
    conditions.push(Prisma.sql`("rfc_emisor" = ${context.scopedRfc} OR "rfc_receptor" = ${context.scopedRfc})`)
  }
  if (context.cfdiType) conditions.push(Prisma.sql`"efecto_comprobante" = ${context.cfdiType}`)
  if (context.metadataSatStatus) conditions.push(Prisma.sql`"estatus" = ${context.metadataSatStatus}`)
  return conditions
}

function buildGlobalIssuedConditions(
  context: SourceReadContext,
  filters: FiscalControlReconciliationFilters,
  storedCfdiType: string | undefined,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"issuer_fiscal_entity_id" = ${context.filters.fiscalEntityId}`,
    Prisma.sql`"issuer_rfc" = ${context.companyRfc}`,
    ...buildSqlDateRangeConditions('issuance_date', context.requiredIssuanceRange),
    ...buildSqlColumnFilterConditions(filters.columnFilters, {
      uuid: 'uuid', issuerRfc: 'issuer_rfc', issuerName: 'issuer_name', receiverRfc: 'receiver_rfc',
      receiverName: 'receiver_name', cfdiType: 'cfdi_type', total: 'total', issuanceDate: 'issuance_date',
      certificationDate: 'certification_date',
    }, { cfdiTypeStorage: 'CFDI', castCfdiTypeColumnToText: true }),
  ]
  if (context.scopedRfc) conditions.push(Prisma.sql`("issuer_rfc" = ${context.scopedRfc} OR "receiver_rfc" = ${context.scopedRfc})`)
  if (storedCfdiType) conditions.push(Prisma.sql`"cfdi_type"::text = ${storedCfdiType}`)
  if (context.satStatus) conditions.push(Prisma.sql`"sat_status" = ${context.satStatus}`)
  return conditions
}

function buildGlobalReceivedConditions(
  context: SourceReadContext,
  filters: FiscalControlReconciliationFilters,
  storedCfdiType: string | undefined,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"organization_id" = ${filters.organizationId}`,
    Prisma.sql`"receiver_company_id" = ${filters.companyId}`,
    Prisma.sql`"issuance_date" IS NOT NULL`,
    ...buildSqlDateRangeConditions('issuance_date', context.issuanceRange),
    ...buildSqlColumnFilterConditions(filters.columnFilters, {
      uuid: 'uuid', issuerRfc: 'issuer_rfc', issuerName: 'issuer_name', receiverRfc: 'receiver_rfc',
      receiverName: 'receiver_name', cfdiType: 'cfdi_type', total: 'total', issuanceDate: 'issuance_date',
      certificationDate: 'certification_date',
    }, { cfdiTypeStorage: 'CFDI' }),
  ]
  if (context.scopedRfc) conditions.push(Prisma.sql`("issuer_rfc" = ${context.scopedRfc} OR "receiver_rfc" = ${context.scopedRfc})`)
  if (storedCfdiType) conditions.push(Prisma.sql`"cfdi_type" = ${storedCfdiType}`)
  if (filters.satStatus) conditions.push(Prisma.sql`UPPER(BTRIM("sat_estado")) = ${filters.satStatus}`)
  return conditions
}

function buildGlobalPayrollConditions(
  context: SourceReadContext,
  filters: FiscalControlReconciliationFilters,
): Prisma.Sql[] {
  return [
    Prisma.sql`p."organization_id" = ${filters.organizationId}`,
    Prisma.sql`p."company_id" = ${filters.companyId}`,
    Prisma.sql`(i."id" IS NOT NULL OR s."id" IS NOT NULL)`,
    ...buildSqlDateRangeConditions('p.fecha_emision', context.requiredIssuanceRange),
    ...buildSqlDateRangeConditions('p.fecha_pago', context.payrollPaymentRange),
    ...buildSqlColumnFilterConditions(filters.columnFilters, {
      uuid: 'p.uuid',
      issuanceDate: 'p.fecha_emision',
    }),
  ]
}

function buildMonthlyMetadataConditions(
  context: SourceReadContext,
  filters: FiscalControlReconciliationFilters,
): Prisma.Sql[] {
  const conditions = buildGlobalMetadataConditions(context, filters)
  if (!filters.origins?.length) {
    return conditions
  }

  const originConditions: Prisma.Sql[] = []
  if (filters.origins.includes('EMITIDO')) {
    originConditions.push(Prisma.sql`"rfc_emisor" = ${context.companyRfc}`)
  }
  if (filters.origins.includes('RECIBIDO')) {
    originConditions.push(Prisma.sql`"rfc_receptor" = ${context.companyRfc}`)
  }
  if (filters.origins.includes('NOMINA')) {
    originConditions.push(Prisma.sql`"efecto_comprobante" = 'N'`)
  }
  conditions.push(Prisma.sql`(${Prisma.join(originConditions, ' OR ')})`)
  return conditions
}

function buildStatusMetadataConditions(context: SourceReadContext): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`("rfc_emisor" = ${context.companyRfc} OR "rfc_receptor" = ${context.companyRfc})`,
    Prisma.sql`"fecha_emision" IS NOT NULL`,
    ...buildSqlDateRangeConditions('fecha_emision', context.issuanceRange),
  ]
  if (context.scopedRfc) conditions.push(Prisma.sql`("rfc_emisor" = ${context.scopedRfc} OR "rfc_receptor" = ${context.scopedRfc})`)
  if (context.cfdiType) conditions.push(Prisma.sql`"efecto_comprobante" = ${context.cfdiType}`)
  return conditions
}

function buildStatusIssuedConditions(context: SourceReadContext, storedCfdiType: string | undefined): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"issuer_fiscal_entity_id" = ${context.filters.fiscalEntityId}`,
    Prisma.sql`"issuer_rfc" = ${context.companyRfc}`,
    ...buildSqlDateRangeConditions('issuance_date', context.requiredIssuanceRange),
  ]
  if (context.scopedRfc) conditions.push(Prisma.sql`("issuer_rfc" = ${context.scopedRfc} OR "receiver_rfc" = ${context.scopedRfc})`)
  if (storedCfdiType) conditions.push(Prisma.sql`"cfdi_type"::text = ${storedCfdiType}`)
  return conditions
}

function buildStatusReceivedConditions(
  context: SourceReadContext,
  filters: FiscalControlReconciliationFilters,
  storedCfdiType: string | undefined,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"organization_id" = ${filters.organizationId}`,
    Prisma.sql`"receiver_company_id" = ${filters.companyId}`,
    Prisma.sql`"issuance_date" IS NOT NULL`,
    ...buildSqlDateRangeConditions('issuance_date', context.issuanceRange),
  ]
  if (context.scopedRfc) conditions.push(Prisma.sql`("issuer_rfc" = ${context.scopedRfc} OR "receiver_rfc" = ${context.scopedRfc})`)
  if (storedCfdiType) conditions.push(Prisma.sql`"cfdi_type" = ${storedCfdiType}`)
  return conditions
}

function buildStatusPayrollConditions(
  context: SourceReadContext,
  filters: FiscalControlReconciliationFilters,
): Prisma.Sql[] {
  return [
    Prisma.sql`p."organization_id" = ${filters.organizationId}`,
    Prisma.sql`p."company_id" = ${filters.companyId}`,
    Prisma.sql`(i."id" IS NOT NULL OR s."id" IS NOT NULL)`,
    ...buildSqlDateRangeConditions('p.fecha_emision', context.requiredIssuanceRange),
    ...buildSqlDateRangeConditions('p.fecha_pago', context.payrollPaymentRange),
  ]
}

/**
 * Consolida los UUID en PostgreSQL para que el resumen no dependa de la página
 * actual ni materialice el rango completo en memoria.
 */
export async function readFiscalControlGlobalReconciliationSummary(
  filters: FiscalControlReconciliationFilters,
  page?: FiscalControlGlobalPageInput,
): Promise<FiscalControlGlobalReconciliationResult> {
  const context = createSourceReadContext(filters, null)
  const storedCfdiType = normalizeStoredCfdiType(filters.cfdiType)
  const metadataConditions = buildGlobalMetadataConditions(context, filters)

  const sourceQueries: Prisma.Sql[] = [
    Prisma.sql`
      SELECT
        UPPER(BTRIM("uuid")) AS uuid,
        TRUE AS has_metadata,
        FALSE AS has_xml,
        FALSE AS has_emitidos,
        FALSE AS has_recibidos,
        FALSE AS has_nomina,
        "estatus" = '1' AS has_metadata_vigente,
        "estatus" = '0' AS has_metadata_cancelado,
        FALSE AS has_xml_vigente,
        FALSE AS has_xml_cancelado,
        "monto" AS metadata_total,
        NULL::numeric AS xml_total,
        "fecha_emision" AS issuance_date
      FROM "sat_metadata"
      WHERE ${joinSqlConditions(metadataConditions)}
    `,
  ]

  if (context.filters.fiscalEntityId && context.shouldReadOrigin('EMITIDO')) {
    const issuedConditions = buildGlobalIssuedConditions(context, filters, storedCfdiType)
    sourceQueries.push(Prisma.sql`
      SELECT
        UPPER(BTRIM("uuid")) AS uuid,
        FALSE AS has_metadata,
        TRUE AS has_xml,
        TRUE AS has_emitidos,
        FALSE AS has_recibidos,
        FALSE AS has_nomina,
        FALSE AS has_metadata_vigente,
        FALSE AS has_metadata_cancelado,
        "sat_status"::text = 'VIGENTE' AS has_xml_vigente,
        "sat_status"::text = 'CANCELADO' AS has_xml_cancelado,
        NULL::numeric AS metadata_total,
        "total" AS xml_total,
        "issuance_date" AS issuance_date
      FROM "invoices"
      WHERE ${joinSqlConditions(issuedConditions)}
    `)
  }

  if (context.shouldReadOrigin('RECIBIDO')) {
    const receivedConditions = buildGlobalReceivedConditions(context, filters, storedCfdiType)
    sourceQueries.push(Prisma.sql`
      SELECT
        UPPER(BTRIM(p."uuid")) AS uuid,
        FALSE AS has_metadata,
        EXISTS (
          SELECT 1
          FROM "provider_uploaded_cfdi_blobs" b
          WHERE b."provider_uploaded_cfdi_id" = p."id"
        ) AS has_xml,
        FALSE AS has_emitidos,
        TRUE AS has_recibidos,
        FALSE AS has_nomina,
        FALSE AS has_metadata_vigente,
        FALSE AS has_metadata_cancelado,
        EXISTS (
          SELECT 1
          FROM "provider_uploaded_cfdi_blobs" b
          WHERE b."provider_uploaded_cfdi_id" = p."id"
        ) AND UPPER(BTRIM(p."sat_estado")) = 'VIGENTE' AS has_xml_vigente,
        EXISTS (
          SELECT 1
          FROM "provider_uploaded_cfdi_blobs" b
          WHERE b."provider_uploaded_cfdi_id" = p."id"
        ) AND UPPER(BTRIM(p."sat_estado")) = 'CANCELADO' AS has_xml_cancelado,
        NULL::numeric AS metadata_total,
        p."total" AS xml_total,
        p."issuance_date" AS issuance_date
      FROM "provider_uploaded_cfdis" p
      WHERE ${joinSqlConditions(receivedConditions)}
    `)
  }

  if (context.shouldReadPayroll && context.shouldReadOrigin('NOMINA')) {
    const payrollConditions = buildGlobalPayrollConditions(context, filters)
    sourceQueries.push(Prisma.sql`
      SELECT
        UPPER(BTRIM(p."uuid")) AS uuid,
        FALSE AS has_metadata,
        TRUE AS has_xml,
        FALSE AS has_emitidos,
        FALSE AS has_recibidos,
        TRUE AS has_nomina,
        FALSE AS has_metadata_vigente,
        FALSE AS has_metadata_cancelado,
        COALESCE(i."sat_status"::text, s."sat_status"::text) = 'VIGENTE' AS has_xml_vigente,
        COALESCE(i."sat_status"::text, s."sat_status"::text) = 'CANCELADO' AS has_xml_cancelado,
        NULL::numeric AS metadata_total,
        COALESCE(i."total", s."total") AS xml_total,
        p."fecha_emision" AS issuance_date
      FROM "payroll_receipts" p
      LEFT JOIN "invoices" i ON i."id" = p."invoice_id"
      LEFT JOIN "sat_invoices" s ON s."id" = p."sat_invoice_id"
      WHERE ${joinSqlConditions(payrollConditions)}
    `)
  }

  const consolidatedColumnFilterConditions = buildConsolidatedColumnFilterConditions(
    filters.columnFilters,
  )
  const consolidatedColumnFilterSql = consolidatedColumnFilterConditions.length
    ? joinSqlConditions(consolidatedColumnFilterConditions)
    : Prisma.empty
  const consolidatedColumnFilterWhere = consolidatedColumnFilterConditions.length
    ? Prisma.sql`WHERE ${consolidatedColumnFilterSql}`
    : Prisma.empty
  const consolidatedColumnFilterAnd = consolidatedColumnFilterConditions.length
    ? Prisma.sql`AND ${consolidatedColumnFilterSql}`
    : Prisma.empty

  const summaryQuery = Prisma.sql`
    WITH candidates AS (
      ${Prisma.join(sourceQueries, ' UNION ALL ')}
    ),
    consolidated AS (
      SELECT
        uuid,
        BOOL_OR(has_metadata) AS has_metadata,
        BOOL_OR(has_xml) AS has_xml,
        BOOL_OR(has_emitidos) AS has_emitidos,
        BOOL_OR(has_recibidos) AS has_recibidos,
        BOOL_OR(has_nomina) AS has_nomina,
        BOOL_OR(has_metadata_vigente) AS has_metadata_vigente,
        BOOL_OR(has_metadata_cancelado) AS has_metadata_cancelado,
        BOOL_OR(has_xml_vigente) AS has_xml_vigente,
        BOOL_OR(has_xml_cancelado) AS has_xml_cancelado,
        MAX(metadata_total) AS metadata_total,
        COUNT(DISTINCT xml_total) FILTER (WHERE xml_total IS NOT NULL) AS xml_total_count,
        MAX(xml_total) AS xml_total,
        MAX(issuance_date) AS issuance_date
      FROM candidates
      WHERE uuid <> ''
      GROUP BY uuid
    ),
    classified AS (
      SELECT *,
        CASE
          WHEN NOT has_metadata AND NOT has_xml THEN 'XML_NO_DISPONIBLE'
          WHEN has_xml AND (
            xml_total_count > 1
            OR (metadata_total IS NOT NULL AND xml_total_count = 1 AND xml_total <> metadata_total)
          ) THEN 'CONFLICTO'
          WHEN has_metadata AND NOT has_xml THEN 'METADATO_SIN_XML'
          WHEN NOT has_metadata AND has_xml THEN 'XML_SIN_METADATO'
          ELSE 'CONCILIADO'
        END AS reconciliation_status
      FROM consolidated
    )
    SELECT
      COUNT(*) AS "totalRows",
      COUNT(*) FILTER (WHERE has_metadata) AS metadata,
      COUNT(*) FILTER (WHERE has_emitidos) AS emitidos,
      COUNT(*) FILTER (WHERE has_recibidos) AS recibidos,
      COUNT(*) FILTER (WHERE has_nomina) AS nomina,
      COUNT(*) FILTER (WHERE reconciliation_status = 'CONCILIADO') AS reconciled,
      COUNT(*) FILTER (WHERE reconciliation_status = 'METADATO_SIN_XML') AS "metadataWithoutXml",
      COUNT(*) FILTER (WHERE reconciliation_status = 'XML_SIN_METADATO') AS "xmlWithoutMetadata",
      COUNT(*) FILTER (WHERE reconciliation_status = 'XML_NO_DISPONIBLE') AS "xmlUnavailable",
      COUNT(*) FILTER (WHERE reconciliation_status = 'CONFLICTO') AS conflicts,
      COUNT(*) FILTER (WHERE has_metadata_vigente) AS "metadataVigentes",
      COUNT(*) FILTER (WHERE has_metadata_cancelado) AS "metadataCancelados",
      COUNT(*) FILTER (WHERE has_xml_vigente) AS "xmlVigentes",
      COUNT(*) FILTER (WHERE has_xml_cancelado) AS "xmlCancelados"
    FROM classified
    ${consolidatedColumnFilterWhere}
  `
  const pageCursorWhere = page?.cursor
    ? Prisma.sql`
      AND (
        issuance_date < ${toUtcCursorDate(page.cursor.issuanceDate)}
        OR (
          issuance_date = ${toUtcCursorDate(page.cursor.issuanceDate)}
          AND uuid < ${page.cursor.uuid.toUpperCase()}
        )
      )
    `
    : Prisma.empty
  const pageOriginWhere = filters.origins?.length
    ? Prisma.sql`AND (${Prisma.join(
        filters.origins.map(origin => {
          const columns: Record<FiscalControlOrigin, Prisma.Sql> = {
            EMITIDO: Prisma.sql`has_emitidos`,
            RECIBIDO: Prisma.sql`has_recibidos`,
            NOMINA: Prisma.sql`has_nomina`,
          }
          return columns[origin]
        }),
        ' OR ',
      )})`
    : Prisma.empty
  const pageQuery = page
    ? Prisma.sql`
        WITH candidates AS (
          ${Prisma.join(sourceQueries, ' UNION ALL ')}
        ),
        consolidated AS (
          SELECT
            uuid,
            BOOL_OR(has_metadata) AS has_metadata,
            BOOL_OR(has_xml) AS has_xml,
            BOOL_OR(has_emitidos) AS has_emitidos,
            BOOL_OR(has_recibidos) AS has_recibidos,
            BOOL_OR(has_nomina) AS has_nomina,
            BOOL_OR(has_metadata_vigente) AS has_metadata_vigente,
            BOOL_OR(has_metadata_cancelado) AS has_metadata_cancelado,
            BOOL_OR(has_xml_vigente) AS has_xml_vigente,
            BOOL_OR(has_xml_cancelado) AS has_xml_cancelado,
            MAX(metadata_total) AS metadata_total,
            COUNT(DISTINCT xml_total) FILTER (WHERE xml_total IS NOT NULL) AS xml_total_count,
            MAX(xml_total) AS xml_total,
            MAX(issuance_date) AS issuance_date
          FROM candidates
          WHERE uuid <> ''
          GROUP BY uuid
        ),
        classified AS (
          SELECT *,
            CASE
              WHEN NOT has_metadata AND NOT has_xml THEN 'XML_NO_DISPONIBLE'
              WHEN has_xml AND (
                xml_total_count > 1
                OR (metadata_total IS NOT NULL AND xml_total_count = 1 AND xml_total <> metadata_total)
              ) THEN 'CONFLICTO'
              WHEN has_metadata AND NOT has_xml THEN 'METADATO_SIN_XML'
              WHEN NOT has_metadata AND has_xml THEN 'XML_SIN_METADATO'
              ELSE 'CONCILIADO'
            END AS reconciliation_status
          FROM consolidated
        )
        SELECT uuid
        FROM classified
        WHERE issuance_date IS NOT NULL
        ${consolidatedColumnFilterAnd}
        ${pageOriginWhere}
        ${pageCursorWhere}
        ORDER BY issuance_date DESC, uuid DESC
        LIMIT ${page.pageSize + 1}
      `
    : null
  const transactionStatements = [
    // JIT costs more than it saves for this ad-hoc, aggregate-heavy query.
    prisma.$executeRaw`SET LOCAL jit = off`,
    prisma.$queryRaw<FiscalControlGlobalSummaryRow[]>(summaryQuery),
    ...(pageQuery ? [prisma.$queryRaw<FiscalControlGlobalPageRow[]>(pageQuery)] : []),
  ]
  const transactionResults = await prisma.$transaction(transactionStatements)
  const rows = transactionResults[1] as FiscalControlGlobalSummaryRow[]
  const pageRows = pageQuery
    ? transactionResults[2] as FiscalControlGlobalPageRow[]
    : undefined
  const [row] = rows

  const emptyRow: FiscalControlGlobalSummaryRow = {
    totalRows: BigInt(0),
    metadata: BigInt(0),
    emitidos: BigInt(0),
    recibidos: BigInt(0),
    nomina: BigInt(0),
    reconciled: BigInt(0),
    metadataWithoutXml: BigInt(0),
    xmlWithoutMetadata: BigInt(0),
    xmlUnavailable: BigInt(0),
    conflicts: BigInt(0),
    metadataVigentes: BigInt(0),
    metadataCancelados: BigInt(0),
    xmlVigentes: BigInt(0),
    xmlCancelados: BigInt(0),
  }
  const summary = row ?? emptyRow

  return {
    scope: 'RANGE',
    ...(pageRows ? { pageRows } : {}),
    sourceCounts: {
      metadata: countFromGlobalSummary(summary, 'metadata'),
      emitidos: countFromGlobalSummary(summary, 'emitidos'),
      recibidos: countFromGlobalSummary(summary, 'recibidos'),
      nomina: countFromGlobalSummary(summary, 'nomina'),
    },
    reconciliationSummary: {
      totalRows: countFromGlobalSummary(summary, 'totalRows'),
      reconciled: countFromGlobalSummary(summary, 'reconciled'),
      metadataWithoutXml: countFromGlobalSummary(summary, 'metadataWithoutXml'),
      xmlWithoutMetadata: countFromGlobalSummary(summary, 'xmlWithoutMetadata'),
      xmlUnavailable: countFromGlobalSummary(summary, 'xmlUnavailable'),
      conflicts: countFromGlobalSummary(summary, 'conflicts'),
    },
    statusComparison: {
      vigentes: {
        metadata: countFromGlobalSummary(summary, 'metadataVigentes'),
        xml: countFromGlobalSummary(summary, 'xmlVigentes'),
        difference:
          countFromGlobalSummary(summary, 'metadataVigentes')
          - countFromGlobalSummary(summary, 'xmlVigentes'),
      },
      cancelados: {
        metadata: countFromGlobalSummary(summary, 'metadataCancelados'),
        xml: countFromGlobalSummary(summary, 'xmlCancelados'),
        difference:
          countFromGlobalSummary(summary, 'metadataCancelados')
          - countFromGlobalSummary(summary, 'xmlCancelados'),
      },
    },
  }
}

async function readSourceCandidates(
  filters: FiscalControlReconciliationFilters,
  cursor: FiscalControlCursor | null,
  take: number,
  uuids?: readonly string[],
): Promise<SourceCandidateBatch> {
  const context = createSourceReadContext(filters, cursor)
  const [metadata, issued, received, payroll] = await Promise.all([
    readMetadataRows(context, take, uuids),
    readIssuedRows(context, take, uuids),
    readReceivedRows(context, take, uuids),
    readPayrollRows(context, take, uuids),
  ])

  return {
    candidates: [
    ...metadata.map(
      row =>
        ({
          uuid: row.uuid,
          hasMetadata: true,
          hasXml: false,
          xmlStorage: 'SIN_XML',
          issuerRfc: row.rfcEmisor,
          issuerName: row.nombreEmisor ?? '',
          receiverRfc: row.rfcReceptor,
          receiverName: row.nombreReceptor ?? '',
          cfdiType: row.efectoComprobante ?? '',
          satStatus: row.estatus ?? '',
          issuanceDate: row.fechaEmision,
          payrollPaymentDate: null,
          total: toDecimalString(row.monto),
        }) satisfies SourceCandidate,
    ),
    ...issued.map(
      row =>
        ({
          uuid: row.uuid,
          origin: 'EMITIDO',
          hasMetadata: false,
          hasXml: true,
          xmlStorage: row.blob ? 'INVOICE_BLOB' : 'INVOICE_LEGACY_CONTENT',
          issuerRfc: row.issuerRfc,
          issuerName: row.issuerName,
          receiverRfc: row.receiverRfc,
          receiverName: row.receiverName,
          cfdiType: row.cfdiType,
          satStatus: row.satStatus,
          issuanceDate: row.issuanceDate,
          payrollPaymentDate: null,
          total: toDecimalString(row.total),
        }) satisfies SourceCandidate,
    ),
    ...received.map(
      row =>
        ({
          uuid: row.uuid,
          origin: 'RECIBIDO',
          hasMetadata: false,
          hasXml: Boolean(row.xmlBlob),
          xmlStorage: row.xmlBlob ? 'PROVIDER_UPLOADED_CFDI_BLOB' : 'SIN_XML',
          issuerRfc: row.issuerRfc,
          issuerName: row.issuerName ?? '',
          receiverRfc: row.receiverRfc,
          receiverName: row.receiverName ?? '',
          cfdiType: row.cfdiType,
          satStatus: row.satEstado ?? '',
          issuanceDate: row.issuanceDate,
          payrollPaymentDate: null,
          total: toDecimalString(row.total),
        }) satisfies SourceCandidate,
    ),
    ...payroll.flatMap(row => {
      const invoice = row.invoice ?? row.satInvoice
      if (!invoice) {
        return []
      }

      return [
        {
          uuid: row.uuid,
          origin: 'NOMINA',
          hasMetadata: false,
          hasXml: true,
          xmlStorage: getPayrollXmlStorage(Boolean(row.invoice?.blob), Boolean(row.invoice)),
          issuerRfc: invoice.issuerRfc,
          issuerName: invoice.issuerName,
          receiverRfc: invoice.receiverRfc,
          receiverName: invoice.receiverName,
          cfdiType: invoice.cfdiType,
          satStatus: invoice.satStatus,
          issuanceDate: row.fechaEmision,
          payrollPaymentDate: row.fechaPago,
          total: toDecimalString(invoice.total),
        } satisfies SourceCandidate,
      ]
    }),
    ],
    hasPotentialMore: [metadata, issued, received, payroll].some(rows => rows.length === take),
  }
}

function normalizeDetailLookupUuids(uuids: readonly string[]): string[] {
  return uuids
    .map(normalizeFiscalControlUuid)
    .filter(Boolean)
}

function buildFiscalControlPageCacheKey(input: FiscalControlConciliationPageInput): string {
  const { filters } = input
  const cacheInput = {
    organizationId: filters.organizationId,
    companyId: filters.companyId,
    companyRfc: filters.companyRfc,
    fiscalEntityId: filters.fiscalEntityId ?? null,
    origins: [...(filters.origins ?? [])].sort((left, right) =>
      left.localeCompare(right),
    ),
    rfc: filters.rfc ?? null,
    cfdiType: filters.cfdiType ?? null,
    satStatus: filters.satStatus ?? null,
    columnFilters: Object.entries(filters.columnFilters ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    issuanceStartDate: filters.issuanceStartDate?.toISOString() ?? null,
    issuanceEndDate: filters.issuanceEndDate?.toISOString() ?? null,
    payrollPaymentStartDate: filters.payrollPaymentStartDate?.toISOString() ?? null,
    payrollPaymentEndDate: filters.payrollPaymentEndDate?.toISOString() ?? null,
    cursor: input.cursor ?? null,
    pageSize: getPageSize(input.pageSize),
  }
  const hash = createHash('sha256').update(JSON.stringify(cacheInput)).digest('hex')
  return `fiscal-control:page:v2:${filters.organizationId}:${filters.companyId}:${hash}`
}

function deserializeFiscalControlPage(value: string): FiscalControlConciliationPage {
  const parsed = JSON.parse(value) as FiscalControlConciliationPage
  return {
    ...parsed,
    rows: parsed.rows.map(row => ({
      ...row,
      issuanceDate: row.issuanceDate ? new Date(row.issuanceDate) : null,
      payrollPaymentDate: row.payrollPaymentDate ? new Date(row.payrollPaymentDate) : null,
    })),
  }
}

const fiscalControlPageRequests = new Map<string, Promise<FiscalControlConciliationPage>>()

async function readFiscalControlConciliationPageUncached(
  input: FiscalControlConciliationPageInput,
): Promise<FiscalControlConciliationPage> {
  const pageSize = getPageSize(input.pageSize)
  const cursor = decodeCursor(input.cursor)
  const globalPage = await readFiscalControlGlobalReconciliationSummary(
    input.filters,
    { cursor, pageSize },
  )
  const pageUuids = globalPage.pageRows ?? []
  const pageRows = pageUuids.slice(0, pageSize)
  const sourceBatch = await readSourceCandidates(
    input.filters,
    null,
    pageRows.length,
    // The consolidated query returns canonical uppercase UUIDs. Preserve that
    // representation for exact lookups against the source tables.
    normalizeDetailLookupUuids(pageRows.map(row => row.uuid)),
  )
  const rowsByUuid = new Map(
    consolidateFiscalControlCandidates(sourceBatch.candidates).map(row => [row.uuid, row]),
  )
  const orderedRows = pageRows.flatMap(row => {
    const detailRow = rowsByUuid.get(row.uuid)
    return detailRow ? [detailRow] : []
  })
  const lastRow = orderedRows.at(-1)
  const hasMore = pageUuids.length > pageSize

  return {
    rows: orderedRows,
    summary: {
      scope: globalPage.scope,
      sourceCounts: globalPage.sourceCounts,
      reconciliationSummary: globalPage.reconciliationSummary,
      statusComparison: globalPage.statusComparison,
    },
    nextCursor:
      hasMore && lastRow?.issuanceDate
        ? encodeCursor({
            v: CURSOR_VERSION,
            issuanceDate: lastRow.issuanceDate.toISOString(),
            uuid: lastRow.uuid,
          })
        : null,
  }
}

export async function readFiscalControlConciliationPage(
  input: FiscalControlConciliationPageInput,
): Promise<FiscalControlConciliationPage> {
  if (!input.cache) {
    return {
      ...(await readFiscalControlConciliationPageUncached(input)),
      cacheStatus: 'BYPASS',
    }
  }

  const cacheKey = buildFiscalControlPageCacheKey(input)
  try {
    const cachedPage = await redis.get(cacheKey)
    if (cachedPage) {
      return { ...deserializeFiscalControlPage(cachedPage), cacheStatus: 'HIT' }
    }
  } catch {
    // Keep Fiscal Control available if Redis is temporarily unavailable.
  }

  const inFlight = fiscalControlPageRequests.get(cacheKey)
  if (inFlight) {
    const page = await inFlight
    return { ...page, cacheStatus: 'COALESCED' }
  }

  const request = readFiscalControlConciliationPageUncached(input)
  fiscalControlPageRequests.set(cacheKey, request)
  try {
    const page = await request
    try {
      await redis.set(
        cacheKey,
        JSON.stringify(page),
        'EX',
        FISCAL_CONTROL_PAGE_CACHE_TTL_SECONDS,
      )
    } catch {
      // The calculated result remains valid even when the cache write fails.
    }
    return { ...page, cacheStatus: 'MISS' }
  } finally {
    fiscalControlPageRequests.delete(cacheKey)
  }
}

export type FiscalControlStatusDifferenceRow = Readonly<{
  uuid: string
  issuanceDate: Date | null
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  cfdiType: string
  total: string | null
  metadataStatus: FiscalControlStatusDifference | null
  xmlStatus: FiscalControlStatusDifference | null
  origins: readonly FiscalControlOrigin[]
}>

type FiscalControlMonthlyCfdiTotals = {
  ingresos: number
  egresos: number
  nomina: number
  pagos: number
  traslados: number
}

export type FiscalControlMonthlyTypeDistribution = Readonly<{
  month: string
  metadata: FiscalControlMonthlyCfdiTotals
  xml: FiscalControlMonthlyCfdiTotals
}>

const EMPTY_MONTHLY_CFDI_TOTALS: FiscalControlMonthlyCfdiTotals = {
  ingresos: 0,
  egresos: 0,
  nomina: 0,
  pagos: 0,
  traslados: 0,
}

const MONTHLY_CFDI_TYPE_KEYS = {
  I: 'ingresos',
  E: 'egresos',
  N: 'nomina',
  P: 'pagos',
  T: 'traslados',
} as const

type MonthlyCfdiType = keyof typeof MONTHLY_CFDI_TYPE_KEYS

type FiscalControlMonthlyDbRow = Readonly<{
  source: 'METADATA' | 'XML'
  month: Date
  cfdiType: string
  total: Prisma.Decimal | null
}>

function isMonthlyCfdiType(value: string): value is MonthlyCfdiType {
  return value in MONTHLY_CFDI_TYPE_KEYS
}

function addMonthlyDistributionRow(
  distributions: Map<string, FiscalControlMonthlyTypeDistribution>,
  row: FiscalControlMonthlyDbRow,
) {
  const month = row.month.toISOString().slice(0, 7)
  const current = distributions.get(month) ?? {
    month,
    metadata: { ...EMPTY_MONTHLY_CFDI_TOTALS },
    xml: { ...EMPTY_MONTHLY_CFDI_TOTALS },
  }
  const cfdiType = normalizeCfdiType(row.cfdiType)
  if (cfdiType && isMonthlyCfdiType(cfdiType)) {
    const source = row.source === 'METADATA' ? current.metadata : current.xml
    source[MONTHLY_CFDI_TYPE_KEYS[cfdiType]] += Number(row.total?.toString() ?? 0)
  }
  distributions.set(month, current)
}

function addEmptyMonthlyDistributions(
  distributions: Map<string, FiscalControlMonthlyTypeDistribution>,
  startDate?: Date,
  endDate?: Date,
) {
  if (!startDate || !endDate) {
    return
  }

  const current = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
  const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1))
  while (current <= last) {
    const month = current.toISOString().slice(0, 7)
    if (!distributions.has(month)) {
      distributions.set(month, {
        month,
        metadata: { ...EMPTY_MONTHLY_CFDI_TOTALS },
        xml: { ...EMPTY_MONTHLY_CFDI_TOTALS },
      })
    }
    current.setUTCMonth(current.getUTCMonth() + 1)
  }
}

/**
 * Sums monthly CFDI amounts by source. Candidates are consolidated by UUID
 * before aggregation so a document present in more than one XML origin is not
 * counted twice.
 */
export async function readFiscalControlMonthlyTypeDistribution(
  filters: FiscalControlReconciliationFilters,
): Promise<readonly FiscalControlMonthlyTypeDistribution[]> {
  const context = createSourceReadContext(filters, null)
  const storedCfdiType = normalizeStoredCfdiType(filters.cfdiType)
  const metadataConditions = buildMonthlyMetadataConditions(context, filters)

  const sourceQueries: Prisma.Sql[] = [
    Prisma.sql`
      SELECT 'METADATA' AS source, UPPER(BTRIM("uuid")) AS uuid,
        "fecha_emision" AS issuance_date, "efecto_comprobante" AS cfdi_type,
        "monto" AS total
      FROM "sat_metadata"
      WHERE ${joinSqlConditions(metadataConditions)}
    `,
  ]

  if (context.filters.fiscalEntityId && context.shouldReadOrigin('EMITIDO')) {
    const issuedConditions = buildGlobalIssuedConditions(context, filters, storedCfdiType)
    sourceQueries.push(Prisma.sql`
      SELECT 'XML' AS source, UPPER(BTRIM("uuid")) AS uuid,
        "issuance_date" AS issuance_date, "cfdi_type"::text AS cfdi_type,
        "total" AS total
      FROM "invoices"
      WHERE ${joinSqlConditions(issuedConditions)}
    `)
  }

  if (context.shouldReadOrigin('RECIBIDO')) {
    const receivedConditions = [
      ...buildGlobalReceivedConditions(context, filters, storedCfdiType),
      Prisma.sql`EXISTS (
        SELECT 1 FROM "provider_uploaded_cfdi_blobs" b
        WHERE b."provider_uploaded_cfdi_id" = p."id"
      )`,
    ]
    sourceQueries.push(Prisma.sql`
      SELECT 'XML' AS source, UPPER(BTRIM("uuid")) AS uuid,
        "issuance_date" AS issuance_date, "cfdi_type" AS cfdi_type,
        CASE
          WHEN "cfdi_type" = 'P' THEN COALESCE((
            SELECT COALESCE(
              NULLIF(MAX(NULLIF(payment_link ->> 'montoTotalPagos', '')::numeric), 0),
              NULLIF(SUM(NULLIF(payment_link ->> 'montoPagado', '')::numeric), 0)
            )
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(p."payment_links_json") = 'array'
                  THEN p."payment_links_json"
                ELSE '[]'::jsonb
              END
            ) AS payment_link
          ), "total")
          ELSE "total"
        END AS total
      FROM "provider_uploaded_cfdis" p
      WHERE ${joinSqlConditions(receivedConditions)}
    `)
  }

  if (context.shouldReadPayroll && context.shouldReadOrigin('NOMINA')) {
    const payrollConditions = buildGlobalPayrollConditions(context, filters)
    sourceQueries.push(Prisma.sql`
      SELECT 'XML' AS source, UPPER(BTRIM(p."uuid")) AS uuid,
        p."fecha_emision" AS issuance_date, 'N' AS cfdi_type,
        COALESCE(i."total", s."total") AS total
      FROM "payroll_receipts" p
      LEFT JOIN "invoices" i ON i."id" = p."invoice_id"
      LEFT JOIN "sat_invoices" s ON s."id" = p."sat_invoice_id"
      WHERE ${joinSqlConditions(payrollConditions)}
    `)
  }

  const rows = await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL jit = off`,
    prisma.$queryRaw<FiscalControlMonthlyDbRow[]>(Prisma.sql`
      WITH candidates AS (${Prisma.join(sourceQueries, ' UNION ALL ')}),
      consolidated AS (
        SELECT source, uuid, MAX(issuance_date) AS issuance_date,
          MAX(cfdi_type) AS cfdi_type, MAX(total) AS total
        FROM candidates
        WHERE uuid <> '' AND issuance_date IS NOT NULL
        GROUP BY source, uuid
      )
      SELECT source, DATE_TRUNC('month', issuance_date) AS month,
        cfdi_type AS "cfdiType", SUM(total) AS total
      FROM consolidated
      GROUP BY source, DATE_TRUNC('month', issuance_date), cfdi_type
      ORDER BY month ASC
    `),
  ])
  const distributions = new Map<string, FiscalControlMonthlyTypeDistribution>()
  for (const row of rows[1] as FiscalControlMonthlyDbRow[]) {
    addMonthlyDistributionRow(distributions, row)
  }
  addEmptyMonthlyDistributions(
    distributions,
    filters.issuanceStartDate,
    filters.issuanceEndDate,
  )
  return [...distributions.values()].sort((left, right) => left.month.localeCompare(right.month))
}

function resolveStatusDifferenceValue(
  isVigente: boolean,
  isCancelado: boolean,
): FiscalControlStatusDifference | null {
  if (isVigente) {
    return 'VIGENTE'
  }

  return isCancelado ? 'CANCELADO' : null
}

/**
 * Returns the UUIDs that explain a bar-chart status gap. This compares the
 * status from SAT metadata with the status persisted alongside each XML.
 */
export async function readFiscalControlStatusDifferences(
  filters: FiscalControlReconciliationFilters,
  status: FiscalControlStatusDifference,
  limit = 500,
): Promise<readonly FiscalControlStatusDifferenceRow[]> {
  const context = createSourceReadContext({ ...filters, satStatus: undefined }, null)
  const storedCfdiType = normalizeStoredCfdiType(filters.cfdiType)
  const safeLimit = Math.min(Math.max(limit, 1), 500)
  const metadataConditions = buildStatusMetadataConditions(context)

  const sourceQueries: Prisma.Sql[] = [
    Prisma.sql`
      SELECT UPPER(BTRIM("uuid")) AS uuid, "fecha_emision" AS issuance_date,
        "rfc_emisor" AS issuer_rfc, COALESCE("nombre_emisor", '') AS issuer_name,
        "rfc_receptor" AS receiver_rfc, COALESCE("nombre_receptor", '') AS receiver_name,
        COALESCE("efecto_comprobante", '') AS cfdi_type, "monto" AS total,
        "estatus" = '1' AS metadata_vigente, "estatus" = '0' AS metadata_cancelado,
        FALSE AS xml_vigente, FALSE AS xml_cancelado,
        FALSE AS emitido, FALSE AS recibido, FALSE AS nomina
      FROM "sat_metadata"
      WHERE ${joinSqlConditions(metadataConditions)}
    `,
  ]

  if (context.filters.fiscalEntityId && context.shouldReadOrigin('EMITIDO')) {
    const conditions = buildStatusIssuedConditions(context, storedCfdiType)
    sourceQueries.push(Prisma.sql`
      SELECT UPPER(BTRIM("uuid")) AS uuid, "issuance_date" AS issuance_date,
        "issuer_rfc", COALESCE("issuer_name", '') AS issuer_name,
        "receiver_rfc", COALESCE("receiver_name", '') AS receiver_name,
        "cfdi_type"::text AS cfdi_type, "total",
        FALSE AS metadata_vigente, FALSE AS metadata_cancelado,
        "sat_status"::text = 'VIGENTE' AS xml_vigente,
        "sat_status"::text = 'CANCELADO' AS xml_cancelado,
        TRUE AS emitido, FALSE AS recibido, FALSE AS nomina
      FROM "invoices"
      WHERE ${joinSqlConditions(conditions)}
    `)
  }

  if (context.shouldReadOrigin('RECIBIDO')) {
    const conditions = buildStatusReceivedConditions(context, filters, storedCfdiType)
    sourceQueries.push(Prisma.sql`
      SELECT UPPER(BTRIM(p."uuid")) AS uuid, p."issuance_date" AS issuance_date,
        p."issuer_rfc", COALESCE(p."issuer_name", '') AS issuer_name,
        p."receiver_rfc", COALESCE(p."receiver_name", '') AS receiver_name,
        p."cfdi_type" AS cfdi_type, p."total",
        FALSE AS metadata_vigente, FALSE AS metadata_cancelado,
        EXISTS (SELECT 1 FROM "provider_uploaded_cfdi_blobs" b WHERE b."provider_uploaded_cfdi_id" = p."id")
          AND UPPER(BTRIM(p."sat_estado")) = 'VIGENTE' AS xml_vigente,
        EXISTS (SELECT 1 FROM "provider_uploaded_cfdi_blobs" b WHERE b."provider_uploaded_cfdi_id" = p."id")
          AND UPPER(BTRIM(p."sat_estado")) = 'CANCELADO' AS xml_cancelado,
        FALSE AS emitido, TRUE AS recibido, FALSE AS nomina
      FROM "provider_uploaded_cfdis" p
      WHERE ${joinSqlConditions(conditions)}
    `)
  }

  if (context.shouldReadPayroll && context.shouldReadOrigin('NOMINA')) {
    const conditions = buildStatusPayrollConditions(context, filters)
    sourceQueries.push(Prisma.sql`
      SELECT UPPER(BTRIM(p."uuid")) AS uuid, p."fecha_emision" AS issuance_date,
        COALESCE(i."issuer_rfc", s."issuer_rfc", '') AS issuer_rfc,
        COALESCE(i."issuer_name", s."issuer_name", '') AS issuer_name,
        COALESCE(i."receiver_rfc", s."receiver_rfc", '') AS receiver_rfc,
        COALESCE(i."receiver_name", s."receiver_name", '') AS receiver_name,
        COALESCE(i."cfdi_type"::text, s."cfdi_type"::text, '') AS cfdi_type,
        COALESCE(i."total", s."total") AS total,
        FALSE AS metadata_vigente, FALSE AS metadata_cancelado,
        COALESCE(i."sat_status"::text, s."sat_status"::text) = 'VIGENTE' AS xml_vigente,
        COALESCE(i."sat_status"::text, s."sat_status"::text) = 'CANCELADO' AS xml_cancelado,
        FALSE AS emitido, FALSE AS recibido, TRUE AS nomina
      FROM "payroll_receipts" p
      LEFT JOIN "invoices" i ON i."id" = p."invoice_id"
      LEFT JOIN "sat_invoices" s ON s."id" = p."sat_invoice_id"
      WHERE ${joinSqlConditions(conditions)}
    `)
  }

  type DifferenceDbRow = {
    uuid: string
    issuanceDate: Date | null
    issuerRfc: string
    issuerName: string
    receiverRfc: string
    receiverName: string
    cfdiType: string
    total: Prisma.Decimal | null
    metadataVigente: boolean
    metadataCancelado: boolean
    xmlVigente: boolean
    xmlCancelado: boolean
    origins: FiscalControlOrigin[]
  }
  const expectedColumn = status === 'VIGENTE' ? Prisma.sql`metadata_vigente <> xml_vigente` : Prisma.sql`metadata_cancelado <> xml_cancelado`
  const rows = await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL jit = off`,
    prisma.$queryRaw<DifferenceDbRow[]>(Prisma.sql`
      WITH candidates AS (${Prisma.join(sourceQueries, ' UNION ALL ')}),
      consolidated AS (
        SELECT uuid, MAX(issuance_date) AS "issuanceDate",
          MAX(issuer_rfc) AS "issuerRfc", MAX(issuer_name) AS "issuerName",
          MAX(receiver_rfc) AS "receiverRfc", MAX(receiver_name) AS "receiverName",
          MAX(cfdi_type) AS "cfdiType", MAX(total) AS total,
          BOOL_OR(metadata_vigente) AS metadata_vigente,
          BOOL_OR(metadata_cancelado) AS metadata_cancelado,
          BOOL_OR(xml_vigente) AS xml_vigente, BOOL_OR(xml_cancelado) AS xml_cancelado,
          ARRAY_REMOVE(ARRAY[
            CASE WHEN BOOL_OR(emitido) THEN 'EMITIDO' END,
            CASE WHEN BOOL_OR(recibido) THEN 'RECIBIDO' END,
            CASE WHEN BOOL_OR(nomina) THEN 'NOMINA' END
          ], NULL) AS origins
        FROM candidates WHERE uuid <> '' GROUP BY uuid
      )
      SELECT * FROM consolidated
      WHERE ${expectedColumn}
      ORDER BY "issuanceDate" DESC NULLS LAST, uuid DESC
      LIMIT ${safeLimit}
    `),
  ])
  const detailRows = rows[1] as DifferenceDbRow[]
  return detailRows.map(row => ({
    uuid: row.uuid,
    issuanceDate: row.issuanceDate,
    issuerRfc: row.issuerRfc,
    issuerName: row.issuerName,
    receiverRfc: row.receiverRfc,
    receiverName: row.receiverName,
    cfdiType: row.cfdiType,
    total: toDecimalString(row.total),
    metadataStatus: resolveStatusDifferenceValue(row.metadataVigente, row.metadataCancelado),
    xmlStatus: resolveStatusDifferenceValue(row.xmlVigente, row.xmlCancelado),
    origins: row.origins,
  }))
}

export const __testables = {
  decodeCursor,
  encodeCursor,
  getPageSize,
  normalizeCfdiType,
  normalizeStoredCfdiType,
  normalizeMetadataSatStatus,
  normalizeDetailLookupUuids,
}

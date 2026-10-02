import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma, MemberRole, SystemRole } from '@prisma/client'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'
import {
  buildProjectionMap,
  extractWorkpaperProjectionAttributes,
  normalizeProjectionUpperText,
  workpaperAttributeKeySet,
  workpaperComplementFlagKeySet,
  workpaperComplementVersionKeySet,
  workpaperNumericAttributeKeySet
} from '@/lib/cfdi-workpaper-projection'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import {
  buildDashboardScopedContext,
  dashboardJsonErrorResponse
} from '@/lib/dashboard-fiscal-route-utils'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { createSemaphore } from '@/lib/semaphore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/* ==================================================================
 * INV-010 FIXED: Concurrency projection semaphore ORG-scoped + queue timeout 60s
 * - Max 2 concurrent projection scans per ORG (acquireProjectionSemaphore)
 * - Evita 3 concurrentes = OOM SIGKILL.
 * ================================================================== */
const _PROJECTION_SCAN_QUEUE_TIMEOUT_MS = 60_000
const _PROJECTION_SCAN_MAX_CONCURRENT_PER_ORG = 2
const _projectionGlobalMutex = createSemaphore(1)
const _semaphoreByOrg = new Map<string, { sem: ReturnType<typeof createSemaphore>; lastUsed: number }>()
const PROJ_TOO_MANY_ROWS_CUTOFF = Number(process.env.INVOICE_PROJECTION_MAX_ROWS ?? '50000')

async function acquireProjectionSemaphore(orgId: string): Promise<() => void> {
  const sem = await _projectionGlobalMutex.run(async () => {
    let entry = _semaphoreByOrg.get(orgId)
    if (!entry) {
      entry = { sem: createSemaphore(_PROJECTION_SCAN_MAX_CONCURRENT_PER_ORG), lastUsed: Date.now() }
      _semaphoreByOrg.set(orgId, entry)
    } else {
      entry.lastUsed = Date.now()
    }
    
    if (_semaphoreByOrg.size > 200) {
      const cutoff = Date.now() - 30 * 60 * 1000
      for (const [k, v] of _semaphoreByOrg.entries()) {
        if (v.lastUsed < cutoff) _semaphoreByOrg.delete(k)
      }
    }
    return entry.sem
  })

  const acquired = new Promise<() => void>((resolveOuter) => {
    sem.run(() => new Promise<void>((resolveInner) => {
      let isReleased = false
      const releaseFn = () => {
        if (!isReleased) {
          isReleased = true
          resolveInner()
        }
      }
      resolveOuter(releaseFn)
    })).catch(() => { /* ignore */ })
  })
  
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('PROJECTION_QUEUE_TIMEOUT: espera mayor a 60s. Reduce filtros o intenta más tarde.')), _PROJECTION_SCAN_QUEUE_TIMEOUT_MS)
  )
  
  return Promise.race([acquired, timeout])
}

/* ==================================================================
 * INV-010 FIXED: Simple LRU cache decryptInvoiceXmlContent 1000 entries · 5 min TTL
 * - Map<K,V> for O(1) get; keys.shift() for evict oldest when > 1000.
 * - No new dependency; evict + TTL sweep cada 128th acceso.
 * ================================================================== */
interface DecryptLruEntry { value: string; accessAt: number; ttlMs: number }
const _DECRYPT_LRU_MAX = 1000
const _DECRYPT_LRU_TTL_MS = 5 * 60 * 1000
const _decryptLru = new Map<string, DecryptLruEntry>()
let _decryptAccessCounter = 0
function cachedDecrypt(blobShape: { ciphertext: string; iv: string; authTag: string; algorithm: string }): string {
  // Cache key: sha256(ciphertext||iv||authTag) slice 32 chars (short + safe)
  const keySeed = blobShape.ciphertext.slice(0, 48) + '|' + blobShape.iv + '|' + blobShape.authTag + '|' + blobShape.algorithm
  let hash = 2166136261
  for (let i = 0; i < keySeed.length && i < 192; i++) hash = Math.imul(hash ^ (keySeed.codePointAt(i) ?? 0), 16777619)
  const key = (hash >>> 0).toString(36) + '_' + keySeed.length.toString(36)
  const exist = _decryptLru.get(key)
  const now = Date.now()
  if (exist && now - exist.accessAt <= exist.ttlMs) {
    exist.accessAt = now
    return exist.value
  }
  const val = decryptInvoiceXmlContent(blobShape)
  // Evict oldest
  if (_decryptLru.size >= _DECRYPT_LRU_MAX) {
    const firstKey = _decryptLru.keys().next().value
    if (firstKey !== undefined) _decryptLru.delete(firstKey)
  }
  _decryptLru.set(key, { value: val, accessAt: now, ttlMs: _DECRYPT_LRU_TTL_MS })
  _decryptAccessCounter++
  if ((_decryptAccessCounter & 127) === 0) {
    // Sweep TTL every 128 calls
    const sweepCutoff = Date.now() - _DECRYPT_LRU_TTL_MS
    for (const [k, v] of _decryptLru.entries()) if (v.accessAt < sweepCutoff) _decryptLru.delete(k)
  }
  return val
}

function maskProjectionSalaries(projection: Record<string, unknown>) {
  const pout = { ...projection }
  const P_MASK = ['nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos']
  for (const pk of P_MASK) if (pk in pout) pout[pk] = null
  return pout
}

function maskSensitiveIfViewer<T extends object>(row: T, viewerMode: boolean): T {
  if (!viewerMode) return row
  const MASK_KEYS_NULLIFY = new Set([
    'subtotal', 'total', 'discount',
    'ivaTransferred', 'ivaWithheld', 'isrWithheld', 'iepsWithheld',
    'exchangeRate'
  ])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (MASK_KEYS_NULLIFY.has(k)) {
      out[k] = null
    } else if (k === 'projection' && v) {
      out[k] = maskProjectionSalaries(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out as T
}

function mergeSecureHeaders(extra?: Record<string, string>): Record<string, string> {
  return extra ? { ...SECURITY_HEADERS, ...extra } : SECURITY_HEADERS
}

// DASHBOARD-010 · Defensa anti-prototype-pollution workpaper dynamic columns.
// Max 3 filtros numéricos proyectados (projection numeric) para evitar regex-SQL
// sin índice (DASHBOARD-010 también cierra filtros sin límite).
const MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS = 3
const MAX_SIMPLE_FILTER_FIELDS = 8

const SAFE_HAS_KEY_REGEX = /^[a-z0-9]+$/i
const UUID_FORMAT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RFC_FORMAT_REGEX = /^[a-zñ&]{3,4}\d{6}[a-z0-9]{3}$/i

const CFDI_TYPE_WHITELIST_MAP: Readonly<Record<string, CfdiType>> = {
  I: CfdiType.INGRESO, E: CfdiType.EGRESO, P: CfdiType.PAGO, T: CfdiType.TRASLADO, N: CfdiType.NOMINA,
  INGRESO: CfdiType.INGRESO, EGRESO: CfdiType.EGRESO, PAGO: CfdiType.PAGO, TRASLADO: CfdiType.TRASLADO, NOMINA: CfdiType.NOMINA,
}
const STATUS_WHITELIST = new Set(Object.values(InvoiceStatus))
const SAT_STATUS_WHITELIST = new Set(Object.values(SatStatus))

function parseDateFilter(value: string | null, bound: 'start' | 'end') {
  if (!value) return null

  const normalized = bound === 'start'
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(`${value}T23:59:59.999Z`)

  return Number.isNaN(normalized.getTime()) ? null : normalized
}

function parseNumericFilter(value: string | null) {
  if (!value) return null

  const normalized = value.replace(/[$,\s]/g, '').trim()
  if (!normalized) return null

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseColumnDateFilter(value: string | null) {
  if (!value) return null

  const normalized = value.trim()
  if (!normalized) return null

  let year: string, month: string, day: string
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized)
  if (isoMatch) {
    [, year, month, day] = isoMatch
  } else {
    const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normalized)
    if (slashMatch) {
      [, day, month, year] = slashMatch
    } else {
      return null
    }
  }

  const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return { start: parseDateFilter(isoDate, 'start'), end: parseDateFilter(isoDate, 'end') }
}

function parseBooleanFilter(value: string) {
  const normalized = normalizeProjectionUpperText(value)
  if (['1', 'TRUE', 'SI', 'SÍ', 'YES'].includes(normalized)) return true
  if (['0', 'FALSE', 'NO'].includes(normalized)) return false
  return true
}

function numericValuesMatch(actual: number | null | undefined, expected: number) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false
  }

  return Math.abs(Number(actual) - expected) < 0.005
}

function applyQueryFilter(query: string, where: Prisma.InvoiceWhereInput) {
  const q = query.trim()
  const qUpper = q.toUpperCase()
  if (UUID_FORMAT_REGEX.test(q)) {
    where.OR = [
      { uuid: { equals: q, mode: 'insensitive' } },
      { folio: { contains: q, mode: 'insensitive' } },
    ]
  } else if (RFC_FORMAT_REGEX.test(qUpper)) {
    where.OR = [
      { issuerRfc: { equals: qUpper } },
      { receiverRfc: { equals: qUpper } },
      { issuerRfc: { contains: q, mode: 'insensitive' } },
      { receiverRfc: { contains: q, mode: 'insensitive' } },
    ]
  } else if (q.length <= 48) {
    where.OR = [
      { issuerName: { contains: q, mode: 'insensitive' } },
      { receiverName: { contains: q, mode: 'insensitive' } },
      { folio: { contains: q, mode: 'insensitive' } },
      { uuid: { contains: q, mode: 'insensitive' } },
    ]
  }
}

function applyStatusFilters(searchParams: URLSearchParams, where: Prisma.InvoiceWhereInput) {
  const status = searchParams.get('status') as keyof typeof InvoiceStatus | null
  const satStatus = searchParams.get('satStatus') as keyof typeof SatStatus | null

  if (status) {
    const s = status.toUpperCase() as keyof typeof InvoiceStatus
    if (STATUS_WHITELIST.has(InvoiceStatus[s])) where.status = InvoiceStatus[s]
  }
  if (satStatus) {
    const s = satStatus.toUpperCase() as keyof typeof SatStatus
    if (SAT_STATUS_WHITELIST.has(SatStatus[s])) where.satStatus = SatStatus[s]
  }
}

function applyDateFilters(searchParams: URLSearchParams, where: Prisma.InvoiceWhereInput) {
  const dateFrom = parseDateFilter(searchParams.get('dateFrom'), 'start')
  const dateTo = parseDateFilter(searchParams.get('dateTo'), 'end')

  if (dateFrom || dateTo) {
    const dateFilter: Prisma.DateTimeFilter = {}
    if (dateFrom) dateFilter.gte = dateFrom
    if (dateTo) dateFilter.lte = dateTo
    where.issuanceDate = dateFilter
  }
}

function applySimpleFilters(searchParams: URLSearchParams, where: Prisma.InvoiceWhereInput) {
  const simpleFilterFields = [
    'id', 'userId', 'issuerFiscalEntityId', 'uuid', 'series', 'folio', 'currency', 'issuerRfc', 'issuerName',
    'receiverRfc', 'receiverName', 'paymentMethod', 'paymentForm',
    'cfdiUsage', 'placeOfExpedition', 'exportKey', 'objectTaxComprobante',
    'paymentConditions', 'certificationPac'
  ]

  let appliedSimpleFilters = 0
  for (const field of simpleFilterFields) {
    if (appliedSimpleFilters >= MAX_SIMPLE_FILTER_FIELDS) break
    const val = searchParams.get(field)
    if (val && val.length <= 80) {
      appliedSimpleFilters += 1
      ;(where as Record<string, Prisma.StringFilter>)[field] = { contains: val, mode: 'insensitive' }
    }
  }
  return simpleFilterFields
}

function applyExactNumberFilters(searchParams: URLSearchParams, where: Prisma.InvoiceWhereInput) {
  const exactNumberFields = ['subtotal', 'discount', 'total', 'exchangeRate']
  for (const field of exactNumberFields) {
    const val = parseNumericFilter(searchParams.get(field))
    if (val !== null) {
      ;(where as Record<string, number>)[field] = val
    }
  }
  return exactNumberFields
}

function applyBaseFilters(searchParams: URLSearchParams, where: Prisma.InvoiceWhereInput) {
  const query = searchParams.get('query') ?? ''
  if (query) applyQueryFilter(query, where)

  applyStatusFilters(searchParams, where)
  applyDateFilters(searchParams, where)
  
  const simpleFilterFields = applySimpleFilters(searchParams, where)
  const exactNumberFields = applyExactNumberFilters(searchParams, where)

  return { simpleFilterFields, exactNumberFields }
}

function getInvoiceDecryptedXml(row: { xmlContent: string | null, blob: { xmlCiphertext: string; xmlIv: string; xmlAuthTag: string; xmlEncryptionAlg: string } | null }) {
  let xmlContent = row.xmlContent?.trim()
  if (!xmlContent) {
    xmlContent = row.blob
      ? cachedDecrypt({
          ciphertext: row.blob.xmlCiphertext,
          iv: row.blob.xmlIv,
          authTag: row.blob.xmlAuthTag,
          algorithm: row.blob.xmlEncryptionAlg
        })
      : ''
  }
  return xmlContent
}

async function fetchInvoiceBatch(baseWhere: Prisma.InvoiceWhereInput, batchSize: number, cursorId: string | null) {
  return await prisma.invoice.findMany({
    where: baseWhere,
    orderBy: { id: 'asc' },
    take: batchSize,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    select: {
      id: true,
      xmlContent: true,
      blob: {
        select: {
          xmlCiphertext: true,
          xmlIv: true,
          xmlAuthTag: true,
          xmlEncryptionAlg: true
        }
      }
    }
  }) as Array<{
    id: string
    xmlContent: string | null
    blob: {
      xmlCiphertext: string
      xmlIv: string
      xmlAuthTag: string
      xmlEncryptionAlg: string
    } | null
  }>
}

function matchesProjectedNumericFilters(xmlContent: string, filterEntries: [string, number][]) {
  const projection = extractWorkpaperProjectionAttributes(xmlContent)
  return filterEntries.every(([key, expectedValue]) => {
    const actualValue = projection[key]
    return numericValuesMatch(typeof actualValue === 'number' ? actualValue : null, expectedValue)
  })
}

async function findInvoiceIdsByProjectedNumericFilters(params: {
  baseWhere: Prisma.InvoiceWhereInput
  numericFilters: Record<string, number>
  organizationId: string
}) {
  const releaseSem = await acquireProjectionSemaphore(params.organizationId)
  try {
    const preCount = await prisma.invoice.count({ where: params.baseWhere })
    if (preCount > PROJ_TOO_MANY_ROWS_CUTOFF) {
      throw new Error(
        `PROJ_TOO_MANY_ROWS: Filtro proyectado numérico cubre ${preCount} facturas > límite ${PROJ_TOO_MANY_ROWS_CUTOFF}. Agrega filtros por fecha, RFC, folio o UUID para reducir el alcance.`
      )
    }
    const filterEntries = Object.entries(params.numericFilters)
    if (filterEntries.length === 0) return []

    const matchedIds: string[] = []
    const batchSize = 500
    let cursorId: string | null = null

    while (true) {
      const rows = await fetchInvoiceBatch(params.baseWhere, batchSize, cursorId)
      if (rows.length === 0) break

      for (const row of rows) {
        const xmlContent = getInvoiceDecryptedXml(row)
        if (xmlContent && matchesProjectedNumericFilters(xmlContent, filterEntries)) {
          matchedIds.push(row.id)
        }
      }

      if (rows.length < batchSize) break
      cursorId = rows.at(-1)?.id ?? null
    }

    return matchedIds
  } finally {
    releaseSem()
  }
}

function applyDynamicDateFilter(rawValue: string, whereAnd: Prisma.InvoiceWhereInput[]) {
  const parsedDateFilter = parseColumnDateFilter(rawValue)
  if (parsedDateFilter?.start || parsedDateFilter?.end) {
    const dateFilter: Prisma.DateTimeFilter = {}
    if (parsedDateFilter.start) dateFilter.gte = parsedDateFilter.start
    if (parsedDateFilter.end) dateFilter.lte = parsedDateFilter.end
    whereAnd.push({ issuanceDate: dateFilter })
  }
}

function applyDynamicFlagFilter(hasKey: string, rawValue: string, whereAnd: Prisma.InvoiceWhereInput[]) {
  const safeComplementWhere: Record<string, unknown> = Object.create(null)
  safeComplementWhere[hasKey] = parseBooleanFilter(rawValue)
  whereAnd.push({ complementIndex: { is: safeComplementWhere as unknown as Prisma.InputJsonObject } })
}

function applyDynamicVersionFilter(key: string, rawValue: string, whereAnd: Prisma.InvoiceWhereInput[]) {
  const safeComplementWhere: Record<string, unknown> = Object.create(null)
  safeComplementWhere[key] = { contains: rawValue, mode: 'insensitive' }
  whereAnd.push({ complementIndex: { is: safeComplementWhere as unknown as Prisma.InputJsonObject } })
}

function applyDynamicAttributeFilter(
  key: string,
  rawValue: string,
  normalizedValue: string,
  deferredNumericProjectionFilters: Record<string, number>,
  whereAnd: Prisma.InvoiceWhereInput[]
) {
  const numericValue = workpaperNumericAttributeKeySet.has(key) ? parseNumericFilter(rawValue) : null
  if (numericValue !== null) {
    deferredNumericProjectionFilters[key] = numericValue
    return
  }
  whereAnd.push({
    complementAttributes: {
      some: {
        attributeKey: key,
        valueSearch: { contains: normalizedValue, mode: 'insensitive' }
      }
    }
  })
}

function resolveHasKey(rawKey: string) {
  const hasKeyRawSuffix = rawKey.startsWith('has.') ? rawKey.slice(4) : null
  if (hasKeyRawSuffix !== null && !SAFE_HAS_KEY_REGEX.test(hasKeyRawSuffix)) return { valid: false, hasKey: rawKey }
  
  const hasKey = hasKeyRawSuffix !== null
    ? `has${hasKeyRawSuffix.toLowerCase().replace(/(?:^|_)(\w)/g, (_m, char) => char.toUpperCase())}`
    : rawKey

  return { valid: true, hasKey }
}

function processDynamicFilterEntry(
  rawKey: string,
  rawValue: string,
  simpleFilterFields: string[],
  exactNumberFields: string[],
  whereAnd: Prisma.InvoiceWhereInput[],
  deferredNumericProjectionFilters: Record<string, number>
) {
  if (simpleFilterFields.includes(rawKey) || exactNumberFields.includes(rawKey)) return

  if (rawKey === 'issuanceDate') {
    applyDynamicDateFilter(rawValue, whereAnd)
    return
  }

  const { valid, hasKey } = resolveHasKey(rawKey)
  if (!valid) return

  if (workpaperComplementFlagKeySet.has(hasKey)) {
    applyDynamicFlagFilter(hasKey, rawValue, whereAnd)
    return
  }

  const key = rawKey.startsWith('attr.') ? rawKey.slice(5) : rawKey
  if (workpaperComplementVersionKeySet.has(key)) {
    applyDynamicVersionFilter(key, rawValue, whereAnd)
    return
  }

  if (workpaperAttributeKeySet.has(key)) {
    const normalizedValue = normalizeProjectionUpperText(rawValue)
    applyDynamicAttributeFilter(key, rawValue, normalizedValue, deferredNumericProjectionFilters, whereAnd)
  }
}

function applyDynamicFilters(
  searchParams: URLSearchParams,
  simpleFilterFields: string[],
  exactNumberFields: string[],
  whereAnd: Prisma.InvoiceWhereInput[],
  deferredNumericProjectionFilters: Record<string, number>
) {
  const reservedParams = new Set([
    'companyId', 'page', 'limit', 'query', 'cfdiType', 'status', 'satStatus',
    'dateFrom', 'dateTo', 'export', 'origin'
  ])

  for (const [rawKey, rawValue] of searchParams.entries()) {
    if (reservedParams.has(rawKey) || !rawValue) continue
    processDynamicFilterEntry(rawKey, rawValue, simpleFilterFields, exactNumberFields, whereAnd, deferredNumericProjectionFilters)
  }
}

async function getValidatedContext(request: NextRequest) {
  const { ctx, searchParams } = await buildDashboardScopedContext(request, {
    routeKey: 'invoices',
    requireCompanyId: true
  })

  const session = await auth()
  if (!session?.user?.id) {
    return { errorResponse: NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: mergeSecureHeaders() }) }
  }

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id, organizationId: ctx.organizationId, status: 'APPROVED' },
    select: { id: true, role: true }
  })
  if (!member) {
    return { errorResponse: NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404, headers: mergeSecureHeaders() }) }
  }

  const userContext = {
    id: session.user.id,
    systemRole: (session.user.systemRole ?? 'USER') as SystemRole,
    memberships: [{ organizationId: ctx.organizationId, role: member.role as MemberRole }]
  }

  return { ctx, searchParams, userContext }
}

async function getFiscalEntityAndCompany(searchParams: URLSearchParams, organizationId: string) {
  const companyId = searchParams.get('companyId')!
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { rfc: true }
  })
  if (!company?.rfc) {
    return { errorResponse: NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: mergeSecureHeaders() }) }
  }

  const fiscalEntity = await prisma.fiscalEntity.findFirst({
    where: { rfc: company.rfc, organizationId }
  })
  
  return { company, fiscalEntity }
}

function determineCfdiTypeFilter(cfdiTypeParam: string | null, where: Prisma.InvoiceWhereInput) {
  let isNominaQuery = false
  if (cfdiTypeParam) {
    const types = cfdiTypeParam.split(',').flatMap(t => {
      const val = t.trim().toUpperCase()
      return CFDI_TYPE_WHITELIST_MAP[val] ? [CFDI_TYPE_WHITELIST_MAP[val]] : []
    })
    const uniqueTypes = Array.from(new Set(types))
    if (uniqueTypes.length > 0) {
      where.cfdiType = { in: uniqueTypes }
      isNominaQuery = uniqueTypes.includes(CfdiType.NOMINA)
    } else {
      where.cfdiType = { in: [CfdiType.INGRESO, CfdiType.PAGO] }
    }
  } else {
    where.cfdiType = { in: [CfdiType.INGRESO, CfdiType.PAGO] }
  }
  return isNominaQuery
}

async function fetchAndFormatInvoices(where: Prisma.InvoiceWhereInput, page: number, limit: number, viewerMaskMode: boolean) {
  const skip = (page - 1) * limit
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { issuanceDate: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, userId: true, issuerFiscalEntityId: true, uuid: true, cfdiType: true,
        series: true, folio: true, currency: true, exchangeRate: true, status: true,
        satStatus: true, issuerRfc: true, issuerName: true, receiverRfc: true, receiverName: true,
        subtotal: true, discount: true, total: true, ivaTransferred: true, ivaWithheld: true,
        isrWithheld: true, iepsWithheld: true, pdfUrl: true, issuanceDate: true,
        certificationDate: true, certificationPac: true, paymentMethod: true, paymentForm: true,
        cfdiUsage: true, placeOfExpedition: true, exportKey: true, objectTaxComprobante: true,
        paymentConditions: true, createdAt: true, updatedAt: true, xmlContent: true,
        complementIndex: {
          select: {
            hasPagos: true, pagosVersion: true, hasNomina: true, nominaVersion: true,
            hasCartaPorte: true, cartaPorteVersion: true, hasComercioExterior: true,
            comercioExteriorVersion: true
          }
        },
        complementAttributes: {
          select: {
            attributeKey: true, valueText: true, valueNumber: true, valueBoolean: true
          }
        }
      }
    }),
    prisma.invoice.count({ where })
  ])

  const invoices = rows.map(r => maskSensitiveIfViewer({
    ...r,
    exchangeRate: r.exchangeRate ?? null,
    subtotal: Number(r.subtotal),
    discount: Number(r.discount ?? 0),
    total: Number(r.total),
    ivaTransferred: Number(r.ivaTransferred ?? 0),
    ivaWithheld: Number(r.ivaWithheld ?? 0),
    isrWithheld: Number(r.isrWithheld ?? 0),
    iepsWithheld: Number(r.iepsWithheld ?? 0),
    issuanceDate: r.issuanceDate,
    certificationDate: r.certificationDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    projection: buildProjectionMap({
      attributes: r.complementAttributes,
      complementIndex: r.complementIndex
    })
  }, viewerMaskMode))

  return NextResponse.json({
    invoices,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
  }, { headers: SECURITY_HEADERS })
}

async function handleDeferredNumericFilters(
  where: Prisma.InvoiceWhereInput,
  whereAnd: Prisma.InvoiceWhereInput[],
  deferredNumericProjectionFilters: Record<string, number>,
  organizationId: string
) {
  const deferredProjectionFilterKeys = Object.keys(deferredNumericProjectionFilters)
  if (deferredProjectionFilterKeys.length > MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS) {
    return {
      errorResponse: NextResponse.json(
        { error: `Demasiados filtros numéricos. Máximo permitido: ${MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS}.` },
        { status: 400, headers: mergeSecureHeaders() }
      )
    }
  }

  if (deferredProjectionFilterKeys.length > 0) {
    const matchedInvoiceIds = await findInvoiceIdsByProjectedNumericFilters({
      baseWhere: where,
      numericFilters: deferredNumericProjectionFilters,
      organizationId
    })

    if (matchedInvoiceIds.length === 0) {
      return { isEmpty: true }
    }
    whereAnd.push({ id: { in: matchedInvoiceIds } })
  }
  
  return { isEmpty: false }
}

export async function GET(request: NextRequest) {
  try {
    const ctxData = await getValidatedContext(request)
    if (ctxData.errorResponse) return ctxData.errorResponse
    const { ctx, searchParams, userContext } = ctxData

    const page = Number(searchParams.get('page') ?? 1)
    const isExport = searchParams.get('export') === 'true'
    const defaultLimit = Number(searchParams.get('limit') ?? 20)
    const limit = isExport ? Math.min(defaultLimit, 50000) : Math.min(defaultLimit, 100)

    const entityData = await getFiscalEntityAndCompany(searchParams, ctx.organizationId)
    if (entityData.errorResponse) return entityData.errorResponse
    const { company, fiscalEntity } = entityData

    if (!fiscalEntity) {
      return NextResponse.json({ invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } }, { status: 200, headers: mergeSecureHeaders() })
    }

    const where: Prisma.InvoiceWhereInput = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: company.rfc }
    const isNominaQuery = determineCfdiTypeFilter(searchParams.get('cfdiType'), where)
    
    const canViewSalaries = hasPermission(userContext, Permission.NOMINA_VIEW_SALARIES, ctx.organizationId)
    const viewerMaskMode = isNominaQuery && !canViewSalaries

    const { simpleFilterFields, exactNumberFields } = applyBaseFilters(searchParams, where)

    const whereAnd: Prisma.InvoiceWhereInput[] = []
    const deferredNumericProjectionFilters: Record<string, number> = {}
    applyDynamicFilters(searchParams, simpleFilterFields, exactNumberFields, whereAnd, deferredNumericProjectionFilters)

    const filterResult = await handleDeferredNumericFilters(where, whereAnd, deferredNumericProjectionFilters, ctx.organizationId)
    if (filterResult.errorResponse) return filterResult.errorResponse
    if (filterResult.isEmpty) {
      return NextResponse.json({ invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } }, { status: 200, headers: mergeSecureHeaders() })
    }

    if (whereAnd.length > 0) {
      where.AND = whereAnd
    }

    return await fetchAndFormatInvoices(where, page, limit, viewerMaskMode)
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

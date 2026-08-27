import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
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
const _semaphoreByOrg: Map<string, { sem: ReturnType<typeof createSemaphore>; lastUsed: number }> = new Map()
const PROJ_TOO_MANY_ROWS_CUTOFF = Number(process.env.INVOICE_PROJECTION_MAX_ROWS || '50000')

function acquireProjectionSemaphore(orgId: string): Promise<() => void> {
  return _projectionGlobalMutex.run(async () => {
    let entry = _semaphoreByOrg.get(orgId)
    if (!entry) {
      entry = { sem: createSemaphore(_PROJECTION_SCAN_MAX_CONCURRENT_PER_ORG), lastUsed: Date.now() }
      _semaphoreByOrg.set(orgId, entry)
    } else {
      entry.lastUsed = Date.now()
    }
    // Limpiar entradas > 30 min sin uso (memory soft leak prevent)
    if (_semaphoreByOrg.size > 200) {
      const cutoff = Date.now() - 30 * 60 * 1000
      for (const [k, v] of _semaphoreByOrg.entries()) {
        if (v.lastUsed < cutoff) _semaphoreByOrg.delete(k)
      }
    }
    return entry.sem
  }).then(async (sem) => {
    // Promise.race para queue timeout 60s; si expira lanza error antes de empezar decrypt.
    let release: () => void = () => {}
    const acquired = new Promise<() => void>((resolve) => {
      sem.run<() => void>(() => new Promise<() => void>((res) => {
        release = () => { res(undefined as unknown as () => void); (release as () => void)?.() }
        resolve(() => { release(); (release = () => {})() })
      })).catch(() => { /* ignore */ })
    })
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('PROJECTION_QUEUE_TIMEOUT: espera mayor a 60s. Reduce filtros o intenta más tarde.')), _PROJECTION_SCAN_QUEUE_TIMEOUT_MS)
    )
    return Promise.race([acquired, timeout])
  })
}

/* ==================================================================
 * INV-010 FIXED: Simple LRU cache decryptInvoiceXmlContent 1000 entries · 5 min TTL
 * - Map<K,V> for O(1) get; keys.shift() for evict oldest when > 1000.
 * - No new dependency; evict + TTL sweep cada 128th acceso.
 * ================================================================== */
interface DecryptLruEntry { value: string; accessAt: number; ttlMs: number }
const _DECRYPT_LRU_MAX = 1000
const _DECRYPT_LRU_TTL_MS = 5 * 60 * 1000
const _decryptLru: Map<string, DecryptLruEntry> = new Map()
let _decryptAccessCounter = 0
function cachedDecrypt(blobShape: { ciphertext: string; iv: string; authTag: string; algorithm: string }): string {
  // Cache key: sha256(ciphertext||iv||authTag) slice 32 chars (short + safe)
  const keySeed = blobShape.ciphertext.slice(0, 48) + '|' + blobShape.iv + '|' + blobShape.authTag + '|' + blobShape.algorithm
  let hash = 2166136261
  for (let i = 0; i < keySeed.length && i < 192; i++) hash = Math.imul(hash ^ keySeed.charCodeAt(i), 16777619)
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

function mergeSecureHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...SECURITY_HEADERS, ...(extra || {}) }
}

// DASHBOARD-010 · Defensa anti-prototype-pollution workpaper dynamic columns.
// Max 3 filtros numéricos proyectados (projection numeric) para evitar regex-SQL
// sin índice (DASHBOARD-010 también cierra filtros sin límite).
const MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS = 3
const MAX_SIMPLE_FILTER_FIELDS = 8

const SAFE_HAS_KEY_REGEX = /^[A-Za-z0-9]+$/
const UUID_FORMAT_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const RFC_FORMAT_REGEX = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/i

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

  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return { start: parseDateFilter(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, 'start'), end: parseDateFilter(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, 'end') }
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const [, day, month, year] = slashMatch
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    return { start: parseDateFilter(isoDate, 'start'), end: parseDateFilter(isoDate, 'end') }
  }

  return null
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

async function findInvoiceIdsByProjectedNumericFilters(params: {
  baseWhere: Prisma.InvoiceWhereInput
  numericFilters: Record<string, number>
  organizationId: string
}) {
  // INV-010 FIXED: (CAPA 1) acquireProjectionSemaphore queue + timeout 60s
  const releaseSem = await acquireProjectionSemaphore(params.organizationId)
  try {
    // INV-010 FIXED: (CAPA 2) EARLY-COUNT rows before fetch/decrypt. If > cutoff → fail fast 400.
    const preCount = await prisma.invoice.count({ where: params.baseWhere })
    if (preCount > PROJ_TOO_MANY_ROWS_CUTOFF) {
      throw new Error(
        `PROJ_TOO_MANY_ROWS: Filtro proyectado numérico cubre ${preCount} facturas > límite ${PROJ_TOO_MANY_ROWS_CUTOFF}. Agrega filtros por fecha, RFC, folio o UUID para reducir el alcance.`
      )
    }
    const filterEntries = Object.entries(params.numericFilters)
    if (filterEntries.length === 0) {
      return []
    }

    const matchedIds: string[] = []
    const batchSize = 500
    let cursorId: string | null = null

    while (true) {
      const rows: Array<{
        id: string
        xmlContent: string
        blob: {
          xmlCiphertext: string
          xmlIv: string
          xmlAuthTag: string
          xmlEncryptionAlg: string
        } | null
      }> = await prisma.invoice.findMany({
        where: params.baseWhere,
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
      })

      if (rows.length === 0) {
        break
      }

      for (const row of rows) {
        const xmlContent = row.xmlContent?.trim()
          || (row.blob
            ? cachedDecrypt({
                ciphertext: row.blob.xmlCiphertext,
                iv: row.blob.xmlIv,
                authTag: row.blob.xmlAuthTag,
                algorithm: row.blob.xmlEncryptionAlg
              })
            : '')

        if (!xmlContent) {
          continue
        }

        const projection = extractWorkpaperProjectionAttributes(xmlContent)
        const matchesAllFilters = filterEntries.every(([key, expectedValue]) => {
          const actualValue = projection[key]
          return numericValuesMatch(typeof actualValue === 'number' ? actualValue : null, expectedValue)
        })

        if (matchesAllFilters) {
          matchedIds.push(row.id)
        }
      }

      if (rows.length < batchSize) {
        break
      }

      cursorId = rows[rows.length - 1]?.id || null
    }

    return matchedIds
  } finally {
    releaseSem()
  }
}

export async function GET(request: NextRequest) {
  try {
    const { ctx, searchParams, systemRole: _sr } = await buildDashboardScopedContext(request, {
      routeKey: 'invoices',
      requireCompanyId: true
    })
    void _sr

    const companyId = searchParams.get('companyId')!
    const page = Number(searchParams.get('page') || 1)
    const isExport = searchParams.get('export') === 'true'
    const defaultLimit = Number(searchParams.get('limit') || 20)
    const limit = isExport ? defaultLimit : Math.min(defaultLimit, 100)
    const query = searchParams.get('query') || ''
    const cfdiTypeParam = searchParams.get('cfdiType')
    const status = searchParams.get('status') as keyof typeof InvoiceStatus | null
    const satStatus = searchParams.get('satStatus') as keyof typeof SatStatus | null
    const dateFrom = parseDateFilter(searchParams.get('dateFrom'), 'start')
    const dateTo = parseDateFilter(searchParams.get('dateTo'), 'end')

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: mergeSecureHeaders() })
    }

    // Scope estricto por organizationId del ctx (DASHBOARD-003 RFC leak).
    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc: company.rfc, organizationId: ctx.organizationId }
    })
    if (!fiscalEntity) {
      return NextResponse.json({ invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } }, { status: 200, headers: mergeSecureHeaders() })
    }

    const where: Prisma.InvoiceWhereInput = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: company.rfc }
    if (query) {
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
    if (cfdiTypeParam) {
      const types = cfdiTypeParam.split(',').flatMap(t => {
        const val = t.trim().toUpperCase()
        return CFDI_TYPE_WHITELIST_MAP[val] ? [CFDI_TYPE_WHITELIST_MAP[val]] : []
      })
      const uniqueTypes = Array.from(new Set(types))
      if (uniqueTypes.length > 0) {
        where.cfdiType = { in: uniqueTypes }
      } else {
        where.cfdiType = { in: [CfdiType.INGRESO, CfdiType.PAGO] }
      }
    } else {
      where.cfdiType = { in: [CfdiType.INGRESO, CfdiType.PAGO] }
    }

    if (status) {
      const s = status.toUpperCase() as keyof typeof InvoiceStatus
      if (STATUS_WHITELIST.has(InvoiceStatus[s])) where.status = InvoiceStatus[s]
    }
    if (satStatus) {
      const s = satStatus.toUpperCase() as keyof typeof SatStatus
      if (SAT_STATUS_WHITELIST.has(SatStatus[s])) where.satStatus = SatStatus[s]
    }
    if (dateFrom || dateTo) {
      where.issuanceDate = {}
      if (dateFrom) where.issuanceDate.gte = dateFrom
      if (dateTo) where.issuanceDate.lte = dateTo
    }

    if (!where.AND) {
      where.AND = []
    }

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(where as Record<string, any>)[field] = { contains: val, mode: 'insensitive' }
      }
    }

    const exactNumberFields = ['subtotal', 'discount', 'total', 'exchangeRate']
    exactNumberFields.forEach(field => {
      const val = parseNumericFilter(searchParams.get(field))
      if (val !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(where as Record<string, any>)[field] = val
      }
    })

    const reservedParams = new Set([
      'companyId',
      'page',
      'limit',
      'query',
      'cfdiType',
      'status',
      'satStatus',
      'dateFrom',
      'dateTo',
      'export',
      'origin'
    ])

    const deferredNumericProjectionFilters: Record<string, number> = {}

    for (const [rawKey, rawValue] of searchParams.entries()) {
      if (reservedParams.has(rawKey) || !rawValue) {
        continue
      }

      if (simpleFilterFields.includes(rawKey) || exactNumberFields.includes(rawKey)) {
        continue
      }

      if (rawKey === 'issuanceDate') {
        const parsedDateFilter = parseColumnDateFilter(rawValue)
        if (parsedDateFilter?.start || parsedDateFilter?.end) {
          ;(where.AND as Prisma.InvoiceWhereInput[]).push({
            issuanceDate: {
              ...(parsedDateFilter.start ? { gte: parsedDateFilter.start } : {}),
              ...(parsedDateFilter.end ? { lte: parsedDateFilter.end } : {})
            }
          })
        }
        continue
      }

      const key = rawKey.startsWith('attr.') ? rawKey.slice(5) : rawKey
      const hasKeyRawSuffix = rawKey.startsWith('has.') ? rawKey.slice(4) : null

      // DASHBOARD-010 · Prototype pollution defense: only alphanumeric suffixes.
      if (hasKeyRawSuffix !== null && !SAFE_HAS_KEY_REGEX.test(hasKeyRawSuffix)) {
        continue
      }
      const hasKey = hasKeyRawSuffix !== null
        ? `has${hasKeyRawSuffix.toLowerCase().replace(/(?:^|_)(\w)/g, (_m: string, char: string) => char.toUpperCase())}`
        : rawKey

      const normalizedValue = normalizeProjectionUpperText(rawValue)

      if (workpaperComplementFlagKeySet.has(hasKey)) {
        // DASHBOARD-010 · Object.create(null) para complementIndex: sin __proto__ chain pollution vector.
        const safeComplementWhere: Record<string, unknown> = Object.create(null)
        safeComplementWhere[hasKey] = parseBooleanFilter(rawValue)
        ;(where.AND as Prisma.InvoiceWhereInput[]).push({
          complementIndex: {
            is: safeComplementWhere as unknown as Prisma.InputJsonObject
          }
        })
        continue
      }

      if (workpaperComplementVersionKeySet.has(key)) {
        const safeComplementWhere: Record<string, unknown> = Object.create(null)
        safeComplementWhere[key] = { contains: rawValue, mode: 'insensitive' }
        ;(where.AND as Prisma.InvoiceWhereInput[]).push({
          complementIndex: {
            is: safeComplementWhere as unknown as Prisma.InputJsonObject
          }
        })
        continue
      }

      if (workpaperAttributeKeySet.has(key)) {
        const numericValue = workpaperNumericAttributeKeySet.has(key) ? parseNumericFilter(rawValue) : null
        if (numericValue !== null) {
          deferredNumericProjectionFilters[key] = numericValue
          continue
        }

        ;(where.AND as Prisma.InvoiceWhereInput[]).push({
          complementAttributes: {
            some: {
              attributeKey: key,
              valueSearch: {
                contains: normalizedValue,
                mode: 'insensitive'
              }
            }
          }
        })
      }
    }

    const deferredProjectionFilterKeys = Object.keys(deferredNumericProjectionFilters)
    // DASHBOARD-010 · Cap MAX 3 filtros numéricos proyectados (XML scan por filtro → 500batch).
    if (deferredProjectionFilterKeys.length > MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS) {
      return NextResponse.json(
        { error: `Demasiados filtros numéricos. Máximo permitido: ${MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS}.` },
        { status: 400, headers: mergeSecureHeaders() }
      )
    }
    if (deferredProjectionFilterKeys.length > 0) {
      const matchedInvoiceIds = await findInvoiceIdsByProjectedNumericFilters({
        baseWhere: where,
        numericFilters: deferredNumericProjectionFilters,
        organizationId: ctx.organizationId
      })

      if (matchedInvoiceIds.length === 0) {
        return NextResponse.json({
          invoices: [],
          pagination: {
            total: 0,
            page,
            limit,
            totalPages: 0
          }
        }, { status: 200, headers: mergeSecureHeaders() })
      }

      ;(where.AND as Prisma.InvoiceWhereInput[]).push({
        id: {
          in: matchedInvoiceIds
        }
      })
    }

    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { issuanceDate: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          userId: true,
          issuerFiscalEntityId: true,
          uuid: true,
          cfdiType: true,
          series: true,
          folio: true,
          currency: true,
          exchangeRate: true,
          status: true,
          satStatus: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          subtotal: true,
          discount: true,
          total: true,
          ivaTransferred: true,
          ivaWithheld: true,
          isrWithheld: true,
          iepsWithheld: true,
          pdfUrl: true,
          issuanceDate: true,
          certificationDate: true,
          certificationPac: true,
          paymentMethod: true,
          paymentForm: true,
          cfdiUsage: true,
          placeOfExpedition: true,
          exportKey: true,
          objectTaxComprobante: true,
          paymentConditions: true,
          createdAt: true,
          updatedAt: true,
          complementIndex: {
            select: {
              hasPagos: true,
              pagosVersion: true,
              hasNomina: true,
              nominaVersion: true,
              hasCartaPorte: true,
              cartaPorteVersion: true,
              hasComercioExterior: true,
              comercioExteriorVersion: true
            }
          },
          complementAttributes: {
            select: {
              attributeKey: true,
              valueText: true,
              valueNumber: true,
              valueBoolean: true
            }
          }
        }
      }),
      prisma.invoice.count({ where })
    ])

    const invoices = rows.map(r => ({
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
    }))

    return NextResponse.json({
      invoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }, {
      headers: SECURITY_HEADERS
    })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

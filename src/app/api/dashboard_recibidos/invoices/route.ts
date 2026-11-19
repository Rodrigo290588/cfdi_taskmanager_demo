import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import {
  buildProjectionMap,
  normalizeProjectionUpperText,
  workpaperAttributeKeySet,
  workpaperComplementFlagKeySet,
  workpaperComplementVersionKeySet,
  workpaperNumericAttributeKeySet
} from '@/lib/cfdi-workpaper-projection'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import {
  InvoiceWorkpaperQuerySchema,
  MAX_HAS_FILTERS,
  MAX_NUMERIC_PROJECTION_FILTERS,
  INVOICE_WORKPAPER_HARD_VISUAL_LIMIT,
  RECEPTION_HAS_FLAGS,
  type InvoiceWorkpaperQueryParsed
} from '@/schemas/dashboard-recibidos'
import { Permission, hasPermission, type User } from '@/lib/permissions'

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeUpperText(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function toFiniteNumber(value: number) {
  return Number.isFinite(value) ? value : 0
}

function toNumber(value: unknown) {
  if (typeof value === 'number') {
    return toFiniteNumber(value)
  }

  if (typeof value === 'bigint') {
    return toFiniteNumber(Number(value))
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim())
    return toFiniteNumber(parsed)
  }

  if (value && typeof value === 'object') {
    const decimalLike = value as { toNumber?: () => unknown }
    if (typeof decimalLike.toNumber === 'function') {
      const parsed = decimalLike.toNumber()
      return typeof parsed === 'number' ? toFiniteNumber(parsed) : 0
    }
  }

  return 0
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return ''

  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function getCfdiTypesFilter(value: string | null) {
  if (!value) {
    return []
  }

  const map = new Map<string, string>([
    ['INGRESO', 'I'],
    ['I', 'I'],
    ['EGRESO', 'E'],
    ['E', 'E'],
    ['PAGO', 'P'],
    ['P', 'P'],
    ['TRASLADO', 'T'],
    ['T', 'T'],
    ['NOMINA', 'N'],
    ['N', 'N']
  ])

  return Array.from(
    new Set(
      value
        .split(',')
        .map(item => normalizeUpperText(item))
        .map(item => map.get(item) || item)
        .filter(Boolean)
    )
  )
}

function parseBooleanFilter(value: string) {
  const normalized = normalizeProjectionUpperText(value)
  if (['1', 'TRUE', 'SI', 'SÍ', 'YES'].includes(normalized)) return true
  if (['0', 'FALSE', 'NO'].includes(normalized)) return false
  return true
}

type ProviderUploadedCfdiWorkpaperRow = Prisma.ProviderUploadedCfdiGetPayload<{
  select: {
    id: true
    memberId: true
    uploadedByUserId: true
    receiverCompanyId: true
    uuid: true
    cfdiType: true
    series: true
    folio: true
    currency: true
    paymentMethod: true
    paymentForm: true
    validationStatus: true
    satEstado: true
    issuerRfc: true
    issuerName: true
    receiverRfc: true
    receiverName: true
    subtotal: true
    discount: true
    total: true
    issuanceDate: true
    certificationDate: true
    createdAt: true
    updatedAt: true
  }
  include: {
    complementIndex: true
    complementAttributes: true
  }
}>

const DIRECT_TEXT_FILTER_MAP: Record<string, keyof Prisma.ProviderUploadedCfdiWhereInput> = {
  id: 'id',
  userId: 'uploadedByUserId',
  uploadedByUserId: 'uploadedByUserId',
  issuerFiscalEntityId: 'receiverCompanyId',
  uuid: 'uuid',
  series: 'series',
  folio: 'folio',
  currency: 'currency',
  issuerRfc: 'issuerRfc',
  issuerName: 'issuerName',
  receiverRfc: 'receiverRfc',
  receiverName: 'receiverName',
  paymentMethod: 'paymentMethod',
  paymentForm: 'paymentForm'
}

const DIRECT_NUMERIC_FILTER_MAP: Record<string, keyof Prisma.ProviderUploadedCfdiWhereInput> = {
  subtotal: 'subtotal',
  discount: 'discount',
  total: 'total'
}

const DIRECT_DATE_FILTER_MAP: Record<string, keyof Prisma.ProviderUploadedCfdiWhereInput> = {
  issuanceDate: 'issuanceDate',
  certificationDate: 'certificationDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
}

const RESERVED_QUERY_PARAMS = new Set([
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
  'origin',
  'orgId'
])

type DynamicFilterState = {
  hasFilterCount: number
  numericProjectionCount: number
}

function createDateFilter(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
  if (!dateFrom && !dateTo) return undefined

  const filter: Prisma.DateTimeFilter = Object.create(null)
  if (dateFrom) filter.gte = new Date(dateFrom)
  if (dateTo) {
    const endDateExclusive = new Date(`${dateTo}T00:00:00.000Z`)
    endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1)
    filter.lt = endDateExclusive
  }
  return filter
}

function createBaseInvoiceWhere(params: {
  organizationId: string
  companyId: string
  query: string
  cfdiTypes: string[]
  satStatus: string
  status: string
  dateFrom?: string
  dateTo?: string
}): Prisma.ProviderUploadedCfdiWhereInput {
  const where: Prisma.ProviderUploadedCfdiWhereInput = Object.create(null)
  where.organizationId = params.organizationId
  where.receiverCompanyId = params.companyId
  where.validationStatus = 'APPROVED'

  if (params.cfdiTypes.length > 0) where.cfdiType = { in: params.cfdiTypes }
  if (params.satStatus) where.satEstado = params.satStatus
  if (params.status) where.validationStatus = { contains: params.status, mode: 'insensitive' }

  const dateFilter = createDateFilter(params.dateFrom, params.dateTo)
  if (dateFilter) where.issuanceDate = dateFilter

  if (params.query) {
    where.OR = [
      { uuid: { contains: params.query, mode: 'insensitive' } },
      { issuerRfc: { contains: params.query, mode: 'insensitive' } },
      { issuerName: { contains: params.query, mode: 'insensitive' } },
      { receiverRfc: { contains: params.query, mode: 'insensitive' } },
      { receiverName: { contains: params.query, mode: 'insensitive' } },
      { series: { contains: params.query, mode: 'insensitive' } },
      { folio: { contains: params.query, mode: 'insensitive' } },
      { fileName: { contains: params.query, mode: 'insensitive' } }
    ]
  }

  return where
}

function appendDirectFilter(
  filters: Prisma.ProviderUploadedCfdiWhereInput[],
  rawKey: string,
  rawValue: string,
): boolean {
  const textField = DIRECT_TEXT_FILTER_MAP[rawKey]
  if (textField) {
    filters.push({ [textField]: { contains: rawValue, mode: 'insensitive' } })
    return true
  }

  const dateField = DIRECT_DATE_FILTER_MAP[rawKey]
  if (dateField) {
    const dateValue = rawValue.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      const start = new Date(`${dateValue}T00:00:00.000Z`)
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 1)
      filters.push({ [dateField]: { gte: start, lt: end } })
    }
    return true
  }

  const numericField = DIRECT_NUMERIC_FILTER_MAP[rawKey]
  if (numericField && !Number.isNaN(Number(rawValue))) {
    filters.push({ [numericField]: new Prisma.Decimal(Number(rawValue).toFixed(6)) })
    return true
  }

  return false
}

function appendProjectedFilter(
  filters: Prisma.ProviderUploadedCfdiWhereInput[],
  rawKey: string,
  rawValue: string,
  state: DynamicFilterState,
): void {
  const key = rawKey.startsWith('attr.') ? rawKey.slice(5) : rawKey
  const hasKeyRaw = rawKey.startsWith('has.') ? rawKey.slice(4) : null
  const hasKey = hasKeyRaw
    ? 'has' + hasKeyRaw.toLowerCase().replace(/(?:^|_)(\w)/g, (_m: string, char: string) => char.toUpperCase())
    : rawKey
  const normalizedValue = normalizeProjectionUpperText(rawValue)

  if (rawKey.startsWith('has.') && !RECEPTION_HAS_FLAGS.has(hasKey as never)) return
  if (rawKey.startsWith('has.')) {
    if (state.hasFilterCount >= MAX_HAS_FILTERS) return
    state.hasFilterCount++
  }

  if (workpaperComplementFlagKeySet.has(hasKey)) {
    filters.push({ complementIndex: { is: { [hasKey]: parseBooleanFilter(rawValue) } } })
    return
  }

  if (workpaperComplementVersionKeySet.has(key)) {
    filters.push({ complementIndex: { is: { [key]: { contains: rawValue, mode: 'insensitive' } } } })
    return
  }

  if (!workpaperAttributeKeySet.has(key)) return
  if (workpaperNumericAttributeKeySet.has(key) && !Number.isNaN(Number(rawValue))) {
    if (state.numericProjectionCount >= MAX_NUMERIC_PROJECTION_FILTERS) return
    state.numericProjectionCount++
    filters.push({
      complementAttributes: {
        some: { attributeKey: key, valueNumber: new Prisma.Decimal(Number(rawValue).toFixed(6)) }
      }
    })
    return
  }

  filters.push({
    complementAttributes: {
      some: { attributeKey: key, valueSearch: { contains: normalizedValue, mode: 'insensitive' } }
    }
  })
}

function buildDynamicInvoiceFilters(searchParams: URLSearchParams): Prisma.ProviderUploadedCfdiWhereInput[] {
  const filters: Prisma.ProviderUploadedCfdiWhereInput[] = []
  const state: DynamicFilterState = { hasFilterCount: 0, numericProjectionCount: 0 }

  for (const [rawKey, rawValue] of searchParams.entries()) {
    if (RESERVED_QUERY_PARAMS.has(rawKey) || !rawValue) continue
    if (appendDirectFilter(filters, rawKey, rawValue)) continue
    appendProjectedFilter(filters, rawKey, rawValue, state)
  }

  return filters
}

function formatInvoiceQueryIssues(
  issues: ReadonlyArray<{
    path?: ReadonlyArray<PropertyKey>
    message: string
  }>
) {
  const fieldErrors: Record<string, string[]> = {}
  const formErrors: string[] = []

  for (const issue of issues) {
    const field = (issue.path || [])
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part === 'number') return part.toString()
        return part.description || 'symbol'
      })
      .join('.')
    if (!field) {
      formErrors.push(issue.message)
      continue
    }
    fieldErrors[field] = [...(fieldErrors[field] || []), issue.message]
  }

  return { fieldErrors, formErrors }
}

export async function GET(request: NextRequest) {
  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'drilldownInvoices', requireCompanyId: true })
    const { ctx, sessionUserId } = scoped
    const companyId = ctx.companyId!

    const rawQuery = Object.fromEntries(scoped.searchParams.entries())
    const schemaQuery = Object.fromEntries(
      Object.entries(rawQuery).filter(([key]) => RESERVED_QUERY_PARAMS.has(key))
    )
    const parsed = InvoiceWorkpaperQuerySchema.safeParse(schemaQuery)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Parámetros inválidos',
          issues: formatInvoiceQueryIssues(parsed.error.issues)
        },
        { status: 400, headers: { ...SECURITY_HEADERS } }
      )
    }
    const q = parsed.data as InvoiceWorkpaperQueryParsed

    const member = (await prisma.member.findFirst({
      where: { userId: sessionUserId, status: 'APPROVED', organizationId: ctx.organizationId },
      include: { organization: true }
    }))!

    // DR-010 · PII gate: hasPermission() sobre el User enriquecido del contexto
    const userForPermission: User = ctx.enrichedUser
    const canViewPII = hasPermission(
      userForPermission,
      Permission.RECEP_FISCAL_AUDIT_PII,
      member.organizationId
    )

    const page = Math.max(Number(q.page || 1), 1)
    const userLimit = Math.min(Math.max(Number(q.limit || 20), 1), Number(q.limit) || 20)
    // DR-005 clamp hard limit
    const limit = Math.min(userLimit, INVOICE_WORKPAPER_HARD_VISUAL_LIMIT)
    const query = normalizeText(q.query)
    const satStatus = normalizeUpperText(q.satStatus)
    const status = normalizeUpperText(q.status)
    const dateFrom = q.dateFrom
    const dateTo = q.dateTo
    const cfdiTypes = getCfdiTypesFilter(q.cfdiType ?? null)

    const where = createBaseInvoiceWhere({
      organizationId: member.organizationId,
      companyId,
      query,
      cfdiTypes,
      satStatus,
      status,
      dateFrom,
      dateTo
    })
    where.AND = buildDynamicInvoiceFilters(scoped.searchParams)

    const skip = (page - 1) * limit
    // DR-006 · NO incluir xmlBlob (nunca descifrar en listado) y NO incluir xmlContent directo
    const [rows, total] = await Promise.all([
      prisma.providerUploadedCfdi.findMany({
        where,
        orderBy: [
          { issuanceDate: 'desc' },
          { updatedAt: 'desc' },
          { uuid: 'desc' }
        ],
        skip,
        take: limit,
        select: {
          id: true,
          memberId: true,
          uploadedByUserId: true,
          receiverCompanyId: true,
          uuid: true,
          cfdiType: true,
          series: true,
          folio: true,
          currency: true,
          paymentMethod: true,
          paymentForm: true,
          validationStatus: true,
          satEstado: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          subtotal: true,
          discount: true,
          total: true,
          issuanceDate: true,
          certificationDate: true,
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
              comercioExteriorVersion: true,
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
        },
      }) as unknown as Promise<ProviderUploadedCfdiWorkpaperRow[]>,
      prisma.providerUploadedCfdi.count({ where })
    ])

    const pagedInvoices = rows.map(row => {
      const projection = buildProjectionMap({
        attributes: row.complementAttributes,
        complementIndex: row.complementIndex
      })

      // DR-006 · xmlContent: undefined evita que se serialice. No volcamos nunca el hash ni el ciphertext al listado.
      const base: Record<string, unknown> & { xmlContent?: undefined } = {
        id: row.id,
        issuerFiscalEntityId: row.receiverCompanyId || '',
        uuid: normalizeUpperText(row.uuid),
        cfdiType: normalizeUpperText(row.cfdiType),
        series: normalizeText(row.series) || null,
        folio: normalizeText(row.folio) || null,
        currency: normalizeUpperText(row.currency) || 'MXN',
        exchangeRate: null as number | null,
        status: normalizeUpperText(row.validationStatus),
        satStatus: normalizeUpperText(row.satEstado),
        issuerRfc: normalizeUpperText(row.issuerRfc),
        issuerName: normalizeText(row.issuerName),
        receiverRfc: normalizeUpperText(row.receiverRfc),
        receiverName: normalizeText(row.receiverName),
        subtotal: toNumber(row.subtotal),
        discount: toNumber(row.discount),
        total: toNumber(row.total),
        ivaTransferred: 0,
        ivaWithheld: 0,
        isrWithheld: 0,
        iepsWithheld: 0,
        // DR-006
        xmlContent: undefined,
        pdfUrl: null as string | null,
        issuanceDate: toIsoString(row.issuanceDate),
        certificationDate: toIsoString(row.certificationDate) || null,
        certificationPac: String(projection.certificationPac ?? ''),
        paymentMethod: normalizeUpperText(row.paymentMethod),
        paymentForm: normalizeUpperText(row.paymentForm),
        cfdiUsage: String(projection.cfdiUsage ?? ''),
        placeOfExpedition: String(projection.placeOfExpedition ?? ''),
        exportKey: String(projection.exportKey ?? ''),
        objectTaxComprobante: String(projection.objectTaxComprobante ?? '') || null,
        paymentConditions: String(projection.paymentConditions ?? '') || null,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        projection
      }

      // DR-010 · PII bind solo si tiene permiso
      if (canViewPII) {
        base.userId = row.uploadedByUserId || ''
        base.memberId = row.memberId
        base.uploadedByUserId = row.uploadedByUserId
      }

      return base
    })

    return NextResponse.json({
      invoices: pagedInvoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }, { status: 200, headers: { ...SECURITY_HEADERS } })
  } catch (error) {
    // DR-008 safe catch
    return dashboardJsonErrorResponse(error)
  }
}

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

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
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

export async function GET(request: NextRequest) {
  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'drilldownInvoices', requireCompanyId: true })
    const { ctx, sessionUserId } = scoped
    const companyId = ctx.companyId!

    const rawQuery = Object.fromEntries(scoped.searchParams.entries())
    const parsed = InvoiceWorkpaperQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parámetros inválidos', issues: parsed.error.flatten().fieldErrors }, { status: 400, headers: { ...SECURITY_HEADERS } })
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

    // DR-004 anti Prototype-Pollution
    const where: Prisma.ProviderUploadedCfdiWhereInput = Object.create(null)
    where.organizationId = member.organizationId
    where.receiverCompanyId = companyId
    where.validationStatus = 'APPROVED'

    if (cfdiTypes.length > 0) {
      where.cfdiType = { in: cfdiTypes }
    }
    if (satStatus) {
      where.satEstado = satStatus
    }
    if (status) {
      where.validationStatus = { contains: status, mode: 'insensitive' }
    }
    if (dateFrom || dateTo) {
      where.issuanceDate = Object.create(null) as Prisma.DateTimeFilter
      if (dateFrom) (where.issuanceDate as Prisma.DateTimeFilter).gte = new Date(dateFrom as unknown as string)
      if (dateTo) (where.issuanceDate as Prisma.DateTimeFilter).lte = new Date(dateTo as unknown as string)
    }
    if (query) {
      where.OR = [
        { uuid: { contains: query, mode: 'insensitive' } },
        { issuerRfc: { contains: query, mode: 'insensitive' } },
        { issuerName: { contains: query, mode: 'insensitive' } },
        { receiverRfc: { contains: query, mode: 'insensitive' } },
        { receiverName: { contains: query, mode: 'insensitive' } },
        { series: { contains: query, mode: 'insensitive' } },
        { folio: { contains: query, mode: 'insensitive' } },
        { fileName: { contains: query, mode: 'insensitive' } }
      ]
    }

    const andFilters: Prisma.ProviderUploadedCfdiWhereInput[] = []
    where.AND = andFilters

    const directTextFilterMap: Record<string, keyof Prisma.ProviderUploadedCfdiWhereInput> = Object.create(null)
    Object.assign(directTextFilterMap, {
      id: 'id',
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
    })

    const directNumericFilterMap: Record<string, keyof Prisma.ProviderUploadedCfdiWhereInput> = Object.create(null)
    Object.assign(directNumericFilterMap, {
      subtotal: 'subtotal',
      discount: 'discount',
      total: 'total'
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
      'origin',
      'orgId'
    ])

    let hasFilterCount = 0
    let numericProjectionCount = 0

    for (const [rawKey, rawValue] of scoped.searchParams.entries()) {
      if (reservedParams.has(rawKey) || !rawValue) {
        continue
      }

      if (rawKey in directTextFilterMap) {
        andFilters.push({
          [directTextFilterMap[rawKey]]: {
            contains: rawValue,
            mode: 'insensitive'
          }
        })
        continue
      }

      if (rawKey in directNumericFilterMap && !Number.isNaN(Number(rawValue))) {
        andFilters.push({
          [directNumericFilterMap[rawKey]]: new Prisma.Decimal(Number(rawValue).toFixed(6))
        })
        continue
      }

      const key = rawKey.startsWith('attr.') ? rawKey.slice(5) : rawKey
      const hasKeyRaw = rawKey.startsWith('has.') ? rawKey.slice(4) : null
      const hasKey = hasKeyRaw
        ? 'has' + hasKeyRaw.toLowerCase().replace(/(?:^|_)(\w)/g, (_m: string, char: string) => char.toUpperCase())
        : rawKey
      const normalizedValue = normalizeProjectionUpperText(rawValue)

      // DR-004 whitelist has.* flags
      if (rawKey.startsWith('has.') && !RECEPTION_HAS_FLAGS.has(hasKey as unknown as typeof RECEPTION_HAS_FLAGS extends Set<infer T> ? T : never)) {
        continue
      }
      if (rawKey.startsWith('has.')) {
        if (hasFilterCount >= MAX_HAS_FILTERS) continue
        hasFilterCount++
      }

      if (workpaperComplementFlagKeySet.has(hasKey)) {
        andFilters.push({
          complementIndex: {
            is: {
              [hasKey]: parseBooleanFilter(rawValue)
            }
          }
        })
        continue
      }

      if (workpaperComplementVersionKeySet.has(key)) {
        andFilters.push({
          complementIndex: {
            is: {
              [key]: {
                contains: rawValue,
                mode: 'insensitive'
              }
            }
          }
        })
        continue
      }

      if (workpaperAttributeKeySet.has(key)) {
        if (workpaperNumericAttributeKeySet.has(key) && !Number.isNaN(Number(rawValue))) {
          // DR-004 MAX_NUMERIC_PROJECTION_FILTERS anti-exhaustion
          if (numericProjectionCount >= MAX_NUMERIC_PROJECTION_FILTERS) continue
          numericProjectionCount++
          andFilters.push({
            complementAttributes: {
              some: {
                attributeKey: key,
                valueNumber: new Prisma.Decimal(Number(rawValue).toFixed(6))
              }
            }
          })
        } else {
          andFilters.push({
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
    }

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

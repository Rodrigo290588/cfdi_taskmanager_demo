import { Prisma, CfdiType, SatStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { createLogger } from "@/lib/logger"
import { hasPermission, Permission } from "@/lib/permissions"
import {
  FiscalControlQuerySchema,
  validateFcDynamicFilters,
  ALLOWED_FC_DB_FIELDS,
  fp32,
  safeErrSummary,
  parsePositiveInt,
  massDownloadJsonResponse,
} from "@/lib/mass-downloads-route-utils"
import {
  readFiscalControlConciliationPage,
  readFiscalControlConciliationTotals,
  readFiscalControlMonthlyTypeDistribution,
  readFiscalControlStatusDifferences,
} from "@/lib/fiscal-control-conciliation-service"
import {
  FISCAL_CONTROL_STATUS_DIFFERENCES,
  type FiscalControlStatusDifference,
} from "@/lib/fiscal-control-conciliation-types"
import {
  canAccessFiscalControlOrganization,
  mapFiscalControlConciliationRow,
} from "@/lib/fiscal-control-response-adapter"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

type IssuanceRange = {
  issuanceStartDate?: Date
  issuanceEndDate?: Date
}

type CompleteIssuanceRange = Required<IssuanceRange>

function parseDateOnly(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999Z" : "00:00:00.000Z"}`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function resolveRequestedIssuanceRange(
  startDate: string | undefined,
  endDate: string | undefined,
): CompleteIssuanceRange | undefined {
  const issuanceStartDate = parseDateOnly(startDate)
  const issuanceEndDate = parseDateOnly(endDate, true)
  if (!issuanceStartDate || !issuanceEndDate || issuanceStartDate > issuanceEndDate) {
    return undefined
  }

  return { issuanceStartDate, issuanceEndDate }
}

const FISCAL_CONTROL_USER_SELECT = {
  id: true,
  systemRole: true,
  memberships: {
    where: { status: 'APPROVED' },
    select: { id: true, organizationId: true, role: true, status: true },
  },
} satisfies Prisma.UserSelect

const FISCAL_CONTROL_COMPANY_SELECT = {
  rfc: true,
  businessName: true,
  id: true,
} satisfies Prisma.CompanySelect

type FiscalControlAccess = {
  user: Prisma.UserGetPayload<{ select: typeof FISCAL_CONTROL_USER_SELECT }>
  company: Prisma.CompanyGetPayload<{ select: typeof FISCAL_CONTROL_COMPANY_SELECT }>
  targetOrgId: string
  fiscalEntityId: string | undefined
}

type FiscalControlAccessResult =
  | { access: FiscalControlAccess }
  | { error: string; status: 403 | 404 }

async function resolveFiscalControlAccess(
  userId: string,
  companyId: string,
): Promise<FiscalControlAccessResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: FISCAL_CONTROL_USER_SELECT,
  })
  if (!user || user.memberships.length === 0) {
    return { error: "Sin membresía activa", status: 403 }
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: FISCAL_CONTROL_COMPANY_SELECT,
  })
  if (!company) {
    return { error: "Empresa no encontrada", status: 404 }
  }

  const fiscalEntity = await prisma.fiscalEntity.findFirst({
    where: { rfc: company.rfc, isActive: true },
    select: { organizationId: true, id: true },
  })
  const companyAccess = fiscalEntity
    ? null
    : await prisma.companyAccess.findFirst({
        where: { companyId: company.id },
        select: { organizationId: true },
      })
  const targetOrgId = fiscalEntity?.organizationId ?? companyAccess?.organizationId ?? null

  if (!targetOrgId) {
    return { error: "Empresa sin organización asociada", status: 403 }
  }

  const organizationIds = new Set(user.memberships.map(membership => membership.organizationId))
  if (!canAccessFiscalControlOrganization(organizationIds, targetOrgId)) {
    return { error: "Sin acceso a la empresa", status: 403 }
  }

  if (!user.memberships.some(membership => membership.organizationId === targetOrgId)) {
    return { error: "Sin acceso a la organización", status: 403 }
  }

  if (!hasPermission(user, Permission.DASHBOARD_FISCAL_VIEW, targetOrgId)) {
    return { error: "Permiso insuficiente: Panel Fiscal", status: 403 }
  }

  return {
    access: {
      user,
      company,
      targetOrgId,
      fiscalEntityId: fiscalEntity?.id,
    },
  }
}

const CFDI_TYPE_TO_SAT_EFFECT = {
  INGRESO: 'I',
  EGRESO: 'E',
  TRASLADO: 'T',
  NOMINA: 'N',
  PAGO: 'P',
} as const

const SAT_EFFECT_TO_CFDI_TYPE = {
  ingreso: 'I',
  egreso: 'E',
  traslado: 'T',
  nomina: 'N',
  pago: 'P',
} as const

function buildColumnDateRange(parts: number[]): { gte: Date; lte: Date } | undefined {
  if (parts.length === 3) {
    const [day, month, year] = parts
    if (year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        gte: new Date(year, month - 1, day, 0, 0, 0),
        lte: new Date(year, month - 1, day, 23, 59, 59, 999),
      }
    }
  }

  if (parts.length === 2) {
    const [month, year] = parts
    if (year > 1900 && month >= 1 && month <= 12) {
      return {
        gte: new Date(year, month - 1, 1, 0, 0, 0),
        lte: new Date(year, month, 0, 23, 59, 59, 999),
      }
    }
  }

  if (parts.length === 1) {
    const [year] = parts
    if (year > 2000 && year < 2100) {
      return {
        gte: new Date(year, 0, 1, 0, 0, 0),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      }
    }
  }

  return undefined
}

function buildDynamicColumnFilter(
  key: string,
  value: string,
): Prisma.SatMetadataWhereInput | undefined {
  const dbField = ALLOWED_FC_DB_FIELDS[key]
  if (!dbField) {
    return undefined
  }

  const query = value.toLowerCase()
  if (['uuid', 'issuerRfc', 'receiverRfc', 'receiverName', 'issuerName', 'certificationPac'].includes(key)) {
    return { [dbField]: { contains: query, mode: 'insensitive' } }
  }

  if (key === 'cfdiType') {
    return { [dbField]: SAT_EFFECT_TO_CFDI_TYPE[query as keyof typeof SAT_EFFECT_TO_CFDI_TYPE] ?? { contains: query, mode: 'insensitive' } }
  }

  if (key === 'total') {
    const total = Number(query.replace(/[^0-9.-]+/g, ""))
    return Number.isNaN(total) ? undefined : { [dbField]: { equals: total } }
  }

  if (!['issuanceDate', 'certificationDate', 'cancelationDate'].includes(key)) {
    return undefined
  }

  const parts = query.split(/[/-]/).map(Number).filter(part => !Number.isNaN(part))
  const range = buildColumnDateRange(parts)
  return range ? { [dbField]: range } : undefined
}

function applyDynamicColumnFilters(
  baseSatWhere: Prisma.SatMetadataWhereInput,
  columnFilters: Record<string, string>,
): void {
  if (Object.keys(columnFilters).length === 0) {
    return
  }

  const filters = baseSatWhere.AND ??= []
  if (!Array.isArray(filters)) {
    return
  }

  for (const [key, value] of Object.entries(columnFilters)) {
    const filter = buildDynamicColumnFilter(key, value)
    if (filter) {
      filters.push(filter)
    }
  }
}

type LegacyFiscalControlWhereInput = {
  targetRfc: string
  fiscalEntityId: string | undefined
  rfcFilter: string
  cfdiType: string | undefined
  satStatus: string | undefined
  issuanceRange: CompleteIssuanceRange
  columnFilters: Record<string, string>
}

function buildLegacyFiscalControlWheres(input: LegacyFiscalControlWhereInput) {
  return {
    baseSatWhere: buildLegacySatMetadataWhere(input, input.issuanceRange),
    baseInvoiceWhere: buildLegacyInvoiceWhere(input, input.issuanceRange),
  }
}

function buildLegacySatMetadataWhere(
  input: LegacyFiscalControlWhereInput,
  issuanceRange: CompleteIssuanceRange,
): Prisma.SatMetadataWhereInput {
  const baseSatWhere: Prisma.SatMetadataWhereInput = {
    OR: [{ rfcEmisor: input.targetRfc }, { rfcReceptor: input.targetRfc }],
  }
  if (input.rfcFilter) {
    baseSatWhere.AND = [{
      OR: [{ rfcEmisor: input.rfcFilter }, { rfcReceptor: input.rfcFilter }],
    }]
  }
  if (input.cfdiType && input.cfdiType !== "ALL" && input.cfdiType in CFDI_TYPE_TO_SAT_EFFECT) {
    baseSatWhere.efectoComprobante = CFDI_TYPE_TO_SAT_EFFECT[
      input.cfdiType as keyof typeof CFDI_TYPE_TO_SAT_EFFECT
    ]
  }
  if (input.satStatus && input.satStatus !== "ALL") {
    baseSatWhere.estatus = input.satStatus === "VIGENTE" ? "1" : "0"
  }
  baseSatWhere.fechaEmision = {
    gte: issuanceRange.issuanceStartDate,
    lte: issuanceRange.issuanceEndDate,
  }
  applyDynamicColumnFilters(baseSatWhere, input.columnFilters)
  return baseSatWhere
}

function buildLegacyInvoiceWhere(
  input: LegacyFiscalControlWhereInput,
  issuanceRange: CompleteIssuanceRange,
): Prisma.InvoiceWhereInput {
  const baseInvoiceWhere: Prisma.InvoiceWhereInput = input.fiscalEntityId
    ? { issuerFiscalEntityId: input.fiscalEntityId, issuerRfc: input.targetRfc }
    : { id: { equals: "__FISCAL_ENTITY_REQUIRED__" } }
  if (input.rfcFilter && Array.isArray(baseInvoiceWhere.AND)) {
    baseInvoiceWhere.AND.push({
      OR: [{ issuerRfc: input.rfcFilter }, { receiverRfc: input.rfcFilter }],
    })
  }
  if (input.cfdiType && input.cfdiType !== "ALL" && input.cfdiType in CfdiType) {
    baseInvoiceWhere.cfdiType = input.cfdiType as CfdiType
  }
  if (input.satStatus && input.satStatus !== "ALL" && input.satStatus in SatStatus) {
    baseInvoiceWhere.satStatus = input.satStatus as SatStatus
  }
  baseInvoiceWhere.issuanceDate = {
    gte: issuanceRange.issuanceStartDate,
    lte: issuanceRange.issuanceEndDate,
  }
  return baseInvoiceWhere
}

type MonthlyFiscalControlSummary = {
  label: string
  metadataCount: number
  xmlCount: number
  ingreso: number
  egreso: number
  traslado: number
  nomina: number
  pago: number
}

type MetadataTypeBreakdown = {
  ingreso: number
  egreso: number
  nomina: number
  pago: number
  traslado: number
}

type MetadataTypeDirectionBreakdown = Record<
  keyof MetadataTypeBreakdown,
  Readonly<{ emitidos: number; recibidos: number }>
>

function buildMetadataTypeDirectionBreakdown(
  emittedGroups: readonly { efectoComprobante: string | null; _count: { _all: number } }[],
  receivedGroups: readonly { efectoComprobante: string | null; _count: { _all: number } }[],
): MetadataTypeDirectionBreakdown {
  const countByType = (
    groups: readonly { efectoComprobante: string | null; _count: { _all: number } }[],
    type: string,
  ) => groups.find(group => group.efectoComprobante === type)?._count._all ?? 0
  const directionCounts = (type: string) => ({
    emitidos: countByType(emittedGroups, type),
    recibidos: countByType(receivedGroups, type),
  })
  return {
    ingreso: directionCounts('I'),
    egreso: directionCounts('E'),
    nomina: directionCounts('N'),
    pago: directionCounts('P'),
    traslado: directionCounts('T'),
  }
}

async function readLegacyFiscalControlSummary(
  baseSatWhere: Prisma.SatMetadataWhereInput,
  baseInvoiceWhere: Prisma.InvoiceWhereInput,
  issuanceRange: CompleteIssuanceRange,
  targetRfc: string,
) {
  const [vigentes, cancelados, canceladosTotalResult, emittedTypeGroups, receivedTypeGroups] = await Promise.all([
    prisma.satMetadata.count({ where: { ...baseSatWhere, estatus: "1" } }),
    prisma.satMetadata.count({ where: { ...baseSatWhere, estatus: "0" } }),
    prisma.satMetadata.aggregate({
      where: { ...baseSatWhere, estatus: "0" },
      _sum: { monto: true },
    }),
    prisma.satMetadata.groupBy({
      by: ['efectoComprobante'],
      where: { ...baseSatWhere, rfcEmisor: targetRfc },
      _count: { _all: true },
    }),
    prisma.satMetadata.groupBy({
      by: ['efectoComprobante'],
      where: { ...baseSatWhere, rfcReceptor: targetRfc },
      _count: { _all: true },
    }),
  ])
  const monthly = await Promise.all(
    getMonthsInRange(issuanceRange).map(monthStart =>
      readLegacyFiscalControlMonth(
        monthStart,
        issuanceRange,
        baseSatWhere,
        baseInvoiceWhere,
      ),
    ),
  )

  return {
    cancelationStats: {
      vigentes,
      cancelados,
      totalCanceladoAmount: Number(canceladosTotalResult._sum.monto ?? 0),
    },
    metadataTypeBreakdown: buildMetadataTypeDirectionBreakdown(
      emittedTypeGroups,
      receivedTypeGroups,
    ),
    monthly,
  }
}

function getMonthsInRange(issuanceRange: CompleteIssuanceRange): Date[] {
  const months: Date[] = []
  const current = new Date(
    issuanceRange.issuanceStartDate.getFullYear(),
    issuanceRange.issuanceStartDate.getMonth(),
    1,
  )
  const last = new Date(
    issuanceRange.issuanceEndDate.getFullYear(),
    issuanceRange.issuanceEndDate.getMonth(),
    1,
  )
  while (current <= last) {
    months.push(new Date(current))
    current.setMonth(current.getMonth() + 1)
  }
  return months
}

async function readLegacyFiscalControlMonth(
  monthStart: Date,
  issuanceRange: CompleteIssuanceRange,
  baseSatWhere: Prisma.SatMetadataWhereInput,
  baseInvoiceWhere: Prisma.InvoiceWhereInput,
): Promise<MonthlyFiscalControlSummary> {
  const monthEnd = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  )
  const start = new Date(Math.max(monthStart.getTime(), issuanceRange.issuanceStartDate.getTime()))
  const end = new Date(Math.min(monthEnd.getTime(), issuanceRange.issuanceEndDate.getTime()))
  const satWhere: Prisma.SatMetadataWhereInput = {
    ...baseSatWhere,
    fechaEmision: { gte: start, lte: end },
  }
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    ...baseInvoiceWhere,
    issuanceDate: { gte: start, lte: end },
  }
  const [metadataCount, xmlCount, typeGroups] = await Promise.all([
    prisma.satMetadata.count({ where: satWhere }),
    prisma.invoice.count({ where: invoiceWhere }),
    prisma.satMetadata.groupBy({
      by: ['efectoComprobante'],
      where: satWhere,
      _sum: { monto: true },
    }),
  ])
  const sumByType = (type: string) => {
    const group = typeGroups.find(item => item.efectoComprobante === type)
    return Number(group?._sum.monto ?? 0)
  }

  return {
    label: `${String(monthStart.getMonth() + 1).padStart(2, "0")}/${monthStart.getFullYear()}`,
    metadataCount,
    xmlCount,
    ingreso: sumByType('I'),
    egreso: sumByType('E'),
    traslado: sumByType('T'),
    nomina: sumByType('N'),
    pago: sumByType('P'),
  }
}

export async function GET(request: Request) {
  const reqId = crypto.randomUUID()
  const startedAt = performance.now()
  const logger = createLogger({ service: 'fiscal-control-api', correlationId: reqId })
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: "No autorizado", reqId }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const summaryOnly = searchParams.get("summaryOnly") === "true"
    const statusDifferenceParam = searchParams.get("statusDifference")
    const statusDifference = FISCAL_CONTROL_STATUS_DIFFERENCES.includes(
      statusDifferenceParam as FiscalControlStatusDifference,
    )
      ? statusDifferenceParam as FiscalControlStatusDifference
      : undefined
    const rawQuery = {
      companyId: searchParams.get("companyId") || undefined,
      rfc: searchParams.get("rfc")?.trim().toUpperCase() || undefined,
      cfdiType: searchParams.get("cfdiType") || undefined,
      satStatus: searchParams.get("satStatus") || undefined,
      year: parseNumber(searchParams.get("year")),
      month: parseNumber(searchParams.get("month")),
      payrollStartDate: searchParams.get("payrollStartDate") || undefined,
      payrollEndDate: searchParams.get("payrollEndDate") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      origin: searchParams.get("origin") || undefined,
      cursor: searchParams.get("cursor") || undefined,
      page: parsePositiveInt(searchParams.get("page") || null, 1, 10000),
      pageSize: parsePositiveInt(searchParams.get("pageSize") || null, 50, 100),
    }

    const parsedQuery = FiscalControlQuerySchema.safeParse(rawQuery)
    if (!parsedQuery.success) {
      return massDownloadJsonResponse(
        { error: "Parámetros inválidos", reqId, issues: parsedQuery.error.issues.map(i => i.path.join('.')) },
        { status: 400 }
      )
    }

    const {
      companyId,
      cfdiType: cfdiTypeParam,
      satStatus: satStatusParam,
      page: pageParam,
      pageSize: pageSizeParam,
      rfc: rfcParam,
      cursor,
      payrollStartDate,
      payrollEndDate,
      startDate,
      endDate,
      origin,
    } = parsedQuery.data
    const rfcFilter = rfcParam?.trim().toUpperCase() || ""
    const issuanceRange = resolveRequestedIssuanceRange(startDate, endDate)
    if (!issuanceRange) {
      return massDownloadJsonResponse(
        { error: "Selecciona una fecha inicial y una fecha final válidas", reqId },
        { status: 400 },
      )
    }

    const accessResult = await resolveFiscalControlAccess(session.user.id, companyId)
    if ('error' in accessResult) {
      return massDownloadJsonResponse(
        { error: accessResult.error, reqId },
        { status: accessResult.status },
      )
    }
    const { company, targetOrgId, fiscalEntityId } = accessResult.access
    const targetRfc = company.rfc

    const rawFilters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      if (key.startsWith("filter_") && value.trim() !== "") {
        rawFilters[key.replace("filter_", "")] = value.trim()
      }
    })
    const columnFilters = validateFcDynamicFilters(rawFilters)
    const reconciliationFilters = {
      organizationId: targetOrgId,
      companyId: company.id,
      companyRfc: targetRfc,
      fiscalEntityId,
      origins: origin && origin !== "ALL" ? [origin] : undefined,
      rfc: rfcFilter || undefined,
      cfdiType: cfdiTypeParam,
      satStatus: satStatusParam,
      columnFilters,
      ...issuanceRange,
      payrollPaymentStartDate: parseDateOnly(payrollStartDate),
      payrollPaymentEndDate: parseDateOnly(payrollEndDate, true),
    }

    if (statusDifference) {
      const differences = await readFiscalControlStatusDifferences(
        reconciliationFilters,
        statusDifference,
      )
      return massDownloadJsonResponse({
        reqId,
        status: statusDifference,
        rows: differences,
      })
    }

    if (summaryOnly) {
      const { baseSatWhere, baseInvoiceWhere } = buildLegacyFiscalControlWheres({
        targetRfc,
        fiscalEntityId,
        rfcFilter,
        cfdiType: cfdiTypeParam,
        satStatus: satStatusParam,
        issuanceRange,
        columnFilters,
      })
      const [summary, totals, monthly] = await Promise.all([
        readLegacyFiscalControlSummary(baseSatWhere, baseInvoiceWhere, issuanceRange, targetRfc),
        readFiscalControlConciliationTotals(reconciliationFilters),
        readFiscalControlMonthlyTypeDistribution(reconciliationFilters),
      ])
      const completenessPercent = totals.metadataTotal > 0
        ? Number(((totals.xmlTotal / totals.metadataTotal) * 100).toFixed(2))
        : 0
      const discrepancyPercent = totals.metadataTotal > 0
        ? Number(((totals.metadataTotal - totals.xmlTotal) / totals.metadataTotal * 100).toFixed(2))
        : 0

      logger.info('fiscal_control.summary_completed', {
        durationMs: Math.round(performance.now() - startedAt),
        monthlyBuckets: monthly.length,
        metadataTotal: totals.metadataTotal,
        xmlTotal: totals.xmlTotal,
      })
      return massDownloadJsonResponse({
        reqId,
        ...summary,
        monthlyTypeDistribution: monthly,
        kpis: {
          metadataTotal: totals.metadataTotal,
          xmlTotal: totals.xmlTotal,
          completenessPercent,
        },
        xmlTypeBreakdown: totals.xmlTypeBreakdown,
        discrepancyAlert: discrepancyPercent > 5,
        discrepancyPercent,
      })
    }

    const page = Math.max(1, pageParam)
    const pageSize = Math.min(100, Math.max(10, pageSizeParam))
    const conciliationPage = await readFiscalControlConciliationPage({
      filters: reconciliationFilters,
      cursor,
      pageSize,
      cache: true,
    })
    const globalSummary = conciliationPage.summary
    logger.info('fiscal_control.page_completed', {
      durationMs: Math.round(performance.now() - startedAt),
      returnedRows: conciliationPage.rows.length,
      pageSize,
      hasNextCursor: Boolean(conciliationPage.nextCursor),
      origin: origin ?? 'ALL',
      reconciliationScope: globalSummary.scope,
      cacheStatus: conciliationPage.cacheStatus,
    })

    return massDownloadJsonResponse({
      reqId,
      sourceCounts: globalSummary.sourceCounts,
      reconciliationSummary: globalSummary.reconciliationSummary,
      statusComparison: globalSummary.statusComparison,
      table: {
        rows: conciliationPage.rows.map(mapFiscalControlConciliationRow),
        pagination: {
          page,
          pageSize,
          total: 0,
          totalPages: 0,
          nextCursor: conciliationPage.nextCursor,
          mode: "CURSOR",
          reconciliationScope: globalSummary.scope,
        },
      },
    })
  } catch (err) {
    const summary = safeErrSummary(err)
    const errId = fp32(JSON.stringify(summary))
    logger.error('fiscal_control.query_failed', err, {
      durationMs: Math.round(performance.now() - startedAt),
      errId,
    })
    console.error('[fiscal-control 500]', { reqId, errId, summary })
    return massDownloadJsonResponse(
      { error: "Error al obtener datos del Panel de Control Fiscal", reqId, errId },
      { status: 500 }
    )
  }
}

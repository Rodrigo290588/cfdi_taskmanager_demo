import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { hasPermission, Permission } from "@/lib/permissions"
import {
  FiscalControlQuerySchema,
  validateFcDynamicFilters,
  fp32,
  safeErrSummary,
  parsePositiveInt,
  massDownloadJsonResponse,
  SECURITY_HEADERS,
  buildCsvRow,
  CSV_BOM,
  buildRfc6266ContentDisposition,
} from "@/lib/mass-downloads-route-utils"
import {
  createFiscalControlCsvContent,
  exceedsFiscalControlExportThreshold,
} from "@/lib/fiscal-control-export"
import { FISCAL_CONTROL_ASYNC_EXPORT_THRESHOLD } from "@/lib/fiscal-control-conciliation-types"
import { getFiscalControlExportQueue } from "@/lib/queue"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CSV_STREAM_BATCH = 5000
const SAT_METADATA_SELECT = {
  uuid: true,
  rfcEmisor: true,
  nombreEmisor: true,
  rfcReceptor: true,
  nombreReceptor: true,
  fechaEmision: true,
  fechaCertificacionSat: true,
  fechaCancelacion: true,
  efectoComprobante: true,
  monto: true,
  estatus: true,
  rfcPac: true,
} satisfies Prisma.SatMetadataSelect

type SatCsvRow = Prisma.SatMetadataGetPayload<{ select: typeof SAT_METADATA_SELECT }>

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function formatDate(date: Date | null): string {
  if (!date) return ""
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

const inverseTypeMap: Record<string, string> = {
  'I': 'INGRESO',
  'E': 'EGRESO',
  'T': 'TRASLADO',
  'N': 'NOMINA',
  'P': 'PAGO'
}

const CSV_HEADERS = [
  "UUID",
  "RFC Emisor",
  "Nombre Emisor",
  "RFC Receptor",
  "Nombre Receptor",
  "Fecha Emisión",
  "Fecha Certificación",
  "Fecha Cancelación",
  "Tipo CFDI",
  "Monto",
  "Estado SAT",
  "Origen (XML)",
  "PAC"
]

function renderRowsChunk(rows: SatCsvRow[], existingXmlSet: Set<string>): string {
  let out = ''
  for (const row of rows) {
    const hasXml = existingXmlSet.has(row.uuid)
    const cells = [
      row.uuid,
      row.rfcEmisor,
      row.nombreEmisor,
      row.rfcReceptor,
      row.nombreReceptor,
      formatDate(row.fechaEmision),
      formatDate(row.fechaCertificacionSat),
      formatDate(row.fechaCancelacion),
      row.efectoComprobante ? (inverseTypeMap[row.efectoComprobante] || row.efectoComprobante) : "",
      row.monto,
      row.estatus === "1" ? "VIGENTE" : "CANCELADO",
      hasXml ? "SI" : "NO",
      row.rfcPac,
    ]
    out += buildCsvRow(cells as unknown[])
  }
  return out
}

export async function buildCsvStream(
  baseSatWhere: Prisma.SatMetadataWhereInput,
  totalRows: number,
): Promise<ReadableStream<Uint8Array>> {
  const totalCount = totalRows
  const totalUuids = await prisma.satMetadata.findMany({
    where: baseSatWhere,
    orderBy: { fechaEmision: "desc" },
    take: totalCount,
    select: { uuid: true },
  })
  const allUuids = totalUuids.map(r => r.uuid)
  const existingInvoices = allUuids.length > 0
    ? await prisma.invoice.findMany({
        where: { uuid: { in: allUuids } },
        select: { uuid: true },
      })
    : []
  const existingXmlSet = new Set(existingInvoices.map(x => x.uuid))

  const encoder = new TextEncoder()
  let cursorIndex = 0

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(CSV_BOM + buildCsvRow(CSV_HEADERS)))
    },
    async pull(controller) {
      if (cursorIndex >= totalCount) {
        controller.close()
        return
      }
      const take = Math.min(CSV_STREAM_BATCH, totalCount - cursorIndex)
      const batchUuids = allUuids.slice(cursorIndex, cursorIndex + take)
      const rowsBatch = batchUuids.length > 0
        ? await prisma.satMetadata.findMany({
            where: { uuid: { in: batchUuids } },
            select: SAT_METADATA_SELECT,
          })
        : []
      const rowsById = new Map(rowsBatch.map(r => [r.uuid, r]))
      const orderedRows: SatCsvRow[] = []
      for (const id of batchUuids) {
        const row = rowsById.get(id)
        if (row) orderedRows.push(row)
      }
      const chunkStr = renderRowsChunk(orderedRows, existingXmlSet)
      controller.enqueue(encoder.encode(chunkStr))
      cursorIndex += take
      if (cursorIndex >= totalCount) {
        controller.close()
      }
    },
  })
}

const FISCAL_EXPORT_USER_SELECT = {
  id: true,
  systemRole: true,
  memberships: {
    where: { status: 'APPROVED' },
    select: { id: true, organizationId: true, role: true, status: true },
  },
} satisfies Prisma.UserSelect

const FISCAL_EXPORT_COMPANY_SELECT = {
  rfc: true,
  businessName: true,
  id: true,
} satisfies Prisma.CompanySelect

type FiscalExportAccess = {
  user: Prisma.UserGetPayload<{ select: typeof FISCAL_EXPORT_USER_SELECT }>
  company: Prisma.CompanyGetPayload<{ select: typeof FISCAL_EXPORT_COMPANY_SELECT }>
  targetOrgId: string
  fiscalEntityId: string | undefined
}

type FiscalExportAccessResult =
  | { access: FiscalExportAccess }
  | { error: string; status: 403 | 404 }

async function resolveFiscalExportAccess(
  userId: string,
  companyId: string,
): Promise<FiscalExportAccessResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: FISCAL_EXPORT_USER_SELECT,
  })
  if (!user || user.memberships.length === 0) {
    return { error: "Sin membresía activa", status: 403 }
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: FISCAL_EXPORT_COMPANY_SELECT,
  })
  if (!company) {
    return { error: "Empresa no encontrada", status: 404 }
  }

  const fiscalEntityForCompany = await prisma.fiscalEntity.findFirst({
    where: { rfc: company.rfc, isActive: true },
    select: { organizationId: true, id: true },
  })
  const fallbackOrgViaAccess = fiscalEntityForCompany
    ? null
    : await prisma.companyAccess.findFirst({
        where: { companyId: company.id },
        select: { organizationId: true },
      })
  const targetOrgId = fiscalEntityForCompany?.organizationId
    ?? fallbackOrgViaAccess?.organizationId
    ?? null

  if (!targetOrgId) {
    return { error: "Empresa sin organización asociada", status: 403 }
  }

  if (!user.memberships.some(membership => membership.organizationId === targetOrgId)) {
    return { error: "Sin acceso a la empresa", status: 403 }
  }

  const canViewFiscal = hasPermission(user, Permission.DASHBOARD_FISCAL_EXPORT, targetOrgId)
    || hasPermission(user, Permission.DASHBOARD_FISCAL_VIEW, targetOrgId)
  if (!canViewFiscal) {
    return { error: "Permiso insuficiente: Exportar Panel Fiscal", status: 403 }
  }

  return {
    access: {
      user,
      company,
      targetOrgId,
      fiscalEntityId: fiscalEntityForCompany?.id,
    },
  }
}

function buildIssuanceRange(
  startDate: string | undefined,
  endDate: string | undefined,
  year: number | undefined,
  month: number | undefined,
) {
  if (startDate || endDate) {
    return {
      issuanceStartDate: startDate ? new Date(`${startDate}T00:00:00.000`) : undefined,
      issuanceEndDate: endDate ? new Date(`${endDate}T23:59:59.999`) : undefined,
    }
  }

  if (!year) {
    return {}
  }

  return month
    ? {
        issuanceStartDate: new Date(year, month - 1, 1),
        issuanceEndDate: new Date(year, month, 0, 23, 59, 59, 999),
      }
    : {
        issuanceStartDate: new Date(year, 0, 1),
        issuanceEndDate: new Date(year, 11, 31, 23, 59, 59, 999),
      }
}

export async function GET(request: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: "No autorizado", reqId }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const rawQuery = {
      companyId: searchParams.get("companyId") || undefined,
      rfc: searchParams.get("rfc")?.trim().toUpperCase() || undefined,
      cfdiType: searchParams.get("cfdiType") || undefined,
      satStatus: searchParams.get("satStatus") || undefined,
      year: parseNumber(searchParams.get("year")),
      month: parseNumber(searchParams.get("month")),
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      origin: searchParams.get("origin") || undefined,
      page: parsePositiveInt(searchParams.get("page") || null, 1, 10000),
      pageSize: parsePositiveInt(searchParams.get("pageSize") || null, 50, 200),
    }

    const parsedQuery = FiscalControlQuerySchema.safeParse(rawQuery)
    if (!parsedQuery.success) {
      return massDownloadJsonResponse(
        { error: "Parámetros inválidos", reqId, issues: parsedQuery.error.issues.map(i => i.path.join('.')) },
        { status: 400 }
      )
    }

    const { companyId, cfdiType: cfdiTypeParam, satStatus: satStatusParam, year: yearParam, month: monthParam, rfc: rfcParam, startDate, endDate, origin } = parsedQuery.data
    const rfcFilter = rfcParam?.trim().toUpperCase() || ""

    const accessResult = await resolveFiscalExportAccess(session.user.id, companyId)
    if ('error' in accessResult) {
      return massDownloadJsonResponse(
        { error: accessResult.error, reqId },
        { status: accessResult.status },
      )
    }
    const { user, company, targetOrgId, fiscalEntityId } = accessResult.access
    const targetRfc = company.rfc

    const rawFilters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      if (key.startsWith("filter_") && value.trim() !== "") {
        rawFilters[key.replace("filter_", "")] = value.trim()
      }
    })
    const columnFilters = validateFcDynamicFilters(rawFilters)

    const issuanceRange = buildIssuanceRange(startDate, endDate, yearParam, monthParam)
    const reconciliationFilters = {
      organizationId: targetOrgId,
      companyId: company.id,
      companyRfc: targetRfc,
      fiscalEntityId,
      origins: origin && origin !== 'ALL' ? [origin] : undefined,
      rfc: rfcFilter || undefined,
      cfdiType: cfdiTypeParam,
      satStatus: satStatusParam,
      columnFilters,
      ...issuanceRange,
    }
    const requiresAsync = await exceedsFiscalControlExportThreshold(
      reconciliationFilters,
      FISCAL_CONTROL_ASYNC_EXPORT_THRESHOLD,
    )
    if (requiresAsync) {
      const exportId = crypto.randomUUID()
      await getFiscalControlExportQueue().add(
        'generate-fiscal-control-export',
        { exportId, requestedByUserId: user.id, organizationId: targetOrgId, filters: reconciliationFilters },
        { jobId: exportId, removeOnComplete: { age: 24 * 60 * 60 }, removeOnFail: { age: 24 * 60 * 60 } },
      )
      return massDownloadJsonResponse(
        {
          reqId,
          status: 'QUEUED',
          exportId,
          message: 'La exportación supera 10,000 registros y se generará en segundo plano.',
        },
        { status: 202 },
      )
    }

    const today = new Date()
    const ts = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}_${String(today.getHours()).padStart(2, '0')}${String(today.getMinutes()).padStart(2, '0')}`
    const safeName = `panel_fiscal_${company.rfc || targetRfc}_${ts}.csv`
    const contentDisposition = buildRfc6266ContentDisposition(safeName, 'attachment')
    // Generate the bounded synchronous export before sending headers. This ensures
    // failures are returned as JSON instead of producing a partial CSV download.
    const csvContent = await createFiscalControlCsvContent(reconciliationFilters)

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition,
        "X-Request-Id": reqId,
      },
    })
  } catch (err) {
    const summary = safeErrSummary(err)
    const errId = fp32(JSON.stringify(summary))
    console.error('[fiscal-control-export 500]', { reqId, errId, summary })
    return massDownloadJsonResponse(
      { error: "Error al exportar datos", reqId, errId },
      { status: 500 }
    )
  }
}

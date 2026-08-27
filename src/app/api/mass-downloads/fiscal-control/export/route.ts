import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { hasPermission, Permission } from "@/lib/permissions"
import {
  FiscalControlQuerySchema,
  validateFcDynamicFilters,
  ALLOWED_FC_DB_FIELDS,
  fp32,
  safeErrSummary,
  parsePositiveInt,
  massDownloadJsonResponse,
  SECURITY_HEADERS,
  escapeCsvValue,
  buildCsvRow,
  CSV_BOM,
  buildRfc6266ContentDisposition,
} from "@/lib/mass-downloads-route-utils"

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

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
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

async function buildCsvStream(
  baseSatWhere: Prisma.SatMetadataWhereInput,
  totalRows: number,
  _targetRfc: string,
): Promise<ReadableStream<Uint8Array>> {
  void _targetRfc
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

    const { companyId, cfdiType: cfdiTypeParam, satStatus: satStatusParam, year: yearParam, month: monthParam, rfc: rfcParam } = parsedQuery.data
    const rfcFilter = rfcParam?.trim().toUpperCase() || ""

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        systemRole: true,
        memberships: {
          where: { status: 'APPROVED' },
          select: { id: true, organizationId: true, role: true, status: true }
        }
      }
    })
    if (!user || user.memberships.length === 0) {
      return massDownloadJsonResponse({ error: "Sin membresía activa", reqId }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        rfc: true,
        businessName: true,
        id: true,
      },
    })

    if (!company) {
      return massDownloadJsonResponse({ error: "Empresa no encontrada", reqId }, { status: 404 })
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

    const targetOrgId = fiscalEntityForCompany?.organizationId ?? fallbackOrgViaAccess?.organizationId ?? null

    if (!targetOrgId) {
      return massDownloadJsonResponse({ error: "Empresa sin organización asociada", reqId }, { status: 403 })
    }

    const orgIdsAllowed = new Set(user.memberships.map(m => m.organizationId))
    if (!orgIdsAllowed.has(targetOrgId)) {
      return massDownloadJsonResponse({ error: "Sin acceso a la empresa", reqId }, { status: 403 })
    }

    const member = user.memberships.find(m => m.organizationId === targetOrgId)
    if (!member) {
      return massDownloadJsonResponse({ error: "Sin acceso a la organización", reqId }, { status: 403 })
    }

    const canViewFiscal = hasPermission(user, Permission.DASHBOARD_FISCAL_EXPORT, targetOrgId)
      || hasPermission(user, Permission.DASHBOARD_FISCAL_VIEW, targetOrgId)
    if (!canViewFiscal) {
      return massDownloadJsonResponse({ error: "Permiso insuficiente: Exportar Panel Fiscal", reqId }, { status: 403 })
    }

    const targetRfc = company.rfc

    const typeMap: Record<string, string> = {
      'INGRESO': 'I',
      'EGRESO': 'E',
      'TRASLADO': 'T',
      'NOMINA': 'N',
      'PAGO': 'P'
    }

    const rawFilters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      if (key.startsWith("filter_") && value.trim() !== "") {
        rawFilters[key.replace("filter_", "")] = value.trim()
      }
    })
    const columnFilters = validateFcDynamicFilters(rawFilters)

    const baseSatWhere: Prisma.SatMetadataWhereInput = {
      OR: [
        { rfcEmisor: targetRfc },
        { rfcReceptor: targetRfc }
      ]
    }

    if (rfcFilter) {
      baseSatWhere.AND = [
        {
          OR: [
            { rfcEmisor: rfcFilter },
            { rfcReceptor: rfcFilter }
          ]
        }
      ]
    }

    if (cfdiTypeParam && cfdiTypeParam !== "ALL" && typeMap[cfdiTypeParam]) {
      baseSatWhere.efectoComprobante = typeMap[cfdiTypeParam]
    }

    if (satStatusParam && satStatusParam !== "ALL") {
      baseSatWhere.estatus = satStatusParam === "VIGENTE" ? "1" : "0"
    }

    if (yearParam && monthParam) {
      const start = new Date(yearParam, monthParam - 1, 1)
      const end = new Date(yearParam, monthParam, 0, 23, 59, 59, 999)
      baseSatWhere.fechaEmision = {
        gte: start,
        lte: end,
      }
    } else if (yearParam) {
      const start = new Date(yearParam, 0, 1)
      const end = new Date(yearParam, 11, 31, 23, 59, 59, 999)
      baseSatWhere.fechaEmision = {
        gte: start,
        lte: end,
      }
    }

    if (Object.keys(columnFilters).length > 0) {
      if (!baseSatWhere.AND) baseSatWhere.AND = []

      Object.entries(columnFilters).forEach(([key, value]) => {
        const query = value.toLowerCase()
        const andArray = baseSatWhere.AND as Prisma.SatMetadataWhereInput[]
        const dbField = ALLOWED_FC_DB_FIELDS[key]
        if (!dbField) return

        switch(key) {
          case 'uuid':
          case 'issuerRfc':
          case 'receiverRfc':
          case 'receiverName':
          case 'issuerName':
          case 'certificationPac':
            andArray.push({ [dbField]: { contains: query, mode: 'insensitive' } })
            break
          case 'cfdiType':
            const mapInverse: Record<string, string> = {
              'ingreso': 'I', 'egreso': 'E', 'traslado': 'T', 'nomina': 'N', 'pago': 'P'
            }
            if (mapInverse[query]) {
              andArray.push({ [dbField]: mapInverse[query] })
            } else {
              andArray.push({ [dbField]: { contains: query, mode: 'insensitive' } })
            }
            break
          case 'total':
            const num = Number(query.replace(/[^0-9.-]+/g, ""))
            if (!isNaN(num)) andArray.push({ [dbField]: { equals: num } })
            break
          case 'issuanceDate':
          case 'certificationDate':
          case 'cancelationDate':
            const parts = query.split(/[\/\-]/).map(Number).filter(n => !isNaN(n))
            if (parts.length === 3) {
              const [day, month, year] = parts
              if (year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                andArray.push({
                  [dbField]: {
                    gte: new Date(year, month - 1, day, 0, 0, 0),
                    lte: new Date(year, month - 1, day, 23, 59, 59, 999)
                  }
                })
              }
            } else if (parts.length === 2) {
              const [month, year] = parts
              if (year > 1900 && month >= 1 && month <= 12) {
                andArray.push({
                  [dbField]: {
                    gte: new Date(year, month - 1, 1, 0, 0, 0),
                    lte: new Date(year, month, 0, 23, 59, 59, 999)
                  }
                })
              }
            } else if (parts.length === 1) {
              const [year] = parts
              if (year > 2000 && year < 2100) {
                andArray.push({
                  [dbField]: {
                    gte: new Date(year, 0, 1, 0, 0, 0),
                    lte: new Date(year, 11, 31, 23, 59, 59, 999)
                  }
                })
              }
            }
            break
        }
      })
    }

    const MAX_ROWS_ENV = process.env.MASS_DOWNLOADS_EXPORT_CSV_MAX_ROWS
    const MAX_ROWS = MAX_ROWS_ENV ? parsePositiveInt(MAX_ROWS_ENV, 100000, 500000) : 100000

    const totalCount = await prisma.satMetadata.count({ where: baseSatWhere })
    if (totalCount > MAX_ROWS) {
      return massDownloadJsonResponse(
        { error: `Demasiados registros para exportar (${totalCount}). Máximo permitido: ${MAX_ROWS}. Reduzca el rango de fechas o agregue filtros.`, reqId },
        { status: 400 }
      )
    }
    if (totalCount === 0) {
      return massDownloadJsonResponse(
        { error: "No hay registros para exportar con los filtros seleccionados", reqId },
        { status: 400 }
      )
    }

    const today = new Date()
    const ts = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}_${String(today.getHours()).padStart(2, '0')}${String(today.getMinutes()).padStart(2, '0')}`
    const safeName = `panel_fiscal_${company.rfc || targetRfc}_${ts}.csv`
    const contentDisposition = buildRfc6266ContentDisposition(safeName, 'attachment')
    const stream = await buildCsvStream(baseSatWhere, totalCount, targetRfc)
    void CSV_HEADERS
    void escapeCsvValue

    return new NextResponse(stream, {
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

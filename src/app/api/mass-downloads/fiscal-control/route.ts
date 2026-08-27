import { Prisma, CfdiType, SatStatus } from "@prisma/client"
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
} from "@/lib/mass-downloads-route-utils"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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

    const { companyId, cfdiType: cfdiTypeParam, satStatus: satStatusParam, year: yearParam, month: monthParam, page: pageParam, pageSize: pageSizeParam, rfc: rfcParam } = parsedQuery.data
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

    const canViewFiscal = hasPermission(user, Permission.DASHBOARD_FISCAL_VIEW, targetOrgId)
    if (!canViewFiscal) {
      return massDownloadJsonResponse({ error: "Permiso insuficiente: Panel Fiscal", reqId }, { status: 403 })
    }

    const targetRfc = company.rfc

    const typeMap: Record<string, string> = {
      'INGRESO': 'I',
      'EGRESO': 'E',
      'TRASLADO': 'T',
      'NOMINA': 'N',
      'PAGO': 'P'
    }

    // Extract dynamic column filters (whitelist only)
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
      // SAT Metadata usually uses "1" for Vigente and "0" for Cancelado, or literal "1"/"0"
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

    // Apply dynamic column filters to baseSatWhere (whitelist only)
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

    const baseInvoiceWhere: Prisma.InvoiceWhereInput = {
      AND: [
        {
          OR: [
            { issuerRfc: targetRfc },
            { receiverRfc: targetRfc },
          ],
        },
      ],
    }

    if (rfcFilter) {
      if (Array.isArray(baseInvoiceWhere.AND)) {
        baseInvoiceWhere.AND.push({
          OR: [{ issuerRfc: rfcFilter }, { receiverRfc: rfcFilter }],
        })
      }
    }

    if (cfdiTypeParam && cfdiTypeParam !== "ALL" && cfdiTypeParam in CfdiType) {
      baseInvoiceWhere.cfdiType = cfdiTypeParam as CfdiType
    }

    if (satStatusParam && satStatusParam !== "ALL" && satStatusParam in SatStatus) {
      baseInvoiceWhere.satStatus = satStatusParam as SatStatus
    }

    if (yearParam && monthParam) {
      const start = new Date(yearParam, monthParam - 1, 1)
      const end = new Date(yearParam, monthParam, 0, 23, 59, 59, 999)
      baseInvoiceWhere.issuanceDate = {
        gte: start,
        lte: end,
      }
    } else if (yearParam) {
      const start = new Date(yearParam, 0, 1)
      const end = new Date(yearParam, 11, 31, 23, 59, 59, 999)
      baseInvoiceWhere.issuanceDate = {
        gte: start,
        lte: end,
      }
    }

    const [metadataTotal, xmlTotal] = await Promise.all([
      prisma.satMetadata.count({ where: baseSatWhere }),
      prisma.invoice.count({ where: baseInvoiceWhere }),
    ])

    const completenessPercent =
      metadataTotal > 0 ? Number(((xmlTotal / metadataTotal) * 100).toFixed(2)) : 0
    const discrepancyPercent = metadataTotal > 0 ? Number(((metadataTotal - xmlTotal) / metadataTotal * 100).toFixed(2)) : 0
    const discrepancyAlert = discrepancyPercent > 5

    // New: Cancelation Stats (Donut Chart)
    const [vigentesCount, canceladosCount, canceladosTotalResult] = await Promise.all([
      prisma.satMetadata.count({
        where: {
          ...baseSatWhere,
          estatus: "1", // 1 = Vigente
        },
      }),
      prisma.satMetadata.count({
        where: {
          ...baseSatWhere,
          estatus: "0", // 0 = Cancelado
        },
      }),
      prisma.satMetadata.aggregate({
        where: {
          ...baseSatWhere,
          estatus: "0",
        },
        _sum: {
          monto: true,
        },
      }),
    ])

    const cancelationStats = {
      vigentes: vigentesCount,
      cancelados: canceladosCount,
      totalCanceladoAmount: Number(canceladosTotalResult._sum.monto || 0),
    }

    const now = new Date()
    const monthlyPromises: Array<Promise<{
      label: string
      metadataCount: number
      xmlCount: number
      ingreso: number
      egreso: number
      traslado: number
      nomina: number
      pago: number
    }>> = []

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
      const label = `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`

      const satWhere: Prisma.SatMetadataWhereInput = {
        ...baseSatWhere,
        fechaEmision: {
          gte: start,
          lte: end,
        },
      }

      const invoiceWhere: Prisma.InvoiceWhereInput = {
        ...baseInvoiceWhere,
        issuanceDate: {
          gte: start,
          lte: end,
        },
      }

      monthlyPromises.push(
        Promise.all([
          prisma.satMetadata.count({ where: satWhere }),
          prisma.invoice.count({ where: invoiceWhere }),
          prisma.satMetadata.groupBy({
            by: ['efectoComprobante'],
            where: satWhere,
            _sum: {
              monto: true
            }
          })
        ]).then(([mc, xc, typeGroups]) => {
          const getSum = (type: string) => {
            const group = typeGroups.find(g => g.efectoComprobante === type)
            return Number(group?._sum.monto || 0)
          }

          return {
            label,
            metadataCount: mc,
            xmlCount: xc,
            ingreso: getSum('I'),
            egreso: getSum('E'),
            traslado: getSum('T'),
            nomina: getSum('N'),
            pago: getSum('P'),
          }
        })
      )
    }

    const monthly = await Promise.all(monthlyPromises)

    const page = Math.max(1, pageParam)
    const pageSize = Math.min(200, Math.max(10, pageSizeParam))
    const skip = (page - 1) * pageSize

    const [satRows, satTotal] = await Promise.all([
      prisma.satMetadata.findMany({
        where: baseSatWhere,
        orderBy: { fechaEmision: "desc" },
        skip,
        take: pageSize,
        select: {
          uuid: true,
          rfcEmisor: true,
          nombreEmisor: true,
          rfcReceptor: true,
          nombreReceptor: true,
          fechaEmision: true,
          monto: true,
          estatus: true,
          efectoComprobante: true,
          fechaCertificacionSat: true,
          fechaCancelacion: true,
          rfcPac: true,
        },
      }),
      prisma.satMetadata.count({ where: baseSatWhere }),
    ])

    // [MD-008 FIX] Batch IN query: single findMany instead of N findUnique + no xmlContent leak
    const satRowUuids = satRows.map(r => r.uuid)
    const existingInvoicesMap = new Map<string, { id: string }>()
    if (satRowUuids.length > 0) {
      const existingInvoices = await prisma.invoice.findMany({
        where: { uuid: { in: satRowUuids } },
        select: { uuid: true, id: true },
      })
      for (const inv of existingInvoices) {
        existingInvoicesMap.set(inv.uuid, { id: inv.id })
      }
    }

    const mapType = (t: string | null) => {
      if (t === 'I') return 'INGRESO'
      if (t === 'E') return 'EGRESO'
      if (t === 'T') return 'TRASLADO'
      if (t === 'N') return 'NOMINA'
      if (t === 'P') return 'PAGO'
      return 'DESCONOCIDO'
    }

    const rowsWithXml = satRows.map((row) => {
      const xml = existingInvoicesMap.get(row.uuid)
      return {
        uuid: row.uuid,
        issuerRfc: row.rfcEmisor,
        issuerName: row.nombreEmisor || "",
        receiverRfc: row.rfcReceptor,
        receiverName: row.nombreReceptor || "",
        issuanceDate: row.fechaEmision,
        total: Number(row.monto || 0),
        satStatus: row.estatus === "1" ? "VIGENTE" : "CANCELADO",
        hasXml: Boolean(xml),
        xmlContent: "",
        cfdiType: mapType(row.efectoComprobante),
        series: "",
        folio: "",
        currency: "MXN",
        exchangeRate: 1,
        subtotal: 0,
        discount: 0,
        ivaTrasladado: 0,
        ivaRetenido: 0,
        isrRetenido: 0,
        iepsRetenido: 0,
        certificationDate: row.fechaCertificacionSat,
        cancelationDate: row.fechaCancelacion,
        certificationPac: row.rfcPac || "",
        paymentMethod: "",
        paymentForm: "",
        usageCfdi: "",
        expeditionPlace: "",
      }
    })

    const totalPages = satTotal === 0 ? 0 : Math.ceil(satTotal / pageSize)

    return massDownloadJsonResponse({
      reqId,
      kpis: {
        metadataTotal,
        xmlTotal,
        completenessPercent,
      },
      cancelationStats,
      monthly,
      discrepancyAlert,
      discrepancyPercent,
      table: {
        rows: rowsWithXml,
        pagination: {
          page,
          pageSize,
          total: satTotal,
          totalPages,
        },
      },
    })
  } catch (err) {
    const summary = safeErrSummary(err)
    const errId = fp32(JSON.stringify(summary))
    console.error('[fiscal-control 500]', { reqId, errId, summary })
    return massDownloadJsonResponse(
      { error: "Error al obtener datos del Panel de Control Fiscal", reqId, errId },
      { status: 500 }
    )
  }
}

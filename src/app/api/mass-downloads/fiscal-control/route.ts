import { NextResponse } from "next/server"
import { Prisma, CfdiType, SatStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const rfcFilter = searchParams.get("rfc")?.trim().toUpperCase() || ""
    const cfdiTypeParam = searchParams.get("cfdiType") || ""
    const satStatusParam = searchParams.get("satStatus") || ""
    const yearParam = parseNumber(searchParams.get("year"))
    const monthParam = parseNumber(searchParams.get("month"))
    const pageParam = parseNumber(searchParams.get("page")) || 1
    const pageSizeParam = parseNumber(searchParams.get("pageSize")) || 50

    if (!companyId) {
      return NextResponse.json({ error: "companyId es requerido" }, { status: 400 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true },
    })

    if (!company) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }

    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc: company.rfc },
      select: { id: true, rfc: true },
    })

    if (!fiscalEntity) {
      return NextResponse.json({
        kpis: { metadataTotal: 0, xmlTotal: 0, completenessPercent: 0 },
        monthly: [],
        discrepancyAlert: false,
        discrepancyPercent: 0,
        table: {
          rows: [],
          pagination: { page: pageParam, pageSize: pageSizeParam, total: 0, totalPages: 0 },
        },
      })
    }

    const baseSatWhere: Prisma.SatInvoiceWhereInput = {
      fiscalEntityId: fiscalEntity.id,
    }

    if (rfcFilter) {
      baseSatWhere.OR = [
        { issuerRfc: rfcFilter },
        { receiverRfc: rfcFilter },
      ]
    }

    if (cfdiTypeParam && cfdiTypeParam !== "ALL" && cfdiTypeParam in CfdiType) {
      baseSatWhere.cfdiType = cfdiTypeParam as CfdiType
    }

    if (satStatusParam && satStatusParam !== "ALL" && satStatusParam in SatStatus) {
      baseSatWhere.satStatus = satStatusParam as SatStatus
    }

    if (yearParam && monthParam) {
      const start = new Date(yearParam, monthParam - 1, 1)
      const end = new Date(yearParam, monthParam, 0, 23, 59, 59, 999)
      baseSatWhere.issuanceDate = {
        gte: start,
        lte: end,
      }
    } else if (yearParam) {
      const start = new Date(yearParam, 0, 1)
      const end = new Date(yearParam, 11, 31, 23, 59, 59, 999)
      baseSatWhere.issuanceDate = {
        gte: start,
        lte: end,
      }
    }

    const baseInvoiceWhere: Prisma.InvoiceWhereInput = {
      AND: [
        {
          OR: [
            { issuerRfc: fiscalEntity.rfc },
            { receiverRfc: fiscalEntity.rfc },
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
      prisma.satInvoice.count({ where: baseSatWhere }),
      prisma.invoice.count({ where: baseInvoiceWhere }),
    ])

    const completenessPercent =
      metadataTotal > 0 ? Number(((xmlTotal / metadataTotal) * 100).toFixed(2)) : 0
    const discrepancyPercent = metadataTotal > 0 ? Number(((metadataTotal - xmlTotal) / metadataTotal * 100).toFixed(2)) : 0
    const discrepancyAlert = discrepancyPercent > 5

    // New: Cancelation Stats (Donut Chart)
    const [vigentesCount, canceladosCount, canceladosTotalResult] = await Promise.all([
      prisma.satInvoice.count({
        where: {
          ...baseSatWhere,
          satStatus: SatStatus.VIGENTE,
        },
      }),
      prisma.satInvoice.count({
        where: {
          ...baseSatWhere,
          satStatus: SatStatus.CANCELADO,
        },
      }),
      prisma.satInvoice.aggregate({
        where: {
          ...baseSatWhere,
          satStatus: SatStatus.CANCELADO,
        },
        _sum: {
          total: true,
        },
      }),
    ])

    const cancelationStats = {
      vigentes: vigentesCount,
      cancelados: canceladosCount,
      totalCanceladoAmount: Number(canceladosTotalResult._sum.total || 0),
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

      const satWhere: Prisma.SatInvoiceWhereInput = {
        ...baseSatWhere,
        issuanceDate: {
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

      // We need breakdown by CfdiType for SatInvoice (Metadata)
      // Since aggregate doesn't support grouping by enum easily in a simple query loop without raw query or separate counts,
      // we'll run separate counts/sums for each type. 
      // For performance, a groupBy query would be better, but inside a loop of months, let's just do a groupBy for the month.

      monthlyPromises.push(
        Promise.all([
          prisma.satInvoice.count({ where: satWhere }),
          prisma.invoice.count({ where: invoiceWhere }),
          prisma.satInvoice.groupBy({
            by: ['cfdiType'],
            where: satWhere,
            _sum: {
              total: true
            }
          })
        ]).then(([mc, xc, typeGroups]) => {
          const getSum = (type: CfdiType) => {
            const group = typeGroups.find(g => g.cfdiType === type)
            return Number(group?._sum.total || 0)
          }

          return {
            label,
            metadataCount: mc,
            xmlCount: xc,
            ingreso: getSum(CfdiType.INGRESO),
            egreso: getSum(CfdiType.EGRESO),
            traslado: getSum(CfdiType.TRASLADO),
            nomina: getSum(CfdiType.NOMINA),
            pago: getSum(CfdiType.PAGO),
          }
        })
      )
    }

    const monthly = await Promise.all(monthlyPromises)

    const page = Math.max(1, pageParam)
    const pageSize = Math.min(200, Math.max(10, pageSizeParam))
    const skip = (page - 1) * pageSize

    const [satRows, satTotal] = await Promise.all([
      prisma.satInvoice.findMany({
        where: baseSatWhere,
        orderBy: { issuanceDate: "desc" },
        skip,
        take: pageSize,
        select: {
          uuid: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          issuanceDate: true,
          total: true,
          satStatus: true,
          cfdiType: true,
          series: true,
          folio: true,
          currency: true,
          exchangeRate: true,
          subtotal: true,
          discount: true,
          ivaTrasladado: true,
          ivaRetenido: true,
          isrRetenido: true,
          iepsRetenido: true,
          certificationDate: true,
          certificationPac: true,
          paymentMethod: true,
          paymentForm: true,
          usageCfdi: true,
          expeditionPlace: true,
        },
      }),
      prisma.satInvoice.count({ where: baseSatWhere }),
    ])

    const rowsWithXml = await Promise.all(
      satRows.map(async (row) => {
        const xml = await prisma.invoice.findUnique({
          where: { uuid: row.uuid },
          select: { id: true },
        })
        return {
          uuid: row.uuid,
          issuerRfc: row.issuerRfc,
          issuerName: row.issuerName,
          receiverRfc: row.receiverRfc,
          receiverName: row.receiverName,
          issuanceDate: row.issuanceDate,
          total: Number(row.total),
          satStatus: row.satStatus,
          hasXml: Boolean(xml),
          cfdiType: row.cfdiType,
          series: row.series,
          folio: row.folio,
          currency: row.currency,
          exchangeRate: row.exchangeRate,
          subtotal: Number(row.subtotal),
          discount: Number(row.discount),
          ivaTrasladado: Number(row.ivaTrasladado),
          ivaRetenido: Number(row.ivaRetenido),
          isrRetenido: Number(row.isrRetenido),
          iepsRetenido: Number(row.iepsRetenido),
          certificationDate: row.certificationDate,
          certificationPac: row.certificationPac,
          paymentMethod: row.paymentMethod,
          paymentForm: row.paymentForm,
          usageCfdi: row.usageCfdi,
          expeditionPlace: row.expeditionPlace,
        }
      })
    )

    const totalPages = satTotal === 0 ? 0 : Math.ceil(satTotal / pageSize)

    return NextResponse.json({
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
  } catch {
    return NextResponse.json(
      { error: "Error al obtener datos del Panel de Control Fiscal" },
      { status: 500 }
    )
  }
}

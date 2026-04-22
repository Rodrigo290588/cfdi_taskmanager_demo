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

    const targetRfc = company.rfc

    const typeMap: Record<string, string> = {
      'INGRESO': 'I',
      'EGRESO': 'E',
      'TRASLADO': 'T',
      'NOMINA': 'N',
      'PAGO': 'P'
    }

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
          rfcPac: true,
        },
      }),
      prisma.satMetadata.count({ where: baseSatWhere }),
    ])

    const rowsWithXml = await Promise.all(
      satRows.map(async (row) => {
        const xml = await prisma.invoice.findUnique({
          where: { uuid: row.uuid },
          select: { id: true },
        })
        
        // Map types back to readable
        const mapType = (t: string | null) => {
          if (t === 'I') return 'INGRESO'
          if (t === 'E') return 'EGRESO'
          if (t === 'T') return 'TRASLADO'
          if (t === 'N') return 'NOMINA'
          if (t === 'P') return 'PAGO'
          return 'DESCONOCIDO'
        }

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
          certificationPac: row.rfcPac || "",
          paymentMethod: "",
          paymentForm: "",
          usageCfdi: "",
          expeditionPlace: "",
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

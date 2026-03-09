import { NextResponse } from "next/server"
import { Prisma, CfdiType, SatStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"

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

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return ""
  const stringValue = String(value)
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
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
      select: { id: true },
    })

    const headers = [
      "UUID",
      "RFC Emisor",
      "Nombre Emisor",
      "RFC Receptor",
      "Nombre Receptor",
      "Fecha Emisión",
      "Fecha Certificación",
      "Tipo CFDI",
      "Serie",
      "Folio",
      "Subtotal",
      "Descuento",
      "IVA Trasladado",
      "IVA Retenido",
      "ISR Retenido",
      "IEPS Retenido",
      "Total",
      "Moneda",
      "T. Cambio",
      "Estado SAT",
      "Origen (XML)",
      "Método Pago",
      "Forma Pago",
      "Uso CFDI",
      "Lugar Exp.",
      "PAC"
    ]

    if (!fiscalEntity) {
      return new Response(headers.join(","), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="panel_control_fiscal_cfdi.csv"',
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

    // Fetch ALL matching records without pagination
    const satRows = await prisma.satInvoice.findMany({
      where: baseSatWhere,
      orderBy: { issuanceDate: "desc" },
      select: {
        uuid: true,
        issuerRfc: true,
        issuerName: true,
        receiverRfc: true,
        receiverName: true,
        issuanceDate: true,
        certificationDate: true,
        cfdiType: true,
        series: true,
        folio: true,
        subtotal: true,
        discount: true,
        ivaTrasladado: true,
        ivaRetenido: true,
        isrRetenido: true,
        iepsRetenido: true,
        total: true,
        currency: true,
        exchangeRate: true,
        satStatus: true,
        paymentMethod: true,
        paymentForm: true,
        usageCfdi: true,
        expeditionPlace: true,
        certificationPac: true,
      },
    })

    // Optimization: Fetch existing XMLs in bulk
    const satUuids = satRows.map((row) => row.uuid)
    
    // Check which ones have XML
    const existingXmls = await prisma.invoice.findMany({
      where: {
        uuid: { in: satUuids },
      },
      select: { uuid: true },
    })

    const existingXmlSet = new Set(existingXmls.map((x) => x.uuid))

    // Generate CSV content
    const csvRows = satRows.map((row) => {
      const hasXml = existingXmlSet.has(row.uuid)
      return [
        escapeCsv(row.uuid),
        escapeCsv(row.issuerRfc),
        escapeCsv(row.issuerName),
        escapeCsv(row.receiverRfc),
        escapeCsv(row.receiverName),
        escapeCsv(formatDate(row.issuanceDate)),
        escapeCsv(formatDate(row.certificationDate)),
        escapeCsv(row.cfdiType),
        escapeCsv(row.series),
        escapeCsv(row.folio),
        escapeCsv(row.subtotal),
        escapeCsv(row.discount),
        escapeCsv(row.ivaTrasladado),
        escapeCsv(row.ivaRetenido),
        escapeCsv(row.isrRetenido),
        escapeCsv(row.iepsRetenido),
        escapeCsv(row.total),
        escapeCsv(row.currency),
        escapeCsv(row.exchangeRate),
        escapeCsv(row.satStatus),
        hasXml ? "SI" : "NO",
        escapeCsv(row.paymentMethod),
        escapeCsv(row.paymentForm),
        escapeCsv(row.usageCfdi),
        escapeCsv(row.expeditionPlace),
        escapeCsv(row.certificationPac),
      ].join(",")
    })

    const csvContent = [headers.join(","), ...csvRows].join("\n")

    return new Response(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="panel_control_fiscal_cfdi.csv"',
      },
    })
  } catch (error) {
    console.error("Export error:", error)
    return NextResponse.json({ error: "Error al exportar datos" }, { status: 500 })
  }
}

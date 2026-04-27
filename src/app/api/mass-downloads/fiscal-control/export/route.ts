import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
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

    const targetRfc = company.rfc

    const typeMap: Record<string, string> = {
      'INGRESO': 'I',
      'EGRESO': 'E',
      'TRASLADO': 'T',
      'NOMINA': 'N',
      'PAGO': 'P'
    }

    // Extract dynamic column filters
    const columnFilters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      if (key.startsWith("filter_") && value.trim() !== "") {
        columnFilters[key.replace("filter_", "")] = value.trim()
      }
    })

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

    // Apply dynamic column filters to baseSatWhere
    if (Object.keys(columnFilters).length > 0) {
      if (!baseSatWhere.AND) baseSatWhere.AND = []
      
      Object.entries(columnFilters).forEach(([key, value]) => {
        const query = value.toLowerCase()
        const andArray = baseSatWhere.AND as Prisma.SatMetadataWhereInput[]
        
        switch(key) {
          case 'uuid':
            andArray.push({ uuid: { contains: query, mode: 'insensitive' } })
            break
          case 'issuerRfc':
            andArray.push({ rfcEmisor: { contains: query, mode: 'insensitive' } })
            break
          case 'receiverRfc':
            andArray.push({ rfcReceptor: { contains: query, mode: 'insensitive' } })
            break
          case 'receiverName':
            andArray.push({ nombreReceptor: { contains: query, mode: 'insensitive' } })
            break
          case 'issuerName':
            andArray.push({ nombreEmisor: { contains: query, mode: 'insensitive' } })
            break
          case 'certificationPac':
            andArray.push({ rfcPac: { contains: query, mode: 'insensitive' } })
            break
          case 'cfdiType':
            const mapInverse: Record<string, string> = {
              'ingreso': 'I', 'egreso': 'E', 'traslado': 'T', 'nomina': 'N', 'pago': 'P'
            }
            if (mapInverse[query]) {
              andArray.push({ efectoComprobante: mapInverse[query] })
            } else {
              andArray.push({ efectoComprobante: { contains: query, mode: 'insensitive' } })
            }
            break
          case 'total':
            const num = Number(query.replace(/[^0-9.-]+/g, ""))
            if (!isNaN(num)) andArray.push({ monto: { equals: num } })
            break
          case 'issuanceDate':
          case 'certificationDate':
          case 'cancelationDate':
            const dbField = key === 'issuanceDate' ? 'fechaEmision' 
                          : key === 'certificationDate' ? 'fechaCertificacionSat' 
                          : 'fechaCancelacion'
            
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

    const headers = [
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

    // Fetch ALL matching records without pagination
    const satRows = await prisma.satMetadata.findMany({
      where: baseSatWhere,
      orderBy: { fechaEmision: "desc" },
      select: {
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

    const inverseTypeMap: Record<string, string> = {
      'I': 'INGRESO',
      'E': 'EGRESO',
      'T': 'TRASLADO',
      'N': 'NOMINA',
      'P': 'PAGO'
    }

    // Generate CSV content
    const csvRows = satRows.map((row) => {
      const hasXml = existingXmlSet.has(row.uuid)
      return [
        escapeCsv(row.uuid),
        escapeCsv(row.rfcEmisor),
        escapeCsv(row.nombreEmisor),
        escapeCsv(row.rfcReceptor),
        escapeCsv(row.nombreReceptor),
        escapeCsv(formatDate(row.fechaEmision)),
        escapeCsv(formatDate(row.fechaCertificacionSat)),
        escapeCsv(formatDate(row.fechaCancelacion)),
        escapeCsv(row.efectoComprobante ? (inverseTypeMap[row.efectoComprobante] || row.efectoComprobante) : ""),
        escapeCsv(row.monto),
        escapeCsv(row.estatus === "1" ? "VIGENTE" : "CANCELADO"),
        hasXml ? "SI" : "NO",
        escapeCsv(row.rfcPac),
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
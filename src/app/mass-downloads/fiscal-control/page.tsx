"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ProtectedRoute } from "@/components/auth/protected-route"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Eye } from "lucide-react"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from "recharts"

type SelectedCompany = {
  id: string
  rfc: string
  businessName: string
}

type FiscalControlRow = {
  uuid: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  issuanceDate: string
  total: number
  satStatus: string
  hasXml: boolean
  xmlContent: string
  cfdiType: string
  series: string | null
  folio: string | null
  currency: string
  exchangeRate: number | null
  subtotal: number
  discount: number
  ivaTrasladado: number
  ivaRetenido: number
  isrRetenido: number
  iepsRetenido: number
  certificationDate: string
  cancelationDate: string | null
  certificationPac: string
  paymentMethod: string
  paymentForm: string
  usageCfdi: string
  expeditionPlace: string
}

type FiscalControlResponse = {
  kpis: {
    metadataTotal: number
    xmlTotal: number
    completenessPercent: number
  }
  cancelationStats: {
    vigentes: number
    cancelados: number
    totalCanceladoAmount: number
  }
  monthly: Array<{ 
    label: string
    metadataCount: number
    xmlCount: number
    ingreso: number
    egreso: number
    traslado: number
    nomina: number
    pago: number
  }>
  discrepancyAlert: boolean
  discrepancyPercent: number
  table: {
    rows: FiscalControlRow[]
    pagination: {
      page: number
      pageSize: number
      total: number
      totalPages: number
    }
  }
}

const cfdiTypes = [
  { value: "ALL", label: "Todos" },
  { value: "INGRESO", label: "Ingreso" },
  { value: "EGRESO", label: "Egreso" },
  { value: "TRASLADO", label: "Traslado" },
  { value: "NOMINA", label: "Nómina" },
  { value: "PAGO", label: "Pago" },
]

const satStatuses = [
  { value: "ALL", label: "Todos" },
  { value: "VIGENTE", label: "Vigente" },
  { value: "CANCELADO", label: "Cancelado" },
]

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(Number(value || 0))
}

function formatDate(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, "0")
  const minutes = String(d.getMinutes()).padStart(2, "0")
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

function getXmlAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const comprobanteMatch = xml.match(/<[^:]+:Comprobante([^>]+)>/)
  if (comprobanteMatch) {
    const attrs = comprobanteMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = attrs.match(regex)
    if (match) return match[1]
  }
  return ''
}

function getReceptorAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const receptorMatch = xml.match(/<[^:]+:Receptor([^>]+)>/)
  if (receptorMatch) {
    const attrs = receptorMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = attrs.match(regex)
    if (match) return match[1]
  }
  return ''
}

function getGlobalImpuestosAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const regex = new RegExp(`<[^:]+:Impuestos[^>]*?\\b${attr}="([^"]+)"`)
  const match = xml.match(regex)
  if (match) return match[1]
  return ''
}

function getCfdiRelacionadosAttribute(xml: string, type: 'TipoRelacion' | 'UUID'): string {
  if (!xml) return ''
  if (type === 'TipoRelacion') {
    const matches = Array.from(xml.matchAll(/<(?:[^:]+:)?CfdiRelacionados[^>]*?\bTipoRelacion="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  } else {
    const matches = Array.from(xml.matchAll(/<(?:[^:]+:)?CfdiRelacionado[^>]*?\bUUID="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  }
}

export default function MassDownloadsFiscalControlPage() {
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(() => {
    try {
      const stored = localStorage.getItem("selectedCompany")
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() => selectedCompany?.id || null)

  const [rfcFilter, setRfcFilter] = useState("")
  const [year, setYear] = useState<string>("")
  const [month, setMonth] = useState<string>("")
  const [cfdiType, setCfdiType] = useState<string>("ALL")
  const [satStatus, setSatStatus] = useState<string>("ALL")

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FiscalControlResponse | null>(null)
  const [pageSize] = useState(50)

  const columnDefs = useMemo(() => [
    { key: 'uuid', label: 'UUID', group: '<tfd:TimbreFiscalDigital>', render: (r: FiscalControlRow) => <span className="whitespace-nowrap">{r.uuid}</span> },
    { key: 'version', label: 'Versión', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'Version') },
    { key: 'noCertificado', label: 'No. Certificado', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'NoCertificado') },
    { key: 'certificado', label: 'Certificado', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => {
      const val = getXmlAttribute(r.xmlContent, 'Certificado')
      return <div className="max-w-[150px] truncate" title={val}>{val}</div>
    } },
    { key: 'cfdiType', label: 'Tipo', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => r.cfdiType },
    { key: 'series', label: 'Serie', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'Serie') || r.series || '' },
    { key: 'folio', label: 'Folio', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'Folio') || r.folio || '' },
    { key: 'currency', label: 'Moneda', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'Moneda') || r.currency },
    { key: 'exchangeRate', label: 'T. Cambio', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'TipoCambio') || r.exchangeRate || '' },
    { key: 'satStatus', label: 'Estado SAT', group: 'Sistema / Metadatos', render: (r: FiscalControlRow) => (
      <Badge variant={r.satStatus === "VIGENTE" ? "default" : "outline"}>
        {r.satStatus}
      </Badge>
    ) },
    { key: 'hasXml', label: 'Origen', group: 'Sistema / Metadatos', render: (r: FiscalControlRow) => (
      <Badge className={r.hasXml ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}>
        {r.hasXml ? "XML" : "Meta"}
      </Badge>
    ) },
    { key: 'tipoRelacion', label: 'Tipo Relación', group: '<cfdi:CfdiRelacionados>', render: (r: FiscalControlRow) => getCfdiRelacionadosAttribute(r.xmlContent, 'TipoRelacion') },
    { key: 'cfdiRelacionado', label: 'CFDIRelacionado', group: '<cfdi:CfdiRelacionados>', render: (r: FiscalControlRow) => getCfdiRelacionadosAttribute(r.xmlContent, 'UUID') },
    { key: 'issuerRfc', label: 'RFC Emisor', group: '<cfdi:Emisor>', render: (r: FiscalControlRow) => r.issuerRfc },
    { key: 'issuerName', label: 'Nombre Emisor', group: '<cfdi:Emisor>', render: (r: FiscalControlRow) => r.issuerName },
    { key: 'receiverRfc', label: 'RFC Receptor', group: '<cfdi:Receptor>', render: (r: FiscalControlRow) => r.receiverRfc },
    { key: 'receiverName', label: 'Nombre Receptor', group: '<cfdi:Receptor>', render: (r: FiscalControlRow) => r.receiverName },
    { key: 'domicilioFiscalReceptor', label: 'Domicilio Fiscal Receptor', group: '<cfdi:Receptor>', render: (r: FiscalControlRow) => getReceptorAttribute(r.xmlContent, 'DomicilioFiscalReceptor') },
    { key: 'residenciaFiscal', label: 'Residencia Fiscal', group: '<cfdi:Receptor>', render: (r: FiscalControlRow) => getReceptorAttribute(r.xmlContent, 'ResidenciaFiscal') },
    { key: 'numRegIdTrib', label: 'Num Reg Id Trib', group: '<cfdi:Receptor>', render: (r: FiscalControlRow) => getReceptorAttribute(r.xmlContent, 'NumRegIdTrib') },
    { key: 'regimenFiscalReceptor', label: 'Régimen Fiscal Receptor', group: '<cfdi:Receptor>', render: (r: FiscalControlRow) => getReceptorAttribute(r.xmlContent, 'RegimenFiscalReceptor') },
    { key: 'subtotal', label: 'Subtotal', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => {
      const xmlVal = getXmlAttribute(r.xmlContent, 'SubTotal')
      return formatCurrency(xmlVal ? Number(xmlVal) : r.subtotal)
    } },
    { key: 'discount', label: 'Descuento', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => {
      const xmlVal = getXmlAttribute(r.xmlContent, 'Descuento')
      return formatCurrency(xmlVal ? Number(xmlVal) : r.discount)
    } },
    { key: 'total', label: 'Total', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => {
      const xmlVal = getXmlAttribute(r.xmlContent, 'Total')
      return formatCurrency(xmlVal ? Number(xmlVal) : r.total)
    } },
    { key: 'totalImpuestosTrasladados', label: 'Total Impuestos Trasladados', group: '<cfdi:Impuestos>', render: (r: FiscalControlRow) => {
      const val = getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosTrasladados')
      return val ? formatCurrency(Number(val)) : ''
    } },
    { key: 'totalImpuestosRetenidos', label: 'Total Impuestos Retenidos', group: '<cfdi:Impuestos>', render: (r: FiscalControlRow) => {
      const val = getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosRetenidos')
      return val ? formatCurrency(Number(val)) : ''
    } },
    { key: 'issuanceDate', label: 'Fecha Emisión', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => <span className="text-xs text-muted-foreground whitespace-nowrap">{r.issuanceDate ? formatDate(r.issuanceDate) : '-'}</span> },
    { key: 'certificationDate', label: 'Fecha Certificación', group: '<tfd:TimbreFiscalDigital>', render: (r: FiscalControlRow) => <span className="text-xs text-muted-foreground whitespace-nowrap">{r.certificationDate ? formatDate(r.certificationDate) : '-'}</span> },
    { key: 'cancelationDate', label: 'Fecha Cancelación', group: 'Sistema / Metadatos', render: (r: FiscalControlRow) => <span className="text-xs text-muted-foreground whitespace-nowrap">{r.cancelationDate ? formatDate(r.cancelationDate) : '-'}</span> },
    { key: 'certificationPac', label: 'PAC', group: '<tfd:TimbreFiscalDigital>', render: (r: FiscalControlRow) => <span className="font-mono text-xs whitespace-nowrap">{r.certificationPac}</span> },
    { key: 'paymentMethod', label: 'Método Pago', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'MetodoPago') || r.paymentMethod || '' },
    { key: 'paymentForm', label: 'Forma Pago', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'FormaPago') || r.paymentForm || '' },
    { key: 'usageCfdi', label: 'Uso CFDI', group: '<cfdi:Receptor>', render: (r: FiscalControlRow) => getReceptorAttribute(r.xmlContent, 'UsoCFDI') || r.usageCfdi || '' },
    { key: 'expeditionPlace', label: 'Lugar Exp.', group: '<cfdi:Comprobante>', render: (r: FiscalControlRow) => getXmlAttribute(r.xmlContent, 'LugarExpedicion') || r.expeditionPlace || '' },
  ], [])

  const groupedColumns = useMemo(() => {
    const groups: Record<string, typeof columnDefs[number][]> = {}
    groups['<cfdi:Conceptos>'] = [] // Para mantener el orden visual
    columnDefs.forEach(c => {
      const g = c.group || 'Otros'
      if (!groups[g]) groups[g] = []
      groups[g].push(c)
    })
    return groups
  }, [columnDefs])

  // Default visible columns
  const basicColumnsKeys = ['uuid', 'issuerRfc', 'receiverRfc', 'receiverName', 'issuanceDate', 'total', 'satStatus', 'hasXml', 'certificationPac', 'certificationDate', 'cfdiType', 'cancelationDate']
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(basicColumnsKeys))
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const known = columnDefs.map(c => c.key)
    const missing = known.filter(k => !basicColumnsKeys.includes(k))
    return [...basicColumnsKeys, ...missing]
  })
  
  const [showColumnPanel, setShowColumnPanel] = useState(false)
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [debouncedFilters, setDebouncedFilters] = useState<Record<string, string>>({})

  const persistVisibleColumns = useCallback(async (cols: string[]) => {
    try {
      await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            tables: {
              fiscalControl: { visibleColumns: cols }
            }
          }
        })
      })
    } catch {}
  }, [])

  const persistColumnOrder = useCallback(async (order: string[]) => {
    try {
      await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            tables: {
              fiscalControl: { columnOrder: order }
            }
          }
        })
      })
    } catch {}
  }, [])

  useEffect(() => {
    const loadPrefs = async () => {
      try {
        const res = await fetch('/api/user/profile')
        const data = await res.json()
        const cols = data?.user?.preferences?.tables?.fiscalControl?.visibleColumns
        const order = data?.user?.preferences?.tables?.fiscalControl?.columnOrder
        if (Array.isArray(cols) && cols.length > 0) {
          setVisibleCols(new Set(cols))
        }
        if (Array.isArray(order) && order.length > 0) {
          const known = columnDefs.map(c => c.key)
          const cleanOrder = order.filter(k => known.includes(k))
          const missing = known.filter(k => !cleanOrder.includes(k))
          setColumnOrder([...cleanOrder, ...missing])
        }
      } catch {}
    }
    loadPrefs()
  }, [columnDefs])

  // Debounce the column filters to avoid spamming the API
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(columnFilters)
    }, 500)
    return () => clearTimeout(timer)
  }, [columnFilters])

  useEffect(() => {
    const handler = () => {
      try {
        const stored = localStorage.getItem("selectedCompany")
        if (stored) {
          const parsed = JSON.parse(stored)
          setSelectedCompany(parsed)
          setSelectedCompanyId(parsed.id)
        }
      } catch {}
    }
    window.addEventListener("company-selected", handler)
    document.addEventListener("company-selected", handler)
    return () => {
      window.removeEventListener("company-selected", handler)
      document.removeEventListener("company-selected", handler)
    }
  }, [])

  const yearsOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, i) => String(currentYear - i))
  }, [])

  const uniqueRfcs = useMemo(() => {
    const set = new Set<string>()
    if (data?.table?.rows) {
      data.table.rows.forEach((row) => {
        if (row.issuerRfc) set.add(row.issuerRfc)
        if (row.receiverRfc) set.add(row.receiverRfc)
      })
    }
    return Array.from(set)
  }, [data])

  const rfcSuggestions = useMemo(() => {
    const q = rfcFilter.trim().toUpperCase()
    if (!q) return []
    return uniqueRfcs.filter((r) => r.toUpperCase().startsWith(q)).slice(0, 10)
  }, [rfcFilter, uniqueRfcs])

  const fetchData = useCallback(
    async (targetPage: number) => {
      if (!selectedCompanyId) return
      setLoading(true)
      const params = new URLSearchParams({
        companyId: selectedCompanyId,
        page: String(targetPage),
        pageSize: String(pageSize),
      })
      if (rfcFilter.trim()) params.set("rfc", rfcFilter.trim())
      if (year) params.set("year", year)
      if (month) params.set("month", month)
      if (cfdiType && cfdiType !== "ALL") params.set("cfdiType", cfdiType)
      if (satStatus && satStatus !== "ALL") params.set("satStatus", satStatus)

      // Add column filters
      Object.entries(debouncedFilters).forEach(([key, value]) => {
        if (value.trim()) {
          params.set(`filter_${key}`, value.trim())
        }
      })

      try {
        const res = await fetch(`/api/mass-downloads/fiscal-control?${params.toString()}`, { cache: "no-store" })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Error al cargar datos")
        setData(json)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [selectedCompanyId, pageSize, rfcFilter, year, month, cfdiType, satStatus, debouncedFilters]
  )

  useEffect(() => {
    if (selectedCompanyId) {
      fetchData(1)
    }
  }, [selectedCompanyId, fetchData])

  const handleApplyFilters = () => {
    fetchData(1)
  }

  const handleExport = () => {
    if (!selectedCompanyId) return

    const params = new URLSearchParams({
      companyId: selectedCompanyId,
    })

    if (rfcFilter.trim()) params.set("rfc", rfcFilter.trim())
    if (year) params.set("year", year)
    if (month) params.set("month", month)
    if (cfdiType && cfdiType !== "ALL") params.set("cfdiType", cfdiType)
    if (satStatus && satStatus !== "ALL") params.set("satStatus", satStatus)

    // Add column filters
    Object.entries(debouncedFilters).forEach(([key, value]) => {
      if (value.trim()) {
        params.set(`filter_${key}`, value.trim())
      }
    })

    const url = `/api/mass-downloads/fiscal-control/export?${params.toString()}`
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", "panel_control_fiscal_cfdi.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (!selectedCompanyId) {
    return (
      <ProtectedRoute>
        <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
          <Card>
            <CardHeader>
              <CardTitle>Selecciona una empresa</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Usa el combobox del sidebar para elegir la empresa y cargar el Panel de Control Fiscal CFDI.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedRoute>
    )
  }

  const completenessLabel = data?.kpis
    ? `${data.kpis.completenessPercent.toFixed(2)}% de los XML descargados`
    : "Sin datos"

  const filteredRows = data?.table?.rows || []

  const totalPages = data?.table?.pagination?.totalPages || 0
  
  const page = data?.table?.pagination?.page || 1
  const pageSizeLocal = data?.table?.pagination?.pageSize || 50
  const totalRecords = data?.table?.pagination?.total || 0
  
  const startRecord = totalRecords === 0 ? 0 : (page - 1) * pageSizeLocal + 1
  const endRecord = Math.min(page * pageSizeLocal, totalRecords)
  
  const recordCounter = `Mostrando ${startRecord} al ${endRecord} de ${totalRecords} registros`

  const pieData = [
    { name: 'Vigentes', value: data?.cancelationStats?.vigentes || 0 },
    { name: 'Cancelados', value: data?.cancelationStats?.cancelados || 0 },
  ]

  const COLORS = ['#48bb78', '#f56565'] // Green for Vigente, Red for Cancelled

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-6 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Panel de Control Fiscal CFDI</h1>
            {selectedCompany && (
              <p className="text-sm text-muted-foreground">
                {selectedCompany.rfc} • {selectedCompany.businessName}
              </p>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sistema de filtros avanzados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-5">
              <div className="space-y-2">
                <Label>RFC</Label>
                <div className="relative">
                  <Input
                    placeholder="RFC emisor o receptor"
                    value={rfcFilter}
                    onChange={(e) => setRfcFilter(e.target.value)}
                  />
                  {rfcSuggestions.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-56 overflow-auto text-sm">
                      {rfcSuggestions.map((rfc) => (
                        <button
                          key={rfc}
                          type="button"
                          className="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground"
                          onClick={() => setRfcFilter(rfc)}
                        >
                          {rfc}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="space-y-2 w-full">
                  <Label>Año</Label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger>
                      <SelectValue placeholder="Año" />
                    </SelectTrigger>
                    <SelectContent>
                      {yearsOptions.map((y) => (
                        <SelectItem key={y} value={y}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 w-full">
                  <Label>Mes</Label>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger>
                      <SelectValue placeholder="Mes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="01">Enero</SelectItem>
                      <SelectItem value="02">Febrero</SelectItem>
                      <SelectItem value="03">Marzo</SelectItem>
                      <SelectItem value="04">Abril</SelectItem>
                      <SelectItem value="05">Mayo</SelectItem>
                      <SelectItem value="06">Junio</SelectItem>
                      <SelectItem value="07">Julio</SelectItem>
                      <SelectItem value="08">Agosto</SelectItem>
                      <SelectItem value="09">Septiembre</SelectItem>
                      <SelectItem value="10">Octubre</SelectItem>
                      <SelectItem value="11">Noviembre</SelectItem>
                      <SelectItem value="12">Diciembre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Comprobante</Label>
                <Select value={cfdiType} onValueChange={setCfdiType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Efecto del comprobante" />
                  </SelectTrigger>
                  <SelectContent>
                    {cfdiTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Estado SAT</Label>
                <Select value={satStatus} onValueChange={setSatStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Estado SAT" />
                  </SelectTrigger>
                  <SelectContent>
                    {satStatuses.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 justify-end md:col-span-4 lg:col-span-2">
                <Button onClick={handleApplyFilters} disabled={loading}>
                  {loading ? "Aplicando..." : "Aplicar filtros"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-4">
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Registros en Metadatos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {data?.kpis?.metadataTotal?.toLocaleString("es-MX") || "0"}
              </p>
            </CardContent>
          </Card>
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>XML descargados</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {data?.kpis?.xmlTotal?.toLocaleString("es-MX") || "0"}
              </p>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Indicador de brecha</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-2xl font-bold">
                {data?.kpis ? `${data.kpis.completenessPercent.toFixed(2)}%` : "0.00%"}
              </p>
              <p className="text-sm text-muted-foreground">{completenessLabel}</p>
              {data?.discrepancyAlert && (
                <Badge variant="destructive">
                  Alerta de discrepancia: {data.discrepancyPercent.toFixed(2)}% de diferencia
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Monitor de Estatus de Cancelación</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row items-center justify-around h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      fill="#8884d8"
                      paddingAngle={5}
                      dataKey="value"
                      label
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col items-center justify-center space-y-2 p-4 border rounded-lg shadow-sm bg-muted/50">
                  <span className="text-sm font-medium text-muted-foreground">Monto Cancelado</span>
                  <span className="text-2xl font-bold text-red-600">
                    {formatCurrency(data?.cancelationStats?.totalCanceladoAmount || 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {data?.cancelationStats?.cancelados?.toLocaleString() || "0"} facturas canceladas
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Distribución por Efecto (Flujo Operativo)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data?.monthly || []}
                    margin={{
                      top: 20,
                      right: 30,
                      left: 20,
                      bottom: 5,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Legend />
                    <Bar dataKey="ingreso" name="Ingresos" stackId="a" fill="#2b6cb0" />
                    <Bar dataKey="egreso" name="Egresos" stackId="a" fill="#e53e3e" />
                    <Bar dataKey="traslado" name="Traslados" stackId="a" fill="#dd6b20" />
                    <Bar dataKey="nomina" name="Nómina" stackId="a" fill="#3182ce" />
                    <Bar dataKey="pago" name="Pagos" stackId="a" fill="#38a169" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className={data?.discrepancyAlert ? "border-red-500" : ""}>
          <CardHeader>
            <CardTitle>Conciliación Metadatos vs XML por mes</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto scrollbar-visible">
            <div className="min-w-[800px]">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data?.monthly || []} margin={{ left: 40, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="metadataCount" name="Metadatos" fill="#2b6cb0" />
                  <Bar dataKey="xmlCount" name="XML descargados" fill="#68d391" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle>Detalle de registros</CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground mr-4">
                {recordCounter}
              </div>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || !data?.table?.rows?.length}>
                Exportar reporte
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowColumnPanel(v => !v)}>
                <Eye className="h-4 w-4 mr-2" />
                Columnas
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {showColumnPanel && (
              <div className="m-4 border rounded-md p-3 bg-muted/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Columnas visibles</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const all = new Set(columnDefs.map(c => c.key))
                        setVisibleCols(all)
                        persistVisibleColumns(Array.from(all))
                      }}
                    >
                      Mostrar todo
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const basic = new Set(basicColumnsKeys)
                        setVisibleCols(basic)
                        persistVisibleColumns(Array.from(basic))
                        
                        const known = columnDefs.map(c => c.key)
                        const missing = known.filter(k => !basicColumnsKeys.includes(k))
                        const newOrder = [...basicColumnsKeys, ...missing]
                        setColumnOrder(newOrder)
                        persistColumnOrder(newOrder)
                      }}
                    >
                      Vista básica
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const def = columnDefs.map(c => c.key)
                        setColumnOrder(def)
                        persistColumnOrder(def)
                      }}
                    >
                      Orden por defecto
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  {Object.entries(groupedColumns)
                    .sort(([a], [b]) => {
                      const order = ['<cfdi:Comprobante>', '<cfdi:CfdiRelacionados>', '<cfdi:Emisor>', '<cfdi:Receptor>', '<cfdi:Conceptos>', '<cfdi:Impuestos>', '<tfd:TimbreFiscalDigital>', 'Sistema / Metadatos']
                      const posA = order.indexOf(a)
                      const posB = order.indexOf(b)
                      return (posA === -1 ? 999 : posA) - (posB === -1 ? 999 : posB)
                    })
                    .map(([groupName, cols]) => {
                      if (groupName === '<cfdi:Conceptos>') {
                        return null; // Handle if necessary later
                      }
                      if (cols.length === 0) return null
                      return (
                        <div key={groupName} className="space-y-2">
                          <h4 className="text-xs font-semibold text-primary tracking-wider border-b pb-1 flex items-center gap-2">
                            {groupName}
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {cols.map(col => {
                              const checked = visibleCols.has(col.key)
                              return (
                                <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted p-1 rounded">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = new Set(visibleCols)
                                      if (e.target.checked) next.add(col.key)
                                      else next.delete(col.key)
                                      setVisibleCols(next)
                                      persistVisibleColumns(Array.from(next))
                                    }}
                                    className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                                  />
                                  {col.label}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
            <div className="border rounded-md mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columnOrder.map((key) => {
                      const col = columnDefs.find(c => c.key === key)
                      if (!col || !visibleCols.has(col.key)) return null
                      return (
                        <TableHead key={col.key} className="whitespace-nowrap">
                          <div className="mb-2 font-semibold">{col.label}</div>
                          <Input
                            placeholder="Buscar..."
                            className="h-7 text-xs font-normal"
                            value={columnFilters[col.key] || ''}
                            onChange={(e) => setColumnFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                          />
                        </TableHead>
                      )
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length ? (
                    filteredRows.map((row) => (
                      <TableRow key={row.uuid}>
                        {columnOrder.map((key) => {
                          const col = columnDefs.find(c => c.key === key)
                          if (!col || !visibleCols.has(col.key)) return null
                          
                          // Align right for numbers
                          const isNumber = ['total', 'subtotal', 'discount', 'ivaTrasladado', 'ivaRetenido', 'isrRetenido', 'iepsRetenido', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos'].includes(col.key)
                          
                          return (
                            <TableCell key={col.key} className={`text-sm ${isNumber ? 'text-right' : ''}`}>
                              {col.render(row)}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={visibleCols.size || 1} className="text-center py-6 text-sm text-muted-foreground">
                        {loading ? "Cargando registros..." : "No hay registros para los filtros seleccionados."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                {filteredRows.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      {columnOrder.map((key) => {
                        const col = columnDefs.find(c => c.key === key)
                        if (!col || !visibleCols.has(col.key)) return null
                        
                        const isNumber = ['total', 'subtotal', 'discount', 'ivaTrasladado', 'ivaRetenido', 'isrRetenido', 'iepsRetenido', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos'].includes(col.key)
                        
                        if (isNumber) {
                          let sum = 0;
                          if (col.key === 'subtotal' || col.key === 'discount' || col.key === 'total') {
                            sum = filteredRows.reduce((acc, row) => {
                              const xmlVal = getXmlAttribute(row.xmlContent, col.key === 'subtotal' ? 'SubTotal' : col.key === 'discount' ? 'Descuento' : 'Total')
                              const val = xmlVal ? Number(xmlVal) : (row[col.key as keyof FiscalControlRow] as number || 0)
                              return acc + val
                            }, 0)
                          } else if (col.key === 'totalImpuestosTrasladados' || col.key === 'totalImpuestosRetenidos') {
                            sum = filteredRows.reduce((acc, row) => {
                              const xmlVal = getGlobalImpuestosAttribute(row.xmlContent, col.key === 'totalImpuestosTrasladados' ? 'TotalImpuestosTrasladados' : 'TotalImpuestosRetenidos')
                              return acc + (xmlVal ? Number(xmlVal) : 0)
                            }, 0)
                          } else {
                            sum = filteredRows.reduce((acc, row) => acc + (Number(row[col.key as keyof FiscalControlRow]) || 0), 0)
                          }
                          
                          return (
                            <TableCell key={col.key} className="text-sm font-bold text-right">
                              {formatCurrency(sum)}
                            </TableCell>
                          )
                        }
                        
                        const firstVisibleKey = columnOrder.find(k => visibleCols.has(k))
                        if (col.key === firstVisibleKey) {
                          return (
                            <TableCell key={col.key} className="text-sm font-bold">
                              Totales:
                            </TableCell>
                          )
                        }
                        
                        return <TableCell key={col.key} />
                      })}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                <div>
                  {recordCounter} • Página {page} de {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page <= 1}
                    onClick={() => fetchData(page - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page >= totalPages}
                    onClick={() => fetchData(page + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

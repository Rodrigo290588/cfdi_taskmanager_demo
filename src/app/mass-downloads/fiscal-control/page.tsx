"use client"
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Eye, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"

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
  origins: Array<"EMITIDO" | "RECIBIDO" | "NOMINA">
  reconciliationStatus: string
  xmlStorage: string
  payrollPaymentDate: string | null
}

const SERVER_FILTERABLE_DETAIL_COLUMN_KEYS = new Set([
  'uuid',
  'issuerRfc',
  'issuerName',
  'receiverRfc',
  'receiverName',
  'cfdiType',
  'total',
  'issuanceDate',
  'certificationDate',
  'cancelationDate',
  'certificationPac',
  'origins',
  'reconciliationStatus',
  'satStatus',
  'hasXml',
])

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
  statusComparison: {
    vigentes: { metadata: number; xml: number; difference: number }
    cancelados: { metadata: number; xml: number; difference: number }
  }
  metadataTypeBreakdown: {
    ingreso: { emitidos: number; recibidos: number }
    egreso: { emitidos: number; recibidos: number }
    nomina: { emitidos: number; recibidos: number }
    pago: { emitidos: number; recibidos: number }
    traslado: { emitidos: number; recibidos: number }
  }
  xmlTypeBreakdown: {
    ingreso: { emitidos: number; recibidos: number }
    egreso: { emitidos: number; recibidos: number }
    nomina: { emitidos: number; recibidos: number }
    pago: { emitidos: number; recibidos: number }
    traslado: { emitidos: number; recibidos: number }
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
  monthlyTypeDistribution: Array<{
    month: string
    metadata: {
      ingresos: number
      egresos: number
      nomina: number
      pagos: number
      traslados: number
    }
    xml: {
      ingresos: number
      egresos: number
      nomina: number
      pagos: number
      traslados: number
    }
  }>
  discrepancyAlert: boolean
  discrepancyPercent: number
  sourceCounts: { metadata: number; emitidos: number; recibidos: number; nomina: number }
  reconciliationSummary: {
    totalRows: number
    reconciled: number
    metadataWithoutXml: number
    xmlWithoutMetadata: number
    xmlUnavailable: number
    conflicts: number
  }
  table: {
    rows: FiscalControlRow[]
    pagination: {
      page: number
      pageSize: number
      total: number
      totalPages: number
      nextCursor: string | null
      mode: "CURSOR"
      reconciliationScope: "RANGE"
    }
  }
}

type StatusDifference = "VIGENTE" | "CANCELADO"
type MonthlyDistributionSource = "METADATA" | "XML"

type FiscalControlStatusDifferenceRow = {
  uuid: string
  issuanceDate: string | null
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  cfdiType: string
  total: string | null
  metadataStatus: StatusDifference | null
  xmlStatus: StatusDifference | null
  origins: Array<"EMITIDO" | "RECIBIDO" | "NOMINA">
}

type BadgeVariant = ComponentProps<typeof Badge>["variant"]
type MetadataTypeDirectionCounts = FiscalControlResponse['metadataTypeBreakdown']['ingreso']
type MetadataTypeLabel = 'Ingreso' | 'Egreso' | 'Nómina' | 'Pago' | 'Traslado'

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

const XML_AMOUNT_ATTRIBUTES = {
  subtotal: 'SubTotal',
  discount: 'Descuento',
  total: 'Total',
} as const
const METADATA_TYPE_VISUALS: Record<
  MetadataTypeLabel,
  { containerClass: string; titleClass: string }
> = {
  Ingreso: {
    containerClass: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-950 dark:bg-emerald-950/25',
    titleClass: 'text-emerald-700 dark:text-emerald-300',
  },
  Egreso: {
    containerClass: 'border-rose-200 bg-rose-50/70 dark:border-rose-950 dark:bg-rose-950/25',
    titleClass: 'text-rose-700 dark:text-rose-300',
  },
  Nómina: {
    containerClass: 'border-violet-200 bg-violet-50/70 dark:border-violet-950 dark:bg-violet-950/25',
    titleClass: 'text-violet-700 dark:text-violet-300',
  },
  Pago: {
    containerClass: 'border-sky-200 bg-sky-50/70 dark:border-sky-950 dark:bg-sky-950/25',
    titleClass: 'text-sky-700 dark:text-sky-300',
  },
  Traslado: {
    containerClass: 'border-amber-200 bg-amber-50/70 dark:border-amber-950 dark:bg-amber-950/25',
    titleClass: 'text-amber-700 dark:text-amber-300',
  },
}

function MetadataTypeDirection({
  label,
  counts,
}: Readonly<{
  label: MetadataTypeLabel
  counts: MetadataTypeDirectionCounts | undefined
}>) {
  const visual = METADATA_TYPE_VISUALS[label]

  return (
    <div className={`rounded-lg border px-3 py-2 ${visual.containerClass}`}>
      <p className={`text-center text-sm font-semibold ${visual.titleClass}`}>{label}</p>
      <div className="mt-2 grid grid-cols-2 divide-x divide-foreground/10 text-center">
        <div>
          <span className="block text-[11px] text-muted-foreground">Emitidos</span>
          <strong className="text-lg">{counts?.emitidos ?? 0}</strong>
        </div>
        <div>
          <span className="block text-[11px] text-muted-foreground">Recibidos</span>
          <strong className="text-lg">{counts?.recibidos ?? 0}</strong>
        </div>
      </div>
    </div>
  )
}

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

const XML_NAMESPACE_PREFIX = '[A-Za-z_][A-Za-z0-9_.-]*'
const COMPROBANTE_TAG_REGEX = new RegExp(
  String.raw`<${XML_NAMESPACE_PREFIX}:Comprobante\b([^>]*)>`,
)
const RECEPTOR_TAG_REGEX = new RegExp(
  String.raw`<${XML_NAMESPACE_PREFIX}:Receptor\b([^>]*)>`,
)

function getXmlAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const comprobanteMatch = COMPROBANTE_TAG_REGEX.exec(xml)
  if (comprobanteMatch) {
    const attrs = comprobanteMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = regex.exec(attrs)
    if (match) return match[1]
  }
  return ''
}

function getReceptorAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const receptorMatch = RECEPTOR_TAG_REGEX.exec(xml)
  if (receptorMatch) {
    const attrs = receptorMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = regex.exec(attrs)
    if (match) return match[1]
  }
  return ''
}

function getGlobalImpuestosAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const regex = new RegExp(
    String.raw`<${XML_NAMESPACE_PREFIX}:Impuestos\b[^>]*\b${attr}="([^"]+)"`,
  )
  const match = regex.exec(xml)
  if (match) return match[1]
  return ''
}

function getCfdiRelacionadosAttribute(xml: string, type: 'TipoRelacion' | 'UUID'): string {
  if (!xml) return ''
  if (type === 'TipoRelacion') {
    const matches = Array.from(xml.matchAll(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?CfdiRelacionados\b[^>]*\bTipoRelacion="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  } else {
    const matches = Array.from(xml.matchAll(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?CfdiRelacionado\b[^>]*\bUUID="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  }
}

function getOriginLabel(origin: FiscalControlRow['origins'][number]): string {
  switch (origin) {
    case 'NOMINA':
      return 'Nómina'
    case 'EMITIDO':
      return 'Emitido'
    default:
      return 'Recibido'
  }
}

function getDetailColumnSearchValue(row: FiscalControlRow, columnKey: string): string {
  const comprobanteAttributes: Record<string, string> = {
    version: 'Version',
    noCertificado: 'NoCertificado',
    certificado: 'Certificado',
    series: 'Serie',
    folio: 'Folio',
    currency: 'Moneda',
    exchangeRate: 'TipoCambio',
    paymentMethod: 'MetodoPago',
    paymentForm: 'FormaPago',
    expeditionPlace: 'LugarExpedicion',
  }
  const receptorAttributes: Record<string, string> = {
    domicilioFiscalReceptor: 'DomicilioFiscalReceptor',
    residenciaFiscal: 'ResidenciaFiscal',
    numRegIdTrib: 'NumRegIdTrib',
    regimenFiscalReceptor: 'RegimenFiscalReceptor',
    usageCfdi: 'UsoCFDI',
  }
  const taxAttributes: Record<string, string> = {
    totalImpuestosTrasladados: 'TotalImpuestosTrasladados',
    totalImpuestosRetenidos: 'TotalImpuestosRetenidos',
  }
  const comprobanteAttribute = comprobanteAttributes[columnKey]
  if (comprobanteAttribute) {
    return getXmlAttribute(row.xmlContent, comprobanteAttribute)
  }
  const receptorAttribute = receptorAttributes[columnKey]
  if (receptorAttribute) {
    return getReceptorAttribute(row.xmlContent, receptorAttribute)
  }
  const taxAttribute = taxAttributes[columnKey]
  if (taxAttribute) {
    return getGlobalImpuestosAttribute(row.xmlContent, taxAttribute)
  }

  const values: Record<string, string> = {
    uuid: row.uuid,
    cfdiType: row.cfdiType,
    satStatus: row.satStatus,
    origins: row.origins.map(getOriginLabel).join(' '),
    reconciliationStatus: getReconciliationLabel(row.reconciliationStatus),
    hasXml: row.hasXml ? 'XML' : 'Meta',
    issuerRfc: row.issuerRfc,
    issuerName: row.issuerName,
    receiverRfc: row.receiverRfc,
    receiverName: row.receiverName,
    subtotal: `${row.subtotal} ${formatCurrency(row.subtotal)}`,
    discount: `${row.discount} ${formatCurrency(row.discount)}`,
    total: `${row.total} ${formatCurrency(row.total)}`,
    issuanceDate: `${row.issuanceDate} ${formatDate(row.issuanceDate)}`,
    certificationDate: `${row.certificationDate} ${formatDate(row.certificationDate)}`,
    cancelationDate: row.cancelationDate
      ? `${row.cancelationDate} ${formatDate(row.cancelationDate)}`
      : '',
    certificationPac: row.certificationPac,
  }
  return values[columnKey] ?? ''
}

function matchesDetailColumnFilter(value: string, filter: string): boolean {
  return value.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-MX')
    .includes(
      filter.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX'),
    )
}

async function getExportErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error
    }
  } catch {
    // A non-JSON error response should use the safe user-facing fallback below.
  }

  if (response.status === 401) {
    return 'Tu sesión ha vencido. Inicia sesión nuevamente.'
  }
  if (response.status === 403) {
    return 'No tienes permiso para exportar los datos de esta empresa.'
  }
  if (response.status === 404) {
    return 'La empresa seleccionada no está disponible.'
  }
  return 'No se pudo generar el reporte. Intenta nuevamente.'
}

function getReconciliationLabel(status: string): string {
  switch (status) {
    case 'CONCILIADO':
      return 'Conciliado'
    case 'METADATO_SIN_XML':
      return 'Metadato sin XML'
    case 'XML_SIN_METADATO':
      return 'XML sin metadato'
    case 'XML_NO_DISPONIBLE':
      return 'XML no disponible'
    default:
      return 'Conflicto'
  }
}

function getReconciliationBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'CONCILIADO':
      return 'default'
    case 'CONFLICTO':
      return 'destructive'
    default:
      return 'outline'
  }
}

function StatusDrilldownContent({
  isLoading,
  rows,
}: Readonly<{
  isLoading: boolean
  rows: FiscalControlStatusDifferenceRow[]
}>) {
  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        No se encontraron CFDI con diferencia de estatus para esta selección.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-muted">
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>UUID</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Emisor</TableHead>
          <TableHead>Receptor</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Metadatos SAT</TableHead>
          <TableHead>XML</TableHead>
          <TableHead>Origen XML</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.uuid}>
            <TableCell className="whitespace-nowrap">{row.issuanceDate ? formatDate(row.issuanceDate) : "-"}</TableCell>
            <TableCell className="font-mono text-xs">{row.uuid}</TableCell>
            <TableCell>{row.cfdiType || "-"}</TableCell>
            <TableCell><p>{row.issuerRfc || "-"}</p><p className="text-xs text-muted-foreground">{row.issuerName}</p></TableCell>
            <TableCell><p>{row.receiverRfc || "-"}</p><p className="text-xs text-muted-foreground">{row.receiverName}</p></TableCell>
            <TableCell className="text-right">{formatCurrency(Number(row.total ?? 0))}</TableCell>
            <TableCell><Badge variant={row.metadataStatus === "CANCELADO" ? "destructive" : "default"}>{row.metadataStatus ?? "Sin metadato"}</Badge></TableCell>
            <TableCell><Badge variant={row.xmlStatus === "CANCELADO" ? "destructive" : "default"}>{row.xmlStatus ?? "Sin XML"}</Badge></TableCell>
            <TableCell>{row.origins.map(getOriginLabel).join(", ") || "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function MassDownloadsFiscalControlPage() { // NOSONAR S3776: Composición de secciones visuales y estados locales.
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
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")
  const [origin, setOrigin] = useState<string>("ALL")
  const [cfdiType, setCfdiType] = useState<string>("ALL")
  const [satStatus, setSatStatus] = useState<string>("ALL")

  const [loading, setLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [data, setData] = useState<FiscalControlResponse | null>(null)
  const [monthlyDistributionSource, setMonthlyDistributionSource] =
    useState<MonthlyDistributionSource>("METADATA")
  const [statusDrilldown, setStatusDrilldown] = useState<StatusDifference | null>(null)
  const [statusDrilldownRows, setStatusDrilldownRows] = useState<FiscalControlStatusDifferenceRow[]>([])
  const [statusDrilldownLoading, setStatusDrilldownLoading] = useState(false)
  const [pageSize] = useState(50)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null])
  const [cursorIndex, setCursorIndex] = useState(0)
  const hasValidDateRange = Boolean(startDate && endDate && startDate <= endDate)

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
    { key: 'origins', label: 'Origen', group: 'Sistema / Metadatos', render: (r: FiscalControlRow) => (
      <div className="flex flex-wrap gap-1">
        {r.origins.map(origin => <Badge key={origin} variant="outline">{getOriginLabel(origin)}</Badge>)}
      </div>
    ) },
    { key: 'reconciliationStatus', label: 'Conciliación', group: 'Sistema / Metadatos', render: (r: FiscalControlRow) => (
      <Badge variant={getReconciliationBadgeVariant(r.reconciliationStatus)}>
        {getReconciliationLabel(r.reconciliationStatus)}
      </Badge>
    ) },
    { key: 'hasXml', label: 'XML disponible', group: 'Sistema / Metadatos', render: (r: FiscalControlRow) => (
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
  const basicColumnsKeys = ['uuid', 'origins', 'reconciliationStatus', 'issuerRfc', 'receiverRfc', 'receiverName', 'issuanceDate', 'total', 'satStatus', 'hasXml', 'cfdiType']
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
    async (cursor: string | null = null) => {
      if (!selectedCompanyId || !hasValidDateRange) {
        setData(null)
        return
      }
      setLoading(true)
      const params = new URLSearchParams({
        companyId: selectedCompanyId,
        pageSize: String(pageSize),
      })
      if (cursor) params.set("cursor", cursor)
      if (rfcFilter.trim()) params.set("rfc", rfcFilter.trim())
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)
      if (origin !== "ALL") params.set("origin", origin)
      if (cfdiType && cfdiType !== "ALL") params.set("cfdiType", cfdiType)
      if (satStatus && satStatus !== "ALL") params.set("satStatus", satStatus)

      // Add column filters
      Object.entries(debouncedFilters).forEach(([key, value]) => {
        if (SERVER_FILTERABLE_DETAIL_COLUMN_KEYS.has(key) && value.trim()) {
          params.set(`filter_${key}`, value.trim())
        }
      })

      try {
        const [res, summaryRes] = await Promise.all([
          fetch(`/api/mass-downloads/fiscal-control?${params.toString()}`, { cache: "no-store" }),
          fetch(`/api/mass-downloads/fiscal-control/summary?${params.toString()}`, { cache: "no-store" }),
        ])
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Error al cargar datos")
        const summary = summaryRes.ok ? await summaryRes.json() : null
        setData(summary ? { ...json, ...summary, table: json.table } : json)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [selectedCompanyId, hasValidDateRange, pageSize, rfcFilter, startDate, endDate, origin, cfdiType, satStatus, debouncedFilters]
  )

  useEffect(() => {
    if (!selectedCompanyId || !hasValidDateRange) {
      return
    }

    const timeoutId = setTimeout(() => {
      setCursorHistory([null])
      setCursorIndex(0)
      void fetchData(null)
    }, 0)

    return () => clearTimeout(timeoutId)
  }, [selectedCompanyId, hasValidDateRange, fetchData])

  const handleApplyFilters = () => {
    if (!hasValidDateRange) {
      return
    }
    setCursorHistory([null])
    setCursorIndex(0)
    void fetchData(null)
  }

  const handleExport = async () => {
    if (!selectedCompanyId || !hasValidDateRange) return

    const params = new URLSearchParams({
      companyId: selectedCompanyId,
    })

    if (rfcFilter.trim()) params.set("rfc", rfcFilter.trim())
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)
    if (origin !== "ALL") params.set("origin", origin)
    if (cfdiType && cfdiType !== "ALL") params.set("cfdiType", cfdiType)
    if (satStatus && satStatus !== "ALL") params.set("satStatus", satStatus)

    // Add column filters
    Object.entries(debouncedFilters).forEach(([key, value]) => {
      if (SERVER_FILTERABLE_DETAIL_COLUMN_KEYS.has(key) && value.trim()) {
        params.set(`filter_${key}`, value.trim())
      }
    })

    setIsExporting(true)
    try {
      const response = await fetch(
        `/api/mass-downloads/fiscal-control/export?${params.toString()}`,
        { cache: 'no-store' },
      )
      if (response.status === 202) {
        const payload = await response.json() as { message?: unknown }
        const message = typeof payload.message === 'string'
          ? payload.message
          : 'El reporte se está preparando. Podrás descargarlo cuando finalice.'
        toast.info(message)
        return
      }
      if (!response.ok) {
        toast.error(await getExportErrorMessage(response))
        return
      }

      const csv = await response.blob()
      const downloadUrl = URL.createObjectURL(csv)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'panel_control_fiscal_cfdi.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)
      toast.success('El reporte se descargó correctamente.')
    } catch {
      toast.error('No se pudo generar el reporte. Verifica tu conexión e intenta nuevamente.')
    } finally {
      setIsExporting(false)
    }
  }

  const openStatusDrilldown = useCallback(async (status: StatusDifference) => {
    if (!selectedCompanyId || !hasValidDateRange) {
      return
    }

    setStatusDrilldown(status)
    setStatusDrilldownRows([])
    setStatusDrilldownLoading(true)
    const params = new URLSearchParams({
      companyId: selectedCompanyId,
      startDate,
      endDate,
      statusDifference: status,
    })
    if (rfcFilter.trim()) params.set("rfc", rfcFilter.trim())
    if (origin !== "ALL") params.set("origin", origin)
    if (cfdiType !== "ALL") params.set("cfdiType", cfdiType)

    try {
      const response = await fetch(`/api/mass-downloads/fiscal-control?${params.toString()}`, {
        cache: "no-store",
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Error al cargar el detalle de estatus")
      }
      setStatusDrilldownRows(payload.rows ?? [])
    } catch {
      setStatusDrilldownRows([])
    } finally {
      setStatusDrilldownLoading(false)
    }
  }, [selectedCompanyId, hasValidDateRange, startDate, endDate, rfcFilter, origin, cfdiType])

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

  const filteredRows = data?.table?.rows.filter((row) => (
    Object.entries(columnFilters).every(([key, rawFilter]) => {
      const filter = rawFilter.trim()
      return !filter || matchesDetailColumnFilter(getDetailColumnSearchValue(row, key), filter)
    })
  )) ?? []

  const currentRowsCount = data?.table?.rows?.length || 0
  const recordCounter = `Mostrando ${currentRowsCount} registros de la página actual`

  const statusComparisonData = [
    {
      status: 'Vigentes',
      metadatos: data?.statusComparison?.vigentes.metadata ?? 0,
      xml: data?.statusComparison?.vigentes.xml ?? 0,
      diferencia: data?.statusComparison?.vigentes.difference ?? 0,
    },
    {
      status: 'Cancelados',
      metadatos: data?.statusComparison?.cancelados.metadata ?? 0,
      xml: data?.statusComparison?.cancelados.xml ?? 0,
      diferencia: data?.statusComparison?.cancelados.difference ?? 0,
    },
  ]

  const monthlyTypeDistributionData = data?.monthlyTypeDistribution.map((month) => {
    const values = monthlyDistributionSource === "METADATA" ? month.metadata : month.xml
    return {
      label: month.month,
      ingreso: values.ingresos,
      egreso: values.egresos,
      traslado: values.traslados,
      nomina: values.nomina,
      pago: values.pagos,
    }
  }) ?? []

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
              <div className="space-y-2">
                <Label>Fecha inicial *</Label>
                <Input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Fecha final *</Label>
                <Input type="date" required min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
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
              <div className="space-y-2">
                <Label>Origen</Label>
                <Select value={origin} onValueChange={setOrigin}>
                  <SelectTrigger><SelectValue placeholder="Todos los orígenes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos los orígenes</SelectItem>
                    <SelectItem value="EMITIDO">Emitido</SelectItem>
                    <SelectItem value="RECIBIDO">Recibido</SelectItem>
                    <SelectItem value="NOMINA">Nómina</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 justify-end md:col-span-4 lg:col-span-2">
                <Button onClick={handleApplyFilters} disabled={loading || !hasValidDateRange}>
                  {loading ? "Aplicando..." : "Aplicar filtros"}
                </Button>
              </div>
            </div>
            {!hasValidDateRange && (
              <p className="text-sm text-muted-foreground">
                Selecciona una fecha inicial y una fecha final para consultar el control fiscal.
              </p>
            )}
          </CardContent>
        </Card>

        {hasValidDateRange ? (
          <>
        <div className="grid gap-4 md:grid-cols-6 xl:grid-cols-8">
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
          <Card className="md:col-span-5 xl:col-span-7">
            <CardHeader>
              <CardTitle>Metadatos SAT por tipo</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              <MetadataTypeDirection label="Ingreso" counts={data?.metadataTypeBreakdown?.ingreso} />
              <MetadataTypeDirection label="Egreso" counts={data?.metadataTypeBreakdown?.egreso} />
              <MetadataTypeDirection label="Nómina" counts={data?.metadataTypeBreakdown?.nomina} />
              <MetadataTypeDirection label="Pago" counts={data?.metadataTypeBreakdown?.pago} />
              <MetadataTypeDirection label="Traslado" counts={data?.metadataTypeBreakdown?.traslado} />
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
          <Card className="md:col-span-5 xl:col-span-7">
            <CardHeader>
              <CardTitle>CFDI Descargados por tipo</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              <MetadataTypeDirection label="Ingreso" counts={data?.xmlTypeBreakdown?.ingreso} />
              <MetadataTypeDirection label="Egreso" counts={data?.xmlTypeBreakdown?.egreso} />
              <MetadataTypeDirection label="Nómina" counts={data?.xmlTypeBreakdown?.nomina} />
              <MetadataTypeDirection label="Pago" counts={data?.xmlTypeBreakdown?.pago} />
              <MetadataTypeDirection label="Traslado" counts={data?.xmlTypeBreakdown?.traslado} />
            </CardContent>
          </Card>
        </div>

<div className="grid gap-4 md:grid-cols-6 xl:grid-cols-8">
          <Card className="md:col-span-2 xl:col-span-2">
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
          <Card className="md:col-span-4 xl:col-span-6">
            <CardHeader>
              <CardTitle>Resumen de conciliación del rango</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-sm text-muted-foreground">Emitidos</p><p className="text-2xl font-semibold">{data?.sourceCounts?.emitidos ?? 0}</p></div>
              <div><p className="text-sm text-muted-foreground">Recibidos</p><p className="text-2xl font-semibold">{data?.sourceCounts?.recibidos ?? 0}</p></div>
              <div><p className="text-sm text-muted-foreground">Nómina</p><p className="text-2xl font-semibold">{data?.sourceCounts?.nomina ?? 0}</p></div>
              <div><p className="text-sm text-muted-foreground">Pendientes o conflictos</p><p className="text-2xl font-semibold">{(data?.reconciliationSummary?.metadataWithoutXml ?? 0) + (data?.reconciliationSummary?.xmlWithoutMetadata ?? 0) + (data?.reconciliationSummary?.xmlUnavailable ?? 0) + (data?.reconciliationSummary?.conflicts ?? 0)}</p></div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Comparativa de estatus: Metadatos SAT vs XML</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row items-center justify-around h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusComparisonData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(value, name) => [
                        Number(value).toLocaleString('es-MX'),
                        name === 'Metadatos SAT' ? 'Metadatos descargados' : 'XML descargados',
                      ]}
                    />
                    <Legend />
                    <Bar dataKey="metadatos" name="Metadatos SAT" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="xml" name="XML descargados" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex flex-col items-center justify-center space-y-2 p-4 border rounded-lg shadow-sm bg-muted/50">
                  <span className="text-sm font-medium text-muted-foreground">Monto Cancelado</span>
                  <span className="text-2xl font-bold text-red-600">
                    {formatCurrency(data?.cancelationStats?.totalCanceladoAmount || 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {data?.cancelationStats?.cancelados?.toLocaleString() || "0"} facturas canceladas
                  </span>
                  <div className="w-full border-t pt-2 text-center text-xs text-muted-foreground">
                    <p>Brecha vigentes: {statusComparisonData[0].diferencia.toLocaleString('es-MX')}</p>
                    <p>Brecha cancelados: {statusComparisonData[1].diferencia.toLocaleString('es-MX')}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => void openStatusDrilldown("VIGENTE")}
                  disabled={loading}
                >
                  Ver diferencia de vigentes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void openStatusDrilldown("CANCELADO")}
                  disabled={loading}
                >
                  Ver diferencia de cancelados
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>
                Distribución mensual por tipo de CFDI ({monthlyDistributionSource === "METADATA" ? "Metadatos SAT" : "XML descargados"})
              </CardTitle>
              <Select
                value={monthlyDistributionSource}
                onValueChange={(value: MonthlyDistributionSource) => setMonthlyDistributionSource(value)}
              >
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Selecciona la fuente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="METADATA">Metadatos SAT</SelectItem>
                  <SelectItem value="XML">XML descargados</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={monthlyTypeDistributionData}
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
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                      labelFormatter={(label) => `Mes: ${label}`}
                    />
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle>Detalle de registros</CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground mr-4">
                {recordCounter}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={loading || isExporting || !data?.table?.rows?.length}
              >
                {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isExporting ? 'Generando reporte...' : 'Exportar reporte'}
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
                            placeholder={SERVER_FILTERABLE_DETAIL_COLUMN_KEYS.has(col.key) ? "Buscar..." : "Buscar en esta página..."}
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
                              const attribute = XML_AMOUNT_ATTRIBUTES[
                                col.key as keyof typeof XML_AMOUNT_ATTRIBUTES
                              ]
                              const xmlVal = getXmlAttribute(row.xmlContent, attribute)
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
            {(cursorIndex > 0 || data?.table?.pagination?.nextCursor) && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                <div>
                  {recordCounter} • Página {cursorIndex + 1}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || cursorIndex <= 0}
                    onClick={() => {
                      const nextIndex = cursorIndex - 1
                      setCursorIndex(nextIndex)
                      void fetchData(cursorHistory[nextIndex])
                    }}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || !data?.table?.pagination?.nextCursor}
                    onClick={() => {
                      const nextCursor = data?.table?.pagination?.nextCursor
                      if (!nextCursor) return
                      const nextIndex = cursorIndex + 1
                      setCursorHistory(previous => [...previous.slice(0, nextIndex), nextCursor])
                      setCursorIndex(nextIndex)
                      void fetchData(nextCursor)
                    }}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Selecciona un rango de fechas para visualizar los indicadores, gráficas y registros de conciliación.
            </CardContent>
          </Card>
        )}
        <Dialog open={statusDrilldown !== null} onOpenChange={(open) => {
          if (!open) {
            setStatusDrilldown(null)
          }
        }}>
          <DialogContent className="flex h-screen w-screen max-w-[100vw] flex-col rounded-none p-6 sm:max-w-[100vw]">
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle>
                CFDI con diferencia de estatus: {statusDrilldown === "VIGENTE" ? "Vigentes" : "Cancelados"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Cada fila compara el estatus del mismo UUID en metadatos SAT y en el XML descargado.
              </p>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={statusDrilldown === "VIGENTE" ? "default" : "outline"}
                onClick={() => void openStatusDrilldown("VIGENTE")}
                disabled={statusDrilldownLoading}
              >
                Vigentes
              </Button>
              <Button
                variant={statusDrilldown === "CANCELADO" ? "default" : "outline"}
                onClick={() => void openStatusDrilldown("CANCELADO")}
                disabled={statusDrilldownLoading}
              >
                Cancelados
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <StatusDrilldownContent
                isLoading={statusDrilldownLoading}
                rows={statusDrilldownRows}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  )
}

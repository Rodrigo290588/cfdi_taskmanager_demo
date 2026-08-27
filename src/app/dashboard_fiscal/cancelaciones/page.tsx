'use client'

import { useEffect, useState, useCallback, useMemo, useRef, type ChangeEvent, type ReactNode } from 'react'
import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileCode,
  FileText,
  FileUp,
  ShieldCheck,
  Upload,
  XCircle
} from 'lucide-react'
import { toast } from 'sonner'


type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

const formatMXN = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))

const formatUtcDate = (value: string | Date | null | undefined) => {
  if (!value) {
    return ''
  }

  try {
    return new Date(value).toLocaleDateString('es-MX', { timeZone: 'UTC' })
  } catch {
    return String(value)
  }
}

type InvoiceRow = {
  id: string
  userId: string
  issuerFiscalEntityId: string
  uuid: string
  cfdiType: string
  series: string | null
  folio: string | null
  currency: string
  exchangeRate: number | null
  status: string
  satStatus: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  subtotal: number
  discount: number
  total: number
  ivaTransferred: number
  ivaWithheld: number
  isrWithheld: number
  iepsWithheld: number
  xmlContent: string
  pdfUrl: string | null
  issuanceDate: string | Date
  certificationDate: string | Date | null
  certificationPac: string
  paymentMethod: string
  paymentForm: string
  cfdiUsage: string
  placeOfExpedition: string
  exportKey: string
  objectTaxComprobante: string | null
  paymentConditions: string | null
  createdAt: string | Date
  updatedAt: string | Date
}

type LayoutImportRow = {
  lineNumber: number
  uuid: string
  statusCol9: string
  cancelableCol10: string
  processCol11: string
  reason: string
  rawLine: string
}

type LayoutImportUpdatedRow = LayoutImportRow & {
  previousSatStatus: string
  nextSatStatus: string
}

type LayoutImportResult = {
  success: boolean
  fileName: string
  summary: {
    processed: number
    updated: number
    ignored: number
    notFound: number
    invalid: number
    unhandled: number
  }
  updatedRows: LayoutImportUpdatedRow[]
  ignoredRows: LayoutImportRow[]
  notFoundRows: LayoutImportRow[]
  invalidRows: LayoutImportRow[]
  unhandledRows: LayoutImportRow[]
}

type LayoutResultColumn<T> = {
  key: string
  label: string
  className?: string
  render: (row: T) => ReactNode
}

function LayoutResultTable<T extends { lineNumber: number }>(params: {
  rows: T[]
  columns: LayoutResultColumn<T>[]
  emptyMessage: string
}) {
  if (params.rows.length === 0) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        {params.emptyMessage}
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            {params.columns.map(column => (
              <th key={column.key} className={`px-3 py-2 text-left font-medium ${column.className || ''}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {params.rows.map((row, index) => (
            <tr
              key={`${row.lineNumber}-${index}`}
              className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
            >
              {params.columns.map(column => (
                <td key={column.key} className={`px-3 py-2 align-top ${column.className || ''}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CancelacionesPage() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)

  const [invQuery, setInvQuery] = useState('')
  const [invCfdiType, setInvCfdiType] = useState<string>('')
  const [invStatus, setInvStatus] = useState<string>('')
  // Force default to CANCELADO
  const [invSatStatus, setInvSatStatus] = useState<string>('CANCELADO')
  const [invDateFrom, setInvDateFrom] = useState<string>('')
  const [invDateTo, setInvDateTo] = useState<string>('')
  const [invPage, setInvPage] = useState(1)
  const [invLimit, setInvLimit] = useState(50)
  const [invLoading, setInvLoading] = useState(false)
  const [invRows, setInvRows] = useState<InvoiceRow[]>([])
  const [invTotalPages, setInvTotalPages] = useState(0)
  const [invTotal, setInvTotal] = useState(0)
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [layoutFile, setLayoutFile] = useState<File | null>(null)
  const [layoutImportResult, setLayoutImportResult] = useState<LayoutImportResult | null>(null)
  const [uploadingLayout, setUploadingLayout] = useState(false)
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false)

  const columnDefs = useMemo(() => [
    { key: 'issuerRfc', label: 'RFC Emisor', render: (r: InvoiceRow) => r.issuerRfc },
    { key: 'issuerName', label: 'Emisor', render: (r: InvoiceRow) => <div className="whitespace-nowrap max-w-[200px] sm:max-w-[300px] truncate" title={r.issuerName}>{r.issuerName}</div> },
    { key: 'receiverRfc', label: 'RFC Receptor', render: (r: InvoiceRow) => r.receiverRfc },
    { key: 'receiverName', label: 'Receptor', render: (r: InvoiceRow) => <div className="whitespace-nowrap max-w-[200px] sm:max-w-[300px] truncate" title={r.receiverName}>{r.receiverName}</div> },
    { key: 'series', label: 'Serie', render: (r: InvoiceRow) => r.series ?? '' },
    { key: 'folio', label: 'Folio', render: (r: InvoiceRow) => r.folio ?? '' },
    { key: 'cfdiType', label: 'Tipo CFDI', render: (r: InvoiceRow) => r.cfdiType },
    { key: 'issuanceDate', label: 'Fecha', render: (r: InvoiceRow) => formatUtcDate(r.issuanceDate) },
    { key: 'uuid', label: 'UUID', render: (r: InvoiceRow) => <div className="whitespace-nowrap font-mono text-xs">{r.uuid}</div> },
    { key: 'paymentForm', label: 'Forma de Pago', render: (r: InvoiceRow) => r.paymentForm ?? '' },
    { key: 'paymentMethod', label: 'Método Pago', render: (r: InvoiceRow) => r.paymentMethod ?? '' },
    { key: 'currency', label: 'Moneda', render: (r: InvoiceRow) => r.currency ?? '' },
    { key: 'exchangeRate', label: 'Tipo de cambio', render: (r: InvoiceRow) => r.exchangeRate ?? '' },
    { key: 'subtotal', label: 'Subtotal', render: (r: InvoiceRow) => formatMXN(r.subtotal) },
    { key: 'ivaTransferred', label: 'Impuestos Trasladados', render: (r: InvoiceRow) => formatMXN(r.ivaTransferred) },
    { key: 'taxesWithheld', label: 'Impuestos Retenidos', render: (r: InvoiceRow) => formatMXN((r.ivaWithheld || 0) + (r.isrWithheld || 0) + (r.iepsWithheld || 0)) },
    { key: 'discount', label: 'Descuento', render: (r: InvoiceRow) => formatMXN(r.discount) },
    { key: 'total', label: 'Total', render: (r: InvoiceRow) => formatMXN(r.total) },
    { key: 'satStatus', label: 'Estatus SAT', render: (r: InvoiceRow) => r.satStatus },
    { key: 'certificationPac', label: 'PAC', render: (r: InvoiceRow) => r.certificationPac },
  ] as const, [])
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(columnDefs.map(c => c.key)))
  const [columnOrder, setColumnOrder] = useState<string[]>(columnDefs.map(c => c.key))
  const [dragCol, setDragCol] = useState<string | null>(null)
  
  useEffect(() => {
    const loadPrefs = async () => {
      try {
        const res = await fetch('/api/user/profile', { cache: 'no-store' })
        const data = await res.json()
        const cols = data?.user?.preferences?.tables?.cancelaciones?.visibleColumns
        const order = data?.user?.preferences?.tables?.cancelaciones?.columnOrder
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

  const updatedResultColumns = useMemo<LayoutResultColumn<LayoutImportUpdatedRow>[]>(() => [
    { key: 'lineNumber', label: 'Línea', render: row => row.lineNumber },
    { key: 'uuid', label: 'UUID', className: 'font-mono text-xs whitespace-nowrap', render: row => row.uuid },
    { key: 'previousSatStatus', label: 'Antes', render: row => row.previousSatStatus },
    { key: 'nextSatStatus', label: 'Después', render: row => row.nextSatStatus },
    { key: 'reason', label: 'Resultado', render: row => row.reason }
  ], [])

  const genericResultColumns = useMemo<LayoutResultColumn<LayoutImportRow>[]>(() => [
    { key: 'lineNumber', label: 'Línea', render: row => row.lineNumber },
    { key: 'uuid', label: 'UUID', className: 'font-mono text-xs whitespace-nowrap', render: row => row.uuid || '-' },
    { key: 'statusCol9', label: 'Col 9', render: row => row.statusCol9 || '-' },
    { key: 'cancelableCol10', label: 'Col 10', render: row => row.cancelableCol10 || '-' },
    { key: 'processCol11', label: 'Col 11', render: row => row.processCol11 || '-' },
    { key: 'reason', label: 'Motivo', render: row => row.reason }
  ], [])

  const invalidResultColumns = useMemo<LayoutResultColumn<LayoutImportRow>[]>(() => [
    { key: 'lineNumber', label: 'Línea', render: row => row.lineNumber },
    { key: 'reason', label: 'Motivo', render: row => row.reason },
    {
      key: 'rawLine',
      label: 'Registro',
      className: 'font-mono text-xs min-w-[320px]',
      render: row => <span className="break-all">{row.rawLine}</span>
    }
  ], [])

  const unhandledRawText = useMemo(() => {
    if (!layoutImportResult?.unhandledRows?.length) {
      return ''
    }

    return layoutImportResult.unhandledRows.map(row => row.rawLine).join('\n')
  }, [layoutImportResult])

  const hasActiveFilters = useMemo(() => {
    return Boolean(
      invQuery.trim()
      || invCfdiType
      || invStatus
      || invDateFrom
      || invDateTo
      || Object.values(columnFilters).some(value => value.trim())
    )
  }, [columnFilters, invCfdiType, invDateFrom, invDateTo, invQuery, invStatus])

  const exportValue = (r: InvoiceRow, key: string): string | number => {
    if (key === 'taxesWithheld') return (r.ivaWithheld || 0) + (r.isrWithheld || 0) + (r.iepsWithheld || 0)
    const v = r[key as keyof InvoiceRow] as unknown
    const dateKeys: Array<keyof InvoiceRow> = ['issuanceDate', 'certificationDate', 'createdAt', 'updatedAt']
    if (v === null || v === undefined) return ''
    if (dateKeys.includes(key as keyof InvoiceRow)) {
      return formatUtcDate(v as string | Date)
    }
    if (typeof v === 'number') return v
    return String(v)
  }

  const fetchInvoices = useCallback(async () => {
    if (!selectedCompanyId || !hasActiveFilters) {
      setInvRows([])
      setInvTotalPages(0)
      setInvTotal(0)
      setInvLoading(false)
      return
    }

    setInvLoading(true)
    const params = new URLSearchParams({
      companyId: selectedCompanyId,
      page: String(invPage),
      limit: String(invLimit),
    })
    if (invQuery) params.set('query', invQuery)
    if (invCfdiType) params.set('cfdiType', invCfdiType)
    if (invStatus) params.set('status', invStatus)
    // Always include CANCELADO status
    if (invSatStatus) params.set('satStatus', invSatStatus)
    
    if (invDateFrom) params.set('dateFrom', invDateFrom)
    if (invDateTo) params.set('dateTo', invDateTo)
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    const res = await fetch(`/api/dashboard_fiscal/invoices?${params.toString()}`)
    const data = await res.json()
    setInvRows(data?.invoices || [])
    setInvTotalPages(data?.pagination?.totalPages || 0)
    setInvTotal(data?.pagination?.total || 0)
    setInvLoading(false)
  }, [selectedCompanyId, hasActiveFilters, invPage, invLimit, invQuery, invCfdiType, invStatus, invSatStatus, invDateFrom, invDateTo, columnFilters])

  const handleLayoutFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null

    if (nextFile && !nextFile.name.toLowerCase().endsWith('.txt')) {
      toast.error('Solo se permiten archivos .txt')
      event.target.value = ''
      setLayoutFile(null)
      return
    }

    setLayoutFile(nextFile)
  }, [])

  const handleLayoutImport = useCallback(async () => {
    if (!selectedCompanyId) {
      toast.error('Selecciona una empresa antes de importar')
      return
    }

    if (!layoutFile) {
      toast.error('Selecciona un archivo .txt antes de procesar')
      return
    }

    setUploadingLayout(true)

    try {
      const formData = new FormData()
      formData.append('file', layoutFile)
      formData.append('companyId', selectedCompanyId)

      const res = await fetch('/api/dashboard_fiscal/cancelaciones/import-layout', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data?.error || 'No se pudo procesar el layout')
        return
      }

      setLayoutImportResult(data)
      toast.success(`Layout procesado: ${data?.summary?.updated || 0} CFDI actualizados`)
      await fetchInvoices()
    } catch (error) {
      console.error(error)
      toast.error('Ocurrió un error al procesar el layout')
    } finally {
      setUploadingLayout(false)
    }
  }, [fetchInvoices, layoutFile, selectedCompanyId])

  const handleCopyUnhandledRows = useCallback(async () => {
    if (!unhandledRawText) {
      toast.info('No hay registros no contemplados para copiar')
      return
    }

    try {
      await navigator.clipboard.writeText(unhandledRawText)
      toast.success('Registros no contemplados copiados al portapapeles')
    } catch (error) {
      console.error(error)
      toast.error('No fue posible copiar los registros')
    }
  }, [unhandledRawText])

  const layoutImportPanel = (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={handleLayoutFileChange}
        disabled={uploadingLayout}
      />

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Reglas de operación y seguridad</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            El archivo se valida con las mismas capas de seguridad del flujo masivo: límite de 5MB, extensión
            `.txt`, MIME `text/plain`, detección de binarios disfrazados, almacenamiento temporal aislado y
            eliminación segura al terminar.
          </p>
          <p>
            La búsqueda se hace por cualquier UUID existente en la base, aunque la pantalla esté abierta desde
            una empresa específica. Los casos no contemplados se reportan para revisión manual.
          </p>
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingLayout}
        >
          <Upload className="mr-2 h-4 w-4" />
          Seleccionar archivo
        </Button>
        <Button
          onClick={handleLayoutImport}
          disabled={!layoutFile || uploadingLayout}
        >
          <FileUp className="mr-2 h-4 w-4" />
          {uploadingLayout ? 'Procesando layout...' : 'Procesar layout'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setLayoutFile(null)
            setLayoutImportResult(null)
            if (fileInputRef.current) {
              fileInputRef.current.value = ''
            }
          }}
          disabled={uploadingLayout && !layoutFile}
        >
          Limpiar
        </Button>
        {layoutFile && (
          <Badge variant="outline">
            Archivo seleccionado: {layoutFile.name}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">Columna 8: UUID</Badge>
        <Badge variant="secondary">Columna 9: estado SAT</Badge>
        <Badge variant="secondary">Columna 10: cancelabilidad</Badge>
        <Badge variant="secondary">Columna 11: proceso</Badge>
        <Badge variant="outline">Cancelado = actualiza</Badge>
        <Badge variant="outline">Vigente + No Cancelable = ignora</Badge>
        <Badge variant="outline">Vigente + Aceptación + En proceso = ignora</Badge>
      </div>

      {layoutImportResult && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Procesados</p>
                <p className="text-2xl font-semibold">{layoutImportResult.summary.processed}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Actualizados</p>
                <p className="text-2xl font-semibold text-emerald-600">{layoutImportResult.summary.updated}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Ignorados</p>
                <p className="text-2xl font-semibold">{layoutImportResult.summary.ignored}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">No encontrados</p>
                <p className="text-2xl font-semibold">{layoutImportResult.summary.notFound}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Inválidos</p>
                <p className="text-2xl font-semibold text-amber-600">{layoutImportResult.summary.invalid}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">No contemplados</p>
                <p className="text-2xl font-semibold text-orange-600">{layoutImportResult.summary.unhandled}</p>
              </CardContent>
            </Card>
          </div>

          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Resultado de la última importación</AlertTitle>
            <AlertDescription>
              Archivo procesado: <span className="font-medium">{layoutImportResult.fileName}</span>
            </AlertDescription>
          </Alert>

          <Tabs defaultValue="updated" className="w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
              <TabsTrigger value="updated">Actualizados ({layoutImportResult.updatedRows.length})</TabsTrigger>
              <TabsTrigger value="ignored">Ignorados ({layoutImportResult.ignoredRows.length})</TabsTrigger>
              <TabsTrigger value="not-found">No encontrados ({layoutImportResult.notFoundRows.length})</TabsTrigger>
              <TabsTrigger value="invalid">Inválidos ({layoutImportResult.invalidRows.length})</TabsTrigger>
              <TabsTrigger value="unhandled">No contemplados ({layoutImportResult.unhandledRows.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="updated">
              <LayoutResultTable
                rows={layoutImportResult.updatedRows}
                columns={updatedResultColumns}
                emptyMessage="No hubo registros actualizados en la última importación."
              />
            </TabsContent>

            <TabsContent value="ignored">
              <LayoutResultTable
                rows={layoutImportResult.ignoredRows}
                columns={genericResultColumns}
                emptyMessage="No hubo registros ignorados."
              />
            </TabsContent>

            <TabsContent value="not-found">
              <LayoutResultTable
                rows={layoutImportResult.notFoundRows}
                columns={genericResultColumns}
                emptyMessage="Todos los UUID contemplados fueron localizados."
              />
            </TabsContent>

            <TabsContent value="invalid">
              <LayoutResultTable
                rows={layoutImportResult.invalidRows}
                columns={invalidResultColumns}
                emptyMessage="No hubo registros inválidos."
              />
            </TabsContent>

            <TabsContent value="unhandled" className="space-y-3">
              {layoutImportResult.unhandledRows.length > 0 && (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleCopyUnhandledRows}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar registros no contemplados
                  </Button>
                </div>
              )}
              <LayoutResultTable
                rows={layoutImportResult.unhandledRows}
                columns={genericResultColumns}
                emptyMessage="No hubo registros no contemplados."
              />
              {layoutImportResult.unhandledRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Contenido copiable para revisión manual</span>
                  </div>
                  <Textarea
                    value={unhandledRawText}
                    readOnly
                    className="min-h-[180px] font-mono text-xs"
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )

  useEffect(() => {
    const id = setTimeout(() => {
      fetchInvoices()
    }, 500)
    return () => clearTimeout(id)
  }, [fetchInvoices])

  useEffect(() => {
    const readSelected = () => {
      try {
        const raw = localStorage.getItem('selectedCompany')
        if (raw) {
          const parsed = JSON.parse(raw) as SelectedCompany
          setSelectedCompanyId(parsed?.id || null)
          setSelectedCompany(parsed || null)
        }
      } catch {}
    }
    readSelected()
    const listener = () => readSelected()
    window.addEventListener('company-selected', listener as EventListener)
    return () => window.removeEventListener('company-selected', listener as EventListener)
  }, [])

  const countLabel = ` — ${invTotal} registros`

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
                Usa el combobox del sidebar para elegir la empresa y ver las Cancelaciones.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center space-x-2">
          <XCircle className="h-8 w-8 text-red-500" />
          <h2 className="text-3xl font-bold tracking-tight">Cancelaciones</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {selectedCompany?.rfc || 'N/A'} · {selectedCompany?.businessName || selectedCompany?.name || 'Empresa'}
            </span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Facturas Canceladas</CardTitle>
            <CardDescription>Visualización de facturas con estatus SAT: CANCELADO</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-7 items-end">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Tipo CFDI</span>
                <Select value={invCfdiType} onValueChange={(v) => setInvCfdiType(v === 'ALL' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Tipo CFDI" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos</SelectItem>
                    <SelectItem value="INGRESO">INGRESO</SelectItem>
                    <SelectItem value="PAGO">PAGO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Estatus</span>
                <Select value={invStatus} onValueChange={(v) => setInvStatus(v === 'ALL' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Estatus" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos</SelectItem>
                    <SelectItem value="ACTIVE">Activo</SelectItem>
                    <SelectItem value="CANCELLED">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Removed SAT Status selector - always CANCELADO */}
              
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Fecha desde</span>
                <Input type="date" placeholder="Fecha desde" value={invDateFrom} onChange={(e) => setInvDateFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Fecha hasta</span>
                <Input type="date" placeholder="Fecha hasta" value={invDateTo} onChange={(e) => setInvDateTo(e.target.value)} />
              </div>
              <Button 
                onClick={() => {
                  if (!hasActiveFilters) {
                    toast.info('Selecciona al menos un filtro para consultar registros')
                    setInvRows([])
                    setInvTotalPages(0)
                    setInvTotal(0)
                    return
                  }

                  setInvPage(1)
                  fetchInvoices()
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Aplicar
              </Button>
              <Button 
                onClick={() => {
                  setInvQuery('')
                  setInvCfdiType('')
                  setInvStatus('')
                  setInvSatStatus('CANCELADO') // Reset to CANCELADO
                  setInvDateFrom('')
                  setInvDateTo('')
                  setColumnFilters({})
                  setInvLimit(50)
                  setInvPage(1)
                  fetchInvoices()
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Limpiar filtros
              </Button>
            </div>
            <div className="flex gap-3 mt-3 flex-wrap">
              <Button 
                variant="outline" 
                disabled={!hasActiveFilters || invRows.length === 0}
                onClick={() => {
                  const selectedCols = columnDefs
                    .filter(c => visibleCols.has(c.key))
                    .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                  const headers = selectedCols.map(c => c.label)
                  const rows = invRows.map(r =>
                    selectedCols.map(c => exportValue(r, c.key))
                  )
                  const escape = (val: string) => {
                    const needsQuotes = /[",\n]/.test(val)
                    const v = val.replace(/"/g, '""')
                    return needsQuotes ? `"${v}"` : v
                  }
                  const csv = [headers, ...rows].map(r => r.map(x => escape(String(x))).join(',')).join('\n')
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `cfdis_cancelados_${selectedCompany?.rfc || 'empresa'}.csv`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Exportar CSV
              </Button>
              <Button 
                variant="outline" 
                disabled={!hasActiveFilters || invRows.length === 0}
                onClick={() => {
                  const selectedCols = columnDefs
                    .filter(c => visibleCols.has(c.key))
                    .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                  const headers = selectedCols.map(c => c.label)
                  const escapeXml = (s: string) =>
                    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')
                  const toCell = (value: string, type: 'String' | 'Number' = 'String') =>
                    `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`
                  const headerRow = `<Row>${headers.map(h => toCell(h, 'String')).join('')}</Row>`
                  const dataRows = invRows.map(r => {
                    const cells = selectedCols.map(c => {
                      const val = exportValue(r, c.key)
                      const type = typeof val === 'number' ? 'Number' : 'String'
                      return toCell(String(val), type)
                    })
                    return `<Row>${cells.join('')}</Row>`
                  }).join('')
                  const xml =
                    `<?xml version="1.0"?>` +
                    `<?mso-application progid="Excel.Sheet"?>` +
                    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
                    `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
                    `xmlns:x="urn:schemas-microsoft-com:office:excel" ` +
                    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
                    `<Worksheet ss:Name="CFDIs Cancelados">` +
                    `<Table>` +
                    `  <Column ss:Width="100"/>`.repeat(headers.length) +
                    headerRow +
                    dataRows +
                    `</Table>` +
                    `</Worksheet>` +
                    `</Workbook>`
                  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `cfdis_cancelados_${selectedCompany?.rfc || 'empresa'}.xls`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Exportar Excel
              </Button>
              <Dialog open={layoutDialogOpen} onOpenChange={setLayoutDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
                  >
                    <FileUp className="h-4 w-4" />
                    Importación Layout
                  </Button>
                </DialogTrigger>
                <DialogContent className="!top-4 !right-4 !bottom-4 !left-4 !w-auto !max-w-none !h-auto !max-h-none !translate-x-0 !translate-y-0 rounded-xl border overflow-y-auto content-start">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FileUp className="h-5 w-5" />
                      Importar layout de cancelaciones
                    </DialogTitle>
                    <DialogDescription>
                      Carga directa de layouts `.txt` separados por `|` para actualizar `satStatus` a `CANCELADO`.
                    </DialogDescription>
                  </DialogHeader>
                  {layoutImportPanel}
                </DialogContent>
              </Dialog>
            </div>

            <div className="rounded-md border mt-4 overflow-x-auto relative">
              {invLoading && (
                <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground uppercase">
                    {[...columnDefs]
                      .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                      .map(col => {
                      if (!visibleCols.has(col.key)) return null
                      return (
                        <th 
                          key={col.key} 
                          className="h-10 px-4 text-left font-medium align-middle"
                          draggable
                          onDragStart={() => setDragCol(col.key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (!dragCol || dragCol === col.key) return
                            const oldIdx = columnOrder.indexOf(dragCol)
                            const newIdx = columnOrder.indexOf(col.key)
                            const newOrder = [...columnOrder]
                            newOrder.splice(oldIdx, 1)
                            newOrder.splice(newIdx, 0, dragCol)
                            setColumnOrder(newOrder)
                            setDragCol(null)
                          }}
                        >
                          {col.label}
                        </th>
                      )
                    })}
                    <th className="h-10 px-4 text-center font-medium align-middle sticky right-0 bg-muted/50 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
                      Acciones
                    </th>
                  </tr>
                  <tr className="border-b bg-muted/30">
                    {[...columnDefs]
                      .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                      .map(col => {
                      if (!visibleCols.has(col.key)) return null
                      return (
                        <th key={col.key} className="h-10 px-4 text-left align-middle">
                          <input
                            type="text"
                            placeholder="Filtrar..."
                            className="w-full h-6 px-2 text-xs border rounded bg-background"
                            value={columnFilters[col.key] || ''}
                            onChange={(e) => {
                              setColumnFilters(prev => ({
                                ...prev,
                                [col.key]: e.target.value
                              }))
                            }}
                          />
                        </th>
                      )
                    })}
                    <th className="h-10 px-4 text-center align-middle sticky right-0 bg-muted/30 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
                      {/* Empty header cell for Actions filter row */}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invRows.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-muted/50 transition-colors">
                      {[...columnDefs]
                        .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                        .map(col => {
                          if (!visibleCols.has(col.key)) return null
                          return (
                            <td key={col.key} className="p-4 align-middle">
                              {col.render(row)}
                            </td>
                          )
                        })}
                      <td className="p-4 text-center align-middle sticky right-0 bg-background z-10 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
                        <div className="flex justify-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            title="XML"
                            onClick={() => {
                              const xml = String(row.xmlContent || '')
                              if (!xml) return
                              const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `cfdi_${row.uuid || 'cfdi'}.xml`
                              document.body.appendChild(a)
                              a.click()
                              document.body.removeChild(a)
                              URL.revokeObjectURL(url)
                            }}
                          >
                            <FileCode className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            title="PDF"
                            onClick={() => {
                              try {
                                toast.info('Generando PDF...')
                                const a = document.createElement('a')
                                a.href = `/api/invoices/${row.id}/pdf`
                                a.target = '_blank'
                                document.body.appendChild(a)
                                a.click()
                                document.body.removeChild(a)
                              } catch (error) {
                                console.error(error)
                                toast.error('Ocurrió un error al generar el PDF')
                              }
                            }}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {invRows.length === 0 && !invLoading && (
                    <tr>
                      <td colSpan={visibleCols.size + 1} className="p-4 text-center text-muted-foreground">
                        {hasActiveFilters
                          ? 'No se encontraron registros'
                          : 'Selecciona al menos un filtro para consultar registros'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Página {invPage} de {invTotalPages} {countLabel}
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInvPage(p => Math.max(1, p - 1))}
                  disabled={invPage === 1 || invLoading}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInvPage(p => Math.min(invTotalPages, p + 1))}
                  disabled={invPage === invTotalPages || invLoading}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

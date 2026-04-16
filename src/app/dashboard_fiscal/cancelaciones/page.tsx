'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { XCircle } from 'lucide-react'


type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

const formatMXN = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))

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

  const columnDefs = useMemo(() => [
    { key: 'issuerRfc', label: 'RFC Emisor', render: (r: InvoiceRow) => r.issuerRfc },
    { key: 'issuerName', label: 'Emisor', render: (r: InvoiceRow) => <div className="whitespace-nowrap max-w-[200px] sm:max-w-[300px] truncate" title={r.issuerName}>{r.issuerName}</div> },
    { key: 'receiverRfc', label: 'RFC Receptor', render: (r: InvoiceRow) => r.receiverRfc },
    { key: 'receiverName', label: 'Receptor', render: (r: InvoiceRow) => <div className="whitespace-nowrap max-w-[200px] sm:max-w-[300px] truncate" title={r.receiverName}>{r.receiverName}</div> },
    { key: 'series', label: 'Serie', render: (r: InvoiceRow) => r.series ?? '' },
    { key: 'folio', label: 'Folio', render: (r: InvoiceRow) => r.folio ?? '' },
    { key: 'cfdiType', label: 'Tipo CFDI', render: (r: InvoiceRow) => r.cfdiType },
    { key: 'issuanceDate', label: 'Fecha', render: (r: InvoiceRow) => new Date(r.issuanceDate).toLocaleDateString('es-MX') },
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



  const exportValue = (r: InvoiceRow, key: string): string | number => {
    if (key === 'taxesWithheld') return (r.ivaWithheld || 0) + (r.isrWithheld || 0) + (r.iepsWithheld || 0)
    const v = r[key as keyof InvoiceRow] as unknown
    const dateKeys: Array<keyof InvoiceRow> = ['issuanceDate', 'certificationDate', 'createdAt', 'updatedAt']
    if (v === null || v === undefined) return ''
    if (dateKeys.includes(key as keyof InvoiceRow)) {
      try {
        return new Date(v as string | Date).toLocaleDateString('es-MX')
      } catch {
        return String(v)
      }
    }
    if (typeof v === 'number') return v
    return String(v)
  }

  const fetchInvoices = useCallback(async () => {
    if (!selectedCompanyId) return
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
  }, [selectedCompanyId, invPage, invLimit, invQuery, invCfdiType, invStatus, invSatStatus, invDateFrom, invDateTo, columnFilters])

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
                onClick={() => { setInvPage(1); fetchInvoices() }}
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
            </div>

            <div className="rounded-md border mt-4 overflow-x-auto relative">
              {invLoading && (
                <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
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
                    </tr>
                  ))}
                  {invRows.length === 0 && !invLoading && (
                    <tr>
                      <td colSpan={visibleCols.size} className="p-4 text-center text-muted-foreground">
                        No se encontraron registros
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

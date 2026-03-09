'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, Eye, Download } from 'lucide-react'
import JSZip from 'jszip'

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

export default function WorkpaperRecibidosPage() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)

  const [invQuery, setInvQuery] = useState('')
  const [invCfdiType, setInvCfdiType] = useState<string>('')
  const [invStatus, setInvStatus] = useState<string>('')
  const [invSatStatus, setInvSatStatus] = useState<string>('')
  const [invDateFrom, setInvDateFrom] = useState<string>('')
  const [invDateTo, setInvDateTo] = useState<string>('')
  const [invPeriod, setInvPeriod] = useState<string>('ALL')
  const [invPage, setInvPage] = useState(1)
  const [invLimit, setInvLimit] = useState(20)
  const [invLoading, setInvLoading] = useState(false)
  const [invRows, setInvRows] = useState<InvoiceRow[]>([])
  const [invTotalPages, setInvTotalPages] = useState(0)
  const [invTotal, setInvTotal] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<Array<{ name: string; size: number; xml?: string; selected: boolean; valid: boolean; error?: string }>>([])

  const columnDefs = useMemo(() => [
    { key: 'id', label: 'ID', render: (r: InvoiceRow) => r.id },
    { key: 'userId', label: 'Usuario', render: (r: InvoiceRow) => r.userId },
    { key: 'issuerFiscalEntityId', label: 'Entidad Fiscal', render: (r: InvoiceRow) => r.issuerFiscalEntityId },
    { key: 'uuid', label: 'UUID', render: (r: InvoiceRow) => r.uuid },
    { key: 'cfdiType', label: 'Tipo CFDI', render: (r: InvoiceRow) => r.cfdiType },
    { key: 'series', label: 'Serie', render: (r: InvoiceRow) => r.series ?? '' },
    { key: 'folio', label: 'Folio', render: (r: InvoiceRow) => r.folio ?? '' },
    { key: 'currency', label: 'Moneda', render: (r: InvoiceRow) => r.currency ?? '' },
    { key: 'exchangeRate', label: 'Tipo Cambio', render: (r: InvoiceRow) => r.exchangeRate ?? '' },
    { key: 'status', label: 'Estatus', render: (r: InvoiceRow) => r.status },
    { key: 'satStatus', label: 'SAT', render: (r: InvoiceRow) => r.satStatus },
    { key: 'issuerRfc', label: 'RFC Emisor', render: (r: InvoiceRow) => r.issuerRfc },
    { key: 'issuerName', label: 'Emisor', render: (r: InvoiceRow) => r.issuerName },
    { key: 'receiverRfc', label: 'RFC Receptor', render: (r: InvoiceRow) => r.receiverRfc },
    { key: 'receiverName', label: 'Receptor', render: (r: InvoiceRow) => r.receiverName },
    { key: 'subtotal', label: 'Subtotal', render: (r: InvoiceRow) => formatMXN(r.subtotal) },
    { key: 'discount', label: 'Descuento', render: (r: InvoiceRow) => formatMXN(r.discount) },
    { key: 'total', label: 'Total', render: (r: InvoiceRow) => formatMXN(r.total) },
    { key: 'ivaTransferred', label: 'IVA Trasladado', render: (r: InvoiceRow) => formatMXN(r.ivaTransferred) },
    { key: 'ivaWithheld', label: 'IVA Retenido', render: (r: InvoiceRow) => formatMXN(r.ivaWithheld) },
    { key: 'isrWithheld', label: 'ISR Retenido', render: (r: InvoiceRow) => formatMXN(r.isrWithheld) },
    { key: 'iepsWithheld', label: 'IEPS Retenido', render: (r: InvoiceRow) => formatMXN(r.iepsWithheld) },
    { key: 'xmlContent', label: 'XML', render: (r: InvoiceRow) => {
      const xml = String(r.xmlContent || '')
      if (!xml) return ''
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `cfdi_${r.uuid || 'cfdi'}.xml`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          }}
        >
          <Download className="h-4 w-4 mr-2" />
          Descargar XML
        </Button>
      )
    } },
    { key: 'pdfUrl', label: 'PDF', render: (r: InvoiceRow) => r.pdfUrl ?? '' },
    { key: 'issuanceDate', label: 'Fecha', render: (r: InvoiceRow) => new Date(r.issuanceDate).toLocaleDateString('es-MX') },
    { key: 'certificationDate', label: 'Fecha Certificación', render: (r: InvoiceRow) => r.certificationDate ? new Date(r.certificationDate).toLocaleDateString('es-MX') : '' },
    { key: 'certificationPac', label: 'PAC', render: (r: InvoiceRow) => r.certificationPac },
    { key: 'paymentMethod', label: 'Método Pago', render: (r: InvoiceRow) => r.paymentMethod ?? '' },
    { key: 'paymentForm', label: 'Forma Pago', render: (r: InvoiceRow) => r.paymentForm ?? '' },
    { key: 'cfdiUsage', label: 'Uso CFDI', render: (r: InvoiceRow) => r.cfdiUsage ?? '' },
    { key: 'placeOfExpedition', label: 'Lugar Expedición', render: (r: InvoiceRow) => r.placeOfExpedition ?? '' },
    { key: 'exportKey', label: 'Clave Exportación', render: (r: InvoiceRow) => r.exportKey ?? '' },
    { key: 'objectTaxComprobante', label: 'Objeto Impuesto Comp.', render: (r: InvoiceRow) => r.objectTaxComprobante ?? '' },
    { key: 'paymentConditions', label: 'Condiciones de Pago', render: (r: InvoiceRow) => r.paymentConditions ?? '' },
    { key: 'createdAt', label: 'Creado', render: (r: InvoiceRow) => new Date(r.createdAt).toLocaleString('es-MX') },
    { key: 'updatedAt', label: 'Actualizado', render: (r: InvoiceRow) => new Date(r.updatedAt).toLocaleString('es-MX') },
  ] as const, [])
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(columnDefs.map(c => c.key)))
  const [columnOrder, setColumnOrder] = useState<string[]>(columnDefs.map(c => c.key))
  const [dragCol, setDragCol] = useState<string | null>(null)
  const persistVisibleColumns = useCallback(async (cols: string[]) => {
    try {
      await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            tables: {
              workpaperRecibidos: { visibleColumns: cols }
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
              workpaperRecibidos: { columnOrder: order }
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
        const cols = data?.user?.preferences?.tables?.workpaperRecibidos?.visibleColumns
        const order = data?.user?.preferences?.tables?.workpaperRecibidos?.columnOrder
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

  const [showColumnPanel, setShowColumnPanel] = useState(false)

  const exportValue = (r: InvoiceRow, key: keyof InvoiceRow): string | number => {
    const v = r[key] as unknown
    const dateKeys: Array<keyof InvoiceRow> = ['issuanceDate', 'certificationDate', 'createdAt', 'updatedAt']
    if (v === null || v === undefined) return ''
    if (dateKeys.includes(key)) {
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
    if (invSatStatus) params.set('satStatus', invSatStatus)
    if (invDateFrom) params.set('dateFrom', invDateFrom)
    if (invDateTo) params.set('dateTo', invDateTo)
    const res = await fetch(`/api/dashboard_recibidos/invoices?${params.toString()}`)
    const data = await res.json()
    setInvRows(data?.invoices || [])
    setInvTotalPages(data?.pagination?.totalPages || 0)
    setInvTotal(data?.pagination?.total || 0)
    setInvLoading(false)
  }, [selectedCompanyId, invPage, invLimit, invQuery, invCfdiType, invStatus, invSatStatus, invDateFrom, invDateTo])

  useEffect(() => {
    const id = setTimeout(() => {
      fetchInvoices()
    }, 0)
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

  const rangeLabel =
    invDateFrom && invDateTo
      ? `Del ${invDateFrom} al ${invDateTo}`
      : invDateFrom
      ? `Desde ${invDateFrom}`
      : invDateTo
      ? `Hasta ${invDateTo}`
      : 'Todos'
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
                Usa el combobox del sidebar para elegir la empresa y cargar la Hoja de Trabajo.
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
          <h2 className="text-3xl font-bold tracking-tight">Hoja de Trabajo</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {selectedCompany?.rfc || 'N/A'} · {selectedCompany?.businessName || selectedCompany?.name || 'Empresa'}
            </span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>CFDIs analizados</CardTitle>
            <CardDescription>Visualización con filtros y paginación</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-7">
              <Input placeholder="Buscar (UUID, RFC, nombre, folio)" value={invQuery} onChange={(e) => setInvQuery(e.target.value)} />
              <Select value={invCfdiType} onValueChange={(v) => setInvCfdiType(v === 'ALL' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Tipo CFDI" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="INGRESO">INGRESO</SelectItem>
                  <SelectItem value="EGRESO">EGRESO</SelectItem>
                  <SelectItem value="PAGO">PAGO</SelectItem>
                </SelectContent>
              </Select>
              <Select value={invStatus} onValueChange={(v) => setInvStatus(v === 'ALL' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Estatus" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="ACTIVE">Activo</SelectItem>
                  <SelectItem value="CANCELLED">Cancelado</SelectItem>
                </SelectContent>
              </Select>
              <Select value={invSatStatus} onValueChange={(v) => setInvSatStatus(v === 'ALL' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Estado SAT" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="VIGENTE">Vigente</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                  <SelectItem value="NO_ENCONTRADO">No encontrado</SelectItem>
                </SelectContent>
              </Select>
              <Select value={invPeriod} onValueChange={(v) => {
                setInvPeriod(v)
                const fmt = (d: Date) => {
                  const y = d.getFullYear()
                  const m = String(d.getMonth() + 1).padStart(2, '0')
                  const day = String(d.getDate()).padStart(2, '0')
                  return `${y}-${m}-${day}`
                }
                const today = new Date()
                if (v === 'ALL') {
                  setInvDateFrom('')
                  setInvDateTo('')
                } else if (v === 'THIS_MONTH') {
                  const from = new Date(today.getFullYear(), today.getMonth(), 1)
                  setInvDateFrom(fmt(from))
                  setInvDateTo(fmt(today))
                } else if (v === 'LAST_MONTH') {
                  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
                  const end = new Date(today.getFullYear(), today.getMonth(), 0)
                  setInvDateFrom(fmt(prev))
                  setInvDateTo(fmt(end))
                } else if (v === 'LAST_7_DAYS') {
                  const from = new Date(today)
                  from.setDate(today.getDate() - 6)
                  setInvDateFrom(fmt(from))
                  setInvDateTo(fmt(today))
                } else if (v === 'LAST_30_DAYS') {
                  const from = new Date(today)
                  from.setDate(today.getDate() - 29)
                  setInvDateFrom(fmt(from))
                  setInvDateTo(fmt(today))
                } else if (v === 'THIS_QUARTER') {
                  const qStartMonth = [0, 3, 6, 9][Math.floor(today.getMonth() / 3)]
                  const from = new Date(today.getFullYear(), qStartMonth, 1)
                  setInvDateFrom(fmt(from))
                  setInvDateTo(fmt(today))
                } else if (v === 'LAST_QUARTER') {
                  const currentQ = Math.floor(today.getMonth() / 3)
                  const prevQ = currentQ - 1
                  const year = prevQ < 0 ? today.getFullYear() - 1 : today.getFullYear()
                  const startMonth = [0, 3, 6, 9][(prevQ + 4) % 4]
                  const endMonth = startMonth + 2
                  const from = new Date(year, startMonth, 1)
                  const end = new Date(year, endMonth + 1, 0)
                  setInvDateFrom(fmt(from))
                  setInvDateTo(fmt(end))
                } else if (v === 'THIS_YEAR') {
                  const from = new Date(today.getFullYear(), 0, 1)
                  setInvDateFrom(fmt(from))
                  setInvDateTo(fmt(today))
                }
              }}>
                <SelectTrigger><SelectValue placeholder="Periodo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="THIS_MONTH">Mes actual</SelectItem>
                  <SelectItem value="LAST_MONTH">Último mes</SelectItem>
                  <SelectItem value="LAST_7_DAYS">Últimos 7 días</SelectItem>
                  <SelectItem value="LAST_30_DAYS">Últimos 30 días</SelectItem>
                  <SelectItem value="THIS_QUARTER">Este trimestre</SelectItem>
                  <SelectItem value="LAST_QUARTER">Último trimestre</SelectItem>
                  <SelectItem value="THIS_YEAR">Año actual</SelectItem>
                  <SelectItem value="CUSTOM">Personalizado</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" placeholder="Fecha desde" value={invDateFrom} onChange={(e) => setInvDateFrom(e.target.value)} disabled={invPeriod !== 'CUSTOM'} />
              <Input type="date" placeholder="Fecha hasta" value={invDateTo} onChange={(e) => setInvDateTo(e.target.value)} disabled={invPeriod !== 'CUSTOM'} />
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
                  setInvSatStatus('')
                  setInvPeriod('ALL')
                  setInvDateFrom('')
                  setInvDateTo('')
                  setInvLimit(20)
                  setInvPage(1)
                  fetchInvoices()
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Limpiar filtros
              </Button>
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
                  a.download = `cfdis_recibidos_${selectedCompany?.rfc || 'empresa'}.csv`
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
                    `<Worksheet ss:Name="CFDIs Recibidos">` +
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
                  a.download = `cfdis_recibidos_${selectedCompany?.rfc || 'empresa'}.xls`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Exportar Excel
              </Button>
              <Button
                onClick={() => document.getElementById('xml-upload-input-recibidos')?.click()}
                disabled={!selectedCompanyId || uploading}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                {uploading ? 'Importando…' : 'Importar XML'}
              </Button>
              <input
                id="xml-upload-input-recibidos"
                type="file"
                multiple
                accept=".xml,.zip"
                className="hidden"
                onChange={async (e) => {
                  const files = e.target.files
                  if (!files || files.length === 0) return
                  const items: Array<{ name: string; size: number; xml?: string; selected: boolean; valid: boolean; error?: string }> = []
                  for (const file of Array.from(files)) {
                    try {
                      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')
                      if (isZip) {
                        const buf = await file.arrayBuffer()
                        const zip = await JSZip.loadAsync(buf)
                        const entries = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.xml'))
                        if (entries.length === 0) {
                          items.push({ name: file.name, size: file.size, selected: false, valid: false, error: 'ZIP sin XML' })
                        } else {
                          for (const entry of entries) {
                            const xml = await entry.async('string')
                            const valid = /<tfd:TimbreFiscalDigital|<TimbreFiscalDigital/i.test(xml) && /UUID="/i.test(xml)
                            items.push({ name: entry.name, size: xml.length, xml, selected: valid, valid, error: valid ? undefined : 'Sin Timbre/UUID' })
                          }
                        }
                      } else {
                        const xml = await file.text()
                        const valid = /<tfd:TimbreFiscalDigital|<TimbreFiscalDigital/i.test(xml) && /UUID="/i.test(xml)
                        items.push({ name: file.name, size: file.size, xml, selected: valid, valid, error: valid ? undefined : 'Sin Timbre/UUID' })
                      }
                    } catch (err) {
                      items.push({ name: file.name, size: file.size, selected: false, valid: false, error: err instanceof Error ? err.message : 'Error leyendo archivo' })
                    }
                  }
                  setPreviewItems(items)
                  setPreviewOpen(true)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Rango aplicado: {rangeLabel}{countLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowColumnPanel(v => !v)}>
                  <Eye className="h-4 w-4 mr-2" />
                  Columnas
                </Button>
              </div>
            </div>

            {showColumnPanel && (
              <div className="mt-3 border rounded-md p-3">
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
                        const basic = new Set(['issuanceDate', 'uuid', 'cfdiType', 'issuerName', 'issuerRfc', 'receiverName', 'receiverRfc', 'total'])
                        setVisibleCols(basic)
                        persistVisibleColumns(Array.from(basic))
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {columnDefs.map(col => {
                    const checked = visibleCols.has(col.key)
                    return (
                      <label key={col.key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(visibleCols)
                            if (e.target.checked) next.add(col.key)
                            else next.delete(col.key)
                            const arr = Array.from(next)
                            setVisibleCols(next)
                            persistVisibleColumns(arr)
                          }}
                        />
                        {col.label}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="overflow-x-auto scrollbar-visible mt-4">
              <div className="min-w-[1000px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      {columnDefs
                        .filter(c => visibleCols.has(c.key))
                        .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                        .map((c) => (
                          <th
                            key={c.key}
                            className="px-2 py-2 cursor-move select-none"
                            draggable
                            onDragStart={() => setDragCol(c.key)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (!dragCol || dragCol === c.key) return
                              const order = [...columnOrder]
                              const from = order.indexOf(dragCol)
                              const to = order.indexOf(c.key)
                              if (from < 0 || to < 0) return
                              order.splice(from, 1)
                              order.splice(to, 0, dragCol)
                              setColumnOrder(order)
                              persistColumnOrder(order)
                              setDragCol(null)
                            }}
                          >
                            {c.label}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invLoading ? (
                      <tr><td className="px-2 py-3" colSpan={8}>Cargando...</td></tr>
                    ) : invRows.length === 0 ? (
                      <tr><td className="px-2 py-3" colSpan={8}>Sin resultados</td></tr>
                    ) : (
                      invRows.map((r) => (
                        <tr key={r.id} className="border-t">
                          {columnDefs
                            .filter(c => visibleCols.has(c.key))
                            .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                            .map((c) => (
                              <td key={c.key} className="px-2 py-2">{c.render(r)}</td>
                            ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="text-xs text-muted-foreground">Página {invPage} de {Math.max(invTotalPages, 1)}</div>
              <div className="flex items-center gap-2">
                <Select value={String(invLimit)} onValueChange={(v) => { setInvLimit(Number(v)); setInvPage(1) }}>
                  <SelectTrigger className="w-[120px]"><SelectValue placeholder="Por página" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setInvPage(Math.max(invPage - 1, 1))} disabled={invPage === 1}>Anterior</Button>
                <Button variant="outline" onClick={() => setInvPage(invPage + 1)} disabled={invPage >= invTotalPages}>Siguiente</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {previewOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setPreviewOpen(false)} />
            <div className="relative bg-background rounded-xl shadow-lg w-full max-w-4xl mx-3 max-h-[85vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-3 border-b">
                <div className="text-lg font-semibold">Previsualizar XMLs</div>
                <div className="text-sm text-muted-foreground">
                  Seleccionados {previewItems.filter(i => i.selected).length} de {previewItems.length}
                </div>
              </div>
              <div className="p-3 overflow-y-auto">
                <div className="space-y-2">
                  {previewItems.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between border rounded-md p-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => {
                            const next = [...previewItems]
                            next[idx] = { ...item, selected: !item.selected }
                            setPreviewItems(next)
                          }}
                        />
                        <div>
                          <div className="text-sm font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.valid ? 'Válido' : `Inválido${item.error ? `: ${item.error}` : ''}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{item.size} bytes</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between p-3 border-t">
                <Button variant="outline" onClick={() => setPreviewOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  disabled={!selectedCompanyId || uploading || previewItems.filter(i => i.selected).length === 0}
                  onClick={async () => {
                    if (!selectedCompanyId) return
                    setUploading(true)
                    try {
                      const formData = new FormData()
                      for (const item of previewItems) {
                        if (!item.selected || !item.xml) continue
                        const blob = new Blob([item.xml], { type: 'text/xml' })
                        const file = new File([blob], item.name.replace(/.*\//, ''), { type: 'text/xml' })
                        formData.append('files', file)
                      }
                      const res = await fetch(`/api/dashboard_recibidos/upload?companyId=${selectedCompanyId}`, {
                        method: 'POST',
                        body: formData
                      })
                      const data = await res.json()
                      if (!res.ok) {
                        console.error('Error importación:', data?.error || 'Error al importar')
                      } else {
                        fetchInvoices()
                        setPreviewOpen(false)
                      }
                    } catch (err) {
                      console.error('Error importación:', err instanceof Error ? err.message : 'Error desconocido')
                    } finally {
                      setUploading(false)
                    }
                  }}
                >
                  Importar seleccionados
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { DashboardSkeleton } from "@/components/loading/skeletons"
import { showSuccess, showError } from "@/lib/toast"
import { ProtectedRoute } from "@/components/protected-route"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts'
import JSZip from 'jszip'

type MetricsResponse = {
  company: { id: string; rfc: string; name: string }
  kpis: { 
    totalCfdis: number
    totalMonto: number
    tasaCancelacion: number
    totalGastos: number
    totalNotasCredito: number
    totalEgresos: number
    pagado: number
    pendiente: number
    cancelaciones: number
    taxes: {
      ivaTrasladado: number
      ivaRetenido: number
      isrRetenido: number
      iepsRetenido: number
    }
  }
  byType: Array<{ type: string; count: number; total: number }>
  bySatStatus: Array<{ status: string; count: number }>
  monthly: Array<{ label: string; count: number; total: number }>
  topSuppliers: Array<{ rfc: string | null; name: string | null; total: number }>
  topClients: Array<{ rfc: string | null; name: string | null; total: number }>
  paymentMethods: Array<{ method: string | null; count: number }>
}

const formatMXN = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))

type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

export default function DashboardRecibidosPage() {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<Array<{ name: string; size: number; xml?: string; selected: boolean; valid: boolean; error?: string }>>([])

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

  const buildZeroMetrics = useCallback((company: SelectedCompany | null): MetricsResponse => {
    const now = new Date()
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
      return {
        label: `${d.toLocaleString('es-MX', { month: 'short' })} ${d.getFullYear()}`,
        count: 0,
        total: 0
      }
    })
    return {
      company: {
        id: company?.id || selectedCompanyId || 'unknown',
        rfc: company?.rfc || 'N/A',
        name: company?.businessName || company?.name || 'Empresa'
      },
      kpis: { 
        totalCfdis: 0, 
        totalMonto: 0, 
        tasaCancelacion: 0,
        totalGastos: 0,
        totalNotasCredito: 0,
        totalEgresos: 0,
        pagado: 0,
        pendiente: 0,
        cancelaciones: 0,
        taxes: {
          ivaTrasladado: 0,
          ivaRetenido: 0,
          isrRetenido: 0,
          iepsRetenido: 0
        }
      },
      byType: [
        { type: 'EGRESO', count: 0, total: 0 },
      ],
      bySatStatus: [
        { status: 'VIGENTE', count: 0 },
        { status: 'CANCELADO', count: 0 },
        { status: 'NO_ENCONTRADO', count: 0 },
      ],
      monthly,
      topSuppliers: [],
      topClients: [],
      paymentMethods: [],
    }
  }, [selectedCompanyId])

  useEffect(() => {
    const fetchMetrics = async () => {
      if (!selectedCompanyId) return
      try {
        setLoading(true)
        const res = await fetch(`/api/dashboard_recibidos?companyId=${selectedCompanyId}`, { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Error al cargar métricas')
        const normalized: MetricsResponse = {
          ...(data as MetricsResponse),
          byType: (data.byType && data.byType.length) ? data.byType : buildZeroMetrics(selectedCompany).byType,
          bySatStatus: (data.bySatStatus && data.bySatStatus.length) ? data.bySatStatus : buildZeroMetrics(selectedCompany).bySatStatus,
          paymentMethods: data.paymentMethods || [],
          monthly: (data.monthly && data.monthly.length) ? data.monthly : buildZeroMetrics(selectedCompany).monthly
        }
        setMetrics(normalized)
        showSuccess('Dashboard Recibidos', 'Métricas actualizadas')
      } catch (err) {
        showError('Error', err instanceof Error ? err.message : 'Error desconocido')
        setMetrics(buildZeroMetrics(selectedCompany))
      } finally {
        setLoading(false)
      }
    }
    fetchMetrics()
  }, [selectedCompanyId, buildZeroMetrics, selectedCompany])

  if (loading) {
    return <DashboardSkeleton />
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
                Usa el combobox del sidebar para elegir la empresa y cargar su Dashboard de Recibidos.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedRoute>
    )
  }

  // Calculate percentages for Taxes if needed, or just show values
  // Calculate Balance (as per image logic: Balance = Pagado + Pendiente? Or Total Egresos?)
  // Image shows: Total Egresos $198M. Balance $180M. Pagado $150M. Pendiente $30M.
  // So Balance = Pagado + Pendiente.
  const balance = (metrics?.kpis.pagado || 0) + (metrics?.kpis.pendiente || 0)

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard de Recibidos</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {metrics?.company?.rfc || selectedCompany?.rfc || 'N/A'} · {metrics?.company?.name || selectedCompany?.businessName || selectedCompany?.name || 'Empresa'}
            </span>
            <div>
              <button
                onClick={() => document.getElementById('xml-upload-input')?.click()}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                disabled={!selectedCompanyId || uploading}
              >
                {uploading ? 'Importando...' : 'Importar XML'}
              </button>
              <input
                id="xml-upload-input"
                type="file"
                multiple
                accept=".xml,.zip"
                className="hidden"
                onChange={async (e) => {
                  const files = e.target.files
                  if (!files || files.length === 0) return
                  // ... (upload logic same as before, abbreviated for brevity in thinking but included in full output)
                  // Re-using the same upload logic from previous file content
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
          </div>
        </div>

        {/* New Dashboard Layout */}
        <div className="grid gap-4 md:grid-cols-12">
          {/* Left Column: Top Proveedores */}
          <div className="md:col-span-3">
            <Card className="h-full border border-border bg-card">
              <CardHeader className="bg-blue-600/10 border-b border-border py-3">
                <CardTitle className="text-base font-bold text-blue-500">Top Proveedores</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                 <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={metrics?.topSuppliers || []} margin={{ left: 0, right: 30, top: 10, bottom: 10 }}>
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 10}} interval={0} />
                        <Tooltip formatter={(value: any) => formatMXN(Number(value))} cursor={{fill: 'transparent'}} />
                        <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                 </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Column: KPIs */}
          <div className="md:col-span-6 space-y-4">
            {/* Row 1 */}
            <div className="grid grid-cols-3 gap-4">
               <Card className="border border-border bg-card">
                  <div className="bg-blue-600/10 p-2 text-center border-b border-border">
                    <h3 className="text-blue-500 font-bold text-sm">Total de Gastos</h3>
                  </div>
                  <CardContent className="p-4 flex items-center justify-center">
                    <div className="text-lg font-bold text-foreground">{formatMXN(metrics?.kpis.totalGastos || 0)}</div>
                  </CardContent>
               </Card>
               <Card className="border border-border bg-card">
                  <div className="bg-green-600/10 p-2 text-center border-b border-border">
                    <h3 className="text-green-500 font-bold text-sm">Total Notas de Crédito</h3>
                  </div>
                  <CardContent className="p-4 flex items-center justify-center">
                    <div className="text-lg font-bold text-green-500">{formatMXN(metrics?.kpis.totalNotasCredito || 0)}</div>
                  </CardContent>
               </Card>
               <Card className="border border-border bg-card">
                  <div className="bg-emerald-600/10 p-2 text-center border-b border-border">
                    <h3 className="text-emerald-500 font-bold text-sm">Balance</h3>
                  </div>
                  <CardContent className="p-4 flex items-center justify-center">
                    <div className="text-lg font-bold text-emerald-500">{formatMXN(balance)}</div>
                  </CardContent>
               </Card>
            </div>

            {/* Row 2: Taxes */}
            <div className="grid grid-cols-3 gap-4">
               <Card className="border border-border bg-card">
                  <div className="p-2 text-center border-b border-border bg-accent/50">
                    <h3 className="text-muted-foreground font-bold text-xs">Impuesto IVA</h3>
                  </div>
                  <CardContent className="p-4 flex flex-col items-center justify-center">
                    <div className="text-lg font-bold text-foreground">{formatMXN(metrics?.kpis.taxes.ivaTrasladado || 0)}</div>
                    <span className="text-xs text-muted-foreground">(Acreditable)</span>
                  </CardContent>
               </Card>
               <Card className="border border-border bg-card">
                  <div className="p-2 text-center border-b border-border bg-accent/50">
                    <h3 className="text-muted-foreground font-bold text-xs">Impuesto IEPS</h3>
                  </div>
                  <CardContent className="p-4 flex flex-col items-center justify-center">
                    <div className="text-lg font-bold text-foreground">{formatMXN(metrics?.kpis.taxes.iepsRetenido || 0)}</div>
                    <span className="text-xs text-muted-foreground">(Retenido)</span>
                  </CardContent>
               </Card>
               <Card className="border border-border bg-card">
                  <div className="p-2 text-center border-b border-border bg-accent/50">
                    <h3 className="text-muted-foreground font-bold text-xs">Impuesto ISR</h3>
                  </div>
                  <CardContent className="p-4 flex flex-col items-center justify-center">
                    <div className="text-lg font-bold text-foreground">{formatMXN(metrics?.kpis.taxes.isrRetenido || 0)}</div>
                    <span className="text-xs text-muted-foreground">(Retenido)</span>
                  </CardContent>
               </Card>
            </div>

            {/* Row 3: Total Egresos */}
            <Card className="border border-border bg-card">
               <div className="bg-slate-800 p-2 text-center border-b border-border">
                 <h3 className="text-white font-bold text-lg">Total de Egresos</h3>
               </div>
               <CardContent className="p-6 flex items-center justify-center">
                 <div className="text-4xl font-bold text-foreground">{formatMXN(metrics?.kpis.totalEgresos || 0)}</div>
               </CardContent>
            </Card>

            {/* Row 4: Status Boxes */}
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-green-700/20 border border-green-700/50 rounded-lg p-4 text-center">
                  <div className="text-green-500 font-bold mb-1">Pagado</div>
                  <div className="text-xl font-bold text-green-500">{formatMXN(metrics?.kpis.pagado || 0)}</div>
               </div>
               <div className="bg-orange-500/20 border border-orange-500/50 rounded-lg p-4 text-center">
                  <div className="text-orange-500 font-bold mb-1">Pendiente</div>
                  <div className="text-xl font-bold text-orange-500">{formatMXN(metrics?.kpis.pendiente || 0)}</div>
               </div>
            </div>
             <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-2 text-center w-1/2 mx-auto">
                <div className="text-red-500 font-bold text-sm">Cancelaciones</div>
                <div className="text-lg font-bold text-red-500">{formatMXN(metrics?.kpis.cancelaciones || 0)}</div>
             </div>
          </div>

          {/* Right Column: Estado de Facturas */}
          <div className="md:col-span-3">
             <Card className="h-full border border-border bg-card">
              <CardHeader className="bg-blue-900/20 border-b border-border py-3">
                <CardTitle className="text-base font-bold text-blue-200">Estado de Facturas</CardTitle>
              </CardHeader>
              <CardContent className="p-4 flex flex-col items-center justify-center h-[400px]">
                 <ResponsiveContainer width="100%" height="60%">
                    <PieChart>
                      <Pie 
                        data={metrics?.bySatStatus || []} 
                        dataKey="count" 
                        nameKey="status" 
                        cx="50%" 
                        cy="50%" 
                        innerRadius={60} 
                        outerRadius={80} 
                        paddingAngle={5}
                      >
                        {(metrics?.bySatStatus || []).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.status === 'VIGENTE' ? '#22c55e' : entry.status === 'CANCELADO' ? '#ef4444' : '#eab308'} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                 </ResponsiveContainer>
                 <div className="text-center mt-4">
                    <div className="text-2xl font-bold text-foreground">{metrics?.kpis.totalCfdis || 0}</div>
                    <div className="text-sm text-muted-foreground">Total Facturas</div>
                 </div>
              </CardContent>
            </Card>
          </div>
        </div>

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
                <button
                  className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 rounded-md"
                  onClick={() => setPreviewOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
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
                        showError('Error', data?.error || 'Error al importar')
                      } else {
                        showSuccess('Importación', `Importados: ${data?.summary?.created || 0}, Omitidos: ${data?.summary?.skipped || 0}, Errores: ${data?.summary?.errors || 0}`)
                        const refetchMetrics = await fetch(`/api/dashboard_recibidos?companyId=${selectedCompanyId}`, { cache: 'no-store' })
                        const metricsData = await refetchMetrics.json()
                        if (refetchMetrics.ok) {
                          setMetrics({
                            ...(metricsData as MetricsResponse),
                            byType: (metricsData.byType && metricsData.byType.length) ? metricsData.byType : buildZeroMetrics(selectedCompany).byType,
                            bySatStatus: (metricsData.bySatStatus && metricsData.bySatStatus.length) ? metricsData.bySatStatus : buildZeroMetrics(selectedCompany).bySatStatus,
                            paymentMethods: metricsData.paymentMethods || [],
                            monthly: (metricsData.monthly && metricsData.monthly.length) ? metricsData.monthly : buildZeroMetrics(selectedCompany).monthly
                          })
                        }
                        setPreviewOpen(false)
                      }
                    } catch (err) {
                      showError('Error', err instanceof Error ? err.message : 'Error desconocido')
                    } finally {
                      setUploading(false)
                    }
                  }}
                >
                  Importar seleccionados
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}

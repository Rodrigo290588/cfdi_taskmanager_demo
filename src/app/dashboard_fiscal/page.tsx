/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { DashboardSkeleton } from "@/components/loading/skeletons"
import { showError } from "@/lib/toast"
import { ProtectedRoute } from "@/components/protected-route"
// import { useTenant } from '@/hooks/use-tenant'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts'
import { ShoppingCart, FileText, XCircle, CheckCircle, ArrowDown, Search, SlidersHorizontal } from "lucide-react"

type MetricsResponse = {
  company: { id: string; rfc: string; name: string }
  kpis: { 
    totalCfdis: number; 
    totalMonto: number; 
    tasaCancelacion: number;
    montoCancelado: number;
    montoNotasCredito: number;
    taxes: {
      ivaTrasladado: number;
      ivaRetenido: number;
      isrRetenido: number;
      iepsRetenido: number;
      breakdown?: {
        tasa16: { base: number; tax: number };
        tasa8: { base: number; tax: number };
        tasa0: { base: number; tax: number };
        exento: { base: number; tax: number };
      }
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

const DASHBOARD_SECTIONS = [
  { id: 'kpis', label: 'KPIs Principales' },
  { id: 'taxes', label: 'Impuestos' },
  { id: 'summary', label: 'Totales (Facturado/Cobrado)' },
  { id: 'monthly_chart', label: 'Ingresos por Mes' },
  { id: 'sat_status', label: 'Estado SAT' },
  { id: 'cfdi_type', label: 'CFDI por Tipo' },
  { id: 'payment_methods', label: 'Formas de Pago' },
  { id: 'type_amount', label: 'Monto por Tipo de CFDI' },
  { id: 'top_clients', label: 'Top Clientes/Proveedores' },
  // ytd_amount eliminado
]

type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

export default function DashboardFiscalPage() {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  // Force origin to 'issued' and remove the UI selector
  const [appliedFilters, setAppliedFilters] = useState<{start: string, end: string, origin: string}>({ start: '', end: '', origin: 'issued' })
  const [visibleSections, setVisibleSections] = useState<string[]>(DASHBOARD_SECTIONS.map(s => s.id))
 
  const getGridClass = (sections: string[]) => {
    const visibleCount = sections.filter(s => visibleSections.includes(s)).length
    if (visibleCount === 0) return 'hidden'
    return visibleCount === 1 ? 'grid gap-4 md:grid-cols-1' : 'grid gap-4 md:grid-cols-2'
  }

  // const { canAccessOperationalFeatures, loading: tenantLoading } = useTenant()

  // Read selected company id from localStorage
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
        montoCancelado: 0,
        montoNotasCredito: 0,
        taxes: {
          ivaTrasladado: 0,
          ivaRetenido: 0,
          isrRetenido: 0,
          iepsRetenido: 0,
          breakdown: {
            tasa16: { base: 0, tax: 0 },
            tasa8: { base: 0, tax: 0 },
            tasa0: { base: 0, tax: 0 },
            exento: { base: 0, tax: 0 }
          }
        }
      },
      byType: [
        { type: 'INGRESO', count: 0, total: 0 },
        { type: 'EGRESO', count: 0, total: 0 },
        { type: 'TRASLADO', count: 0, total: 0 },
        { type: 'NOMINA', count: 0, total: 0 },
        { type: 'PAGO', count: 0, total: 0 },
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

  // Fetch metrics when company is selected
  useEffect(() => {
    const fetchMetrics = async () => {
      if (!selectedCompanyId) return
      try {
        setLoading(true)
        let url = `/api/dashboard_fiscal?companyId=${selectedCompanyId}&origin=${appliedFilters.origin}`
        if (appliedFilters.start) url += `&startDate=${appliedFilters.start}`
        if (appliedFilters.end) url += `&endDate=${appliedFilters.end}`
        
        const res = await fetch(url, { cache: 'no-store' })
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
        // showSuccess('Dashboard Fiscal', 'Métricas actualizadas')
      } catch (err) {
        showError('Error', err instanceof Error ? err.message : 'Error desconocido')
        setMetrics(buildZeroMetrics(selectedCompany))
      } finally {
        setLoading(false)
      }
    }
    fetchMetrics()
  }, [selectedCompanyId, buildZeroMetrics, selectedCompany, appliedFilters])

  const handleFilter = () => {
    setAppliedFilters({ start: startDate, end: endDate, origin: 'issued' })
  }

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
                Usa el combobox del sidebar para elegir la empresa y cargar su Dashboard Fiscal.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedRoute>
    )
  }

  // Calculate Balance
  const ventas = metrics?.kpis.totalMonto || 0
  const notasCredito = metrics?.kpis.montoNotasCredito || 0
  const cancelaciones = metrics?.kpis.montoCancelado || 0
  const balance = ventas - notasCredito - cancelaciones

  // Taxes
  const impRet = (metrics?.kpis?.taxes?.ivaRetenido || 0) + (metrics?.kpis?.taxes?.isrRetenido || 0) + (metrics?.kpis?.taxes?.iepsRetenido || 0)
  const impTrasladoIVA = metrics?.kpis?.taxes?.ivaTrasladado || 0
  // Placeholders for now as they are not in schema
  const impTrasladoIEPS = 0 
  const impTrasladoISR = 0 

  // Summary
  const montoFacturado = ventas
  const montoCobrado = 0 // Placeholder
  const pendiente = montoFacturado - montoCobrado

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard de Ingresos</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {metrics?.company?.rfc || selectedCompany?.rfc || 'N/A'} · {metrics?.company?.name || selectedCompany?.businessName || selectedCompany?.name || 'Empresa'}
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 py-4 items-end">

          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="startDate">Fecha Inicio</Label>
            <Input 
              type="date" 
              id="startDate" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)} 
            />
          </div>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="endDate">Fecha Fin</Label>
            <Input 
              type="date" 
              id="endDate" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)} 
            />
          </div>
          <div className="pb-0.5 flex gap-2">
            <Button onClick={handleFilter}>
              <Search className="mr-2 h-4 w-4" />
              Filtrar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Visualización
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Secciones Visibles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setVisibleSections(DASHBOARD_SECTIONS.map(s => s.id))}>
                  Mostrar todas
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setVisibleSections([])}>
                  Ocultar todas
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {DASHBOARD_SECTIONS.map((section) => (
                  <DropdownMenuCheckboxItem
                    key={section.id}
                    checked={visibleSections.includes(section.id)}
                    onCheckedChange={(checked) => {
                      setVisibleSections(prev => 
                        checked 
                          ? [...prev, section.id]
                          : prev.filter(id => id !== section.id)
                      )
                    }}
                  >
                    {section.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Top KPIs Row */}
        {visibleSections.includes('kpis') && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-blue-600/10 p-2 text-center border-b border-border">
              <h3 className="text-blue-500 font-bold text-lg">Ventas</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <ShoppingCart className="h-12 w-12 text-blue-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ventas)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-orange-500/10 p-2 text-center border-b border-border">
              <h3 className="text-orange-500 font-bold text-lg">Notas Crédito</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-orange-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(notasCredito)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-red-500/10 p-2 text-center border-b border-border">
              <h3 className="text-red-500 font-bold text-lg">Cancelaciones</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <XCircle className="h-12 w-12 text-red-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(cancelaciones)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-green-600/10 p-2 text-center border-b border-border">
              <h3 className="text-green-500 font-bold text-lg">Balance</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <div className="text-2xl font-bold text-green-500">{formatMXN(balance)}</div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Middle Taxes Row */}
        {visibleSections.includes('taxes') && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4 flex flex-col justify-center items-center text-center shadow-sm border border-border bg-card">
             <div className="flex items-center space-x-2 mb-2">
               <ArrowDown className="h-5 w-5 text-blue-500" />
               <span className="font-semibold text-muted-foreground">Imp RET</span>
             </div>
             <div className="text-xl font-bold text-foreground">{formatMXN(impRet)}</div>
          </Card>

          <Card className="p-4 flex flex-col justify-center items-center text-center shadow-sm border border-border bg-card">
             <div className="flex items-center space-x-2 mb-2">
               <span className="bg-green-500/10 text-green-500 text-xs font-bold px-2 py-0.5 rounded-full border border-green-500/20">IVA</span>
               <span className="font-semibold text-muted-foreground">Imp Traslado IVA</span>
             </div>
             <div className="text-xl font-bold text-foreground">{formatMXN(impTrasladoIVA)}</div>
             <div className="w-full mt-3 space-y-1 text-xs text-muted-foreground border-t pt-2 border-border/50">
               <div className="flex justify-between items-center">
                 <span>16%:</span>
                 <span className="font-medium">{formatMXN(metrics?.kpis?.taxes?.breakdown?.tasa16?.tax || 0)}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span>8%:</span>
                 <span className="font-medium">{formatMXN(metrics?.kpis?.taxes?.breakdown?.tasa8?.tax || 0)}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span>0% (Base):</span>
                 <span className="font-medium">{formatMXN(metrics?.kpis?.taxes?.breakdown?.tasa0?.base || 0)}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span>Exento (Base):</span>
                 <span className="font-medium">{formatMXN(metrics?.kpis?.taxes?.breakdown?.exento?.base || 0)}</span>
               </div>
             </div>
          </Card>

          <Card className="p-4 flex flex-col justify-center items-center text-center shadow-sm border border-border bg-card">
             <div className="flex items-center space-x-2 mb-2">
               <span className="bg-orange-500/10 text-orange-500 text-xs font-bold px-2 py-0.5 rounded-full border border-orange-500/20">IEPS</span>
               <span className="font-semibold text-muted-foreground">Imp Traslado IEPS</span>
             </div>
             <div className="text-xl font-bold text-foreground">{formatMXN(impTrasladoIEPS)}</div>
          </Card>

          <Card className="p-4 flex flex-col justify-center items-center text-center shadow-sm border border-border bg-card">
             <div className="flex items-center space-x-2 mb-2">
               <span className="bg-red-500/10 text-red-500 text-xs font-bold px-2 py-0.5 rounded-full border border-red-500/20">ISR</span>
               <span className="font-semibold text-muted-foreground">Imp Traslado ISR</span>
             </div>
             <div className="text-xl font-bold text-foreground">{formatMXN(impTrasladoISR)}</div>
          </Card>
        </div>
        )}

        {/* Bottom Summary Row */}
        {visibleSections.includes('summary') && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-6 text-center border border-border bg-card">
            <div className="text-blue-500 font-bold mb-2">Monto Facturado</div>
            <div className="text-2xl font-bold text-foreground">{formatMXN(montoFacturado)}</div>
          </Card>
          <Card className="p-6 text-center border border-border bg-card">
            <div className="text-green-500 font-bold mb-2">Monto Cobrado</div>
            <div className="text-2xl font-bold text-green-500">{formatMXN(montoCobrado)}</div>
          </Card>
          <Card className="p-6 text-center border border-border bg-card">
            <div className="text-orange-500 font-bold mb-2">Pendiente</div>
            <div className="text-2xl font-bold text-orange-500">{formatMXN(pendiente)}</div>
          </Card>
        </div>
        )}

        {visibleSections.includes('monthly_chart') && (
        <Card>
          <CardHeader>
            <CardTitle>CFDI de ingresos por mes</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto scrollbar-visible">
            <div className="min-w-[800px]">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={metrics?.monthly || []} margin={{ top: 60, left: 100, right: 120 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis 
                    yAxisId="left" 
                    width={80} 
                    label={{ 
                      position: 'top', 
                      content: (props: any) => {
                        const vb = props?.viewBox || {}
                        const x = (vb.x || 0) + (vb.width || 0) / 2
                        const y = (vb.y || 0) - 20
                        return (
                          <text x={x} y={y} textAnchor="middle" fontSize={12} fontWeight={600} fill="#4b5563">
                            Cantidad de CFDIs
                          </text>
                        )
                      } 
                    }} 
                  />
                  <YAxis 
                    yAxisId="right" 
                    orientation="right" 
                    width={120} 
                    tickFormatter={(val: any) => formatMXN(Number(val))} 
                    label={{ 
                      position: 'top', 
                      content: (props: any) => {
                        const vb = props?.viewBox || {}
                        const x = (vb.x || 0) + (vb.width || 0) / 2
                        const y = (vb.y || 0) - 20
                        return (
                          <text x={x} y={y} textAnchor="middle" fontSize={12} fontWeight={600} fill="#4b5563">
                            Importe
                          </text>
                        )
                      } 
                    }} 
                  />
                  <Tooltip formatter={(value: any, name: any) => (name === 'Monto' || name === 'total') ? formatMXN(Number(value)) : value} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" name="CFDIs" fill="#2b6cb0" />
                  <Bar yAxisId="right" dataKey="total" name="Monto" fill="#68d391" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        )}

        {visibleSections.includes('sat_status') && (
        <div className="grid gap-4 md:grid-cols-1">
          <Card>
            <CardHeader>
              <CardTitle>CFDI vigentes vs cancelados</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[700px]">
                {(() => {
                  const satArr = metrics?.bySatStatus || []
                  const pacArr = (metrics as any)?.pacStatus || []
                  const erpArr = (metrics as any)?.erpStatus || []
                  const getCounts = (arr: Array<{ status: string; count: number }>) => {
                    const v = arr.find((x) => x.status === 'VIGENTE')?.count || 0
                    const c = arr.find((x) => x.status === 'CANCELADO')?.count || 0
                    return { vigentes: v, cancelados: c }
                  }
                  const sat = getCounts(satArr)
                  const pac = getCounts(pacArr)
                  const erp = getCounts(erpArr)
                  const data = [
                    { source: 'SAT', vigentes: sat.vigentes, cancelados: sat.cancelados, mismatch: false },
                    { source: 'PAC', vigentes: pac.vigentes, cancelados: pac.cancelados, mismatch: pac.vigentes !== sat.vigentes || pac.cancelados !== sat.cancelados },
                    { source: 'ERP', vigentes: erp.vigentes, cancelados: erp.cancelados, mismatch: erp.vigentes !== sat.vigentes || erp.cancelados !== sat.cancelados },
                  ]
                  return (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={data} margin={{ left: 40, right: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="source" />
                        <YAxis />
                        <Tooltip formatter={(value) => [Number(value || 0), '']} />
                        <Legend />
                        <Bar dataKey="vigentes" name="Vigentes" fill="#1e3a8a">
                          {data.map((entry, idx) => (
                            <Cell key={`vig-${idx}`} fill={entry.source !== 'SAT' && entry.mismatch ? '#ef4444' : '#1e3a8a'} />
                          ))}
                        </Bar>
                        <Bar dataKey="cancelados" name="Cancelados" fill="#6b7280">
                          {data.map((entry, idx) => (
                            <Cell key={`can-${idx}`} fill={entry.source !== 'SAT' && entry.mismatch ? '#ef4444' : '#6b7280'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )
                })()}
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        <div className={getGridClass(['cfdi_type'])}>
          {visibleSections.includes('cfdi_type') && (
          <Card>
            <CardHeader>
              <CardTitle>CFDI por Tipo</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[700px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={metrics?.byType || []} margin={{ left: 40, right: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="type" 
                      tickFormatter={(value) => {
                        const map: Record<string, string> = {
                          'INGRESO': 'I',
                          'EGRESO': 'E',
                          'PAGO': 'P',
                          'TRASLADO': 'T'
                        }
                        return map[value] || value
                      }}
                    />
                    <YAxis />
                    <Tooltip 
                      formatter={(value: any) => [value, 'CFDIs']}
                      labelFormatter={(label) => {
                        const map: Record<string, string> = {
                          'INGRESO': 'I (Ingreso)',
                          'EGRESO': 'E (Egreso)',
                          'PAGO': 'P (Pago)',
                          'TRASLADO': 'T (Traslado)'
                        }
                        return map[label] || label
                      }}
                    />
                    <Bar dataKey="count" name="CFDIs" fill="#805ad5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          )}
        </div>

        {visibleSections.includes('payment_methods') && (
        <div className="grid gap-4 md:grid-cols-1">
          <Card>
            <CardHeader>
              <CardTitle>Métodos de Pago</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie 
                      data={metrics?.paymentMethods || []} 
                      dataKey="count" 
                      nameKey="method" 
                      outerRadius={110} 
                      labelLine={false}
                      label={(entry: any) => `${entry.name}: ${(entry.percent * 100).toFixed(1)}%`}
                    >
                      {(metrics?.paymentMethods || []).map((_, i) => (
                        <Cell key={`pay-${i}`} fill={["#63b3ed", "#68d391", "#f6ad55", "#fc8181"][i % 4]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      content={(props: any) => {
                        const p = props?.payload?.[0]
                        if (!p) return null
                        const name = p.name
                        const count = Number(p.value || 0)
                        const total = (metrics?.paymentMethods || []).reduce((s, x) => s + Number(x.count || 0), 0)
                        const pct = total > 0 ? (count / total) * 100 : 0
                        const amount = typeof p.payload?.total === 'number' ? p.payload.total : 0
                        return (
                          <div className="recharts-default-tooltip" style={{ margin: 0, padding: 10, background: '#fff', border: '1px solid #ccc', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600 }}>{name}</div>
                            <div>Cantidad: {count}</div>
                            <div>Porcentaje: {pct.toFixed(1)}%</div>
                            <div>Importe: {formatMXN(Number(amount))}</div>
                          </div>
                        )
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        <div className={getGridClass(['type_amount'])}>
          {visibleSections.includes('type_amount') && (
          <Card>
            <CardHeader>
              <CardTitle>Monto por Tipo de CFDI</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[700px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={metrics?.byType || []} margin={{ left: 60, right: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="type" 
                      tickFormatter={(value) => {
                        const map: Record<string, string> = {
                          'INGRESO': 'I',
                          'EGRESO': 'E',
                          'PAGO': 'P',
                          'TRASLADO': 'T'
                        }
                        return map[value] || value
                      }}
                    />
                    <YAxis width={60} tickFormatter={(val: any) => formatMXN(Number(val))} />
                    <Tooltip 
                      formatter={(value: any) => formatMXN(Number(value))}
                      labelFormatter={(label) => {
                        const map: Record<string, string> = {
                          'INGRESO': 'I (Ingreso)',
                          'EGRESO': 'E (Egreso)',
                          'PAGO': 'P (Pago)',
                          'TRASLADO': 'T (Traslado)'
                        }
                        return map[label] || label
                      }}
                    />
                    <Legend />
                    <Bar dataKey="total" name="Monto" fill="#68d391" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          )}
        </div>

        <div className={getGridClass(['top_clients'])}>
          {visibleSections.includes('top_clients') && (
          <Card>
            <CardHeader>
              <CardTitle>Top Clientes</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[800px]">
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={metrics?.topClients || []} layout="vertical" margin={{ top: 20, right: 30, left: 60, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      type="number"
                      tickFormatter={(val: any) => formatMXN(Number(val))} 
                    />
                    <YAxis 
                      type="category"
                      dataKey="rfc" 
                      width={120} 
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <Tooltip 
                      formatter={(value: any) => formatMXN(Number(value))}
                      labelFormatter={(label: any, payload: any) => {
                        const p = payload?.[0]?.payload
                        const rfc = p?.rfc || label
                        const name = p?.name || ''
                        return name ? `${rfc} - ${name}` : rfc
                      }}
                    />
                    <Legend />
                    <Bar dataKey="total" name="Monto" fill="#68d391" barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          )}
        </div>

        

        
      </div>
    </ProtectedRoute>
  )
}

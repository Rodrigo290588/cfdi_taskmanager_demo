/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts'
import { ShoppingCart, FileText, XCircle, CheckCircle, ArrowDown, Search, SlidersHorizontal, Loader2, Download } from "lucide-react"

type MetricsResponse = {
  company: { id: string; rfc: string; name: string }
  kpis: { 
    totalCfdis: number; 
    totalMonto: number; 
    ventasNominativas?: number;
    ventasGlobales?: number;
    operacionesIndividuales?: number;
    ingresosBrutos?: number;
    descuentosYBonificaciones?: number;
    tasaCancelacion: number;
    montoCancelado?: number;
    montoCanceladoEgresos?: number;
    montoNotasCredito?: number;
    montoCobrado?: number;
    montoPorCobrar?: number;
    carteraVencida?: number;
    ingresosCobradosPue?: number;
    ingresosCobradosCrp?: number;
    ingresosCobradosTotal?: number;
    ingresosPendientesCobro?: number;
    ivaPendienteCobro?: number;
    taxes?: {
      ivaAcreditableTotal?: number;
      ivaPueRecibido?: number;
      ivaPpdRecibido?: number;
      ivaERecibido?: number;
      ivaCobradoTotal?: number;
      ivaTrasladado: number;
      ivaRetenido: number;
      isrRetenido: number;
      iepsRetenido: number;
      totalImpuestosRetenidos?: number;
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
  topClients: Array<{ rfc: string | null; name: string | null; total: number; cobrado?: number; pendiente?: number }>
  paymentMethods: Array<{ method: string | null; count: number }>
  topProducts?: Array<{ name: string; value: number }>
}

  const formatMXN = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))

const DASHBOARD_SECTIONS = [
  { id: 'kpis', label: 'KPIs Principales' },
  { id: 'net_income', label: 'Ingresos Netos Reales' },
  { id: 'gross_income', label: 'Ingresos Brutos Reales' },
  { id: 'effective_income', label: 'Ingresos Efectivamente Cobrados' },
  { id: 'taxes', label: 'Impuestos' },
  { id: 'monthly_chart', label: 'Ingresos por Mes' },
  { id: 'sat_status', label: 'Estado SAT' },
  { id: 'cfdi_type', label: 'CFDI por Tipo' },
  { id: 'payment_methods', label: 'Formas de Pago' },
  { id: 'top_clients', label: 'Top Clientes/Proveedores' },
  { id: 'top_products', label: 'Top 10 Productos' },
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
 
  // Drilldown Modal State
  const [drilldownOpen, setDrilldownOpen] = useState(false)
  const [drilldownLoading, setDrilldownLoading] = useState(false)
  const [drilldownData, setDrilldownData] = useState<any[]>([])
  const [drilldownFilters, setDrilldownFilters] = useState<Record<string, string>>({})
  const [drilldownType, setDrilldownType] = useState<'cobrados' | 'pendientes' | 'nominativos' | 'globales' | 'individuales' | 'descuentos' | 'notas_credito'>('cobrados')

  const filteredDrilldownData = useMemo(() => {
    return drilldownData.filter(row => {
      return Object.entries(drilldownFilters).every(([key, value]) => {
        if (!value) return true;
        const q = value.toLowerCase();
        if (key === 'fecha') return new Date(row.fecha).toLocaleDateString('es-MX').toLowerCase().includes(q);
        if (key === 'importe') return String(row.importe || '').includes(q) || formatMXN(row.importe).toLowerCase().includes(q);
        return String(row[key] || '').toLowerCase().includes(q);
      });
    });
  }, [drilldownData, drilldownFilters]);

  const drilldownStats = useMemo(() => {
    let totalPUE = 0;
    let totalCRP = 0;
    let totalNC = 0;
    let totalNominativos = 0;
    let totalGlobales = 0;
    let totalIndividuales = 0;
    let totalDescuentos = 0;
    let totalNotasCredito = 0;

    if (drilldownType === 'cobrados') {
      totalPUE = drilldownData.filter(d => d.tipo === 'Factura Contado (PUE)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
      totalCRP = drilldownData.filter(d => d.tipo === 'Complemento de Pago (CRP)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'pendientes') {
      totalPUE = drilldownData.filter(d => d.tipo === 'Factura a Crédito (PPD)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
      totalCRP = drilldownData.filter(d => d.tipo === 'Complemento de Pago (CRP)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
      totalNC = drilldownData.filter(d => d.tipo === 'Nota de Crédito (Ajuste)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'nominativos') {
      totalNominativos = drilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'globales') {
      totalGlobales = drilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'individuales') {
      totalIndividuales = drilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'descuentos') {
      totalDescuentos = drilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'notas_credito') {
      totalNotasCredito = drilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    }
    
    const timestamps = drilldownData.map(d => new Date(d.fecha).getTime()).filter(t => !isNaN(t));
    const minDate = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
    const maxDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

    const startDateStr = appliedFilters.start 
      ? new Date(appliedFilters.start + 'T12:00:00').toLocaleDateString('es-MX') 
      : (minDate ? minDate.toLocaleDateString('es-MX') : 'Desde el inicio');
      
    const endDateStr = appliedFilters.end 
      ? new Date(appliedFilters.end + 'T12:00:00').toLocaleDateString('es-MX') 
      : (maxDate ? maxDate.toLocaleDateString('es-MX') : 'Hasta la fecha');

    return { totalPUE, totalCRP, totalNC, totalNominativos, totalGlobales, totalIndividuales, totalDescuentos, totalNotasCredito, startDate: startDateStr, endDate: endDateStr };
  }, [drilldownData, appliedFilters, drilldownType]);

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
          setSelectedCompanyId(prev => prev === parsed?.id ? prev : (parsed?.id || null))
          setSelectedCompany(prev => prev?.id === parsed?.id ? prev : (parsed || null))
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
        ventasNominativas: 0,
        ventasGlobales: 0,
        operacionesIndividuales: 0,
        tasaCancelacion: 0,
        montoCancelado: 0,
        montoCanceladoEgresos: 0,
        montoNotasCredito: 0,
        montoCobrado: 0,
        montoPorCobrar: 0,
        taxes: {
          ivaTrasladado: 0,
          ivaRetenido: 0,
          isrRetenido: 0,
          iepsRetenido: 0,
          totalImpuestosRetenidos: 0,
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

  const handleOpenDrilldown = async (type: 'cobrados' | 'pendientes' | 'nominativos' | 'globales' | 'individuales' | 'descuentos' | 'notas_credito') => {
    if (!selectedCompanyId) return
    setDrilldownType(type)
    setDrilldownOpen(true)
    setDrilldownLoading(true)
    setDrilldownFilters({})
    try {
      let endpoint = 'ingresos_cobrados'
      if (type === 'pendientes') endpoint = 'ingresos_pendientes'
      if (type === 'nominativos') endpoint = 'ingresos_nominativos'
      if (type === 'globales') endpoint = 'ingresos_globales'
      if (type === 'individuales') endpoint = 'ingresos_individuales'
      if (type === 'descuentos') endpoint = 'descuentos_bonificaciones'
      if (type === 'notas_credito') endpoint = 'notas_credito'
      
      let url = `/api/dashboard_fiscal/drilldown/${endpoint}?companyId=${selectedCompanyId}&origin=${appliedFilters.origin}`
      if (appliedFilters.start) url += `&startDate=${appliedFilters.start}`
      if (appliedFilters.end) url += `&endDate=${appliedFilters.end}`
      
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al cargar reporte')
      setDrilldownData(json.data || [])
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Error al obtener el reporte')
      setDrilldownData([])
    } finally {
      setDrilldownLoading(false)
    }
  }

  const handleExportDrilldown = () => {
    if (!filteredDrilldownData || filteredDrilldownData.length === 0) return

    // Generate CSV content
    const headers = ["Fecha", "Tipo", "UUID", "UUID Relacionado", "Serie", "Folio", "RFC", "Razón Social", "Moneda", "Tipo Cambio", "Importe"]
    
    const escapeCsv = (value: any) => {
      if (value === null || value === undefined) return '""'
      const str = String(value)
      return str.includes(',') || str.includes('"') || str.includes('\n') 
        ? `"${str.replace(/"/g, '""')}"` 
        : str
    }

    const rows = filteredDrilldownData.map(row => [
      escapeCsv(new Date(row.fecha).toLocaleDateString('es-MX')),
      escapeCsv(row.tipo),
      escapeCsv(row.uuid),
      escapeCsv(row.uuidRelacionado),
      escapeCsv(row.serie),
      escapeCsv(row.folio),
      escapeCsv(row.rfc),
      escapeCsv(row.razonSocial),
      escapeCsv(row.moneda),
      escapeCsv(row.tipoCambio),
      escapeCsv(row.importe)
    ])

    const total = filteredDrilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0)
    rows.push(['', '', '', '', '', '', '', 'Total', '', '', escapeCsv(total)])

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n')

    // Add BOM for Excel UTF-8 encoding support
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    
    let fileNameType = 'Cobrados'
    if (drilldownType === 'pendientes') fileNameType = 'Pendientes'
    if (drilldownType === 'nominativos') fileNameType = 'Nominativos'
    if (drilldownType === 'globales') fileNameType = 'Globales'
    if (drilldownType === 'individuales') fileNameType = 'Individuales'
    if (drilldownType === 'descuentos') fileNameType = 'Descuentos'
    if (drilldownType === 'notas_credito') fileNameType = 'Notas_Credito'

    link.setAttribute('href', url)
    link.setAttribute('download', `Reporte_Ingresos_${fileNameType}_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Derived Data for Charts (Must be called before early returns)
  const topProductsData = useMemo(() => {
    if (!metrics?.topProducts) return []
    return metrics.topProducts.map(p => ({
      name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
      fullName: p.name,
      value: p.value,
      displayValue: `$${(p.value / 1000).toFixed(1)}k`
    }))
  }, [metrics])

  const topClientsData = useMemo(() => {
    if (!metrics?.topClients) return []
    return metrics.topClients.slice(0, 10).map(c => ({
      name: c.name && c.name.length > 15 ? c.name.substring(0, 15) + '...' : (c.name || c.rfc || 'Desconocido'),
      fullName: c.name || c.rfc || 'Desconocido',
      cobrado: c.cobrado !== undefined ? c.cobrado : c.total * 0.7, 
      porCobrar: c.pendiente !== undefined ? c.pendiente : c.total * 0.3,
      total: c.total
    }))
  }, [metrics])

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
  const ventas = Number(metrics?.kpis.totalMonto || 0)
  const notasCredito = Number(metrics?.kpis.montoNotasCredito || 0)
  const cancelaciones = Number(metrics?.kpis.montoCancelado || 0)
  const cancelacionesEgresos = Number(metrics?.kpis.montoCanceladoEgresos || 0)

  const ventasNominativas = Number(metrics?.kpis?.ventasNominativas || 0)
  const ventasGlobales = Number(metrics?.kpis?.ventasGlobales || 0)
  const operacionesIndividuales = Number(metrics?.kpis?.operacionesIndividuales || 0)

  // Gross Income
  const ingresosBrutos = Number(metrics?.kpis?.ingresosBrutos || 0)
  const descuentosYBonificaciones = Number(metrics?.kpis?.descuentosYBonificaciones || 0)

  // notasCredito ya solo incluye facturas VIGENTES, por lo que no restamos cancelacionesEgresos y descuentos y bonificaciones del tipo ingreso
  const balance = (ventasNominativas + ventasGlobales + operacionesIndividuales) - (notasCredito + descuentosYBonificaciones)

  // Effective Income
  const ingresosCobradosPue = Number(metrics?.kpis?.ingresosCobradosPue || 0)
  const ingresosCobradosCrp = Number(metrics?.kpis?.ingresosCobradosCrp || 0)
  const ingresosCobradosTotal = ingresosCobradosPue + ingresosCobradosCrp
  const ingresosPendientesCobro = Number(metrics?.kpis?.ingresosPendientesCobro || 0)
  const ivaPendienteCobro = Number(metrics?.kpis?.ivaPendienteCobro || 0)

  // Taxes
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const ivaAcreditableTotal = metrics?.kpis?.taxes?.ivaAcreditableTotal || 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const ivaPueRecibido = metrics?.kpis?.taxes?.ivaPueRecibido || 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const ivaPpdRecibido = metrics?.kpis?.taxes?.ivaPpdRecibido || 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const ivaERecibido = metrics?.kpis?.taxes?.ivaERecibido || 0

  const ivaCobradoTotal = metrics?.kpis?.taxes?.ivaCobradoTotal || 0
  const impRet = metrics?.kpis?.taxes?.totalImpuestosRetenidos ?? ((metrics?.kpis?.taxes?.ivaRetenido || 0) + (metrics?.kpis?.taxes?.isrRetenido || 0) + (metrics?.kpis?.taxes?.iepsRetenido || 0))
  const impTrasladoIVA = metrics?.kpis?.taxes?.ivaTrasladado || 0

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Tablero de ingresos</h2>
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
        <div className={`grid gap-4 md:grid-cols-2 ${cancelacionesEgresos > 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-blue-600/10 p-2 text-center border-b border-border">
              <h3 className="text-blue-500 font-bold text-lg">CFDI de Ingresos</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <ShoppingCart className="h-12 w-12 text-blue-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ventas)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-red-500/10 p-2 text-center border-b border-border">
              <h3 className="text-red-500 font-bold text-lg">Cancelaciones de Ingresos</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <XCircle className="h-12 w-12 text-red-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(cancelaciones)}</div>
            </CardContent>
          </Card>

          {cancelacionesEgresos > 0 && (
          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-rose-500/10 p-2 text-center border-b border-border">
              <h3 className="text-rose-500 font-bold text-lg">Cancelaciones de Egresos</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <XCircle className="h-12 w-12 text-rose-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(cancelacionesEgresos)}</div>
            </CardContent>
          </Card>
          )}
        </div>
        )}

        {/* Net Income Row */}
        {visibleSections.includes('net_income') && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">

          <Card 
            className="overflow-hidden border border-border bg-card cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleOpenDrilldown('nominativos')}
          >
            <div className="bg-purple-600/10 p-2 text-center border-b border-border">
              <h3 className="text-purple-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Nominativos</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-purple-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ventasNominativas)}</div>
            </CardContent>
          </Card>

          <Card 
            className="overflow-hidden border border-border bg-card cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleOpenDrilldown('globales')}
          >
            <div className="bg-indigo-600/10 p-2 text-center border-b border-border">
              <h3 className="text-indigo-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Globales<br/>(Público en General)</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-indigo-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ventasGlobales)}</div>
            </CardContent>
          </Card>

          <Card 
            className="overflow-hidden border border-border bg-card cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleOpenDrilldown('individuales')}
          >
            <div className="bg-pink-600/10 p-2 text-center border-b border-border">
              <h3 className="text-pink-500 font-bold text-sm md:text-base leading-tight min-h-[20px] flex items-center justify-center">Ingresos Individuales<br/>(Público en General)</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-pink-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(operacionesIndividuales)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-emerald-600/10 p-2 text-center border-b border-border">
              <h3 className="text-emerald-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Brutos</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-emerald-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ingresosBrutos)}</div>
            </CardContent>
          </Card>

          <Card 
            className="overflow-hidden border border-border bg-card cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleOpenDrilldown('descuentos')}
          >
            <div className="bg-yellow-600/10 p-2 text-center border-b border-border">
              <h3 className="text-yellow-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Descuentos y<br/>Bonificaciones</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <ArrowDown className="h-12 w-12 text-yellow-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(descuentosYBonificaciones)}</div>
            </CardContent>
          </Card>

          <Card 
            className="overflow-hidden border border-border bg-card cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleOpenDrilldown('notas_credito')}
          >
            <div className="bg-orange-500/10 p-2 text-center border-b border-border">
              <h3 className="text-orange-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Notas de Crédito</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-orange-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(notasCredito)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-green-600/10 p-2 text-center border-b border-border">
              <h3 className="text-green-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos netos reales</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <div className="text-2xl font-bold text-green-500">{formatMXN(balance)}</div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Effective Income Row */}
        {visibleSections.includes('effective_income') && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 items-start">
          <Card 
            className="overflow-hidden border border-border bg-card h-full cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleOpenDrilldown('cobrados')}
          >
            <div className="bg-teal-600/10 p-2 text-center border-b border-border">
              <h3 className="text-teal-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Cobrados<br/>(Flujo Total)</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-teal-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ingresosCobradosTotal)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card h-full">
            <div className="bg-blue-600/10 p-2 text-center border-b border-border">
              <h3 className="text-blue-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">IVA Trasladado Cobrado</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-blue-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ivaCobradoTotal)}</div>
            </CardContent>
          </Card>

          <Card 
            className="overflow-hidden border border-border bg-card h-full cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleOpenDrilldown('pendientes')}
          >
            <div className="bg-rose-600/10 p-2 text-center border-b border-border">
              <h3 className="text-rose-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Pendientes de Cobro</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-rose-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ingresosPendientesCobro)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card h-full">
            <div className="bg-orange-600/10 p-2 text-center border-b border-border">
              <h3 className="text-orange-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">IVA Pendiente de Cobro</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-orange-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ivaPendienteCobro)}</div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Middle Taxes Row */}
        {visibleSections.includes('taxes') && (
        <div className="grid gap-4 md:grid-cols-3 items-start">
          <Card className="overflow-hidden border border-border bg-card h-full">
            <div className="bg-emerald-600/10 p-2 text-center border-b border-border">
              <h3 className="text-emerald-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Impuesto Trasladado IVA</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-emerald-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(impTrasladoIVA)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card h-full">
            <div className="bg-blue-600/10 p-2 text-center border-b border-border">
              <h3 className="text-blue-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">IVA Cobrado Total</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-blue-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ivaCobradoTotal)}</div>
            </CardContent>
          </Card>

          {/*
          <Card className="overflow-hidden border border-border bg-card h-full flex flex-col">
            <div className="bg-purple-600/10 p-2 text-center border-b border-border">
              <h3 className="text-purple-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">IVA Acreditable<br/>(Gastos y Compras)</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2 flex-grow">
              <FileText className="h-12 w-12 text-purple-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ivaAcreditableTotal)}</div>
              
              <div className="w-full mt-4 pt-4 border-t border-border flex flex-col space-y-2 text-sm">
                <div className="flex justify-between items-center w-full">
                  <span className="text-muted-foreground">Pagos de Contado (PUE):</span>
                  <span className="font-semibold">{formatMXN(ivaPueRecibido)}</span>
                </div>
                <div className="flex justify-between items-center w-full">
                  <span className="text-muted-foreground">Pagos a Crédito (PPD):</span>
                  <span className="font-semibold">{formatMXN(ivaPpdRecibido)}</span>
                </div>
                <div className="flex justify-between items-center w-full">
                  <span className="text-muted-foreground">Ajustes (Notas de Crédito):</span>
                  <span className="font-semibold text-destructive">-{formatMXN(ivaERecibido)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          */}

          <Card className="overflow-hidden border border-border bg-card h-full">
            <div className="bg-indigo-600/10 p-2 text-center border-b border-border">
              <h3 className="text-indigo-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Impuestos Retenidos</h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <ArrowDown className="h-12 w-12 text-indigo-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(impRet)}</div>
            </CardContent>
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

        <div className={getGridClass(['top_clients'])}>
          {visibleSections.includes('top_clients') && (
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Clientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    layout="vertical" 
                    data={topClientsData.length > 0 ? topClientsData : [{name: 'Sin datos', fullName: 'Sin datos', cobrado: 0, porCobrar: 0, total: 0}]} 
                    margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value: any) => [`$${Number(value || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`]}
                      labelFormatter={(label: any, payload: any) => payload[0]?.payload?.fullName || label}
                    />
                    <Legend />
                    <Bar dataKey="cobrado" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} barSize={20} name="Cobrado" />
                    <Bar dataKey="porCobrar" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} barSize={20} name="Por Cobrar" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          )}
        </div>

        <div className={getGridClass(['top_products'])}>
          {visibleSections.includes('top_products') && (
          <Card>
            <CardHeader>
              <CardTitle>Top 10 de productos más vendidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    layout="vertical" 
                    data={topProductsData.length > 0 ? topProductsData : [{name: 'Sin datos', fullName: 'Sin datos', value: 0, displayValue: '$0'}]} 
                    margin={{ top: 20, right: 30, left: 40, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value: any) => [`$${Number(value || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, 'Ventas']}
                      labelFormatter={(label: any, payload: any) => payload[0]?.payload?.fullName || label}
                    />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          )}
        </div>

        

        
      </div>

      <Dialog open={drilldownOpen} onOpenChange={setDrilldownOpen}>
        <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
          <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
            <div>
              <DialogTitle>
                Reporte de Ingresos {
                  drilldownType === 'cobrados' ? 'Cobrados' : 
                  drilldownType === 'pendientes' ? 'Pendientes de Cobro' : 
                  drilldownType === 'nominativos' ? 'Nominativos' :
                  drilldownType === 'globales' ? 'Globales' : 
                  drilldownType === 'individuales' ? 'Individuales' :
                  drilldownType === 'descuentos' ? 'Descuentos y Bonificaciones' :
                  'Notas de Crédito'
                }
              </DialogTitle>
              <div className="text-sm text-muted-foreground mt-2 space-y-1">
                <p><strong>Resumen de consulta:</strong></p>
                <ul className="list-disc list-inside pl-4">
                  <li>Empresa: {metrics?.company?.rfc || selectedCompany?.rfc || 'N/A'}</li>
                  <li>Fecha: {drilldownStats.startDate} - {drilldownStats.endDate}</li>
                  {drilldownType === 'cobrados' ? (
                    <>
                      <li>Facturas de Contado (PUE): {formatMXN(drilldownStats.totalPUE)}</li>
                      <li>Complementos de Pago (CRP): {formatMXN(drilldownStats.totalCRP)}</li>
                    </>
                  ) : drilldownType === 'pendientes' ? (
                    <>
                      <li>Facturas a Crédito (PPD): {formatMXN(drilldownStats.totalPUE)}</li>
                      <li>Complementos de Pago (CRP): <span className="text-destructive">{formatMXN(drilldownStats.totalCRP)}</span></li>
                      <li>Notas de Crédito (Ajuste): <span className="text-destructive">{formatMXN(drilldownStats.totalNC)}</span></li>
                    </>
                  ) : drilldownType === 'nominativos' ? (
                    <>
                      <li>Total Ingresos Nominativos: {formatMXN(drilldownStats.totalNominativos)}</li>
                    </>
                  ) : drilldownType === 'globales' ? (
                    <>
                      <li>Total Ingresos Globales: {formatMXN(drilldownStats.totalGlobales)}</li>
                    </>
                  ) : drilldownType === 'individuales' ? (
                    <>
                      <li>Total Ingresos Individuales: {formatMXN(drilldownStats.totalIndividuales)}</li>
                    </>
                  ) : drilldownType === 'descuentos' ? (
                    <>
                      <li>Total Descuentos y Bonificaciones: {formatMXN(drilldownStats.totalDescuentos)}</li>
                    </>
                  ) : (
                    <>
                      <li>Total Notas de Crédito: {formatMXN(drilldownStats.totalNotasCredito)}</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
            {!drilldownLoading && drilldownData.length > 0 && (
              <Button onClick={handleExportDrilldown} variant="outline" size="sm" className="shrink-0">
                <Download className="mr-2 h-4 w-4" />
                Exportar Excel (CSV)
              </Button>
            )}
          </DialogHeader>
          
          <div className="flex-1 mt-4 border rounded-md min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
            {drilldownLoading ? (
              <div className="flex justify-center items-center h-32">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : drilldownData.length === 0 ? (
              <div className="flex justify-center items-center h-32 text-muted-foreground">
                No se encontraron comprobantes para el periodo seleccionado.
              </div>
            ) : (
              <Table className="w-full min-w-max">
                  <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="w-[120px]">Fecha</TableHead>
                    <TableHead className="w-[220px]">Tipo</TableHead>
                    <TableHead className="w-[280px]">UUID</TableHead>
                    <TableHead className="w-[120px]">UUID Relacionado</TableHead>
                    <TableHead className="w-[100px]">Serie</TableHead>
                    <TableHead className="w-[150px]">Folio</TableHead>
                    <TableHead className="w-[140px]">RFC</TableHead>
                    <TableHead className="max-w-[400px]">Razón Social</TableHead>
                    <TableHead className="w-[100px]">Moneda</TableHead>
                    <TableHead className="text-right w-[150px]">Importe</TableHead>
                  </TableRow>
                  <TableRow className="bg-muted/50 border-b shadow-sm">
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.fecha || ''} onChange={e => setDrilldownFilters(prev => ({...prev, fecha: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.tipo || ''} onChange={e => setDrilldownFilters(prev => ({...prev, tipo: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={drilldownFilters.uuid || ''} onChange={e => setDrilldownFilters(prev => ({...prev, uuid: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={drilldownFilters.uuidRelacionado || ''} onChange={e => setDrilldownFilters(prev => ({...prev, uuidRelacionado: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.serie || ''} onChange={e => setDrilldownFilters(prev => ({...prev, serie: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.folio || ''} onChange={e => setDrilldownFilters(prev => ({...prev, folio: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.rfc || ''} onChange={e => setDrilldownFilters(prev => ({...prev, rfc: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.razonSocial || ''} onChange={e => setDrilldownFilters(prev => ({...prev, razonSocial: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.moneda || ''} onChange={e => setDrilldownFilters(prev => ({...prev, moneda: e.target.value}))}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-right" value={drilldownFilters.importe || ''} onChange={e => setDrilldownFilters(prev => ({...prev, importe: e.target.value}))}/></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDrilldownData.map((row, idx) => (
                    <TableRow key={`${row.uuid}-${idx}`}>
                      <TableCell className="whitespace-nowrap">{new Date(row.fecha).toLocaleDateString('es-MX')}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.tipo}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-mono">{row.uuid}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs font-mono" title={row.uuidRelacionado || '-'}>{row.uuidRelacionado || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{row.serie || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{row.folio || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.rfc}</TableCell>
                      <TableCell className="max-w-[400px] truncate" title={row.razonSocial}>{row.razonSocial}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.moneda}</TableCell>
                      <TableCell className="text-right font-medium">{formatMXN(row.importe)}</TableCell>
                    </TableRow>
                  ))}
                  {filteredDrilldownData.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                        No se encontraron resultados para tu búsqueda.
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredDrilldownData.length > 0 && (
                    <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                      <TableCell colSpan={9} className="text-right">Total Filtrado</TableCell>
                      <TableCell className="text-right">
                        {formatMXN(filteredDrilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0))}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </ProtectedRoute>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
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
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts'
import { ShoppingCart, FileText, XCircle, CheckCircle, ArrowDown, Search, SlidersHorizontal, Loader2, Download, HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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
    ingresosNetosReales?: number;
    creditNoteAppliedOnPpds?: number;
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
      ivaIngresosNetosReales?: number;
      ivaTrasladado: number;
      ivaRetenido: number;
      isrRetenido: number;
      iepsRetenido: number;
      totalImpuestosRetenidos?: number;
      heavyMetricsEstimated?: boolean;
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
  meta?: {
    heavyMetricsIncluded?: boolean
    heavyMetricsFromSummary?: boolean
    summaryCoverage?: {
      days: number
      totalDays: number
      stale?: boolean
    }
    source?: 'summary' | 'raw'
  }
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

const DRILLDOWN_PAGE_SIZE = 200

const KpiTooltip = ({ description }: { description: string }) => (
  <Tooltip delayDuration={100}>
    <TooltipTrigger asChild>
      <span
        role="img"
        aria-label="Descripción del cálculo"
        className="ml-1.5 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-muted-foreground/30 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        tabIndex={0}
      >
        <HelpCircle className="h-3 w-3" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={6} className="max-w-sm text-left leading-relaxed">
      {description}
    </TooltipContent>
  </Tooltip>
)

// ============================================================
// DASH-SAST-003: escapeCsvSafe contra CSV Formula Injection (CWE-1236).
// Protege celdas que empiecen por = + - @ | \t \r con apostrofe invisible.
// ============================================================
const CSV_DANGEROUS_PREFIX_DF = /^[=+\-@|\t\r]/;
function escapeCsvSafe(value: unknown): string {
  if (value === null || typeof value === 'undefined') return '""';
  let str = String(value);
  if (CSV_DANGEROUS_PREFIX_DF.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes('\t')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================================
// DASH-SAST-006: buildDashboardUrl helper basado en URLSearchParams.
// Elimina concatenaciones manuales de ?companyId=${X} que sufren parameter
// pollution/injection vía '&', '=', '#'.
// ============================================================
function buildDashboardUrl(base: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.append(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export default function DashboardFiscalPage() {
  const [loading, setLoading] = useState(true)
  const [hydratingMetrics, setHydratingMetrics] = useState(false)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [appliedFilters, setAppliedFilters] = useState<{start: string, end: string, origin: string}>({ start: '', end: '', origin: 'issued' })
  const [visibleSections, setVisibleSections] = useState<string[]>(DASHBOARD_SECTIONS.map(s => s.id))

  const selectedCompanyRef = useRef<SelectedCompany | null>(null)
  const fetchNonceRef = useRef(0)

  useEffect(() => {
    selectedCompanyRef.current = selectedCompany
  }, [selectedCompany])
 
  // Drilldown Modal State
  const [drilldownOpen, setDrilldownOpen] = useState(false)
  const [drilldownLoading, setDrilldownLoading] = useState(false)
  const [drilldownData, setDrilldownData] = useState<any[]>([])
  const [drilldownFilters, setDrilldownFilters] = useState<Record<string, string>>({})
  const [drilldownType, setDrilldownType] = useState<'cobrados' | 'pendientes' | 'nominativos' | 'globales' | 'individuales' | 'descuentos' | 'notas_credito'>('cobrados')
  const [drilldownPage, setDrilldownPage] = useState(1)

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

  const filteredDrilldownTotal = useMemo(() => {
    return filteredDrilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0)
  }, [filteredDrilldownData])

  const totalDrilldownPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredDrilldownData.length / DRILLDOWN_PAGE_SIZE))
  }, [filteredDrilldownData])

  const paginatedDrilldownData = useMemo(() => {
    const start = (drilldownPage - 1) * DRILLDOWN_PAGE_SIZE
    return filteredDrilldownData.slice(start, start + DRILLDOWN_PAGE_SIZE)
  }, [filteredDrilldownData, drilldownPage])

  const isInvalidDateRange = useMemo(() => {
    return Boolean(startDate && endDate && startDate > endDate)
  }, [startDate, endDate])

  const hasCompleteDateRange = useMemo(() => {
    return Boolean(startDate && endDate)
  }, [startDate, endDate])

  const hasAppliedDateRange = useMemo(() => {
    return Boolean(appliedFilters.start && appliedFilters.end)
  }, [appliedFilters.end, appliedFilters.start])

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
      totalPUE = filteredDrilldownData.filter(d => d.tipo === 'Factura Contado (PUE)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
      totalCRP = filteredDrilldownData.filter(d => d.tipo === 'Complemento de Pago (CRP)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'pendientes') {
      totalPUE = filteredDrilldownData.filter(d => d.tipo === 'Factura a Crédito (PPD)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
      totalCRP = filteredDrilldownData.filter(d => d.tipo === 'Complemento de Pago (CRP)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
      totalNC = filteredDrilldownData.filter(d => d.tipo === 'Nota de Crédito (Ajuste)').reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0);
    } else if (drilldownType === 'nominativos') {
      totalNominativos = filteredDrilldownTotal;
    } else if (drilldownType === 'globales') {
      totalGlobales = filteredDrilldownTotal;
    } else if (drilldownType === 'individuales') {
      totalIndividuales = filteredDrilldownTotal;
    } else if (drilldownType === 'descuentos') {
      totalDescuentos = filteredDrilldownTotal;
    } else if (drilldownType === 'notas_credito') {
      totalNotasCredito = filteredDrilldownTotal;
    }
    
    const timestamps = filteredDrilldownData.map(d => new Date(d.fecha).getTime()).filter(t => !isNaN(t));
    const minDate = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
    const maxDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

    const startDateStr = appliedFilters.start 
      ? new Date(appliedFilters.start + 'T12:00:00').toLocaleDateString('es-MX') 
      : (minDate ? minDate.toLocaleDateString('es-MX') : 'Desde el inicio');
      
    const endDateStr = appliedFilters.end 
      ? new Date(appliedFilters.end + 'T12:00:00').toLocaleDateString('es-MX') 
      : (maxDate ? maxDate.toLocaleDateString('es-MX') : 'Hasta la fecha');

    return { totalPUE, totalCRP, totalNC, totalNominativos, totalGlobales, totalIndividuales, totalDescuentos, totalNotasCredito, startDate: startDateStr, endDate: endDateStr };
  }, [filteredDrilldownData, filteredDrilldownTotal, appliedFilters, drilldownType]);

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

  const buildZeroMetrics = useCallback((): MetricsResponse => {
    const now = new Date()
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
      return {
        label: `${d.toLocaleString('es-MX', { month: 'short' })} ${d.getFullYear()}`,
        count: 0,
        total: 0
      }
    })
    const company = selectedCompanyRef.current
    const fallbackId = selectedCompanyId || 'unknown'
    return {
      company: {
        id: company?.id || fallbackId,
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

  useEffect(() => {
    const nonce = ++fetchNonceRef.current
    const controller = new AbortController()
    const signal = controller.signal

    const fetchMetrics = async () => {
      if (!selectedCompanyId) {
        if (nonce === fetchNonceRef.current && !signal.aborted) {
          setMetrics(null)
          setLoading(false)
          setHydratingMetrics(false)
        }
        return
      }

      const zeroMetrics = buildZeroMetrics()
      const appliedStart = appliedFilters.start
      const appliedEnd = appliedFilters.end
      const hasRange = Boolean(appliedStart && appliedEnd)

      if (!hasRange) {
        if (nonce === fetchNonceRef.current && !signal.aborted) {
          setMetrics(zeroMetrics)
          setLoading(false)
          setHydratingMetrics(false)
        }
        return
      }

      const url = buildDashboardUrl('/api/dashboard_fiscal', {
        companyId: selectedCompanyId,
        origin: appliedFilters.origin,
        startDate: appliedStart || undefined,
        endDate: appliedEnd || undefined
      })

      try {
        if (nonce === fetchNonceRef.current) {
          setLoading(true)
          setHydratingMetrics(false)
        }

        const lightRes = await fetch(`${url}&includeHeavyMetrics=false`, { cache: 'no-store', signal })
        if (signal.aborted) return
        const lightData = await lightRes.json()
        if (!lightRes.ok) throw new Error(lightData.error || 'Error al cargar métricas')

        const normalizedLight: MetricsResponse = {
          ...(lightData as MetricsResponse),
          byType: (lightData.byType && lightData.byType.length) ? lightData.byType : zeroMetrics.byType,
          bySatStatus: (lightData.bySatStatus && lightData.bySatStatus.length) ? lightData.bySatStatus : zeroMetrics.bySatStatus,
          paymentMethods: lightData.paymentMethods || [],
          monthly: (lightData.monthly && lightData.monthly.length) ? lightData.monthly : zeroMetrics.monthly
        }

        if (signal.aborted || nonce !== fetchNonceRef.current) return

        setMetrics(normalizedLight)
        setLoading(false)
        setHydratingMetrics(true)

        try {
          const fullRes = await fetch(url, { cache: 'no-store', signal })
          if (signal.aborted) return
          const fullData = await fullRes.json()
          if (!fullRes.ok) {
            throw new Error(fullData.error || 'Error al actualizar métricas detalladas')
          }

          const normalizedFull: MetricsResponse = {
            ...(fullData as MetricsResponse),
            byType: (fullData.byType && fullData.byType.length) ? fullData.byType : zeroMetrics.byType,
            bySatStatus: (fullData.bySatStatus && fullData.bySatStatus.length) ? fullData.bySatStatus : zeroMetrics.bySatStatus,
            paymentMethods: fullData.paymentMethods || [],
            monthly: (fullData.monthly && fullData.monthly.length) ? fullData.monthly : zeroMetrics.monthly
          }

          if (signal.aborted || nonce !== fetchNonceRef.current) return

          setMetrics(normalizedFull)
        } catch (err) {
          if (!signal.aborted && nonce === fetchNonceRef.current) {
            console.error('No fue posible hidratar métricas detalladas del dashboard fiscal', err)
          }
        } finally {
          if (!signal.aborted && nonce === fetchNonceRef.current) {
            setHydratingMetrics(false)
          }
        }
      } catch (err) {
        if (!signal.aborted && nonce === fetchNonceRef.current) {
          showError('Error', err instanceof Error ? err.message : 'Error desconocido')
          setMetrics(zeroMetrics)
          setLoading(false)
          setHydratingMetrics(false)
        }
      }
    }

    fetchMetrics()
    return () => {
      controller.abort()
    }
  }, [selectedCompanyId, appliedFilters.start, appliedFilters.end, appliedFilters.origin, buildZeroMetrics])

  const handleFilter = () => {
    if (!startDate || !endDate) {
      showError('Periodo requerido', 'Selecciona Fecha Inicio y Fecha Fin antes de consultar')
      return
    }

    if (isInvalidDateRange) {
      showError('Rango de fechas inválido', 'La fecha de inicio no puede ser mayor que la fecha final')
      return
    }

    setAppliedFilters({ start: startDate, end: endDate, origin: 'issued' })
  }

  const handleOpenDrilldown = async (type: 'cobrados' | 'pendientes' | 'nominativos' | 'globales' | 'individuales' | 'descuentos' | 'notas_credito') => {
    if (!selectedCompanyId) return
    setDrilldownType(type)
    setDrilldownOpen(true)
    setDrilldownLoading(true)
    setDrilldownData([])
    setDrilldownFilters({})
    setDrilldownPage(1)
    try {
      let endpoint = 'ingresos_cobrados'
      if (type === 'pendientes') endpoint = 'ingresos_pendientes'
      if (type === 'nominativos') endpoint = 'ingresos_nominativos'
      if (type === 'globales') endpoint = 'ingresos_globales'
      if (type === 'individuales') endpoint = 'ingresos_individuales'
      if (type === 'descuentos') endpoint = 'descuentos_bonificaciones'
      if (type === 'notas_credito') endpoint = 'notas_credito'
      
      const url = buildDashboardUrl(`/api/dashboard_fiscal/drilldown/${endpoint}`, {
        companyId: selectedCompanyId,
        origin: appliedFilters.origin,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })
      
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

  const handleDrilldownOpenChange = (open: boolean) => {
    setDrilldownOpen(open)

    if (!open) {
      setDrilldownLoading(false)
      setDrilldownFilters({})
      setDrilldownData([])
      setDrilldownPage(1)
    }
  }

  const updateDrilldownFilter = (key: string, value: string) => {
    setDrilldownPage(1)
    setDrilldownFilters(prev => ({ ...prev, [key]: value }))
  }

  const handleExportDrilldown = () => {
    if (!filteredDrilldownData || filteredDrilldownData.length === 0) return

    // Generate CSV content
    const headers = ["Fecha", "Tipo", "UUID", "UUID Relacionado", "Serie", "Folio", "RFC", "Razón Social", "Moneda", "Tipo Cambio", "Importe"]
    
    // (Función escapeCsv ELIMINADA. Reemplazada por escapeCsvSafe arriba
    // que protege contra CSV Formula Injection — DASH-SAST-003 FIX.)

    const rows = filteredDrilldownData.map(row => [
      escapeCsvSafe(new Date(row.fecha).toLocaleDateString('es-MX')),
      escapeCsvSafe(row.tipo),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.uuidRelacionado),
      escapeCsvSafe(row.serie),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.rfc),
      escapeCsvSafe(row.razonSocial),
      escapeCsvSafe(row.moneda),
      escapeCsvSafe(row.tipoCambio),
      escapeCsvSafe(row.importe)
    ])

    const total = filteredDrilldownData.reduce((acc, curr) => acc + (Number(curr.importe) || 0), 0)
    rows.push(['', '', '', '', '', '', '', 'Total', '', '', escapeCsvSafe(total)])

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

  const summaryStale = Boolean(metrics?.meta?.summaryCoverage?.stale)
  const heavyIsEstimated = Boolean(metrics?.kpis?.taxes?.heavyMetricsEstimated) && !Boolean(metrics?.meta?.heavyMetricsIncluded)
  const summaryLabel =
    metrics?.meta?.summaryCoverage ? `${metrics.meta.summaryCoverage.days}/${metrics.meta.summaryCoverage.totalDays} días cubiertos` : null
  const heavyLabel = heavyIsEstimated ? 'Cálculo rápido basado en resumen' : null

  // Effective Income
  const ingresosCobradosPue = Number(metrics?.kpis?.ingresosCobradosPue ?? 0)
  const ingresosCobradosCrp = Number(metrics?.kpis?.ingresosCobradosCrp ?? 0)
  const rawIngresosCobradosTotal = Number(metrics?.kpis?.ingresosCobradosTotal ?? 0)
  const ingresosCobradosTotal = rawIngresosCobradosTotal > 0
    ? rawIngresosCobradosTotal
    : (ingresosCobradosPue + ingresosCobradosCrp)
  const ingresosPendientesCobro = Number(metrics?.kpis?.ingresosPendientesCobro ?? 0)
  const ivaPendienteCobro = Number(metrics?.kpis?.ivaPendienteCobro ?? 0)
  const rawIngresosNetosReales = metrics?.kpis?.ingresosNetosReales
  const ingresosNetosReales = typeof rawIngresosNetosReales === 'number'
    ? rawIngresosNetosReales
    : balance

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
    <TooltipProvider delayDuration={100}>
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Tablero de ingresos</h2>
            {hydratingMetrics && (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Actualizando metricas detalladas...
              </div>
            )}
            {summaryLabel && (
              <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${summaryStale ? 'text-amber-600' : 'text-muted-foreground'}`}>
                <span>{summaryStale ? `Resumen incompleto (${summaryLabel}). Reconstruyendo en segundo plano.` : `Resumen diario OK · ${summaryLabel}`}</span>
                {heavyLabel ? <span>· {heavyLabel}</span> : null}
              </div>
            )}
          </div>
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
              max={endDate || undefined}
              aria-invalid={isInvalidDateRange}
              onChange={(e) => setStartDate(e.target.value)} 
            />
          </div>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="endDate">Fecha Fin</Label>
            <Input 
              type="date" 
              id="endDate" 
              value={endDate} 
              min={startDate || undefined}
              aria-invalid={isInvalidDateRange}
              onChange={(e) => setEndDate(e.target.value)} 
            />
          </div>
          <div className="pb-0.5 flex gap-2">
            <Button onClick={handleFilter} disabled={isInvalidDateRange || !hasCompleteDateRange}>
              <Search className="mr-2 h-4 w-4" />
              Filtrar
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStartDate('')
                setEndDate('')
                setAppliedFilters({ start: '', end: '', origin: 'issued' })
              }}
              disabled={!startDate && !endDate && !hasAppliedDateRange}
            >
              Limpiar
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
        {isInvalidDateRange && (
          <p className="text-sm text-destructive -mt-2">
            La fecha de inicio no puede ser mayor que la fecha final.
          </p>
        )}
        {!isInvalidDateRange && !hasAppliedDateRange && (
          <p className="text-sm text-muted-foreground -mt-2">
            Selecciona un periodo con Fecha Inicio y Fecha Fin para consultar los KPIs y graficas del dashboard.
          </p>
        )}

        {/* Top KPIs Row */}
        {visibleSections.includes('kpis') && (
        <div className={`grid gap-4 md:grid-cols-2 ${cancelacionesEgresos > 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-blue-600/10 p-2 text-center border-b border-border">
              <h3 className="text-blue-500 font-bold text-lg">CFDI de Ingresos<KpiTooltip description="Cuenta y suma el atributo `Total` de todos los CFDI tipo `I (INGRESO)` con estatus SAT `VIGENTE`, cuya fecha de emisión (campo `Fecha` del XML) se encuentra dentro del rango seleccionado." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <ShoppingCart className="h-12 w-12 text-blue-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ventas)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-red-500/10 p-2 text-center border-b border-border">
              <h3 className="text-red-500 font-bold text-lg">Cancelaciones de Ingresos<KpiTooltip description="Cuenta y suma el atributo `Total` de todos los CFDI tipo `I (INGRESO)` con estatus SAT `CANCELADO`, cuya fecha de emisión se encuentra dentro del rango seleccionado. No incluye egresos cancelados." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <XCircle className="h-12 w-12 text-red-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(cancelaciones)}</div>
            </CardContent>
          </Card>

          {cancelacionesEgresos > 0 && (
          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-rose-500/10 p-2 text-center border-b border-border">
              <h3 className="text-rose-500 font-bold text-lg">Cancelaciones de Egresos<KpiTooltip description="Suma del atributo `Total` de CFDI tipo `E (EGRESO)` con estatus SAT `CANCELADO` en el periodo. Indica qué notas de crédito fueron canceladas y por tanto ya no reducen los ingresos brutos." /></h3>
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
              <h3 className="text-purple-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Nominativos<KpiTooltip description="Facturas a clientes con RFC válido (no Público en General). Se excluyen RFC genéricos `XAXX010101000` y `XEXX010101000`, así como operaciones marcadas como Global del complemento." /></h3>
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
              <h3 className="text-indigo-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Globales<br/>(Público en General)<KpiTooltip description="Ventas en efectivo o transferencia de bajo monto al Público en General agrupadas en un solo CFDI. Se detectan por RFC público en general o por la bandera `Global=true` en los atributos del XML." /></h3>
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
              <h3 className="text-pink-500 font-bold text-sm md:text-base leading-tight min-h-[20px] flex items-center justify-center">Ingresos Individuales<br/>(Público en General)<KpiTooltip description="Ventas individuales al Público en General (una por operación) o PPD con RFC genérico. Complementan a las Globales cuando no se agrupa el corte diario." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-pink-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(operacionesIndividuales)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-emerald-600/10 p-2 text-center border-b border-border">
              <h3 className="text-emerald-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Brutos<KpiTooltip description="Suma del atributo `SubTotal` (antes del nodo Descuento) de los 3 tipos de ingreso vigentes: Nominativos + Globales + Individuales. Base antes de notas de crédito y descuentos condicionados." /></h3>
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
              <h3 className="text-yellow-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Descuentos y<br/>Bonificaciones<KpiTooltip description="Suma del atributo `Descuento` del nodo principal Comprobante en CFDI tipo I vigentes. No incluye Notas de Crédito; sólo rebajas aplicadas dentro del mismo comprobante." /></h3>
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
              <h3 className="text-orange-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Notas de Crédito<KpiTooltip description="CFDI tipo `E (EGRESO)` VIGENTES que tienen como CFDIRelacionado algún CFDI tipo I dentro de la empresa. Suma el `Total` de la nota para reducir el ingreso neto." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-orange-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(notasCredito)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card">
            <div className="bg-green-600/10 p-2 text-center border-b border-border">
              <h3 className="text-green-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos netos reales<KpiTooltip description="Fórmula: (Nominativos + Globales + Individuales) - Descuentos - Notas de Crédito vigentes. Equivale a los ingresos declarables netos antes de impuestos." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <div className="text-2xl font-bold text-green-500">{formatMXN(ingresosNetosReales)}</div>
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
              <h3 className="text-teal-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Cobrados<br/>(Flujo Total)<KpiTooltip description="Suma de: 1) Facturas tipo I con MetodoPago=PUE (pago en una sola exhibición) VIGENTES, 2) Nodos DoctoRelacionado de complementos de Pago (CFDI tipo P) vigentes. Flujo de caja REAL entrante." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-teal-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ingresosCobradosTotal)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card h-full">
            <div className="bg-blue-600/10 p-2 text-center border-b border-border">
              <h3 className="text-blue-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">IVA Trasladado Cobrado<KpiTooltip description="Suma del traslado de IVA (Impuesto=002) cobrado vía: PUE (100% del traslado) + Pagos Parciales (proporción pagada / importe original). Equivale al IVA de las declaraciones mensuales." /></h3>
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
              <h3 className="text-rose-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Ingresos Pendientes de Cobro<KpiTooltip description="Fórmula: Total Facturas tipo I PPD VIGENTES - Suma de Pagos (CRP/REP) aplicados a esas facturas - Notas de Crédito relacionadas. Saldo insoluto real al cierre del periodo." /></h3>
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
              <h3 className="text-emerald-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Impuesto Trasladado IVA<KpiTooltip description="Suma pura del atributo `Importe` en el nodo Traslados con Impuesto='002' (IVA) para todos los CFDI de INGRESO VIGENTES, sumando todas las tasas (exento 0%, 8%, 16%)." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-emerald-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(impTrasladoIVA)}</div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border bg-card h-full">
            <div className="bg-blue-600/10 p-2 text-center border-b border-border">
              <h3 className="text-blue-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">IVA Cobrado Total<KpiTooltip description="IVA efectivamente recibido: IVA de PUE + IVA cobrado en parcialidades pagadas. Métrica base para la declaración informativa y la declaración mensual de IVA." /></h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-blue-500" />
              <div className="text-2xl font-bold text-foreground">{formatMXN(ivaCobradoTotal)}</div>
            </CardContent>
          </Card>

          {/*
          <Card className="overflow-hidden border border-border bg-card h-full flex flex-col">
            <div className="bg-purple-600/10 p-2 text-center border-b border-border">
              <h3 className="text-purple-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">IVA Acreditable<br/>(Gastos y Compras)<KpiTooltip description="Estimado de IVA por recuperar en compras/egresos del periodo (vista básica en Dashboard Fiscal). El detalle completo y conciliación por comprobante está en Dashboard Recibidos (Egresos)." /></h3>
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
              <h3 className="text-indigo-500 font-bold text-sm md:text-base leading-tight min-h-[40px] flex items-center justify-center">Impuestos Retenidos<KpiTooltip description="Suma de todos los nodos Retenciones en INGRESO VIGENTE: ISR (001) + IVA Retenido (002) + IEPS (003). Total de impuestos retenidos por el cliente a cargo del emisor para declarar al SAT." /></h3>
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
                  <RechartsTooltip formatter={(value: any, name: any) => (name === 'Monto' || name === 'total') ? formatMXN(Number(value)) : value} />
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
                        <RechartsTooltip formatter={(value) => [Number(value || 0), '']} />
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
                    <RechartsTooltip 
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
                    <RechartsTooltip 
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
                    <RechartsTooltip 
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
                    <RechartsTooltip 
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

      <Dialog open={drilldownOpen} onOpenChange={handleDrilldownOpenChange}>
        {drilldownOpen && (
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
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.fecha || ''} onChange={e => updateDrilldownFilter('fecha', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.tipo || ''} onChange={e => updateDrilldownFilter('tipo', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={drilldownFilters.uuid || ''} onChange={e => updateDrilldownFilter('uuid', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={drilldownFilters.uuidRelacionado || ''} onChange={e => updateDrilldownFilter('uuidRelacionado', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.serie || ''} onChange={e => updateDrilldownFilter('serie', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.folio || ''} onChange={e => updateDrilldownFilter('folio', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.rfc || ''} onChange={e => updateDrilldownFilter('rfc', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.razonSocial || ''} onChange={e => updateDrilldownFilter('razonSocial', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={drilldownFilters.moneda || ''} onChange={e => updateDrilldownFilter('moneda', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-right" value={drilldownFilters.importe || ''} onChange={e => updateDrilldownFilter('importe', e.target.value)}/></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDrilldownData.map((row, idx) => (
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
                        {formatMXN(filteredDrilldownTotal)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
          {!drilldownLoading && filteredDrilldownData.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground shrink-0">
              <div>
                Mostrando {((drilldownPage - 1) * DRILLDOWN_PAGE_SIZE) + 1}-{Math.min(drilldownPage * DRILLDOWN_PAGE_SIZE, filteredDrilldownData.length)} de {filteredDrilldownData.length} registros filtrados
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={drilldownPage <= 1}
                  onClick={() => setDrilldownPage(current => Math.max(1, current - 1))}
                >
                  Anterior
                </Button>
                <span>Página {drilldownPage} de {totalDrilldownPages}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={drilldownPage >= totalDrilldownPages}
                  onClick={() => setDrilldownPage(current => Math.min(totalDrilldownPages, current + 1))}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
        )}
      </Dialog>

    </ProtectedRoute>
    </TooltipProvider>
  )
}

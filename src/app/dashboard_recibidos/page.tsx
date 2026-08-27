/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { DashboardSkeleton } from '@/components/loading/skeletons'
import { showError } from '@/lib/toast'
import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend
} from 'recharts'
import { AlertTriangle, ArrowDown, CheckCircle, Download, FileText, HelpCircle, Search, ShieldCheck, ShoppingCart, SlidersHorizontal, XCircle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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
  expensePeriodSummary: {
    grossCommercialExpense: number
    creditNotesSubtotal: number
    netExpensesTotal: number
  }
  taxPeriodSummary: {
    ivaAccreditableTotal: number
    ivaAccreditableBreakdown: Array<{
      rate: string
      label: string
      amount: number
    }>
    retainedTaxesTotal: number
    retainedIsrTotal: number
    retainedIvaTotal: number
  }
  paymentBalancePeriodSummary: {
    totalPaidInPeriod: number
    outstandingBalanceTotal: number
    agingOutstandingTotal: number
    agingBreakdown: Array<{
      bucket: string
      amount: number
      count: number
    }>
  }
  fiscalAudit: {
    efosRiskAmount: number
    efosSupplierCount: number
    efosCfdiCount: number
    last69BSyncAt: string | null
    postLoadCancellationCount: number
    postLoadCancellationAmount: number
    postLoadCancellationSupplierCount: number
  }
  businessRules: {
    paymentMethodPueForma99Count: number
    paymentMethodPueForma99Amount: number
    paymentMethodPueForma99SupplierCount: number
    resicoRetentionCount: number
    resicoRetentionAmount: number
    resicoRetentionSupplierCount: number
    objetoImpVsIvaCount: number
    objetoImpVsIvaAmount: number
    objetoImpVsIvaSupplierCount: number
  }
  byType: Array<{ type: string; count: number; total: number }>
  bySatStatus: Array<{ status: string; count: number }>
  monthly: Array<{ label: string; count: number; total: number }>
  topSuppliers: Array<{ rfc: string | null; name: string | null; total: number }>
  topClients: Array<{ rfc: string | null; name: string | null; total: number }>
  paymentMethods: Array<{ method: string | null; count: number; total?: number }>
}

type SelectedCompany = {
  id: string
  rfc?: string
  businessName?: string
  name?: string
  moduleFlags?: {
    canViewReception?: boolean
    granularPermissions?: Record<string, boolean>
  } | null
}

type EfosRiskDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  total: number
  satEstado: string
  efosStatusLabel: string
  efosStatusBucket: string
}

type PostLoadCancellationDrilldownRow = {
  detectedAt: string | null
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  total: number
  satInitialEstado: string
  satEstado: string
  satEstatusCancelacion: string
  satEsCancelable: string
}

type PaymentMethodVsPaymentFormDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  paymentMethod: string
  paymentForm: string
  total: number
}

type ResicoRetentionDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  issuerFiscalRegime: string
  hasResicoIsrRetention: boolean
  total: number
}

type ObjetoImpTaxDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  inconsistencyReason: string
  total: number
}

type IvaAccreditableDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  total: number
  rate: string
  rateLabel: string
  taxAmount: number
}

type RetainedTaxDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  total: number
  taxCode: string
  taxLabel: string
  taxAmount: number
}

type PaidInPeriodDrilldownRow = {
  paymentDate: string | null
  invoiceUuid: string
  paymentUuid: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  series: string
  folio: string
  paymentMethod: string
  paymentSource: 'PUE' | 'REP'
  partialityNumber: number
  amountPaid: number
  previousBalance: number
  outstandingBalance: number
  currency: string
}

type OutstandingBalanceDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  issuanceDate: string | null
  paymentMethod: string
  currency: string
  total: number
  totalPaid: number
  outstandingBalance: number
}

type AgingBalanceDrilldownRow = OutstandingBalanceDrilldownRow & {
  ageDays: number
  ageBucket: string
}

const DASHBOARD_SECTIONS = [
  { id: 'expense_period_summary', label: 'Resumen de Egresos' },
  { id: 'tax_period_summary', label: 'Resumen de Impuestos' },
  { id: 'payment_balance_period_summary', label: 'Resumen de Pagos y Saldos' },
  { id: 'fiscal_audit', label: 'Auditoría Fiscal y Riesgos' },
  { id: 'business_rules', label: 'Coherencia y Reglas' },
  { id: 'monthly_chart', label: 'CFDI por Mes' },
  { id: 'payment_methods', label: 'Métodos de Pago' },
  { id: 'top_suppliers', label: 'Top Proveedores' },
] as const

const PAYMENT_METHOD_COLORS = ['#63b3ed', '#68d391', '#f6ad55', '#fc8181', '#a78bfa', '#2dd4bf']

const formatMXN = (value: number) => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2
}).format(Number(value || 0))

const formatObjetoImpReason = (value: string) => {
  switch ((value || '').trim()) {
    case 'OBJETOIMP_02_SIN_IVA_TRASLADADO':
      return 'ObjetoImp=02 sin traslado IVA desglosado'
    case 'OBJETOIMP_01_03_CON_IVA_TRASLADADO':
      return 'ObjetoImp=01/03 con traslado IVA presente'
    case 'OBJETOIMP_02_SIN_IVA_TRASLADADO; OBJETOIMP_01_03_CON_IVA_TRASLADADO':
    case 'OBJETOIMP_02_SIN_IVA_TRASLADADO;OBJETOIMP_01_03_CON_IVA_TRASLADADO':
      return 'Se detectaron ambos tipos de inconsistencia fiscal'
    default:
      return value || 'Inconsistencia detectada'
  }
}

const createDrilldownOpenChange = (
  setOpen: (open: boolean) => void,
  setLoading: (loading: boolean) => void,
  setRows: (rows: any[]) => void,
  setFilters: (filters: Record<string, string>) => void
) => (open: boolean) => {
  setOpen(open)

  if (!open) {
    setLoading(false)
    setFilters({})
    setRows([])
  }
}

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
// DASH-SAST-003: escapeCsvSafe protege contra CSV Formula Injection
// Prefijos DANGER =  = + - @ | \t \r  → apostrofe invisible previene DDE/DDE.
// ============================================================
const CSV_DANGEROUS_PREFIX_DR = /^[=+\-@|\t\r]/;
function escapeCsvSafe(value: unknown): string {
  if (value === null || typeof value === 'undefined') return '""';
  let str = String(value);
  if (CSV_DANGEROUS_PREFIX_DR.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes('\t')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================================
// DASH-SAST-006: buildDashboardUrl segura via URLSearchParams.
// Evita parameter injection/pollution al NO usar template literals ?x=${y}.
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

export default function DashboardRecibidosPage() {
  const [loading, setLoading] = useState(true)
  const [hydratingMetrics, setHydratingMetrics] = useState(false)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [appliedFilters, setAppliedFilters] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [visibleSections, setVisibleSections] = useState<string[]>(DASHBOARD_SECTIONS.map(section => section.id))
  const [efosDialogOpen, setEfosDialogOpen] = useState(false)
  const [efosDialogLoading, setEfosDialogLoading] = useState(false)
  const [efosRiskRows, setEfosRiskRows] = useState<EfosRiskDrilldownRow[]>([])
  const [efosRiskFilters, setEfosRiskFilters] = useState<Record<string, string>>({})
  const [postLoadCancellationDialogOpen, setPostLoadCancellationDialogOpen] = useState(false)
  const [postLoadCancellationDialogLoading, setPostLoadCancellationDialogLoading] = useState(false)
  const [postLoadCancellationRows, setPostLoadCancellationRows] = useState<PostLoadCancellationDrilldownRow[]>([])
  const [postLoadCancellationFilters, setPostLoadCancellationFilters] = useState<Record<string, string>>({})
  const [paymentMethodVsPaymentFormDialogOpen, setPaymentMethodVsPaymentFormDialogOpen] = useState(false)
  const [paymentMethodVsPaymentFormDialogLoading, setPaymentMethodVsPaymentFormDialogLoading] = useState(false)
  const [paymentMethodVsPaymentFormRows, setPaymentMethodVsPaymentFormRows] = useState<PaymentMethodVsPaymentFormDrilldownRow[]>([])
  const [paymentMethodVsPaymentFormFilters, setPaymentMethodVsPaymentFormFilters] = useState<Record<string, string>>({})
  const [resicoRetentionDialogOpen, setResicoRetentionDialogOpen] = useState(false)
  const [resicoRetentionDialogLoading, setResicoRetentionDialogLoading] = useState(false)
  const [resicoRetentionRows, setResicoRetentionRows] = useState<ResicoRetentionDrilldownRow[]>([])
  const [resicoRetentionFilters, setResicoRetentionFilters] = useState<Record<string, string>>({})
  const [objetoImpTaxDialogOpen, setObjetoImpTaxDialogOpen] = useState(false)
  const [objetoImpTaxDialogLoading, setObjetoImpTaxDialogLoading] = useState(false)
  const [objetoImpTaxRows, setObjetoImpTaxRows] = useState<ObjetoImpTaxDrilldownRow[]>([])
  const [objetoImpTaxFilters, setObjetoImpTaxFilters] = useState<Record<string, string>>({})
  const [ivaAccreditableDialogOpen, setIvaAccreditableDialogOpen] = useState(false)
  const [ivaAccreditableDialogLoading, setIvaAccreditableDialogLoading] = useState(false)
  const [ivaAccreditableRows, setIvaAccreditableRows] = useState<IvaAccreditableDrilldownRow[]>([])
  const [ivaAccreditableFilters, setIvaAccreditableFilters] = useState<Record<string, string>>({})
  const [retainedTaxesDialogOpen, setRetainedTaxesDialogOpen] = useState(false)
  const [retainedTaxesDialogLoading, setRetainedTaxesDialogLoading] = useState(false)
  const [retainedTaxesRows, setRetainedTaxesRows] = useState<RetainedTaxDrilldownRow[]>([])
  const [retainedTaxesFilters, setRetainedTaxesFilters] = useState<Record<string, string>>({})
  const [paidInPeriodDialogOpen, setPaidInPeriodDialogOpen] = useState(false)
  const [paidInPeriodDialogLoading, setPaidInPeriodDialogLoading] = useState(false)
  const [paidInPeriodRows, setPaidInPeriodRows] = useState<PaidInPeriodDrilldownRow[]>([])
  const [paidInPeriodFilters, setPaidInPeriodFilters] = useState<Record<string, string>>({})
  const [outstandingBalanceDialogOpen, setOutstandingBalanceDialogOpen] = useState(false)
  const [outstandingBalanceDialogLoading, setOutstandingBalanceDialogLoading] = useState(false)
  const [outstandingBalanceRows, setOutstandingBalanceRows] = useState<OutstandingBalanceDrilldownRow[]>([])
  const [outstandingBalanceFilters, setOutstandingBalanceFilters] = useState<Record<string, string>>({})
  const [agingBalanceDialogOpen, setAgingBalanceDialogOpen] = useState(false)
  const [agingBalanceDialogLoading, setAgingBalanceDialogLoading] = useState(false)
  const [agingBalanceRows, setAgingBalanceRows] = useState<AgingBalanceDrilldownRow[]>([])
  const [agingBalanceFilters, setAgingBalanceFilters] = useState<Record<string, string>>({})
  const canViewReceptionFiscalAudit = selectedCompany?.moduleFlags?.canViewReception !== false
    && selectedCompany?.moduleFlags?.granularPermissions?.receptionFiscalAudit !== false
  const canViewReceptionCancellationAlerts = canViewReceptionFiscalAudit
    && selectedCompany?.moduleFlags?.granularPermissions?.receptionCancellationAlerts !== false
  const canViewReceptionBusinessRules = selectedCompany?.moduleFlags?.canViewReception !== false
    && selectedCompany?.moduleFlags?.granularPermissions?.receptionBusinessRules !== false
  const canViewReceptionBusinessRulePueForma99 = canViewReceptionBusinessRules
    && selectedCompany?.moduleFlags?.granularPermissions?.receptionBusinessRulePueForma99 !== false
  const canViewReceptionBusinessRuleResicoRetention = canViewReceptionBusinessRules
    && selectedCompany?.moduleFlags?.granularPermissions?.receptionBusinessRuleResicoRetention !== false
  const canViewReceptionBusinessRuleObjetoImpVsIva = canViewReceptionBusinessRules
    && selectedCompany?.moduleFlags?.granularPermissions?.receptionBusinessRuleObjetoImpVsIva !== false
  const dashboardSections = useMemo(
    () => DASHBOARD_SECTIONS.filter(section => {
      if (section.id === 'fiscal_audit') {
        return canViewReceptionFiscalAudit
      }

      if (section.id === 'business_rules') {
        return canViewReceptionBusinessRules
      }

      return true
    }),
    [canViewReceptionBusinessRules, canViewReceptionFiscalAudit]
  )

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
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1)

      return {
        label: `${date.toLocaleString('es-MX', { month: 'short' })} ${date.getFullYear()}`,
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
      expensePeriodSummary: {
        grossCommercialExpense: 0,
        creditNotesSubtotal: 0,
        netExpensesTotal: 0
      },
      taxPeriodSummary: {
        ivaAccreditableTotal: 0,
        ivaAccreditableBreakdown: [],
        retainedTaxesTotal: 0,
        retainedIsrTotal: 0,
        retainedIvaTotal: 0
      },
      paymentBalancePeriodSummary: {
        totalPaidInPeriod: 0,
        outstandingBalanceTotal: 0,
        agingOutstandingTotal: 0,
        agingBreakdown: []
      },
      fiscalAudit: {
        efosRiskAmount: 0,
        efosSupplierCount: 0,
        efosCfdiCount: 0,
        last69BSyncAt: null,
        postLoadCancellationCount: 0,
        postLoadCancellationAmount: 0,
        postLoadCancellationSupplierCount: 0
      },
      businessRules: {
        paymentMethodPueForma99Count: 0,
        paymentMethodPueForma99Amount: 0,
        paymentMethodPueForma99SupplierCount: 0,
        resicoRetentionCount: 0,
        resicoRetentionAmount: 0,
        resicoRetentionSupplierCount: 0,
        objetoImpVsIvaCount: 0,
        objetoImpVsIvaAmount: 0,
        objetoImpVsIvaSupplierCount: 0
      },
      byType: [
        { type: 'INGRESO', count: 0, total: 0 },
        { type: 'EGRESO', count: 0, total: 0 },
        { type: 'TRASLADO', count: 0, total: 0 },
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

  const zeroMetrics = useMemo(() => buildZeroMetrics(selectedCompany), [buildZeroMetrics, selectedCompany])

  const isInvalidDateRange = useMemo(() => {
    return Boolean(startDate && endDate && startDate > endDate)
  }, [endDate, startDate])

  const hasCompleteDateRange = useMemo(() => {
    return Boolean(startDate && endDate)
  }, [endDate, startDate])

  const hasAppliedDateRange = useMemo(() => {
    return Boolean(appliedFilters.start && appliedFilters.end)
  }, [appliedFilters.end, appliedFilters.start])

  const normalizeMetrics = useCallback((data: MetricsResponse): MetricsResponse => ({
    ...data,
    byType: data.byType?.length ? data.byType : zeroMetrics.byType,
    bySatStatus: data.bySatStatus?.length ? data.bySatStatus : zeroMetrics.bySatStatus,
    paymentMethods: data.paymentMethods || [],
    monthly: data.monthly?.length ? data.monthly : zeroMetrics.monthly,
    topSuppliers: data.topSuppliers || [],
    topClients: data.topClients || [],
    expensePeriodSummary: data.expensePeriodSummary || zeroMetrics.expensePeriodSummary,
    taxPeriodSummary: data.taxPeriodSummary || zeroMetrics.taxPeriodSummary,
    paymentBalancePeriodSummary: data.paymentBalancePeriodSummary || zeroMetrics.paymentBalancePeriodSummary,
    fiscalAudit: data.fiscalAudit || zeroMetrics.fiscalAudit,
    businessRules: data.businessRules || zeroMetrics.businessRules
  }), [zeroMetrics])

  useEffect(() => {
    let cancelled = false

    const fetchMetrics = async () => {
      if (!selectedCompanyId) {
        if (!cancelled) {
          setMetrics(null)
          setLoading(false)
          setHydratingMetrics(false)
        }
        return
      }

      if (!hasAppliedDateRange) {
        if (!cancelled) {
          setMetrics(zeroMetrics)
          setLoading(false)
          setHydratingMetrics(false)
        }
        return
      }

      const url = buildDashboardUrl('/api/dashboard_recibidos', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      try {
        setLoading(true)
        setHydratingMetrics(false)

        const lightResponse = await fetch(`${url}&includeHeavyMetrics=false`, { cache: 'no-store' })
        const lightData = await lightResponse.json()
        if (!lightResponse.ok) throw new Error(lightData.error || 'Error al cargar métricas')

        if (cancelled) return

        setMetrics(normalizeMetrics(lightData as MetricsResponse))
        setLoading(false)
        setHydratingMetrics(true)

        try {
          const fullResponse = await fetch(url, { cache: 'no-store' })
          const fullData = await fullResponse.json()
          if (!fullResponse.ok) throw new Error(fullData.error || 'Error al actualizar métricas detalladas')

          if (cancelled) return

          setMetrics(normalizeMetrics(fullData as MetricsResponse))
        } catch (error) {
          if (!cancelled) {
            console.error('No fue posible hidratar métricas detalladas del dashboard de recibidos', error)
          }
        } finally {
          if (!cancelled) {
            setHydratingMetrics(false)
          }
        }
      } catch (error) {
        if (!cancelled) {
          showError('Error', error instanceof Error ? error.message : 'Error desconocido')
          setMetrics(zeroMetrics)
          setLoading(false)
          setHydratingMetrics(false)
        }
      }
    }

    void fetchMetrics()

    return () => {
      cancelled = true
    }
  }, [appliedFilters.end, appliedFilters.start, hasAppliedDateRange, normalizeMetrics, selectedCompanyId, zeroMetrics])

  const topSuppliersData = useMemo(() => {
    return (metrics?.topSuppliers || []).slice(0, 10).map((supplier) => ({
      name: supplier.name && supplier.name.length > 18 ? `${supplier.name.slice(0, 18)}...` : (supplier.name || supplier.rfc || 'Desconocido'),
      fullName: supplier.name || supplier.rfc || 'Desconocido',
      total: supplier.total,
      rfc: supplier.rfc
    }))
  }, [metrics?.topSuppliers])

  const filteredEfosRiskRows = useMemo(() => {
    return efosRiskRows.filter((row) => {
      return Object.entries(efosRiskFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'total') {
          return String(row.total).includes(query) || formatMXN(row.total).toLowerCase().includes(query)
        }

        return String(row[key as keyof EfosRiskDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [efosRiskFilters, efosRiskRows])

  const efosRiskStats = useMemo(() => {
    const total = filteredEfosRiskRows.reduce((acc, row) => acc + Number(row.total || 0), 0)
    const supplierCount = new Set(filteredEfosRiskRows.map((row) => row.issuerRfc)).size

    return {
      total,
      supplierCount,
      cfdiCount: filteredEfosRiskRows.length,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredEfosRiskRows])

  const filteredPostLoadCancellationRows = useMemo(() => {
    return postLoadCancellationRows.filter((row) => {
      return Object.entries(postLoadCancellationFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate' || key === 'detectedAt') {
          const fieldValue = key === 'issuanceDate' ? row.issuanceDate : row.detectedAt
          return (fieldValue ? new Date(fieldValue).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'total') {
          return String(row.total).includes(query) || formatMXN(row.total).toLowerCase().includes(query)
        }

        return String(row[key as keyof PostLoadCancellationDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [postLoadCancellationFilters, postLoadCancellationRows])

  const postLoadCancellationStats = useMemo(() => {
    const total = filteredPostLoadCancellationRows.reduce((acc, row) => acc + Number(row.total || 0), 0)
    const supplierCount = new Set(filteredPostLoadCancellationRows.map((row) => row.issuerRfc)).size

    return {
      total,
      supplierCount,
      cfdiCount: filteredPostLoadCancellationRows.length
    }
  }, [filteredPostLoadCancellationRows])

  const filteredPaymentMethodVsPaymentFormRows = useMemo(() => {
    return paymentMethodVsPaymentFormRows.filter((row) => {
      return Object.entries(paymentMethodVsPaymentFormFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'total') {
          return String(row.total).includes(query) || formatMXN(row.total).toLowerCase().includes(query)
        }

        return String(row[key as keyof PaymentMethodVsPaymentFormDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [paymentMethodVsPaymentFormFilters, paymentMethodVsPaymentFormRows])

  const paymentMethodVsPaymentFormStats = useMemo(() => {
    const total = filteredPaymentMethodVsPaymentFormRows.reduce((acc, row) => acc + Number(row.total || 0), 0)
    const supplierCount = new Set(filteredPaymentMethodVsPaymentFormRows.map((row) => row.issuerRfc)).size

    return {
      total,
      supplierCount,
      cfdiCount: filteredPaymentMethodVsPaymentFormRows.length,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredPaymentMethodVsPaymentFormRows])

  const filteredResicoRetentionRows = useMemo(() => {
    return resicoRetentionRows.filter((row) => {
      return Object.entries(resicoRetentionFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'total') {
          return String(row.total).includes(query) || formatMXN(row.total).toLowerCase().includes(query)
        }

        if (key === 'hasResicoIsrRetention') {
          return (row.hasResicoIsrRetention ? 'si' : 'no').includes(query)
        }

        return String(row[key as keyof ResicoRetentionDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [resicoRetentionFilters, resicoRetentionRows])

  const resicoRetentionStats = useMemo(() => {
    const total = filteredResicoRetentionRows.reduce((acc, row) => acc + Number(row.total || 0), 0)
    const supplierCount = new Set(filteredResicoRetentionRows.map((row) => row.issuerRfc)).size

    return {
      total,
      supplierCount,
      cfdiCount: filteredResicoRetentionRows.length,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredResicoRetentionRows])

  const filteredObjetoImpTaxRows = useMemo(() => {
    return objetoImpTaxRows.filter((row) => {
      return Object.entries(objetoImpTaxFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'total') {
          return String(row.total).includes(query) || formatMXN(row.total).toLowerCase().includes(query)
        }

        if (key === 'inconsistencyReason') {
          return formatObjetoImpReason(row.inconsistencyReason).toLowerCase().includes(query)
            || row.inconsistencyReason.toLowerCase().includes(query)
        }

        return String(row[key as keyof ObjetoImpTaxDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [objetoImpTaxFilters, objetoImpTaxRows])

  const objetoImpTaxStats = useMemo(() => {
    const total = filteredObjetoImpTaxRows.reduce((acc, row) => acc + Number(row.total || 0), 0)
    const supplierCount = new Set(filteredObjetoImpTaxRows.map((row) => row.issuerRfc)).size

    return {
      total,
      supplierCount,
      cfdiCount: filteredObjetoImpTaxRows.length,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredObjetoImpTaxRows])

  const filteredIvaAccreditableRows = useMemo(() => {
    return ivaAccreditableRows.filter((row) => {
      return Object.entries(ivaAccreditableFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'taxAmount' || key === 'total') {
          const numericValue = key === 'taxAmount' ? row.taxAmount : row.total
          return String(numericValue).includes(query) || formatMXN(numericValue).toLowerCase().includes(query)
        }

        return String(row[key as keyof IvaAccreditableDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [ivaAccreditableFilters, ivaAccreditableRows])

  const ivaAccreditableStats = useMemo(() => {
    const total = filteredIvaAccreditableRows.reduce((acc, row) => acc + Number(row.taxAmount || 0), 0)
    const supplierCount = new Set(filteredIvaAccreditableRows.map((row) => row.issuerRfc)).size
    const cfdiCount = new Set(filteredIvaAccreditableRows.map((row) => row.uuid)).size

    return {
      total,
      supplierCount,
      cfdiCount,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredIvaAccreditableRows])

  const filteredRetainedTaxesRows = useMemo(() => {
    return retainedTaxesRows.filter((row) => {
      return Object.entries(retainedTaxesFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'taxAmount' || key === 'total') {
          const numericValue = key === 'taxAmount' ? row.taxAmount : row.total
          return String(numericValue).includes(query) || formatMXN(numericValue).toLowerCase().includes(query)
        }

        return String(row[key as keyof RetainedTaxDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [retainedTaxesFilters, retainedTaxesRows])

  const retainedTaxesStats = useMemo(() => {
    const total = filteredRetainedTaxesRows.reduce((acc, row) => acc + Number(row.taxAmount || 0), 0)
    const supplierCount = new Set(filteredRetainedTaxesRows.map((row) => row.issuerRfc)).size
    const cfdiCount = new Set(filteredRetainedTaxesRows.map((row) => row.uuid)).size

    return {
      total,
      supplierCount,
      cfdiCount,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredRetainedTaxesRows])

  const filteredPaidInPeriodRows = useMemo(() => {
    return paidInPeriodRows.filter((row) => {
      return Object.entries(paidInPeriodFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'paymentDate') {
          return (row.paymentDate ? new Date(row.paymentDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'amountPaid' || key === 'previousBalance' || key === 'outstandingBalance') {
          const numericValue = row[key as 'amountPaid' | 'previousBalance' | 'outstandingBalance']
          return String(numericValue).includes(query) || formatMXN(numericValue).toLowerCase().includes(query)
        }

        if (key === 'partialityNumber') {
          return String(row.partialityNumber).includes(query)
        }

        return String(row[key as keyof PaidInPeriodDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [paidInPeriodFilters, paidInPeriodRows])

  const paidInPeriodStats = useMemo(() => {
    const total = filteredPaidInPeriodRows.reduce((acc, row) => acc + Number(row.amountPaid || 0), 0)
    const supplierCount = new Set(filteredPaidInPeriodRows.map((row) => row.issuerRfc)).size

    return {
      total,
      supplierCount,
      paymentCount: filteredPaidInPeriodRows.length,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredPaidInPeriodRows])

  const filteredOutstandingBalanceRows = useMemo(() => {
    return outstandingBalanceRows.filter((row) => {
      return Object.entries(outstandingBalanceFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'total' || key === 'totalPaid' || key === 'outstandingBalance') {
          const numericValue = row[key as 'total' | 'totalPaid' | 'outstandingBalance']
          return String(numericValue).includes(query) || formatMXN(numericValue).toLowerCase().includes(query)
        }

        return String(row[key as keyof OutstandingBalanceDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [outstandingBalanceFilters, outstandingBalanceRows])

  const outstandingBalanceStats = useMemo(() => {
    const total = filteredOutstandingBalanceRows.reduce((acc, row) => acc + Number(row.outstandingBalance || 0), 0)
    const supplierCount = new Set(filteredOutstandingBalanceRows.map((row) => row.issuerRfc)).size

    return {
      total,
      supplierCount,
      cfdiCount: filteredOutstandingBalanceRows.length,
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredOutstandingBalanceRows])

  const filteredAgingBalanceRows = useMemo(() => {
    return agingBalanceRows.filter((row) => {
      return Object.entries(agingBalanceFilters).every(([key, value]) => {
        if (!value) return true
        const query = value.toLowerCase()

        if (key === 'issuanceDate') {
          return (row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '').toLowerCase().includes(query)
        }

        if (key === 'total' || key === 'totalPaid' || key === 'outstandingBalance') {
          const numericValue = row[key as 'total' | 'totalPaid' | 'outstandingBalance']
          return String(numericValue).includes(query) || formatMXN(numericValue).toLowerCase().includes(query)
        }

        if (key === 'ageDays') {
          return String(row.ageDays).includes(query)
        }

        return String(row[key as keyof AgingBalanceDrilldownRow] || '').toLowerCase().includes(query)
      })
    })
  }, [agingBalanceFilters, agingBalanceRows])

  const agingBalanceStats = useMemo(() => {
    const total = filteredAgingBalanceRows.reduce((acc, row) => acc + Number(row.outstandingBalance || 0), 0)
    const supplierCount = new Set(filteredAgingBalanceRows.map((row) => row.issuerRfc)).size
    const breakdownMap = new Map([
      ['0 a 30 días', 0],
      ['31 a 60 días', 0],
      ['61 a 90 días', 0],
      ['Más de 90 días', 0]
    ])

    filteredAgingBalanceRows.forEach((row) => {
      breakdownMap.set(row.ageBucket, (breakdownMap.get(row.ageBucket) || 0) + Number(row.outstandingBalance || 0))
    })

    return {
      total,
      supplierCount,
      cfdiCount: filteredAgingBalanceRows.length,
      breakdown: Array.from(breakdownMap.entries()).map(([bucket, amount]) => ({ bucket, amount })),
      startDate: appliedFilters.start
        ? new Date(`${appliedFilters.start}T12:00:00`).toLocaleDateString('es-MX')
        : 'Desde el inicio',
      endDate: appliedFilters.end
        ? new Date(`${appliedFilters.end}T12:00:00`).toLocaleDateString('es-MX')
        : 'Hasta la fecha'
    }
  }, [appliedFilters.end, appliedFilters.start, filteredAgingBalanceRows])

  const handleFilter = () => {
    if (!startDate || !endDate) {
      showError('Periodo requerido', 'Selecciona Fecha Inicio y Fecha Fin antes de consultar')
      return
    }

    if (isInvalidDateRange) {
      showError('Rango de fechas inválido', 'La fecha de inicio no puede ser mayor que la fecha final')
      return
    }

    setAppliedFilters({ start: startDate, end: endDate })
  }

  const handleIvaAccreditableDialogOpenChange = createDrilldownOpenChange(setIvaAccreditableDialogOpen, setIvaAccreditableDialogLoading, setIvaAccreditableRows, setIvaAccreditableFilters)
  const handleRetainedTaxesDialogOpenChange = createDrilldownOpenChange(setRetainedTaxesDialogOpen, setRetainedTaxesDialogLoading, setRetainedTaxesRows, setRetainedTaxesFilters)
  const handlePaidInPeriodDialogOpenChange = createDrilldownOpenChange(setPaidInPeriodDialogOpen, setPaidInPeriodDialogLoading, setPaidInPeriodRows, setPaidInPeriodFilters)
  const handleOutstandingBalanceDialogOpenChange = createDrilldownOpenChange(setOutstandingBalanceDialogOpen, setOutstandingBalanceDialogLoading, setOutstandingBalanceRows, setOutstandingBalanceFilters)
  const handleAgingBalanceDialogOpenChange = createDrilldownOpenChange(setAgingBalanceDialogOpen, setAgingBalanceDialogLoading, setAgingBalanceRows, setAgingBalanceFilters)
  const handleEfosDialogOpenChange = createDrilldownOpenChange(setEfosDialogOpen, setEfosDialogLoading, setEfosRiskRows, setEfosRiskFilters)
  const handlePostLoadCancellationDialogOpenChange = createDrilldownOpenChange(setPostLoadCancellationDialogOpen, setPostLoadCancellationDialogLoading, setPostLoadCancellationRows, setPostLoadCancellationFilters)
  const handlePaymentMethodVsPaymentFormDialogOpenChange = createDrilldownOpenChange(setPaymentMethodVsPaymentFormDialogOpen, setPaymentMethodVsPaymentFormDialogLoading, setPaymentMethodVsPaymentFormRows, setPaymentMethodVsPaymentFormFilters)
  const handleResicoRetentionDialogOpenChange = createDrilldownOpenChange(setResicoRetentionDialogOpen, setResicoRetentionDialogLoading, setResicoRetentionRows, setResicoRetentionFilters)
  const handleObjetoImpTaxDialogOpenChange = createDrilldownOpenChange(setObjetoImpTaxDialogOpen, setObjetoImpTaxDialogLoading, setObjetoImpTaxRows, setObjetoImpTaxFilters)

  const handleOpenEfosRiskDrilldown = async () => {
    if (!selectedCompanyId) return

    setEfosDialogOpen(true)
    setEfosDialogLoading(true)
    setEfosRiskRows([])
    setEfosRiskFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/efos-risk', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el listado de riesgo EFOS')

      setEfosRiskRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el listado EFOS')
      setEfosRiskRows([])
    } finally {
      setEfosDialogLoading(false)
    }
  }

  const handleExportEfosRisk = () => {
    if (filteredEfosRiskRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'Tipo CFDI', 'Serie', 'Folio', 'Total', 'Estado SAT', 'Estatus 69-B', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredEfosRiskRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.cfdiType),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.satEstado),
      escapeCsvSafe(`${row.efosStatusLabel} (${row.efosStatusBucket})`),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', 'Total', escapeCsvSafe(efosRiskStats.total), '', '', ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Auditoria_Fiscal_EFOS_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenPostLoadCancellationDrilldown = async () => {
    if (!selectedCompanyId) return

    setPostLoadCancellationDialogOpen(true)
    setPostLoadCancellationDialogLoading(true)
    setPostLoadCancellationRows([])
    setPostLoadCancellationFilters({})

    try {
      const response = await fetch(`/api/dashboard_recibidos/drilldown/post-load-cancellations?companyId=${selectedCompanyId}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el listado de cancelaciones post-carga')

      setPostLoadCancellationRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el listado de cancelaciones post-carga')
      setPostLoadCancellationRows([])
    } finally {
      setPostLoadCancellationDialogLoading(false)
    }
  }

  const handleExportPostLoadCancellation = () => {
    if (filteredPostLoadCancellationRows.length === 0) return

    const headers = ['Fecha detección', 'Fecha CFDI', 'UUID', 'RFC Emisor', 'Proveedor', 'Tipo CFDI', 'Serie', 'Folio', 'Estado inicial', 'Estado actual', 'Estatus cancelación', 'Es cancelable', 'Total', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredPostLoadCancellationRows.map((row) => [
      escapeCsvSafe(row.detectedAt ? new Date(row.detectedAt).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.cfdiType),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.satInitialEstado),
      escapeCsvSafe(row.satEstado),
      escapeCsvSafe(row.satEstatusCancelacion),
      escapeCsvSafe(row.satEsCancelable),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(postLoadCancellationStats.total), ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Alertas_Cancelacion_Post_Carga_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenPaymentMethodVsPaymentFormDrilldown = async () => {
    if (!selectedCompanyId) return

    setPaymentMethodVsPaymentFormDialogOpen(true)
    setPaymentMethodVsPaymentFormDialogLoading(true)
    setPaymentMethodVsPaymentFormRows([])
    setPaymentMethodVsPaymentFormFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/business-rules/payment-method-vs-payment-form', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el listado de la regla Método de pago vs Forma de pago')

      setPaymentMethodVsPaymentFormRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el listado de la regla')
      setPaymentMethodVsPaymentFormRows([])
    } finally {
      setPaymentMethodVsPaymentFormDialogLoading(false)
    }
  }

  const handleExportPaymentMethodVsPaymentForm = () => {
    if (filteredPaymentMethodVsPaymentFormRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'Tipo CFDI', 'Serie', 'Folio', 'MetodoPago', 'FormaPago', 'Total', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredPaymentMethodVsPaymentFormRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.cfdiType),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.paymentMethod),
      escapeCsvSafe(row.paymentForm),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(paymentMethodVsPaymentFormStats.total), ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Regla_MetodoPago_vs_FormaPago_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenResicoRetentionDrilldown = async () => {
    if (!selectedCompanyId) return

    setResicoRetentionDialogOpen(true)
    setResicoRetentionDialogLoading(true)
    setResicoRetentionRows([])
    setResicoRetentionFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/business-rules/resico-retention', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el listado de la regla RESICO')

      setResicoRetentionRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el listado de la regla RESICO')
      setResicoRetentionRows([])
    } finally {
      setResicoRetentionDialogLoading(false)
    }
  }

  const handleExportResicoRetention = () => {
    if (filteredResicoRetentionRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'RFC Receptor', 'RegimenFiscalEmisor', 'Tipo CFDI', 'Serie', 'Folio', 'Retencion ISR 0.012500', 'Total', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredResicoRetentionRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.receiverRfc),
      escapeCsvSafe(row.issuerFiscalRegime),
      escapeCsvSafe(row.cfdiType),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.hasResicoIsrRetention ? 'SI' : 'NO'),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(resicoRetentionStats.total), ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Regla_RESICO_Retencion_ISR_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenObjetoImpTaxDrilldown = async () => {
    if (!selectedCompanyId) return

    setObjetoImpTaxDialogOpen(true)
    setObjetoImpTaxDialogLoading(true)
    setObjetoImpTaxRows([])
    setObjetoImpTaxFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/business-rules/objetoimp-vs-iva', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el listado de la regla ObjetoImp vs IVA')

      setObjetoImpTaxRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el listado de la regla ObjetoImp vs IVA')
      setObjetoImpTaxRows([])
    } finally {
      setObjetoImpTaxDialogLoading(false)
    }
  }

  const handleExportObjetoImpTax = () => {
    if (filteredObjetoImpTaxRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'RFC Receptor', 'Tipo CFDI', 'Serie', 'Folio', 'Inconsistencia', 'Total', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredObjetoImpTaxRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.receiverRfc),
      escapeCsvSafe(row.cfdiType),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(formatObjetoImpReason(row.inconsistencyReason)),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(objetoImpTaxStats.total), ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Regla_ObjetoImp_vs_IVA_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenIvaAccreditableDrilldown = async () => {
    if (!selectedCompanyId) return

    setIvaAccreditableDialogOpen(true)
    setIvaAccreditableDialogLoading(true)
    setIvaAccreditableRows([])
    setIvaAccreditableFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/tax-period/iva-acreditable', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el reporte de IVA acreditable')

      setIvaAccreditableRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el reporte de IVA acreditable')
      setIvaAccreditableRows([])
    } finally {
      setIvaAccreditableDialogLoading(false)
    }
  }

  const handleExportIvaAccreditable = () => {
    if (filteredIvaAccreditableRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'RFC Receptor', 'Tipo CFDI', 'Serie', 'Folio', 'TasaOCuota', 'Importe IVA', 'Total CFDI', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredIvaAccreditableRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.receiverRfc),
      escapeCsvSafe(row.cfdiType),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.rateLabel),
      escapeCsvSafe(row.taxAmount),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(ivaAccreditableStats.total), '', ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `IVA_Acreditable_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenRetainedTaxesDrilldown = async () => {
    if (!selectedCompanyId) return

    setRetainedTaxesDialogOpen(true)
    setRetainedTaxesDialogLoading(true)
    setRetainedTaxesRows([])
    setRetainedTaxesFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/tax-period/retentions', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el reporte de retenciones')

      setRetainedTaxesRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el reporte de retenciones')
      setRetainedTaxesRows([])
    } finally {
      setRetainedTaxesDialogLoading(false)
    }
  }

  const handleExportRetainedTaxes = () => {
    if (filteredRetainedTaxesRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'RFC Receptor', 'Tipo CFDI', 'Serie', 'Folio', 'Impuesto', 'Clave', 'Importe retenido', 'Total CFDI', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredRetainedTaxesRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.receiverRfc),
      escapeCsvSafe(row.cfdiType),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.taxLabel),
      escapeCsvSafe(row.taxCode),
      escapeCsvSafe(row.taxAmount),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', 'Total', '', escapeCsvSafe(retainedTaxesStats.total), '', ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Retenciones_Periodo_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenPaidInPeriodDrilldown = async () => {
    if (!selectedCompanyId) return

    setPaidInPeriodDialogOpen(true)
    setPaidInPeriodDialogLoading(true)
    setPaidInPeriodRows([])
    setPaidInPeriodFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/payment-balance-period/paid', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el reporte de pagos del periodo')

      setPaidInPeriodRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el reporte de pagos del periodo')
      setPaidInPeriodRows([])
    } finally {
      setPaidInPeriodDialogLoading(false)
    }
  }

  const handleExportPaidInPeriod = () => {
    if (filteredPaidInPeriodRows.length === 0) return

    const headers = ['Fecha de pago', 'UUID factura', 'UUID pago', 'RFC Emisor', 'Proveedor', 'RFC Receptor', 'Metodo', 'Origen', 'Parcialidad', 'Serie', 'Folio', 'Monto pagado', 'Saldo anterior', 'Saldo insoluto', 'Moneda']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredPaidInPeriodRows.map((row) => [
      escapeCsvSafe(row.paymentDate ? new Date(row.paymentDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.invoiceUuid),
      escapeCsvSafe(row.paymentUuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.receiverRfc),
      escapeCsvSafe(row.paymentMethod),
      escapeCsvSafe(row.paymentSource),
      escapeCsvSafe(row.partialityNumber),
      escapeCsvSafe(row.series),
      escapeCsvSafe(row.folio),
      escapeCsvSafe(row.amountPaid),
      escapeCsvSafe(row.previousBalance),
      escapeCsvSafe(row.outstandingBalance),
      escapeCsvSafe(row.currency)
    ])

    rows.push(['', '', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(paidInPeriodStats.total), '', '', '', ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Pagos_Del_Periodo_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenOutstandingBalanceDrilldown = async () => {
    if (!selectedCompanyId) return

    setOutstandingBalanceDialogOpen(true)
    setOutstandingBalanceDialogLoading(true)
    setOutstandingBalanceRows([])
    setOutstandingBalanceFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/payment-balance-period/outstanding', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el reporte de saldos pendientes')

      setOutstandingBalanceRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el reporte de saldos pendientes')
      setOutstandingBalanceRows([])
    } finally {
      setOutstandingBalanceDialogLoading(false)
    }
  }

  const handleExportOutstandingBalance = () => {
    if (filteredOutstandingBalanceRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'RFC Receptor', 'Metodo', 'Moneda', 'Total original', 'Total pagado', 'Saldo pendiente', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredOutstandingBalanceRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.receiverRfc),
      escapeCsvSafe(row.paymentMethod),
      escapeCsvSafe(row.currency),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.totalPaid),
      escapeCsvSafe(row.outstandingBalance),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(outstandingBalanceStats.total), ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Saldos_Pendientes_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleOpenAgingBalanceDrilldown = async () => {
    if (!selectedCompanyId) return

    setAgingBalanceDialogOpen(true)
    setAgingBalanceDialogLoading(true)
    setAgingBalanceRows([])
    setAgingBalanceFilters({})

    try {
      const url = buildDashboardUrl('/api/dashboard_recibidos/drilldown/payment-balance-period/aging', {
        companyId: selectedCompanyId,
        startDate: appliedFilters.start || undefined,
        endDate: appliedFilters.end || undefined
      })

      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al cargar el reporte de antigüedad de saldos')

      setAgingBalanceRows(data.data || [])
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error al obtener el reporte de antigüedad de saldos')
      setAgingBalanceRows([])
    } finally {
      setAgingBalanceDialogLoading(false)
    }
  }

  const handleExportAgingBalance = () => {
    if (filteredAgingBalanceRows.length === 0) return

    const headers = ['Fecha', 'UUID', 'RFC Emisor', 'Proveedor', 'RFC Receptor', 'Metodo', 'Moneda', 'Dias', 'Bucket', 'Total original', 'Total pagado', 'Saldo pendiente', 'Archivo']
    // (Definición local escapeCsv ELIMINADA: ahora usamos escapeCsvSafe() global
    // declarado arriba del componente, con protección contra CSV Formula Injection
    // DASH-SAST-003 FIX.)

    const rows = filteredAgingBalanceRows.map((row) => [
      escapeCsvSafe(row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : ''),
      escapeCsvSafe(row.uuid),
      escapeCsvSafe(row.issuerRfc),
      escapeCsvSafe(row.issuerName),
      escapeCsvSafe(row.receiverRfc),
      escapeCsvSafe(row.paymentMethod),
      escapeCsvSafe(row.currency),
      escapeCsvSafe(row.ageDays),
      escapeCsvSafe(row.ageBucket),
      escapeCsvSafe(row.total),
      escapeCsvSafe(row.totalPaid),
      escapeCsvSafe(row.outstandingBalance),
      escapeCsvSafe(row.fileName)
    ])

    rows.push(['', '', '', '', '', '', '', '', '', '', 'Total', escapeCsvSafe(agingBalanceStats.total), ''])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Antiguedad_Saldos_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
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
                Usa el combobox del sidebar para elegir la empresa y cargar su Dashboard de Recibidos.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedRoute>
    )
  }

  const currentMetrics = metrics || zeroMetrics
  const expensePeriodSummary = currentMetrics.expensePeriodSummary
  const taxPeriodSummary = currentMetrics.taxPeriodSummary
  const paymentBalancePeriodSummary = currentMetrics.paymentBalancePeriodSummary
  const efosRisk = currentMetrics.fiscalAudit
  const businessRules = currentMetrics.businessRules
  const efosRiskTitle = efosRisk.efosRiskAmount > 0 && efosRisk.efosSupplierCount > 0
    ? `${formatMXN(efosRisk.efosRiskAmount)} MXN en riesgo por ${efosRisk.efosSupplierCount} proveedor${efosRisk.efosSupplierCount === 1 ? '' : 'es'} en Lista Negra`
    : '$0.00 pesos en riesgo por EFOS'
  const postLoadCancellationTitle = efosRisk.postLoadCancellationCount > 0
    ? `${efosRisk.postLoadCancellationCount} factura${efosRisk.postLoadCancellationCount === 1 ? '' : 's'} cambiaron a Cancelado en los últimos 30 días`
    : '0 facturas cambiaron a Cancelado en los últimos 30 días'
  const last69BSyncLabel = efosRisk.last69BSyncAt
    ? new Date(efosRisk.last69BSyncAt).toLocaleString('es-MX')
    : 'Sin sincronización aún'

  return (
    <TooltipProvider delayDuration={100}>
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Tablero de egresos</h2>
            {hydratingMetrics && (
              <div className="mt-2 text-sm text-muted-foreground">
                Actualizando metricas detalladas...
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'} · {currentMetrics.company.name || selectedCompany?.businessName || selectedCompany?.name || 'Empresa'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="startDate">Fecha Inicio</Label>
            <Input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              max={endDate || undefined}
            />
          </div>

          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="endDate">Fecha Fin</Label>
            <Input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              min={startDate || undefined}
            />
          </div>

          <div className="flex gap-2 pb-0.5">
            <Button onClick={handleFilter} disabled={isInvalidDateRange || !hasCompleteDateRange}>
              <Search className="mr-2 h-4 w-4" />
              Filtrar
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                setStartDate('')
                setEndDate('')
                setAppliedFilters({ start: '', end: '' })
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
                <DropdownMenuItem onClick={() => setVisibleSections(dashboardSections.map(section => section.id))}>
                  Mostrar todas
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setVisibleSections([])}>
                  Ocultar todas
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {dashboardSections.map((section) => (
                  <DropdownMenuCheckboxItem
                    key={section.id}
                    checked={visibleSections.includes(section.id)}
                    onCheckedChange={(checked) => {
                      setVisibleSections((current) => checked
                        ? [...current, section.id]
                        : current.filter((id) => id !== section.id)
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

        
        {visibleSections.includes('expense_period_summary') && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Resumen de Egresos del Periodo</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card className="overflow-hidden border border-sky-300 bg-card h-full">
                <div className="flex min-h-[64px] items-center justify-center border-b border-sky-300/50 bg-sky-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-sky-600 md:text-base">Gasto Bruto Comercial<KpiTooltip description="Suma del atributo `SubTotal` de CFDI de proveedores (compras/gastos) VIGENTES en el rango de fecha de emisión. Es el total bruto de compras antes de notas de crédito y descuentos posteriores." /></h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-3 p-6 text-center">
                  <ShoppingCart className="h-12 w-12 text-sky-600" />
                  <div className="text-2xl font-bold text-sky-600">
                    {formatMXN(expensePeriodSummary.grossCommercialExpense)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Suma del atributo `SubTotal` de CFDI tipo `I` vigentes dentro del rango actual.
                  </p>
                </CardContent>
              </Card>

              <Card className="overflow-hidden border border-orange-300 bg-card h-full">
                <div className="flex min-h-[64px] items-center justify-center border-b border-orange-300/50 bg-orange-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-orange-600 md:text-base">Devoluciones y Descuentos (Notas de Crédito)</h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-3 p-6 text-center">
                  <ArrowDown className="h-12 w-12 text-orange-600" />
                  <div className="text-2xl font-bold text-orange-600">
                    {formatMXN(expensePeriodSummary.creditNotesSubtotal)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Suma del atributo `SubTotal` de CFDI tipo `E` vigentes dentro del rango actual.
                  </p>
                </CardContent>
              </Card>

              <Card className="overflow-hidden border border-emerald-300 bg-card h-full">
                <div className="flex min-h-[64px] items-center justify-center border-b border-emerald-300/50 bg-emerald-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-emerald-600 md:text-base">Total de Gastos Netos<KpiTooltip description="Fórmula: Gasto Bruto Comercial - Devoluciones/Notas de Crédito vigentes. Base aprox. de gastos deducibles antes de impuestos." /></h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-3 p-6 text-center">
                  <CheckCircle className="h-12 w-12 text-emerald-600" />
                  <div className="text-2xl font-bold text-emerald-600">
                    {formatMXN(expensePeriodSummary.netExpensesTotal)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Resultado de `Gasto Bruto Comercial - Devoluciones y Descuentos` dentro del rango actual.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {visibleSections.includes('tax_period_summary') && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Resumen de Impuestos del periodo</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card
                className="overflow-hidden border border-cyan-300 bg-card h-full cursor-pointer transition-shadow hover:shadow-md"
                onClick={handleOpenIvaAccreditableDrilldown}
              >
                <div className="flex min-h-[64px] items-center justify-center border-b border-cyan-300/50 bg-cyan-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-cyan-600 md:text-base">IVA Acreditable</h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-4 p-6 text-center">
                  <FileText className="h-12 w-12 text-cyan-600" />
                  <div className="text-2xl font-bold text-cyan-600">
                    {formatMXN(taxPeriodSummary.ivaAccreditableTotal)}
                  </div>
                  <div className="w-full rounded-lg border border-cyan-200/70 bg-cyan-50/40 p-4 text-left">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-700">
                      Desglose por TasaOCuota
                    </div>
                    <div className="space-y-2">
                      {taxPeriodSummary.ivaAccreditableBreakdown.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          Sin traslados de IVA `002` identificados en el rango actual.
                        </div>
                      ) : (
                        taxPeriodSummary.ivaAccreditableBreakdown.map((entry) => (
                          <div key={entry.rate} className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">{entry.label}</span>
                            <span className="font-semibold text-cyan-700">{formatMXN(entry.amount)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Total general del IVA agrupado por cada valor de TasaOCuota.
                  </p>
                </CardContent>
              </Card>

              <Card
                className="overflow-hidden border border-violet-300 bg-card h-full cursor-pointer transition-shadow hover:shadow-md"
                onClick={handleOpenRetainedTaxesDrilldown}
              >
                <div className="flex min-h-[64px] items-center justify-center border-b border-violet-300/50 bg-violet-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-violet-600 md:text-base">Retenciones del Periodo</h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-4 p-6 text-center">
                  <ArrowDown className="h-12 w-12 text-violet-600" />
                  <div className="text-2xl font-bold text-violet-600">
                    {formatMXN(taxPeriodSummary.retainedTaxesTotal)}
                  </div>
                  <div className="w-full rounded-lg border border-violet-200/70 bg-violet-50/40 p-4 text-left">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                      Desglose por impuesto retenido
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-foreground">ISR retenido</span>
                        <span className="font-semibold text-violet-700">{formatMXN(taxPeriodSummary.retainedIsrTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-foreground">IVA retenido</span>
                        <span className="font-semibold text-violet-700">{formatMXN(taxPeriodSummary.retainedIvaTotal)}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Total general de retenciones acumuladas en el periodo.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {visibleSections.includes('payment_balance_period_summary') && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Resumen de Pagos y Saldos del Periodo</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card
                className="overflow-hidden border border-emerald-300 bg-card h-full cursor-pointer transition-shadow hover:shadow-md"
                onClick={handleOpenPaidInPeriodDrilldown}
              >
                <div className="flex min-h-[64px] items-center justify-center border-b border-emerald-300/50 bg-emerald-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-emerald-600 md:text-base">Total Pagado en el Periodo<KpiTooltip description="Flujo de caja SALIENTE real: 1) Facturas proveedor PUE (pago contado) VIGENTES en rango + 2) Complementos de Pago aplicados a facturas de proveedor, con fecha de pago del nodo Pago." /></h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-4 p-6 text-center">
                  <CheckCircle className="h-12 w-12 text-emerald-600" />
                  <div className="text-2xl font-bold text-emerald-600">
                    {formatMXN(paymentBalancePeriodSummary.totalPaidInPeriod)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Suma de facturas PUE emitidas en el rango más los abonos PPD dentro del periodo.
                  </p>
                </CardContent>
              </Card>

              <Card
                className="overflow-hidden border border-amber-300 bg-card h-full cursor-pointer transition-shadow hover:shadow-md"
                onClick={handleOpenOutstandingBalanceDrilldown}
              >
                <div className="flex min-h-[64px] items-center justify-center border-b border-amber-300/50 bg-amber-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-amber-600 md:text-base">Saldo Pendiente de Pago</h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-4 p-6 text-center">
                  <FileText className="h-12 w-12 text-amber-600" />
                  <div className="text-2xl font-bold text-amber-600">
                    {formatMXN(paymentBalancePeriodSummary.outstandingBalanceTotal)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Suma del saldo pendiente actual por factura usando el ImpSaldoInsoluto del último REP o el remanente calculado.
                  </p>
                </CardContent>
              </Card>

              <Card
                className="overflow-hidden border border-rose-300 bg-card h-full cursor-pointer transition-shadow hover:shadow-md"
                onClick={handleOpenAgingBalanceDrilldown}
              >
                <div className="flex min-h-[64px] items-center justify-center border-b border-rose-300/50 bg-rose-500/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-rose-600 md:text-base">Antigüedad de Saldos</h3>
                </div>
                <CardContent className="flex h-full flex-col items-center justify-center space-y-4 p-6 text-center">
                  <AlertTriangle className="h-12 w-12 text-rose-600" />
                  <div className="text-2xl font-bold text-rose-600">
                    {formatMXN(paymentBalancePeriodSummary.agingOutstandingTotal)}
                  </div>
                  <div className="w-full rounded-lg border border-rose-200/70 bg-rose-50/40 p-4 text-left">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                      Desglose por antigüedad
                    </div>
                    <div className="space-y-2">
                      {paymentBalancePeriodSummary.agingBreakdown.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          Sin saldos pendientes identificados en el rango actual.
                        </div>
                      ) : (
                        paymentBalancePeriodSummary.agingBreakdown.map((entry) => (
                          <div key={entry.bucket} className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">{entry.bucket}</span>
                            <span className="font-semibold text-rose-700">{formatMXN(entry.amount)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {canViewReceptionFiscalAudit && visibleSections.includes('fiscal_audit') && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Auditoría Fiscal y Detección de Riesgos</h3>
              <p className="text-sm text-muted-foreground">
                Monitorea emisores en lista 69-B para anticipar contingencias y revisar CFDI con impacto económico.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card
                className="overflow-hidden border border-red-300 bg-card cursor-pointer transition-shadow hover:shadow-md"
                onClick={handleOpenEfosRiskDrilldown}
              >
                <div className="border-b border-red-300/50 bg-red-600/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-red-600 md:text-base">Impacto Económico EFOS</h3>
                </div>
                <CardContent className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                  <AlertTriangle className="h-12 w-12 text-red-600" />
                  <div className="text-xl font-bold text-red-600">{efosRiskTitle}</div>
                  <p className="text-sm text-muted-foreground">
                    Da clic para revisar los XML filtrados y preparar contradicción o ajuste contable.
                  </p>
                </CardContent>
              </Card>

              {canViewReceptionCancellationAlerts && (
                <Card
                  className="overflow-hidden border border-amber-300 bg-card cursor-pointer transition-shadow hover:shadow-md"
                  onClick={handleOpenPostLoadCancellationDrilldown}
                >
                  <div className="border-b border-amber-300/50 bg-amber-500/10 p-2 text-center">
                    <h3 className="text-sm font-bold text-amber-600 md:text-base">Alertas de Cancelación Post-Carga</h3>
                  </div>
                  <CardContent className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                    <XCircle className="h-12 w-12 text-amber-600" />
                    <div className="text-lg font-bold text-amber-600">{postLoadCancellationTitle}</div>
                    <p className="text-sm text-muted-foreground">
                      {formatMXN(efosRisk.postLoadCancellationAmount)} detectados en {efosRisk.postLoadCancellationSupplierCount} proveedor{efosRisk.postLoadCancellationSupplierCount === 1 ? '' : 'es'} durante los últimos 30 días.
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card className="overflow-hidden border border-border bg-card">
                <div className="border-b border-border bg-slate-600/10 p-2 text-center">
                  <h3 className="text-sm font-bold text-slate-600 md:text-base">Última verificación 69-B<KpiTooltip description="Fecha y hora de la última sincronización con el SAT para comprobar Listas Negras. Si la fecha es antigua (+30 días), los resultados de EFOS y 69-B no son fiables y requieren resincronización." /></h3>
                </div>
                <CardContent className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                  <FileText className="h-12 w-12 text-slate-600" />
                  <div className="text-lg font-bold text-foreground">{last69BSyncLabel}</div>
                  <p className="text-sm text-muted-foreground">
                    {efosRisk.efosCfdiCount} CFDI detectados en riesgo dentro del rango actual del dashboard.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {canViewReceptionBusinessRules && visibleSections.includes('business_rules') && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Coherencia de Datos / Reglas de Negocio</h3>
              <p className="text-sm text-muted-foreground">
                Base para validaciones configurables por cliente sobre consistencia operativa, fiscal y reglas de negocio en CFDI recibidos.
              </p>
            </div>

            <Card className="overflow-hidden border border-indigo-300 bg-card">
              <div className="border-b border-indigo-300/50 bg-indigo-600/10 p-2 text-center">
                <h3 className="text-sm font-bold text-indigo-600 md:text-base">Coherencia de Datos / Reglas de Negocio</h3>
              </div>
              <CardContent className="space-y-5 p-6">
                <div className="rounded-lg border border-indigo-200/70 bg-indigo-50/30 p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    {canViewReceptionBusinessRulePueForma99 && (
                      <Card
                        className="overflow-hidden border border-indigo-300 bg-card cursor-pointer transition-shadow hover:shadow-md"
                        onClick={handleOpenPaymentMethodVsPaymentFormDrilldown}
                      >
                        <div className="border-b border-indigo-300/50 bg-indigo-600/10 p-2 text-center">
                          <h3 className="text-sm font-bold text-indigo-600 md:text-base">Método de pago vs Forma de pago</h3>
                        </div>
                        <CardContent className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                          <ShieldCheck className="h-12 w-12 text-indigo-600" />
                          <div className="text-lg font-bold text-indigo-600">
                            {businessRules.paymentMethodPueForma99Count} CFDI con MetodoPago=PUE y FormaPago=99
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {formatMXN(businessRules.paymentMethodPueForma99Amount)} detectados en {businessRules.paymentMethodPueForma99SupplierCount} proveedor{businessRules.paymentMethodPueForma99SupplierCount === 1 ? '' : 'es'} dentro del rango actual.
                          </p>
                        </CardContent>
                      </Card>
                    )}

                    {canViewReceptionBusinessRuleResicoRetention && (
                      <Card
                        className="overflow-hidden border border-indigo-300 bg-card cursor-pointer transition-shadow hover:shadow-md"
                        onClick={handleOpenResicoRetentionDrilldown}
                      >
                        <div className="border-b border-indigo-300/50 bg-indigo-600/10 p-2 text-center">
                          <h3 className="text-sm font-bold text-indigo-600 md:text-base">Validación de proveedores del RESICO</h3>
                        </div>
                        <CardContent className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                          <ShieldCheck className="h-12 w-12 text-indigo-600" />
                          <div className="text-lg font-bold text-indigo-600">
                            {businessRules.resicoRetentionCount} CFDI RESICO sin retención ISR 0.012500
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {formatMXN(businessRules.resicoRetentionAmount)} detectados en {businessRules.resicoRetentionSupplierCount} proveedor{businessRules.resicoRetentionSupplierCount === 1 ? '' : 'es'} dentro del rango actual.
                          </p>
                        </CardContent>
                      </Card>
                    )}

                    {canViewReceptionBusinessRuleObjetoImpVsIva && (
                      <Card
                        className="overflow-hidden border border-indigo-300 bg-card cursor-pointer transition-shadow hover:shadow-md"
                        onClick={handleOpenObjetoImpTaxDrilldown}
                      >
                        <div className="border-b border-indigo-300/50 bg-indigo-600/10 p-2 text-center">
                          <h3 className="text-sm font-bold text-indigo-600 md:text-base">Objeto de Impuesto vs Traslados IVA<KpiTooltip description="Regla SAT: ObjetoImpuesto='02' (Sí objeto) debe tener Traslados. ObjetoImpuesto='01' (No objeto) no debe tener Traslados de IVA. Detecta inconsistencias frecuentes." /></h3>
                        </div>
                        <CardContent className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                          <ShieldCheck className="h-12 w-12 text-indigo-600" />
                          <div className="text-lg font-bold text-indigo-600">
                            {businessRules.objetoImpVsIvaCount} CFDI con incoherencia ObjetoImp vs IVA
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {formatMXN(businessRules.objetoImpVsIvaAmount)} detectados en {businessRules.objetoImpVsIvaSupplierCount} proveedor{businessRules.objetoImpVsIvaSupplierCount === 1 ? '' : 'es'} dentro del rango actual.
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {visibleSections.includes('monthly_chart') && (
          <Card>
            <CardHeader>
              <CardTitle>CFDI recibidos por mes</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[800px]">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={currentMetrics.monthly} margin={{ top: 60, left: 100, right: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis
                      yAxisId="left"
                      width={80}
                      label={{
                        position: 'top',
                        content: (props: any) => {
                          const viewBox = props?.viewBox || {}
                          const x = (viewBox.x || 0) + (viewBox.width || 0) / 2
                          const y = (viewBox.y || 0) - 20

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
                      tickFormatter={(value: any) => formatMXN(Number(value))}
                      label={{
                        position: 'top',
                        content: (props: any) => {
                          const viewBox = props?.viewBox || {}
                          const x = (viewBox.x || 0) + (viewBox.width || 0) / 2
                          const y = (viewBox.y || 0) - 20

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

        {visibleSections.includes('payment_methods') && (
          <Card>
            <CardHeader>
              <CardTitle>Métodos de Pago</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={currentMetrics.paymentMethods}
                      dataKey="count"
                      nameKey="method"
                      outerRadius={110}
                      labelLine={false}
                      label={(entry: any) => `${entry.name}: ${(entry.percent * 100).toFixed(1)}%`}
                    >
                      {currentMetrics.paymentMethods.map((_, index) => (
                        <Cell key={`payment-method-${index}`} fill={PAYMENT_METHOD_COLORS[index % PAYMENT_METHOD_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      content={(props: any) => {
                        const payload = props?.payload?.[0]
                        if (!payload) return null

                        const name = payload.name || 'Sin método'
                        const count = Number(payload.value || 0)
                        const total = Number(payload.payload?.total || 0)
                        const denominator = currentMetrics.paymentMethods.reduce((acc, entry) => acc + Number(entry.count || 0), 0)
                        const percentage = denominator > 0 ? (count / denominator) * 100 : 0

                        return (
                          <div className="recharts-default-tooltip whitespace-nowrap border bg-white p-2">
                            <div className="font-semibold">{name}</div>
                            <div>Cantidad: {count}</div>
                            <div>Porcentaje: {percentage.toFixed(1)}%</div>
                            <div>Importe: {formatMXN(total)}</div>
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
        )}

        {visibleSections.includes('top_suppliers') && (
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Proveedores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={topSuppliersData.length > 0 ? topSuppliersData : [{ name: 'Sin datos', fullName: 'Sin datos', total: 0, rfc: null }]}
                    margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 12 }} />
                    <RechartsTooltip
                      formatter={(value: any) => [formatMXN(Number(value || 0)), 'Monto']}
                      labelFormatter={(label: any, payload: any) => payload?.[0]?.payload?.fullName || label}
                    />
                    <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={ivaAccreditableDialogOpen} onOpenChange={handleIvaAccreditableDialogOpenChange}>
          {ivaAccreditableDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Resumen de Impuestos: IVA Acreditable</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Se toma `/Comprobante/Impuestos/Traslados/Traslado`, filtrando `Impuesto=002` y agrupando por `TasaOCuota`.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {ivaAccreditableStats.startDate} - {ivaAccreditableStats.endDate}</li>
                    <li>IVA acreditable visible: {formatMXN(ivaAccreditableStats.total)}</li>
                    <li>Proveedores visibles: {ivaAccreditableStats.supplierCount}</li>
                    <li>CFDI visibles: {ivaAccreditableStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!ivaAccreditableDialogLoading && ivaAccreditableRows.length > 0 && (
                <Button onClick={handleExportIvaAccreditable} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {ivaAccreditableDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando reporte de IVA acreditable...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>RFC Receptor</TableHead>
                          <TableHead>Tipo CFDI</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead>TasaOCuota</TableHead>
                          <TableHead className="text-right">Importe IVA</TableHead>
                          <TableHead className="text-right">Total CFDI</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={ivaAccreditableFilters.issuanceDate || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.uuid || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.issuerRfc || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.issuerName || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.receiverRfc || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, receiverRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.cfdiType || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, cfdiType: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.series || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.folio || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.rateLabel || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, rateLabel: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.taxAmount || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, taxAmount: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={ivaAccreditableFilters.total || ''} onChange={(e) => setIvaAccreditableFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredIvaAccreditableRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                              No se encontraron traslados de IVA acreditable con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredIvaAccreditableRows.map((row) => (
                            <TableRow key={`${row.uuid}-${row.rate}`}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.receiverRfc}</TableCell>
                              <TableCell>{row.cfdiType}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell>{row.rateLabel}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.taxAmount)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredIvaAccreditableRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={9}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(ivaAccreditableStats.total)}</TableCell>
                            <TableCell />
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={retainedTaxesDialogOpen} onOpenChange={handleRetainedTaxesDialogOpenChange}>
          {retainedTaxesDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Resumen de Impuestos: Retenciones del Periodo</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Se toma `/Comprobante/Impuestos/Retenciones/Retencion`, acumulando `Impuesto=001` ISR y `Impuesto=002` IVA.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {retainedTaxesStats.startDate} - {retainedTaxesStats.endDate}</li>
                    <li>Retenciones visibles: {formatMXN(retainedTaxesStats.total)}</li>
                    <li>Proveedores visibles: {retainedTaxesStats.supplierCount}</li>
                    <li>CFDI visibles: {retainedTaxesStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!retainedTaxesDialogLoading && retainedTaxesRows.length > 0 && (
                <Button onClick={handleExportRetainedTaxes} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {retainedTaxesDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando reporte de retenciones...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>RFC Receptor</TableHead>
                          <TableHead>Tipo CFDI</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead>Impuesto</TableHead>
                          <TableHead>Clave</TableHead>
                          <TableHead className="text-right">Importe retenido</TableHead>
                          <TableHead className="text-right">Total CFDI</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={retainedTaxesFilters.issuanceDate || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.uuid || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.issuerRfc || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.issuerName || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.receiverRfc || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, receiverRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.cfdiType || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, cfdiType: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.series || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.folio || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.taxLabel || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, taxLabel: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.taxCode || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, taxCode: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.taxAmount || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, taxAmount: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={retainedTaxesFilters.total || ''} onChange={(e) => setRetainedTaxesFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRetainedTaxesRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                              No se encontraron retenciones con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredRetainedTaxesRows.map((row) => (
                            <TableRow key={`${row.uuid}-${row.taxCode}`}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.receiverRfc}</TableCell>
                              <TableCell>{row.cfdiType}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell>{row.taxLabel}</TableCell>
                              <TableCell>{row.taxCode}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.taxAmount)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredRetainedTaxesRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={10}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(retainedTaxesStats.total)}</TableCell>
                            <TableCell />
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={paidInPeriodDialogOpen} onOpenChange={handlePaidInPeriodDialogOpenChange}>
          {paidInPeriodDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Resumen de Pagos y Saldos: Total Pagado en el Periodo</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Suma facturas `PUE` emitidas en el rango y abonos `PPD` cuya `FechaPago` del REP cae dentro del periodo.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {paidInPeriodStats.startDate} - {paidInPeriodStats.endDate}</li>
                    <li>Total pagado visible: {formatMXN(paidInPeriodStats.total)}</li>
                    <li>Proveedores visibles: {paidInPeriodStats.supplierCount}</li>
                    <li>Pagos visibles: {paidInPeriodStats.paymentCount}</li>
                  </ul>
                </div>
              </div>
              {!paidInPeriodDialogLoading && paidInPeriodRows.length > 0 && (
                <Button onClick={handleExportPaidInPeriod} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {paidInPeriodDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando reporte de pagos del periodo...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha de pago</TableHead>
                          <TableHead>UUID factura</TableHead>
                          <TableHead>UUID pago</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>RFC Receptor</TableHead>
                          <TableHead>Método</TableHead>
                          <TableHead>Origen</TableHead>
                          <TableHead>Parcialidad</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead className="text-right">Monto pagado</TableHead>
                          <TableHead className="text-right">Saldo anterior</TableHead>
                          <TableHead className="text-right">Saldo insoluto</TableHead>
                          <TableHead>Moneda</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={paidInPeriodFilters.paymentDate || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, paymentDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.invoiceUuid || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, invoiceUuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.paymentUuid || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, paymentUuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.issuerRfc || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.issuerName || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.receiverRfc || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, receiverRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.paymentMethod || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, paymentMethod: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.paymentSource || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, paymentSource: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.partialityNumber || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, partialityNumber: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.series || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.folio || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.amountPaid || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, amountPaid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.previousBalance || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, previousBalance: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.outstandingBalance || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, outstandingBalance: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paidInPeriodFilters.currency || ''} onChange={(e) => setPaidInPeriodFilters(prev => ({ ...prev, currency: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPaidInPeriodRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={15} className="text-center text-muted-foreground py-8">
                              No se encontraron pagos con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredPaidInPeriodRows.map((row, index) => (
                            <TableRow key={`${row.paymentUuid}-${row.invoiceUuid}-${index}`}>
                              <TableCell>{row.paymentDate ? new Date(row.paymentDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.invoiceUuid}</TableCell>
                              <TableCell className="font-mono">{row.paymentUuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.receiverRfc}</TableCell>
                              <TableCell>{row.paymentMethod}</TableCell>
                              <TableCell>{row.paymentSource}</TableCell>
                              <TableCell>{row.partialityNumber}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.amountPaid)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.previousBalance)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.outstandingBalance)}</TableCell>
                              <TableCell>{row.currency}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredPaidInPeriodRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={11}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(paidInPeriodStats.total)}</TableCell>
                            <TableCell colSpan={3} />
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={outstandingBalanceDialogOpen} onOpenChange={handleOutstandingBalanceDialogOpenChange}>
          {outstandingBalanceDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Resumen de Pagos y Saldos: Saldo Pendiente de Pago</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Calcula el saldo actual por factura tipo `I`, usando preferentemente el `ImpSaldoInsoluto` del último REP asociado.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {outstandingBalanceStats.startDate} - {outstandingBalanceStats.endDate}</li>
                    <li>Saldo pendiente visible: {formatMXN(outstandingBalanceStats.total)}</li>
                    <li>Proveedores visibles: {outstandingBalanceStats.supplierCount}</li>
                    <li>CFDI visibles: {outstandingBalanceStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!outstandingBalanceDialogLoading && outstandingBalanceRows.length > 0 && (
                <Button onClick={handleExportOutstandingBalance} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {outstandingBalanceDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando reporte de saldos pendientes...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>RFC Receptor</TableHead>
                          <TableHead>Método</TableHead>
                          <TableHead>Moneda</TableHead>
                          <TableHead className="text-right">Total original</TableHead>
                          <TableHead className="text-right">Total pagado</TableHead>
                          <TableHead className="text-right">Saldo pendiente</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={outstandingBalanceFilters.issuanceDate || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.uuid || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.issuerRfc || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.issuerName || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.receiverRfc || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, receiverRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.paymentMethod || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, paymentMethod: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.currency || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, currency: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.total || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.totalPaid || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, totalPaid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={outstandingBalanceFilters.outstandingBalance || ''} onChange={(e) => setOutstandingBalanceFilters(prev => ({ ...prev, outstandingBalance: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOutstandingBalanceRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                              No se encontraron saldos pendientes con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredOutstandingBalanceRows.map((row) => (
                            <TableRow key={row.uuid}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.receiverRfc}</TableCell>
                              <TableCell>{row.paymentMethod}</TableCell>
                              <TableCell>{row.currency}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.totalPaid)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.outstandingBalance)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredOutstandingBalanceRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={9}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(outstandingBalanceStats.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={agingBalanceDialogOpen} onOpenChange={handleAgingBalanceDialogOpenChange}>
          {agingBalanceDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Resumen de Pagos y Saldos: Antigüedad de Saldos</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Clasifica facturas con saldo pendiente mayor a cero usando su `issuanceDate` contra la fecha actual.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {agingBalanceStats.startDate} - {agingBalanceStats.endDate}</li>
                    <li>Saldo visible: {formatMXN(agingBalanceStats.total)}</li>
                    <li>Proveedores visibles: {agingBalanceStats.supplierCount}</li>
                    <li>CFDI visibles: {agingBalanceStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!agingBalanceDialogLoading && agingBalanceRows.length > 0 && (
                <Button onClick={handleExportAgingBalance} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {agingBalanceDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando reporte de antigüedad de saldos...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>RFC Receptor</TableHead>
                          <TableHead>Método</TableHead>
                          <TableHead>Moneda</TableHead>
                          <TableHead>Días</TableHead>
                          <TableHead>Bucket</TableHead>
                          <TableHead className="text-right">Total original</TableHead>
                          <TableHead className="text-right">Total pagado</TableHead>
                          <TableHead className="text-right">Saldo pendiente</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={agingBalanceFilters.issuanceDate || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.uuid || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.issuerRfc || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.issuerName || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.receiverRfc || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, receiverRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.paymentMethod || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, paymentMethod: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.currency || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, currency: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.ageDays || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, ageDays: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.ageBucket || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, ageBucket: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.total || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.totalPaid || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, totalPaid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={agingBalanceFilters.outstandingBalance || ''} onChange={(e) => setAgingBalanceFilters(prev => ({ ...prev, outstandingBalance: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAgingBalanceRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                              No se encontraron saldos vencidos con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredAgingBalanceRows.map((row) => (
                            <TableRow key={`${row.uuid}-${row.ageBucket}`}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.receiverRfc}</TableCell>
                              <TableCell>{row.paymentMethod}</TableCell>
                              <TableCell>{row.currency}</TableCell>
                              <TableCell>{row.ageDays}</TableCell>
                              <TableCell>{row.ageBucket}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.totalPaid)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.outstandingBalance)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredAgingBalanceRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={11}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(agingBalanceStats.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={efosDialogOpen} onOpenChange={handleEfosDialogOpenChange}>
          {efosDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Auditoría Fiscal: XMLs en riesgo por EFOS / Lista 69-B</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Resumen de consulta:</strong></p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {efosRiskStats.startDate} - {efosRiskStats.endDate}</li>
                    <li>Monto en riesgo visible: {formatMXN(efosRiskStats.total)}</li>
                    <li>Proveedores visibles en riesgo: {efosRiskStats.supplierCount}</li>
                    <li>CFDI visibles en riesgo: {efosRiskStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!efosDialogLoading && efosRiskRows.length > 0 && (
                <Button onClick={handleExportEfosRisk} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {efosDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando XMLs en riesgo...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>Tipo CFDI</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead>Estatus 69-B</TableHead>
                          <TableHead>Estado SAT</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={efosRiskFilters.issuanceDate || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.uuid || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.issuerRfc || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.issuerName || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.cfdiType || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, cfdiType: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.series || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.folio || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.efosStatusBucket || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, efosStatusBucket: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.satEstado || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, satEstado: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={efosRiskFilters.total || ''} onChange={(e) => setEfosRiskFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredEfosRiskRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                              No se encontraron XMLs en riesgo por EFOS con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredEfosRiskRows.map((row) => (
                            <TableRow key={row.uuid}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.cfdiType}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell title={row.efosStatusLabel}>{row.efosStatusBucket}</TableCell>
                              <TableCell>{row.satEstado}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredEfosRiskRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={9}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(efosRiskStats.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={postLoadCancellationDialogOpen} onOpenChange={handlePostLoadCancellationDialogOpenChange}>
          {postLoadCancellationDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Auditoría Fiscal: Alertas de Cancelación Post-Carga</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Resumen de consulta:</strong></p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Ventana: Últimos 30 días</li>
                    <li>Monto visible cancelado: {formatMXN(postLoadCancellationStats.total)}</li>
                    <li>Proveedores visibles: {postLoadCancellationStats.supplierCount}</li>
                    <li>CFDI visibles: {postLoadCancellationStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!postLoadCancellationDialogLoading && postLoadCancellationRows.length > 0 && (
                <Button onClick={handleExportPostLoadCancellation} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {postLoadCancellationDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando alertas de cancelación post-carga...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha detección</TableHead>
                          <TableHead>Fecha CFDI</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>Tipo CFDI</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead>Estado inicial</TableHead>
                          <TableHead>Estado actual</TableHead>
                          <TableHead>Estatus cancelación</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={postLoadCancellationFilters.detectedAt || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, detectedAt: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.issuanceDate || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.uuid || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.issuerRfc || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.issuerName || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.cfdiType || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, cfdiType: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.series || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.folio || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.satInitialEstado || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, satInitialEstado: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.satEstado || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, satEstado: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.satEstatusCancelacion || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, satEstatusCancelacion: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={postLoadCancellationFilters.total || ''} onChange={(e) => setPostLoadCancellationFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPostLoadCancellationRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                              No se encontraron facturas con cancelación post-carga en los últimos 30 días con los filtros actuales.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredPostLoadCancellationRows.map((row) => (
                            <TableRow key={`${row.uuid}-${row.detectedAt || 'na'}`}>
                              <TableCell>{row.detectedAt ? new Date(row.detectedAt).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.cfdiType}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell>{row.satInitialEstado}</TableCell>
                              <TableCell>{row.satEstado}</TableCell>
                              <TableCell title={row.satEsCancelable || undefined}>{row.satEstatusCancelacion || '-'}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredPostLoadCancellationRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={11}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(postLoadCancellationStats.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={paymentMethodVsPaymentFormDialogOpen} onOpenChange={handlePaymentMethodVsPaymentFormDialogOpenChange}>
          {paymentMethodVsPaymentFormDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Regla: Validación del método de pago vs Forma de pago</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Si `MetodoPago = PUE`, entonces `FormaPago` no debe ser `99`.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {paymentMethodVsPaymentFormStats.startDate} - {paymentMethodVsPaymentFormStats.endDate}</li>
                    <li>Monto visible en incumplimiento: {formatMXN(paymentMethodVsPaymentFormStats.total)}</li>
                    <li>Proveedores visibles: {paymentMethodVsPaymentFormStats.supplierCount}</li>
                    <li>CFDI visibles: {paymentMethodVsPaymentFormStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!paymentMethodVsPaymentFormDialogLoading && paymentMethodVsPaymentFormRows.length > 0 && (
                <Button onClick={handleExportPaymentMethodVsPaymentForm} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {paymentMethodVsPaymentFormDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando CFDI incumplidos...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>Tipo CFDI</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead>MetodoPago</TableHead>
                          <TableHead>FormaPago</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.issuanceDate || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.uuid || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.issuerRfc || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.issuerName || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.cfdiType || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, cfdiType: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.series || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.folio || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.paymentMethod || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, paymentMethod: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.paymentForm || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, paymentForm: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={paymentMethodVsPaymentFormFilters.total || ''} onChange={(e) => setPaymentMethodVsPaymentFormFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPaymentMethodVsPaymentFormRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                              No se encontraron CFDI incumplidos con la regla MetodoPago PUE vs FormaPago 99.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredPaymentMethodVsPaymentFormRows.map((row) => (
                            <TableRow key={row.uuid}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.cfdiType}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell>{row.paymentMethod || '-'}</TableCell>
                              <TableCell>{row.paymentForm || '-'}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredPaymentMethodVsPaymentFormRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={9}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(paymentMethodVsPaymentFormStats.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={resicoRetentionDialogOpen} onOpenChange={handleResicoRetentionDialogOpenChange}>
          {resicoRetentionDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Regla: Validación de proveedores del RESICO</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Si `RegimenFiscalEmisor = 626`, el `RfcReceptor` es Persona Moral y no existe retención ISR `0.012500`, el CFDI incumple.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {resicoRetentionStats.startDate} - {resicoRetentionStats.endDate}</li>
                    <li>Monto visible en incumplimiento: {formatMXN(resicoRetentionStats.total)}</li>
                    <li>Proveedores visibles: {resicoRetentionStats.supplierCount}</li>
                    <li>CFDI visibles: {resicoRetentionStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!resicoRetentionDialogLoading && resicoRetentionRows.length > 0 && (
                <Button onClick={handleExportResicoRetention} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {resicoRetentionDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando CFDI incumplidos...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>RFC Receptor</TableHead>
                          <TableHead>Regimen Fiscal Emisor</TableHead>
                          <TableHead>Tipo CFDI</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead>Retención ISR 0.012500</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={resicoRetentionFilters.issuanceDate || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.uuid || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.issuerRfc || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.issuerName || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.receiverRfc || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, receiverRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.issuerFiscalRegime || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, issuerFiscalRegime: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.cfdiType || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, cfdiType: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.series || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.folio || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.hasResicoIsrRetention || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, hasResicoIsrRetention: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={resicoRetentionFilters.total || ''} onChange={(e) => setResicoRetentionFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResicoRetentionRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                              No se encontraron CFDI incumplidos con la regla RESICO.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredResicoRetentionRows.map((row) => (
                            <TableRow key={row.uuid}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.receiverRfc}</TableCell>
                              <TableCell>{row.issuerFiscalRegime || '-'}</TableCell>
                              <TableCell>{row.cfdiType}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell>{row.hasResicoIsrRetention ? 'SI' : 'NO'}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredResicoRetentionRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={10}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(resicoRetentionStats.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>

        <Dialog open={objetoImpTaxDialogOpen} onOpenChange={handleObjetoImpTaxDialogOpenChange}>
          {objetoImpTaxDialogOpen && (
          <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
            <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
              <div>
                <DialogTitle>Regla: Validación de Objeto de Impuesto vs Impuestos Trasladados</DialogTitle>
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Condición:</strong> Si `ObjetoImp=02`, cada concepto debe traer traslado IVA desglosado. Si `ObjetoImp=01/03`, no debe existir traslado IVA en ese concepto.</p>
                  <ul className="list-disc list-inside pl-4">
                    <li>Empresa: {currentMetrics.company.rfc || selectedCompany?.rfc || 'N/A'}</li>
                    <li>Fecha: {objetoImpTaxStats.startDate} - {objetoImpTaxStats.endDate}</li>
                    <li>Monto visible en incumplimiento: {formatMXN(objetoImpTaxStats.total)}</li>
                    <li>Proveedores visibles: {objetoImpTaxStats.supplierCount}</li>
                    <li>CFDI visibles: {objetoImpTaxStats.cfdiCount}</li>
                  </ul>
                </div>
              </div>
              {!objetoImpTaxDialogLoading && objetoImpTaxRows.length > 0 && (
                <Button onClick={handleExportObjetoImpTax} variant="outline" size="sm" className="shrink-0">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {objetoImpTaxDialogLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Cargando CFDI incumplidos...
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                  <div data-slot="table-container" className="rounded-md border h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead>RFC Emisor</TableHead>
                          <TableHead>Proveedor</TableHead>
                          <TableHead>RFC Receptor</TableHead>
                          <TableHead>Tipo CFDI</TableHead>
                          <TableHead>Serie</TableHead>
                          <TableHead>Folio</TableHead>
                          <TableHead>Inconsistencia</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                        <TableRow>
                          <TableCell><Input value={objetoImpTaxFilters.issuanceDate || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, issuanceDate: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.uuid || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, uuid: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.issuerRfc || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, issuerRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.issuerName || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, issuerName: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.receiverRfc || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, receiverRfc: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.cfdiType || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, cfdiType: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.series || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, series: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.folio || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, folio: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.inconsistencyReason || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, inconsistencyReason: e.target.value }))} placeholder="Filtrar" /></TableCell>
                          <TableCell><Input value={objetoImpTaxFilters.total || ''} onChange={(e) => setObjetoImpTaxFilters(prev => ({ ...prev, total: e.target.value }))} placeholder="Filtrar" /></TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredObjetoImpTaxRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                              No se encontraron CFDI incumplidos con la regla ObjetoImp vs IVA.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredObjetoImpTaxRows.map((row) => (
                            <TableRow key={row.uuid}>
                              <TableCell>{row.issuanceDate ? new Date(row.issuanceDate).toLocaleDateString('es-MX') : '-'}</TableCell>
                              <TableCell className="font-mono">{row.uuid}</TableCell>
                              <TableCell>{row.issuerRfc}</TableCell>
                              <TableCell>{row.issuerName}</TableCell>
                              <TableCell>{row.receiverRfc}</TableCell>
                              <TableCell>{row.cfdiType}</TableCell>
                              <TableCell>{row.series || '-'}</TableCell>
                              <TableCell>{row.folio || '-'}</TableCell>
                              <TableCell>{formatObjetoImpReason(row.inconsistencyReason)}</TableCell>
                              <TableCell className="text-right">{formatMXN(row.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        {filteredObjetoImpTaxRows.length > 0 && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell colSpan={9}>Total</TableCell>
                            <TableCell className="text-right">{formatMXN(objetoImpTaxStats.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          )}
        </Dialog>
      </div>
    </ProtectedRoute>
    </TooltipProvider>
  )
}

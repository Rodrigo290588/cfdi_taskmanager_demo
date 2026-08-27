'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  Eye,
  RefreshCw,
  Search,
  Zap
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'

type Pagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

type ImportRun = {
  id: string
  organizationId: string
  source: string
  batchId: string | null
  directorySessionId: string | null
  status: string
  totalItems: number
  processedItems: number
  createdEmitted: number
  createdReceived: number
  skippedItems: number
  errorItems: number
  waitingExternalValidationItems: number
  startedAt: string | null
  finishedAt: string | null
  directoryExecutionId: string | null
  directoryTotalXmlFiles: number | null
  directorySkippedByProgressFiles: number | null
  directoryNewXmlFiles: number | null
  createdAt: string
  updatedAt: string
  directoryControl: ImportRunDirectoryControl
  progressPercent: number
  throughputPerMinute: number
}

type ImportRunDirectoryControl = {
  hasDirectoryControl: boolean
  executionId: string | null
  totalXmlFiles: number | null
  skippedByProgressFiles: number | null
  newXmlFiles: number | null
  acceptedItems: number
  processedItems: number
  acceptanceGap: number | null
  processingGap: number | null
}

type DirectoryControlStats = {
  totalXmlFiles: number
  skippedByProgressFiles: number
  newXmlFiles: number
  acceptedItems: number
  processedItems: number
  acceptanceGap: number
  processingGap: number
  matchedDirectorySessions: number
}

type ImportRunItem = {
  id: string
  importRunId?: string
  fileName: string
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
  classificationResult: string
  direction: string | null
  status: string
  validationStatus: string | null
  validationBucket: string | null
  errorCode: string | null
  errorMessage: string | null
  attemptCountInternal: number
  attemptCountExternal: number
  nextExternalRetryAt: string | null
  processingStartedAt: string | null
  processingFinishedAt: string | null
  createdAt: string
  updatedAt: string
}

interface MonitorStats {
  totalItems: number
  processedItems: number
  createdEmitted: number
  createdReceived: number
  skippedItems: number
  errorItems: number
  waitingExternalValidationItems: number
  activeRuns: number
  completedRuns: number
  completedWithErrorsRuns: number
  failedRuns: number
  directoryControl: DirectoryControlStats
  recentRuns: ImportRun[]
  recentItems: ImportRunItem[]
  timestamp: number
}

type RunsResponse = {
  success: true
  pagination: Pagination
  runs: ImportRun[]
}

type RunItemsResponse = {
  success: true
  importRun: ImportRun
  pagination: Pagination
  items: ImportRunItem[]
}

type ItemDetailResponse = {
  success: true
  item: ImportRunItem
}

type ItemDetailState = {
  open: boolean
  loading: boolean
  item: ImportRunItem | null
  error: string | null
}

type ImportErrorDrilldownRow = {
  id: string
  importRunId: string
  fileName: string
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
  direction: string | null
  classificationResult: string
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  documentDate: string | null
  source: string
  batchId: string | null
  runStatus: string
  runStartedAt: string | null
  runFinishedAt: string | null
}

type ImportErrorDrilldownResponse = {
  success: true
  data: ImportErrorDrilldownRow[]
}

type ImportErrorDrilldownState = {
  open: boolean
  loading: boolean
  rows: ImportErrorDrilldownRow[]
  error: string | null
}

type ImportErrorDrilldownFilters = {
  issuerRfc?: string
  receiverRfc?: string
  createdAt?: string
  documentDate?: string
  direction?: string
  errorReason?: string
}

const ALL_FILTER = '__ALL__'

const runStatusOptions = [
  'QUEUED',
  'DISPATCHING',
  'PROCESSING',
  'PROCESSING_WITH_EXTERNAL_WAIT',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED'
]

const runSourceOptions = ['JAVA_M2M', 'PROVIDER_PORTAL', 'MANUAL_ADMIN']
const itemStatusOptions = [
  'QUEUED',
  'PREPARING',
  'PREPARED',
  'VALIDATING_INTERNAL',
  'WAITING_EXTERNAL_VALIDATION',
  'VALIDATING_EXTERNAL',
  'VALIDATED',
  'PERSISTING',
  'PERSISTED',
  'SKIPPED',
  'FAILED',
  'CANCELLED'
]
const itemDirectionOptions = ['EMITTED', 'RECEIVED']
const validationBucketOptions = ['VALIDO', 'INVALIDO']

const runStatusLabels: Record<string, string> = {
  QUEUED: 'En cola',
  DISPATCHING: 'Despachando',
  PROCESSING: 'Procesando',
  PROCESSING_WITH_EXTERNAL_WAIT: 'Procesando con espera externa',
  COMPLETED: 'Completada',
  COMPLETED_WITH_ERRORS: 'Completada con errores',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada'
}

const runSourceLabels: Record<string, string> = {
  JAVA_M2M: 'Cliente Java M2M',
  PROVIDER_PORTAL: 'Portal de proveedores',
  MANUAL_ADMIN: 'Carga manual administrativa'
}

const itemStatusLabels: Record<string, string> = {
  QUEUED: 'En cola',
  PREPARING: 'Preparando',
  PREPARED: 'Preparado',
  VALIDATING_INTERNAL: 'Validando interno',
  WAITING_EXTERNAL_VALIDATION: 'Esperando validacion externa',
  VALIDATING_EXTERNAL: 'Validando externo',
  VALIDATED: 'Validado',
  PERSISTING: 'Persistiendo',
  PERSISTED: 'Persistido',
  SKIPPED: 'Omitido',
  FAILED: 'Fallido',
  CANCELLED: 'Cancelado'
}

const itemDirectionLabels: Record<string, string> = {
  EMITTED: 'Emitido',
  RECEIVED: 'Recibido'
}

const validationBucketLabels: Record<string, string> = {
  VALIDO: 'Valido',
  INVALIDO: 'Invalido'
}

type QuickRangeKey = 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH'

const quickRangeOptions: Array<{ key: QuickRangeKey, label: string }> = [
  { key: 'TODAY', label: 'Hoy' },
  { key: 'LAST_7_DAYS', label: 'Últimos 7 días' },
  { key: 'LAST_30_DAYS', label: 'Últimos 30 días' },
  { key: 'THIS_MONTH', label: 'Este mes' }
]

function formatDateForInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getQuickRangeDates(rangeKey: QuickRangeKey) {
  const endDate = new Date()
  const startDate = new Date(endDate)

  switch (rangeKey) {
    case 'TODAY':
      break
    case 'LAST_7_DAYS':
      startDate.setDate(startDate.getDate() - 6)
      break
    case 'LAST_30_DAYS':
      startDate.setDate(startDate.getDate() - 29)
      break
    case 'THIS_MONTH':
      startDate.setDate(1)
      break
  }

  return {
    startDate: formatDateForInput(startDate),
    endDate: formatDateForInput(endDate)
  }
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Sin fecha'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha'
  }

  return date.toLocaleString('es-MX')
}

function formatDateOnly(value: string | null) {
  if (!value) {
    return 'Sin fecha'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString('es-MX')
}

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) {
    return 'Sin iniciar'
  }

  const startDate = new Date(startedAt)
  const endDate = finishedAt ? new Date(finishedAt) : new Date()

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Sin duración'
  }

  const elapsedMs = Math.max(0, endDate.getTime() - startDate.getTime())
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  parts.push(`${seconds}s`)

  return parts.join(' ')
}

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case 'COMPLETED':
    case 'PERSISTED':
    case 'VALIDATED':
    case 'APPROVED':
      return 'default'
    case 'COMPLETED_WITH_ERRORS':
    case 'WAITING_EXTERNAL_VALIDATION':
    case 'SKIPPED':
      return 'secondary'
    case 'FAILED':
    case 'CANCELLED':
    case 'REJECTED':
      return 'destructive'
    default:
      return 'outline'
  }
}

function truncateText(value: string | null, maxLength = 90) {
  if (!value) {
    return ''
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function normalizeFilterText(value: string | null | undefined) {
  return (value || '').toLowerCase().trim()
}

function getRunStatusLabel(status: string) {
  return runStatusLabels[status] || status
}

function getRunSourceLabel(source: string) {
  return runSourceLabels[source] || source
}

function getItemStatusLabel(status: string) {
  return itemStatusLabels[status] || status
}

function getItemDirectionLabel(direction: string | null) {
  if (!direction) {
    return 'Sin direccion'
  }

  return itemDirectionLabels[direction] || direction
}

function getClassificationLabel(classificationResult: string) {
  switch (classificationResult) {
    case 'EMITTED':
      return 'Emitido'
    case 'RECEIVED':
      return 'Recibido'
    case 'BOTH':
      return 'Emitido y recibido (intragrupo)'
    case 'NONE':
      return 'Sin clasificación'
    default:
      return classificationResult
  }
}

function getImportErrorDirectionLabel(item: Pick<ImportErrorDrilldownRow, 'direction' | 'classificationResult'>) {
  if (item.direction) {
    return getItemDirectionLabel(item.direction)
  }

  return getClassificationLabel(item.classificationResult)
}

function getImportErrorReason(item: Pick<ImportErrorDrilldownRow, 'errorCode' | 'errorMessage'>) {
  if (item.errorMessage?.trim()) {
    return item.errorMessage.trim()
  }

  return item.errorCode || 'Sin detalle'
}

// (Antigua función escapeCsv ELIMINADA. Reemplazada por escapeCsvSafe() arriba
// que protege contra CSV Formula Injection — DASH-SAST-003 FIX.)

function getValidationBucketLabel(bucket: string | null) {
  if (!bucket) {
    return 'Sin resultado'
  }

  return validationBucketLabels[bucket] || bucket
}

function getGapTextClass(value: number | null) {
  if (value === null) {
    return 'text-muted-foreground'
  }

  return value === 0 ? 'text-emerald-600' : 'text-amber-600'
}

// ============================================================
// DASH-SAST-003: escapeCsvSafe protege contra CSV Formula Injection
// (CWE-1236 / OWASP A03:2021 Injection).
// Neutraliza: =, +, -, @, |, \t (tab), \r (CR) como prefijos de celda
// anteponiendo una apostrofe invisible (Excel/Calc interpretan TEXTO).
// ============================================================
const CSV_DANGEROUS_PREFIX = /^[=+\-@|\t\r]/;
function escapeCsvSafe(value: unknown): string {
  if (value === null || typeof value === 'undefined') return '""';
  let str = String(value);
  if (CSV_DANGEROUS_PREFIX.test(str)) {
    // Apostrofe inicial: Excel/Calc muestra TEXTO (no ejecuta fórmula).
    // La apostrofe NO aparece en la celda al abrir.
    str = "'" + str;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes('\t')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function ImportMonitorPage() {
  const [stats, setStats] = useState<MonitorStats | null>(null)
  const [speed, setSpeed] = useState(0)
  const [isLive, setIsLive] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [runsResponse, setRunsResponse] = useState<RunsResponse | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false)
  const [runItemsResponse, setRunItemsResponse] = useState<RunItemsResponse | null>(null)
  const [runSearch, setRunSearch] = useState('')
  const [runStatusFilter, setRunStatusFilter] = useState(ALL_FILTER)
  const [runSourceFilter, setRunSourceFilter] = useState(ALL_FILTER)
  const [runStartDateFilter, setRunStartDateFilter] = useState('')
  const [runEndDateFilter, setRunEndDateFilter] = useState('')
  const [itemStatusFilter, setItemStatusFilter] = useState(ALL_FILTER)
  const [itemDirectionFilter, setItemDirectionFilter] = useState(ALL_FILTER)
  const [itemValidationBucketFilter, setItemValidationBucketFilter] = useState(ALL_FILTER)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [runPage, setRunPage] = useState(1)
  const [itemPage, setItemPage] = useState(1)
  const [isLoadingRuns, setIsLoadingRuns] = useState(false)
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [errorDrilldownState, setErrorDrilldownState] = useState<ImportErrorDrilldownState>({
    open: false,
    loading: false,
    rows: [],
    error: null
  })
  const [errorDrilldownFilters, setErrorDrilldownFilters] = useState<ImportErrorDrilldownFilters>({})
  const [itemDetailState, setItemDetailState] = useState<ItemDetailState>({
    open: false,
    loading: false,
    item: null,
    error: null
  })
  const lastStatsRef = useRef<MonitorStats | null>(null)
  const lastStatsQueryRef = useRef<string | null>(null)
  const hasRunFiltersActive = Boolean(
    runSearch.trim()
    || runStatusFilter !== ALL_FILTER
    || runSourceFilter !== ALL_FILTER
    || runStartDateFilter
    || runEndDateFilter
  )

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    const abortCtl = new AbortController()
    let consecErrors = 0
    let destroyed = false

    const fetchStats = async () => {
      if (destroyed || abortCtl.signal.aborted) return
      try {
        const params = new URLSearchParams()

        if (runSearch.trim()) {
          params.set('search', runSearch.trim())
        }

        if (runStatusFilter !== ALL_FILTER) {
          params.set('status', runStatusFilter)
        }

        if (runSourceFilter !== ALL_FILTER) {
          params.set('source', runSourceFilter)
        }

        if (runStartDateFilter) {
          params.set('startDate', runStartDateFilter)
        }

        if (runEndDateFilter) {
          params.set('endDate', runEndDateFilter)
        }

        const queryString = params.toString()
        const statsQueryKey = queryString || '__all__'

        if (lastStatsQueryRef.current !== statsQueryKey) {
          lastStatsRef.current = null
          lastStatsQueryRef.current = statsQueryKey
          setSpeed(0)
        }

        const response = await fetch(
          `/api/monitor/stats${queryString ? `?${queryString}` : ''}`,
          { cache: 'no-store', signal: abortCtl.signal }
        )

        if (!response.ok) {
          throw new Error(`Failed to fetch import monitor stats HTTP ${response.status}`)
        }

        const data: MonitorStats = await response.json()

        if (lastStatsRef.current) {
          const diff = data.processedItems - lastStatsRef.current.processedItems
          const timeDiff = (data.timestamp - lastStatsRef.current.timestamp) / 1000

          if (timeDiff > 0) {
            setSpeed(Math.max(0, Math.round(diff / timeDiff)))
          }
        }

        setIsLive(data.activeRuns > 0)
        lastStatsRef.current = data
        setStats(data)
        consecErrors = 0
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return
        console.error(error)
        setIsLive(false)
        consecErrors = Math.min(consecErrors + 1, 6)
      } finally {
        if (destroyed) return
        // --- IM-007 FIX · Exponential backoff + jitter · Anti thundering-herd cascade ---
        const baseMs = 2000
        const backoff = Math.min(baseMs * Math.pow(2, consecErrors), 30000)
        const jitterPct = 0.15
        const jitterMs = backoff * jitterPct * (Math.random() * 2 - 1)
        const nextDelay = Math.max(500, Math.round(backoff + jitterMs))
        pollTimer = setTimeout(fetchStats, nextDelay)
      }
    }

    fetchStats()

    return () => {
      destroyed = true
      if (pollTimer) clearTimeout(pollTimer)
      try { abortCtl.abort() } catch { /* ignore */ }
    }
  }, [
    refreshNonce,
    runSearch,
    runStatusFilter,
    runSourceFilter,
    runStartDateFilter,
    runEndDateFilter
  ])

  useEffect(() => {
    const fetchRuns = async () => {
      if (!hasRunFiltersActive) {
        setRunsResponse(null)
        setSelectedRunId(null)
        return
      }

      try {
        setIsLoadingRuns(true)

        const params = new URLSearchParams({
          page: String(runPage),
          pageSize: '10'
        })

        if (runSearch.trim()) {
          params.set('search', runSearch.trim())
        }

        if (runStatusFilter !== ALL_FILTER) {
          params.set('status', runStatusFilter)
        }

        if (runSourceFilter !== ALL_FILTER) {
          params.set('source', runSourceFilter)
        }

        if (runStartDateFilter) {
          params.set('startDate', runStartDateFilter)
        }

        if (runEndDateFilter) {
          params.set('endDate', runEndDateFilter)
        }

        const response = await fetch(`/api/monitor/runs?${params.toString()}`, { cache: 'no-store' })

        if (!response.ok) {
          throw new Error('Failed to fetch import runs')
        }

        const data: RunsResponse = await response.json()
        setRunsResponse(data)
        setSelectedRunId(current => {
          if (!data.runs.length) {
            return null
          }

          if (current && data.runs.some(run => run.id === current)) {
            return current
          }

          return data.runs[0].id
        })
      } catch (error) {
        console.error(error)
        setRunsResponse(null)
      } finally {
        setIsLoadingRuns(false)
      }
    }

    fetchRuns()
  }, [
    hasRunFiltersActive,
    refreshNonce,
    runPage,
    runSearch,
    runSourceFilter,
    runStatusFilter,
    runStartDateFilter,
    runEndDateFilter
  ])

  useEffect(() => {
    const fetchRunItems = async () => {
      if (!documentsDialogOpen || !selectedRunId) {
        return
      }

      try {
        setIsLoadingItems(true)

        const params = new URLSearchParams({
          page: String(itemPage),
          pageSize: '10'
        })

        if (itemStatusFilter !== ALL_FILTER) {
          params.set('status', itemStatusFilter)
        }

        if (itemDirectionFilter !== ALL_FILTER) {
          params.set('direction', itemDirectionFilter)
        }

        if (itemValidationBucketFilter !== ALL_FILTER) {
          params.set('validationBucket', itemValidationBucketFilter)
        }

        if (onlyErrors) {
          params.set('hasErrors', 'true')
        }

        const response = await fetch(`/api/monitor/runs/${selectedRunId}/items?${params.toString()}`, {
          cache: 'no-store'
        })

        if (!response.ok) {
          throw new Error('Failed to fetch import run items')
        }

        const data: RunItemsResponse = await response.json()
        setRunItemsResponse(data)
      } catch (error) {
        console.error(error)
        setRunItemsResponse(null)
      } finally {
        setIsLoadingItems(false)
      }
    }

    fetchRunItems()
  }, [
    documentsDialogOpen,
    selectedRunId,
    itemPage,
    itemStatusFilter,
    itemDirectionFilter,
    itemValidationBucketFilter,
    onlyErrors,
    refreshNonce
  ])

  const selectedRun = useMemo(() => {
    if (runItemsResponse?.importRun && runItemsResponse.importRun.id === selectedRunId) {
      return runItemsResponse.importRun
    }

    return runsResponse?.runs.find(run => run.id === selectedRunId) || null
  }, [runItemsResponse, runsResponse, selectedRunId])

  const progressPercentage = stats
    ? Math.min(100, stats.totalItems > 0 ? (stats.processedItems / stats.totalItems) * 100 : 0)
    : 0
  const directoryControl = stats?.directoryControl ?? {
    totalXmlFiles: 0,
    skippedByProgressFiles: 0,
    newXmlFiles: 0,
    acceptedItems: 0,
    processedItems: 0,
    acceptanceGap: 0,
    processingGap: 0,
    matchedDirectorySessions: 0
  }

  const filteredErrorDrilldownRows = useMemo(() => {
    return errorDrilldownState.rows.filter(row => {
      const issuerRfc = normalizeFilterText(row.issuerRfc)
      const receiverRfc = normalizeFilterText(row.receiverRfc)
      const createdAt = normalizeFilterText(formatDateTime(row.createdAt))
      const documentDate = normalizeFilterText(formatDateOnly(row.documentDate))
      const direction = normalizeFilterText(getImportErrorDirectionLabel(row))
      const errorReason = normalizeFilterText(getImportErrorReason(row))

      return (
        issuerRfc.includes(normalizeFilterText(errorDrilldownFilters.issuerRfc))
        && receiverRfc.includes(normalizeFilterText(errorDrilldownFilters.receiverRfc))
        && createdAt.includes(normalizeFilterText(errorDrilldownFilters.createdAt))
        && documentDate.includes(normalizeFilterText(errorDrilldownFilters.documentDate))
        && direction.includes(normalizeFilterText(errorDrilldownFilters.direction))
        && errorReason.includes(normalizeFilterText(errorDrilldownFilters.errorReason))
      )
    })
  }, [errorDrilldownFilters, errorDrilldownState.rows])

  const activeQuickRange = useMemo(() => {
    if (!runStartDateFilter || !runEndDateFilter) {
      return null
    }

    const matchedRange = quickRangeOptions.find(option => {
      const range = getQuickRangeDates(option.key)
      return range.startDate === runStartDateFilter && range.endDate === runEndDateFilter
    })

    return matchedRange?.key || null
  }, [runEndDateFilter, runStartDateFilter])

  const resetRunFilters = () => {
    setRunSearch('')
    setRunStatusFilter(ALL_FILTER)
    setRunSourceFilter(ALL_FILTER)
    setRunStartDateFilter('')
    setRunEndDateFilter('')
    setRunPage(1)
  }

  const resetItemFilters = () => {
    setItemStatusFilter(ALL_FILTER)
    setItemDirectionFilter(ALL_FILTER)
    setItemValidationBucketFilter(ALL_FILTER)
    setOnlyErrors(false)
    setItemPage(1)
  }

  const resetErrorDrilldownFilters = () => {
    setErrorDrilldownFilters({})
  }

  const openDocumentsDialog = (runId: string) => {
    resetItemFilters()
    setSelectedRunId(runId)
    setRunItemsResponse(null)
    setDocumentsDialogOpen(true)
  }

  const applyQuickRange = (rangeKey: QuickRangeKey) => {
    const range = getQuickRangeDates(rangeKey)
    setRunStartDateFilter(range.startDate)
    setRunEndDateFilter(range.endDate)
    setRunPage(1)
  }

  const openErrorDrilldown = async () => {
    setErrorDrilldownState({
      open: true,
      loading: true,
      rows: [],
      error: null
    })
    resetErrorDrilldownFilters()

    try {
      const params = new URLSearchParams()

      if (runSearch.trim()) {
        params.set('search', runSearch.trim())
      }

      if (runStatusFilter !== ALL_FILTER) {
        params.set('status', runStatusFilter)
      }

      if (runSourceFilter !== ALL_FILTER) {
        params.set('source', runSourceFilter)
      }

      if (runStartDateFilter) {
        params.set('startDate', runStartDateFilter)
      }

      if (runEndDateFilter) {
        params.set('endDate', runEndDateFilter)
      }

      const response = await fetch(`/api/monitor/drilldowns/errors?${params.toString()}`, {
        cache: 'no-store'
      })

      const data: ImportErrorDrilldownResponse | { error?: string } = await response.json()

      if (!response.ok || !('success' in data)) {
        throw new Error(('error' in data && data.error) || 'No fue posible cargar el reporte de errores')
      }

      setErrorDrilldownState({
        open: true,
        loading: false,
        rows: data.data || [],
        error: null
      })
    } catch (error) {
      console.error(error)
      setErrorDrilldownState({
        open: true,
        loading: false,
        rows: [],
        error: 'No fue posible cargar el drilldown de errores'
      })
    }
  }

  const exportErrorDrilldownCsv = () => {
    if (filteredErrorDrilldownRows.length === 0) {
      return
    }

    const headers = [
      'RFC Emisor',
      'RFC Receptor',
      'Fecha de Carga',
      'Fecha del documento',
      'Tipo',
      'Motivo del error'
    ]

    const rows = filteredErrorDrilldownRows.map((row) => [
      escapeCsvSafe(row.issuerRfc || ''),
      escapeCsvSafe(row.receiverRfc || ''),
      escapeCsvSafe(formatDateTime(row.createdAt)),
      escapeCsvSafe(formatDateOnly(row.documentDate)),
      escapeCsvSafe(getImportErrorDirectionLabel(row)),
      escapeCsvSafe(getImportErrorReason(row))
    ])

    rows.push(['', '', '', '', '', escapeCsvSafe(`Total visible: ${filteredErrorDrilldownRows.length}`)])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Errores_Importacion_${new Date().getTime()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const openItemDetail = async (itemId: string) => {
    setItemDetailState({
      open: true,
      loading: true,
      item: null,
      error: null
    })

    try {
      const response = await fetch(`/api/monitor/items/${itemId}`, {
        cache: 'no-store'
      })

      if (!response.ok) {
        throw new Error('No fue posible obtener el detalle del documento')
      }

      const data: ItemDetailResponse = await response.json()
      setItemDetailState({
        open: true,
        loading: false,
        item: data.item,
        error: null
      })
    } catch (error) {
      console.error(error)
      setItemDetailState({
        open: true,
        loading: false,
        item: null,
        error: 'No fue posible cargar el detalle del documento seleccionado'
      })
    }
  }

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Monitor de Importación</h1>
            <p className="text-muted-foreground">
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isLive && (
              <Badge variant="default" className="bg-green-500 hover:bg-green-600 animate-pulse">
                <Activity className="mr-1 h-3 w-3" /> EN VIVO
              </Badge>
            )}
            <Button variant="outline" onClick={() => setRefreshNonce(value => value + 1)}>
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">CFDI Recibidos</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalItems.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">Total de CFDI recibidos</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Velocidad de Proceso</CardTitle>
              <Zap className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{speed} docs/s</div>
              <p className="text-xs text-muted-foreground">Cambio reciente en CFDI procesados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Corridas Activas</CardTitle>
              {isLive ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-gray-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.activeRuns || 0}</div>
              <p className="text-xs text-muted-foreground">
                {isLive ? 'Hay procesamiento en curso' : 'No hay corridas activas'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Procesados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.processedItems.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">CFDI procesados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">CFDI Emitidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.createdEmitted.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">CFDI de ingresos resguardados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">CFDI Recibidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.createdReceived.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">CFDI de proveedores resguardados</p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-shadow hover:shadow-lg focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
            role="button"
            tabIndex={0}
            aria-label="Abrir drilldown de errores de importación"
            onClick={openErrorDrilldown}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openErrorDrilldown()
              }
            }}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Errores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.errorItems.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">CFDI con errores</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Progreso General</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{stats?.processedItems || 0} de {stats?.totalItems || 0}</span>
                <span>{progressPercentage.toFixed(1)}%</span>
              </div>
              <Progress value={progressPercentage} className="h-4" />
              <div className="flex flex-wrap gap-2 pt-2 text-xs text-muted-foreground">
                <span>Completadas: {stats?.completedRuns || 0}</span>
                <span>Con errores: {stats?.completedWithErrorsRuns || 0}</span>
                <span>Fallidas: {stats?.failedRuns || 0}</span>
                <span>Esperando validación externa: {stats?.waitingExternalValidationItems || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Cifras de Control de Directorio</CardTitle>
            <p className="text-sm text-muted-foreground">
              Conciliación de XML detectados, nuevos, registrados y procesados para corridas desde directorio
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">XML en Directorio</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{directoryControl.totalXmlFiles.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">Detectados en corridas de directorio dentro del filtro</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">XML Nuevos a Importar</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{directoryControl.newXmlFiles.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">Excluye los ya registrados en progress.log</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Registrados en Monitor</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{directoryControl.acceptedItems.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">CFDI aceptados por el backend</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Procesados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{directoryControl.processedItems.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">CFDI finalizados en el flujo interno</p>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <span className={getGapTextClass(directoryControl.acceptanceGap)}>
                Brecha directorio - monitor: {directoryControl.acceptanceGap.toLocaleString()}
              </span>
              <span className={getGapTextClass(directoryControl.processingGap)}>
                Brecha monitor - procesamiento: {directoryControl.processingGap.toLocaleString()}
              </span>
              <span className="text-muted-foreground">
                Sesiones de directorio en filtro: {directoryControl.matchedDirectorySessions.toLocaleString()}
              </span>
              <span className="text-muted-foreground">
                Omitidos por progress.log: {directoryControl.skippedByProgressFiles.toLocaleString()}
              </span>
            </div>

            {directoryControl.matchedDirectorySessions === 0 && (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Sin corridas de directorio en el rango seleccionado
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-4">
            <div>
              <CardTitle>Corridas</CardTitle>
              <p className="text-sm text-muted-foreground">
                Filtra por estatus, origen o busca por `Id de carga` y `Id de lote`
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <div className="relative md:col-span-2 xl:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={runSearch}
                  onChange={(event) => {
                    setRunSearch(event.target.value)
                    setRunPage(1)
                  }}
                  className="pl-9"
                  placeholder="Buscar por runId o batchId"
                />
              </div>
              <Select
                value={runStatusFilter}
                onValueChange={(value) => {
                  setRunStatusFilter(value)
                  setRunPage(1)
                }}
              >
                <SelectTrigger>
                    <SelectValue placeholder="Todos los estados" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL_FILTER}>Todos los estados</SelectItem>
                  {runStatusOptions.map(status => (
                      <SelectItem key={status} value={status}>{getRunStatusLabel(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={runSourceFilter}
                onValueChange={(value) => {
                  setRunSourceFilter(value)
                  setRunPage(1)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los orígenes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER}>Todos los orígenes</SelectItem>
                  {runSourceOptions.map(source => (
                      <SelectItem key={source} value={source}>{getRunSourceLabel(source)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="date"
                value={runStartDateFilter}
                onChange={(event) => {
                  setRunStartDateFilter(event.target.value)
                  setRunPage(1)
                }}
                aria-label="Fecha inicio importación"
                placeholder="Fecha inicio importación"
              />

              <Input
                type="date"
                value={runEndDateFilter}
                onChange={(event) => {
                  setRunEndDateFilter(event.target.value)
                  setRunPage(1)
                }}
                aria-label="Fecha final importación"
                placeholder="Fecha final importación"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {quickRangeOptions.map(option => (
                <Button
                  key={option.key}
                  type="button"
                  variant={activeQuickRange === option.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => applyQuickRange(option.key)}
                >
                  {option.label}
                </Button>
              ))}
              <Button variant="outline" onClick={resetRunFilters}>Limpiar filtros</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Estatus</TableHead>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead>Progreso</TableHead>
                    <TableHead>Documentos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!hasRunFiltersActive && !isLoadingRuns && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Selecciona al menos un filtro para consultar corridas de importación
                      </TableCell>
                    </TableRow>
                  )}
                  {runsResponse?.runs.map(run => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <div className="font-mono text-xs">{run.id}</div>
                        <div className="text-xs text-muted-foreground">{run.batchId || 'Sin batchId'}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(run.status)}>{getRunStatusLabel(run.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDateTime(run.startedAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDateTime(run.finishedAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDuration(run.startedAt, run.finishedAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{run.processedItems}/{run.totalItems}</div>
                        <div className="text-muted-foreground">{run.progressPercent}%</div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          onClick={() => openDocumentsDialog(run.id)}
                          aria-label={`Ver documentos de la corrida ${run.id}`}
                        >
                          <Eye className="h-4 w-4" />
                          Ver Documentos
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {hasRunFiltersActive && !runsResponse?.runs.length && !isLoadingRuns && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No se encontraron corridas con esos filtros
                      </TableCell>
                    </TableRow>
                  )}
                  {isLoadingRuns && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Cargando corridas...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Página {runsResponse?.pagination.page || 1} de {Math.max(runsResponse?.pagination.totalPages || 1, 1)}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!runsResponse || runPage <= 1}
                  onClick={() => setRunPage(value => Math.max(1, value - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!runsResponse || runPage >= (runsResponse.pagination.totalPages || 1)}
                  onClick={() => setRunPage(value => value + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={documentsDialogOpen}
        onOpenChange={(open) => {
          setDocumentsDialogOpen(open)
          if (!open) {
            resetItemFilters()
          }
        }}
      >
        <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen border-0 rounded-none m-0 inset-0 translate-x-0 translate-y-0 flex flex-col gap-4 p-6">
          <DialogHeader>
            <DialogTitle>Documentos de la Corrida</DialogTitle>
            <DialogDescription>
              Vista completa por corrida con filtros y detalle individual por documento
            </DialogDescription>
          </DialogHeader>

          {selectedRun ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Run ID</div>
                  <div className="font-mono text-xs">{selectedRun.id}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Estatus</div>
                  <Badge variant={getStatusBadgeVariant(selectedRun.status)}>{selectedRun.status}</Badge>
                  <span className="sr-only">{getRunStatusLabel(selectedRun.status)}</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Totales</div>
                  <div className="text-sm">{selectedRun.processedItems}/{selectedRun.totalItems}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Throughput</div>
                  <div className="text-sm">{selectedRun.throughputPerMinute} docs/min</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Inicio</div>
                  <div className="text-sm">{formatDateTime(selectedRun.startedAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Fin</div>
                  <div className="text-sm">{formatDateTime(selectedRun.finishedAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Duración</div>
                  <div className="text-sm">{formatDuration(selectedRun.startedAt, selectedRun.finishedAt)}</div>
                </div>
              </div>

              {selectedRun.directoryControl.hasDirectoryControl && (
                <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted-foreground">XML detectados en directorio</div>
                    <div className="text-sm">{selectedRun.directoryControl.totalXmlFiles?.toLocaleString() ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">XML omitidos por progress.log</div>
                    <div className="text-sm">{selectedRun.directoryControl.skippedByProgressFiles?.toLocaleString() ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">XML nuevos a importar</div>
                    <div className="text-sm">{selectedRun.directoryControl.newXmlFiles?.toLocaleString() ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">CFDI aceptados en esta corrida</div>
                    <div className="text-sm">{selectedRun.directoryControl.acceptedItems.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">CFDI procesados en esta corrida</div>
                    <div className="text-sm">{selectedRun.directoryControl.processedItems.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Brecha directorio - monitor</div>
                    <div className={`text-sm font-medium ${getGapTextClass(selectedRun.directoryControl.acceptanceGap)}`}>
                      {selectedRun.directoryControl.acceptanceGap?.toLocaleString() ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Brecha monitor - procesamiento</div>
                    <div className={`text-sm font-medium ${getGapTextClass(selectedRun.directoryControl.processingGap)}`}>
                      {selectedRun.directoryControl.processingGap?.toLocaleString() ?? 0}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              Selecciona una corrida para ver sus documentos
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Select
                value={itemStatusFilter}
                onValueChange={(value) => {
                  setItemStatusFilter(value)
                  setItemPage(1)
                }}
              >
                <SelectTrigger>
                    <SelectValue placeholder="Todos los estados del documento" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL_FILTER}>Todos los estados</SelectItem>
                  {itemStatusOptions.map(status => (
                      <SelectItem key={status} value={status}>{getItemStatusLabel(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={itemDirectionFilter}
                onValueChange={(value) => {
                  setItemDirectionFilter(value)
                  setItemPage(1)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas las direcciones" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER}>Todas las direcciones</SelectItem>
                  {itemDirectionOptions.map(direction => (
                      <SelectItem key={direction} value={direction}>{getItemDirectionLabel(direction)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={itemValidationBucketFilter}
                onValueChange={(value) => {
                  setItemValidationBucketFilter(value)
                  setItemPage(1)
                }}
              >
                <SelectTrigger>
                    <SelectValue placeholder="Todos los resultados de validación" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL_FILTER}>Todos los resultados</SelectItem>
                  {validationBucketOptions.map(bucket => (
                      <SelectItem key={bucket} value={bucket}>{getValidationBucketLabel(bucket)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant={onlyErrors ? 'default' : 'outline'}
                onClick={() => {
                  setOnlyErrors(value => !value)
                  setItemPage(1)
                }}
              >
                Solo errores
              </Button>

              <Button variant="outline" onClick={resetItemFilters}>
                Limpiar
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden rounded-md border">
              <div className="h-full overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>UUID / Archivo</TableHead>
                      <TableHead>Clasificación</TableHead>
                      <TableHead>Estatus</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Detalle</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runItemsResponse?.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-mono text-xs">{item.uuid || 'Sin UUID'}</div>
                          <div className="text-xs text-muted-foreground">{item.fileName}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{item.classificationResult}</div>
                          <div className="text-muted-foreground">{item.direction || 'SIN_DIRECCION'}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant={getStatusBadgeVariant(item.status)}>{getItemStatusLabel(item.status)}</Badge>
                          {item.validationStatus && (
                            <div className="mt-1 text-muted-foreground">
                              {item.validationStatus}
                              {item.validationBucket ? ` / ${getValidationBucketLabel(item.validationBucket)}` : ''}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {item.errorCode ? (
                            <div className="space-y-1">
                              <div className="font-medium text-red-600">{item.errorCode}</div>
                              <div className="text-muted-foreground">
                                {truncateText(item.errorMessage)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Sin error</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => openItemDetail(item.id)}
                            aria-label={`Ver detalles del documento ${item.fileName}`}
                          >
                            <Eye className="h-4 w-4" />
                            Ver Detalles
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!runItemsResponse?.items.length && !isLoadingItems && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No se encontraron documentos para esta corrida
                        </TableCell>
                      </TableRow>
                    )}
                    {isLoadingItems && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          Cargando documentos...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex flex-col gap-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
              <span>
                Página {runItemsResponse?.pagination.page || 1} de {Math.max(runItemsResponse?.pagination.totalPages || 1, 1)}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!runItemsResponse || itemPage <= 1}
                  onClick={() => setItemPage(value => Math.max(1, value - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!runItemsResponse || itemPage >= (runItemsResponse.pagination.totalPages || 1)}
                  onClick={() => setItemPage(value => value + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={errorDrilldownState.open}
        onOpenChange={(open) => {
          setErrorDrilldownState(current => ({
            ...current,
            open
          }))
        }}
      >
        <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
          <DialogHeader className="flex flex-row justify-between items-start pr-8 shrink-0">
            <div>
              <DialogTitle>Drilldown de Errores</DialogTitle>
              <div className="text-sm text-muted-foreground mt-2 space-y-1">
                <p><strong>Condición:</strong> Se listan los CFDI del monitor de importación que quedaron marcados con error y se muestra el motivo reportado por el proceso.</p>
                <ul className="list-disc list-inside pl-4">
                  <li>Búsqueda aplicada: {runSearch.trim() || 'Sin búsqueda'}</li>
                  <li>Estatus de corrida: {runStatusFilter === ALL_FILTER ? 'Todos los estados' : getRunStatusLabel(runStatusFilter)}</li>
                  <li>Origen: {runSourceFilter === ALL_FILTER ? 'Todos los orígenes' : getRunSourceLabel(runSourceFilter)}</li>
                  <li>Fecha inicio importación: {runStartDateFilter || 'Sin filtro'}</li>
                  <li>Fecha final importación: {runEndDateFilter || 'Sin filtro'}</li>
                  <li>Registros visibles: {filteredErrorDrilldownRows.length}</li>
                </ul>
              </div>
            </div>
            {!errorDrilldownState.loading && filteredErrorDrilldownRows.length > 0 && (
              <Button onClick={exportErrorDrilldownCsv} variant="outline" size="sm" className="shrink-0">
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            )}
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {errorDrilldownState.loading ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Cargando reporte general de errores...
              </div>
            ) : errorDrilldownState.error ? (
              <div className="flex-1 flex items-center justify-center text-destructive">
                {errorDrilldownState.error}
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full">
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={resetErrorDrilldownFilters}>
                    Limpiar filtros
                  </Button>
                </div>

                <div data-slot="table-container" className="rounded-md border h-full">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>RFC Emisor</TableHead>
                        <TableHead>RFC Receptor</TableHead>
                        <TableHead>Fecha de Carga</TableHead>
                        <TableHead>Fecha del documento</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Motivo del error</TableHead>
                      </TableRow>
                      <TableRow>
                        <TableCell>
                          <Input
                            value={errorDrilldownFilters.issuerRfc || ''}
                            onChange={(event) => setErrorDrilldownFilters(current => ({ ...current, issuerRfc: event.target.value }))}
                            placeholder="Filtrar"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={errorDrilldownFilters.receiverRfc || ''}
                            onChange={(event) => setErrorDrilldownFilters(current => ({ ...current, receiverRfc: event.target.value }))}
                            placeholder="Filtrar"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={errorDrilldownFilters.createdAt || ''}
                            onChange={(event) => setErrorDrilldownFilters(current => ({ ...current, createdAt: event.target.value }))}
                            placeholder="Filtrar"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={errorDrilldownFilters.documentDate || ''}
                            onChange={(event) => setErrorDrilldownFilters(current => ({ ...current, documentDate: event.target.value }))}
                            placeholder="Filtrar"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={errorDrilldownFilters.direction || ''}
                            onChange={(event) => setErrorDrilldownFilters(current => ({ ...current, direction: event.target.value }))}
                            placeholder="Filtrar"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={errorDrilldownFilters.errorReason || ''}
                            onChange={(event) => setErrorDrilldownFilters(current => ({ ...current, errorReason: event.target.value }))}
                            placeholder="Filtrar"
                          />
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredErrorDrilldownRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No se encontraron errores con los filtros actuales.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredErrorDrilldownRows.map((row) => (
                          <TableRow key={`${row.id}-${row.createdAt}`}>
                            <TableCell className="font-mono">{row.issuerRfc || '-'}</TableCell>
                            <TableCell className="font-mono">{row.receiverRfc || '-'}</TableCell>
                            <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                            <TableCell>{formatDateOnly(row.documentDate)}</TableCell>
                            <TableCell>{getImportErrorDirectionLabel(row)}</TableCell>
                            <TableCell className="max-w-[460px] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {getImportErrorReason(row)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                      {filteredErrorDrilldownRows.length > 0 && (
                        <TableRow className="font-semibold bg-muted/30">
                          <TableCell colSpan={5}>Total</TableCell>
                          <TableCell>{filteredErrorDrilldownRows.length} registros visibles</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={itemDetailState.open}
        onOpenChange={(open) => {
          setItemDetailState(current => ({
            ...current,
            open
          }))
        }}
      >
        <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen border-0 rounded-none m-0 inset-0 translate-x-0 translate-y-0 flex flex-col gap-4 p-6">
          <DialogHeader>
            <DialogTitle>Detalle del documento</DialogTitle>
            <DialogDescription>
              Información individual del registro seleccionado cargada de forma asíncrona
            </DialogDescription>
          </DialogHeader>

          {itemDetailState.loading && (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">
              Cargando detalle del documento...
            </div>
          )}

          {!itemDetailState.loading && itemDetailState.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
              {itemDetailState.error}
            </div>
          )}

          {!itemDetailState.loading && itemDetailState.item && (
            <div className="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
                <div className="rounded-md border p-4 min-w-0 xl:col-span-2">
                  <div className="text-xs text-muted-foreground">Archivo</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {itemDetailState.item.fileName}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0 xl:col-span-2">
                  <div className="text-xs text-muted-foreground">UUID</div>
                  <div className="font-mono text-sm break-all">
                    {itemDetailState.item.uuid || 'Sin UUID'}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Estatus</div>
                  <div className="mt-1">
                    <Badge variant={getStatusBadgeVariant(itemDetailState.item.status)}>
                      {getItemStatusLabel(itemDetailState.item.status)}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Clasificación</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {itemDetailState.item.classificationResult}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Dirección</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {getItemDirectionLabel(itemDetailState.item.direction)}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Validación</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {itemDetailState.item.validationStatus || 'Sin validación'}
                    {itemDetailState.item.validationBucket
                      ? ` / ${getValidationBucketLabel(itemDetailState.item.validationBucket)}`
                      : ''}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">RFC Emisor</div>
                  <div className="text-sm font-medium break-all">
                    {itemDetailState.item.issuerRfc || 'Sin RFC'}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">RFC Receptor</div>
                  <div className="text-sm font-medium break-all">
                    {itemDetailState.item.receiverRfc || 'Sin RFC'}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Intentos</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    Interno: {itemDetailState.item.attemptCountInternal} | Externo: {itemDetailState.item.attemptCountExternal}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Próximo reintento externo</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {formatDateTime(itemDetailState.item.nextExternalRetryAt)}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Inicio de procesamiento</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {formatDateTime(itemDetailState.item.processingStartedAt)}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Fin de procesamiento</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {formatDateTime(itemDetailState.item.processingFinishedAt)}
                  </div>
                </div>
                <div className="rounded-md border p-4 min-w-0">
                  <div className="text-xs text-muted-foreground">Actualizado</div>
                  <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {formatDateTime(itemDetailState.item.updatedAt)}
                  </div>
                </div>
              </div>

              <div className="rounded-md border p-4 min-w-0">
                <div className="mb-2 text-xs text-muted-foreground">Código de error</div>
                <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                  {itemDetailState.item.errorCode || 'Sin error'}
                </div>
              </div>

              <div className="rounded-md border p-4 min-w-0">
                <div className="mb-2 text-xs text-muted-foreground">Mensaje completo</div>
                <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6">
                  {itemDetailState.item.errorMessage || 'Sin mensaje de error'}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

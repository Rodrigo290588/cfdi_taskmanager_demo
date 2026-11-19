'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarClock,
  Eye,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreateRoutineSchema } from '@/lib/validations/mass-download-routine.schema'
import { cn } from '@/lib/utils'

const COMPLEMENT_OPTIONS = [
  ['acreditamientoieps10', 'Acreditamiento IEPS 1.0'],
  ['aerolineas', 'Aerolíneas'],
  ['certificadodedestruccion', 'Certificado de Destrucción'],
  ['cfdiregistrofiscal', 'CFDI Registro Fiscal'],
  ['comercioexterior10', 'Comercio Exterior 1.0'],
  ['comercioexterior11', 'Comercio Exterior 1.1'],
  ['comprobante', 'Comprobante'],
  ['consumodecombustibles', 'Consumo de Combustibles'],
  ['consumodecombustibles11', 'Consumo de Combustibles 1.1'],
  ['detallista', 'Detallista'],
  ['divisas', 'Divisas'],
  ['donat11', 'Donatarias 1.1'],
  ['ecc11', 'Estado de Cuenta de Combustibles 1.1'],
  ['ecc12', 'Estado de Cuenta de Combustibles 1.2'],
  ['gastoshidrocarburos10', 'Gastos Hidrocarburos 1.0'],
  ['iedu', 'IEDU'],
  ['implocal', 'Impuestos Locales'],
  ['ine11', 'INE 1.1'],
  ['ingresoshidrocarburos', 'Ingresos Hidrocarburos'],
  ['leyendasfisc', 'Leyendas Fiscales'],
  ['nomina11', 'Nómina 1.1'],
  ['nomina12', 'Nómina 1.2'],
  ['notariospublicos', 'Notarios Públicos'],
  ['obrasarteantiguedades', 'Obras de Arte y Antigüedades'],
  ['pagoenespecie', 'Pago en Especie'],
  ['pagos10', 'Pagos 1.0'],
  ['pfic', 'PFIC'],
  ['renovacionysustitucionvehiculos', 'Renovación y Sustitución de Vehículos'],
  ['servicioparcialconstruccion', 'Servicios Parciales de Construcción'],
  ['spei', 'SPEI'],
  ['terceros11', 'Terceros 1.1'],
  ['turistapasajeroextranjero', 'Turista Pasajero Extranjero'],
  ['valesdedespensa', 'Vales de Despensa'],
  ['vehiculousado', 'Vehículo Usado'],
  ['ventavehiculos11', 'Venta de Vehículos 1.1'],
] as const

const WEEK_DAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
] as const

interface SelectedCompany {
  readonly id: string
  readonly rfc: string
  readonly businessName?: string
}

type RoutineAction = 'pause' | 'resume' | 'delete'

type RoutineFilterKey = 'routine' | 'request' | 'period' | 'schedule' | 'nextRun' | 'status'

type RoutineFilters = Record<RoutineFilterKey, string>

type ExecutionFilterKey = 'routine' | 'period' | 'request' | 'packages' | 'startedFinished' | 'status'

type ExecutionFilters = Record<ExecutionFilterKey, string>

const ROUTINES_PAGE_SIZE = 10

interface RoutineRecord {
  readonly id: string
  readonly name: string
  readonly requestingRfc: string
  readonly requestType: 'CFDI' | 'METADATA'
  readonly retrievalType: 'EMITIDOS' | 'RECIBIDOS'
  readonly filters: unknown
  readonly periodPreset: PeriodPreset
  readonly customStartDate: string | null
  readonly customEndDate: string | null
  readonly timezone: string
  readonly scheduleFrequency: Frequency
  readonly scheduledHour: number
  readonly scheduledMinute: number
  readonly weekDays: number[]
  readonly monthDays: number[]
  readonly status: 'ACTIVE' | 'PAUSED' | 'DELETED'
  readonly storageOptions: unknown
  readonly nextRunAt: string | null
  readonly lastRunAt: string | null
}

interface RoutineExecution {
  readonly id: string
  readonly routineId: string | null
  readonly correlationId: string
  readonly scheduledFor: string
  readonly effectiveStartDate: string | null
  readonly effectiveEndDate: string | null
  readonly status: string
  readonly satRequestId: string | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly packagesFound: number
  readonly retryAttempt: number
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly errorDetails: unknown
  readonly routine: {
    readonly name: string
    readonly requestType: string
    readonly retrievalType: string
  } | null
  readonly events: ReadonlyArray<RoutineEvent>
}

interface RoutineEvent {
  readonly id: string
  readonly eventName: string
  readonly level: string
  readonly details: unknown
  readonly occurredAt: string
}

interface StorageDestination {
  readonly id: string
  readonly label: string
  readonly retentionDays: number
}

type PeriodPreset =
  | 'CURRENT_DAY'
  | 'PREVIOUS_DAY'
  | 'CURRENT_WEEK'
  | 'PREVIOUS_WEEK'
  | 'LAST_SEVEN_DAYS'
  | 'CURRENT_MONTH'
  | 'PREVIOUS_MONTH'
  | 'CUSTOM'

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY'

interface RoutineDraft {
  readonly name: string
  readonly requestType: 'CFDI' | 'METADATA'
  readonly retrievalType: 'EMITIDOS' | 'RECIBIDOS'
  readonly issuerRfc: string
  readonly receiverRfc: string
  readonly voucherType: '' | 'I' | 'E' | 'P' | 'T' | 'N'
  readonly status: 'Todos' | 'Vigente' | 'Cancelado'
  readonly thirdPartyRfc: string
  readonly complement: string
  readonly periodPreset: PeriodPreset
  readonly customStartDate: string
  readonly customEndDate: string
  readonly frequency: Frequency
  readonly scheduledTime: string
  readonly weekDays: number[]
  readonly monthDaysText: string
  readonly timezone: string
  readonly storageEnabled: boolean
  readonly extractionDestinationId: string
  readonly extractionRelativePath: string
  readonly zipBackupDestinationId: string
  readonly zipBackupRelativePath: string
}

export function RoutineManager() {
  const [company, setCompany] = useState<SelectedCompany | null>(null)
  const [routines, setRoutines] = useState<RoutineRecord[]>([])
  const [executions, setExecutions] = useState<RoutineExecution[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingRoutine, setEditingRoutine] = useState<RoutineRecord | null>(null)
  const [selectedExecution, setSelectedExecution] = useState<RoutineExecution | null>(null)

  const loadData = useCallback(async (showLoading: boolean) => {
    if (!company) {
      setRoutines([])
      setExecutions([])
      return
    }
    if (showLoading) setIsLoading(true)
    try {
      const query = new URLSearchParams({ companyId: company.id })
      const [routinesResponse, executionsResponse] = await Promise.all([
        fetch(`/api/mass-downloads/routines?${query.toString()}`, { cache: 'no-store' }),
        fetch(`/api/mass-downloads/routines/executions?${query.toString()}`, { cache: 'no-store' }),
      ])
      const routinesPayload = await responseJson(routinesResponse)
      const executionsPayload = await responseJson(executionsResponse)
      if (!routinesResponse.ok) throw new Error(readErrorMessage(routinesPayload, 'No se pudieron cargar las rutinas'))
      if (!executionsResponse.ok) throw new Error(readErrorMessage(executionsPayload, 'No se pudieron cargar las ejecuciones'))
      setRoutines(readDataArray<RoutineRecord>(routinesPayload))
      setExecutions(readDataArray<RoutineExecution>(executionsPayload))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el módulo')
    } finally {
      if (showLoading) setIsLoading(false)
    }
  }, [company])

  useEffect(() => {
    const updateCompany = () => setCompany(readSelectedCompany())
    updateCompany()
    window.addEventListener('company-selected', updateCompany)
    return () => window.removeEventListener('company-selected', updateCompany)
  }, [])

  useEffect(() => {
    if (!company) return
    void Promise.resolve().then(() => loadData(true))
    const intervalId = window.setInterval(() => {
      void loadData(false)
    }, 30_000)
    return () => window.clearInterval(intervalId)
  }, [company, loadData])

  const openCreate = () => {
    setEditingRoutine(null)
    setIsDialogOpen(true)
  }

  const openEdit = (routine: RoutineRecord) => {
    setEditingRoutine(routine)
    setIsDialogOpen(true)
  }

  const submitRoutine = async (draft: RoutineDraft) => {
    if (!company) return
    const payload = buildRoutinePayload(draft, company.id)
    const validation = CreateRoutineSchema.safeParse(payload)
    if (!validation.success) {
      toast.error(validation.error.issues[0]?.message ?? 'Revisa los campos obligatorios')
      return
    }

    const isEditing = Boolean(editingRoutine)
    const response = await fetch(
      isEditing ? `/api/mass-downloads/routines/${editingRoutine?.id}` : '/api/mass-downloads/routines',
      {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isEditing ? { action: 'update', routine: withoutCompany(payload) } : payload),
      },
    )
    const responsePayload = await responseJson(response)
    if (!response.ok) {
      throw new Error(readErrorMessage(responsePayload, 'No se pudo guardar la rutina'))
    }
    toast.success(isEditing ? 'Rutina actualizada' : 'Rutina creada')
    setIsDialogOpen(false)
    await loadData(false)
  }

  const changeRoutineState = async (routine: RoutineRecord, action: RoutineAction) => {
    const method = action === 'delete' ? 'DELETE' : 'PATCH'
    const response = await fetch(`/api/mass-downloads/routines/${routine.id}`, {
      method,
      ...(action === 'delete' ? {} : {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      }),
    })
    const payload = await responseJson(response)
    if (!response.ok) {
      toast.error(readErrorMessage(payload, 'No se pudo actualizar la rutina'))
      return
    }
    toast.success(getRoutineActionMessage(action))
    await loadData(false)
  }

  const hasCompany = Boolean(company)
  return (
    <div className="space-y-5">
      <Card className="border-primary/15">
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-xl">
            <CalendarClock className="h-5 w-5 text-primary" />
            Automatización de descargas masivas
          </CardTitle>
          <CardDescription>
            {getActiveCompanyDescription(company)}
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="routines">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="routines" className="flex-1 sm:flex-none">Rutinas</TabsTrigger>
            <TabsTrigger value="monitor" className="flex-1 sm:flex-none">Monitor de ejecuciones</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={!hasCompany || isLoading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
              Actualizar
            </Button>
            <Button size="sm" onClick={openCreate} disabled={!hasCompany}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva rutina
            </Button>
          </div>
        </div>

        <TabsContent value="routines">
          <RoutineList
            routines={routines}
            isLoading={isLoading}
            hasCompany={hasCompany}
            onEdit={openEdit}
            onAction={changeRoutineState}
          />
        </TabsContent>
        <TabsContent value="monitor">
          <ExecutionMonitor
            executions={executions}
            isLoading={isLoading}
            hasCompany={hasCompany}
            onSelect={setSelectedExecution}
          />
        </TabsContent>
      </Tabs>

      <RoutineDialog
        key={editingRoutine?.id ?? (isDialogOpen ? 'new-routine' : 'closed-dialog')}
        company={company}
        routine={editingRoutine}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={submitRoutine}
      />
      <ExecutionDialog execution={selectedExecution} onOpenChange={(open) => !open && setSelectedExecution(null)} />
    </div>
  )
}

function RoutineList({
  routines,
  isLoading,
  hasCompany,
  onEdit,
  onAction,
}: Readonly<{
  routines: RoutineRecord[]
  isLoading: boolean
  hasCompany: boolean
  onEdit: (routine: RoutineRecord) => void
  onAction: (routine: RoutineRecord, action: RoutineAction) => Promise<void>
}>) {
  const [filters, setFilters] = useState<RoutineFilters>(() => createEmptyRoutineFilters())
  const [currentPage, setCurrentPage] = useState(1)
  const filteredRoutines = useMemo(
    () => routines.filter((routine) => matchesRoutineFilters(routine, filters)),
    [filters, routines],
  )
  const totalPages = Math.max(1, Math.ceil(filteredRoutines.length / ROUTINES_PAGE_SIZE))
  const visiblePage = Math.min(currentPage, totalPages)
  const paginatedRoutines = useMemo(
    () => filteredRoutines.slice((visiblePage - 1) * ROUTINES_PAGE_SIZE, visiblePage * ROUTINES_PAGE_SIZE),
    [filteredRoutines, visiblePage],
  )
  const updateFilter = (key: RoutineFilterKey, value: string) => {
    setCurrentPage(1)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  if (!hasCompany) return <EmptyState text="Selecciona una empresa para consultar y programar sus descargas." />
  if (isLoading && routines.length === 0) return <EmptyState text="Cargando rutinas…" />
  if (routines.length === 0) return <EmptyState text="Aún no hay rutinas configuradas para esta empresa." />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rutinas configuradas</CardTitle>
        <CardDescription>Las horas se interpretan en la zona horaria configurada para cada rutina.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rutina</TableHead>
              <TableHead>Solicitud</TableHead>
              <TableHead>Periodo</TableHead>
              <TableHead>Programación</TableHead>
              <TableHead>Próxima ejecución</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <RoutineFilterInput
                  value={filters.routine}
                  onChange={(value) => updateFilter('routine', value)}
                  placeholder="Buscar rutina o RFC"
                  ariaLabel="Buscar por rutina o RFC"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.request}
                  onChange={(value) => updateFilter('request', value)}
                  placeholder="Buscar solicitud"
                  ariaLabel="Buscar por solicitud"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.period}
                  onChange={(value) => updateFilter('period', value)}
                  placeholder="Buscar periodo"
                  ariaLabel="Buscar por periodo"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.schedule}
                  onChange={(value) => updateFilter('schedule', value)}
                  placeholder="Buscar programación"
                  ariaLabel="Buscar por programación"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.nextRun}
                  onChange={(value) => updateFilter('nextRun', value)}
                  placeholder="Buscar fecha"
                  ariaLabel="Buscar por próxima ejecución"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.status}
                  onChange={(value) => updateFilter('status', value)}
                  placeholder="Buscar estado"
                  ariaLabel="Buscar por estado"
                />
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedRoutines.map((routine) => (
              <TableRow key={routine.id}>
                <TableCell>
                  <p className="font-medium">{routine.name}</p>
                  <p className="text-xs text-muted-foreground">{routine.requestingRfc}</p>
                </TableCell>
                <TableCell>{routine.requestType === 'CFDI' ? 'XML CFDI' : 'Metadata'} · {routine.retrievalType.toLowerCase()}</TableCell>
                <TableCell>{periodLabel(routine.periodPreset)}</TableCell>
                <TableCell>{scheduleLabel(routine)}</TableCell>
                <TableCell>{formatDateTime(routine.nextRunAt)}</TableCell>
                <TableCell><StatusBadge status={routine.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Editar ${routine.name}`} onClick={() => onEdit(routine)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {routine.status === 'ACTIVE' ? (
                      <Button variant="ghost" size="icon" aria-label={`Pausar ${routine.name}`} onClick={() => void onAction(routine, 'pause')}>
                        <Pause className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" aria-label={`Reanudar ${routine.name}`} onClick={() => void onAction(routine, 'resume')}>
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={`Eliminar ${routine.name}`} onClick={() => void onAction(routine, 'delete')}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredRoutines.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No hay rutinas que coincidan con los filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      {filteredRoutines.length > 0 && (
        <div className="flex flex-col gap-3 border-t px-6 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Mostrando {((visiblePage - 1) * ROUTINES_PAGE_SIZE) + 1} a{' '}
            {Math.min(visiblePage * ROUTINES_PAGE_SIZE, filteredRoutines.length)} de {filteredRoutines.length} rutinas
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={visiblePage === 1}
            >
              Anterior
            </Button>
            <span aria-live="polite" className="min-w-24 text-center">
              Página {visiblePage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={visiblePage === totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function RoutineFilterInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: Readonly<{
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
}>) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="h-8 min-w-28 text-xs"
    />
  )
}

function ExecutionMonitor({
  executions,
  isLoading,
  hasCompany,
  onSelect,
}: Readonly<{
  executions: RoutineExecution[]
  isLoading: boolean
  hasCompany: boolean
  onSelect: (execution: RoutineExecution) => void
}>) {
  const [filters, setFilters] = useState<ExecutionFilters>(() => createEmptyExecutionFilters())
  const [currentPage, setCurrentPage] = useState(1)
  const filteredExecutions = useMemo(
    () => executions.filter((execution) => matchesExecutionFilters(execution, filters)),
    [executions, filters],
  )
  const totalPages = Math.max(1, Math.ceil(filteredExecutions.length / ROUTINES_PAGE_SIZE))
  const visiblePage = Math.min(currentPage, totalPages)
  const paginatedExecutions = useMemo(
    () => filteredExecutions.slice((visiblePage - 1) * ROUTINES_PAGE_SIZE, visiblePage * ROUTINES_PAGE_SIZE),
    [filteredExecutions, visiblePage],
  )
  const updateFilter = (key: ExecutionFilterKey, value: string) => {
    setCurrentPage(1)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  if (!hasCompany) return <EmptyState text="Selecciona una empresa para consultar sus ejecuciones." />
  if (isLoading && executions.length === 0) return <EmptyState text="Cargando ejecuciones…" />
  if (executions.length === 0) return <EmptyState text="No existen ejecuciones programadas para esta empresa." />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ejecuciones recientes</CardTitle>
        <CardDescription>Actualización automática silenciosa cada 30 segundos.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rutina</TableHead>
              <TableHead>Periodo efectivo</TableHead>
              <TableHead>Solicitud SAT</TableHead>
              <TableHead>Paquetes</TableHead>
              <TableHead>Inicio / fin</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Detalle</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <RoutineFilterInput
                  value={filters.routine}
                  onChange={(value) => updateFilter('routine', value)}
                  placeholder="Buscar rutina"
                  ariaLabel="Buscar por rutina"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.period}
                  onChange={(value) => updateFilter('period', value)}
                  placeholder="Buscar periodo"
                  ariaLabel="Buscar por periodo efectivo"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.request}
                  onChange={(value) => updateFilter('request', value)}
                  placeholder="Buscar solicitud"
                  ariaLabel="Buscar por solicitud SAT"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.packages}
                  onChange={(value) => updateFilter('packages', value)}
                  placeholder="Buscar paquetes"
                  ariaLabel="Buscar por paquetes"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.startedFinished}
                  onChange={(value) => updateFilter('startedFinished', value)}
                  placeholder="Buscar fechas"
                  ariaLabel="Buscar por inicio o fin"
                />
              </TableHead>
              <TableHead>
                <RoutineFilterInput
                  value={filters.status}
                  onChange={(value) => updateFilter('status', value)}
                  placeholder="Buscar estado"
                  ariaLabel="Buscar por estado"
                />
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedExecutions.map((execution) => (
              <TableRow key={execution.id}>
                <TableCell>
                  <p className="font-medium">{execution.routine?.name ?? 'Rutina eliminada'}</p>
                  <p className="text-xs text-muted-foreground">Programada: {formatDateTime(execution.scheduledFor)}</p>
                </TableCell>
                <TableCell>{formatDate(execution.effectiveStartDate)} a {formatDate(execution.effectiveEndDate)}</TableCell>
                <TableCell className="font-mono text-xs">{execution.satRequestId ?? 'Pendiente'}</TableCell>
                <TableCell>{execution.packagesFound}</TableCell>
                <TableCell className="text-xs">{formatDateTime(execution.startedAt)}<br />{formatDateTime(execution.finishedAt)}</TableCell>
                <TableCell><StatusBadge status={execution.status} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => onSelect(execution)}>
                    <Eye className="mr-2 h-4 w-4" />
                    Ver
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filteredExecutions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No hay ejecuciones que coincidan con los filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      {filteredExecutions.length > 0 && (
        <div className="flex flex-col gap-3 border-t px-6 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Mostrando {((visiblePage - 1) * ROUTINES_PAGE_SIZE) + 1} a{' '}
            {Math.min(visiblePage * ROUTINES_PAGE_SIZE, filteredExecutions.length)} de {filteredExecutions.length} ejecuciones
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={visiblePage === 1}
            >
              Anterior
            </Button>
            <span aria-live="polite" className="min-w-24 text-center">
              Página {visiblePage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={visiblePage === totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function RoutineDialog({
  company,
  routine,
  open,
  onOpenChange,
  onSubmit,
}: Readonly<{
  company: SelectedCompany | null
  routine: RoutineRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: RoutineDraft) => Promise<void>
}>) {
  const [draft, setDraft] = useState<RoutineDraft>(() => routineToDraft(routine))
  const [destinations, setDestinations] = useState<StorageDestination[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!company || !draft.storageEnabled) return
    const query = new URLSearchParams({ companyId: company.id })
    fetch(`/api/mass-downloads/storage-destinations?${query.toString()}`, { cache: 'no-store' })
      .then(responseJson)
      .then((payload) => setDestinations(readDataArray<StorageDestination>(payload)))
      .catch(() => setDestinations([]))
  }, [company, draft.storageEnabled])

  const save = async () => {
    setIsSubmitting(true)
    try {
      await onSubmit(draft)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la rutina')
    } finally {
      setIsSubmitting(false)
    }
  }

  const update = (next: Partial<RoutineDraft>) => setDraft((current) => ({ ...current, ...next }))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(92vh,900px)] !w-[min(92vw,1280px)] !max-w-none overflow-hidden">
        <DialogHeader>
          <DialogTitle>{routine ? 'Editar rutina' : 'Nueva rutina automatizada'}</DialogTitle>
          <DialogDescription>
            {company ? `Se ejecutará con la FIEL de ${company.rfc}.` : 'Selecciona una empresa antes de configurar una rutina.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          <div className="grid gap-5 py-2 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Nombre de la rutina">
              <Input value={draft.name} maxLength={120} onChange={(event) => update({ name: event.target.value })} placeholder="Ej. CFDI emitidos diarios" />
            </Field>
            <Field label="Empresa / RFC">
              <Input value={formatCompanyLabel(company)} disabled />
            </Field>
            <Field label="Tipo de solicitud">
              <Select
                value={draft.requestType}
                onValueChange={(value: RoutineDraft['requestType']) =>
                  update(value === 'CFDI' ? { requestType: value, status: 'Vigente' } : { requestType: value })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CFDI">XML CFDI</SelectItem>
                  <SelectItem value="METADATA">Metadata</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Comprobantes">
              <Select value={draft.retrievalType} onValueChange={(value: RoutineDraft['retrievalType']) => update({ retrievalType: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMITIDOS">Emitidos</SelectItem>
                  <SelectItem value="RECIBIDOS">Recibidos</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={draft.retrievalType === 'EMITIDOS' ? 'RFC receptor (opcional)' : 'RFC emisor (opcional)'}>
              <Input
                value={draft.retrievalType === 'EMITIDOS' ? draft.receiverRfc : draft.issuerRfc}
                onChange={(event) => update(draft.retrievalType === 'EMITIDOS' ? { receiverRfc: event.target.value.toUpperCase() } : { issuerRfc: event.target.value.toUpperCase() })}
                placeholder="RFC adicional"
                maxLength={13}
              />
            </Field>
            <Field label="Tipo de comprobante">
              <Select value={draft.voucherType || 'ALL'} onValueChange={(value) => update({ voucherType: value === 'ALL' ? '' : value as RoutineDraft['voucherType'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="I">Ingreso</SelectItem>
                  <SelectItem value="E">Egreso</SelectItem>
                  <SelectItem value="P">Pago</SelectItem>
                  <SelectItem value="N">Nómina</SelectItem>
                  <SelectItem value="T">Traslado</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Estado del comprobante">
              <Select value={draft.status} onValueChange={(value: RoutineDraft['status']) => update({ status: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Todos">Todos</SelectItem>
                  <SelectItem value="Vigente">Vigentes</SelectItem>
                  <SelectItem value="Cancelado" disabled={draft.requestType === 'CFDI'}>Cancelados</SelectItem>
                </SelectContent>
              </Select>
              {draft.requestType === 'CFDI' && (
                <p className="text-xs text-muted-foreground">El SAT solo permite descargar XML CFDI vigentes.</p>
              )}
            </Field>
            <Field label="RFC a cuenta de terceros (opcional)">
              <Input value={draft.thirdPartyRfc} maxLength={13} onChange={(event) => update({ thirdPartyRfc: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="Complemento">
              <Select value={draft.complement || 'ALL'} onValueChange={(value) => update({ complement: value === 'ALL' ? '' : value })}>
                <SelectTrigger><SelectValue placeholder="Todos los complementos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos los complementos</SelectItem>
                  {COMPLEMENT_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <section className="mt-5 rounded-lg border p-4">
            <h3 className="mb-4 font-semibold">Periodo y programación</h3>
            <div className="grid gap-5 md:grid-cols-3">
            <Field label="Periodo dinámico">
              <Select value={draft.periodPreset} onValueChange={(value: PeriodPreset) => update({ periodPreset: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CURRENT_DAY">Día en curso</SelectItem>
                  <SelectItem value="PREVIOUS_DAY">Día anterior</SelectItem>
                  <SelectItem value="CURRENT_WEEK">Semana en curso</SelectItem>
                  <SelectItem value="PREVIOUS_WEEK">Semana anterior</SelectItem>
                  <SelectItem value="LAST_SEVEN_DAYS">Últimos 7 días</SelectItem>
                  <SelectItem value="CURRENT_MONTH">Mes en curso</SelectItem>
                  <SelectItem value="PREVIOUS_MONTH">Mes anterior</SelectItem>
                  <SelectItem value="CUSTOM">Fechas personalizadas</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Frecuencia">
              <Select value={draft.frequency} onValueChange={(value: Frequency) => update({ frequency: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Diaria</SelectItem>
                  <SelectItem value="WEEKLY">Semanal</SelectItem>
                  <SelectItem value="MONTHLY">Mensual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Hora de ejecución">
              <Input type="time" value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
            </Field>
            {draft.periodPreset === 'CUSTOM' && (
              <>
                <Field label="Fecha inicial"><Input type="date" value={draft.customStartDate} onChange={(event) => update({ customStartDate: event.target.value })} /></Field>
                <Field label="Fecha final"><Input type="date" value={draft.customEndDate} onChange={(event) => update({ customEndDate: event.target.value })} /></Field>
              </>
            )}
            <Field label="Zona horaria">
              <Input value={draft.timezone} onChange={(event) => update({ timezone: event.target.value })} />
            </Field>
          </div>
          {draft.frequency === 'WEEKLY' && (
            <div className="mt-4">
              <Label>Días de la semana</Label>
              <div className="mt-2 flex flex-wrap gap-3">
                {WEEK_DAYS.map((day) => (
                  <label key={day.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.weekDays.includes(day.value)} onChange={() => update({ weekDays: toggleDay(draft.weekDays, day.value) })} />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {draft.frequency === 'MONTHLY' && (
            <div className="mt-4 max-w-sm">
              <Field label="Días del mes">
                <Input value={draft.monthDaysText} onChange={(event) => update({ monthDaysText: event.target.value })} placeholder="Ej. 1, 5, 15" />
              </Field>
            </div>
          )}
          </section>

          <section className="mt-5 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">Almacenamiento adicional</h3>
                <p className="text-sm text-muted-foreground">El almacenamiento actual de la aplicación no cambia. Los destinos configurados se muestran sin rutas físicas.</p>
              </div>
              <Switch checked={draft.storageEnabled} onCheckedChange={(checked) => update({ storageEnabled: checked })} />
            </div>
            {draft.storageEnabled && (
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <Field label="Destino de archivos extraídos">
                  <DestinationSelect value={draft.extractionDestinationId} destinations={destinations} onChange={(value) => update({ extractionDestinationId: value })} />
                </Field>
                <Field label="Subcarpeta relativa de extracción (opcional)">
                  <Input value={draft.extractionRelativePath} onChange={(event) => update({ extractionRelativePath: event.target.value })} placeholder="empresa/periodo" />
                </Field>
                <Field label="Destino de respaldo ZIP">
                  <DestinationSelect value={draft.zipBackupDestinationId} destinations={destinations} onChange={(value) => update({ zipBackupDestinationId: value })} />
                </Field>
                <Field label="Subcarpeta relativa de respaldo (opcional)">
                  <Input value={draft.zipBackupRelativePath} onChange={(event) => update({ zipBackupRelativePath: event.target.value })} placeholder="empresa/respaldo" />
                </Field>
                {destinations.length === 0 && <p className="text-sm text-amber-700 md:col-span-2">No hay destinos seguros configurados en el servidor. Desactiva esta opción o solicita su configuración al administrador.</p>}
              </div>
            )}
          </section>

          <div className="flex justify-end gap-2 pb-1 pt-5">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={() => void save()} disabled={!company || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar rutina
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ExecutionDialog({
  execution,
  onOpenChange,
}: Readonly<{
  execution: RoutineExecution | null
  onOpenChange: (open: boolean) => void
}>) {
  return (
    <Dialog open={Boolean(execution)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalle de ejecución</DialogTitle>
          <DialogDescription>Los eventos muestran información operativa saneada.</DialogDescription>
        </DialogHeader>
        {execution && (
          <div className="space-y-5">
            <div className="grid gap-3 rounded-lg border p-4 text-sm md:grid-cols-3">
              <Metric label="Rutina" value={execution.routine?.name ?? 'Rutina eliminada'} />
              <Metric label="Solicitud SAT" value={execution.satRequestId ?? 'Pendiente'} mono />
              <Metric label="Estado" value={statusLabel(execution.status)} />
              <Metric label="Periodo" value={`${formatDate(execution.effectiveStartDate)} a ${formatDate(execution.effectiveEndDate)}`} />
              <Metric label="Paquetes encontrados" value={String(execution.packagesFound)} />
              <Metric label="Reintentos" value={String(execution.retryAttempt)} />
            </div>
            {execution.status === 'FAILED' && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p className="font-medium text-destructive">La ejecución no pudo completarse</p>
                <p className="mt-1">{getExecutionErrorMessage(execution)}</p>
                {execution.errorCode && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Código de referencia: <span className="font-mono">{execution.errorCode}</span>
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Revisa la configuración de la FIEL, la conexión con el SAT y los eventos registrados abajo.
                </p>
              </div>
            )}
            <section>
              <h3 className="mb-3 font-semibold">Eventos registrados</h3>
              {execution.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no hay eventos disponibles.</p>
              ) : (
                <div className="space-y-2">
                  {execution.events.map((event) => (
                    <div key={event.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={event.level.toUpperCase()} />
                          <span className="font-medium">{eventLabel(event.eventName)}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</span>
                      </div>
                      {formatEventDetails(event.details) && <p className="mt-2 break-words text-xs text-muted-foreground">{formatEventDetails(event.details)}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DestinationSelect({
  value,
  destinations,
  onChange,
}: Readonly<{
  value: string
  destinations: StorageDestination[]
  onChange: (value: string) => void
}>) {
  return (
    <Select value={value || 'NONE'} onValueChange={(nextValue) => onChange(nextValue === 'NONE' ? '' : nextValue)}>
      <SelectTrigger><SelectValue placeholder="Sin destino adicional" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="NONE">Sin destino adicional</SelectItem>
        {destinations.map((destination) => (
          <SelectItem key={destination.id} value={destination.id}>
            {destination.label} · retención {destination.retentionDays} días
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function formatCompanyLabel(company: SelectedCompany | null): string {
  if (!company) return ''
  return company.businessName ? `${company.rfc} · ${company.businessName}` : company.rfc
}

function getActiveCompanyDescription(company: SelectedCompany | null): string {
  return company
    ? `Empresa activa: ${formatCompanyLabel(company)}`
    : 'Selecciona una empresa en el menú lateral para configurar rutinas.'
}

function getRoutineActionMessage(action: 'pause' | 'resume' | 'delete'): string {
  if (action === 'delete') return 'Rutina eliminada'
  if (action === 'pause') return 'Rutina pausada'
  return 'Rutina reactivada'
}

function Metric({ label, value, mono = false }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn('mt-1 break-words', mono && 'font-mono text-xs')}>{value}</p></div>
}

function EmptyState({ text }: Readonly<{ text: string }>) {
  return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{text}</CardContent></Card>
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  const normalized = status.toUpperCase()
  const className = getStatusClassName(normalized)
  return <Badge variant="secondary" className={className}>{statusLabel(normalized)}</Badge>
}

function getStatusClassName(status: string): string {
  if (['ACTIVE', 'COMPLETED', 'INFO'].includes(status)) return 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'ERROR'].includes(status)) return 'bg-red-100 text-red-800'
  if (['PAUSED', 'WARN', 'SKIPPED'].includes(status)) return 'bg-amber-100 text-amber-800'
  return 'bg-blue-100 text-blue-800'
}

function buildRoutinePayload(draft: RoutineDraft, companyId: string) {
  const [hourText, minuteText] = draft.scheduledTime.split(':')
  const monthDays = draft.monthDaysText
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value))
  return {
    companyId,
    name: draft.name.trim(),
    requestType: draft.requestType,
    retrievalType: draft.retrievalType,
    filters: {
      ...(draft.issuerRfc ? { issuerRfc: draft.issuerRfc.trim() } : {}),
      ...(draft.receiverRfc ? { receiverRfc: draft.receiverRfc.trim() } : {}),
      ...(draft.voucherType ? { voucherType: draft.voucherType } : {}),
      status: draft.status,
      ...(draft.thirdPartyRfc ? { thirdPartyRfc: draft.thirdPartyRfc.trim() } : {}),
      ...(draft.complement ? { complement: draft.complement } : {}),
    },
    periodPreset: draft.periodPreset,
    ...(draft.periodPreset === 'CUSTOM' ? {
      customStartDate: draft.customStartDate,
      customEndDate: draft.customEndDate,
    } : {}),
    schedule: {
      frequency: draft.frequency,
      scheduledHour: Number(hourText),
      scheduledMinute: Number(minuteText),
      weekDays: draft.frequency === 'WEEKLY' ? draft.weekDays : [],
      monthDays: draft.frequency === 'MONTHLY' ? monthDays : [],
      timezone: draft.timezone.trim(),
    },
    storageOptions: {
      enabled: draft.storageEnabled,
      ...(draft.extractionDestinationId ? { extractionDestinationId: draft.extractionDestinationId } : {}),
      ...(draft.extractionRelativePath ? { extractionRelativePath: draft.extractionRelativePath.trim() } : {}),
      ...(draft.zipBackupDestinationId ? { zipBackupDestinationId: draft.zipBackupDestinationId } : {}),
      ...(draft.zipBackupRelativePath ? { zipBackupRelativePath: draft.zipBackupRelativePath.trim() } : {}),
    },
  }
}

function withoutCompany(payload: ReturnType<typeof buildRoutinePayload>) {
  const routine = { ...payload }
  Reflect.deleteProperty(routine, 'companyId')
  return routine
}

function routineToDraft(routine: RoutineRecord | null): RoutineDraft {
  if (!routine) {
    return {
      name: '',
      requestType: 'CFDI',
      retrievalType: 'EMITIDOS',
      issuerRfc: '',
      receiverRfc: '',
      voucherType: '',
      status: 'Todos',
      thirdPartyRfc: '',
      complement: '',
      periodPreset: 'CURRENT_DAY',
      customStartDate: '',
      customEndDate: '',
      frequency: 'DAILY',
      scheduledTime: '07:00',
      weekDays: [],
      monthDaysText: '1',
      timezone: 'America/Mexico_City',
      storageEnabled: false,
      extractionDestinationId: '',
      extractionRelativePath: '',
      zipBackupDestinationId: '',
      zipBackupRelativePath: '',
    }
  }
  const filters = asRecord(routine.filters)
  const storage = asRecord(routine.storageOptions)
  return {
    name: routine.name,
    requestType: routine.requestType,
    retrievalType: routine.retrievalType,
    issuerRfc: readText(filters.issuerRfc),
    receiverRfc: readText(filters.receiverRfc),
    voucherType: readVoucherType(filters.voucherType),
    status: readStatus(filters.status),
    thirdPartyRfc: readText(filters.thirdPartyRfc),
    complement: readText(filters.complement),
    periodPreset: routine.periodPreset,
    customStartDate: toDateInput(routine.customStartDate),
    customEndDate: toDateInput(routine.customEndDate),
    frequency: routine.scheduleFrequency,
    scheduledTime: `${String(routine.scheduledHour).padStart(2, '0')}:${String(routine.scheduledMinute).padStart(2, '0')}`,
    weekDays: routine.weekDays,
    monthDaysText: routine.monthDays.join(', '),
    timezone: routine.timezone,
    storageEnabled: storage.enabled === true,
    extractionDestinationId: readText(storage.extractionDestinationId),
    extractionRelativePath: readText(storage.extractionRelativePath),
    zipBackupDestinationId: readText(storage.zipBackupDestinationId),
    zipBackupRelativePath: readText(storage.zipBackupRelativePath),
  }
}

function readSelectedCompany(): SelectedCompany | null {
  try {
    const raw = window.localStorage.getItem('selectedCompany')
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const company = asRecord(parsed)
    const id = readText(company.id)
    const rfc = readText(company.rfc)
    return id && rfc ? { id, rfc, businessName: readText(company.businessName) } : null
  } catch {
    return null
  }
}

function readDataArray<T>(value: unknown): T[] {
  const data = asRecord(value).data
  return Array.isArray(data) ? data as T[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readVoucherType(value: unknown): RoutineDraft['voucherType'] {
  return value === 'I' || value === 'E' || value === 'P' || value === 'T' || value === 'N' ? value : ''
}

function readStatus(value: unknown): RoutineDraft['status'] {
  return value === 'Vigente' || value === 'Cancelado' ? value : 'Todos'
}

function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((currentDay) => currentDay !== day) : [...days, day]
}

function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function readErrorMessage(payload: unknown, fallback: string): string {
  const error = asRecord(payload).error
  return typeof error === 'string' ? error : fallback
}

function periodLabel(period: PeriodPreset): string {
  const labels: Record<PeriodPreset, string> = {
    CURRENT_DAY: 'Día en curso',
    PREVIOUS_DAY: 'Día anterior',
    CURRENT_WEEK: 'Semana en curso',
    PREVIOUS_WEEK: 'Semana anterior',
    LAST_SEVEN_DAYS: 'Últimos 7 días',
    CURRENT_MONTH: 'Mes en curso',
    PREVIOUS_MONTH: 'Mes anterior',
    CUSTOM: 'Personalizado',
  }
  return labels[period]
}

function createEmptyRoutineFilters(): RoutineFilters {
  return {
    routine: '',
    request: '',
    period: '',
    schedule: '',
    nextRun: '',
    status: '',
  }
}

function createEmptyExecutionFilters(): ExecutionFilters {
  return {
    routine: '',
    period: '',
    request: '',
    packages: '',
    startedFinished: '',
    status: '',
  }
}

function matchesRoutineFilters(routine: RoutineRecord, filters: RoutineFilters): boolean {
  const values: Record<RoutineFilterKey, string> = {
    routine: `${routine.name} ${routine.requestingRfc}`,
    request: `${routine.requestType === 'CFDI' ? 'XML CFDI' : 'Metadata'} ${routine.retrievalType.toLowerCase()}`,
    period: periodLabel(routine.periodPreset),
    schedule: scheduleLabel(routine),
    nextRun: formatDateTime(routine.nextRunAt),
    status: `${routine.status} ${statusLabel(routine.status)}`,
  }

  return (Object.keys(filters) as RoutineFilterKey[]).every((key) =>
    normalizeSearchText(values[key]).includes(normalizeSearchText(filters[key])),
  )
}

function matchesExecutionFilters(execution: RoutineExecution, filters: ExecutionFilters): boolean {
  const values: Record<ExecutionFilterKey, string> = {
    routine: `${execution.routine?.name ?? 'Rutina eliminada'} ${formatDateTime(execution.scheduledFor)}`,
    period: `${formatDate(execution.effectiveStartDate)} ${formatDate(execution.effectiveEndDate)}`,
    request: execution.satRequestId ?? 'Pendiente',
    packages: String(execution.packagesFound),
    startedFinished: `${formatDateTime(execution.startedAt)} ${formatDateTime(execution.finishedAt)}`,
    status: `${execution.status} ${statusLabel(execution.status)}`,
  }

  return (Object.keys(filters) as ExecutionFilterKey[]).every((key) =>
    normalizeSearchText(values[key]).includes(normalizeSearchText(filters[key])),
  )
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
}

function scheduleLabel(routine: RoutineRecord): string {
  const hour = `${String(routine.scheduledHour).padStart(2, '0')}:${String(routine.scheduledMinute).padStart(2, '0')}`
  if (routine.scheduleFrequency === 'DAILY') return `Diaria · ${hour}`
  if (routine.scheduleFrequency === 'WEEKLY') return `Semanal · ${hour}`
  return `Mensual · ${hour}`
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Activa',
    PAUSED: 'Pausada',
    SCHEDULED: 'Programada',
    QUEUED: 'En cola',
    REQUESTING: 'Solicitando',
    VERIFYING: 'Verificando',
    DOWNLOADING: 'Descargando',
    PROCESSING: 'Procesando',
    COMPLETED: 'Completada',
    FAILED: 'Fallida',
    SKIPPED: 'Omitida',
    INFO: 'Información',
    WARN: 'Advertencia',
    ERROR: 'Error',
  }
  return labels[status] ?? status
}

function getExecutionErrorMessage(execution: RoutineExecution): string {
  const directMessage = execution.errorMessage?.trim()
  if (directMessage && !directMessage.startsWith('Solicitud de rutina encolada')) {
    return directMessage
  }

  const storedDetails = asRecord(execution.errorDetails)
  const storedMessage = readText(storedDetails.summary) || readText(storedDetails.message)
  if (storedMessage) return storedMessage

  const errorEvent = execution.events.find((event) => event.level.toLowerCase() === 'error')
  const details = asRecord(errorEvent?.details)
  const eventMessage = readText(details.errorMessage) || readText(details.message)
  if (eventMessage) return eventMessage

  return directMessage || 'El trabajador no registró una explicación detallada del fallo.'
}

function eventLabel(eventName: string): string {
  const labels: Record<string, string> = {
    'routine.scheduled': 'Ejecución programada',
    'routine.queued': 'Ejecución puesta en cola',
    'routine.mass_request_created': 'Solicitud SAT creada',
    'routine.sat_request_queued': 'Solicitud SAT puesta en cola',
    'sat.failed': 'Solicitud SAT fallida',
    'sat.error': 'Error de comunicación con SAT',
    'sat.completed': 'Solicitud SAT completada',
    'sat.downloading': 'Paquetes listos para descarga',
    'routine.failed': 'Ejecución fallida',
    'routine.skipped': 'Ejecución omitida',
    'storage.artifacts.failed': 'Error al guardar archivos',
    'storage.artifacts.stored': 'Archivos almacenados',
  }
  return labels[eventName] ?? eventName
}

function formatDate(value: string | null): string {
  if (!value) return 'No disponible'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'No disponible' : date.toLocaleDateString('es-MX')
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Pendiente'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Pendiente' : date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

function formatEventDetails(value: unknown): string {
  const record = asRecord(value)
  const entries = Object.entries(record)
  return entries.map(([key, detail]) => `${key}: ${formatEventDetail(detail)}`).join(' · ')
}

function formatEventDetail(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'symbol') return value.description ?? ''
  return JSON.stringify(value)
}

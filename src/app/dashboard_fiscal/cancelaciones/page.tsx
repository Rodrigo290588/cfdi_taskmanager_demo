'use client'

import { useEffect, useState, useCallback } from 'react'
import { ProtectedRoute } from '@/components/protected-route'
import { SatStatus, StatusCancelacion } from '@prisma/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getCfdisCancelados, updateCfdiStatus, getCfdisSummary, exportCfdisCancelados } from '@/actions/cancelaciones'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Download, DollarSign, Percent, Clock, AlertOctagon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type CfdiRow = {
  uuid: string
  statusSat: string
  statusCancelacion: string | null
  motivoCancelacion: string | null
  fechaEmision: Date
  fechaCancelacion: Date | null
  montoTotal: number
  impuestos: number
  rfcReceptor: string | null
  nombreReceptor: string | null
}

type ExportRow = {
  uuid: string
  rfcEmisor?: string | null
  rfcReceptor?: string | null
  fechaEmision?: string | Date
  montoTotal: number
  impuestos: number
  statusSat: string
  statusCancelacion?: string | null
  fechaCancelacion?: string | Date | null
  statusErp?: string | null
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value)

const formatDate = (date: Date | null) => {
  if (!date) return '-'
  return format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: es })
}

export default function CancelacionesPage() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<CfdiRow[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState({ 
    totalVigente: 0, 
    totalCancelado: 0, 
    totalEnProceso: 0,
    efectoFiscalNeto: 0,
    tasaErrorFacturacion: 0,
    agingCancelacion: 0,
    montoEnRiesgo: 0
  })
  
  const [selectedEntity, setSelectedEntity] = useState<{ rfc: string } | null>(null)

  useEffect(() => {
    const handleCompanySelected = () => {
      const stored = localStorage.getItem('selectedCompany')
      if (stored) {
        const company = JSON.parse(stored)
        setSelectedEntity(company)
      }
    }
    handleCompanySelected()
    window.addEventListener('company-selected', handleCompanySelected)
    return () => window.removeEventListener('company-selected', handleCompanySelected)
  }, [])
  
  // Filtros
  const [classification, setClassification] = useState<string>('issued')
  const [fechaEmisionInicio, setFechaEmisionInicio] = useState('')
  const [fechaEmisionFin, setFechaEmisionFin] = useState('')
  const [fechaCancelacionInicio, setFechaCancelacionInicio] = useState('')
  const [fechaCancelacionFin, setFechaCancelacionFin] = useState('')

  // Filtros por columna
  const [filterUuid, setFilterUuid] = useState('')
  const [filterMonto, setFilterMonto] = useState('')
  const [filterImpuestos, setFilterImpuestos] = useState('')
  const [filterRfcReceptor, setFilterRfcReceptor] = useState('')
  const [filterNombreReceptor, setFilterNombreReceptor] = useState('')
  const [filterStatusSat, setFilterStatusSat] = useState<string>('all')
  const [filterStatusCancelacion, setFilterStatusCancelacion] = useState<string>('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [res, sum] = await Promise.all([
        getCfdisCancelados(
          page, 
          10, 
          undefined, 
          fechaEmisionInicio || null, 
          fechaEmisionFin || null, 
          fechaCancelacionInicio || null, 
          fechaCancelacionFin || null,
          filterUuid || undefined,
          filterMonto ? parseFloat(filterMonto) : undefined,
          filterImpuestos ? parseFloat(filterImpuestos) : undefined,
          filterStatusSat !== 'all' ? filterStatusSat as SatStatus : undefined,
          filterStatusCancelacion !== 'all' ? filterStatusCancelacion as StatusCancelacion : undefined,
          selectedEntity?.rfc,
          filterRfcReceptor || undefined,
          filterNombreReceptor || undefined,
          classification
        ),
        getCfdisSummary(
          undefined,
          fechaEmisionInicio || null,
          fechaEmisionFin || null,
          fechaCancelacionInicio || null,
          fechaCancelacionFin || null,
          selectedEntity?.rfc,
          classification
        )
      ])
      setRows(res.cfdis as CfdiRow[])
      setTotalPages(res.totalPages)
      setTotal(res.total)
      setSummary(sum)
    } catch {
      toast.error('Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }, [
    page, 
    fechaEmisionInicio, 
    fechaEmisionFin, 
    fechaCancelacionInicio, 
    fechaCancelacionFin,
    filterUuid,
    filterMonto,
    filterImpuestos,
    filterStatusSat,
    filterStatusCancelacion,
    selectedEntity,
    filterRfcReceptor,
    filterNombreReceptor,
    classification
  ])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleStatusChange = async (uuid: string, status: StatusCancelacion) => {
    try {
      const res = await updateCfdiStatus(uuid, status)
      if (res.success) {
        toast.success('Estatus actualizado')
        fetchData()
      } else {
        toast.error('Error al actualizar estatus')
      }
    } catch {
      toast.error('Error de red')
    }
  }

  const handleExport = async () => {
    try {
      toast.info('Generando reporte...')
      const data = await exportCfdisCancelados(
        undefined, 
        fechaEmisionInicio || null, 
        fechaEmisionFin || null, 
        fechaCancelacionInicio || null, 
        fechaCancelacionFin || null,
        filterUuid || undefined,
        filterMonto ? parseFloat(filterMonto) : undefined,
        filterImpuestos ? parseFloat(filterImpuestos) : undefined,
        filterStatusSat !== 'all' ? filterStatusSat as SatStatus : undefined,
        filterStatusCancelacion !== 'all' ? filterStatusCancelacion as StatusCancelacion : undefined,
        selectedEntity?.rfc,
        filterRfcReceptor || undefined,
        filterNombreReceptor || undefined,
        classification
      )

      if (!data || data.length === 0) {
        toast.warning('No hay datos para exportar')
        return
      }
      
      const headers = ['UUID', 'RFC Emisor', 'RFC Receptor', 'Fecha Emisión', 'Monto Total', 'Impuestos', 'Estatus SAT', 'Estatus Cancelación', 'Fecha Cancelación', 'Estatus ERP']
      const csvContent = [
        headers.join(','),
        ...data.map((row: ExportRow) => [
          row.uuid,
          row.rfcEmisor || '',
          row.rfcReceptor || '',
          row.fechaEmision ? new Date(row.fechaEmision).toISOString().split('T')[0] : '',
          row.montoTotal,
          row.impuestos,
          row.statusSat,
          row.statusCancelacion || '',
          row.fechaCancelacion ? new Date(row.fechaCancelacion).toISOString().split('T')[0] : '',
          row.statusErp || ''
        ].join(','))
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', `reporte_cancelaciones_${new Date().toISOString().split('T')[0]}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('Reporte descargado')
    } catch (error) {
      console.error(error)
      toast.error('Error al exportar datos')
    }
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Conciliación de Cancelaciones</h2>
            <p className="text-muted-foreground">
              Gestión de estatus de cancelación ante el SAT
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refrescar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label>Clasificación de CFDI</Label>
            <Select value={classification} onValueChange={(val) => { setPage(1); setClassification(val) }}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="issued">Emitidos</SelectItem>
                <SelectItem value="received">Recibidos</SelectItem>
                <SelectItem value="both">Ambos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fechaEmisionInicio">Emisión Desde</Label>
            <Input
              id="fechaEmisionInicio"
              type="date"
              value={fechaEmisionInicio}
              onChange={(e) => { setPage(1); setFechaEmisionInicio(e.target.value); }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fechaEmisionFin">Emisión Hasta</Label>
            <Input
              id="fechaEmisionFin"
              type="date"
              value={fechaEmisionFin}
              onChange={(e) => { setPage(1); setFechaEmisionFin(e.target.value); }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fechaCancelacionInicio">Cancelación Desde</Label>
            <Input
              id="fechaCancelacionInicio"
              type="date"
              value={fechaCancelacionInicio}
              onChange={(e) => { setPage(1); setFechaCancelacionInicio(e.target.value); }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fechaCancelacionFin">Cancelación Hasta</Label>
            <Input
              id="fechaCancelacionFin"
              type="date"
              value={fechaCancelacionFin}
              onChange={(e) => { setPage(1); setFechaCancelacionFin(e.target.value); }}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Vigentes
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalVigente)}</div>
              <p className="text-xs text-muted-foreground">
                Monto total de comprobantes vigentes
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Cancelados
              </CardTitle>
              <XCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalCancelado)}</div>
              <p className="text-xs text-muted-foreground">
                Monto total cancelado definitivamente
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                En Proceso
              </CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalEnProceso)}</div>
              <p className="text-xs text-muted-foreground">
                Solicitudes de cancelación pendientes
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Efecto Fiscal Neto
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.efectoFiscalNeto)}</div>
              <p className="text-xs text-muted-foreground">
                Ingresos vigentes - Cancelaciones
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Tasa Error Facturación
              </CardTitle>
              <Percent className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.tasaErrorFacturacion.toFixed(2)}%</div>
              <p className="text-xs text-muted-foreground">
                Cancelados / Total Emitidos
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Aging Cancelación
              </CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.agingCancelacion.toFixed(1)} días</div>
              <p className="text-xs text-muted-foreground">
                Promedio días emisión vs cancelación
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Monto en Riesgo
              </CardTitle>
              <AlertOctagon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">{formatCurrency(summary.montoEnRiesgo)}</div>
              <p className="text-xs text-muted-foreground">
                Vigentes en ERP pero Cancelados en SAT
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>CFDIs en Proceso de Cancelación</CardTitle>
              <CardDescription>
                Total de registros: {total}
              </CardDescription>
            </div>
            <Button onClick={handleExport} variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Descargar reporte
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>UUID</TableHead>
                    <TableHead>Fecha Emisión</TableHead>
                    <TableHead>RFC Receptor</TableHead>
                    <TableHead>Nombre Receptor</TableHead>
                    <TableHead>Monto Total</TableHead>
                    <TableHead>Impuestos</TableHead>
                    <TableHead>Estatus SAT</TableHead>
                    <TableHead>Estatus Cancelación</TableHead>
                    <TableHead>Fecha Cancelación</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                  {/* Fila de filtros */}
                  <TableRow>
                    <TableHead>
                      <Input 
                        placeholder="Filtrar UUID" 
                        value={filterUuid}
                        onChange={(e) => { setPage(1); setFilterUuid(e.target.value) }}
                        className="h-8 text-xs min-w-[120px]"
                      />
                    </TableHead>
                    <TableHead>
                      {/* Fecha Emisión ya tiene filtro global arriba */}
                      <span className="text-xs text-muted-foreground italic">Ver arriba</span>
                    </TableHead>
                    <TableHead>
                      <Input 
                        placeholder="Filtrar RFC" 
                        value={filterRfcReceptor}
                        onChange={(e) => { setPage(1); setFilterRfcReceptor(e.target.value) }}
                        className="h-8 text-xs min-w-[120px]"
                      />
                    </TableHead>
                    <TableHead>
                      <Input 
                        placeholder="Filtrar Nombre" 
                        value={filterNombreReceptor}
                        onChange={(e) => { setPage(1); setFilterNombreReceptor(e.target.value) }}
                        className="h-8 text-xs min-w-[150px]"
                      />
                    </TableHead>
                    <TableHead>
                      <Input 
                        type="number"
                        placeholder="Monto" 
                        value={filterMonto}
                        onChange={(e) => { setPage(1); setFilterMonto(e.target.value) }}
                        className="h-8 text-xs w-[100px]"
                      />
                    </TableHead>
                    <TableHead>
                      <Input 
                        type="number"
                        placeholder="Impuestos" 
                        value={filterImpuestos}
                        onChange={(e) => { setPage(1); setFilterImpuestos(e.target.value) }}
                        className="h-8 text-xs w-[100px]"
                      />
                    </TableHead>
                    <TableHead>
                      <Select 
                        value={filterStatusSat} 
                        onValueChange={(val) => { setPage(1); setFilterStatusSat(val) }}
                      >
                        <SelectTrigger className="h-8 text-xs w-[130px]">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="VIGENTE">VIGENTE</SelectItem>
                          <SelectItem value="CANCELADO">CANCELADO</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead>
                      <Select 
                        value={filterStatusCancelacion} 
                        onValueChange={(val) => { setPage(1); setFilterStatusCancelacion(val) }}
                      >
                        <SelectTrigger className="h-8 text-xs w-[140px]">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="SIN_ACEPTACION">SIN_ACEPTACION</SelectItem>
                          <SelectItem value="CON_ACEPTACION">CON_ACEPTACION</SelectItem>
                          <SelectItem value="PLAZO_VENCIDO">PLAZO_VENCIDO</SelectItem>
                          <SelectItem value="NO_CANCELABLE">NO_CANCELABLE</SelectItem>
                          <SelectItem value="RECHAZADO">RECHAZADO</SelectItem>
                          <SelectItem value="EN_PROCESO">EN_PROCESO</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead>
                      {/* Fecha Cancelación ya tiene filtro global arriba */}
                      <span className="text-xs text-muted-foreground italic">Ver arriba</span>
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center h-24 text-muted-foreground">
                        No hay registros.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.uuid}>
                        <TableCell className="font-mono text-xs">{row.uuid}</TableCell>
                        <TableCell>{formatDate(row.fechaEmision)}</TableCell>
                        <TableCell className="font-mono text-xs">{row.rfcReceptor || '-'}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={row.nombreReceptor || ''}>{row.nombreReceptor || '-'}</TableCell>
                        <TableCell>{formatCurrency(row.montoTotal)}</TableCell>
                        <TableCell>{formatCurrency(row.impuestos)}</TableCell>
                        <TableCell>
                          <Badge variant={row.statusSat === 'VIGENTE' ? 'default' : 'destructive'}>
                            {row.statusSat}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            row.statusCancelacion === 'CON_ACEPTACION' ? 'border-green-500 text-green-500' :
                            row.statusCancelacion === 'RECHAZADO' ? 'border-red-500 text-red-500' :
                            'border-yellow-500 text-yellow-500'
                          }>
                            {row.statusCancelacion || 'N/A'}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(row.fechaCancelacion)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                Gestionar
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleStatusChange(row.uuid, StatusCancelacion.CON_ACEPTACION)}>
                                <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                                Aceptar Cancelación
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(row.uuid, StatusCancelacion.RECHAZADO)}>
                                <XCircle className="mr-2 h-4 w-4 text-red-500" />
                                Rechazar Cancelación
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(row.uuid, StatusCancelacion.EN_PROCESO)}>
                                <AlertTriangle className="mr-2 h-4 w-4 text-yellow-500" />
                                Marcar En Proceso
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            
            <div className="flex items-center justify-end space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= totalPages || loading}
              >
                Siguiente
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

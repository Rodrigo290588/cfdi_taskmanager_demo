'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Search, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ProtectedRoute } from '@/components/auth/protected-route'

// Types based on Prisma model
interface MassDownloadRequest {
  id: string
  requestingRfc: string
  issuerRfc: string | null
  receiverRfc: string | null
  requestType: string
  retrievalType: string
  folio: string | null
  status: string
  requestStatus: string
  satPackageId: string | null
  satMessage: string | null
  createdAt: string
  startDate: string | null
  endDate: string | null
  errorLog: Record<string, unknown> | null
}

export default function MonitorPage() {
  const [requests, setRequests] = useState<MassDownloadRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<{ id: string, rfc: string, businessName?: string } | null>(null)
  
  // Filters
  const [filters, setFilters] = useState({
    requestType: 'all',
    status: 'Todos',
    startDate: '',
    endDate: '',
    folio: ''
  })

  // Load selected company
  useEffect(() => {
    const updateCompany = () => {
      try {
        const stored = localStorage.getItem('selectedCompany')
        if (stored) {
          const company = JSON.parse(stored)
          if (company?.id && company?.rfc) {
            setSelectedCompany(company)
          }
        }
      } catch (e) {
        console.error('Error loading company', e)
      }
    }

    updateCompany()
    window.addEventListener('company-selected', updateCompany)
    return () => window.removeEventListener('company-selected', updateCompany)
  }, [])

  // Fetch data
  const fetchRequests = useCallback(async () => {
    if (!selectedCompany?.rfc) return

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('rfc', selectedCompany.rfc) // Filter by the selected RFC
      
      if (filters.requestType !== 'all') params.append('requestType', filters.requestType)
      if (filters.status !== 'Todos') params.append('status', filters.status)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      if (filters.folio) params.append('folio', filters.folio)

      const res = await fetch(`/api/mass-downloads/requests?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar peticiones')
      
      const data = await res.json()
      setRequests(data)
    } catch (error) {
      console.error(error)
      toast.error('Error al cargar la información')
    } finally {
      setLoading(false)
    }
  }, [selectedCompany?.rfc, filters])

  // Auto-fetch when company changes
  useEffect(() => {
    if (selectedCompany?.rfc) {
      fetchRequests()
    }
  }, [selectedCompany, fetchRequests])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchRequests()
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SOLICITADO':
      case 'PENDIENTE':
        return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 border-yellow-500/20">Solicitado</Badge>
      case 'ACEPTADO':
      case 'VERIFICADO':
      case 'FINALIZADO':
      case 'COMPLETADO':
        return <Badge variant="default" className="bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">Completado</Badge>
      case 'ERROR':
        return <Badge variant="destructive" className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20">Error</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatRequestType = (type: string) => {
    return type === 'metadata' ? 'Metadatos' : 'CFDI'
  }

  const formatRetrievalType = (type: string) => {
    switch (type) {
      case 'emitidos': return 'Emitidos'
      case 'recibidos': return 'Recibidos'
      case 'folio': return 'Por Folio'
      default: return type
    }
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex flex-col space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Monitor de Solicitudes</h2>
          <div className="flex items-center space-x-2">
            <p className="text-muted-foreground">
              Consulta el estado de tus solicitudes de descarga masiva ante el SAT.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              Filtros de Búsqueda
            </CardTitle>
            <CardDescription>
              {selectedCompany ? (
                <span>Consultando para: <span className="font-medium text-foreground">{selectedCompany.businessName || selectedCompany.rfc}</span></span>
              ) : (
                <span className="text-yellow-600 dark:text-yellow-500">Selecciona una empresa en el menú principal para comenzar</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 items-end">
              <div className="space-y-2">
                <Label>Tipo de Solicitud</Label>
                <Select 
                  value={filters.requestType} 
                  onValueChange={(val) => setFilters(prev => ({ ...prev, requestType: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="metadata">Metadatos</SelectItem>
                    <SelectItem value="cfdi">CFDI (XML)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Estatus (Vigencia)</Label>
                <Select 
                  value={filters.status} 
                  onValueChange={(val) => setFilters(prev => ({ ...prev, status: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Todos">Todos</SelectItem>
                    <SelectItem value="Vigente">Vigente</SelectItem>
                    <SelectItem value="Cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Fecha Inicio</Label>
                <Input 
                  type="date" 
                  value={filters.startDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Fecha Fin</Label>
                <Input 
                  type="date" 
                  value={filters.endDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                />
              </div>
              
              <div className="space-y-2 md:col-span-2 lg:col-span-1">
                <Label>Folio (UUID)</Label>
                <Input 
                  placeholder="Buscar por UUID..." 
                  value={filters.folio}
                  onChange={(e) => setFilters(prev => ({ ...prev, folio: e.target.value }))}
                />
              </div>

              <div className="flex gap-2 lg:col-span-3 justify-end">
                <Button type="button" variant="outline" onClick={() => fetchRequests()} disabled={loading || !selectedCompany}>
                  <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                  Actualizar
                </Button>
                <Button type="submit" disabled={loading || !selectedCompany}>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resultados</CardTitle>
            <CardDescription>
              {requests.length} solicitudes encontradas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha Solicitud</TableHead>
                    <TableHead>Tipo Recuperación</TableHead>
                    <TableHead>Rango Fechas</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>RFC Objetivo</TableHead>
                    <TableHead>ID Paquete SAT</TableHead>
                    <TableHead>Estatus</TableHead>
                    <TableHead>Mensaje SAT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Cargando peticiones...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : requests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                        No se encontraron solicitudes
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">
                          {format(new Date(request.createdAt), 'dd/MM/yyyy HH:mm', { locale: es })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {formatRetrievalType(request.retrievalType)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {request.retrievalType === 'folio' ? (
                            <span className="font-mono text-xs text-muted-foreground">{request.folio}</span>
                          ) : (
                            <div className="flex flex-col text-xs text-muted-foreground">
                              <span>Del: {request.startDate ? format(new Date(request.startDate), 'dd/MM/yyyy', { locale: es }) : '-'}</span>
                              <span>Al: {request.endDate ? format(new Date(request.endDate), 'dd/MM/yyyy', { locale: es }) : '-'}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-normal">
                            {formatRequestType(request.requestType)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                           {request.retrievalType === 'emitidos' ? request.receiverRfc || 'Todos' : request.issuerRfc || 'Todos'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {request.satPackageId || '-'}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(request.requestStatus)}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <div className="truncate text-xs text-muted-foreground" title={request.satMessage || (request.errorLog as { message?: string })?.message || ''}>
                            {request.satMessage || ((request.errorLog as { message?: string })?.message ? 'Ver error en log' : '-')}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

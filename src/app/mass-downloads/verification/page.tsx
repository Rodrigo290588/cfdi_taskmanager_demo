'use client'

import { useState, useEffect } from 'react'
import { format as formatFns } from 'date-fns'

// Dummy utility to format dates for timestamps
const format = (date: string | Date, fmt?: string) => {
  try {
    const d = new Date(date)
    if (fmt?.includes('HH:mm')) {
      return d.toLocaleString('es-MX', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
    return d.toLocaleDateString('es-MX')
  } catch {
    return String(date)
  }
}

// Helper to safely format dates for CFDI period (fixes SonarQube nested ternary warning)
const formatSafeDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  const isoDateStr = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
  return formatFns(new Date(isoDateStr), 'dd/MM/yyyy')
}
import { RefreshCw, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
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
  updatedAt: string
  startDate: string | null
  endDate: string | null
  errorLog: Record<string, unknown> | null
  // New fields
  verificationAttempts: number
  nextCheck: string | null
  packageIds: string[] | null
}

function buildMonitorParams(rfc: string, filters: { status: string; startDate: string; endDate: string; satPackageId: string }) {
  const params = new URLSearchParams()
  params.append('rfc', rfc)
  if (filters.status !== 'Todos') params.append('status', filters.status)
  if (filters.startDate) params.append('startDate', filters.startDate)
  if (filters.endDate) params.append('endDate', filters.endDate)
  if (filters.satPackageId) params.append('satPackageId', filters.satPackageId)
  return params
}

async function loadVerificationRequests(
  rfc: string,
  filters: { status: string; startDate: string; endDate: string; satPackageId: string },
  setLoading: (value: boolean) => void,
  setRequests: (value: MassDownloadRequest[]) => void
) {
  setLoading(true)
  try {
    const params = buildMonitorParams(rfc, filters)

    const res = await fetch(`/api/mass-downloads/requests?${params.toString()}`)
    if (!res.ok) throw new Error('Error al cargar peticiones')

    const responseData = await res.json()
    console.log('API Response (Verification):', responseData)
    
    let data: MassDownloadRequest[] = []
    if (Array.isArray(responseData)) {
      data = responseData
    } else if (responseData && typeof responseData === 'object' && 'data' in responseData && Array.isArray((responseData as { data: unknown }).data)) {
      data = (responseData as { data: MassDownloadRequest[] }).data
    } else {
      console.warn('Unexpected API response format:', responseData)
    }
    
    const relevant = data.filter(r => r.satPackageId !== null)
    setRequests(relevant)
  } catch (error) {
    console.error(error)
    toast.error('Error al cargar la información')
  } finally {
    setLoading(false)
  }
}

export default function VerificationMonitorPage() {
  const [requests, setRequests] = useState<MassDownloadRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<{ id: string, rfc: string, businessName?: string } | null>(null)
  
  // Filters
  const [filters, setFilters] = useState({
    status: 'Todos',
    startDate: '',
    endDate: '',
    satPackageId: ''
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
  async function fetchRequests(showLoadingIndicator = true) {
    if (!selectedCompany?.rfc) return
    setHasSearched(true)
    if (showLoadingIndicator) {
      await loadVerificationRequests(selectedCompany.rfc, filters, setLoading, setRequests)
    } else {
      // Background fetch sin mostrar el spinner en el botón
      await loadVerificationRequests(selectedCompany.rfc, filters, () => {}, setRequests)
    }
  }

  // Auto-refresh every 5 seconds silently
  useEffect(() => {
    if (!selectedCompany?.rfc || !hasSearched) return
    const rfc = selectedCompany.rfc
    const interval = setInterval(() => {
      // Actualización silenciosa: pasamos una función vacía en lugar de setLoading
      void loadVerificationRequests(rfc, filters, () => {}, setRequests)
    }, 5000)
    return () => clearInterval(interval)
  }, [filters, selectedCompany?.rfc, hasSearched])

  const handleSearch = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    void fetchRequests()
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'TERMINADO':
      case 'COMPLETADO':
        return <Badge className="bg-green-500 hover:bg-green-600">TERMINADO</Badge>
      case 'EN_PROCESO':
        return <Badge className="bg-blue-500 hover:bg-blue-600">EN PROCESO</Badge>
      case 'SOLICITADO':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">SOLICITADO</Badge>
      case 'ERROR':
        return <Badge variant="destructive">ERROR</Badge>
      case 'RECHAZADO':
        return <Badge variant="destructive">RECHAZADO</Badge>
      case 'VENCIDO':
        return <Badge className="bg-gray-500">VENCIDO</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const renderTableBody = () => {
    if (!hasSearched) {
      return (
        <TableRow>
          <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
            Usa los filtros para realizar una búsqueda
          </TableCell>
        </TableRow>
      )
    }

    if (loading && requests.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
            Cargando...
          </TableCell>
        </TableRow>
      )
    }

    if (requests.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
            No hay solicitudes para verificar
          </TableCell>
        </TableRow>
      )
    }

    return requests.map((request) => (
      <TableRow key={request.id}>
        <TableCell className="whitespace-nowrap">
          {format(new Date(request.createdAt), 'dd/MM/yyyy HH:mm')}
        </TableCell>
        <TableCell>{request.requestingRfc}</TableCell>
        <TableCell>
          <Badge variant="outline" className={request.requestType === 'metadata' ? 'bg-slate-100 text-slate-800' : 'bg-blue-50 text-blue-800'}>
            {request.requestType === 'metadata' ? 'Metadata' : 'CFDI'}
          </Badge>
        </TableCell>
        <TableCell className="text-xs">
          {formatSafeDate(request.startDate)} - {formatSafeDate(request.endDate)}
        </TableCell>
        <TableCell className="font-mono text-xs">{request.satPackageId}</TableCell>
        <TableCell>{getStatusBadge(request.requestStatus)}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {request.requestStatus === 'TERMINADO'
            ? format(new Date(request.updatedAt), 'dd/MM/yyyy HH:mm')
            : '-'}
        </TableCell>
        <TableCell className="text-center">{request.verificationAttempts}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {request.nextCheck ? (
            <div className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>
                {format(new Date(request.nextCheck), 'dd/MM/yyyy HH:mm')}
              </span>
            </div>
          ) : '-'}
        </TableCell>
        <TableCell className="max-w-[200px]">
           <div className="truncate text-xs text-muted-foreground" title={request.satMessage || (request.errorLog as { message?: string })?.message || ''}>
            {request.satMessage || ((request.errorLog as { message?: string })?.message ? 'Ver error en log' : '-')}
          </div>
        </TableCell>
        <TableCell>
          {request.packageIds && request.packageIds.length > 0 ? (
            <Badge variant="outline" className="text-xs">
              {request.packageIds.length} Paquetes
            </Badge>
          ) : '-'}
        </TableCell>
      </TableRow>
    ))
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <div className="flex flex-col space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Verificación de Solicitudes SAT</h1>
            <p className="text-sm text-muted-foreground">
              Consulta el estado de las solicitudes enviadas y descarga los paquetes listos.
            </p>
          </div>
          <Button onClick={() => void fetchRequests()} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Actualizando...' : 'Actualizar Estado'}
          </Button>
        </div>

        {!selectedCompany ? (
          <Card className="mt-4">
            <CardContent className="py-10 text-center text-muted-foreground">
              Selecciona una empresa en el menú lateral para ver la información.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardContent>
                <form onSubmit={handleSearch} className="grid gap-4 md:grid-cols-4 items-start">
                  <div className="space-y-2">
                    <Label>Estatus</Label>
                    <Select 
                      value={filters.status} 
                      onValueChange={(v) => setFilters(prev => ({ ...prev, status: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Todos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Todos">Todos</SelectItem>
                        <SelectItem value="EN_PROCESO">En Proceso</SelectItem>
                        <SelectItem value="TERMINADO">Terminado</SelectItem>
                        <SelectItem value="ERROR">Error</SelectItem>
                        <SelectItem value="RECHAZADO">Rechazado</SelectItem>
                        <SelectItem value="VENCIDO">Vencido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Fecha Inicio de solicitud</Label>
                    <Input 
                      type="date" 
                      value={filters.startDate}
                      onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Fecha Fin de solicitud</Label>
                    <Input 
                      type="date" 
                      value={filters.endDate}
                      onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-1">
                    <Label>ID Paquete SAT</Label>
                    <Input 
                      placeholder="Buscar por ID..." 
                      value={filters.satPackageId}
                      onChange={(e) => setFilters(prev => ({ ...prev, satPackageId: e.target.value }))}
                    />
                  </div>

                  <div className="flex gap-2 md:col-span-4 justify-start self-end">
                    <Button type="submit" disabled={loading || !selectedCompany}>
                      Buscar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <Table className="[&_th]:px-4 [&_td]:px-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha Creación</TableHead>
                      <TableHead>RFC Solicitante</TableHead>
                      <TableHead>Tipo Archivo</TableHead>
                      <TableHead>Rango Fechas</TableHead>
                      <TableHead>ID Paquete SAT</TableHead>
                      <TableHead>Estatus</TableHead>
                      <TableHead>Fecha de petición</TableHead>
                      <TableHead className="text-center">Intentos</TableHead>
                      <TableHead>Próxima Verificación</TableHead>
                      <TableHead>Mensaje SAT</TableHead>
                      <TableHead>Paquetes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderTableBody()}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}

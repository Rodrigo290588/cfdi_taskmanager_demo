'use client'

import { useState, useEffect, useCallback } from 'react'
// Removed date-fns imports
// Dummy utility to format dates
const format = (date: string | Date, fmt?: string) => {
  try {
    const d = new Date(date)
    if (fmt && fmt.includes('HH:mm')) {
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
import { RefreshCw, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  updatedAt: string
  startDate: string | null
  endDate: string | null
  errorLog: Record<string, unknown> | null
  // New fields
  verificationAttempts: number
  nextCheck: string | null
  packageIds: string[] | null
}

export default function VerificationMonitorPage() {
  const [requests, setRequests] = useState<MassDownloadRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<{ id: string, rfc: string, businessName?: string } | null>(null)
  
  // Filters
  const [filters, setFilters] = useState({
    status: 'Todos',
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
      
      // We might want to filter by requests that HAVE a satPackageId
      // But the API might not support that specific filter yet.
      // For now, we fetch all and filter client side or assume API returns relevant ones.
      
      const res = await fetch(`/api/mass-downloads/requests?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar peticiones')
      
      const data: MassDownloadRequest[] = await res.json()
      
      // Filter for verification relevance (has satPackageId)
      const relevant = data.filter(r => r.satPackageId !== null)
      setRequests(relevant)
    } catch (error) {
      console.error(error)
      toast.error('Error al cargar la información')
    } finally {
      setLoading(false)
    }
  }, [selectedCompany?.rfc])

  // Auto-fetch when company changes
  useEffect(() => {
    if (selectedCompany?.rfc) {
      fetchRequests()
    }
  }, [selectedCompany, fetchRequests])

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!selectedCompany?.rfc) return
    const interval = setInterval(() => {
      fetchRequests()
    }, 5000)
    return () => clearInterval(interval)
  }, [selectedCompany?.rfc, fetchRequests])

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

  const filteredRequests = requests.filter(r => {
    if (filters.status !== 'Todos' && r.requestStatus !== filters.status) return false
    return true
  })

  return (
    <ProtectedRoute>
      <div className="container mx-auto px-4 lg:px-8 py-6 space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex flex-col space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Monitor de Verificación</h1>
            <p className="text-muted-foreground">
              Rastreo del ciclo de vida y verificación automática de solicitudes SAT.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={fetchRequests} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Actualizar
            </Button>
          </div>
        </div>

        {!selectedCompany ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Selecciona una empresa en el menú lateral para ver la información.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Filtros</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <Table className="[&_th]:px-4 [&_td]:px-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha Creación</TableHead>
                      <TableHead>RFC Solicitante</TableHead>
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
                    {filteredRequests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No hay solicitudes para verificar
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRequests.map((request) => (
                        <TableRow key={request.id}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(request.createdAt), 'dd/MM/yyyy HH:mm')}
                          </TableCell>
                          <TableCell>{request.requestingRfc}</TableCell>
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
                    )}
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

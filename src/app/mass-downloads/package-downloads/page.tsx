 'use client'

import { useEffect, useState, useCallback } from 'react'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
// Removed date-fns imports
import { CloudDownload, RefreshCw, Loader2 } from 'lucide-react'

// Dummy utility to format dates (to replace date-fns temporarily)
const formatDate = (date: string | Date) => {
  try {
    const d = new Date(date)
    return d.toLocaleDateString('es-MX')
  } catch {
    return String(date)
  }
}
import { cn } from '@/lib/utils'

interface PackageRequest {
  id_solicitud: string
  rfc: string
  estado_code: number
  estado_texto: string
  progreso: number
  paquetes: string[]
  fecha_vencimiento: string
  fecha_peticion: string | null
  periodoMes: number
  periodoAnio: number
  totalXml: number
  descargadosXml: number
  requestType: string
}

function getStatusBadge(code: number, text: string) {
  if (code === 3) {
    return <Badge className="bg-green-500 hover:bg-green-600">{text}</Badge>
  }
  if (code === 2) {
    return <Badge className="bg-blue-500 hover:bg-blue-600">{text}</Badge>
  }
  if (code === 1) {
    return <Badge className="bg-yellow-500 hover:bg-yellow-600">{text}</Badge>
  }
  return <Badge variant="secondary">{text}</Badge>
}

function getProgressFromEstado(code: number) {
  if (code === 1) return 10
  if (code === 2) return 50
  if (code === 3) return 100
  return 0
}

export default function PackageDownloadsPage() {
  const [requests, setRequests] = useState<PackageRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [autoRefresh] = useState(true)
  const [selectedRequest, setSelectedRequest] = useState<PackageRequest | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<{ id: string, rfc: string, businessName?: string } | null>(null)

  const [isDownloadingZip, setIsDownloadingZip] = useState<string | null>(null)

  const handleDownloadZip = async (rfc: string, idPaquete: string) => {
    try {
      setIsDownloadingZip(idPaquete)
      const url = `/api/mass-downloads/download-zip?rfc=${encodeURIComponent(rfc)}&idPaquete=${encodeURIComponent(idPaquete)}`
      
      // Intentamos abrir la descarga en la misma ventana para que el navegador inicie la descarga
      window.location.href = url
      
      toast.success(`Descargando paquete ${idPaquete}...`)
    } catch (error) {
      console.error(error)
      toast.error('Ocurrió un error al intentar descargar el paquete')
    } finally {
      // Damos un pequeño retraso para apagar el estado de carga
      setTimeout(() => setIsDownloadingZip(null), 2000)
    }
  }

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

  const fetchData = useCallback(async () => {
    if (!selectedCompany?.rfc) return

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('rfc', selectedCompany.rfc)

      const res = await fetch(`/api/mass-downloads/package-downloads?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Error al cargar solicitudes de paquetes')
      const data: PackageRequest[] = await res.json()
      const normalized = data.map((item) => ({
        ...item,
        progreso: item.progreso ?? getProgressFromEstado(item.estado_code),
      }))
      setRequests(normalized)
    } catch (error) {
      console.error(error)
      toast.error('Error al cargar la información de paquetes')
    } finally {
      setLoading(false)
    }
  }, [selectedCompany?.rfc])

  // Auto-fetch when company changes
  useEffect(() => {
    if (selectedCompany?.rfc) {
      fetchData()
    }
  }, [selectedCompany, fetchData])

  useEffect(() => {
    if (!autoRefresh || !selectedCompany?.rfc) return
    const interval = setInterval(() => {
      fetchData()
    }, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchData, selectedCompany?.rfc])

  const cfdiRequests = requests.filter(r => r.requestType !== 'metadata')
  const metadataRequests = requests.filter(r => r.requestType === 'metadata')

  const totalXml = cfdiRequests.reduce((acc, r) => acc + r.totalXml, 0)
  const totalDescargados = cfdiRequests.reduce((acc, r) => acc + r.descargadosXml, 0)

  const totalMetadata = metadataRequests.reduce((acc, r) => acc + r.totalXml, 0)
  const metadataDescargados = metadataRequests.reduce((acc, r) => acc + r.descargadosXml, 0)

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <div className="flex flex-col space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Descarga de Paquetes</h1>
            <p className="text-sm text-muted-foreground">
              Monitor de descarga de paquetes .zip de CFDI desde el WebService del SAT.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading || !selectedCompany}>
              <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
              Actualizar
            </Button>
          </div>
        </div>

        {!selectedCompany ? (
          <Card className="mt-4">
            <CardContent className="py-10 text-center text-muted-foreground">
              Selecciona una empresa en el menú lateral para ver la información de sus descargas.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* CFDI Cards */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    XML CFDI a descargar
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold">{totalXml}</span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    XML CFDI descargados
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  <span className="text-3xl font-bold text-emerald-500">{totalDescargados}</span>
                  <Progress value={totalXml > 0 ? (totalDescargados / totalXml) * 100 : 0} className="h-1 mt-2" />
                </CardContent>
              </Card>

              {/* Metadata Cards */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Registros Metadata a descargar
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-indigo-500">{totalMetadata}</span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Registros Metadata importados
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  <span className="text-3xl font-bold text-indigo-600">{metadataDescargados}</span>
                  <Progress value={totalMetadata > 0 ? (metadataDescargados / totalMetadata) * 100 : 0} className="h-1 mt-2" />
                </CardContent>
              </Card>
            </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Solicitudes de paquetes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="[&_th]:px-4 [&_td]:px-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>RFC</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Tipo Archivo</TableHead>
                    <TableHead>ID de Solicitud</TableHead>
                    <TableHead>Estatus</TableHead>
                    <TableHead>Fecha de petición</TableHead>
                    <TableHead>Progreso</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        No hay solicitudes de descarga de paquetes. Usa Nueva Solicitud en el monitor para iniciar el flujo.
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map((req) => (
                      <TableRow key={req.id_solicitud}>
                        <TableCell className="font-mono text-xs">{req.rfc}</TableCell>
                        <TableCell>
                          {req.periodoMes.toString().padStart(2, '0')}/{req.periodoAnio}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={req.requestType === 'metadata' ? 'bg-slate-100 text-slate-800' : 'bg-blue-50 text-blue-800'}>
                            {req.requestType === 'metadata' ? 'Metadata' : 'CFDI'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{req.id_solicitud}</TableCell>
                        <TableCell>{getStatusBadge(req.estado_code, req.estado_texto)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {req.estado_code === 3 && req.fecha_peticion
                            ? formatDate(req.fecha_peticion)
                            : '-'}
                        </TableCell>
                        <TableCell className="w-48">
                          <div className="flex flex-col gap-1">
                            <Progress value={req.progreso} className="h-2" />
                            <span className="text-xs text-muted-foreground">
                              {req.progreso}% {req.estado_texto}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(req.fecha_vencimiento)}
                        </TableCell>
                        <TableCell className="text-right">
                          {req.estado_code === 3 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedRequest(req)}
                            >
                              Ver paquetes
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {selectedRequest && (
          <div className="fixed inset-0 z-40 flex">
            <div
              className="flex-1 bg-black/40"
              onClick={() => setSelectedRequest(null)}
            />
            <div className="w-full max-w-md bg-background border-l shadow-xl p-6 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Detalle de solicitud</h2>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setSelectedRequest(null)}
                >
                  ✕
                </Button>
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">ID de Solicitud</p>
                  <p className="font-mono text-xs break-all">{selectedRequest.id_solicitud}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">RFC</p>
                  <p className="font-mono text-xs">{selectedRequest.rfc}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Estatus</p>
                  {getStatusBadge(selectedRequest.estado_code, selectedRequest.estado_texto)}
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Paquetes .zip</p>
                  <div className="space-y-1">
                    {selectedRequest.paquetes.map((p) => (
                      <div
                        key={p}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                      >
                        <span className="font-mono">{p}</span>
                        <Button 
                          size="icon" 
                          variant="outline"
                          onClick={() => handleDownloadZip(selectedRequest.rfc, p)}
                          disabled={isDownloadingZip === p}
                        >
                          {isDownloadingZip === p ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CloudDownload className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </ProtectedRoute>
  )
}

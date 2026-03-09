 'use client'

import { useEffect, useState, useCallback } from 'react'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CloudDownload, RefreshCw } from 'lucide-react'
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

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/mass-downloads/package-downloads', { cache: 'no-store' })
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
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchData()
    }, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchData])

  const handleSimulateNew = async () => {
    try {
      const res = await fetch('/api/mass-downloads/package-downloads', {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Error al simular la solicitud')
      toast.success('Nueva solicitud de paquetes simulada correctamente')
      fetchData()
    } catch (error) {
      console.error(error)
      toast.error('No se pudo simular la nueva solicitud')
    }
  }

  const totalXml = requests.reduce((acc, r) => acc + r.totalXml, 0)
  const totalDescargados = requests.reduce((acc, r) => acc + r.descargadosXml, 0)

  return (
    <ProtectedRoute>
      <div className="container mx-auto px-4 lg:px-8 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Descarga de paquetes de solicitud</h1>
            <p className="text-muted-foreground">
              Simulación de flujo de descarga de paquetes .zip de CFDI, con estados tipo SAT.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
              Actualizar
            </Button>
            <Button onClick={handleSimulateNew}>
              <CloudDownload className="h-4 w-4 mr-2" />
              Nueva Solicitud
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                XML a descargar
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-baseline justify-between">
              <span className="text-3xl font-bold">{totalXml}</span>
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                XML descargados
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-emerald-500">{totalDescargados}</span>
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Progreso global
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress
                value={totalXml > 0 ? (totalDescargados / totalXml) * 100 : 0}
                className="h-2"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {totalXml > 0
                  ? `${Math.round((totalDescargados / totalXml) * 100)}% de los XML descargados`
                  : 'Sin descargas simuladas aún'}
              </p>
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
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        No hay solicitudes simuladas. Usa Nueva Solicitud para iniciar el flujo.
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map((req) => (
                      <TableRow key={req.id_solicitud}>
                        <TableCell className="font-mono text-xs">{req.rfc}</TableCell>
                        <TableCell>
                          {req.periodoMes.toString().padStart(2, '0')}/{req.periodoAnio}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{req.id_solicitud}</TableCell>
                        <TableCell>{getStatusBadge(req.estado_code, req.estado_texto)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {req.estado_code === 3 && req.fecha_peticion
                            ? format(new Date(req.fecha_peticion), 'dd/MM/yyyy HH:mm', { locale: es })
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
                          {format(new Date(req.fecha_vencimiento), 'dd/MM/yyyy HH:mm', { locale: es })}
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
                  <p className="text-xs text-muted-foreground">Paquetes .zip simulados</p>
                  <div className="space-y-1">
                    {selectedRequest.paquetes.map((p) => (
                      <div
                        key={p}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                      >
                        <span className="font-mono">{p}</span>
                        <Button size="icon" variant="outline">
                          <CloudDownload className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}

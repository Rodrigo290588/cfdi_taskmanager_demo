'use client'

import React, { useEffect, useState, Fragment } from 'react'
import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { KPICard } from '@/components/dashboard/kpi-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts'
import { useTenant } from '@/hooks/use-tenant'

type ApiLogsResponse = {
  statsToday: { total: number; success: number; errors: number }
  last7Days: number[]
  byActionToday: { import: number; create: number; reject: number }
  hourlyToday: number[]
  responseTimesHourlyAvgMs: number[]
  avgResponseMsToday: number
  topIssuers7d: Array<{ rfc: string; count: number }>
  topReceivers7d: Array<{ rfc: string; count: number }>
  topUsers7d: Array<{ userEmail: string; count: number }>
  errorsByReasonToday: Array<{ reason: string; count: number }>
  logs: Array<{
    id: string
    action: string
    description: string | null
    userEmail: string
    timestamp: string
    recordId: string
    oldValues?: unknown
    newValues?: unknown
  }>
  pagination: { total: number; page: number; limit: number; totalPages: number }
}

export default function EmissionMonitorPage() {
  const [data, setData] = useState<ApiLogsResponse | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [action, setAction] = useState<string>('ALL')
  const [query, setQuery] = useState('')
  const [rfcQuery, setRfcQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const { tenantState } = useTenant()
  const orgId = tenantState?.organizationId ?? null

  useEffect(() => {
    const fetchData = async () => {
      if (!orgId) return
      const params = new URLSearchParams({
        orgId,
        page: String(page),
        limit: String(limit),
      })
      if (action !== 'ALL') params.set('action', action)
      if (query) params.set('query', query)
      const res = await fetch(`/api/dashboard_fiscal/api-logs?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      setData(json)
    }
    fetchData()
  }, [orgId, page, limit, action, query])

  const series = (data?.last7Days || []).map((v, idx) => ({ day: `D-${(data?.last7Days.length || 0) - idx - 1}`, count: v }))
  const hourly = (data?.hourlyToday || []).map((v, idx) => ({ hour: `${String(idx).padStart(2, '0')}:00`, count: v }))
  const actionToday = [
    { action: 'IMPORT', count: data?.byActionToday.import || 0 },
    { action: 'CREATE', count: data?.byActionToday.create || 0 },
    { action: 'REJECT', count: data?.byActionToday.reject || 0 },
  ]

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredLogs = (data?.logs || []).filter(log => {
    if (!rfcQuery) return true
    try {
      const ov = log.oldValues as Record<string, unknown> | null
      const nv = log.newValues as Record<string, unknown> | null
      const issuer = (ov?.['issuerRfc'] as string) || (nv?.['issuerRfc'] as string) || ''
      const receiver = (nv?.['receiverRfc'] as string) || ''
      const q = rfcQuery.trim().toLowerCase()
      return issuer.toLowerCase().includes(q) || receiver.toLowerCase().includes(q)
    } catch {
      return false
    }
  })

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Monitor de Emisión (API)</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {orgId ? `Org: ${orgId}` : 'Sin organización'}
            </span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard title="Solicitudes hoy" value={`${data?.statsToday.total || 0}`} change={0} trend="neutral" />
          <KPICard title="Éxitos hoy" value={`${data?.statsToday.success || 0}`} change={0} trend="up" />
          <KPICard title="Errores hoy" value={`${data?.statsToday.errors || 0}`} change={0} trend="down" />
          <KPICard title="Tasa de éxito" value={`${((data?.statsToday.success || 0) && (data?.statsToday.total || 0)) ? Math.round(((data?.statsToday.success || 0) / (data?.statsToday.total || 1)) * 100) : 0}%`} change={0} trend="neutral" />
          <KPICard title="Tiempo medio de respuesta" value={`${data?.avgResponseMsToday || 0} ms`} change={0} trend="neutral" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Solicitudes últimos 7 días</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Solicitudes" fill="#3182ce" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Distribución por acción (hoy)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={actionToday}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="action" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Cantidad" fill="#68d391" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Filtros</CardTitle>
              <CardDescription>Buscar por acción, email, descripción o recordId</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                <Select value={action} onValueChange={(v) => setAction(v)}>
                  <SelectTrigger><SelectValue placeholder="Acción" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas</SelectItem>
                    <SelectItem value="IMPORT">IMPORT</SelectItem>
                    <SelectItem value="CREATE">CREATE</SelectItem>
                    <SelectItem value="REJECT">REJECT</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Buscar (email, descripción, recordId)" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="flex items-center gap-2">
                  <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setPage(1) }}>
                    <SelectTrigger><SelectValue placeholder="Límite" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => { setQuery(''); setAction('ALL'); setPage(1) }}>Limpiar</Button>
                </div>
                <Input placeholder="Filtrar por RFC (emisor/receptor)" value={rfcQuery} onChange={(e) => setRfcQuery(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tráfico por hora (hoy)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={hourly}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Solicitudes" fill="#805ad5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tiempos de respuesta promedio por hora (ms)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={(data?.responseTimesHourlyAvgMs || []).map((v, idx) => ({ hour: `${String(idx).padStart(2, '0')}:00`, ms: v }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="ms" stroke="#3182ce" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top usuarios (últimos 7 días)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data?.topUsers7d || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="userEmail" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Solicitudes" fill="#f6ad55" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top RFC Emisores (últimos 7 días)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data?.topIssuers7d || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="rfc" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="CFDIs emitidos" fill="#63b3ed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-1">
          <Card>
            <CardHeader>
              <CardTitle>Errores por razón (hoy)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data?.errorsByReasonToday || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="reason" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Errores" fill="#fc8181" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Logs de Emisión</CardTitle>
            <CardDescription>Registros recientes de llamadas al API de timbrado</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-2">
              Mostrando {filteredLogs.length} de {data?.pagination.total || 0} registros
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>RecordId</TableHead>
                    <TableHead>Descripción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map(log => (
                    <Fragment key={log.id}>
                      <TableRow key={log.id} className="cursor-pointer" onClick={() => toggleExpand(log.id)}>
                        <TableCell>{new Date(log.timestamp).toLocaleString('es-MX')}</TableCell>
                        <TableCell>{log.action}</TableCell>
                        <TableCell>{log.userEmail}</TableCell>
                        <TableCell className="font-mono text-xs">{log.recordId}</TableCell>
                        <TableCell className="truncate max-w-[320px]">{log.description || ''}</TableCell>
                      </TableRow>
                      {expandedIds.has(log.id) && (
                        <TableRow>
                          <TableCell colSpan={5}>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="text-xs font-medium mb-1">oldValues</div>
                                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(log.oldValues ?? {}, null, 2)}</pre>
                              </div>
                              <div>
                                <div className="text-xs font-medium mb-1">newValues</div>
                                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(log.newValues ?? {}, null, 2)}</pre>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="text-xs text-muted-foreground">
                Página {data?.pagination.page || 1} de {data?.pagination.totalPages || 1}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page >= (data?.pagination.totalPages || 1)} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

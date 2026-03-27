/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"
import { useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts'

type SelectedCompany = {
  id: string
  rfc: string
  businessName: string
}

type MetricsResponse = {
  company: { id: string; rfc: string; name: string }
  kpis: { totalCfdis: number; totalMonto: number; tasaCancelacion: number }
  byType: Array<{ type: string; count: number; total?: number }>
  bySatStatus: Array<{ status: string; count: number }>
  monthly: Array<{ label: string; count: number; total: number }>
  topSuppliers: Array<{ name: string; total: number }>
  topClients: Array<{ name: string; total: number }>
}

export default function SatCfdisPage() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(() => {
    try {
      const stored = localStorage.getItem('selectedCompany')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() => selectedCompany?.id || null)
  const [importing, setImporting] = useState(false)
  const [invQuery, setInvQuery] = useState('')
  const [invCfdiType, setInvCfdiType] = useState<string>('')
  const [invStatus, setInvStatus] = useState<string>('')
  const [invSatStatus, setInvSatStatus] = useState<string>('')
  const [invPage, setInvPage] = useState(1)
  const [invLimit, setInvLimit] = useState(20)
  const [invLoading, setInvLoading] = useState(false)
  const [invRows, setInvRows] = useState<Array<{
    id: string
    uuid: string
    cfdiType: string
    series: string | null
    folio: string | null
    issuerRfc: string
    issuerName: string
    receiverRfc: string
    receiverName: string
    total: number
    issuanceDate: string | Date
    satStatus: string
  }>>([])
  const [invTotalPages, setInvTotalPages] = useState(0)

  const formatMXN = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))

  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const handler = () => {
      try {
        const stored = localStorage.getItem('selectedCompany')
        if (stored) {
          const parsed = JSON.parse(stored)
          setSelectedCompany(parsed)
          setSelectedCompanyId(parsed.id)
          setRefreshKey(k => k + 1)
        }
      } catch {}
    }
    window.addEventListener('company-selected', handler)
    document.addEventListener('company-selected', handler)
    return () => {
      window.removeEventListener('company-selected', handler)
      document.removeEventListener('company-selected', handler)
    }
  }, [])

  useEffect(() => {
    if (!selectedCompanyId) return
    let active = true
    setTimeout(() => {
      ;(async () => {
        const res = await fetch(`/api/sat_cfdis?companyId=${selectedCompanyId}&rk=${refreshKey}`, { cache: 'no-store' })
        const data = await res.json()
        if (!active) return
        setMetrics(data)
      })()
    }, 0)
    return () => { active = false }
  }, [selectedCompanyId, refreshKey])

  const fetchSatInvoices = async () => {
    if (!selectedCompanyId) return
    setInvLoading(true)
    const params = new URLSearchParams({ companyId: selectedCompanyId, page: String(invPage), limit: String(invLimit) })
    if (invQuery) params.set('query', invQuery)
    if (invCfdiType) params.set('cfdiType', invCfdiType)
    if (invStatus) params.set('status', invStatus)
    if (invSatStatus) params.set('satStatus', invSatStatus)
    const res = await fetch(`/api/sat_cfdis/invoices?${params.toString()}`)
    const data = await res.json()
    setInvRows(data?.invoices || [])
    setInvTotalPages(data?.pagination?.totalPages || 0)
    setInvLoading(false)
  }

  useEffect(() => {
    if (!selectedCompanyId) return
    let active = true
    setTimeout(() => {
      ;(async () => {
        const params = new URLSearchParams({ companyId: selectedCompanyId, page: String(invPage), limit: String(invLimit) })
        if (invQuery) params.set('query', invQuery)
        if (invCfdiType) params.set('cfdiType', invCfdiType)
        if (invStatus) params.set('status', invStatus)
        if (invSatStatus) params.set('satStatus', invSatStatus)
        const res = await fetch(`/api/sat_cfdis/invoices?${params.toString()}`)
        const data = await res.json()
        if (!active) return
        setInvRows(data?.invoices || [])
        setInvTotalPages(data?.pagination?.totalPages || 0)
      })()
    }, 0)
    return () => { active = false }
  }, [selectedCompanyId, invPage, invLimit, invQuery, invCfdiType, invStatus, invSatStatus])


  const importFromSat = async () => {
    if (!selectedCompanyId) return
    setImporting(true)
    const res = await fetch(`/api/sat/import?companyId=${selectedCompanyId}`, { method: 'POST' })
    setImporting(false)
    if (res.ok) {
      setRefreshKey(k => k + 1)
    }
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">CFDIs en el SAT</h1>
            {selectedCompany && (
              <p className="text-sm text-muted-foreground">{selectedCompany.rfc} • {selectedCompany.businessName}</p>
            )}
          </div>
          <Button onClick={importFromSat} disabled={!selectedCompanyId || importing}>
            {importing ? 'Importando…' : 'Importar desde SAT'}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>CFDIs por Mes (SAT)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[800px]">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={metrics?.monthly || []} margin={{ left: 60, right: 90 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis yAxisId="left" width={50} />
                    <YAxis yAxisId="right" orientation="right" width={90} tickFormatter={(val: any) => formatMXN(Number(val))} />
                    <Tooltip formatter={(value: any, name: any) => (name === 'Monto' || name === 'total') ? formatMXN(Number(value)) : value} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="count" name="CFDIs" fill="#2b6cb0" />
                    <Bar yAxisId="right" dataKey="total" name="Monto" fill="#68d391" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estado SAT</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[600px]">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                  <Pie data={metrics?.bySatStatus || []} dataKey="count" nameKey="status" outerRadius={100} label>
                      {((metrics?.bySatStatus as Array<{ status: string; count: number }> || [])).map((_, i) => (
                        <Cell key={`sat-${i}`} fill={["#63b3ed", "#68d391", "#f6ad55", "#fc8181"][i % 4]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top Receptores (SAT)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto scrollbar-visible">
              <div className="min-w-[800px]">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={metrics?.topClients || []} margin={{ left: 90, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis width={60} tickFormatter={(val: any) => formatMXN(Number(val))} />
                    <Tooltip formatter={(value: any) => formatMXN(Number(value))} />
                    <Legend />
                    <Line type="monotone" dataKey="total" name="Monto" stroke="#805ad5" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>CFDIs importados del SAT</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-5">
              <input className="border rounded px-2 py-1" placeholder="Buscar (UUID, RFC, nombre, folio)" value={invQuery} onChange={(e) => setInvQuery(e.target.value)} />
              <select className="border rounded px-2 py-1" value={invCfdiType} onChange={(e) => setInvCfdiType(e.target.value === 'ALL' ? '' : e.target.value)}>
                <option value="ALL">Todos</option>
                <option value="INGRESO">INGRESO</option>
                <option value="EGRESO">EGRESO</option>
                <option value="PAGO">PAGO</option>
                <option value="NOMINA">NÓMINA</option>
              </select>
              <select className="border rounded px-2 py-1" value={invStatus} onChange={(e) => setInvStatus(e.target.value === 'ALL' ? '' : e.target.value)}>
                <option value="ALL">Todos</option>
                <option value="ACTIVE">Activo</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
              <select className="border rounded px-2 py-1" value={invSatStatus} onChange={(e) => setInvSatStatus(e.target.value === 'ALL' ? '' : e.target.value)}>
                <option value="ALL">Todos</option>
                <option value="VIGENTE">Vigente</option>
                <option value="CANCELADO">Cancelado</option>
                <option value="NO_ENCONTRADO">No encontrado</option>
              </select>
              <button className="border rounded px-3 py-1" onClick={() => { setInvPage(1); fetchSatInvoices() }}>Aplicar</button>
            </div>

            <div className="overflow-x-auto scrollbar-visible mt-4">
              <div className="min-w-[1000px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-2 py-2">Fecha</th>
                      <th className="px-2 py-2">UUID</th>
                      <th className="px-2 py-2">Tipo</th>
                      <th className="px-2 py-2">Emisor</th>
                      <th className="px-2 py-2">Receptor</th>
                      <th className="px-2 py-2">Folio</th>
                      <th className="px-2 py-2">SAT</th>
                      <th className="px-2 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invLoading ? (
                      <tr><td className="px-2 py-3" colSpan={8}>Cargando...</td></tr>
                    ) : invRows.length === 0 ? (
                      <tr><td className="px-2 py-3" colSpan={8}>Sin resultados</td></tr>
                    ) : (
                      invRows.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="px-2 py-2">{new Date(r.issuanceDate).toLocaleDateString('es-MX')}</td>
                          <td className="px-2 py-2">{String(r.uuid).slice(0, 8)}…</td>
                          <td className="px-2 py-2">{r.cfdiType}</td>
                          <td className="px-2 py-2">{r.issuerName} • {r.issuerRfc}</td>
                          <td className="px-2 py-2">{r.receiverName} • {r.receiverRfc}</td>
                          <td className="px-2 py-2">{r.series}-{r.folio}</td>
                          <td className="px-2 py-2">{r.satStatus}</td>
                          <td className="px-2 py-2">{formatMXN(r.total)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="text-xs text-muted-foreground">Página {invPage} de {Math.max(invTotalPages, 1)}</div>
              <div className="flex items-center gap-2">
                <select className="border rounded px-2 py-1" value={String(invLimit)} onChange={(e) => { setInvLimit(Number(e.target.value)); setInvPage(1) }}>
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
                <button className="border rounded px-3 py-1" onClick={() => setInvPage(Math.max(invPage - 1, 1))} disabled={invPage === 1}>Anterior</button>
                <button className="border rounded px-3 py-1" onClick={() => setInvPage(invPage + 1)} disabled={invPage >= invTotalPages}>Siguiente</button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

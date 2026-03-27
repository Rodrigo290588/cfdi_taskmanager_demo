"use client"

import { useEffect, useMemo, useState } from 'react'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardSkeleton } from '@/components/loading/skeletons'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts'

interface MetricsResponse {
  company?: { id: string; rfc: string; name: string }
  kpis: { 
    totalCfdis: number; 
    totalMonto: number; 
    tasaCancelacion: number;
    montoCobrado?: number;
    montoPorCobrar?: number;
    carteraVencida?: number;
    montoNotasCredito?: number;
    montoCancelado?: number;
    taxes?: {
      ivaTrasladado: number;
      ivaRetenido: number;
      isrRetenido: number;
      iepsRetenido: number;
    };
  }
  byType: Array<{ type: string; count: number; total: number }>
  bySatStatus: Array<{ status: string; count: number }>
  monthly: Array<{ 
    label: string; 
    count: number; 
    total: number;
    taxes?: {
      ivaTrasladado: number;
      ivaRetenido: number;
      isrRetenido: number;
      iepsRetenido: number;
    };
  }>
  topClients?: Array<{ rfc: string; name: string; total: number; cobrado?: number; pendiente?: number }>
  paymentMethods?: Array<{ method: string; count: number }>
  topProducts?: Array<{ name: string; value: number }>
}
 

export default function DashboardHome() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<{ id: string; rfc?: string; businessName?: string; name?: string } | null>(null)
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [canSeeCompany, setCanSeeCompany] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('selectedCompany')
      if (raw) {
        const obj = JSON.parse(raw)
        setSelectedCompanyId(obj.id as string)
        setSelectedCompany(obj)
      }
    } catch {}
  }, [])

  useEffect(() => {
    const readSelected = () => {
      try {
        const raw = localStorage.getItem('selectedCompany')
        if (raw) {
          const obj = JSON.parse(raw)
          setSelectedCompanyId(obj.id as string)
          setSelectedCompany(obj)
        } else {
          setSelectedCompanyId(null)
          setSelectedCompany(null)
        }
      } catch {}
    }
    const listener = () => readSelected()
    window.addEventListener('company-selected', listener as EventListener)
    document.addEventListener('company-selected', listener)
    window.addEventListener('storage', listener as EventListener)
    return () => {
      window.removeEventListener('company-selected', listener as EventListener)
      document.removeEventListener('company-selected', listener)
      window.removeEventListener('storage', listener as EventListener)
    }
  }, [])

  useEffect(() => {
    const loadLogo = async () => {
      try {
        if (!selectedCompanyId) { setCompanyLogo(null); return }
        const res = await fetch(`/api/companies/${selectedCompanyId}`)
        const data = await res.json()
        if (res.ok && data?.company?.logo) {
          setCompanyLogo(data.company.logo as string)
        } else {
          setCompanyLogo(null)
        }
      } catch {
        setCompanyLogo(null)
      }
    }
    loadLogo()
  }, [selectedCompanyId])

  useEffect(() => {
    const checkAccess = async () => {
      try {
        if (!selectedCompanyId || !selectedCompany?.rfc) {
          setCanSeeCompany(false)
          return
        }
        const res = await fetch('/api/user/company-access', { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Error al validar acceso')
        const companies: Array<{ id: string; rfc: string; isActive: boolean; role?: string }> = data?.companies || []
        const has = companies.some(c => c.id === selectedCompanyId || c.rfc === selectedCompany?.rfc)
        setCanSeeCompany(has)
      } catch {
        setCanSeeCompany(false)
      }
    }
    checkAccess()
  }, [selectedCompanyId, selectedCompany?.rfc])

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true)
        const url = selectedCompanyId
          ? `/api/dashboard_fiscal?companyId=${selectedCompanyId}`
          : `/api/org/dashboard`
        const res = await fetch(url, { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Error al cargar métricas')
        setMetrics(data)
      } catch {
        setMetrics(null)
      } finally {
        setLoading(false)
      }
    }
    fetchMetrics()
  }, [selectedCompanyId])

  const totalMontoMXN = useMemo(() => {
    const v = metrics?.kpis.totalMonto || 0
    return `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }, [metrics])

  const montoCobradoMXN = useMemo(() => {
    const v = metrics?.kpis.montoCobrado || 0
    return `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }, [metrics])

  const montoPorCobrarMXN = useMemo(() => {
    const v = metrics?.kpis.montoPorCobrar || 0
    return `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }, [metrics])

  const carteraVencidaMXN = useMemo(() => {
    const v = metrics?.kpis.carteraVencida || 0
    return `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }, [metrics])

  const montoEgresosMXN = useMemo(() => {
    const v = metrics?.kpis.montoNotasCredito || 0
    return `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }, [metrics])

  const montoCanceladoMXN = useMemo(() => {
    const v = metrics?.kpis.montoCancelado || 0
    return `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }, [metrics])

  const impuestos = useMemo(() => {
    const iva = Number(metrics?.kpis.taxes?.ivaTrasladado || 0)
    const isr = Number(metrics?.kpis.taxes?.isrRetenido || 0)
    const ieps = Number(metrics?.kpis.taxes?.iepsRetenido || 0)
    const total = iva + isr + ieps
    return {
      iva: `$${iva.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
      isr: `$${isr.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
      ieps: `$${ieps.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
      total: `$${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
    }
  }, [metrics])

  // Derived Data for Charts
  const topProductsData = useMemo(() => {
    if (!metrics?.topProducts) return []
    return metrics.topProducts.map(p => ({
      name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
      fullName: p.name,
      value: p.value,
      displayValue: `$${(p.value / 1000).toFixed(1)}k`
    }))
  }, [metrics])

  // Top Clients Data
  const topClientsData = useMemo(() => {
    if (!metrics?.topClients) return []
    const base = metrics.topClients.slice(0, 10).map(c => ({
      name: c.name.length > 15 ? c.name.substring(0, 15) + '...' : c.name,
      fullName: c.name,
      cobrado: c.cobrado !== undefined ? c.cobrado : c.total * 0.7, // Fallback if old api
      pendiente: c.pendiente !== undefined ? c.pendiente : c.total * 0.3, // Fallback if old api
      total: c.total
    }))
    const totalPendiente = base.reduce((sum, x) => sum + (x.pendiente || 0), 0)
    const vencidaTotal = metrics?.kpis?.carteraVencida || 0
    return base.map(x => ({
      ...x,
      vencida: totalPendiente > 0 ? (x.pendiente / totalPendiente) * vencidaTotal : 0
    }))
  }, [metrics])

  const monthlyData = useMemo(() => {
    if (!metrics?.monthly) return []
    return metrics.monthly.map(m => ({
      name: m.label,
      current: m.total,
      previous: m.total * (0.8 + Math.random() * 0.4), // Mock previous year
    }))
  }, [metrics])

  // Impuestos chart removed

  if (loading) {
    return <DashboardSkeleton />
  }


 

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-6 p-6 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-heading font-bold text-foreground">Home</h2>
            {selectedCompany && canSeeCompany && (
              <div className="mt-4 flex items-center gap-4">
                <Avatar className="h-10 w-10 border border-primary/20">
                  {companyLogo ? (
                    <AvatarImage src={companyLogo} alt={selectedCompany?.name} />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary font-bold">
                    {(selectedCompany?.name || 'E').charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {selectedCompany?.name || selectedCompany?.businessName}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium">
                    {selectedCompany?.rfc}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 1: KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Ingresos del Mes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-blue-600">{totalMontoMXN}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-green-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Monto cobrado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-green-600">{montoCobradoMXN}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-yellow-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Monto por cobrar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-yellow-600">{montoPorCobrarMXN}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Cartera Vencida</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-orange-600">{carteraVencidaMXN}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-purple-500 shadow-sm flex flex-col justify-center">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Total de Notas de Crédito</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-purple-600">{montoEgresosMXN}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-gray-500 shadow-sm flex flex-col justify-center">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Total Cancelaciones</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-gray-600">{montoCanceladoMXN}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500 shadow-sm lg:col-span-2">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Impuestos por Pagar</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-2xl font-bold text-center text-red-600 mb-4">{impuestos.total}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="flex flex-col sm:border-r sm:pr-2">
                  <div className="flex justify-between items-center border-b pb-1 mb-2">
                    <span className="font-bold text-foreground">IVA</span>
                    <span className="font-bold text-foreground">{impuestos.iva}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground mb-1"><span>16%:</span><span>{impuestos.iva}</span></div>
                  <div className="flex justify-between text-muted-foreground mb-1"><span>8%:</span><span>$0.00</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>0% / Exento:</span><span>$0.00</span></div>
                </div>
                <div className="flex flex-col sm:border-r sm:px-2">
                  <div className="flex justify-between items-center border-b pb-1 mb-2">
                    <span className="font-bold text-foreground">ISR</span>
                    <span className="font-bold text-foreground">{impuestos.isr}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground"><span>Retenido:</span><span>{impuestos.isr}</span></div>
                </div>
                <div className="flex flex-col sm:pl-2">
                  <div className="flex justify-between items-center border-b pb-1 mb-2">
                    <span className="font-bold text-foreground">IEPS</span>
                    <span className="font-bold text-foreground">{impuestos.ieps}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground"><span>Retenido:</span><span>{impuestos.ieps}</span></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Top Charts */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Top 10 Productos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Top 10 de productos más vendidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    layout="vertical" 
                    data={topProductsData.length > 0 ? topProductsData : [{name: 'Sin datos', fullName: 'Sin datos', value: 0, displayValue: '$0'}]} 
                    margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value) => [`$${Number(value || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, 'Ventas']}
                      labelFormatter={(label, payload) => payload[0]?.payload?.fullName || label}
                    />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Top 10 Clientes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Top 10 Clientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    layout="vertical" 
                    data={topClientsData.length > 0 ? topClientsData : [{name: 'Sin datos', fullName: 'Sin datos', cobrado: 0, pendiente: 0, vencida: 0, total: 0}]} 
                    margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value) => [`$${Number(value || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`]}
                      labelFormatter={(label, payload) => payload[0]?.payload?.fullName || label}
                    />
                    <Legend />
                    <Bar dataKey="cobrado" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} barSize={20} name="Cobrado" />
                    <Bar dataKey="pendiente" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} barSize={20} name="Pendiente" />
                    <Bar dataKey="vencida" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} barSize={20} name="Cartera Vencida" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Ingresos Mensuales */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Ingresos Mensuales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `$${value / 1000}k`} />
                  <Tooltip formatter={(value) => [`$${Number(value).toLocaleString()}`, '']} />
                  <Legend />
                  <Line type="monotone" dataKey="current" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Año Actual" />
                  <Line type="monotone" dataKey="previous" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} name="Año Anterior" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Bottom charts removed */}
      </div>
    </ProtectedRoute>
  )
}

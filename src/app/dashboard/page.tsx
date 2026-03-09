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
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { ArrowUp } from 'lucide-react'

interface MetricsResponse {
  company?: { id: string; rfc: string; name: string }
  kpis: { totalCfdis: number; totalMonto: number; tasaCancelacion: number }
  byType: Array<{ type: string; count: number; total: number }>
  bySatStatus: Array<{ status: string; count: number }>
  monthly: Array<{ label: string; count: number; total: number }>
  topClients?: Array<{ rfc: string; name: string; total: number }>
  paymentMethods?: Array<{ method: string; count: number }>
}

// Mock Data for UI Matching
const mockTopProducts = [
  { name: 'Producto A', value: 45, displayValue: '$45k' },
  { name: 'Producto B', value: 22, displayValue: '$22k' },
  { name: 'Producto C', value: 20, displayValue: '$20k' },
  { name: 'Producto D', value: 10, displayValue: '$10k' },
  { name: 'Producto E', value: 12, displayValue: '$12k' },
]

// Updated to match reference image colors and labels
const mockCosts = [
  { name: 'Costos', value: 40, fill: '#f59e0b', label: 'Costos 40%' }, // Orange
  { name: 'Servicios', value: 25, fill: '#3b82f6', label: '25%' }, // Blue
  { name: 'Gastos Admin', value: 20, fill: '#22c55e', label: 'Gastos Admin 20%' }, // Green
  { name: 'Otros', value: 20, fill: '#ef4444', label: '20%' }, // Red
]

const mockTaxes = [
  { name: 'Jul', trasladado: 40, acreditable: 24, isr: 24 },
  { name: 'Sep', trasladado: 30, acreditable: 13, isr: 22 },
  { name: 'Dic', trasladado: 20, acreditable: 98, isr: 22 },
]

const mockNetIncome = [
  { name: 'Mes Anterior', value: 90, fill: '#3b82f6', displayValue: '$90K' },
  { name: 'Mes Actual', value: 120, fill: '#22c55e', displayValue: '$120K' },
]

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

  // Derived Data for Charts
  const topClientsData = useMemo(() => {
    if (!metrics?.topClients) return []
    return metrics.topClients.slice(0, 5).map(c => ({
      name: c.name.substring(0, 15),
      cobrado: c.total * 0.7, // Mock split
      pendiente: c.total * 0.3, // Mock split
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

  if (loading) {
    return <DashboardSkeleton />
  }

  const renderCustomizedLabel = (props: { cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number; index?: number }) => {
    const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, index = 0 } = props
    const RADIAN = Math.PI / 180
    // Position label slightly outside the center of the slice or inside depending on size
    // For this design, we want them visible on top.
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor="middle"
        dominantBaseline="central"
        className="text-[10px] font-bold"
        style={{ pointerEvents: 'none' }}
      >
        {mockCosts[index].label}
      </text>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatBarLabel = (val: any) => `$${val}K`

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
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Margen EBITDA</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center gap-2">
                <div className="text-2xl font-bold text-green-600">24.5%</div>
                <ArrowUp className="h-6 w-6 text-green-600" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Cartera Vencida</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-orange-600">$120,000</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground text-center">Impuestos por Pagar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-center text-red-600">$65,000</div>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Top Charts */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Top 10 Productos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Top 10 Productos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={mockTopProducts} margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                    <Tooltip />
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
                  <BarChart layout="vertical" data={topClientsData.length > 0 ? topClientsData : [{name: 'Sin datos', cobrado: 0, pendiente: 0}]} margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="cobrado" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} barSize={20} name="Cobrado" />
                    <Bar dataKey="pendiente" stackId="a" fill="#f97316" radius={[0, 4, 4, 0]} barSize={20} name="Pendiente" />
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

        {/* Row 4: Bottom Charts */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Costos & Gastos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Costos & Gastos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={mockCosts}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={0}
                      dataKey="value"
                      labelLine={false}
                      label={renderCustomizedLabel}
                    >
                      {mockCosts.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* EBITDA Gauge */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-center">EBITDA</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] w-full flex flex-col items-center justify-center relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[{ value: 100 }]}
                      cx="50%"
                      cy="70%"
                      startAngle={180}
                      endAngle={0}
                      innerRadius={60}
                      outerRadius={80}
                      fill="#e5e7eb"
                      dataKey="value"
                      stroke="none"
                    />
                    <Pie
                      data={[{ value: 70 }, { value: 30 }]}
                      cx="50%"
                      cy="70%"
                      startAngle={180}
                      endAngle={0}
                      innerRadius={60}
                      outerRadius={80}
                      dataKey="value"
                      stroke="none"
                    >
                      <Cell fill="#22c55e" />
                      <Cell fill="transparent" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute bottom-10 text-center">
                  <div className="text-2xl font-bold text-foreground">$180K</div>
                  <div className="text-sm font-medium text-green-600">Margen 24.5%</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Impuestos / Utilidad (Split into two separate cards inside one container) */}
          <Card className="overflow-hidden">
             <div className="grid grid-cols-2 divide-x h-full">
                {/* Impuestos Column */}
                <div className="p-4 flex flex-col h-full">
                  <div className="text-base font-semibold mb-2">Impuestos</div>
                  <div className="flex-1 min-h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mockTaxes}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" fontSize={10} />
                        <Tooltip cursor={{fill: 'transparent'}} />
                        <Legend wrapperStyle={{fontSize: '10px'}} />
                        <Bar dataKey="trasladado" stackId="a" fill="#3b82f6" name="IVA Trasladado" />
                        <Bar dataKey="acreditable" stackId="a" fill="#22c55e" name="IVA Acreditable" />
                        <Bar dataKey="isr" stackId="a" fill="#ef4444" name="ISR" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Utilidad Neta Column */}
                <div className="p-4 flex flex-col h-full">
                  <div className="text-base font-semibold mb-2">Utilidad Neta</div>
                  <div className="flex-1 min-h-[160px] relative">
                    {/* Trend Indicator Overlay */}
                     <div className="absolute top-0 right-0 z-10 text-green-600 font-bold text-sm">
                       +33%
                     </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mockNetIncome}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" fontSize={10} interval={0} />
                        <Tooltip cursor={{fill: 'transparent'}} />
                        <Bar dataKey="value" fill="#22c55e" label={{ position: 'top', formatter: formatBarLabel, fontSize: 10, fontWeight: 'bold' }}>
                          {mockNetIncome.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
             </div>
          </Card>
        </div>
      </div>
    </ProtectedRoute>
  )
}

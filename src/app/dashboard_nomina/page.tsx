'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProtectedRoute } from "@/components/protected-route"
import { DashboardSkeleton } from "@/components/loading/skeletons"
import { showError } from "@/lib/toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const formatMXN = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))
const formatNumber = (value: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(Number(value || 0))

type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

type Metrics = {
  kpis: {
    totalDeducciones: number
    totalOtrosPagos: number
    totalPercepciones: number
    totalNomina: number
    empleadosPagados: number
    promedioNomina: number
    totalDiasPagados: number
    costoPorEmpleado: number
    pctDeducciones: number
    indiceAusentismo: number
  }
  departments: Array<{
    name: string
    percepciones: number
    deducciones: number
    otrosPagos: number
    nomina: number
    count: number
  }>
}

export default function DashboardNominaPage() {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)

  useEffect(() => {
    const readSelected = () => {
      try {
        const raw = localStorage.getItem('selectedCompany')
        if (raw) {
          const parsed = JSON.parse(raw) as SelectedCompany
          setSelectedCompanyId(parsed?.id || null)
          setSelectedCompany(parsed || null)
        }
      } catch {}
    }
    readSelected()
    const listener = () => readSelected()
    window.addEventListener('company-selected', listener as EventListener)
    return () => window.removeEventListener('company-selected', listener as EventListener)
  }, [])

  const fetchMetrics = useCallback(async () => {
    if (!selectedCompanyId) return
    try {
      setLoading(true)
      const res = await fetch(`/api/dashboard_nomina?companyId=${selectedCompanyId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar métricas')
      setMetrics(data)
    } catch (err) {
      console.error(err)
      showError('Error', 'No se pudieron cargar los datos de nómina')
    } finally {
      setLoading(false)
    }
  }, [selectedCompanyId])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  if (!selectedCompanyId) {
    return (
      <ProtectedRoute>
        <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
          <Card>
            <CardHeader>
              <CardTitle>Selecciona una empresa</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Usa el combobox del sidebar para elegir la empresa y cargar el Dashboard de Nómina.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedRoute>
    )
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  const kpis = metrics?.kpis || {
    totalDeducciones: 0,
    totalOtrosPagos: 0,
    totalPercepciones: 0,
    totalNomina: 0,
    empleadosPagados: 0,
    promedioNomina: 0,
    totalDiasPagados: 0,
    costoPorEmpleado: 0,
    pctDeducciones: 0,
    indiceAusentismo: 0
  }

  const KPICard = ({ 
    title, 
    value, 
    subtext, 
    color = 'blue' 
  }: { 
    title: string
    value: string
    subtext?: string
    color?: 'blue' | 'green' | 'orange' | 'red' | 'purple'
  }) => {
    const colorStyles = {
      blue: { border: 'border-l-blue-500', text: 'text-blue-600' },
      green: { border: 'border-l-green-500', text: 'text-green-600' },
      orange: { border: 'border-l-orange-500', text: 'text-orange-600' },
      red: { border: 'border-l-red-500', text: 'text-red-600' },
      purple: { border: 'border-l-purple-500', text: 'text-purple-600' },
    }
    const styles = colorStyles[color] || colorStyles.blue

    return (
      <Card className={`border-l-4 ${styles.border} shadow-sm`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground text-center">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold text-center ${styles.text}`}>{value}</div>
          {subtext && <div className="text-xs text-muted-foreground mt-1 text-center">{subtext}</div>}
        </CardContent>
      </Card>
    )
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard de Nómina</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {selectedCompany?.rfc || 'N/A'} · {selectedCompany?.businessName || selectedCompany?.name || 'Empresa'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: KPIs */}
          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
              <KPICard title="Total Deducciones" value={formatMXN(kpis.totalDeducciones)} color="red" />
              <KPICard title="Total Otros Pagos" value={formatMXN(kpis.totalOtrosPagos)} color="orange" />
              <KPICard title="Total Percepciones" value={formatMXN(kpis.totalPercepciones)} color="blue" />
              <KPICard title="Total Nómina" value={formatMXN(kpis.totalNomina)} color="purple" />
              <KPICard title="Empleados Pagados" value={formatNumber(kpis.empleadosPagados)} color="green" />
              
              <KPICard title="Promedio Nómina" value={formatMXN(kpis.promedioNomina)} color="blue" />
              <KPICard title="Total Días Pagados" value={formatNumber(kpis.totalDiasPagados)} color="green" />
              <KPICard title="Costo por Empleado" value={formatMXN(kpis.costoPorEmpleado)} color="orange" />
              <KPICard title="% Deducciones" value={`${formatNumber(kpis.pctDeducciones)}%`} color="red" />
              <KPICard title="Índice Ausentismo" value={`${formatNumber(kpis.indiceAusentismo)}%`} color="red" />
            </div>
          </div>

          {/* Right Column: Table */}
          <div className="lg:col-span-5">
            <Card className="h-full border border-border bg-card">
              <CardHeader className="py-3 border-b border-border bg-muted/20">
                <CardTitle className="text-base font-semibold">Desglose por Departamento</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/10 hover:bg-muted/10">
                        <TableHead className="font-semibold text-xs">Departamento</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Percepciones</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Deducciones</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Otros Pagos</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics?.departments.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                            Sin datos de departamentos
                          </TableCell>
                        </TableRow>
                      ) : (
                        metrics?.departments.map((dept, idx) => (
                          <TableRow key={idx} className="hover:bg-muted/5 text-xs">
                            <TableCell className="font-medium">{dept.name}</TableCell>
                            <TableCell className="text-right">{formatMXN(dept.percepciones)}</TableCell>
                            <TableCell className="text-right">{formatMXN(dept.deducciones)}</TableCell>
                            <TableCell className="text-right">{formatMXN(dept.otrosPagos)}</TableCell>
                            <TableCell className="text-right font-semibold">{formatMXN(dept.nomina)}</TableCell>
                          </TableRow>
                        ))
                      )}
                      {/* Total Row */}
                      {metrics?.departments.length ? (
                        <TableRow className="bg-muted/20 font-bold border-t-2 border-border text-xs">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">{formatMXN(kpis.totalPercepciones)}</TableCell>
                          <TableCell className="text-right">{formatMXN(kpis.totalDeducciones)}</TableCell>
                          <TableCell className="text-right">{formatMXN(kpis.totalOtrosPagos)}</TableCell>
                          <TableCell className="text-right">{formatMXN(kpis.totalNomina)}</TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}

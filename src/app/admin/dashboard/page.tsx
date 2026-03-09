'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Building2, 
  Users, 
  Clock, 
  CheckCircle, 
  Activity,
  Eye,
  Calendar,
  User,
  FileText,
  AlertTriangle
} from 'lucide-react'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { PermissionRequired } from '@/components/auth/permission-guard'
import { Permission } from '@/lib/permissions'
import { toast } from 'sonner'

interface DashboardStats {
  totalCompanies: number
  pendingCompanies: number
  approvedCompanies: number
  rejectedCompanies: number
  totalUsers: number
  approvalRate: number
}

interface MonthlyTrend {
  monthly: number[]
  labels: string[]
}

interface TopItem {
  industry?: string
  state?: string
  count: number
}

interface RecentCompany {
  id: string
  name: string
  rfc: string
  status: string
  createdAt: string
  createdBy: string
}

interface RecentAuditLog {
  id: string
  action: string
  description: string
  userEmail: string
  timestamp: string
  companyName?: string
}

interface DashboardData {
  statistics: DashboardStats
  trends: MonthlyTrend
  topIndustries: TopItem[]
  topStates: TopItem[]
  recentCompanies: RecentCompany[]
  recentAuditLogs: RecentAuditLog[]
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      const response = await fetch('/api/admin/dashboard', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Error desconocido' }))
        console.error('Dashboard API error:', errorData)
        throw new Error(errorData.error || 'Error al cargar el dashboard')
      }
      
      const data = await response.json()
      setDashboardData(data)
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      toast.error(error instanceof Error ? error.message : 'Error al cargar el dashboard')
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      PENDING: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-800' },
      APPROVED: { label: 'Aprobado', className: 'bg-green-100 text-green-800' },
      REJECTED: { label: 'Rechazado', className: 'bg-red-100 text-red-800' }
    }
    const variant = variants[status as keyof typeof variants]
    return <Badge className={variant.className}>{variant.label}</Badge>
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Activity className="h-12 w-12 text-gray-400 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Cargando dashboard...</p>
        </div>
      </div>
    )
  }

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Error al cargar el dashboard</h3>
          <p className="text-gray-600">No se pudieron cargar los datos del dashboard.</p>
          <Button onClick={fetchDashboardData} className="mt-4">
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ProtectedRoute>
      <PermissionRequired permission={Permission.ADMIN_DASHBOARD}>
        <div className="container mx-auto py-6 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Panel de Administración</h1>
              <p className="text-muted-foreground">
                Visión general del sistema y métricas de rendimiento
              </p>
            </div>
            <Button onClick={fetchDashboardData} variant="outline">
              Actualizar
            </Button>
          </div>

          {/* Statistics Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Empresas</CardTitle>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{dashboardData.statistics.totalCompanies}</div>
                <p className="text-xs text-muted-foreground">
                  {dashboardData.statistics.approvalRate}% tasa de aprobación
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{dashboardData.statistics.pendingCompanies}</div>
                <p className="text-xs text-muted-foreground">
                  Requieren revisión
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Aprobadas</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{dashboardData.statistics.approvedCompanies}</div>
                <p className="text-xs text-muted-foreground">
                  Activas en el sistema
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Usuarios</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{dashboardData.statistics.totalUsers}</div>
                <p className="text-xs text-muted-foreground">
                  Usuarios registrados
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">Resumen</TabsTrigger>
              <TabsTrigger value="companies">Empresas</TabsTrigger>
              <TabsTrigger value="activity">Actividad</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {/* Top Industries */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Industrias</CardTitle>
                    <CardDescription>Industrias con más empresas registradas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {dashboardData.topIndustries.map((item, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <span className="text-sm">{item.industry}</span>
                          <Badge variant="secondary">{item.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Top States */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Estados</CardTitle>
                    <CardDescription>Estados con más empresas registradas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {dashboardData.topStates.map((item, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <span className="text-sm">{item.state}</span>
                          <Badge variant="secondary">{item.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="companies" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Empresas Recientes</CardTitle>
                  <CardDescription>Últimas empresas registradas en el sistema</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {dashboardData.recentCompanies.map((company) => (
                      <div key={company.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <p className="text-sm font-medium leading-none">{company.name}</p>
                          <p className="text-sm text-muted-foreground">{company.rfc}</p>
                          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>{formatDate(company.createdAt)}</span>
                            <User className="h-3 w-3" />
                            <span>{company.createdBy}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {getStatusBadge(company.status)}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/companies/${company.id}/approve`)}
                            disabled={company.status !== 'PENDING'}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {dashboardData.recentCompanies.length === 0 && (
                    <div className="text-center py-8">
                      <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">No hay empresas recientes para mostrar</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Actividad Reciente</CardTitle>
                  <CardDescription>Últimas acciones realizadas en el sistema</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {dashboardData.recentAuditLogs.map((log) => (
                      <div key={log.id} className="flex items-start space-x-3 p-4 border rounded-lg">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                            <FileText className="h-4 w-4 text-blue-600" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-gray-900">
                              {log.description}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatDate(log.timestamp)}
                            </p>
                          </div>
                          <p className="text-sm text-gray-600">
                            Por: {log.userEmail}
                          </p>
                          {log.companyName && (
                            <p className="text-xs text-gray-500">
                              Empresa: {log.companyName}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {dashboardData.recentAuditLogs.length === 0 && (
                    <div className="text-center py-8">
                      <Activity className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">No hay actividad reciente para mostrar</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </PermissionRequired>
    </ProtectedRoute>
  )
}
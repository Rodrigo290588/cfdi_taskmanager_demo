'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Check, X, Building2, Calendar, User, Mail, Phone, MapPin, Globe, Users, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { PermissionRequired } from '@/components/auth/permission-guard'
import { Permission } from '@/lib/permissions'
import { toast } from 'sonner'

interface Company {
  id: string
  name: string
  rfc: string
  businessName: string
  legalRepresentative: string | null
  taxRegime: string
  postalCode: string
  address: string | null
  city: string | null
  state: string | null
  country: string
  phone: string | null
  email: string | null
  website: string | null
  industry: string | null
  employeesCount: number | null
  incorporationDate: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  createdBy: string
  notes: string | null
}

interface AuditLog {
  id: string
  action: string
  description: string
  userEmail: string
  timestamp: string
}

export default function CompanyApprovalPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string
  
  const [company, setCompany] = useState<Company | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectionForm, setShowRejectionForm] = useState(false)

  useEffect(() => {
    fetchCompanyDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchCompanyDetails = async () => {
    try {
      const response = await fetch(`/api/companies/${companyId}`)
      if (!response.ok) {
        throw new Error('Error al cargar los detalles de la empresa')
      }
      
      const data = await response.json()
      setCompany(data.company)
      setAuditLogs(data.auditLogs || [])
    } catch (error) {
      console.error('Error fetching company details:', error)
      toast.error('Error al cargar los detalles de la empresa')
      router.push('/companies/search')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'approve'
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al aprobar la empresa')
      }

      toast.success('Empresa aprobada exitosamente')
      router.push('/companies/search')
    } catch (error) {
      console.error('Error approving company:', error)
      toast.error(error instanceof Error ? error.message : 'Error al aprobar la empresa')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error('Por favor ingresa un motivo de rechazo')
      return
    }

    setIsProcessing(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'reject',
          rejectionReason: rejectionReason.trim()
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al rechazar la empresa')
      }

      toast.success('Empresa rechazada exitosamente')
      router.push('/companies/search')
    } catch (error) {
      console.error('Error rejecting company:', error)
      toast.error(error instanceof Error ? error.message : 'Error al rechazar la empresa')
    } finally {
      setIsProcessing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Cargando detalles de la empresa...</p>
        </div>
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Empresa no encontrada</h3>
          <p className="text-gray-600">La empresa que buscas no existe o ha sido eliminada.</p>
        </div>
      </div>
    )
  }

  if (company.status !== 'PENDING') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Empresa ya procesada</h3>
          <p className="text-gray-600">Esta empresa ya ha sido {company.status === 'APPROVED' ? 'aprobada' : 'rechazada'}.</p>
          <Button 
            onClick={() => router.push('/companies/search')}
            className="mt-4"
          >
            Volver a la búsqueda
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ProtectedRoute>
      <PermissionRequired permission={Permission.COMPANY_APPROVE}>
        <div className="container mx-auto py-6 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Revisión de Empresa</h1>
              <p className="text-muted-foreground">
                Revisa y aprueba/rechaza la solicitud de registro de empresa
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => router.push('/companies/search')}
            >
              Volver a la búsqueda
            </Button>
          </div>

          {/* Company Details */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main Company Info */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="bg-blue-100 p-3 rounded-lg">
                        <Building2 className="h-6 w-6 text-blue-600" />
                      </div>
                      <div>
                        <CardTitle>{company.name}</CardTitle>
                        <CardDescription>{company.businessName}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                      Pendiente de revisión
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Basic Information */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Información Básica</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center space-x-2">
                        <FileText className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm text-gray-500">RFC</p>
                          <p className="font-medium">{company.rfc}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Users className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm text-gray-500">Régimen Fiscal</p>
                          <p className="font-medium">{company.taxRegime}</p>
                        </div>
                      </div>
                      {company.industry && (
                        <div className="flex items-center space-x-2">
                          <Building2 className="h-4 w-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Industria</p>
                            <p className="font-medium">{company.industry}</p>
                          </div>
                        </div>
                      )}
                      {company.employeesCount && (
                        <div className="flex items-center space-x-2">
                          <Users className="h-4 w-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Número de Empleados</p>
                            <p className="font-medium">{company.employeesCount.toLocaleString()}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Location */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Ubicación</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center space-x-2">
                        <MapPin className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm text-gray-500">Dirección</p>
                          <p className="font-medium">{company.address || 'No especificada'}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <MapPin className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm text-gray-500">Ciudad</p>
                          <p className="font-medium">{[company.city, company.state, company.postalCode].filter(Boolean).join(', ')}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Información de Contacto</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {company.legalRepresentative && (
                        <div className="flex items-center space-x-2">
                          <User className="h-4 w-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Representante Legal</p>
                            <p className="font-medium">{company.legalRepresentative}</p>
                          </div>
                        </div>
                      )}
                      {company.email && (
                        <div className="flex items-center space-x-2">
                          <Mail className="h-4 w-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Email</p>
                            <p className="font-medium">{company.email}</p>
                          </div>
                        </div>
                      )}
                      {company.phone && (
                        <div className="flex items-center space-x-2">
                          <Phone className="h-4 w-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Teléfono</p>
                            <p className="font-medium">{company.phone}</p>
                          </div>
                        </div>
                      )}
                      {company.website && (
                        <div className="flex items-center space-x-2">
                          <Globe className="h-4 w-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Sitio Web</p>
                            <p className="font-medium">{company.website}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {company.notes && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3">Notas</h3>
                      <p className="text-gray-700">{company.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Registration Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Información de Registro</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500">Fecha de Registro</p>
                      <p className="font-medium">{new Date(company.createdAt).toLocaleDateString('es-MX')}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <User className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500">Registrado Por</p>
                      <p className="font-medium">{company.createdBy}</p>
                    </div>
                  </div>
                  {company.incorporationDate && (
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-4 w-4 text-gray-500" />
                      <div>
                        <p className="text-sm text-gray-500">Fecha de Constitución</p>
                        <p className="font-medium">{new Date(company.incorporationDate).toLocaleDateString('es-MX')}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Approval Actions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Acciones de Revisión</CardTitle>
                  <CardDescription>
                    Decide si apruebas o rechazas esta solicitud de registro
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!showRejectionForm ? (
                    <div className="space-y-3">
                      <Button 
                        onClick={handleApprove}
                        disabled={isProcessing}
                        className="w-full bg-green-600 hover:bg-green-700"
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Aprobar Empresa
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => setShowRejectionForm(true)}
                        disabled={isProcessing}
                        className="w-full border-red-300 text-red-700 hover:bg-red-50"
                      >
                        <X className="mr-2 h-4 w-4" />
                        Rechazar Empresa
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <Alert>
                        <AlertDescription>
                          Por favor proporciona un motivo detallado para el rechazo de esta empresa.
                        </AlertDescription>
                      </Alert>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Motivo de Rechazo</label>
                        <Textarea
                          placeholder="Describe el motivo por el cual rechazas esta empresa..."
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          rows={4}
                          className="resize-none"
                        />
                      </div>
                      
                      <div className="flex space-x-3">
                        <Button 
                          onClick={handleReject}
                          disabled={isProcessing || !rejectionReason.trim()}
                          className="flex-1 bg-red-600 hover:bg-red-700"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Confirmar Rechazo
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => {
                            setShowRejectionForm(false)
                            setRejectionReason('')
                          }}
                          disabled={isProcessing}
                          className="flex-1"
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Audit Log */}
          {auditLogs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Historial de Auditoría</CardTitle>
                <CardDescription>
                  Registro de todas las acciones realizadas sobre esta empresa
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
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
                            {new Date(log.timestamp).toLocaleDateString('es-MX')}
                          </p>
                        </div>
                        <p className="text-sm text-gray-600">
                          Por: {log.userEmail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </PermissionRequired>
    </ProtectedRoute>
  )
}
'use client'

import { useState, useEffect } from 'react'
import { TenantRegistrationForm } from '@/components/tenant/tenant-registration-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  BuildingIcon, 
  MapPin, 
  Phone, 
  Mail, 
  Globe, 
  Calendar, 
  Users, 
  Tag, 
  Edit, 
  Plus,
  CheckCircle,
  Loader2
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { TenantFormData } from '@/components/tenant/tenant-registration-form'

interface TenantData {
  id: string
  name: string
  slug: string
  logo?: string | null
  description?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  phone?: string | null
  contactEmail?: string | null
  businessDescription?: string | null
  website?: string | null
  industry?: string | null
  companySize?: string | null
  foundedYear?: number | null
  taxId?: string | null
  businessType?: string | null
  createdAt: string
  updatedAt: string
}

export default function TenantManagementPage() {
  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    fetchTenantData()
  }, [])

  const fetchTenantData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/tenant')
      
      if (!response.ok) {
        throw new Error('Error al cargar la información del tenant')
      }

      const data = await response.json()
      setTenant(data.tenant)
      
      // Show form if no tenant data exists
      if (!data.tenant || !data.tenant.name) {
        setShowForm(true)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const handleFormSuccess = (data: TenantFormData) => {
    // Update tenant with form data
    if (tenant) {
      setTenant({
        ...tenant,
        name: data.name,
        description: data.description,
        address: data.address,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
        phone: data.phone,
        contactEmail: data.contactEmail,
        businessDescription: data.businessDescription,
        website: data.website,
        industry: data.industry,
        companySize: data.companySize,
        foundedYear: data.foundedYear,
        taxId: data.taxId,
        businessType: data.businessType
      })
    }
    setShowForm(false)
    setIsEditing(false)
    setError(null)
  }

  const handleFormCancel = () => {
    if (tenant && tenant.name) {
      setShowForm(false)
      setIsEditing(false)
    } else {
      // If no tenant exists, we can't cancel
      setError('Debe registrar la información del tenant para continuar')
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8 max-w-6xl">
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    )
  }

  if (showForm) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <TenantRegistrationForm
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
          initialData={tenant || undefined}
          isEditing={isEditing}
        />
      </div>
    )
  }

  if (!tenant) {
    return (
      <div className="container mx-auto py-8 max-w-6xl">
        <Card>
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertDescription>{error || 'No se pudo cargar la información del tenant'}</AlertDescription>
            </Alert>
            <div className="mt-4">
              <Button onClick={fetchTenantData}>
                Reintentar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestión de Tenant</h1>
          <p className="text-muted-foreground">
            Administrar la información de su organización
          </p>
        </div>
        <Button onClick={() => { setIsEditing(true); setShowForm(true); }}>
          <Edit className="mr-2 h-4 w-4" />
          Editar Información
        </Button>
      </div>

      {/* Main Information Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={tenant.logo || undefined} alt={tenant.name} />
              <AvatarFallback>
                <BuildingIcon className="h-8 w-8 text-blue-600" />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <CardTitle className="text-2xl">{tenant.name}</CardTitle>
              <CardDescription>{tenant.description || 'Sin descripción'}</CardDescription>
            </div>
            <Badge variant={tenant.businessDescription ? "default" : "secondary"}>
              {tenant.businessDescription ? 'Completo' : 'Pendiente'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <BuildingIcon className="h-5 w-5 text-blue-600" />
                Información General
              </h3>
              
              {tenant.industry && (
                <div className="flex items-center gap-3">
                  <Tag className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">Industria</p>
                    <p className="font-medium">{tenant.industry}</p>
                  </div>
                </div>
              )}

              {tenant.companySize && (
                <div className="flex items-center gap-3">
                  <Users className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">Tamaño</p>
                    <p className="font-medium">{tenant.companySize}</p>
                  </div>
                </div>
              )}

              {tenant.foundedYear && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">Año de Fundación</p>
                    <p className="font-medium">{tenant.foundedYear}</p>
                  </div>
                </div>
              )}

              {tenant.businessType && (
                <div className="flex items-center gap-3">
                  <BuildingIcon className="h-4 w-4 text-blue-400" />
                  <div>
                    <p className="text-sm text-gray-500">Tipo de Negocio</p>
                    <p className="font-medium">{tenant.businessType}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Contact Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Información de Contacto
              </h3>

              {tenant.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">Teléfono</p>
                    <p className="font-medium">{tenant.phone}</p>
                  </div>
                </div>
              )}

              {tenant.contactEmail && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">Email de Contacto</p>
                    <p className="font-medium">{tenant.contactEmail}</p>
                  </div>
                </div>
              )}

              {tenant.website && (
                <div className="flex items-center gap-3">
                  <Globe className="h-4 w-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">Sitio Web</p>
                    <a 
                      href={tenant.website} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {tenant.website}
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Address Information */}
          {(tenant.address || tenant.city || tenant.state) && (
            <div className="mt-6 pt-6 border-t">
              <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
                <MapPin className="h-5 w-5" />
                Ubicación
              </h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="font-medium">
                  {tenant.address}
                  {tenant.address && tenant.city && ', '}
                  {tenant.city}
                </p>
                <p className="text-gray-600">
                  {tenant.state}
                  {tenant.state && tenant.postalCode && ' • '}
                  {tenant.postalCode}
                  {tenant.postalCode && tenant.country && ' • '}
                  {tenant.country || 'México'}
                </p>
              </div>
            </div>
          )}

          {/* Business Description */}
          {tenant.businessDescription && (
            <div className="mt-6 pt-6 border-t">
              <h3 className="text-lg font-semibold mb-3">Descripción del Negocio</h3>
              <p className="text-gray-700 leading-relaxed">{tenant.businessDescription}</p>
            </div>
          )}

          {/* Additional Information */}
          {(tenant.taxId || tenant.slug) && (
            <div className="mt-6 pt-6 border-t">
              <h3 className="text-lg font-semibold mb-3">Información Adicional</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tenant.taxId && (
                  <div>
                    <p className="text-sm text-gray-500">ID Fiscal (RFC)</p>
                    <p className="font-mono">{tenant.taxId}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-500">Slug</p>
                  <p className="font-mono text-sm">{tenant.slug}</p>
                </div>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="mt-6 pt-6 border-t text-sm text-gray-500">
            <div className="flex justify-between">
              <span>
                Creado: {format(new Date(tenant.createdAt), 'dd MMM yyyy', { locale: es })}
              </span>
              <span>
                Actualizado: {format(new Date(tenant.updatedAt), 'dd MMM yyyy', { locale: es })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Completitud del Perfil</CardTitle>
            <CardDescription>Estado de la información</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="text-sm font-medium">
                {tenant.businessDescription ? 'Perfil Completo' : 'Información Básica'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Acciones Rápidas</CardTitle>
            <CardDescription>Operaciones comunes</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setIsEditing(true); setShowForm(true); }}>
              <Edit className="mr-2 h-4 w-4" />
              Editar Información
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Siguientes Pasos</CardTitle>
            <CardDescription>Recomendaciones</CardDescription>
          </CardHeader>
          <CardContent>
            {!tenant.businessDescription && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => { setIsEditing(true); setShowForm(true); }}>
                <Plus className="mr-2 h-4 w-4" />
                Agregar Descripción
              </Button>
            )}
            {!tenant.logo && (
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => { setIsEditing(true); setShowForm(true); }}>
                <Plus className="mr-2 h-4 w-4" />
                Agregar Logo
              </Button>
            )}
            {tenant.businessDescription && tenant.logo && (
              <div className="text-sm text-green-600">
                ✓ Perfil completado
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
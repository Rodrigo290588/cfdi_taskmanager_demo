'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { 
  Building2, 
  MapPin, 
  Search, 
  Filter,
  Users,
  Globe,
  Calendar,
  Tag,
  Eye,
  Mail,
  Phone,
  Edit3 
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Tenant {
  id: string
  name: string
  slug: string
  logo?: string | null
  description?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  industry?: string | null
  companySize?: string | null
  foundedYear?: number | null
  contactEmail?: string | null
  phone?: string | null
  website?: string | null
  createdAt: string
  isOwner: boolean
  isMember: boolean
}

interface SearchFilters {
  query: string
  industry: string
  state: string
  companySize: string
}

const INDUSTRIES = [
  'Tecnología',
  'Manufactura',
  'Servicios',
  'Comercio',
  'Construcción',
  'Salud',
  'Educación',
  'Finanzas',
  'Alimentos y Bebidas',
  'Transporte',
  'Inmobiliaria',
  'Consultoría',
  'Otro'
]

const COMPANY_SIZES = [
  '1-10 empleados',
  '11-50 empleados',
  '51-200 empleados',
  '201-500 empleados',
  '501-1000 empleados',
  'Más de 1000 empleados'
]

const MEXICAN_STATES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'Coahuila', 'Colima', 'Durango', 'Guanajuato',
  'Guerrero', 'Hidalgo', 'Jalisco', 'Estado de México', 'Michoacán',
  'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
  'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco',
  'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas', 'CDMX'
]

export default function TenantDirectoryPage() {
  const router = useRouter()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1
  })
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    industry: '',
    state: '',
    companySize: ''
  })
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    fetchTenants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchTenants()
    }, 500) // Debounce search

    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pagination.page])

  const fetchTenants = async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (filters.query) params.append('query', filters.query)
      if (filters.industry) params.append('industry', filters.industry)
      if (filters.state) params.append('state', filters.state)
      if (filters.companySize) params.append('companySize', filters.companySize)
      params.append('page', pagination.page.toString())
      params.append('limit', pagination.limit.toString())

      const response = await fetch(`/api/tenant/search?${params.toString()}`)
      
      if (!response.ok) {
        throw new Error('Error al cargar los tenants')
      }

      const data = await response.json()
      setTenants(data.organizations)
      setPagination(data.pagination)

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  const clearFilters = () => {
    setFilters({
      query: '',
      industry: '',
      state: '',
      companySize: ''
    })
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  const viewTenantDetails = (slug: string) => {
    router.push(`/tenant/${slug}`)
  }

  const TenantCard = ({ tenant }: { tenant: Tenant }) => (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => viewTenantDetails(tenant.slug)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={tenant.logo || undefined} alt={tenant.name} />
            <AvatarFallback className="bg-blue-100 text-blue-600">
              <Building2 className="h-6 w-6" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg line-clamp-1">{tenant.name}</CardTitle>
            {tenant.description && (
              <CardDescription className="line-clamp-2 mt-1">
                {tenant.description}
              </CardDescription>
            )}
          </div>
          {tenant.isOwner && (
            <Badge variant="default" className="shrink-0">Propietario</Badge>
          )}
          {tenant.isMember && !tenant.isOwner && (
            <Badge variant="secondary" className="shrink-0">Miembro</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Location */}
          {(tenant.city || tenant.state) && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="h-4 w-4" />
              <span className="truncate">
                {[tenant.city, tenant.state, tenant.country].filter(Boolean).join(', ')}
              </span>
            </div>
          )}

          {/* Industry and Size */}
          <div className="flex flex-wrap gap-2">
            {tenant.industry && (
              <Badge variant="outline" className="text-xs">
                <Tag className="h-3 w-3 mr-1" />
                {tenant.industry}
              </Badge>
            )}
            {tenant.companySize && (
              <Badge variant="outline" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                {tenant.companySize}
              </Badge>
            )}
          </div>

          {/* Contact Info */}
          <div className="space-y-1 text-sm">
            {tenant.contactEmail && (
              <div className="flex items-center gap-2 text-gray-600">
                <Mail className="h-3 w-3" />
                <span className="truncate">{tenant.contactEmail}</span>
              </div>
            )}
            {tenant.phone && (
              <div className="flex items-center gap-2 text-gray-600">
                <Phone className="h-3 w-3" />
                <span>{tenant.phone}</span>
              </div>
            )}
            {tenant.website && (
              <div className="flex items-center gap-2 text-gray-600">
                <Globe className="h-3 w-3" />
                <span className="truncate">{tenant.website}</span>
              </div>
            )}
          </div>

          {/* Founded Year */}
          {tenant.foundedYear && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Calendar className="h-4 w-4" />
              <span>Fundado en {tenant.foundedYear}</span>
            </div>
          )}

          {/* Join Date */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="h-3 w-3" />
            <span>Miembro desde {format(new Date(tenant.createdAt), 'MMM yyyy', { locale: es })}</span>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-4 pt-4 border-t">
          <Button variant="outline" size="sm" className="w-full" onClick={(e) => {
            e.stopPropagation()
            viewTenantDetails(tenant.slug)
          }}>
            <Eye className="mr-2 h-4 w-4" />
            Ver Detalles
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="container mx-auto py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Directorio de Tenants</h1>
          <p className="text-muted-foreground mt-2">
            Explora y descubre las organizaciones registradas en el sistema
          </p>
        </div>
        <Link href="/tenant/management">
          <Button variant="outline">
            <Edit3 className="h-4 w-4 mr-2" />
            Mi Organización
          </Button>
        </Link>
      </div>

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Main Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por nombre, industria, ubicación..."
                value={filters.query}
                onChange={(e) => handleFilterChange('query', e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2"
              >
                <Filter className="h-4 w-4" />
                Filtros Avanzados
              </Button>
              
              {(filters.industry || filters.state || filters.companySize) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-sm"
                >
                  Limpiar filtros
                </Button>
              )}
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Industria</Label>
                  <Select value={filters.industry} onValueChange={(value) => handleFilterChange('industry', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todas las industrias" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todas</SelectItem>
                      {INDUSTRIES.map((industry) => (
                        <SelectItem key={industry} value={industry}>
                          {industry}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">Estado</Label>
                  <Select value={filters.state} onValueChange={(value) => handleFilterChange('state', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos los estados" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todos</SelectItem>
                      {MEXICAN_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">Tamaño</Label>
                  <Select value={filters.companySize} onValueChange={(value) => handleFilterChange('companySize', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos los tamaños" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todos</SelectItem>
                      {COMPANY_SIZES.map((size) => (
                        <SelectItem key={size} value={size}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {loading ? 'Buscando...' : `${pagination.total} organizaciones encontradas`}
        </p>
        {pagination.totalPages > 1 && (
          <p className="text-sm text-gray-600">
            Página {pagination.page} de {pagination.totalPages}
          </p>
        )}
      </div>

      {/* Error State */}
      {error && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="text-center text-red-600">
              <p>{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={fetchTenants}>
                Reintentar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 bg-gray-200 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-gray-200 rounded" />
                    <div className="h-3 bg-gray-200 rounded w-3/4" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="h-3 bg-gray-200 rounded" />
                  <div className="h-3 bg-gray-200 rounded w-5/6" />
                  <div className="h-3 bg-gray-200 rounded w-4/6" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Results Grid */}
      {!loading && tenants.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {tenants.map((tenant) => (
            <TenantCard key={tenant.id} tenant={tenant} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && tenants.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <Building2 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No se encontraron organizaciones
              </h3>
              <p className="text-gray-600 mb-4">
                Intenta ajustar tus filtros de búsqueda o crea una nueva organización.
              </p>
              <Button onClick={fetchTenants}>
                Actualizar búsqueda
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!loading && pagination.totalPages > 1 && (
        <div className="flex justify-center mt-8">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={pagination.page === 1}
            >
              Anterior
            </Button>
            
            <div className="flex items-center gap-1 px-4">
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                const pageNum = i + 1
                return (
                  <Button
                    key={pageNum}
                    variant={pagination.page === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                    className="min-w-[40px]"
                  >
                    {pageNum}
                  </Button>
                )
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination(prev => ({ ...prev, page: Math.min(pagination.totalPages, prev.page + 1) }))}
              disabled={pagination.page === pagination.totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
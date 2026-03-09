'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { showSuccess, showError } from '@/lib/toast'
import { Eye, Check, Calendar, Building2, Users, MapPin, Mail, Phone, Globe, Edit3, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import CompanyRegistrationForm from '@/components/companies/company-registration-form'
import Image from 'next/image'

interface Company {
  id: string
  name: string
  rfc: string
  businessName: string
  legalRepresentative: string | null
  taxRegime: string | null
  industry: string | null
  state: string | null
  city: string | null
  email: string | null
  phone: string | null
  website: string | null
  employeesCount: number | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  logo?: string | null
  approvedByUser?: {
    name: string
    email: string
  } | null
  auditLogs: Array<{
    id: string
    action: string
    createdAt: string
  }>
}

interface CompaniesListProps {
  companies: Company[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
  isLoading?: boolean
  onPageChange?: (page: number) => void
  showActions?: boolean
}

export function CompaniesList({ companies, pagination, isLoading, onPageChange, showActions = true }: CompaniesListProps) {
  const router = useRouter()
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [list, setList] = useState<Company[]>(companies)
  const [updatedId, setUpdatedId] = useState<string | null>(null)
  const [editingInitialData, setEditingInitialData] = useState<{
    id?: string
    name?: string
    rfc?: string
    businessName?: string
    legalRepresentative?: string
    taxRegime?: string
    postalCode?: string
    address?: string
    city?: string
    state?: string
    country?: string
    phone?: string
    email?: string
    website?: string
    industry?: string
    employeesCount?: number
    incorporationDate?: string
    notes?: string
  } | null>(null)
  const [editingLoading, setEditingLoading] = useState(false)
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null)
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    setList(companies)
  }, [companies])

  useEffect(() => {
    if (!updatedId) return
    const t = setTimeout(() => setUpdatedId(null), 2000)
    return () => clearTimeout(t)
  }, [updatedId])

  const getStatusBadge = (status: string) => {
    const variants = {
      PENDING: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' },
      APPROVED: { label: 'Aprobado', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
      REJECTED: { label: 'Rechazado', className: 'bg-red-100 text-red-800 hover:bg-red-100' }
    }
    const variant = variants[status as keyof typeof variants]
    return <Badge className={variant.className}>{variant.label}</Badge>
  }

  const getAvatarFallback = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const handleViewDetails = (companyId: string) => {
    router.push(`/companies/${companyId}`)
  }

  const handleApprove = (companyId: string) => {
    router.push(`/companies/${companyId}/approve`)
  }

  const handleEdit = (company: Company) => {
    setEditingCompany(company)
    setEditingLoading(true)
    setEditingInitialData(null)
    ;(async () => {
      try {
        const tenantRes = await fetch('/api/tenant')
        if (tenantRes.ok) {
          const tenantData = await tenantRes.json()
          setTenantLogoUrl(tenantData?.tenant?.logo ?? null)
        } else {
          setTenantLogoUrl(null)
        }
        const res = await fetch(`/api/companies/${company.id}`)
        const data = await res.json()
        if (!res.ok || !data?.company) throw new Error('No se pudo cargar la empresa')
        const c = data.company as {
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
          notes: string | null
          logo?: string | null
        }
        setCompanyLogoUrl(c.logo ?? null)
        setEditingInitialData({
          id: c.id,
          name: c.name,
          rfc: c.rfc,
          businessName: c.businessName,
          legalRepresentative: c.legalRepresentative ?? undefined,
          taxRegime: c.taxRegime,
          postalCode: c.postalCode,
          address: c.address ?? undefined,
          city: c.city ?? undefined,
          state: c.state ?? undefined,
          country: c.country,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
          website: c.website ?? undefined,
          industry: c.industry ?? undefined,
          employeesCount: c.employeesCount ?? undefined,
          incorporationDate: c.incorporationDate ? new Date(c.incorporationDate).toISOString().slice(0,10) : undefined,
          notes: c.notes ?? undefined
        })
      } catch (e) {
        showError('Error al cargar datos', e instanceof Error ? e.message : undefined)
      } finally {
        setEditingLoading(false)
      }
    })()
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, index) => (
          <Card key={index}>
            <CardHeader>
              <div className="flex items-center space-x-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-[250px]" />
                  <Skeleton className="h-4 w-[200px]" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-[100px]" />
                    <Skeleton className="h-4 w-[150px]" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (companies.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Building2 className="h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No se encontraron empresas</h3>
          <p className="text-gray-600 text-center max-w-md">
            No hay empresas que coincidan con tus criterios de búsqueda. Intenta ajustar tus filtros o crear una nueva empresa.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Results Summary */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Mostrando {companies.length} de {pagination.total} empresas
          {pagination.totalPages > 1 && (
            <span> - Página {pagination.page} de {pagination.totalPages}</span>
          )}
        </div>
      </div>

      {/* Companies Grid */}
      <div className="grid gap-4">
        {list.map((company) => (
          <Card key={company.id} className={cn('hover:shadow-md transition-shadow', company.id === updatedId && 'ring-2 ring-primary bg-green-50')}>
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                <div className="flex items-center space-x-4 overflow-hidden w-full sm:w-auto">
                  <Avatar className="h-12 w-12 shrink-0">
                    {company.logo ? (
                      <AvatarImage src={company.logo} alt={company.name} />
                    ) : null}
                    <AvatarFallback className="bg-blue-100 text-blue-800">
                      {getAvatarFallback(company.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg truncate" title={company.name}>{company.name}</CardTitle>
                    <CardDescription className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 text-xs sm:text-sm">
                      <span className="flex items-center shrink-0">
                        <Building2 className="h-3 w-3 mr-1 shrink-0" />
                        {company.rfc}
                      </span>
                      {company.businessName && (
                        <span className="text-gray-600 truncate hidden sm:inline-block" title={company.businessName}>
                          {company.businessName}
                        </span>
                      )}
                       {company.businessName && (
                        <span className="text-gray-600 break-words sm:hidden">
                          {company.businessName}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto space-x-2 sm:space-x-0 sm:space-y-2 ml-16 sm:ml-0">
                  {getStatusBadge(company.status)}
                  <div className="flex items-center text-xs text-gray-500">
                    <Calendar className="h-3 w-3 mr-1 shrink-0" />
                    {formatDate(company.createdAt)}
                  </div>
                </div>
              </div>
            </CardHeader>
            
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                {/* Company Details */}
                {company.industry && (
                  <div>
                    <div className="text-gray-500 font-medium">Industria</div>
                    <div className="text-gray-900 break-words">{company.industry}</div>
                  </div>
                )}
                
                {company.taxRegime && (
                  <div>
                    <div className="text-gray-500 font-medium">Régimen Fiscal</div>
                    <div className="text-gray-900 break-words">{company.taxRegime}</div>
                  </div>
                )}
                
                {company.employeesCount && (
                  <div>
                    <div className="text-gray-500 font-medium">Empleados</div>
                    <div className="flex items-center text-gray-900">
                      <Users className="h-3 w-3 mr-1 shrink-0" />
                      {company.employeesCount.toLocaleString()}
                    </div>
                  </div>
                )}

                {/* Location */}
                {(company.state || company.city) && (
                  <div>
                    <div className="text-gray-500 font-medium">Ubicación</div>
                    <div className="flex items-center text-gray-900">
                      <MapPin className="h-3 w-3 mr-1 shrink-0" />
                      <span className="break-words">
                        {[company.city, company.state].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Contact Info */}
                {company.email && (
                  <div>
                    <div className="text-gray-500 font-medium">Email</div>
                    <div className="flex items-center text-gray-900">
                      <Mail className="h-3 w-3 mr-1 shrink-0" />
                      <a href={`mailto:${company.email}`} className="hover:text-blue-600 break-all">
                        {company.email}
                      </a>
                    </div>
                  </div>
                )}

                {company.phone && (
                  <div>
                    <div className="text-gray-500 font-medium">Teléfono</div>
                    <div className="flex items-center text-gray-900">
                      <Phone className="h-3 w-3 mr-1 shrink-0" />
                      {company.phone}
                    </div>
                  </div>
                )}

                {company.website && (
                  <div>
                    <div className="text-gray-500 font-medium">Sitio Web</div>
                    <div className="flex items-center text-gray-900">
                      <Globe className="h-3 w-3 mr-1 shrink-0" />
                      <a href={company.website} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 break-all">
                        {company.website}
                      </a>
                    </div>
                  </div>
                )}

                {/* Legal Representative */}
                {company.legalRepresentative && (
                  <div>
                    <div className="text-gray-500 font-medium">Representante Legal</div>
                    <div className="text-gray-900 break-words">{company.legalRepresentative}</div>
                  </div>
                )}

                {/* Approved By */}
                {company.approvedByUser && (
                  <div>
                    <div className="text-gray-500 font-medium">Aprobado Por</div>
                    <div className="text-gray-900 break-words">{company.approvedByUser.name}</div>
                  </div>
                )}
              </div>

              {/* Actions */}
              {showActions && (
                <div className="flex justify-end space-x-2 mt-6 pt-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewDetails(company.id)}
                    className="flex items-center space-x-1"
                  >
                    <Eye className="h-4 w-4" />
                    <span>Ver Detalles</span>
                  </Button>
                  
                  {company.status === 'PENDING' && (
                    <Button
                      size="sm"
                      onClick={() => handleApprove(company.id)}
                      className="flex items-center space-x-1"
                    >
                      <Check className="h-4 w-4" />
                      <span>Revisar</span>
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(company)}
                    className="flex items-center space-x-1"
                  >
                    <Edit3 className="h-4 w-4" />
                    <span>Editar</span>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => {
                e.preventDefault()
                  onPageChange?.(Math.max(1, pagination.page - 1))
              }}
                className={pagination.page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                size="default"
              />
            </PaginationItem>
            
            {[...Array(Math.min(5, pagination.totalPages))].map((_, index) => {
              const pageNum = Math.max(1, Math.min(pagination.page - 2 + index, pagination.totalPages - 4 + index))
              if (pageNum > pagination.totalPages) return null
              
              return (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      onPageChange?.(pageNum)
                    }}
                    isActive={pageNum === pagination.page}
                    className="cursor-pointer"
                    size="icon"
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              )
            })}
            
            {pagination.totalPages > 5 && pagination.page < pagination.totalPages - 2 && (
              <>
                <PaginationItem>
                  <span className="px-2">...</span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      onPageChange?.(pagination.totalPages)
                    }}
                    className="cursor-pointer"
                    size="icon"
                  >
                    {pagination.totalPages}
                  </PaginationLink>
                </PaginationItem>
              </>
            )}
            
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  onPageChange?.(Math.min(pagination.totalPages, pagination.page + 1))
                }}
                className={pagination.page === pagination.totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                size="default"
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {editingCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditingCompany(null)} />
          <div className="relative bg-background rounded-xl shadow-lg w-full max-w-4xl mx-3 max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="flex items-center gap-3">
                {companyLogoUrl ? (
                  <Image src={companyLogoUrl} alt="Logo Empresa" width={40} height={40} className="h-10 w-10 object-contain rounded" />
                ) : tenantLogoUrl ? (
                  <Image src={tenantLogoUrl} alt="Logo Tenant" width={40} height={40} className="h-10 w-10 object-contain rounded" />
                ) : null}
                <div className="text-lg font-semibold">Editar Empresa</div>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setEditingCompany(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3 overflow-y-auto">
              {editingLoading || !editingInitialData ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Cargando datos de la empresa...</div>
              ) : (
                <CompanyRegistrationForm
                  mode="edit"
                  initialData={editingInitialData}
                  onClose={() => setEditingCompany(null)}
                  onSaved={(updated) => {
                    ;(async () => {
                      try {
                        const res = await fetch(`/api/companies/${updated.id}`)
                        const data = await res.json()
                        if (!res.ok || !data?.company) throw new Error('No se pudo obtener la empresa actualizada')
                      const c = data.company as {
                        id: string
                        name: string
                        rfc: string
                        businessName: string
                        legalRepresentative: string | null
                        taxRegime: string
                        city: string | null
                        state: string | null
                        email: string | null
                        phone: string | null
                        website: string | null
                        industry: string | null
                        employeesCount: number | null
                        status: string
                        createdAt: string
                        logo?: string | null
                      }

                      const mappedStatus = c.status === 'PENDING' ? 'PENDING' : c.status === 'APPROVED' ? 'APPROVED' : 'REJECTED'

                      setList(prev => prev.map(item => item.id === c.id ? {
                        ...item,
                        name: c.name,
                        rfc: c.rfc,
                        businessName: c.businessName || item.businessName,
                        legalRepresentative: c.legalRepresentative ?? item.legalRepresentative,
                        taxRegime: c.taxRegime || item.taxRegime,
                        city: c.city ?? item.city,
                        state: c.state ?? item.state,
                        email: c.email ?? item.email,
                        phone: c.phone ?? item.phone,
                        website: c.website ?? item.website,
                        industry: c.industry ?? item.industry,
                        employeesCount: typeof c.employeesCount === 'number' ? c.employeesCount : item.employeesCount,
                        status: mappedStatus,
                        createdAt: typeof c.createdAt === 'string' ? c.createdAt : item.createdAt,
                        logo: c.logo ?? item.logo
                      } : item))

                      setUpdatedId(c.id)
                      showSuccess('Empresa actualizada', 'Los cambios se guardaron correctamente')
                    } catch (e) {
                      showError('Error al refrescar datos', e instanceof Error ? e.message : undefined)
                    } finally {
                      setEditingCompany(null)
                    }
                  })()
                }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdvancedSearch, SearchFilters } from '@/components/companies/advanced-search'
import { CompaniesList } from '@/components/companies/companies-list'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { PermissionRequired } from '@/components/auth/permission-guard'
import { Permission } from '@/lib/permissions'
import { toast } from 'sonner'
import CompanyRegistrationForm from '@/components/companies/company-registration-form'

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
  approvedByUser?: {
    name: string
    email: string
  } | null
  auditLogs: Array<{
    id: string
    action: string
    createdAt: string
  }>
  logo?: string | null
}

interface FilterOptions {
  taxRegimes: string[]
  industries: string[]
  states: string[]
}

interface SearchResponse {
  companies: Company[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
  filters: FilterOptions
}

export default function CompaniesSearchPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    taxRegimes: [],
    industries: [],
    states: []
  })
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1
  })
  const [isLoading, setIsLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [currentFilters, setCurrentFilters] = useState<SearchFilters>({
    query: '',
    status: '',
    taxRegime: '',
    industry: '',
    state: '',
    dateFrom: '',
    dateTo: '',
    employeesMin: '',
    employeesMax: ''
  })

  const fetchCompanies = async (filters: SearchFilters, page: number = 1) => {
    setIsLoading(true)
    try {
      // Limpiar parámetros vacíos
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined)
      )
      
      const searchParams = new URLSearchParams({
        ...cleanFilters,
        page: page.toString(),
        limit: '20'
      })

      console.log('Fetching companies with params:', searchParams.toString())
      
      const response = await fetch(`/api/companies/search?${searchParams}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Error desconocido' }))
        console.error('API Error:', errorData)
        // Mostrar mensaje de error más detallado
        const errorMessage = errorData.details ? 
          `${errorData.error}: ${JSON.stringify(errorData.details)}` : 
          errorData.error || 'Error al buscar empresas'
        throw new Error(errorMessage)
      }

      const data: SearchResponse = await response.json()
      setCompanies(data.companies)
      setPagination(data.pagination)
      setFilterOptions(data.filters)
    } catch (error) {
      console.error('Error fetching companies:', error)
      toast.error('Error al cargar las empresas')
      setCompanies([])
      setPagination({ total: 0, page: 1, limit: 20, totalPages: 1 })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSearch = (filters: SearchFilters) => {
    setCurrentFilters(filters)
    setPagination(prev => ({ ...prev, page: 1 }))
    fetchCompanies(filters, 1)
  }

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
    fetchCompanies(currentFilters, page)
  }

  const handleCreated = async (company: { id: string; name: string; rfc: string; businessName: string; status: string }) => {
    try {
      const res = await fetch(`/api/companies/${company.id}`)
      const data = await res.json()
      if (!res.ok || !data?.company) throw new Error('No se pudo obtener la empresa creada')
      interface ResponseCompany {
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
        status: string
        approvedBy: string | null
        approvedAt: string | null
        rejectionReason: string | null
        notes: string | null
        createdAt: string
        updatedAt: string
        createdBy: string
        updatedBy: string
        logo?: string | null
      }
      const c = data.company as ResponseCompany
      const mappedStatus = c.status === 'PENDING' ? 'PENDING' : c.status === 'APPROVED' ? 'APPROVED' : 'REJECTED'
      const merged: Company = {
        id: c.id,
        name: c.name,
        rfc: c.rfc,
        businessName: c.businessName,
        legalRepresentative: c.legalRepresentative ?? null,
        taxRegime: c.taxRegime ?? null,
        industry: c.industry ?? null,
        state: c.state ?? null,
        city: c.city ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        website: c.website ?? null,
        employeesCount: c.employeesCount ?? null,
        status: mappedStatus,
        createdAt: c.createdAt || new Date().toISOString(),
        approvedByUser: null,
        auditLogs: [],
        logo: c.logo ?? null
      }
      setCompanies(prev => [merged, ...prev])
      setPagination(prev => ({ ...prev, total: prev.total + 1 }))
      toast.success('Empresa creada')
    } catch {
      toast.error('Error al refrescar datos')
    } finally {
      setCreateOpen(false)
    }
  }

  useEffect(() => {
    fetchCompanies(currentFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ProtectedRoute>
      <PermissionRequired permission={Permission.COMPANY_READ}>
        <div className="container mx-auto py-6 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Búsqueda de Empresas</h1>
              <p className="text-muted-foreground">
                Encuentra y gestiona empresas registradas en el sistema
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva Empresa
            </Button>
          </div>

          {/* Advanced Search */}
          <AdvancedSearch
            onSearch={handleSearch}
            isLoading={isLoading}
            filterOptions={filterOptions}
          />

          {/* Results */}
          <CompaniesList
            companies={companies}
            pagination={pagination}
            isLoading={isLoading}
            onPageChange={handlePageChange}
            showActions={true}
          />
          {createOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setCreateOpen(false)} />
              <div className="relative bg-background rounded-xl shadow-lg w-full max-w-4xl mx-3 max-h-[85vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-3 border-b">
                  <div className="text-lg font-semibold">Registrar Empresa</div>
                  <Button variant="ghost" size="icon-sm" onClick={() => setCreateOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="p-3 overflow-y-auto">
                  <CompanyRegistrationForm
                    mode="create"
                    onClose={() => setCreateOpen(false)}
                    onSaved={handleCreated}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionRequired>
    </ProtectedRoute>
  )
}

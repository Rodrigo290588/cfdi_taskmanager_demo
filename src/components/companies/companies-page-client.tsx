'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Building, Plus, Search, Shield, FileText, X } from 'lucide-react'
import CompanyRegistrationForm from '@/components/companies/company-registration-form'
import { CompaniesList } from '@/components/companies/companies-list'
import { cn } from '@/lib/utils'
import { showSuccess, showError } from '@/lib/toast'

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
  approvedByUser?: { name: string; email: string } | null
  auditLogs: Array<{ id: string; action: string; createdAt: string }>
  logo?: string | null
}

export function CompaniesPageClient({ initialCompanies }: { initialCompanies: Company[] }) {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies)
  const [createOpen, setCreateOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), 2000)
    return () => clearTimeout(t)
  }, [highlightId])

  const handleCreated = async (company: {
    id: string
    name: string
    rfc: string
    businessName: string
    status: string
  }) => {
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
      setHighlightId(c.id)
      showSuccess('Empresa creada', 'La empresa fue agregada correctamente')
    } catch (e) {
      showError('Error al refrescar datos', e instanceof Error ? e.message : undefined)
    } finally {
      setCreateOpen(false)
    }
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Gestión de Empresas</h1>
        <p className="text-gray-600">Administra el registro y validación de empresas con RFC mexicano</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className={cn('hover:shadow-lg transition-shadow', highlightId && 'ring-0')}>
          <CardHeader>
            <div className="flex items-center space-x-2 mb-2">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Plus className="h-6 w-6 text-blue-600" />
              </div>
              <CardTitle>Registrar Empresa</CardTitle>
            </div>
            <CardDescription>Da de alta nuevas empresas con validación de RFC mexicano</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva Empresa
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center space-x-2 mb-2">
              <div className="p-2 bg-green-100 rounded-lg">
                <Search className="h-6 w-6 text-green-600" />
              </div>
              <CardTitle>Buscar Empresas</CardTitle>
            </div>
            <CardDescription>Encuentra empresas registradas con búsqueda avanzada</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/companies/search" className="block">
              <Button variant="outline" className="w-full">
                <Search className="mr-2 h-4 w-4" />
                Buscar Empresas
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center space-x-2 mb-2">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Shield className="h-6 w-6 text-purple-600" />
              </div>
              <CardTitle>Panel de Admin</CardTitle>
            </div>
            <CardDescription>Aprueba o rechaza empresas pendientes de validación</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/dashboard" className="block">
              <Button variant="outline" className="w-full">
                <Shield className="mr-2 h-4 w-4" />
                Administrar
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Características Principales</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-start space-x-3 p-4 bg-blue-50 rounded-lg">
            <Building className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900">Registro de Empresas</h3>
              <p className="text-sm text-blue-700">Alta de empresas con RFC mexicano</p>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-4 bg-green-50 rounded-lg">
            <Search className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900">Búsqueda Avanzada</h3>
              <p className="text-sm text-green-700">Filtros por estado, régimen, industria</p>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-4 bg-purple-50 rounded-lg">
            <Shield className="h-5 w-5 text-purple-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-purple-900">Validación RFC</h3>
              <p className="text-sm text-purple-700">Validación automática de RFC mexicano</p>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-4 bg-orange-50 rounded-lg">
            <FileText className="h-5 w-5 text-orange-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-orange-900">Bitácora de Auditoría</h3>
              <p className="text-sm text-orange-700">Registro completo de cambios</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Empresas del Tenant</h2>
        <CompaniesList
          companies={companies}
          pagination={{ total: companies.length, page: 1, limit: Math.max(companies.length, 1), totalPages: 1 }}
          isLoading={false}
          showActions={true}
        />
      </div>

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
  )
}

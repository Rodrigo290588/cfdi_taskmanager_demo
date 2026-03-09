'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Building2, Calendar, User, Eye } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Company {
  id: string
  name: string
  rfc: string | null
  businessName: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  rejectionReason: string | null
}

interface RegisteredCompaniesTableProps {
  onViewDetails?: (companyId: string) => void
}

export function RegisteredCompaniesTable({ onViewDetails }: RegisteredCompaniesTableProps) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCompanies()
  }, [])

  const fetchCompanies = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/companies/tenant')
      
      if (!response.ok) {
        throw new Error('Error al cargar las empresas')
      }

      const data = await response.json()
      const list: Array<{ id: string; rfc: string | null; businessName: string | null; isActive: boolean }> = data.companies || []
      setCompanies(
        list.map((c) => ({
          id: c.id,
          name: c.businessName || 'Empresa',
          rfc: c.rfc,
          businessName: c.businessName,
          status: c.isActive ? 'APPROVED' : 'PENDING',
          createdAt: null,
          approvedAt: null,
          approvedBy: null,
          rejectionReason: null,
        }))
      )
    } catch (error) {
      console.error('Error fetching companies:', error)
      setError(error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <Badge variant="default" className="bg-green-500 hover:bg-green-600">Aprobado</Badge>
      case 'REJECTED':
        return <Badge variant="destructive">Rechazado</Badge>
      case 'PENDING':
      default:
        return <Badge variant="secondary">Pendiente</Badge>
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    try {
      return format(new Date(dateString), 'dd MMM yyyy', { locale: es })
    } catch {
      return 'Fecha inválida'
    }
  }

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Empresas Registradas
          </CardTitle>
          <CardDescription>
            Lista de empresas registradas en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Cargando empresas...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Empresas Registradas
          </CardTitle>
          <CardDescription>
            Lista de empresas registradas en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={fetchCompanies} variant="outline">
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (companies.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Empresas Registradas
          </CardTitle>
          <CardDescription>
            Lista de empresas registradas en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Building2 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-500 mb-2">No hay empresas registradas</p>
            <p className="text-sm text-gray-400">
              Las empresas registradas aparecerán aquí una vez que sean creadas
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Empresas Registradas
        </CardTitle>
        <CardDescription>
          Lista de empresas registradas en el sistema ({companies.length} empresa{companies.length !== 1 ? 's' : ''})
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>RFC</TableHead>
                <TableHead>Razón Social</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha de Registro</TableHead>
                <TableHead>Fecha de Aprobación</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-gray-400" />
                      {company.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">
                      {company.rfc || 'N/A'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-xs truncate" title={company.businessName || ''}>
                      {company.businessName || 'N/A'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(company.status)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-gray-400" />
                      <span className="text-sm">{formatDate(company.createdAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3 text-gray-400" />
                      <span className="text-sm">{formatDate(company.approvedAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewDetails?.(company.id)}
                      className="h-8 px-2"
                    >
                      <Eye className="h-4 w-4" />
                      <span className="sr-only">Ver detalles</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

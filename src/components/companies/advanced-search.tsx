'use client'

import { useState } from 'react'
import { Search, Filter, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface SearchFilters {
  query: string
  status: string
  taxRegime: string
  industry: string
  state: string
  dateFrom: string
  dateTo: string
  employeesMin: string
  employeesMax: string
}

interface FilterOptions {
  taxRegimes: string[]
  industries: string[]
  states: string[]
}

interface AdvancedSearchProps {
  onSearch: (filters: SearchFilters) => void
  isLoading?: boolean
  filterOptions: FilterOptions
}

export function AdvancedSearch({ onSearch, isLoading, filterOptions }: AdvancedSearchProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({
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

  // Debug: Ver cuántas opciones hay en cada filtro
  console.log('Filter options:', {
    taxRegimes: filterOptions.taxRegimes.length,
    industries: filterOptions.industries.length,
    states: filterOptions.states.length,
    taxRegimesList: filterOptions.taxRegimes,
    industriesList: filterOptions.industries,
    statesList: filterOptions.states
  })

  const getStatusLabel = (status: string) => {
    const labels = {
      PENDING: 'Pendiente',
      APPROVED: 'Aprobado',
      REJECTED: 'Rechazado'
    }
    return labels[status as keyof typeof labels] || status
  }

  const activeFilters = []
  if (filters.query) activeFilters.push(`Búsqueda: ${filters.query}`)
  if (filters.status) activeFilters.push(`Estado: ${getStatusLabel(filters.status)}`)
  if (filters.taxRegime) activeFilters.push(`Régimen: ${filters.taxRegime}`)
  if (filters.industry) activeFilters.push(`Industria: ${filters.industry}`)
  if (filters.state) activeFilters.push(`Estado: ${filters.state}`)
  if (filters.dateFrom) activeFilters.push(`Desde: ${filters.dateFrom}`)
  if (filters.dateTo) activeFilters.push(`Hasta: ${filters.dateTo}`)
  if (filters.employeesMin) activeFilters.push(`Empleados min: ${filters.employeesMin}`)
  if (filters.employeesMax) activeFilters.push(`Empleados max: ${filters.employeesMax}`)

  const handleInputChange = (field: keyof SearchFilters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }))
  }

  const handleSearch = () => {
    onSearch(filters)
  }

  const clearFilter = (filterToRemove: string) => {
    const filterMap: { [key: string]: keyof SearchFilters } = {
      'Búsqueda': 'query',
      'Estado solicitud': 'status',
      'Régimen': 'taxRegime',
      'Industria': 'industry',
      'Estado': 'state',
      'Desde': 'dateFrom',
      'Hasta': 'dateTo',
      'Empleados min': 'employeesMin',
      'Empleados max': 'employeesMax'
    }

    const filterKey = Object.keys(filterMap).find(key => filterToRemove.startsWith(key))
    if (filterKey) {
      setFilters(prev => ({ ...prev, [filterMap[filterKey]]: '' }))
    }
  }

  const clearAllFilters = () => {
    setFilters({
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
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Búsqueda Avanzada de Empresas</CardTitle>
        <CardDescription>
          Encuentra empresas utilizando múltiples criterios de búsqueda y filtros avanzados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Basic Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Buscar por nombre, RFC, razón social, representante o email..."
              value={filters.query}
              onChange={(e) => handleInputChange('query', e.target.value)}
              className="pl-10"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch} disabled={isLoading}>
            {isLoading ? 'Buscando...' : 'Buscar'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2"
          >
            <Filter className="h-4 w-4" />
            Filtros
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Active Filters */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600">Filtros activos:</span>
            {activeFilters.map((filter, index) => (
              <Badge key={index} variant="secondary" className="flex items-center gap-1">
                {filter}
                <button
                  onClick={() => clearFilter(filter)}
                  className="ml-1 hover:bg-gray-200 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="text-xs"
            >
              Limpiar todo
            </Button>
          </div>
        )}

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="space-y-4 pt-4 border-t">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Status Filter */}
              <div className="space-y-2">
                <Label htmlFor="status">Estado</Label>
                <Select
                  value={filters.status}
                  onValueChange={(value) => handleInputChange('status', value)}
                >
                  <SelectTrigger id="status">
                    <SelectValue placeholder="Todos los estados" />
                  </SelectTrigger>
                  <SelectContent 
                    className="max-h-[300px] overflow-y-auto w-full" 
                    position="popper" 
                    side="bottom" 
                    align="start"
                    sideOffset={4}
                  >
                    <SelectItem value="">Todos</SelectItem>
                    <SelectItem value="PENDING">Pendiente</SelectItem>
                    <SelectItem value="APPROVED">Aprobado</SelectItem>
                    <SelectItem value="REJECTED">Rechazado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Tax Regime Filter */}
              <div className="space-y-2">
                <Label htmlFor="taxRegime">Régimen Fiscal</Label>
                <Select
                  value={filters.taxRegime}
                  onValueChange={(value) => handleInputChange('taxRegime', value)}
                >
                  <SelectTrigger id="taxRegime">
                    <SelectValue placeholder="Todos los regímenes" />
                  </SelectTrigger>
                  <SelectContent 
                    className="max-h-[300px] overflow-y-auto w-full" 
                    position="popper" 
                    side="bottom" 
                    align="start"
                    sideOffset={4}
                  >
                    <SelectItem value="">Todos</SelectItem>
                    {filterOptions.taxRegimes.map((regime) => (
                      <SelectItem key={regime} value={regime} className="break-all text-sm">
                        {regime}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Industry Filter */}
              <div className="space-y-2">
                <Label htmlFor="industry">Industria</Label>
                <Select
                  value={filters.industry}
                  onValueChange={(value) => handleInputChange('industry', value)}
                >
                  <SelectTrigger id="industry">
                    <SelectValue placeholder="Todas las industrias" />
                  </SelectTrigger>
                  <SelectContent 
                    className="max-h-[300px] overflow-y-auto w-full" 
                    position="popper" 
                    side="bottom" 
                    align="start"
                    sideOffset={4}
                  >
                    <SelectItem value="">Todas</SelectItem>
                    {filterOptions.industries.map((industry) => (
                      <SelectItem key={industry} value={industry} className="break-all text-sm">
                        {industry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* State Filter */}
              <div className="space-y-2">
                <Label htmlFor="state">Estado</Label>
                <Select
                  value={filters.state}
                  onValueChange={(value) => handleInputChange('state', value)}
                >
                  <SelectTrigger id="state">
                    <SelectValue placeholder="Todos los estados" />
                  </SelectTrigger>
                  <SelectContent 
                    className="max-h-[300px] overflow-y-auto w-full" 
                    position="popper" 
                    side="bottom" 
                    align="start"
                    sideOffset={4}
                  >
                    <SelectItem value="">Todos</SelectItem>
                    {filterOptions.states.map((state) => (
                      <SelectItem key={state} value={state} className="break-all text-sm">
                        {state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range */}
              <div className="space-y-2">
                <Label htmlFor="dateFrom">Fecha desde</Label>
                <Input
                  id="dateFrom"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => handleInputChange('dateFrom', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dateTo">Fecha hasta</Label>
                <Input
                  id="dateTo"
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => handleInputChange('dateTo', e.target.value)}
                />
              </div>

              {/* Employee Count */}
              <div className="space-y-2">
                <Label htmlFor="employeesMin">Empleados (mínimo)</Label>
                <Input
                  id="employeesMin"
                  type="number"
                  placeholder="0"
                  value={filters.employeesMin}
                  onChange={(e) => handleInputChange('employeesMin', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="employeesMax">Empleados (máximo)</Label>
                <Input
                  id="employeesMax"
                  type="number"
                  placeholder="999999"
                  value={filters.employeesMax}
                  onChange={(e) => handleInputChange('employeesMax', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { TenantNavigation } from '@/components/tenant/tenant-navigation'
import { usePermissions } from '@/hooks/use-permissions'
import { useCompanyAccess } from '@/hooks/use-company-access'
import { Permission } from '@/lib/permissions'
import { useTenant } from '@/hooks/use-tenant'
import {
  FileText,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Building2,
  UserCircle,
  LogOut,
  Plus,
  Building,
  Search,
  Shield,
  CloudDownload,
  Inbox,
  Receipt,
  Sliders,
  House,
  Table
} from "lucide-react"

type NavIcon = React.ComponentType<{ className?: string }>
const navigation: Array<{ name: string; href: string; icon: NavIcon; required?: Permission | Permission[] }> = [
  {
    name: 'Bóveda Fiscal',
    href: '/invoices',
    icon: FileText,
    required: Permission.INVOICE_READ
  },
  {
    name: 'Empresas',
    href: '#',
    icon: Building,
    required: Permission.COMPANY_READ
  },
  {
    name: 'Reportes',
    href: '/reports',
    icon: BarChart3,
    required: Permission.INVOICE_READ
  },
]

type CompanyRole = 'ADMIN' | 'AUDITOR' | 'VIEWER'
interface FiscalEntity {
  id: string
  rfc: string
  businessName: string
  isActive: boolean
  role?: CompanyRole
}

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { canAccessOperationalFeatures, isTenantOwner, tenantState } = useTenant()
  const { hasPermission, hasAnyPermission } = usePermissions()
  const { hasAccess: hasCompanyAccess } = useCompanyAccess()
  const [fiscalEntities, setFiscalEntities] = useState<FiscalEntity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<FiscalEntity | null>(null)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [companiesOpen, setCompaniesOpen] = useState(false)
  const [cfdisEmittedOpen, setCfdisEmittedOpen] = useState(false)
  const [cfdisReceivedOpen, setCfdisReceivedOpen] = useState(false)
  const [cfdisPayrollOpen, setCfdisPayrollOpen] = useState(false)
  const [cfdisSatPortalOpen, setCfdisSatPortalOpen] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [moduleFlags, setModuleFlags] = useState<{ canViewEmission: boolean; canViewReception: boolean; canViewPayroll: boolean; canViewSatPortal: boolean } | null>(null)

  // Fetch companies the current user has access to
  const fetchTenantCompanies = useCallback(async () => {
    try {
      const orgId = tenantState?.organizationId
      const url = orgId ? `/api/user/company-access?orgId=${orgId}` : '/api/user/company-access'
      const response = await fetch(url, { cache: 'no-store' })
      let data: { companies?: FiscalEntity[]; hasAccess?: boolean } = { companies: [] }
      try {
        data = await response.json()
      } catch {}
      if (!response.ok) {
        setFiscalEntities([])
        setSelectedEntity(null)
        return
      }

      setFiscalEntities(data.companies || [])
      
      // Set first active company as selected, or first company if none active
      if (data.companies && data.companies.length > 0) {
        const activeCompany = data.companies.find((company: FiscalEntity) => company.isActive)
        setSelectedEntity(activeCompany || data.companies[0])
      } else {
        setSelectedEntity(null)
      }
    } catch (error) {
      console.error('Error fetching tenant companies:', error)
      // Fallback to empty array
      setFiscalEntities([])
      setSelectedEntity(null)
    }
  }, [tenantState])

  // Asegurar que el componente esté montado en el cliente
  useEffect(() => {
    const id = setTimeout(() => {
      setIsClient(true)
      if (session?.user) {
        fetchTenantCompanies()
      }
    }, 0)
    return () => clearTimeout(id)
  }, [session?.user, tenantState?.organizationId, fetchTenantCompanies])

  useEffect(() => {
    const loadFlags = async () => {
      try {
        if (!tenantState?.organizationId) return
        const res = await fetch(`/api/user/member?orgId=${tenantState.organizationId}`)
        const data = await res.json()
        if (res.ok && data?.member) {
          setModuleFlags({
            canViewEmission: data.member.canViewEmission,
            canViewReception: data.member.canViewReception,
            canViewPayroll: data.member.canViewPayroll,
            canViewSatPortal: data.member.canViewSatPortal,
          })
        }
      } catch {}
    }
    loadFlags()
  }, [tenantState?.organizationId])

  // Persist selected company and notify dashboard
  useEffect(() => {
    if (selectedEntity) {
      try {
        localStorage.setItem('selectedCompany', JSON.stringify(selectedEntity))
        window.dispatchEvent(new Event('company-selected'))
        document.dispatchEvent(new Event('company-selected'))
      } catch {}
    }
  }, [selectedEntity])

  // React to access changes dynamically
  useEffect(() => {
    const refreshCompanies = () => fetchTenantCompanies()
    const refreshModules = () => {
      (async () => {
        try {
          if (!tenantState?.organizationId) return
          const res = await fetch(`/api/user/member?orgId=${tenantState.organizationId}`)
          const data = await res.json()
          if (res.ok && data?.member) {
            setModuleFlags({
              canViewEmission: data.member.canViewEmission,
              canViewReception: data.member.canViewReception,
              canViewPayroll: data.member.canViewPayroll,
              canViewSatPortal: data.member.canViewSatPortal,
            })
          }
        } catch {}
      })()
    }
    window.addEventListener('company-access-changed', refreshCompanies as EventListener)
    document.addEventListener('company-access-changed', refreshCompanies)
    window.addEventListener('member-modules-changed', refreshModules as EventListener)
    document.addEventListener('member-modules-changed', refreshModules)
    window.addEventListener('focus', refreshCompanies)
    return () => {
      window.removeEventListener('company-access-changed', refreshCompanies as EventListener)
      document.removeEventListener('company-access-changed', refreshCompanies)
      window.removeEventListener('member-modules-changed', refreshModules as EventListener)
      document.removeEventListener('member-modules-changed', refreshModules)
      window.removeEventListener('focus', refreshCompanies)
    }
  }, [tenantState?.organizationId, fetchTenantCompanies])

  useEffect(() => {
    const fetchAvatar = async () => {
      try {
        const res = await fetch('/api/user/profile')
        const data = await res.json()
        if (res.ok && data?.user?.image) {
          setAvatarUrl(data.user.image as string)
        }
      } catch {}
    }
    if (session?.user) {
      fetchAvatar()
    }
  }, [session?.user])

  const handleLogout = async () => {
    try {
      await signOut({ redirect: true, callbackUrl: '/auth/signin' })
    } catch (error) {
      console.error('Error al cerrar sesión:', error)
    }
  }

  // Evitar renderizar contenido dinámico hasta que esté montado
  if (!isClient) {
    return (
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 bg-white shadow-lg transform transition-all duration-300 ease-in-out lg:relative",
        isOpen ? "translate-x-0 lg:w-80" : "-translate-x-full lg:w-0"
      )}>
        <div className="flex h-full flex-col">
          {/* Header skeleton */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 bg-gray-200 rounded-lg animate-pulse" />
              <div>
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-1" />
                <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
          </div>
          
          {/* Navigation skeleton */}
          <div className="flex-1 p-4 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
          
          {/* User profile skeleton */}
          <div className="border-t p-4">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 bg-gray-200 rounded-full animate-pulse" />
              <div className="flex-1">
                <div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-1" />
                <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-75 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 bg-gradient-to-b from-primary to-[#0f172a] text-primary-foreground border-r border-primary/20 transform transition-all duration-300 ease-in-out lg:relative",
        isOpen ? "translate-x-0 lg:w-80" : "-translate-x-full lg:w-0"
      )}>
        <div className="flex h-full flex-col overflow-hidden">
          {/* Header */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="flex items-center justify-center">
                 {/* Factronica Logo Small */}
                 <div className="flex items-start">
                   <span className="text-lg font-heading font-bold text-white">Factronica</span>
                   <div className="flex ml-1 mt-1.5 space-x-0.5">
                     <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                     <span className="w-1.5 h-1.5 rounded-full bg-secondary mt-1"></span>
                     <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                   </div>
                 </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-white/70 hover:text-white hover:bg-white/10"
              onClick={onToggle}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>

          {/* RFC Context Switcher */}
          <div className="p-4 border-b border-white/10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-between rounded-full border border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 h-auto py-2 text-white">
                  <div className="flex items-center space-x-2 text-left min-w-0">
                    <Building2 className="h-4 w-4 text-secondary" />
                    <div className="min-w-0">
                      {selectedEntity ? (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium truncate text-white">{selectedEntity.rfc}</p>
                            {selectedEntity.role && (
                              <Badge className="text-[10px] bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-full px-2" variant="secondary">
                                {selectedEntity.role === 'ADMIN' ? 'Admin' : selectedEntity.role === 'AUDITOR' ? 'Auditor' : 'Vis'}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-blue-200 truncate">
                            {selectedEntity.businessName}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-medium text-white">Sin empresas</p>
                          <p className="text-xs text-blue-200 truncate">
                            Registra tu primera empresa
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-blue-200" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {fiscalEntities.length > 0 ? (
                  <>
                    {fiscalEntities.map((entity) => (
                      <DropdownMenuItem
                        key={entity.id}
                        onClick={() => setSelectedEntity(entity)}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <Building2 className="h-4 w-4" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{entity.rfc}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {entity.businessName}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {entity.role && (
                            <Badge className="text-[10px]" variant="secondary">
                              {entity.role === 'ADMIN' ? 'Administrador' : entity.role === 'AUDITOR' ? 'Auditor' : 'Visualizador'}
                            </Badge>
                          )}
                          {!entity.isActive && (
                            <Badge variant="secondary" className="text-[10px]">
                              Inactivo
                            </Badge>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <div className="border-t pt-1">
                      <DropdownMenuItem>
                        <div className="flex items-center space-x-2">
                          <Plus className="h-4 w-4" />
                          <span>Agregar RFC</span>
                        </div>
                      </DropdownMenuItem>
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-center text-sm text-gray-500">
                    <Building2 className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    <p>No hay empresas registradas</p>
                    <p className="text-xs mt-1">Registra tu primera empresa para comenzar</p>
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
            {/* Home link at top */}
            <Link
              href="/dashboard"
              className={cn(
                "flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === '/dashboard' ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-100"
              )}
            >
              <House className="h-5 w-5" />
              <span>Tablero de ingresos</span>
            </Link>
            {hasPermission(Permission.MODULE_EMISSION_VIEW, tenantState?.organizationId) && moduleFlags?.canViewEmission !== false && (
            <Collapsible open={cfdisEmittedOpen} onOpenChange={setCfdisEmittedOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start px-3"
                >
                  <FileText className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Módulo de Emisión</span>
                  {cfdisEmittedOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
                <Link
                  href="/dashboard_fiscal"
                  className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                >
                  <BarChart3 className="h-4 w-4" />
                  <span>Dashboard de CFDIs Emitidos</span>
                </Link>
                <Link
                  href="/dashboard_fiscal/workpaper"
                  className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                >
                  <Table className="h-4 w-4" />
                  <span>Hoja de Trabajo de CFDIs Emitidos</span>
                </Link>
                <Link
                  href="/dashboard_fiscal/monitor"
                  className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                >
                  <Sliders className="h-4 w-4" />
                  <span>Monitor de Emisión</span>
                </Link>
              </CollapsibleContent>
            </Collapsible>
            )}

            {hasPermission(Permission.MODULE_RECEPTION_VIEW, tenantState?.organizationId) && moduleFlags?.canViewReception !== false && (
            <Collapsible open={cfdisReceivedOpen} onOpenChange={setCfdisReceivedOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start px-3"
                >
                  <Inbox className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Módulo de Recepción</span>
                  {cfdisReceivedOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
                <Link
                  href="/dashboard_recibidos"
                  className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                >
                  <BarChart3 className="h-4 w-4" />
                  <span>Dashboard</span>
                </Link>
              </CollapsibleContent>
            </Collapsible>
            )}

            {hasPermission(Permission.MODULE_PAYROLL_VIEW, tenantState?.organizationId) && moduleFlags?.canViewPayroll !== false && (
            <Collapsible open={cfdisPayrollOpen} onOpenChange={setCfdisPayrollOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start px-3"
                >
                  <Receipt className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Módulo de Nómina</span>
                  {cfdisPayrollOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
                <Link
                  href="/sat_cfdis"
                  className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                >
                  <CloudDownload className="h-4 w-4" />
                  <span>CFDIs en el SAT</span>
                </Link>
              </CollapsibleContent>
            </Collapsible>
            )}

            {hasPermission(Permission.MODULE_SAT_PORTAL_VIEW, tenantState?.organizationId) && moduleFlags?.canViewSatPortal !== false && (
            <Collapsible open={cfdisSatPortalOpen} onOpenChange={setCfdisSatPortalOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start px-3"
                >
                  <CloudDownload className="h-5 w-5 mr-3" />
                  <span className="flex-1 text-left">Descargas de CFDIs en SAT</span>
                  {cfdisSatPortalOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
                <Link
                  href="/sat_cfdis"
                  className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                >
                  <CloudDownload className="h-4 w-4" />
                  <span>CFDIs en el SAT</span>
                </Link>
              </CollapsibleContent>
            </Collapsible>
            )}
            {/* Show tenant navigation for new users (moved below SAT module) */}
            {(!canAccessOperationalFeatures() || !isTenantOwner()) && (
              <TenantNavigation />
            )}
            
            {/* Show full navigation for operational users */}
            {canAccessOperationalFeatures() && (
              <>
                {navigation.map((item) => {
                  const isActive = pathname === item.href
                  const orgId = tenantState?.organizationId
                  const permitted = Array.isArray(item.required)
                    ? hasAnyPermission(item.required, orgId)
                    : item.required
                    ? hasPermission(item.required, orgId)
                    : true

                  // Special handling for Empresas submenu
                  if (item.name === 'Empresas') {
                    if (!permitted) return null
                    return (
                      <Collapsible key={item.name} open={companiesOpen} onOpenChange={setCompaniesOpen}>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            className={cn(
                              "w-full justify-start px-4 py-2 rounded-full hover:bg-white/10 hover:text-white transition-all duration-200",
                              pathname?.startsWith('/companies') ? "bg-white/20 text-white font-semibold shadow-inner" : "text-blue-100"
                            )}
                          >
                            <Building className="h-5 w-5 mr-3" />
                            <span className="flex-1 text-left">{item.name}</span>
                            {companiesOpen ? (
                              <ChevronDown className="h-4 w-4 text-blue-200" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-blue-200" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
                          {hasPermission(Permission.COMPANY_CREATE, orgId) && (
                            <Link
                              href="/companies"
                              className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                            >
                              <Plus className="h-4 w-4" />
                              <span>Registrar Empresas</span>
                            </Link>
                          )}
                          {hasPermission(Permission.COMPANY_READ, orgId) && (
                            <Link
                              href="/companies/search"
                              className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                            >
                              <Search className="h-4 w-4" />
                              <span>Buscar Empresas</span>
                            </Link>
                          )}
                          {hasPermission(Permission.ADMIN_DASHBOARD, orgId) && (
                            <Link
                              href="/admin/dashboard"
                              className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                            >
                              <Shield className="h-4 w-4" />
                              <span>Administrar</span>
                            </Link>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  }
                  
                  // For company-related sections, also require company assignment access
                  const requiresCompanyAssignment = ['Bóveda Fiscal', 'CFDIs en el SAT', 'Reportes'].includes(item.name)
                  if (!permitted) return null
                  if (requiresCompanyAssignment && !hasCompanyAccess) return null
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-white/20 text-white font-semibold shadow-inner"
                          : "text-blue-100 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span>{item.name}</span>
                    </Link>
                  )
                })}

                {/* Reports Submenu */}
                {hasPermission(Permission.INVOICE_READ, tenantState?.organizationId) && hasCompanyAccess && (
                <Collapsible open={reportsOpen} onOpenChange={setReportsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-start px-3"
                    >
                      <BarChart3 className="h-5 w-5 mr-3" />
                      <span className="flex-1 text-left">Reportes</span>
                      {reportsOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
                    <Link
                      href="/reports/financial"
                      className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                    >
                      <span>Estado de Resultados</span>
                    </Link>
                    <Link
                      href="/reports/tax"
                      className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                    >
                      <span>Declaración de Impuestos</span>
                    </Link>
                    <Link
                      href="/reports/compliance"
                      className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white"
                    >
                      <span>Cumplimiento Fiscal</span>
                    </Link>
                  </CollapsibleContent>
        </Collapsible>
        )}

        </>
      )}
      {/* Configuración del Sistema */}
      

      {/* Administración de la Organización (debajo del SAT, antes de Preferencias) */}

      {/* Bottom: Preferencias del Sistema */}
      {hasPermission(Permission.ADMIN_SETTINGS, tenantState?.organizationId) && (
        <Link
          href="/preferences"
          className="flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-100 hover:bg-white/10 hover:text-white"
        >
          <Sliders className="h-5 w-5" />
          <span>Preferencias del Sistema</span>
        </Link>
      )}
      </nav>

          {/* User Profile */}
          <div className="border-t border-white/10 p-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start px-3 py-2 h-auto rounded-full hover:bg-white/10">
                  <Avatar className="h-8 w-8 mr-3 border border-white/20">
                    <AvatarImage src={avatarUrl || session?.user?.image || "/api/placeholder/32/32"} alt={session?.user?.name || "User"} />
                    <AvatarFallback className="bg-white/10 text-white">{session?.user?.name?.split(' ').map(n => n[0]).join('') || 'U'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium truncate text-white">{session?.user?.name || 'Usuario'}</p>
                    <p className="text-xs text-blue-200 truncate">{session?.user?.email || 'Administrador'}</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-blue-200" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserCircle className="h-4 w-4 mr-2" />
                    Perfil
                  </Link>
                </DropdownMenuItem>
                <div className="border-t">
                  <DropdownMenuItem className="text-red-600" onClick={handleLogout}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Cerrar Sesión
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </>
  )
}

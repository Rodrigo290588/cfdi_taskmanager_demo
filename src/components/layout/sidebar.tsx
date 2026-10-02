'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import type { Session } from 'next-auth'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { useTenant, type TenantState } from '@/hooks/use-tenant'
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
  Table,
  Users,
  Scale,
  Activity,
  XCircle,
  Landmark
} from "lucide-react"

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

type NavIcon = React.ComponentType<{ className?: string }>

type CompanyRole = 'ADMIN' | 'AUDITOR' | 'VIEWER' | string
interface FiscalEntity {
  id: string
  rfc: string
  businessName: string
  isActive: boolean
  role?: CompanyRole
  isCustomRole?: boolean
  moduleFlags?: {
    canViewEmission: boolean
    canViewReception: boolean
    canViewPayroll: boolean
    canViewSatPortal: boolean
    canViewMassDownloads: boolean
    canManageOrg?: boolean
    granularPermissions?: Record<string, boolean>
  } | null
}

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
}

function formatRoleLabel(entity: FiscalEntity): string {
  if (!entity.role) return '';
  if (entity.isCustomRole) return entity.role;
  switch (entity.role) {
    case 'ADMIN': return 'Administrador';
    case 'AUDITOR': return 'Auditor';
    default: return 'Visualizador';
  }
}

function formatRoleLabelShort(entity: FiscalEntity): string {
  if (!entity.role) return '';
  if (entity.isCustomRole) return entity.role;
  switch (entity.role) {
    case 'ADMIN': return 'Admin';
    case 'AUDITOR': return 'Auditor';
    default: return 'Vis';
  }
}

async function fetchCompaniesApi(orgId?: string, signal?: AbortSignal) {
  const url = orgId ? `/api/user/company-access?orgId=${orgId}` : '/api/user/company-access';
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) return [];
  try {
    const data = await response.json();
    return data.companies || [];
  } catch {
    return [];
  }
}

function getSavedCompany(): FiscalEntity | null {
  try {
    const stored = localStorage.getItem('selectedCompany');
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

function determineSelectedCompany(companies: FiscalEntity[], savedCompany: FiscalEntity | null): FiscalEntity | null {
  if (!companies || companies.length === 0) return null;
  
  const isValidSaved = savedCompany && companies.some(c => c.id === savedCompany.id);
  if (savedCompany && !isValidSaved) {
    try { localStorage.removeItem('selectedCompany') } catch {}
  }
  
  if (isValidSaved && savedCompany) {
    return companies.find(c => c.id === savedCompany.id) || savedCompany;
  }
  
  return companies.find(c => c.isActive) || companies[0];
}

async function fetchMemberFlags(orgId: string, signal?: AbortSignal) {
  const res = await fetch(`/api/user/member?orgId=${orgId}`, { signal })
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.member) return null
  
  return {
    canViewEmission: data.member.canViewEmission,
    canViewReception: data.member.canViewReception,
    canViewPayroll: data.member.canViewPayroll,
    canViewSatPortal: data.member.canViewSatPortal,
    canViewMassDownloads: data.member.canViewMassDownloads,
    canManageOrg: data.member.canManageOrg,
    granularPermissions: data.member.granularPermissions || data.member.customRole?.granularPermissions || {}
  }
}

async function fetchAvatarApi(signal?: AbortSignal) {
  const res = await fetch('/api/user/profile', { cache: 'no-store', signal })
  if (!res.ok) return null
  const data = await res.json()
  return data?.user?.image as string | null
}

function NavCollapsible({
  title,
  icon: Icon,
  isOpen,
  onOpenChange,
  children
}: Readonly<{
  title: string;
  icon: NavIcon;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}>) {
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start px-3">
          <Icon className="h-5 w-5 mr-3" />
          <span className="flex-1 text-left">{title}</span>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function StatefulNavCollapsible({
  title,
  icon,
  show,
  children
}: Readonly<{
  title: string;
  icon: NavIcon;
  show: boolean;
  children: ReactNode;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  if (!show) return null;
  return (
    <NavCollapsible title={title} icon={icon} isOpen={isOpen} onOpenChange={setIsOpen}>
      {children}
    </NavCollapsible>
  );
}

function MassDownloadsNavGroup({ show }: Readonly<{ show: boolean }>) {
  const [isOpen, setIsOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);

  if (!show) return null;

  return (
    <NavCollapsible title="Descargas masivas de CFDI" icon={CloudDownload} isOpen={isOpen} onOpenChange={setIsOpen}>
      <SubNavLinkItem href="/mass-downloads" icon={CloudDownload} title="Configuración de llaves privadas" />
      <Collapsible open={requestsOpen} onOpenChange={setRequestsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-start px-3 h-auto py-2 text-blue-200 hover:bg-white/10 hover:text-white rounded-full">
            <CloudDownload className="h-4 w-4 mr-3" />
            <span className="flex-1 text-left font-medium text-sm">Solicitud de descargas</span>
            {requestsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
          <SubNavLinkItem href="/mass-downloads/requests" icon={Plus} title="Nueva Solicitud" />
          <SubNavLinkItem href="/mass-downloads/requests/monitor" icon={BarChart3} title="Monitor de solicitud de peticiones" />
        </CollapsibleContent>
      </Collapsible>
      <SubNavLinkItem href="/mass-downloads/verification" icon={Shield} title="Monitor de verificación de peticiones" />
      <SubNavLinkItem href="/mass-downloads/package-downloads" icon={CloudDownload} title="Módulo de descargas de paquetes de solicitud" />
      <SubNavLinkItem href="/mass-downloads/fiscal-control" icon={BarChart3} title="Panel de Control Fiscal CFDI" />
    </NavCollapsible>
  );
}

function CompaniesNavGroup({
  show,
  pathname,
  hasPermission,
  orgId
}: Readonly<{
  show: boolean;
  pathname: string;
  hasPermission: (p: Permission, orgId?: string) => boolean;
  orgId?: string;
}>) {
  const [isOpen, setIsOpen] = useState(false);

  if (!show) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start px-4 py-2 rounded-full hover:bg-white/10 hover:text-white transition-all duration-200",
            pathname?.startsWith('/companies') ? "bg-white/20 text-white font-semibold shadow-inner" : "text-blue-100"
          )}
        >
          <Building className="h-5 w-5 mr-3" />
          <span className="flex-1 text-left">Empresas</span>
          {isOpen ? <ChevronDown className="h-4 w-4 text-blue-200" /> : <ChevronRight className="h-4 w-4 text-blue-200" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
        {hasPermission(Permission.COMPANY_CREATE, orgId) && (
          <SubNavLinkItem href="/companies" icon={Plus} title="Registrar Empresas" />
        )}
        {hasPermission(Permission.COMPANY_READ, orgId) && (
          <SubNavLinkItem href="/companies/search" icon={Search} title="Buscar Empresas" />
        )}
        {hasPermission(Permission.ADMIN_DASHBOARD, orgId) && (
          <SubNavLinkItem href="/admin/dashboard" icon={Shield} title="Administrar" />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function NavLinkItem({
  href,
  icon: Icon,
  title,
  isActive
}: Readonly<{
  href: string;
  icon: NavIcon;
  title: string;
  isActive?: boolean;
}>) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
        isActive
          ? "bg-white/20 text-white font-semibold shadow-inner"
          : "text-blue-100 hover:bg-white/10 hover:text-white"
      )}
    >
      <Icon className="h-5 w-5" />
      <span>{title}</span>
    </Link>
  );
}

function SubNavLinkItem({
  href,
  icon: Icon,
  title,
  isActive
}: Readonly<{
  href: string;
  icon: NavIcon | null;
  title: string;
  isActive?: boolean;
}>) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium hover:bg-white/10 hover:text-white",
        isActive ? "bg-white/10 text-white" : "text-blue-200"
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      <span>{title}</span>
    </Link>
  );
}

function useNavigationPermissions(moduleFlags: FiscalEntity['moduleFlags']) {
  const { tenantState } = useTenant();
  const { hasPermission } = usePermissions();
  const { hasAccess: hasCompanyAccess } = useCompanyAccess();
  const orgId = tenantState?.organizationId;

  const isEmissionEnabled = moduleFlags?.canViewEmission !== false;
  const isReceptionEnabled = moduleFlags?.canViewReception !== false;
  const isPayrollEnabled = moduleFlags?.canViewPayroll !== false;
  const isSatPortalEnabled = moduleFlags?.canViewSatPortal !== false;
  const isMassDownloadsEnabled = moduleFlags?.canViewMassDownloads !== false;
  
  const granularEmission = moduleFlags?.granularPermissions?.emissionDashboard !== false;
  const granularReception = moduleFlags?.granularPermissions?.receptionDashboard !== false;
  const granularProvider = moduleFlags?.granularPermissions?.providerDashboard !== false;
  
  const isProviderOnly = moduleFlags?.granularPermissions?.providerDashboard === true && !isEmissionEnabled && !isReceptionEnabled;
  const isEmissionReceptionDisabled = !isEmissionEnabled && !isReceptionEnabled;
  const isOrgCompaniesDisabled = moduleFlags?.canManageOrg === false && moduleFlags?.granularPermissions?.orgCompanies === false;

  return {
    showEmission: hasPermission(Permission.MODULE_EMISSION_VIEW, orgId) && isEmissionEnabled && granularEmission,
    showReception: hasPermission(Permission.MODULE_RECEPTION_VIEW, orgId) && isReceptionEnabled && granularReception,
    showPayroll: hasPermission(Permission.MODULE_PAYROLL_VIEW, orgId) && isPayrollEnabled,
    showProvider: granularProvider,
    showMassDownloads: hasPermission(Permission.MODULE_MASS_DOWNLOADS_VIEW, orgId) && isMassDownloadsEnabled,
    showSatPortal: hasPermission(Permission.MODULE_SAT_PORTAL_VIEW, orgId) && isSatPortalEnabled,
    canViewInvoices: hasPermission(Permission.INVOICE_READ, orgId) && hasCompanyAccess && !isEmissionReceptionDisabled,
    canViewEmpresas: hasPermission(Permission.COMPANY_READ, orgId) && !isProviderOnly && !isOrgCompaniesDisabled,
    canShowEmissionFeature: hasPermission(Permission.MODULE_EMISSION_VIEW, orgId) && isEmissionEnabled,
  };
}

function MainNavigation({ moduleFlags }: Readonly<{ moduleFlags: FiscalEntity['moduleFlags'] }>) {
  const pathname = usePathname();
  const { tenantState } = useTenant();
  const { hasPermission } = usePermissions();
  const orgId = tenantState?.organizationId;
  
  const perms = useNavigationPermissions(moduleFlags);

  return (
    <>
      <StatefulNavCollapsible title="Ingresos" icon={FileText} show={perms.showEmission}>
        <SubNavLinkItem href="/dashboard_fiscal" icon={BarChart3} title="Tablero de ingresos" />
        <SubNavLinkItem href="/dashboard_fiscal/workpaper" icon={Table} title="Reporte de ingresos" />
        <SubNavLinkItem href="/dashboard_fiscal/ingresos-parciales" icon={Receipt} title="Ingresos Cobrados / No Cobrados" />
        <SubNavLinkItem href="/dashboard_fiscal/cancelaciones" icon={XCircle} title="Cancelaciones" />
      </StatefulNavCollapsible>

      <StatefulNavCollapsible title="Egresos" icon={Inbox} show={perms.showReception}>
        <SubNavLinkItem href="/dashboard_recibidos" icon={BarChart3} title="Tablero de Egresos" />
        <SubNavLinkItem href="/dashboard_recibidos/workpaper" icon={Table} title="Reporte de Egresos" />
      </StatefulNavCollapsible>

      <StatefulNavCollapsible title="Nómina" icon={Receipt} show={perms.showPayroll}>
        <SubNavLinkItem href="/dashboard/rh" icon={BarChart3} title="Tablero Recursos Humanos" isActive={pathname === '/dashboard/rh' || pathname.startsWith('/dashboard/rh/')} />
        <SubNavLinkItem href="/dashboard/nomina/workpaper" icon={Table} title="Reporte de Nómina" />
        <SubNavLinkItem href="/dashboard/nomina/fiscal" icon={Landmark} title="Tablero Contabilidad y Fiscal" isActive={pathname === '/dashboard/nomina/fiscal' || pathname.startsWith('/dashboard/nomina/fiscal/')} />
        <SubNavLinkItem href="/dashboard/direccion" icon={Building2} title="Tablero RH Directivo" isActive={pathname === '/dashboard/direccion' || pathname.startsWith('/dashboard/direccion/')} />
      </StatefulNavCollapsible>

      <StatefulNavCollapsible title="Proveedor" icon={Building2} show={perms.showProvider}>
        <SubNavLinkItem href="/provider/cfdis-report" icon={FileText} title="Reporte CFDI´s" />
      </StatefulNavCollapsible>

      <MassDownloadsNavGroup show={perms.showMassDownloads} />

      {perms.canShowEmissionFeature && (
        <Link href="/dashboard/import-monitor" className={cn(buttonVariants({ variant: "ghost" }), "w-full justify-start px-3 h-auto py-2", pathname === '/dashboard/import-monitor' ? "bg-accent text-accent-foreground" : "")}>
          <Activity className="h-5 w-5 mr-3 shrink-0" />
          <span className="whitespace-normal text-left leading-tight">Monitor de integridad y timbrado de CFDI´s</span>
        </Link>
      )}

      <StatefulNavCollapsible title="Monitor" icon={CloudDownload} show={perms.showSatPortal}>
        <SubNavLinkItem href="/sat_cfdis" icon={CloudDownload} title="Dashboard" />
      </StatefulNavCollapsible>

      {perms.canViewInvoices && (
        <NavLinkItem href="/invoices" icon={FileText} title="Bóveda Fiscal" isActive={pathname === '/invoices'} />
      )}

      <CompaniesNavGroup 
        show={perms.canViewEmpresas} 
        pathname={pathname} 
        hasPermission={hasPermission} 
        orgId={orgId} 
      />
    </>
  );
}

function AdminNavigation() {
  const pathname = usePathname();
  const { tenantState } = useTenant();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const orgId = tenantState?.organizationId;
  const [adminOpen, setAdminOpen] = useState(false);

  const canShowAdmin = hasAnyPermission([
    Permission.ADMIN_DASHBOARD,
    Permission.ADMIN_USERS,
    Permission.ADMIN_SETTINGS,
    Permission.ADMIN_COMPANIES,
    Permission.ADMIN_ORGANIZATIONS,
    Permission.ADMIN_AUDIT,
  ], orgId);

  if (!canShowAdmin) return null;

  return (
    <Collapsible open={adminOpen} onOpenChange={setAdminOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start px-4 py-2 rounded-full hover:bg-white/10 hover:text-white transition-all duration-200">
          <Shield className="h-5 w-5 mr-3" />
          <span className="flex-1 text-left text-sm font-medium text-blue-100">Administración de la Organización</span>
          {adminOpen ? <ChevronDown className="h-4 w-4 text-blue-200" /> : <ChevronRight className="h-4 w-4 text-blue-200" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
        {hasPermission(Permission.ADMIN_DASHBOARD, orgId) && (
          <SubNavLinkItem href="/admin/dashboard" icon={BarChart3} title="Panel de Control" isActive={pathname?.startsWith('/admin/dashboard')} />
        )}
        {hasPermission(Permission.ADMIN_USERS, orgId) && (
          <SubNavLinkItem href="/admin/users" icon={Users} title="Usuarios" isActive={pathname?.startsWith('/admin/users') && !pathname?.includes('/bulk') && !pathname?.includes('/profiles')} />
        )}
        {hasPermission(Permission.ADMIN_USERS, orgId) && (
          <SubNavLinkItem href="/admin/users-bulk" icon={Activity} title="Carga Masiva Usuarios" isActive={pathname?.startsWith('/admin/users-bulk')} />
        )}
        {hasPermission(Permission.ADMIN_USERS, orgId) && (
          <SubNavLinkItem href="/admin/profiles" icon={UserCircle} title="Perfiles y Accesos" isActive={pathname?.startsWith('/admin/profiles')} />
        )}
        {hasPermission(Permission.ADMIN_SETTINGS, orgId) && (
          <SubNavLinkItem href="/admin/roles" icon={Scale} title="Roles y Permisos" isActive={pathname?.startsWith('/admin/roles')} />
        )}
        {hasPermission(Permission.ADMIN_COMPANIES, orgId) && (
          <SubNavLinkItem href="/admin/dashboard" icon={Building2} title="Administrar Empresas" />
        )}
        {hasPermission(Permission.ADMIN_SETTINGS, orgId) && (
          <SubNavLinkItem href="/preferences" icon={Sliders} title="Preferencias del Sistema" isActive={pathname?.startsWith('/preferences')} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}


function CompanySwitcher({ 
  selectedEntity, 
  fiscalEntities, 
  onSelect 
}: Readonly<{ 
  selectedEntity: FiscalEntity | null; 
  fiscalEntities: FiscalEntity[]; 
  onSelect: (entity: FiscalEntity) => void;
}>) {
  return (
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
                          {formatRoleLabelShort(selectedEntity)}
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
                    <p className="text-xs text-blue-200 truncate">Registra tu primera empresa</p>
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
                  onClick={() => onSelect(entity)}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <Building2 className="h-4 w-4" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{entity.rfc}</p>
                      <p className="text-xs text-gray-500 truncate">{entity.businessName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {entity.role && (
                      <Badge className="text-[10px]" variant="secondary">
                        {formatRoleLabel(entity)}
                      </Badge>
                    )}
                    {!entity.isActive && (
                      <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>
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
  )
}

function SidebarSkeleton({ isOpen }: Readonly<{ isOpen: boolean }>) {
  return (
    <div className={cn(
      "fixed inset-y-0 left-0 z-50 bg-white shadow-lg transform transition-all duration-300 ease-in-out lg:relative",
      isOpen ? "translate-x-0 lg:w-80" : "-translate-x-full lg:w-0"
    )}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 bg-gray-200 rounded-lg animate-pulse" />
            <div>
              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-1" />
              <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-4 space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
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

function SidebarHeader({ onToggle }: Readonly<{ onToggle: () => void }>) {
  return (
    <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
      <div className="flex items-center space-x-3 min-w-0">
        <div className="flex items-center justify-center">
            <div className="flex items-start">
              <span className="text-lg font-heading font-bold text-white">CFDI Task Manager</span>
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
  )
}

function UserProfile({ session, avatarUrl }: Readonly<{ session: Session | null; avatarUrl: string | null }>) {
  const resolvedAvatarUrl = session?.user?.image || avatarUrl || "/api/placeholder/32/32"
  
  const handleLogout = async () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
      document.cookie.split(";").forEach((c) => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
      await signOut({ redirect: true, callbackUrl: '/auth/signin' })
    } catch (error) {
      console.error('Error al cerrar sesión:', error)
      window.location.href = '/auth/signin'
    }
  }

  return (
    <div className="border-t border-white/10 p-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="w-full justify-start px-3 py-2 h-auto rounded-full hover:bg-white/10">
            <Avatar className="h-8 w-8 mr-3 border border-white/20">
              <AvatarImage src={resolvedAvatarUrl} alt={session?.user?.name || "User"} />
              <AvatarFallback className="bg-white/10 text-white">{session?.user?.name?.split(' ').map((n: string) => n[0]).join('') || 'U'}</AvatarFallback>
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
  )
}

function useSidebarState(session: Session | null, tenantState: TenantState | null) {
  const [fiscalEntities, setFiscalEntities] = useState<FiscalEntity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<FiscalEntity | null>(null)
  const [isClient, setIsClient] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [globalModuleFlags, setGlobalModuleFlags] = useState<FiscalEntity['moduleFlags']>(null)

  const fetchTenantCompanies = useCallback(async (signal?: AbortSignal) => {
    try {
      const companies = await fetchCompaniesApi(tenantState?.organizationId, signal);
      setFiscalEntities(companies);
      
      if (companies.length === 0) {
        setSelectedEntity(null);
        return;
      }

      const savedCompany = getSavedCompany();
      const nextSelection = determineSelectedCompany(companies, savedCompany);
      
      setSelectedEntity(prev => {
        if (prev?.id === nextSelection?.id) return prev;
        return nextSelection;
      });
    } catch (error) {
      if (isAbortError(error)) return;
      console.error('Error fetching tenant companies:', error);
      setFiscalEntities([]);
      setSelectedEntity(null);
    }
  }, [tenantState]);

  useEffect(() => {
    const id = setTimeout(() => {
      setIsClient(true)
      if (session?.user) {
        void fetchTenantCompanies()
      }
    }, 0)
    return () => clearTimeout(id)
  }, [session?.user, fetchTenantCompanies])

  useEffect(() => {
    const controller = new AbortController()
    const loadFlags = async () => {
      try {
        if (!tenantState?.organizationId) return
        const flags = await fetchMemberFlags(tenantState.organizationId, controller.signal)
        if (flags) {
          setGlobalModuleFlags(flags)
        }
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Error fetching member flags:', error)
        }
      }
    }
    void loadFlags()
    return () => controller.abort()
  }, [tenantState?.organizationId])

  useEffect(() => {
    if (selectedEntity) {
      try {
        localStorage.setItem('selectedCompany', JSON.stringify(selectedEntity))
        window.dispatchEvent(new Event('company-selected'))
        document.dispatchEvent(new Event('company-selected'))
      } catch {}
    }
  }, [selectedEntity])

  useEffect(() => {
    const refreshCompanies = () => fetchTenantCompanies()
    const refreshModules = () => {
      (async () => {
        try {
          if (!tenantState?.organizationId) return
          const flags = await fetchMemberFlags(tenantState.organizationId)
          if (flags) {
            setGlobalModuleFlags(flags)
          }
        } catch {}
      })().catch(err => console.error(err))
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
    let isMounted = true
    const fetchAvatar = async () => {
      try {
        const url = await fetchAvatarApi()
        if (isMounted && url) {
          setAvatarUrl(url)
        }
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Error fetching avatar:', error)
        }
      }
    }
    if (session?.user?.image) {
      return () => { isMounted = false }
    }
    if (session?.user) {
      void fetchAvatar()
    }
    return () => { isMounted = false }
  }, [session?.user, session?.user?.image])

  return {
    fiscalEntities,
    selectedEntity,
    setSelectedEntity,
    isClient,
    avatarUrl,
    globalModuleFlags
  }
}

export function Sidebar({ isOpen, onToggle }: Readonly<SidebarProps>) {
  const { data: session } = useSession()
  const { canAccessOperationalFeatures, tenantState } = useTenant()
  
  const {
    fiscalEntities,
    selectedEntity,
    setSelectedEntity,
    isClient,
    avatarUrl,
    globalModuleFlags
  } = useSidebarState(session, tenantState)
  
  const moduleFlags = selectedEntity?.isCustomRole && selectedEntity.moduleFlags 
    ? selectedEntity.moduleFlags 
    : globalModuleFlags

  if (!isClient) {
    return <SidebarSkeleton isOpen={isOpen} />
  }

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-75 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      <div className={cn(
        "fixed inset-y-0 left-0 z-50 bg-gradient-to-b from-primary to-[#0f172a] text-primary-foreground border-r border-primary/20 transform transition-all duration-300 ease-in-out lg:relative flex flex-col overflow-hidden",
        isOpen ? "translate-x-0 lg:w-80" : "-translate-x-full lg:w-0"
      )}>
        <SidebarHeader onToggle={onToggle} />

        <CompanySwitcher 
          selectedEntity={selectedEntity} 
          fiscalEntities={fiscalEntities} 
          onSelect={setSelectedEntity} 
        />

        <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
          {!canAccessOperationalFeatures() && (
            <TenantNavigation />
          )}
          
          {canAccessOperationalFeatures() && (
            <>
              <MainNavigation moduleFlags={moduleFlags} />
              <AdminNavigation />
            </>
          )}
        </nav>

        <UserProfile session={session} avatarUrl={avatarUrl} />
      </div>
    </>
  )
}

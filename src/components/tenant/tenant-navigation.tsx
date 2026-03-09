'use client'

import { useTenant } from '@/hooks/use-tenant'
import { usePermissions } from '@/hooks/use-permissions'
import { Permission } from '@/lib/permissions'
import { useCompanyAccess } from '@/hooks/use-company-access'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { 
  Users, 
  Settings, 
  Plus,
  UserCheck,
  Edit3,
  ChevronDown,
  ChevronRight,
  ListChecks
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useState } from 'react'

interface NavItem {
  title: string
  icon: LucideIcon
  href: string
  variant?: 'default' | 'ghost'
  requiresOperationalAccess?: boolean
  requiresOwner?: boolean
}

export function TenantNavigation() {
  const { tenantState, canAccessOperationalFeatures, isTenantOwner } = useTenant()
  const { hasAnyPermission, user } = usePermissions()
  const { hasAccess: hasCompanyAssignedAccess } = useCompanyAccess()
  const pathname = usePathname()
  const [orgOpen, setOrgOpen] = useState(false)

  const isActive = (href: string) => {
    return pathname === href || pathname.startsWith(href + '/')
  }

  const isTenantAdmin = (): boolean => {
    const orgId = tenantState?.organizationId
    const isOrgAdminMember = Boolean(user?.memberships?.find(m => m.organizationId === orgId && m.role === 'ADMIN'))
    return isTenantOwner() || isOrgAdminMember
  }

  const hasCompanyAccess = (): boolean => {
    const orgId = tenantState?.organizationId
    const permissionOk = hasAnyPermission([
      Permission.COMPANY_READ,
      Permission.INVOICE_READ
    ], orgId)
    return permissionOk && hasCompanyAssignedAccess
  }

  const canAccess = (item: NavItem): boolean => {
    if (item.requiresOperationalAccess && !canAccessOperationalFeatures()) {
      return false
    }
    if (item.requiresOwner && !isTenantAdmin()) {
      return false
    }
    return true
  }

  const navItems: NavItem[] = [
    {
      title: 'Progreso de Configuración',
      icon: ListChecks,
      href: '/tenant/dashboard',
    },
    {
      title: 'Mi Organización',
      icon: Edit3,
      href: '/tenant/management',
      requiresOwner: true
    },
    {
      title: 'Registrar Empresas',
      icon: Plus,
      href: '/companies'
    },
    {
      title: 'Usuarios',
      icon: Users,
      href: '/admin/users',
      requiresOwner: true
    },
    {
      title: 'Perfiles',
      icon: UserCheck,
      href: '/admin/profiles',
      requiresOwner: true
    },
    {
      title: 'Configuración del Sistema',
      icon: Settings,
      href: '/settings',
      requiresOwner: true
    },
    // Extra: Dashboard Fiscal de empresa si tiene acceso a compañía
    ...(hasCompanyAccess() ? [] : [])
  ]

  const filteredItems = navItems.filter(canAccess)

  return (
    <TooltipProvider>
      <nav className="grid gap-1 px-0">
        {(() => {
          const orgTitles = new Set([
            'Progreso de Configuración',
            'Mi Organización',
            'Registrar Empresas',
            'Usuarios',
            'Perfiles',
            'Configuración del Sistema'
          ])
          const orgItems = filteredItems.filter(i => orgTitles.has(i.title))
          const extraItems = filteredItems.filter(i => !orgTitles.has(i.title))
          return (
            <>
              <Collapsible open={orgOpen} onOpenChange={setOrgOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-start px-3">
                  <Settings className="mr-3 h-5 w-5" />
                  <span className="flex-1 text-left">Administración de la<br />Organización</span>
                  {orgOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
                <CollapsibleContent className="ml-6 space-y-1 mt-1 border-l border-white/10 pl-2">
                  {orgItems.map((item, index) => (
                    <Link
                      key={`org-${index}`}
                      href={item.href}
                      className={cn(
                        'flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200',
                        isActive(item.href)
                          ? "bg-white/20 text-white font-semibold shadow-inner"
                          : "text-blue-200 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  ))}
                </CollapsibleContent>
              </Collapsible>

              {extraItems.map((item, index) => (
                <Tooltip key={`extra-${index}`}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        buttonVariants({ variant: item.variant || 'ghost', size: 'sm' }),
                        'justify-start w-full',
                        isActive(item.href) && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {item.title}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.title}
                  </TooltipContent>
                </Tooltip>
              ))}
            </>
          )
        })()}
      </nav>
    </TooltipProvider>
  )
}

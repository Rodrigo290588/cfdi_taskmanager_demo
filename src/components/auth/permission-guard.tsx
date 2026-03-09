'use client'

import { ReactNode } from 'react'
import { Permission } from '@/lib/permissions'
import { usePermission, useAdmin, useSuperAdmin } from '@/hooks/use-permissions'

interface PermissionGuardProps {
  permission: Permission
  organizationId?: string
  fallback?: ReactNode
  children: ReactNode
}

export function PermissionGuard({ permission, organizationId, fallback, children }: PermissionGuardProps) {
  const hasPermission = usePermission(permission, organizationId)
  
  if (!hasPermission) {
    return fallback || null
  }
  
  return <>{children}</>
}

interface PermissionRequiredProps {
  permission: Permission
  organizationId?: string
  children: ReactNode
}

export function PermissionRequired({ permission, organizationId, children }: PermissionRequiredProps) {
  const hasPermission = usePermission(permission, organizationId)
  
  if (!hasPermission) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-2xl mb-2">🔒</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Acceso Denegado</h3>
          <p className="text-gray-600">No tienes permisos para acceder a esta funcionalidad.</p>
        </div>
      </div>
    )
  }
  
  return <>{children}</>
}

interface AdminOnlyProps {
  children: ReactNode
  fallback?: ReactNode
}

export function AdminOnly({ children, fallback }: AdminOnlyProps) {
  const isAdmin = useAdmin()
  
  if (!isAdmin) {
    return fallback || null
  }
  
  return <>{children}</>
}

interface SuperAdminOnlyProps {
  children: ReactNode
  fallback?: ReactNode
}

export function SuperAdminOnly({ children, fallback }: SuperAdminOnlyProps) {
  const isSuperAdmin = useSuperAdmin()
  
  if (!isSuperAdmin) {
    return fallback || null
  }
  
  return <>{children}</>
}
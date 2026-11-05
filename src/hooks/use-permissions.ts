import { useSession } from 'next-auth/react'
import { hasPermission, hasAnyPermission, hasAllPermissions, getUserPermissions, isAdmin, isSuperAdmin, Permission } from '@/lib/permissions'
import { User } from '@/lib/permissions'
import { useTenant } from '@/hooks/use-tenant'

export function usePermissions() {
  const { data: session } = useSession()
  const { tenantState } = useTenant()
  const activeOrgId = tenantState?.organizationId
  
  const user: User | null = session?.user ? {
    id: session.user.id,
    systemRole: session.user.systemRole,
    memberships: session.user.memberships
  } : null

  return {
    hasPermission: (permission: Permission, organizationId?: string) => 
      hasPermission(user, permission, organizationId || activeOrgId),
    
    hasAnyPermission: (permissions: Permission[], organizationId?: string) => 
      hasAnyPermission(user, permissions, organizationId || activeOrgId),
    
    hasAllPermissions: (permissions: Permission[], organizationId?: string) => 
      hasAllPermissions(user, permissions, organizationId || activeOrgId),
    
    getUserPermissions: (organizationId?: string) => 
      getUserPermissions(user, organizationId || activeOrgId),
    
    isAdmin: () => isAdmin(user),
    isSuperAdmin: () => isSuperAdmin(user),
    canAccessAdminPanel: (organizationId?: string) => hasPermission(user, Permission.ADMIN_DASHBOARD, organizationId || activeOrgId),
    
    user
  }
}

export function usePermission(permission: Permission, organizationId?: string) {
  const { hasPermission } = usePermissions()
  return hasPermission(permission, organizationId)
}

export function useAdmin() {
  const { isAdmin } = usePermissions()
  return isAdmin()
}

export function useSuperAdmin() {
  const { isSuperAdmin } = usePermissions()
  return isSuperAdmin()
}


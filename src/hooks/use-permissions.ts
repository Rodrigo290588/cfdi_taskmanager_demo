import { useSession } from 'next-auth/react'
import { hasPermission, hasAnyPermission, hasAllPermissions, getUserPermissions, isAdmin, isSuperAdmin, canAccessAdminPanel, Permission } from '@/lib/permissions'
import { User } from '@/lib/permissions'

export function usePermissions() {
  const { data: session } = useSession()
  
  const user: User | null = session?.user ? {
    id: session.user.id,
    systemRole: session.user.systemRole,
    memberships: session.user.memberships
  } : null

  return {
    hasPermission: (permission: Permission, organizationId?: string) => 
      hasPermission(user, permission, organizationId),
    
    hasAnyPermission: (permissions: Permission[], organizationId?: string) => 
      hasAnyPermission(user, permissions, organizationId),
    
    hasAllPermissions: (permissions: Permission[], organizationId?: string) => 
      hasAllPermissions(user, permissions, organizationId),
    
    getUserPermissions: (organizationId?: string) => 
      getUserPermissions(user, organizationId),
    
    isAdmin: () => isAdmin(user),
    isSuperAdmin: () => isSuperAdmin(user),
    canAccessAdminPanel: () => canAccessAdminPanel(user),
    
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

import { SystemRole, MemberRole } from '@prisma/client'

export interface User {
  id: string
  systemRole: SystemRole
  memberships?: Array<{
    organizationId: string
    role: MemberRole
  }>
}

export enum Permission {
  // Company permissions
  COMPANY_CREATE = 'company:create',
  COMPANY_READ = 'company:read',
  COMPANY_UPDATE = 'company:update',
  COMPANY_DELETE = 'company:delete',
  COMPANY_APPROVE = 'company:approve',
  COMPANY_REJECT = 'company:reject',
  
  // User permissions
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  
  // Organization permissions
  ORG_CREATE = 'org:create',
  ORG_READ = 'org:read',
  ORG_UPDATE = 'org:update',
  ORG_DELETE = 'org:delete',
  
  // Invoice permissions
  INVOICE_CREATE = 'invoice:create',
  INVOICE_READ = 'invoice:read',
  INVOICE_UPDATE = 'invoice:update',
  INVOICE_DELETE = 'invoice:delete',
  INVOICE_CANCEL = 'invoice:cancel',
  
  // Admin permissions
  ADMIN_DASHBOARD = 'admin:dashboard',
  ADMIN_USERS = 'admin:users',
  ADMIN_COMPANIES = 'admin:companies',
  ADMIN_ORGANIZATIONS = 'admin:organizations',
  ADMIN_SETTINGS = 'admin:settings',
  ADMIN_AUDIT = 'admin:audit'
  ,
  // Module view permissions
  MODULE_EMISSION_VIEW = 'module:emission:view',
  MODULE_RECEPTION_VIEW = 'module:reception:view',
  MODULE_PAYROLL_VIEW = 'module:payroll:view',
  MODULE_SAT_PORTAL_VIEW = 'module:sat_portal:view',
  MODULE_ORG_ADMIN_VIEW = 'module:org_admin:view',
  MODULE_MASS_DOWNLOADS_VIEW = 'module:mass_downloads:view'
}

const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  [SystemRole.SUPER_ADMIN]: [
    // All permissions
    Permission.COMPANY_CREATE,
    Permission.COMPANY_READ,
    Permission.COMPANY_UPDATE,
    Permission.COMPANY_DELETE,
    Permission.COMPANY_APPROVE,
    Permission.COMPANY_REJECT,
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DELETE,
    Permission.ORG_CREATE,
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.ORG_DELETE,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_UPDATE,
    Permission.INVOICE_DELETE,
    Permission.INVOICE_CANCEL,
    Permission.ADMIN_DASHBOARD,
    Permission.ADMIN_USERS,
    Permission.ADMIN_COMPANIES,
    Permission.ADMIN_ORGANIZATIONS,
    Permission.ADMIN_SETTINGS,
    Permission.ADMIN_AUDIT,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_ORG_ADMIN_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW
  ],
  [SystemRole.ADMIN]: [
    Permission.COMPANY_CREATE,
    Permission.COMPANY_READ,
    Permission.COMPANY_UPDATE,
    Permission.COMPANY_APPROVE,
    Permission.COMPANY_REJECT,
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.ORG_CREATE,
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_UPDATE,
    Permission.INVOICE_CANCEL,
    Permission.ADMIN_DASHBOARD,
    Permission.ADMIN_USERS,
    Permission.ADMIN_COMPANIES,
    Permission.ADMIN_ORGANIZATIONS,
    Permission.ADMIN_SETTINGS,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_ORG_ADMIN_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW
  ],
  [SystemRole.COMPANY_ADMIN]: [
    Permission.COMPANY_CREATE,
    Permission.COMPANY_READ,
    Permission.COMPANY_UPDATE,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_UPDATE,
    Permission.INVOICE_CANCEL,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_ORG_ADMIN_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW
  ],
  [SystemRole.USER]: [
    Permission.COMPANY_READ,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_UPDATE,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW
  ]
}

const ORGANIZATION_ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  [MemberRole.ADMIN]: [
    Permission.COMPANY_CREATE,
    Permission.COMPANY_READ,
    Permission.COMPANY_UPDATE,
    Permission.COMPANY_DELETE,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_UPDATE,
    Permission.INVOICE_DELETE,
    Permission.INVOICE_CANCEL,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_ORG_ADMIN_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW
  ],
  [MemberRole.AUDITOR]: [
    Permission.COMPANY_READ,
    Permission.INVOICE_READ,
    Permission.ADMIN_AUDIT,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW
  ],
  [MemberRole.VIEWER]: [
    Permission.COMPANY_READ,
    Permission.INVOICE_READ,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW
  ]
}

export function hasPermission(
  user: User | null,
  permission: Permission,
  organizationId?: string
): boolean {
  if (!user) return false

  // System-level permissions
  const systemPermissions = SYSTEM_ROLE_PERMISSIONS[user.systemRole] || []
  if (systemPermissions.includes(permission)) {
    return true
  }

  // Organization-level permissions (if organizationId is provided)
  if (organizationId && user.memberships) {
    const membership = user.memberships.find(m => m.organizationId === organizationId)
    if (membership) {
      const orgPermissions = ORGANIZATION_ROLE_PERMISSIONS[membership.role] || []
      return orgPermissions.includes(permission)
    }
  }

  return false
}

export function hasAnyPermission(
  user: User | null,
  permissions: Permission[],
  organizationId?: string
): boolean {
  return permissions.some(permission => hasPermission(user, permission, organizationId))
}

export function hasAllPermissions(
  user: User | null,
  permissions: Permission[],
  organizationId?: string
): boolean {
  return permissions.every(permission => hasPermission(user, permission, organizationId))
}

export function getUserPermissions(user: User | null, organizationId?: string): Permission[] {
  if (!user) return []

  const permissions = new Set<Permission>()

  // Add system-level permissions
  const systemPermissions = SYSTEM_ROLE_PERMISSIONS[user.systemRole] || []
  systemPermissions.forEach(p => permissions.add(p))

  // Add organization-level permissions (if organizationId is provided)
  if (organizationId && user.memberships) {
    const membership = user.memberships.find(m => m.organizationId === organizationId)
    if (membership) {
      const orgPermissions = ORGANIZATION_ROLE_PERMISSIONS[membership.role] || []
      orgPermissions.forEach(p => permissions.add(p))
    }
  }

  return Array.from(permissions)
}

export function isAdmin(user: User | null): boolean {
  if (!user) return false
  return user.systemRole === SystemRole.SUPER_ADMIN || user.systemRole === SystemRole.ADMIN
}

export function isSuperAdmin(user: User | null): boolean {
  if (!user) return false
  return user.systemRole === SystemRole.SUPER_ADMIN
}

export function canAccessAdminPanel(user: User | null): boolean {
  return hasPermission(user, Permission.ADMIN_DASHBOARD)
}

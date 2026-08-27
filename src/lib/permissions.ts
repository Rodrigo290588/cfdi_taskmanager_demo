import { SystemRole, MemberRole } from '@prisma/client'
import type { Member, Organization } from '@prisma/client'
import { prisma } from './prisma'

export interface User {
  id: string
  systemRole: SystemRole
  memberships?: Array<{
    organizationId: string
    role: MemberRole
    status?: string
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
  MODULE_MASS_DOWNLOADS_VIEW = 'module:mass_downloads:view',

  // CFDI Import / Bulk permissions (SAST-FIX API-01 / API-09 / API-12)
  CFDI_IMPORT_BATCH = 'cfdi:import:batch',
  CFDI_DOWNLOAD_MASSIVE = 'cfdi:download:massive',
  CFDI_VIEW_PDF = 'cfdi:view:pdf',
  CFDI_FIEL_CREDENTIALS = 'cfdi:fiel:credentials',

  // Dashboard Fiscal + View Audit (Regla 10: Gestión Dinámica Permisos)
  DASHBOARD_FISCAL_VIEW = 'dashboard:fiscal:view',
  DASHBOARD_FISCAL_EXPORT = 'dashboard:fiscal:export',
  VIEW_AUDIT_LOGS = 'admin:audit:view_logs',
  // Dashboard Recibidos - Auditoría PII granular (DR-010)
  RECEP_FISCAL_AUDIT_PII = 'reception:fiscal:audit_pii',
  // Mass Downloads - Solicitud de Descarga Masiva al SAT (MD-003 fix)
  CFDI_REQUEST_MASSIVE = 'cfdi:request:massive',
  // Provider Portal granular (PROV-001 BOLA role-less fix)
  PROVIDER_PORTAL_VIEW = 'provider:portal:view',
  PROVIDER_PORTAL_UPLOAD = 'provider:portal:upload',
  // RFC Validate granular (RFC-001 BOLA público sin auth fix)
  RFC_VALIDATE_VIEW = 'rfc:validate:view',
  // SAT Import Demo (SAT-001 Seeder expuesto DEV-only fix)
  SAT_IMPORT_DEMO = 'sat:import:demo',
  // SAT CFDIs Dashboard View/Export (SATCFDIS-002 role-less access fix)
  SAT_CFDIS_VIEW = 'sat:cfdis:view',
  SAT_CFDIS_EXPORT = 'sat:cfdis:export',
  // Tenant / Onboarding (Fixes TEN-002/004 + SAST FASE2 /api/tenant/**)
  TENANT_VIEW = 'tenant:view',
  TENANT_MANAGE = 'tenant:manage',
  TENANT_API_KEY_MANAGE = 'tenant:apikey:manage',
  TENANT_DIRECTORY_VIEW = 'tenant:directory:view',
  // INV-009 FIXED: Nómina salarial viewer tier separation (LFPDPPP Art. 123)
  NOMINA_VIEW_SALARIES = 'nomina:view-salaries',
}

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
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
    Permission.MODULE_MASS_DOWNLOADS_VIEW,
    Permission.CFDI_IMPORT_BATCH,
    Permission.CFDI_DOWNLOAD_MASSIVE,
    Permission.CFDI_VIEW_PDF,
    Permission.CFDI_FIEL_CREDENTIALS,
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.DASHBOARD_FISCAL_EXPORT,
    Permission.VIEW_AUDIT_LOGS,
    Permission.RECEP_FISCAL_AUDIT_PII,
    Permission.CFDI_REQUEST_MASSIVE,
    Permission.PROVIDER_PORTAL_VIEW,
    Permission.PROVIDER_PORTAL_UPLOAD,
    Permission.RFC_VALIDATE_VIEW,
    Permission.SAT_IMPORT_DEMO,
    Permission.SAT_CFDIS_VIEW,
    Permission.SAT_CFDIS_EXPORT,
    Permission.TENANT_VIEW,
    Permission.TENANT_MANAGE,
    Permission.TENANT_API_KEY_MANAGE,
    Permission.TENANT_DIRECTORY_VIEW,
    Permission.NOMINA_VIEW_SALARIES,
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
    Permission.MODULE_MASS_DOWNLOADS_VIEW,
    Permission.CFDI_IMPORT_BATCH,
    Permission.CFDI_DOWNLOAD_MASSIVE,
    Permission.CFDI_VIEW_PDF,
    Permission.CFDI_FIEL_CREDENTIALS,
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.DASHBOARD_FISCAL_EXPORT,
    Permission.VIEW_AUDIT_LOGS,
    Permission.RECEP_FISCAL_AUDIT_PII,
    Permission.CFDI_REQUEST_MASSIVE,
    Permission.PROVIDER_PORTAL_VIEW,
    Permission.PROVIDER_PORTAL_UPLOAD,
    Permission.RFC_VALIDATE_VIEW,
    Permission.SAT_IMPORT_DEMO,
    Permission.SAT_CFDIS_VIEW,
    Permission.SAT_CFDIS_EXPORT,
    Permission.TENANT_VIEW,
    Permission.TENANT_MANAGE,
    Permission.TENANT_API_KEY_MANAGE,
    Permission.TENANT_DIRECTORY_VIEW,
    Permission.NOMINA_VIEW_SALARIES,
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
    Permission.MODULE_MASS_DOWNLOADS_VIEW,
    Permission.CFDI_IMPORT_BATCH,
    Permission.CFDI_DOWNLOAD_MASSIVE,
    Permission.CFDI_VIEW_PDF,
    Permission.CFDI_FIEL_CREDENTIALS,
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.DASHBOARD_FISCAL_EXPORT,
    Permission.VIEW_AUDIT_LOGS,
    Permission.RECEP_FISCAL_AUDIT_PII,
    Permission.CFDI_REQUEST_MASSIVE,
    Permission.PROVIDER_PORTAL_VIEW,
    Permission.PROVIDER_PORTAL_UPLOAD,
    Permission.RFC_VALIDATE_VIEW,
    Permission.SAT_CFDIS_VIEW,
    Permission.TENANT_VIEW,
    Permission.TENANT_MANAGE,
    Permission.TENANT_API_KEY_MANAGE,
    Permission.TENANT_DIRECTORY_VIEW,
    Permission.NOMINA_VIEW_SALARIES,
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
    Permission.MODULE_MASS_DOWNLOADS_VIEW,
    Permission.CFDI_VIEW_PDF,
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.RECEP_FISCAL_AUDIT_PII,
    Permission.PROVIDER_PORTAL_VIEW,
    Permission.PROVIDER_PORTAL_UPLOAD,
    Permission.RFC_VALIDATE_VIEW,
    Permission.SAT_CFDIS_VIEW,
    Permission.TENANT_VIEW,
  ]
}

export const ORGANIZATION_ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  [MemberRole.ADMIN]: [
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
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
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
    Permission.MODULE_MASS_DOWNLOADS_VIEW,
    Permission.CFDI_IMPORT_BATCH,
    Permission.CFDI_DOWNLOAD_MASSIVE,
    Permission.CFDI_VIEW_PDF,
    Permission.CFDI_FIEL_CREDENTIALS,
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.DASHBOARD_FISCAL_EXPORT,
    Permission.VIEW_AUDIT_LOGS,
    Permission.RECEP_FISCAL_AUDIT_PII,
    Permission.CFDI_REQUEST_MASSIVE,
    Permission.PROVIDER_PORTAL_VIEW,
    Permission.PROVIDER_PORTAL_UPLOAD,
    Permission.RFC_VALIDATE_VIEW,
    Permission.SAT_IMPORT_DEMO,
    Permission.SAT_CFDIS_VIEW,
    Permission.SAT_CFDIS_EXPORT,
    Permission.TENANT_VIEW,
    Permission.TENANT_MANAGE,
    Permission.TENANT_API_KEY_MANAGE,
    Permission.TENANT_DIRECTORY_VIEW,
    Permission.NOMINA_VIEW_SALARIES,
  ],
  [MemberRole.AUDITOR]: [
    Permission.COMPANY_READ,
    Permission.ORG_READ,
    Permission.INVOICE_READ,
    Permission.ADMIN_DASHBOARD,
    Permission.ADMIN_AUDIT,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW,
    Permission.CFDI_VIEW_PDF,
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.VIEW_AUDIT_LOGS,
    Permission.RECEP_FISCAL_AUDIT_PII,
    Permission.TENANT_VIEW,
  ],
  [MemberRole.VIEWER]: [
    Permission.COMPANY_READ,
    Permission.ORG_READ,
    Permission.INVOICE_READ,
    Permission.MODULE_EMISSION_VIEW,
    Permission.MODULE_RECEPTION_VIEW,
    Permission.MODULE_PAYROLL_VIEW,
    Permission.MODULE_SAT_PORTAL_VIEW,
    Permission.MODULE_MASS_DOWNLOADS_VIEW,
    Permission.CFDI_VIEW_PDF,
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.RECEP_FISCAL_AUDIT_PII,
    Permission.TENANT_VIEW,
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

// COMPANIES-001/003/004/005 · Helpers de Tenant Scoping y BOLA Protection
// Centralizan la lógica de acceso a compañías para no duplicarla en cada route handler.

export interface UserWithMemberships {
  id: string
  systemRole: SystemRole
}

export interface CompanyAccessDecision {
  allowed: boolean
  /** OrganizationId asociado a la compañía (si existe acceso por membership) */
  organizationId?: string
  /** Rol de membresía dentro de esa org (ADMIN/AUDITOR/VIEWER si aplica) */
  memberRole?: MemberRole
  /** True si el acceso fue vía SUPER_ADMIN bypass */
  isSuperAdminBypass?: boolean
}

/**
 * Auto-fetchea memberships si el caller se las omitió y retorna el User enriquecido
 * listo para pasar a hasPermission(). Evita bug COMPANIES-001 donde se pasaba
 * `{id, systemRole}` sin memberships y hasPermission() daba false negativo en ORG_ROLE_PERMISSIONS.
 */
export async function enrichUserWithMemberships(user: UserWithMemberships): Promise<User> {
  const full = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      systemRole: true,
      memberships: {
        where: { status: 'APPROVED' },
        orderBy: { createdAt: 'asc' },
        select: { organizationId: true, role: true, status: true }
      }
    }
  })
  if (!full) return { id: user.id, systemRole: user.systemRole, memberships: [] }
  type MemberRow = { organizationId: string; role: unknown; status: string }
  return {
    id: full.id,
    systemRole: full.systemRole,
    memberships: full.memberships
      .filter((m: MemberRow) => m.status === 'APPROVED')
      .map((m: MemberRow) => ({ organizationId: m.organizationId, role: m.role as MemberRole, status: m.status as 'APPROVED' | 'PENDING' | 'REJECTED' }))
  }
}

/**
 * COMPANIES-003/004/005 · Valida si un usuario puede operar sobre una compañía concreta.
 * Reglas:
 *  - SUPER_ADMIN: bypass global (allowed + isSuperAdminBypass=true)
 *  - Resto: requiere row en CompanyAccess con member.status=APPROVED
 *  - Nunca retorna 404 vs 403 distinto (devolución uniforme para evitar enumeración)
 */
export async function canUserAccessCompany(
  userId: string,
  systemRole: SystemRole,
  companyId: string
): Promise<CompanyAccessDecision> {
  if (systemRole === SystemRole.SUPER_ADMIN) {
    return { allowed: true, isSuperAdminBypass: true }
  }

  const access = await prisma.companyAccess.findFirst({
    where: {
      companyId,
      member: { userId, status: 'APPROVED' }
    },
    select: {
      organizationId: true,
      member: { select: { role: true } }
    }
  })

  if (!access) return { allowed: false }
  return {
    allowed: true,
    organizationId: access.organizationId,
    memberRole: access.member.role
  }
}

/**
 * Obtiene los IDs de las compañías a las que el usuario tiene acceso,
 * para aplicar directamente como `where.id.in([])` en búsquedas.
 * - SUPER_ADMIN: retorna null (sin filtro = todas, caller debe decidir si permite global o no)
 * - Owner/Admin Org: compañías creadas por cualquier miembro APPROVED de sus orgs + accesos directos
 * - Viewer/Auditor: solo compañías con CompanyAccess explícito
 */
export async function getAccessibleCompanyIds(userId: string, systemRole: SystemRole): Promise<string[] | null> {
  if (systemRole === SystemRole.SUPER_ADMIN) return null

  const userOrgs = await prisma.member.findMany({
    where: { userId, status: 'APPROVED' },
    select: { organizationId: true, role: true }
  })
  if (userOrgs.length === 0) return []

  const elevatedOrgIds = userOrgs
    .filter(m => m.role === MemberRole.ADMIN)
    .map(m => m.organizationId)

  const resultIds = new Set<string>()

  if (elevatedOrgIds.length > 0) {
    const elevatedMembers = await prisma.member.findMany({
      where: { organizationId: { in: elevatedOrgIds }, status: 'APPROVED' },
      select: { userId: true }
    })
    const elevatedUserIds = elevatedMembers.map(m => m.userId)
    const companiesByOwners = await prisma.company.findMany({
      where: { createdBy: { in: elevatedUserIds } },
      select: { id: true }
    })
    for (const c of companiesByOwners) resultIds.add(c.id)
  }

  const directAccesses = await prisma.companyAccess.findMany({
    where: { member: { userId, status: 'APPROVED' } },
    select: { companyId: true }
  })
  for (const a of directAccesses) resultIds.add(a.companyId)

  return Array.from(resultIds)
}

// DASHBOARD-001 / DASHBOARD-002 / DASHBOARD-003 / DASHBOARD-004
// Helpers UNIFICADOS para las 14 rutas de /api/dashboard_fiscal/**.
// NO se debe hacer prisma.company.findUnique ni prisma.invoice.findMany SIN antes llamar
// a estas funciones: garantizan status=APPROVED + BOLA CompanyAccess + org scope.

export interface ScopedDashboardContext {
  memberId: string
  memberRole: MemberRole
  organizationId: string
  organization: Organization
  /** Si se solicitó companyId: contiene el valor exacto aprobado por canUserAccessCompany. */
  companyId?: string | null
  /** fiscalEntity.organizationId === organizationId asegurado */
  fiscalEntityId?: string | null
  userSystemRole: SystemRole
  enrichedUser: User
}

export class DashboardForbiddenError extends Error {
  readonly statusCode = 403
  readonly code = 'DASHBOARD_FORBIDDEN'
  constructor(msg: string = 'Sin acceso al dashboard fiscal') {
    super(msg)
    this.name = 'DashboardForbiddenError'
  }
}

export class DashboardMissingParamError extends Error {
  readonly statusCode = 400
  readonly code = 'DASHBOARD_BAD_REQUEST'
  constructor(msg: string) { super(msg); this.name = 'DashboardMissingParamError' }
}

/**
 * Valida member.status=APPROVED + scopes de org + companyId + Permission.
 * @returns ScopedDashboardContext con org, role, enriched listo para WHERE queries.
 */
export async function requireApprovedDashboardAccess(
  sessionUserId: string | null | undefined,
  sessionSystemRole: SystemRole,
  opts: {
    companyId?: string | null
    organizationId?: string | null
    /** Permission a validar con hasPermission. Default DASHBOARD_FISCAL_VIEW */
    permission?: Permission
  } = {}
): Promise<ScopedDashboardContext> {
  if (!sessionUserId) throw new DashboardForbiddenError('Sesión no autenticada')
  const permission = opts.permission ?? Permission.DASHBOARD_FISCAL_VIEW

  // 1. Enrich memberships (resuelve bug COMPANIES-001 sin memberships en user)
  const enrichedUser = await enrichUserWithMemberships({ id: sessionUserId, systemRole: sessionSystemRole })

  // 2. Si nos envía organizationId -> buscamos la membresía EXACTA y OBLIGATORIAMENTE.
  //    Fixes DASHBOARD-004 (random pick multi-org si ?orgId omitido).
  let membership: (Member & { organization: Organization }) | null = null
  if (opts.organizationId) {
    membership = (await prisma.member.findFirst({
      where: { userId: sessionUserId, status: 'APPROVED', organizationId: opts.organizationId },
      include: { organization: true }
    })) as (Member & { organization: Organization }) | null
  } else {
    // Default = orden ASC por createdAt (primera suscripción del usuario).
    membership = (await prisma.member.findFirst({
      where: { userId: sessionUserId, status: 'APPROVED' },
      include: { organization: true },
      orderBy: { createdAt: 'asc' }
    })) as (Member & { organization: Organization }) | null
  }
  if (!membership) throw new DashboardForbiddenError('Membresía no encontrada / No APPROVED en la organización solicitada')

  // 3. Permission check granular (Regla 10 / DASHBOARD-009).
  if (!hasPermission(enrichedUser, permission, membership.organizationId)) {
    throw new DashboardForbiddenError(`Permiso faltante: ${permission}`)
  }

  // 4. Si nos envía companyId -> BOLA guard (DASHBOARD-001 / DASHBOARD-003).
  let fiscalEntityId: string | null = null
  if (opts.companyId) {
    const accessDecision = await canUserAccessCompany(sessionUserId, sessionSystemRole, opts.companyId)
    if (!accessDecision.allowed) throw new DashboardForbiddenError('Sin acceso a compañía (cross-tenant)')
    // Coherencia: la compañía solicitada debe pertenecer a la misma org que la membership resuelta
    if (accessDecision.organizationId && accessDecision.organizationId !== membership.organizationId) {
      throw new DashboardForbiddenError('Compañía no pertenece a la organización de la membresía activa')
    }
    // Resolver fiscalEntityId desde company.rfc para queries scoped.
    const company = await prisma.company.findUnique({ where: { id: opts.companyId }, select: { rfc: true } })
    if (company?.rfc) {
      const fe = await prisma.fiscalEntity.findFirst({
        where: { rfc: company.rfc, organizationId: membership.organizationId },
        select: { id: true }
      })
      fiscalEntityId = fe?.id ?? null
    }
  }

  return {
    memberId: membership.id,
    memberRole: membership.role,
    organizationId: membership.organizationId,
    organization: membership.organization,
    companyId: opts.companyId ?? null,
    fiscalEntityId,
    userSystemRole: sessionSystemRole,
    enrichedUser
  }
}

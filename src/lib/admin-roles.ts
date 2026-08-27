import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

export const SYSTEM_ROLE_IDS = ['ADMIN', 'AUDITOR', 'VIEWER'] as const
export type SystemRoleId = typeof SYSTEM_ROLE_IDS[number]

export interface ResolvedRole {
  systemRole: 'ADMIN' | 'AUDITOR' | 'VIEWER'
  customRoleId: string | null
}

export type SystemRoleOverride = {
  canViewEmission: boolean
  canViewReception: boolean
  canViewPayroll: boolean
  canViewSatPortal: boolean
  canViewMassDownloads: boolean
  canManageOrg: boolean
  granularPermissions: Record<string, boolean>
}

const DEFAULT_OVERRIDES: Record<SystemRoleId, SystemRoleOverride> = {
  ADMIN: {
    canViewEmission: true,
    canViewReception: true,
    canViewPayroll: true,
    canViewSatPortal: true,
    canViewMassDownloads: true,
    canManageOrg: true,
    granularPermissions: {
      emissionDashboard: true,
      emissionWorkpaper: true,
      emissionPartial: true,
      emissionCancelations: true,
      receptionDashboard: true,
      receptionFiscalAudit: true,
      receptionCancellationAlerts: true,
      receptionBusinessRules: true,
      receptionBusinessRulePueForma99: true,
      receptionBusinessRuleResicoRetention: true,
      receptionBusinessRuleObjetoImpVsIva: true,
      receptionWorkpaper: true,
      payrollDashboard: true,
      payrollReceipts: true,
      satConnection: true,
      satCfdiStatus: true,
      massKeys: true,
      massRequests: true,
      massVerification: true,
      massPackages: true,
      massPanel: true,
      orgCompanies: true,
      orgUsers: true,
      orgProfiles: true,
      orgRoles: true,
      orgSettings: true,
      providerDashboard: true,
      providerPaymentsUpdate: true,
      providerBusinessRules: true,
      providerBusinessRulePueForma99: false,
      providerBusinessRuleResicoRetention: false,
      providerBusinessRuleObjetoImpVsIva: false
    }
  },
  AUDITOR: {
    canViewEmission: true,
    canViewReception: true,
    canViewPayroll: true,
    canViewSatPortal: true,
    canViewMassDownloads: true,
    canManageOrg: false,
    granularPermissions: {
      emissionDashboard: true,
      emissionWorkpaper: true,
      emissionPartial: true,
      emissionCancelations: true,
      receptionDashboard: true,
      receptionFiscalAudit: true,
      receptionCancellationAlerts: true,
      receptionBusinessRules: true,
      receptionBusinessRulePueForma99: true,
      receptionBusinessRuleResicoRetention: true,
      receptionBusinessRuleObjetoImpVsIva: true,
      receptionWorkpaper: true,
      payrollDashboard: true,
      payrollReceipts: true,
      satConnection: true,
      satCfdiStatus: true,
      massKeys: false,
      massRequests: true,
      massVerification: true,
      massPackages: true,
      massPanel: true,
      orgCompanies: false,
      orgUsers: false,
      orgProfiles: false,
      orgRoles: false,
      orgSettings: false,
      providerDashboard: true,
      providerPaymentsUpdate: true,
      providerBusinessRules: true,
      providerBusinessRulePueForma99: false,
      providerBusinessRuleResicoRetention: false,
      providerBusinessRuleObjetoImpVsIva: false
    }
  },
  VIEWER: {
    canViewEmission: true,
    canViewReception: true,
    canViewPayroll: true,
    canViewSatPortal: true,
    canViewMassDownloads: true,
    canManageOrg: false,
    granularPermissions: {
      emissionDashboard: true,
      emissionWorkpaper: false,
      emissionPartial: false,
      emissionCancelations: false,
      receptionDashboard: true,
      receptionFiscalAudit: true,
      receptionCancellationAlerts: true,
      receptionBusinessRules: true,
      receptionBusinessRulePueForma99: true,
      receptionBusinessRuleResicoRetention: true,
      receptionBusinessRuleObjetoImpVsIva: true,
      receptionWorkpaper: false,
      payrollDashboard: true,
      payrollReceipts: false,
      satConnection: true,
      satCfdiStatus: true,
      massKeys: false,
      massRequests: false,
      massVerification: false,
      massPackages: false,
      massPanel: false,
      orgCompanies: false,
      orgUsers: false,
      orgProfiles: false,
      orgRoles: false,
      orgSettings: false,
      providerDashboard: true,
      providerPaymentsUpdate: false,
      providerBusinessRules: false,
      providerBusinessRulePueForma99: false,
      providerBusinessRuleResicoRetention: false,
      providerBusinessRuleObjetoImpVsIva: false
    }
  }
}

export function buildSystemRoleDefaults(roleId: SystemRoleId) {
  const src = DEFAULT_OVERRIDES[roleId]
  return {
    id: roleId,
    name: roleId === 'ADMIN' ? 'Administrador' : roleId === 'AUDITOR' ? 'Auditor' : 'Visualizador',
    description: roleId === 'ADMIN'
      ? 'Acceso total a todas las funcionalidades del sistema.'
      : roleId === 'AUDITOR'
      ? 'Acceso de solo lectura para auditoría y revisión.'
      : 'Acceso básico de solo lectura a los dashboards.',
    isSystemRole: true,
    canViewEmission: src.canViewEmission,
    canViewReception: src.canViewReception,
    canViewPayroll: src.canViewPayroll,
    canViewSatPortal: src.canViewSatPortal,
    canViewMassDownloads: src.canViewMassDownloads,
    canManageOrg: src.canManageOrg,
    granularPermissions: src.granularPermissions
  }
}

function isSystemRoleId(id: unknown): id is SystemRoleId {
  return typeof id === 'string' && (SYSTEM_ROLE_IDS as readonly string[]).includes(id)
}

function coerceBoolean(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean') return val
  if (val === 'true' || val === 'false') return val === 'true'
  return fallback
}

function coerceGranularObject(raw: unknown, fallback: Record<string, boolean>): Record<string, boolean> {
  if (!raw || typeof raw !== 'object') return fallback
  const out = { ...fallback } as Record<string, boolean>
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = coerceBoolean(v, fallback[k] ?? false)
  }
  return out
}

export async function getSystemRoleOverrideForOrg(
  organizationId: string,
  roleId: SystemRoleId
): Promise<SystemRoleOverride> {
  const fallback = DEFAULT_OVERRIDES[roleId]
  const rawSettings = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { systemSettings: true }
  })

  if (!rawSettings?.systemSettings || typeof rawSettings.systemSettings !== 'object') {
    return fallback
  }

  const container = (rawSettings.systemSettings as Record<string, unknown>).systemRoleOverrides
  if (!container || typeof container !== 'object') return fallback

  const override = (container as Record<string, unknown>)[roleId]
  if (!override || typeof override !== 'object') return fallback

  return {
    canViewEmission: coerceBoolean((override as Record<string, unknown>).canViewEmission, fallback.canViewEmission),
    canViewReception: coerceBoolean((override as Record<string, unknown>).canViewReception, fallback.canViewReception),
    canViewPayroll: coerceBoolean((override as Record<string, unknown>).canViewPayroll, fallback.canViewPayroll),
    canViewSatPortal: coerceBoolean((override as Record<string, unknown>).canViewSatPortal, fallback.canViewSatPortal),
    canViewMassDownloads: coerceBoolean((override as Record<string, unknown>).canViewMassDownloads, fallback.canViewMassDownloads),
    canManageOrg: coerceBoolean((override as Record<string, unknown>).canManageOrg, fallback.canManageOrg),
    granularPermissions: coerceGranularObject(
      (override as Record<string, unknown>).granularPermissions,
      fallback.granularPermissions
    )
  }
}

export async function saveSystemRoleOverrideForOrg(
  organizationId: string,
  roleId: SystemRoleId,
  data: SystemRoleOverride
) {
  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { systemSettings: true }
  })
  const base = (existing?.systemSettings && typeof existing.systemSettings === 'object')
    ? { ...(existing.systemSettings as Record<string, unknown>) }
    : {} as Record<string, unknown>

  const previousOverrides = (base.systemRoleOverrides && typeof base.systemRoleOverrides === 'object')
    ? { ...(base.systemRoleOverrides as Record<string, unknown>) }
    : {} as Record<string, unknown>

  const cleanedGranular = {} as Record<string, boolean>
  for (const [k, v] of Object.entries(data.granularPermissions)) {
    if (typeof v === 'boolean') cleanedGranular[k] = v
  }

  previousOverrides[roleId] = {
    canViewEmission: !!data.canViewEmission,
    canViewReception: !!data.canViewReception,
    canViewPayroll: !!data.canViewPayroll,
    canViewSatPortal: !!data.canViewSatPortal,
    canViewMassDownloads: !!data.canViewMassDownloads,
    canManageOrg: !!data.canManageOrg,
    granularPermissions: cleanedGranular
  }

  base.systemRoleOverrides = previousOverrides

  await prisma.organization.update({
    where: { id: organizationId },
    data: { systemSettings: base as Prisma.InputJsonValue }
  })
}

/**
 * [SAST-FIX #1 / #4] Valida y resuelve un roleId para una organización dada.
 * - Si es system role → retorna ese valor.
 * - Si es custom role → VERIFICA que exista y pertenezca EXACTAMENTE a la organización dada.
 *   Esto cierra el IDOR que permitía asignar roles de otras organizaciones.
 */
export async function resolveRoleForOrg(
  roleId: string | undefined | null,
  organizationId: string
): Promise<ResolvedRole> {
  if (!roleId) {
    return { systemRole: 'VIEWER', customRoleId: null }
  }

  if (isSystemRoleId(roleId)) {
    return {
      systemRole: roleId,
      customRoleId: null
    }
  }

  const customRole = await prisma.customRole.findUnique({
    where: { id: roleId },
    select: { id: true, organizationId: true }
  })

  if (!customRole) {
    throw new AdminRoleValidationError('Rol personalizado no existe')
  }
  if (customRole.organizationId !== organizationId) {
    throw new AdminRoleValidationError('Rol personalizado inválido para esta organización')
  }

  return { systemRole: 'VIEWER', customRoleId: customRole.id }
}

export { isSystemRoleId }

export class AdminRoleValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'AdminRoleValidationError'
  }
}

// ===================== Zod schemas =====================
// [SAST-FIX #3] Allow-list estricta para permisos de CustomRole.
// Rechaza llaves extra por medio de .strict() para evitar mass assignment.

export const CUSTOM_ROLE_PERMISSION_KEYS = [
  'canViewEmission',
  'canViewReception',
  'canViewPayroll',
  'canViewSatPortal',
  'canViewMassDownloads',
  'canManageOrg'
] as const

export type CustomRolePermissionKey = typeof CUSTOM_ROLE_PERMISSION_KEYS[number]

export const customRolePermissionsSchema = z.object({
  canViewEmission: z.boolean().default(false),
  canViewReception: z.boolean().default(false),
  canViewPayroll: z.boolean().default(false),
  canViewSatPortal: z.boolean().default(false),
  canViewMassDownloads: z.boolean().default(false),
  canManageOrg: z.boolean().default(false),
}).strict()

export const createCustomRoleSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(100, 'Nombre demasiado largo'),
  description: z.string().trim().max(500, 'Descripción demasiado larga').optional().default(''),
  permissions: customRolePermissionsSchema.default(customRolePermissionsSchema.parse({})),
  granularPermissions: z.record(z.string(), z.boolean()).default({}),
})

export const updateCustomRoleSchema = createCustomRoleSchema.partial().extend({
  name: z.string().trim().min(1).max(100).optional(),
  permissions: customRolePermissionsSchema.optional(),
})

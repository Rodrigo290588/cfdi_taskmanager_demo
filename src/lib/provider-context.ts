import { prisma } from '@/lib/prisma'
import type { ProviderContext } from '@/lib/provider-cfdi-report'
import { Permission, enrichUserWithMemberships, hasPermission } from '@/lib/permissions'
import { getSystemRoleOverrideForOrg, isSystemRoleId } from '@/lib/admin-roles'
import type { SystemRole } from '@prisma/client'

export const ORG_ID_REGEX =
  /^(?:[a-z0-9]{22,36}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/

export function validateAndParseOrgId(
  candidate: string | null | undefined,
  opts: { required: boolean } = { required: true }
): { ok: true; value: string | undefined } | { ok: false; status: 400; error: string } {
  const raw = typeof candidate === 'string' ? candidate.trim() : ''
  if (!raw) {
    if (opts.required) {
      return { ok: false, status: 400, error: 'orgId es requerido (parametro obligatorio para silo multi-org)' }
    }
    return { ok: true, value: undefined }
  }
  if (raw.length > 40) {
    return { ok: false, status: 400, error: 'orgId formato invalido (longitud maxima 40)' }
  }
  if (!ORG_ID_REGEX.test(raw)) {
    return { ok: false, status: 400, error: 'orgId formato invalido (cuid/uuid esperado)' }
  }
  return { ok: true, value: raw }
}

export interface ProviderPortalAccessDecision {
  ok: boolean
  status?: 403
  error?: string
}

export function requireProviderPortalAccess(
  ctx: ProviderContext,
  permission: Permission.PROVIDER_PORTAL_VIEW | Permission.PROVIDER_PORTAL_UPLOAD
): ProviderPortalAccessDecision {
  if (!ctx?.providerRfc) {
    return { ok: false, status: 403, error: 'La membresía no tiene RFC de proveedor asignado' }
  }
  // Granular permissions customRole
  if (ctx.granularPermissions && typeof ctx.granularPermissions === 'object') {
    if (ctx.granularPermissions[permission] === true) {
      return { ok: true }
    }
  }
  // Para los siguientes requires es necesario el userId (system/org role resolution)
  // En routes se valida hasPermission(enriched user, permission, organizationId),
  // así que si no hay granular lo rechazamos aquí para evitar ambigüedad.
  return { ok: false, status: 403, error: `Permiso faltante: ${permission}. Contacta al administrador para habilitar Portal Proveedores` }
}

export async function resolveProviderContext(
  userId: string,
  orgId?: string | null,
  opts?: { requireExplicitOrg?: boolean }
): Promise<ProviderContext | null> {
  // Strict silo: si requireExplicitOrg=true y orgId inválido/omitido, return null directo
  if (opts?.requireExplicitOrg === true && !orgId) {
    return null
  }
  if (orgId && !ORG_ID_REGEX.test(String(orgId).trim())) {
    return null
  }
  const member = await prisma.member.findFirst({
    where: {
      userId,
      status: 'APPROVED',
      ...(orgId ? { organizationId: orgId } : opts?.requireExplicitOrg === true ? { id: '__NEVER_MATCH_PROV_SILO__' } : {})
    },
    include: {
      customRole: true,
      companyAccesses: {
        include: {
          company: {
            select: {
              id: true,
              rfc: true,
              businessName: true,
              name: true,
              status: true
            }
          }
        }
      }
    }
  })

  if (!member) {
    return null
  }

  const allowedCompanies = member.companyAccesses
    .filter(access => access.company?.status === 'APPROVED')
    .map(access => ({
      id: access.company.id,
      rfc: access.company.rfc,
      businessName: access.company.businessName || access.company.name
    }))

  let granularPermissions: Record<string, boolean>
  if (member.customRole && member.customRole.granularPermissions && typeof member.customRole.granularPermissions === 'object') {
    granularPermissions = member.customRole.granularPermissions as Record<string, boolean>
  } else if (!member.customRoleId && isSystemRoleId(member.role)) {
    const override = await getSystemRoleOverrideForOrg(member.organizationId, member.role)
    granularPermissions = override.granularPermissions
  } else if (member.granularPermissions && typeof member.granularPermissions === 'object') {
    granularPermissions = member.granularPermissions as Record<string, boolean>
  } else {
    granularPermissions = {}
  }

  return {
    memberId: member.id,
    organizationId: member.organizationId,
    providerRfc: member.providerRfc || '',
    providerName: member.providerName,
    providerUploadBlockedAt: member.providerUploadBlockedAt?.toISOString() || null,
    providerUploadBlockedReason: member.providerUploadBlockedReason || null,
    providerUploadBlockedBySystem: member.providerUploadBlockedBySystem,
    allowedCompanies,
    granularPermissions
  }
}

export async function resolveProviderContextWithPermissionCheck(
  userId: string,
  systemRole: SystemRole,
  orgId: string | null | undefined,
  permission: Permission.PROVIDER_PORTAL_VIEW | Permission.PROVIDER_PORTAL_UPLOAD
): Promise<{ context: ProviderContext } | { error: string; status: 400 | 403 | 404 }> {
  // 1) Strict org validation
  const orgCheck = validateAndParseOrgId(orgId, { required: true })
  if (!orgCheck.ok) {
    return { error: orgCheck.error, status: orgCheck.status }
  }
  // 2) Silo explicit org (no fallback default)
  const context = await resolveProviderContext(userId, orgCheck.value, { requireExplicitOrg: true })
  if (!context) {
    return { error: 'No se encontró la membresía de proveedor en la organización solicitada', status: 404 }
  }
  // 3) Strict match organizationId explicit solicitado vs resuelto
  if (orgCheck.value && context.organizationId !== orgCheck.value) {
    return { error: 'Silo multi-org violacion: organizationId mismatch', status: 403 }
  }
  // 4) RFC proveedor requerido
  if (!context.providerRfc) {
    return { error: 'La membresía no tiene RFC de proveedor configurado (members.provider_rfc)', status: 403 }
  }
  // 5) Permission: enriched user hasPermission (resuelve SYSTEM_ROLE + ORG_ROLE + granular)
  const enriched = await enrichUserWithMemberships({ id: userId, systemRole })
  if (!hasPermission(enriched, permission, context.organizationId)) {
    const granular = requireProviderPortalAccess(context, permission)
    if (!granular.ok) {
      return { error: granular.error || `Permiso faltante: ${permission}`, status: 403 }
    }
  }
  return { context }
}

import { createHash } from 'node:crypto'
import type { CfdiType, InvoiceStatus, SatStatus, SystemRole } from '@prisma/client'
import { Permission, enrichUserWithMemberships, hasPermission } from '@/lib/permissions'
import { canUserAccessCompany } from '@/lib/permissions'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { RFC_STRICT_REGEX_UNICODE } from '@/lib/rfc-validate'
import { escapeHtml } from '@/lib/rfc-validate'

export const SAT_POST_BODY_HARD_CAP_BYTES = 1024 * 128
export const SAT_IMPORT_DEMO_MAX_INVOICES_BATCH = 48
export const SAT_IMPORT_DEMO_DEFAULT_INVOICES = 48
export const SAT_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  ...SECURITY_HEADERS,
  'X-Robots-Tag': 'noindex, nofollow, nosnippet, noarchive',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
})
export const SAT_FISCAL_ENTITY_HARDCODE_POSTALCODE = '04120'
export const SAT_FISCAL_ENTITY_HARDCODE_TAXREGIME = '601'

export interface SatImportContext {
  userId: string
  systemRole: SystemRole
  memberId: string
  organizationId: string
  companyId: string
  fiscalEntityId: string
  enriched: Awaited<ReturnType<typeof enrichUserWithMemberships>>
}

export interface SatGateDecision {
  allowed: boolean
  status: 400 | 401 | 403 | 404 | 200
  error?: string
  actionRequired?: string
  incidentFingerprint?: string
  ctx?: SatImportContext
  headers: Readonly<Record<string, string>>
}

export function satIncidentFingerprint(prefix: string, ...payloads: Array<unknown>): string {
  const joined = [prefix, ...payloads.map((p) => {
    if (p == null) return ''
    if (p instanceof Error) return `${p.name}:${p.message?.slice(0, 120)}`
    if (typeof p === 'object') {
      try { return JSON.stringify(p).slice(0, 512) }
      catch { return String(p).slice(0, 512) }
    }
    return String(p).slice(0, 512)
  })].join('::')
  const sha = createHash('sha256').update(joined).digest('hex')
  return `${prefix}_${sha.slice(0, 16)}`
}

export function safeErrSummarySat(error: unknown): { name: string; message: string; incidentFingerprint: string } {
  const fp = satIncidentFingerprint('sat_err_500', error)
  if (error == null) {
    return { name: 'UnknownSatError', message: 'Error interno del servidor SAT', incidentFingerprint: fp }
  }
  if (error instanceof Error) {
    return {
      name: error.name || 'SatGenericError',
      message: 'Ocurrió un error procesando tu solicitud. Nuestro equipo fue notificado automáticamente.',
      incidentFingerprint: fp,
    }
  }
  return {
    name: 'SatGenericError',
    message: 'Error interno del servidor SAT',
    incidentFingerprint: fp,
  }
}

export function isSatDemoImportAllowedEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  const env = String(nodeEnv ?? '').toLowerCase().trim()
  return env === 'development' || env === 'test' || env === 'dev'
}

export function satValidateCompanyIdFormat(companyId: unknown): { ok: true } | { ok: false; status: 400; error: string } {
  const raw = typeof companyId === 'string' ? companyId.trim() : ''
  if (!raw) {
    const fp = satIncidentFingerprint('sat_bad_req_company_empty', companyId)
    return { ok: false, status: 400, error: `companyId es requerido (fp=${fp})` }
  }
  const UUID_V4 = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
  const CUID = /^c[a-z0-9]{23}$/
  const LEGACY = /^[A-Za-z0-9_\-]{16,64}$/
  if (UUID_V4.test(raw) || CUID.test(raw) || LEGACY.test(raw)) return { ok: true }
  const fp = satIncidentFingerprint('sat_bad_req_company_format', raw)
  return { ok: false, status: 400, error: `companyId formato inválido (uuid/cuid/legacy expected, fp=${fp})` }
}

export function satValidateRfcStrictFormat(rfc: unknown): { ok: true; normalized: string } | { ok: false; status: 400; error: string } {
  const raw = typeof rfc === 'string' ? rfc.trim().toUpperCase() : ''
  if (!raw || raw.length < 12 || raw.length > 13) {
    const fp = satIncidentFingerprint('sat_rfc_len_fail', raw ?? 'null')
    return { ok: false, status: 400, error: `RFC longitud inválida (12/13 req, fp=${fp})` }
  }
  if (!RFC_STRICT_REGEX_UNICODE.test(raw)) {
    const fp = satIncidentFingerprint('sat_rfc_regex_fail', raw)
    return { ok: false, status: 400, error: `RFC patrón SAT DOF inválido (fp=${fp})` }
  }
  return { ok: true, normalized: raw }
}

export async function resolveSatFiscalEntityInSilo(params: {
  userId: string
  systemRole: SystemRole
  companyId: string
  rfcNormalized: string
  businessName?: string | null
  allowAutoCreateDemo?: boolean
}): Promise<{ ok: true; fiscalEntityId: string; organizationId: string } | { ok: false; status: 403 | 404; error: string; incidentFingerprint: string }> {
  const { userId, systemRole, companyId, rfcNormalized, businessName, allowAutoCreateDemo = true } = params
  const access = await canUserAccessCompany(userId, systemRole, companyId)
  if (!access.allowed) {
    const fp = satIncidentFingerprint('sat_cross_org_company_deny', userId, companyId, systemRole)
    return { ok: false, status: 403, error: `Sin acceso a la compañía (silo multi-tenant cross-org, fp=${fp})`, incidentFingerprint: fp }
  }
  const organizationId = access.organizationId
  if (!organizationId) {
    const fp = satIncidentFingerprint('sat_silo_missing_orgid', userId, companyId)
    return { ok: false, status: 403, error: `Compañía no pertenece a organización (silo sin organización, fp=${fp})`, incidentFingerprint: fp }
  }

  const { prisma } = await import('@/lib/prisma')
  const existing = await prisma.fiscalEntity.findFirst({
    where: { rfc: rfcNormalized, organizationId },
    select: { id: true, organizationId: true },
  })
  if (existing) {
    if (existing.organizationId !== organizationId) {
      const fp = satIncidentFingerprint('sat_cross_org_fe_bypass', existing.organizationId, organizationId, rfcNormalized)
      return { ok: false, status: 403, error: `FiscalEntity pertenece a otra organización (silo bypass detectado, fp=${fp})`, incidentFingerprint: fp }
    }
    return { ok: true, fiscalEntityId: existing.id, organizationId }
  }

  if (allowAutoCreateDemo !== true) {
    const fp = satIncidentFingerprint('sat_fe_missing_nocreate', rfcNormalized, companyId)
    return { ok: false, status: 404, error: `Entidad fiscal no existe y creación automática DEMO deshabilitada (fp=${fp})`, incidentFingerprint: fp }
  }

  const safeBusiness = (businessName && typeof businessName === 'string')
    ? escapeHtml(String(businessName).trim().slice(0, 255))
    : `Empresa ${rfcNormalized}`
  const created = await prisma.fiscalEntity.create({
    data: {
      organizationId,
      rfc: rfcNormalized,
      businessName: safeBusiness,
      taxRegime: SAT_FISCAL_ENTITY_HARDCODE_TAXREGIME,
      postalCode: SAT_FISCAL_ENTITY_HARDCODE_POSTALCODE,
      isActive: true,
    },
    select: { id: true, organizationId: true },
  })
  return { ok: true, fiscalEntityId: created.id, organizationId: created.organizationId }
}

export async function requireSatImportDemoTripleLock(params: {
  sessionUserId: string | null | undefined
  sessionSystemRole: unknown
  companyIdRaw: unknown
  rfcRaw: unknown
  businessName?: string | null
  nodeEnv?: string
  prismaOrgLookupRequired?: boolean
}): Promise<SatGateDecision> {
  const headers = { ...SAT_SECURITY_HEADERS } as Record<string, string>
  if (!params.sessionUserId) {
    const fp = satIncidentFingerprint('sat_gate_401_no_session', params.companyIdRaw)
    return { allowed: false, status: 401, error: `No autorizado (sesión faltante, fp=${fp})`, incidentFingerprint: fp, headers }
  }
  const systemRole = params.sessionSystemRole as SystemRole
  if (!systemRole || typeof systemRole !== 'string') {
    const fp = satIncidentFingerprint('sat_gate_401_role_bad', params.sessionSystemRole ?? 'null')
    return { allowed: false, status: 401, error: `Tipo de usuario inválido (fp=${fp})`, incidentFingerprint: fp, headers }
  }
  const demoEnvOk = isSatDemoImportAllowedEnv(params.nodeEnv)
  if (!demoEnvOk) {
    const fp = satIncidentFingerprint('sat_gate_403_prod_forbidden', params.nodeEnv ?? process.env.NODE_ENV ?? 'prod')
    return { allowed: false, status: 403, error: `Endpoint SAT Import DEMO está deshabilitado en ambientes production (fp=${fp})`, actionRequired: 'Este endpoint está disponible únicamente en NODE_ENV=development|test. Contacta a SUPER_ADMIN para ejecutar seed de demo local.', incidentFingerprint: fp, headers }
  }
  const companyOk = satValidateCompanyIdFormat(params.companyIdRaw)
  if (!companyOk.ok) {
    return { allowed: false, status: companyOk.status, error: companyOk.error, headers }
  }
  const rfcOk = satValidateRfcStrictFormat(params.rfcRaw)
  if (!rfcOk.ok) {
    return { allowed: false, status: rfcOk.status, error: rfcOk.error, headers }
  }
  const enriched = await enrichUserWithMemberships({ id: params.sessionUserId, systemRole })
  if (!enriched.memberships || enriched.memberships.length === 0) {
    const fp = satIncidentFingerprint('sat_gate_403_no_memberships', params.sessionUserId)
    return { allowed: false, status: 403, error: `Usuario sin membresías APPROVED en ninguna organización (fp=${fp})`, incidentFingerprint: fp, headers }
  }

  const access = await canUserAccessCompany(params.sessionUserId, systemRole, String(params.companyIdRaw ?? '').trim())
  if (!access.allowed) {
    const fp = satIncidentFingerprint('sat_gate_403_company_denied', params.sessionUserId, params.companyIdRaw, systemRole)
    return { allowed: false, status: 403, error: `Sin acceso a la compañía solicitada (BOLA fail-closed, fp=${fp})`, incidentFingerprint: fp, headers }
  }
  const organizationId = access.organizationId
  if (!organizationId) {
    const fp = satIncidentFingerprint('sat_gate_403_no_org_for_company', params.sessionUserId, params.companyIdRaw)
    return { allowed: false, status: 403, error: `Compañía sin organización asociada (silo inválido, fp=${fp})`, incidentFingerprint: fp, headers }
  }
  if (!hasPermission(enriched, Permission.SAT_IMPORT_DEMO, organizationId)) {
    const fp = satIncidentFingerprint('sat_gate_403_permission_missing', params.sessionUserId, organizationId, systemRole)
    return { allowed: false, status: 403, error: `Permiso faltante: ${Permission.SAT_IMPORT_DEMO} (rol VIEWER/AUDITOR bloqueado fail-closed, fp=${fp})`, incidentFingerprint: fp, headers }
  }

  const silo = await resolveSatFiscalEntityInSilo({
    userId: params.sessionUserId,
    systemRole,
    companyId: String(params.companyIdRaw ?? '').trim(),
    rfcNormalized: rfcOk.normalized,
    businessName: params.businessName,
    allowAutoCreateDemo: true,
  })
  if (!silo.ok) {
    return { allowed: false, status: silo.status, error: silo.error, incidentFingerprint: silo.incidentFingerprint, headers }
  }

  const member = enriched.memberships.find((m) => m.organizationId === organizationId)
  const memberId = member ? `${organizationId}::${params.sessionUserId}` : params.sessionUserId

  return {
    allowed: true,
    status: 200,
    headers,
    ctx: {
      userId: params.sessionUserId,
      systemRole,
      memberId,
      organizationId: silo.organizationId,
      companyId: String(params.companyIdRaw ?? '').trim(),
      fiscalEntityId: silo.fiscalEntityId,
      enriched,
    },
  }
}

export type { CfdiType, InvoiceStatus, SatStatus }

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { enforceDashboardRateLimit, rateLimit, type DashboardRouteKey, DASHBOARD_RATE_LIMITS } from '@/lib/rate-limit'
import {
  Permission,
  requireApprovedDashboardAccess,
  type ScopedDashboardContext,
  DashboardForbiddenError,
  DashboardMissingParamError
} from '@/lib/permissions'
import { auth } from '@/lib/auth'
import { getRealClientIp } from '@/lib/security'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

// ---------------------------------------------------------------------------
// Shape tipado fuerte del usuario autenticado para auditorías / logging.
// Next-Auth `Session.user` default typing viene con `User` minimalista que NO
// declara `email`/`name` públicamente (varían por proveedor), pero nuestros
// callbacks jwt/session SÍ los escriben (ver src/lib/auth.ts callbacks.jwt+session).
// Al declarar el shape AQUÍ centralizado, en lugar de inline `as` cast en cada
// route handler, el build de Next.js (next build → tsc type-check) NO vuelve a
// resolvernos el typing a `next-auth/User` default, eliminando el falso error:
//   "Property 'email' does not exist on type 'User'."
// ---------------------------------------------------------------------------
export interface AuthenticatedAuditUser {
  id: string
  email: string | null
  name: string | null
}

export interface DashboardScopedRequestCtx {
  ctx: ScopedDashboardContext
  searchParams: URLSearchParams
  sessionUserId: string
  systemRole: ScopedDashboardContext['userSystemRole']
  /** Datos enriquecidos para auditoría: shape tipado centralizado. */
  enrichedUser: AuthenticatedAuditUser
}

export class DashboardRateLimitError extends Error {
  readonly statusCode = 429
  readonly code = 'RATE_LIMIT'
  readonly retryAfterSeconds: number
  constructor(retryAfter = 60) {
    super('Límite de solicitudes excedido')
    this.name = 'DashboardRateLimitError'
    this.retryAfterSeconds = retryAfter
  }
}

export type DashboardCommonParams = {
  /** route key for rate limit */
  routeKey: DashboardRouteKey
  /** permission to check. defaults DASHBOARD_FISCAL_VIEW */
  permission?: Permission
  /** If true, requires companyId present in query. Throws DashboardMissingParamError(400) otherwise. */
  requireCompanyId?: boolean
  /** Retry-After seconds in 429 responses. Default 60 */
  retryAfterSeconds?: number
}

export async function buildDashboardScopedContext(
  request: NextRequest,
  opts: DashboardCommonParams = { routeKey: 'mainHeavy' }
): Promise<DashboardScopedRequestCtx> {
  const clientIp = getRealClientIp(request.headers)
  const cfg = DASHBOARD_RATE_LIMITS[opts.routeKey]
  const ipKey = `df:ip:${cfg.key}:${clientIp}`
  const ipRl = await rateLimit(ipKey, { limit: cfg.limit * 3, interval: cfg.windowMs, silent: true })
  if (!ipRl.success) {
    throw new DashboardRateLimitError(opts.retryAfterSeconds ?? 60)
  }

  const sessionRaw = await auth()
  if (!sessionRaw?.user?.id) {
    throw new DashboardForbiddenError('No autorizado')
  }
  const session = sessionRaw as {
    user: {
      id: string
      email?: string | null
      name?: string | null
      systemRole: ScopedDashboardContext['userSystemRole']
    }
    expires?: string
  }
  try {
    enforceDashboardRateLimit(session.user.id, opts.routeKey)
  } catch {
    throw new DashboardRateLimitError(opts.retryAfterSeconds ?? 60)
  }
  const searchParams = new URL(request.url).searchParams
  const companyId = searchParams.get('companyId') || null
  const orgId = searchParams.get('orgId') || null
  if (opts.requireCompanyId && !companyId) {
    throw new DashboardMissingParamError('companyId requerido')
  }
  const ctx = await requireApprovedDashboardAccess(session.user.id, session.user.systemRole, {
    companyId: companyId ?? undefined,
    organizationId: orgId ?? undefined,
    permission: opts.permission
  })
  const orgKey = `df:org:${cfg.key}:${ctx.organizationId}`
  const orgRl = await rateLimit(orgKey, { limit: cfg.limit * 10, interval: cfg.windowMs, silent: true })
  if (!orgRl.success) {
    throw new DashboardRateLimitError(opts.retryAfterSeconds ?? 60)
  }
  const enrichedUser: AuthenticatedAuditUser = {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  }

  return {
    ctx,
    searchParams,
    sessionUserId: session.user.id,
    systemRole: session.user.systemRole,
    enrichedUser,
  } satisfies DashboardScopedRequestCtx
}

export function dashboardJsonErrorResponse(error: unknown): NextResponse {
  const reqId = randomUUID()
  if (error instanceof DashboardMissingParamError) {
    return NextResponse.json(
      { error: error.message, code: error.code, reqId },
      { status: error.statusCode, headers: SECURITY_HEADERS }
    )
  }
  if (error instanceof DashboardForbiddenError) {
    return NextResponse.json(
      { error: 'Sin acceso al recurso solicitado', code: error.code, reqId },
      { status: error.statusCode, headers: SECURITY_HEADERS }
    )
  }
  if (error instanceof DashboardRateLimitError) {
    return NextResponse.json(
      { error: error.message, code: error.code, reqId },
      { status: error.statusCode, headers: { ...SECURITY_HEADERS, 'Retry-After': String(error.retryAfterSeconds) } }
    )
  }
  console.error(`[DashboardFiscal Error reqId=${reqId}]:`, error instanceof Error ? error.message : 'Unknown error')
  return NextResponse.json(
    { error: 'Error interno del servidor. Contacte a soporte si el problema persiste.', code: 'INTERNAL_SERVER_ERROR', reqId },
    { status: 500, headers: SECURITY_HEADERS }
  )
}

const SAFE_FILENAME_REGEX = /[^A-Za-z0-9_\-]/g

export function sanitizeDownloadFilename(unsafeName: string, fallback = 'download', ext?: string): string {
  const base = (unsafeName || '').toString().replace(SAFE_FILENAME_REGEX, '_').slice(0, 120).replace(/^_+|_+$/g, '')
  const clean = (base || fallback).replace(/\s+/g, '_')
  return ext ? `${clean}${ext.startsWith('.') ? ext : `.${ext}`}` : clean
}

export function buildRfc5987ContentDisposition(filename: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const encoded = encodeURIComponent(filename).replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`)
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export const DASHBOARD_MAX_MONTHS = 36

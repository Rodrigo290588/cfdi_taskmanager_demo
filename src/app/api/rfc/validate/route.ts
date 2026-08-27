import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { Permission, enrichUserWithMemberships, hasPermission, type User } from '@/lib/permissions'
import { rateLimit } from '@/lib/rate-limit'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import {
  RFC_POST_BODY_HARD_CAP_BYTES,
  calculateOfficialSatVerificationDigit,
  escapeHtml,
  RFC_VALIDATION_SUGGESTIONS,
  redactZodIssuesEscaped,
  safeValidateRfcInput,
  validateRfc,
  rfcByteSizeUtf8,
  type SafeValidateInputFail,
} from '@/lib/rfc-validate'
import {
  fingerprint,
  getRealClientIp,
  safeErrSummary,
  isInternalHostname,
} from '@/lib/security'

export const runtime = 'nodejs'
export const preferredRegion = 'auto'
export const maxDuration = 10
export const dynamic = 'force-dynamic'

const fp32 = (s: string) => fingerprint(s, false).slice(0, 8)

const RFC_ALLOWED_ORIGINS = Object.freeze(
  new Set([
    process.env.NEXT_PUBLIC_APP_URL || 'https://app.platfi.mx',
    process.env.NEXT_PUBLIC_ADMIN_URL || 'https://admin.platfi.mx',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '__DEV_DISABLED__',
  ].filter((s): s is string => typeof s === 'string' && s !== '__DEV_DISABLED__' && s.length > 0)),
)

const RFC_RATE = {
  POST_IP:   { key: 'rfc_post_ip',   limit: 30, windowMs: 60_000 },
  POST_USER: { key: 'rfc_post_user', limit: 20, windowMs: 60_000 },
  POST_ORG:  { key: 'rfc_post_org',  limit: 15, windowMs: 60_000 },
  GET_IP:    { key: 'rfc_get_ip',    limit: 20, windowMs: 60_000 },
  GET_USER:  { key: 'rfc_get_user',  limit: 15, windowMs: 60_000 },
  GET_ORG:   { key: 'rfc_get_org',   limit: 10, windowMs: 60_000 },
} as const

type RfcSession = {
  userId: string
  defaultOrgId: string | null
  enriched: User
}

function failResponse(
  status: 400 | 401 | 403 | 410 | 413 | 422 | 429,
  error: string,
  extras?: Record<string, unknown> & { headers?: Record<string, string> }
): NextResponse {
  const { headers, ...extraBody } = extras || {}
  const body: Record<string, unknown> = { error, ...extraBody }
  return NextResponse.json(body, {
    status,
    headers: { ...SECURITY_HEADERS, ...headers },
  })
}

async function requireAuthenticatedSession(_request: NextRequest): Promise<
  | { ok: true; session: RfcSession }
  | { ok: false; response: NextResponse }
> {
  void _request
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false, response: failResponse(401, 'No autorizado. Se requiere iniciar sesión en la Plataforma.') }
  }
  const userId = String(session.user.id)
  const u = session.user as unknown as Record<string, unknown>
  const systemRole = typeof u.systemRole === 'string' ? (u.systemRole as User['systemRole']) : undefined
  const baseUser: User = { id: userId, systemRole: systemRole || ('USER' as User['systemRole']) }
  try {
    const enriched = await enrichUserWithMemberships(baseUser as Parameters<typeof enrichUserWithMemberships>[0])
    const defaultOrgId = typeof u.defaultOrganizationId === 'string' && u.defaultOrganizationId.length >= 20 ? u.defaultOrganizationId : undefined
    if (!hasPermission(enriched, Permission.RFC_VALIDATE_VIEW, defaultOrgId)) {
      return {
        ok: false,
        response: failResponse(403, 'Permiso faltante: rfc:validate:view. Contacta al administrador de tu organización.'),
      }
    }
    return { ok: true, session: { userId, defaultOrgId: defaultOrgId || null, enriched } }
  } catch {
    return { ok: false, response: failResponse(403, 'No fue posible verificar tus permisos en este momento. Intenta nuevamente.') }
  }
}

type RateLimitSpecSimple = { key: string; limit: number; windowMs: number }

async function rateLimitTriple(
  spec: { ip: RateLimitSpecSimple; user: RateLimitSpecSimple; org: RateLimitSpecSimple },
  clientIp: string,
  s: RfcSession | null,
): Promise<{ ok: boolean; retryAfterMs: number }> {
  const rlIp = await rateLimit(`${spec.ip.key}:${clientIp}`, { interval: spec.ip.windowMs, limit: spec.ip.limit })
  if (!rlIp.success) return { ok: false, retryAfterMs: Math.max(60_000, rlIp.retryAfterMs) }
  if (s) {
    const rlUser = await rateLimit(`${spec.user.key}:${s.userId}`, { interval: spec.user.windowMs, limit: spec.user.limit })
    if (!rlUser.success) return { ok: false, retryAfterMs: Math.max(60_000, rlUser.retryAfterMs) }
    if (s.defaultOrgId) {
      const rlOrg = await rateLimit(`${spec.org.key}:${s.defaultOrgId}`, { interval: spec.org.windowMs, limit: spec.org.limit })
      if (!rlOrg.success) return { ok: false, retryAfterMs: Math.max(60_000, rlOrg.retryAfterMs) }
    }
  }
  return { ok: true, retryAfterMs: 0 }
}

function validateAllowedCorsOrigin(request: NextRequest): { originResolved: string } {
  const origin = request.headers.get('origin')?.trim() || ''
  if (origin && RFC_ALLOWED_ORIGINS.has(origin)) return { originResolved: origin }
  if (origin && RFC_ALLOWED_ORIGINS.size > 0) {
    // Host header allow-list fallback adicional para preflight CORS same-site sin origin header explícito
    const host = request.headers.get('host')?.split(':')[0]?.trim().toLowerCase() || ''
    if (host) {
      try {
        for (const allowed of RFC_ALLOWED_ORIGINS) {
          const u = new URL(allowed)
          const allowedHost = u.hostname.toLowerCase()
          if (allowedHost === host && !isInternalHostname(host)) {
            return { originResolved: allowed }
          }
        }
      } catch { /* ignore invalid URLS env */ }
    }
  }
  return { originResolved: 'null' }
}

export async function OPTIONS(request: NextRequest) {
  const { originResolved } = validateAllowedCorsOrigin(request)
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...SECURITY_HEADERS,
      'Access-Control-Allow-Origin': originResolved,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
      'Access-Control-Allow-Credentials': 'false',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    },
  })
}

export async function POST(request: NextRequest) {
  const fp = fp32(`${request.headers.get('x-request-id') || ''}|POST|rfc|${Date.now()}`)
  const { originResolved } = validateAllowedCorsOrigin(request)
  const responseHeaders = () => ({ ...SECURITY_HEADERS, 'Access-Control-Allow-Origin': originResolved, Vary: 'Origin' })
  try {
    const clientIp = getRealClientIp(request.headers) || 'anon'
    // 1) Auth + Permission ANTES cualquier trabajo costoso
    const authResult = await requireAuthenticatedSession(request)
    if (!authResult.ok) {
      const headersOut: Record<string, string> = { ...responseHeaders() }
      authResult.response.headers.forEach((v, k) => { if (k.toLowerCase() !== 'content-type') headersOut[k] = v })
      const body: Record<string, unknown> = await authResult.response.json().catch(() => ({})) as Record<string, unknown>
      return NextResponse.json(body, { status: authResult.response.status, headers: headersOut })
    }
    const session = authResult.session
    // 2) Triple Bucket Rate Limit (siempre fail-closed)
    const rl = await rateLimitTriple(
      { ip: RFC_RATE.POST_IP, user: RFC_RATE.POST_USER, org: RFC_RATE.POST_ORG },
      clientIp,
      session,
    )
    if (!rl.ok) {
      return failResponse(429, 'Demasiadas solicitudes de validación RFC. Intenta en 60 segundos.', {
        retry_after_seconds: Math.ceil(rl.retryAfterMs / 1000),
        incident_fingerprint: fp,
        headers: { ...responseHeaders(), 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      })
    }
    // 3) Body Hard-cap 64KB ANTES request.json() streaming
    const cl = request.headers.get('content-length')
    if (cl) {
      const n = Number(cl)
      if (!Number.isFinite(n) || n < 0 || n > RFC_POST_BODY_HARD_CAP_BYTES) {
        return failResponse(413, `Payload demasiado grande. Máximo permitido: ${RFC_POST_BODY_HARD_CAP_BYTES} bytes.`, {
          incident_fingerprint: fp,
          headers: responseHeaders(),
        })
      }
    }
    const rawBuf = await new Response(request.body).arrayBuffer()
    if (rawBuf.byteLength > RFC_POST_BODY_HARD_CAP_BYTES) {
      return failResponse(413, `Payload demasiado grande. Máximo permitido: ${RFC_POST_BODY_HARD_CAP_BYTES} bytes.`, {
        incident_fingerprint: fp,
        headers: responseHeaders(),
      })
    }
    let bodyParsed: unknown = null
    try {
      bodyParsed = JSON.parse(Buffer.from(rawBuf).toString('utf8')) as unknown
    } catch {
      return failResponse(400, 'Cuerpo POST inválido. JSON malformado.', {
        incident_fingerprint: fp,
        headers: responseHeaders(),
      })
    }
    // 4) Input validation centralizada unificada (mismo path GET)
    const safe = safeValidateRfcInput(bodyParsed)
    if (!safe.ok) {
      const fail = safe as SafeValidateInputFail
      return failResponse(fail.httpStatus, fail.error, {
        details: redactZodIssuesEscaped(fail.details),
        incident_fingerprint: fp,
        headers: responseHeaders(),
      })
    }
    const rfcNormalized = safe.rfc
    // 5) Validation Core
    const validation = validateRfc(rfcNormalized)
    const verificationDigit = calculateOfficialSatVerificationDigit(rfcNormalized)
    // 6) Response escaped anti XSS (RFC-004 / RFC-007)
    return NextResponse.json(
      {
        rfc: escapeHtml(rfcNormalized),
        isValid: validation.isValid,
        type: validation.type,
        errors: validation.errors.map(escapeHtml),
        verificationDigit: escapeHtml(verificationDigit),
        incident_fingerprint: fp,
        suggestions: validation.errors.length ? RFC_VALIDATION_SUGGESTIONS.map(escapeHtml) : [],
      },
      { status: 200, headers: responseHeaders() },
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        endpoint: 'POST /api/rfc/validate',
        fp,
        err: safeErrSummary(error),
      }),
    )
    return NextResponse.json(
      { error: 'Error interno del servidor', incident_fingerprint: fp },
      { status: 500, headers: responseHeaders() },
    )
  }
}

// RFC-009: GET es mantenido por backward-compatibilidad DEPRECATED. Producción retorna 410 pidiendo uso de POST.
// Development temporal: permite GET con permisos auth equivalentes, pero emite warning header Deprecation.
export async function GET(request: NextRequest) {
  const fp = fp32(`${request.headers.get('x-request-id') || ''}|GET|rfc|${Date.now()}`)
  const { originResolved } = validateAllowedCorsOrigin(request)
  const responseHeaders = () => ({
    ...SECURITY_HEADERS,
    'Access-Control-Allow-Origin': originResolved,
    Vary: 'Origin',
    'X-Deprecation-Notice': process.env.NODE_ENV === 'production' ? '2026-09-01' : 'dev',
  })
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        {
          error: 'GET /api/rfc/validate está deshabilitado en producción por cumplimiento PII RFC Art. 14 LOPD.',
          action_required: 'Usa método POST con body JSON { "rfc": "ODE8604257UA" } y credenciales de sesión Authorization.',
          docs: '/docs/api/rfc/validate',
          incident_fingerprint: fp,
        },
        { status: 410, headers: responseHeaders() },
      )
    }
    // DESARROLLO ÚNICAMENTE: se permite GET pero auth obligatorio.
    const clientIp = getRealClientIp(request.headers) || 'anon'
    const authResult = await requireAuthenticatedSession(request)
    if (!authResult.ok) {
      const headersOut: Record<string, string> = { ...responseHeaders() }
      authResult.response.headers.forEach((v, k) => { if (k.toLowerCase() !== 'content-type') headersOut[k] = v })
      const body: Record<string, unknown> = await authResult.response.json().catch(() => ({})) as Record<string, unknown>
      return NextResponse.json(body, { status: authResult.response.status, headers: headersOut }) as NextResponse<never>
    }
    const session = authResult.session
    const rl = await rateLimitTriple(
      { ip: RFC_RATE.GET_IP, user: RFC_RATE.GET_USER, org: RFC_RATE.GET_ORG },
      clientIp,
      session,
    )
    if (!rl.ok) {
      return failResponse(429, 'Demasiadas solicitudes. Usa POST /api/rfc/validate.', {
        retry_after_seconds: Math.ceil(rl.retryAfterMs / 1000),
        headers: { ...responseHeaders(), 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      })
    }
    const url = new URL(request.url)
    const rfcRaw = url.searchParams.get('rfc')
    if (rfcRaw && rfcByteSizeUtf8(rfcRaw) > 256) {
      return failResponse(400, 'Parámetro ?rfc= excede longitud máxima permitida (256 bytes).', {
        headers: responseHeaders(),
      })
    }
    const safe = safeValidateRfcInput(rfcRaw)
    if (!safe.ok) {
      const fail = safe as SafeValidateInputFail
      return failResponse(fail.httpStatus, fail.error, {
        details: redactZodIssuesEscaped(fail.details),
        headers: responseHeaders(),
      })
    }
    const rfcNorm = safe.rfc
    const validation = validateRfc(rfcNorm)
    return NextResponse.json(
      {
        rfc: escapeHtml(rfcNorm),
        isValid: validation.isValid,
        type: validation.type,
        errors: validation.errors.map(escapeHtml),
        verificationDigit: escapeHtml(calculateOfficialSatVerificationDigit(rfcNorm)),
        incident_fingerprint: fp,
        deprecation: 'GET deshabilitado en producción. Usa POST para cumplimiento PII.',
      },
      { status: 200, headers: responseHeaders() },
    )
  } catch (error) {
    console.error(JSON.stringify({ endpoint: 'GET /api/rfc/validate', fp, err: safeErrSummary(error) }))
    return NextResponse.json(
      { error: 'Error interno del servidor', incident_fingerprint: fp },
      { status: 500, headers: responseHeaders() },
    )
  }
}

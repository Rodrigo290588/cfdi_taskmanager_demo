import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma, SystemRole } from '@prisma/client'
import { rateLimit } from '@/lib/rate-limit'
import { Permission, enrichUserWithMemberships, hasPermission } from '@/lib/permissions'
import {
  SAT_SECURITY_HEADERS,
  SAT_POST_BODY_HARD_CAP_BYTES,
  SAT_IMPORT_DEMO_DEFAULT_INVOICES,
  requireSatImportDemoTripleLock,
  safeErrSummarySat,
  satIncidentFingerprint,
  isSatDemoImportAllowedEnv,
  satValidateCompanyIdFormat,
} from '@/lib/sat-gate-helpers'
import { buildDemoSatInvoices, sanitizeSatDemoCount } from '@/lib/sat-seeder-helpers'

const SAT_RATE_LIMITS = Object.freeze({
  IP_GLOBAL: Object.freeze({ key: 'sat_post_ip_global', limit: 10, intervalMs: 60_000, sliding: false as const }),
  USER_AUTH: Object.freeze({ key: 'sat_post_user_auth', limit: 5, intervalMs: 60_000, sliding: false as const }),
  ORG_DAY: Object.freeze({ key: 'sat_post_org_day', limit: 3, intervalMs: 86_400_000, sliding: false as const }),
  USER_DAY: Object.freeze({ key: 'sat_post_user_day_demo', limit: 1, intervalMs: 86_400_000, sliding: false as const }),
})

export const maxDuration = 15
export const dynamic = 'force-dynamic'

function __satHeadersWithExtra(extra: Record<string, string> | undefined | null): Record<string, string> {
  const merged = { ...SAT_SECURITY_HEADERS } as Record<string, string>
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string') merged[k] = v
    }
  }
  return merged
}

function __safeJsonBodyMaxLen(bodyBuf: Uint8Array | ArrayBufferLike | null): { ok: true; parsed: unknown } | { ok: false; status: 400 | 413; error: string; incidentFingerprint: string } {
  if (!bodyBuf || !(Symbol.iterator in Object(bodyBuf) || typeof (bodyBuf as ArrayBuffer).byteLength === 'number')) {
    const fp = satIncidentFingerprint('sat_body_empty')
    return { ok: false, status: 400, error: `Cuerpo POST JSON esperado (fp=${fp})`, incidentFingerprint: fp }
  }
  const len = typeof (bodyBuf as ArrayBuffer).byteLength === 'number' ? (bodyBuf as ArrayBuffer).byteLength : (bodyBuf as Uint8Array).length
  if (len > SAT_POST_BODY_HARD_CAP_BYTES) {
    const fp = satIncidentFingerprint('sat_body_413_cap_exceeded', len, SAT_POST_BODY_HARD_CAP_BYTES)
    return { ok: false, status: 413, error: `Payload demasiado grande (hard-cap ${SAT_POST_BODY_HARD_CAP_BYTES} bytes, fp=${fp})`, incidentFingerprint: fp }
  }
  try {
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : { decode: (b: Uint8Array | ArrayBufferLike) => Buffer.from(b as Buffer).toString('utf8') }
    const text = typeof decoder.decode === 'function' ? decoder.decode(bodyBuf as Uint8Array) : String(bodyBuf)
    if (!text) return { ok: true, parsed: {} }
    const parsed = JSON.parse(text) as unknown
    return { ok: true, parsed }
  } catch (jsonErr) {
    const fp = satIncidentFingerprint('sat_body_json_invalid', jsonErr instanceof Error ? jsonErr.message : String(jsonErr))
    return { ok: false, status: 400, error: `JSON inválido en cuerpo POST (fp=${fp})`, incidentFingerprint: fp }
  }
}

export async function POST(request: NextRequest) {
  try {
    const headers = __satHeadersWithExtra({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': satIncidentFingerprint('sat_request', request.url, request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'anon'),
    })

    const bodyBufferNull: ArrayBuffer | null = typeof request.arrayBuffer === 'function'
      ? await request.arrayBuffer().catch(() => null)
      : null
    const bodyParsed = __safeJsonBodyMaxLen(bodyBufferNull)
    if (!bodyParsed.ok) {
      return NextResponse.json(
        { error: bodyParsed.error, incident_fingerprint: bodyParsed.incidentFingerprint },
        { status: bodyParsed.status, headers: __satHeadersWithExtra(headers) }
      )
    }
    const bodyObj = (bodyParsed.parsed && typeof bodyParsed.parsed === 'object' && !Array.isArray(bodyParsed.parsed))
      ? (bodyParsed.parsed as Record<string, unknown>)
      : {}

    const urlSearch = new URL(request.url)
    const companyIdRaw = bodyObj.companyId || urlSearch.searchParams.get('companyId') || null
    const countRaw = bodyObj.count ?? urlSearch.searchParams.get('count') ?? SAT_IMPORT_DEMO_DEFAULT_INVOICES

    const countOk = sanitizeSatDemoCount(countRaw)
    if (!countOk.ok) {
      const fp = satIncidentFingerprint('sat_count_400', countRaw)
      return NextResponse.json({ error: countOk.error, incident_fingerprint: fp }, { status: 400, headers: __satHeadersWithExtra(headers) })
    }

    const companyFormat = satValidateCompanyIdFormat(companyIdRaw)
    if (!companyFormat.ok) {
      return NextResponse.json(
        { error: companyFormat.error },
        { status: companyFormat.status, headers: __satHeadersWithExtra(headers) }
      )
    }
    const companyId = String(companyIdRaw ?? '').trim()

    const session = await auth()
    if (!session?.user?.id || !session.user.systemRole) {
      const fp = satIncidentFingerprint('sat_auth_401_missing_session', session?.user?.id ?? null)
      return NextResponse.json({ error: `No autorizado (sesión faltante, fp=${fp})`, incident_fingerprint: fp }, { status: 401, headers: __satHeadersWithExtra(headers) })
    }
    const systemRole = session.user.systemRole as unknown as SystemRole
    const enriched = await enrichUserWithMemberships({ id: session.user.id, systemRole })

    if (!isSatDemoImportAllowedEnv(process.env.NODE_ENV)) {
      const fp = satIncidentFingerprint('sat_gate_403_prod_block', process.env.NODE_ENV)
      return NextResponse.json({
        error: `Endpoint SAT Import DEMO está deshabilitado en producción. (fp=${fp})`,
        action_required: 'Ejecuta el seeder DEMO únicamente en ambientes NODE_ENV=development|test. Contacta a SUPER_ADMIN.',
        incident_fingerprint: fp,
      }, { status: 403, headers: __satHeadersWithExtra({ ...headers, 'X-Deprecation-Notice': 'SAT_IMPORT_DEMO_DEV_ONLY' }) })
    }

    const ipCandidate = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '127.0.0.1'
    const rateResIp = await rateLimit(SAT_RATE_LIMITS.IP_GLOBAL.key, { interval: SAT_RATE_LIMITS.IP_GLOBAL.intervalMs, limit: SAT_RATE_LIMITS.IP_GLOBAL.limit })
    if (!rateResIp.success) {
      return NextResponse.json({
        error: `Demasiadas solicitudes por IP (intenta nuevamente en ${Math.ceil(rateResIp.retryAfterMs / 1000)}s)`,
        retry_after_ms: rateResIp.retryAfterMs,
        incident_fingerprint: satIncidentFingerprint('sat_rate_429_ip', ipCandidate),
      }, {
        status: 429,
        headers: __satHeadersWithExtra({
          ...headers,
          'Retry-After': String(Math.ceil(rateResIp.retryAfterMs / 1000)),
          'X-RateLimit-Limit': String(rateResIp.limit),
          'X-RateLimit-Remaining': String(rateResIp.remaining),
        })
      })
    }
    const rateResUser = await rateLimit(SAT_RATE_LIMITS.USER_AUTH.key, { interval: SAT_RATE_LIMITS.USER_AUTH.intervalMs, limit: SAT_RATE_LIMITS.USER_AUTH.limit })
    if (!rateResUser.success) {
      return NextResponse.json({
        error: `Demasiadas solicitudes por usuario (intenta nuevamente en ${Math.ceil(rateResUser.retryAfterMs / 1000)}s)`,
        retry_after_ms: rateResUser.retryAfterMs,
        incident_fingerprint: satIncidentFingerprint('sat_rate_429_user', session.user.id),
      }, {
        status: 429,
        headers: __satHeadersWithExtra({
          ...headers,
          'Retry-After': String(Math.ceil(rateResUser.retryAfterMs / 1000)),
        })
      })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true },
    })
    if (!company?.rfc) {
      const fp = satIncidentFingerprint('sat_company_404', companyId)
      return NextResponse.json({ error: `Empresa no encontrada (fp=${fp})`, incident_fingerprint: fp }, { status: 404, headers: __satHeadersWithExtra(headers) })
    }

    const gate = await requireSatImportDemoTripleLock({
      sessionUserId: session.user.id,
      sessionSystemRole: systemRole,
      companyIdRaw: companyId,
      rfcRaw: company.rfc,
      businessName: company.businessName,
      nodeEnv: process.env.NODE_ENV,
    })
    if (!gate.allowed || !gate.ctx) {
      return NextResponse.json(
        {
          error: gate.error || 'Acceso no autorizado al seeder SAT Demo',
          action_required: gate.actionRequired || undefined,
          incident_fingerprint: gate.incidentFingerprint || satIncidentFingerprint('sat_gate_deny_generic', session.user.id, companyId),
        },
        { status: gate.status, headers: __satHeadersWithExtra({ ...headers, ...gate.headers }) }
      )
    }

    const hasPerm = hasPermission(enriched, Permission.SAT_IMPORT_DEMO, gate.ctx.organizationId)
    if (!hasPerm) {
      const fp = satIncidentFingerprint('sat_perm_403_failclosed', session.user.id, systemRole, gate.ctx.organizationId)
      return NextResponse.json({
        error: `Permiso faltante: ${Permission.SAT_IMPORT_DEMO} (rol VIEWER/AUDITOR bloqueado fail-closed, fp=${fp})`,
        incident_fingerprint: fp,
      }, { status: 403, headers: __satHeadersWithExtra(headers) })
    }

    const orgKey = `${SAT_RATE_LIMITS.ORG_DAY.key}::${gate.ctx.organizationId}`
    const rateResOrg = await rateLimit(orgKey, { interval: SAT_RATE_LIMITS.ORG_DAY.intervalMs, limit: SAT_RATE_LIMITS.ORG_DAY.limit })
    if (!rateResOrg.success) {
      return NextResponse.json({
        error: `Tu organización alcanzó el límite diario de imports DEMO SAT (${SAT_RATE_LIMITS.ORG_DAY.limit}/día).`,
        retry_after_ms: rateResOrg.retryAfterMs,
        incident_fingerprint: satIncidentFingerprint('sat_rate_429_org_day', gate.ctx.organizationId),
      }, { status: 429, headers: __satHeadersWithExtra(headers) })
    }
    const userDayKey = `${SAT_RATE_LIMITS.USER_DAY.key}::${session.user.id}`
    const rateResUserDay = await rateLimit(userDayKey, { interval: SAT_RATE_LIMITS.USER_DAY.intervalMs, limit: SAT_RATE_LIMITS.USER_DAY.limit })
    if (!rateResUserDay.success) {
      return NextResponse.json({
        error: `Ya ejecutaste el import DEMO SAT hoy (1/día por usuario).`,
        retry_after_ms: rateResUserDay.retryAfterMs,
        incident_fingerprint: satIncidentFingerprint('sat_rate_429_user_day', session.user.id),
      }, { status: 429, headers: __satHeadersWithExtra(headers) })
    }

    const demoInvoices = buildDemoSatInvoices({
      count: countOk.value,
      fiscalEntityId: gate.ctx.fiscalEntityId,
      companyRfc: company.rfc,
      companyBusinessName: company.businessName ?? undefined,
      userId: session.user.id,
    })
    const typedRows = demoInvoices as unknown as Prisma.SatInvoiceCreateManyInput[]

    await prisma.satInvoice.createMany({ data: typedRows })

    return NextResponse.json({
      imported: demoInvoices.length,
      organization_id: gate.ctx.organizationId,
      company_id: companyId,
      fiscal_entity_id: gate.ctx.fiscalEntityId,
      env: process.env.NODE_ENV || 'unknown',
    }, { status: 200, headers: __satHeadersWithExtra(headers) })
  } catch (error) {
    const summary = safeErrSummarySat(error)
    console.error(`[SAT_IMPORT_ERR_${summary.incidentFingerprint}]`, summary.name, '-', summary.message)
    return NextResponse.json({
      error: summary.message,
      incident_fingerprint: summary.incidentFingerprint,
    }, { status: 500, headers: { ...SAT_SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } })
  }
}

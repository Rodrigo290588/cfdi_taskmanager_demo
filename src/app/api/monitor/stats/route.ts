import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import {
  getOrganizationImportMonitorStats,
  IMPORT_RUN_SOURCES,
  IMPORT_RUN_STATUSES
} from '@/lib/external-cfdi-import-monitor'
import { requireMonitorAccess, MonitorAccessError } from '@/lib/monitor-route-utils'
import { parseDateFilterStrict, zOrgIdSafe } from '@/lib/monitor-date-uuid-helpers'
import { parseUniqueSearchParams, fp32, sanitizeZodFlatten } from '@/lib/monitor-security-helpers'
import { safeErrSummary, fingerprint, getRealClientIp } from '@/lib/security'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const MonitorStatsQuerySchema = z.strictObject({
  orgId: zOrgIdSafe(),
  status: z.enum(IMPORT_RUN_STATUSES).optional(),
  source: z.enum(IMPORT_RUN_SOURCES).optional(),
  search: z.string().trim().max(191).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

export async function GET(request: NextRequest) {
  const clientIp = getRealClientIp(request.headers)
  // --- IM-002 Fix · Rate limit triple capa: IP (120/min) ANTES auth para no enumerar tokens NextAuth
  const rlIp = await rateLimit(`monitor:stats:ip:${clientIp}`, { interval: 60 * 1000, limit: 120 })
  if (!rlIp.success) {
    return NextResponse.json(
      { error: 'Rate limit excedido. Intenta nuevamente en unos segundos', limit: rlIp.limit, retryAfterMs: rlIp.retryAfterMs },
      { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlIp.retryAfterMs / 1000)) } }
    )
  }

  try {
    const session = await auth()

    // Capa 2 Rate Limit USER después de sesión (60 / 60s)
    if (session?.user?.id) {
      const rlUser = await rateLimit(`monitor:stats:user:${session.user.id}`, { interval: 60 * 1000, limit: 60 })
      if (!rlUser.success) {
        return NextResponse.json(
          { error: 'Rate limit usuario excedido', retryAfterMs: rlUser.retryAfterMs },
          { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlUser.retryAfterMs / 1000)) } }
        )
      }
    }

    const access = await requireMonitorAccess({
      userId: session?.user?.id,
      systemRole: session?.user?.systemRole ?? null,
      requestedOrgId: request.nextUrl.searchParams.get('orgId') ?? null
    })

    // Capa 3 Rate Limit ORG después de scoped tenant context (300 / 60s)
    const rlOrg = await rateLimit(`monitor:stats:org:${access.organizationId}`, { interval: 60 * 1000, limit: 300 })
    if (!rlOrg.success) {
      return NextResponse.json(
        { error: 'Rate limit organización excedido', retryAfterMs: rlOrg.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlOrg.retryAfterMs / 1000)) } }
      )
    }

    const rawParams = parseUniqueSearchParams(request.nextUrl.searchParams)
    const query = MonitorStatsQuerySchema.parse(rawParams)

    const stats = await getOrganizationImportMonitorStats(access.organizationId, {
      status: query.status,
      source: query.source,
      search: query.search || undefined,
      startedFrom: parseDateFilterStrict(query.startDate, 'start'),
      finishedTo: parseDateFilterStrict(query.endDate, 'end')
    })

    return NextResponse.json(stats, {
      headers: SECURITY_HEADERS, status: 200 })
  } catch (error) {
    if (error instanceof MonitorAccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode, headers: SECURITY_HEADERS }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
      { error: 'Parámetros inválidos', details: sanitizeZodFlatten(error.flatten()) },
      { status: 400, headers: SECURITY_HEADERS }
    )
    }

    const errSummary = safeErrSummary(error)
    const msgHash = 'msgHash' in errSummary ? (errSummary as { msgHash?: string }).msgHash : undefined
    const errFp = fp32(fingerprint(`monitor_stats:${msgHash ?? errSummary.name}:${Date.now()}`))
    console.error(`[MON-STATS-${errFp}] Error fetching import monitor stats:`, JSON.stringify(errSummary))
    return NextResponse.json(
      { error: 'No fue posible obtener las métricas del monitor de importación', errorRef: errFp },
      { status: 500, headers: SECURITY_HEADERS }
    )
  }
}

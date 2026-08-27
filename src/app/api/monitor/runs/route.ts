import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import {
  IMPORT_RUN_SOURCES,
  IMPORT_RUN_STATUSES,
  listOrganizationImportRuns
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

export const MonitorRunsQuerySchema = z.strictObject({
  orgId: zOrgIdSafe(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(IMPORT_RUN_STATUSES).optional(),
  source: z.enum(IMPORT_RUN_SOURCES).optional(),
  search: z.string().trim().max(191).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

export async function GET(request: NextRequest) {
  const clientIp = getRealClientIp(request.headers)
  const rlIp = await rateLimit(`monitor:runs:ip:${clientIp}`, { interval: 60 * 1000, limit: 120 })
  if (!rlIp.success) {
    return NextResponse.json(
      { error: 'Rate limit excedido. Intenta nuevamente en unos segundos', retryAfterMs: rlIp.retryAfterMs },
      { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlIp.retryAfterMs / 1000)) } }
    )
  }

  try {
    const session = await auth()
    if (session?.user?.id) {
      const rlUser = await rateLimit(`monitor:runs:user:${session.user.id}`, { interval: 60 * 1000, limit: 60 })
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

    const rlOrg = await rateLimit(`monitor:runs:org:${access.organizationId}`, { interval: 60 * 1000, limit: 300 })
    if (!rlOrg.success) {
      return NextResponse.json(
        { error: 'Rate limit organización excedido', retryAfterMs: rlOrg.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlOrg.retryAfterMs / 1000)) } }
      )
    }

    const rawParams = parseUniqueSearchParams(request.nextUrl.searchParams)
    const query = MonitorRunsQuerySchema.parse(rawParams)
    const result = await listOrganizationImportRuns({
      organizationId: access.organizationId,
      page: query.page,
      pageSize: query.pageSize,
      filters: {
        status: query.status,
        source: query.source,
        search: query.search || undefined,
        startedFrom: parseDateFilterStrict(query.startDate, 'start'),
        finishedTo: parseDateFilterStrict(query.endDate, 'end')
      }
    })

    return NextResponse.json({
      success: true,
      ...result
    }, { status: 200, headers: SECURITY_HEADERS })
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
    const errFp = fp32(fingerprint(`monitor_runs:${msgHash ?? errSummary.name}:${Date.now()}`))
    console.error(`[MON-RUNS-${errFp}] Error fetching monitor runs:`, JSON.stringify(errSummary))
    return NextResponse.json(
      { error: 'No fue posible obtener las corridas del monitor', errorRef: errFp },
      { status: 500, headers: SECURITY_HEADERS }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import {
  IMPORT_RUN_ITEM_DIRECTIONS,
  IMPORT_RUN_ITEM_STATUSES,
  VALIDATION_BUCKETS,
  getImportRunSummary,
  listImportRunItems
} from '@/lib/external-cfdi-import-monitor'
import { requireMonitorAccess, MonitorAccessError } from '@/lib/monitor-route-utils'
import { zUuidV4 } from '@/lib/monitor-date-uuid-helpers'
import { parseUniqueSearchParams, fp32, sanitizeZodFlatten } from '@/lib/monitor-security-helpers'
import { safeErrSummary, fingerprint, getRealClientIp } from '@/lib/security'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const MonitorRunItemsParamsSchema = z.strictObject({
  importRunId: zUuidV4('importRunId')
})

export const MonitorRunItemsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(IMPORT_RUN_ITEM_STATUSES).optional(),
  direction: z.enum(IMPORT_RUN_ITEM_DIRECTIONS).optional(),
  validationBucket: z.enum(VALIDATION_BUCKETS).optional(),
  hasErrors: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  waitingExternalValidation: z.enum(['true', 'false']).transform(value => value === 'true').optional()
})

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ importRunId: string }> }
) {
  const clientIp = getRealClientIp(request.headers)
  const rlIp = await rateLimit(`monitor:runitems:ip:${clientIp}`, { interval: 60 * 1000, limit: 120 })
  if (!rlIp.success) {
    return NextResponse.json(
      { error: 'Rate limit excedido', retryAfterMs: rlIp.retryAfterMs },
      { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlIp.retryAfterMs / 1000)) } }
    )
  }

  try {
    const session = await auth()
    if (session?.user?.id) {
      const rlUser = await rateLimit(`monitor:runitems:user:${session.user.id}`, { interval: 60 * 1000, limit: 60 })
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

    const rlOrg = await rateLimit(`monitor:runitems:org:${access.organizationId}`, { interval: 60 * 1000, limit: 300 })
    if (!rlOrg.success) {
      return NextResponse.json(
        { error: 'Rate limit organización excedido', retryAfterMs: rlOrg.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlOrg.retryAfterMs / 1000)) } }
      )
    }

    const params = MonitorRunItemsParamsSchema.parse(await context.params)
    const rawParams = parseUniqueSearchParams(request.nextUrl.searchParams)
    const query = MonitorRunItemsQuerySchema.parse(rawParams)
    const run = await getImportRunSummary(params.importRunId, access.organizationId)

    if (!run) {
      return NextResponse.json({ error: 'Corrida no encontrada' }, { status: 404, headers: SECURITY_HEADERS })
    }

    const result = await listImportRunItems({
      importRunId: params.importRunId,
      organizationId: access.organizationId,
      page: query.page,
      pageSize: query.pageSize,
      filters: {
        status: query.status,
        direction: query.direction,
        validationBucket: query.validationBucket,
        hasErrors: query.hasErrors,
        waitingExternalValidation: query.waitingExternalValidation
      }
    })

    return NextResponse.json({
      success: true,
      importRun: run,
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
    const errFp = fp32(fingerprint(`monitor_run_items:${msgHash ?? errSummary.name}:${Date.now()}`))
    console.error(`[MON-RUN-ITEMS-${errFp}] Error fetching monitor run items:`, JSON.stringify(errSummary))
    return NextResponse.json(
      { error: 'No fue posible obtener los items de la corrida', errorRef: errFp },
      { status: 500, headers: SECURITY_HEADERS }
    )
  }
}

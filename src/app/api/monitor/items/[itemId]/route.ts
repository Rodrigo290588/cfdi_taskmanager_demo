import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getImportRunItemDetail } from '@/lib/external-cfdi-import-monitor'
import { requireMonitorAccess, MonitorAccessError } from '@/lib/monitor-route-utils'
import { zUuidV4 } from '@/lib/monitor-date-uuid-helpers'
import { fp32, sanitizeZodFlatten } from '@/lib/monitor-security-helpers'
import { safeErrSummary, fingerprint, getRealClientIp } from '@/lib/security'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 25

export const MonitorItemDetailParamsSchema = z.strictObject({
  itemId: zUuidV4('itemId')
})

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const clientIp = getRealClientIp(request.headers)
  const rlIp = await rateLimit(`monitor:item:ip:${clientIp}`, { interval: 60 * 1000, limit: 120 })
  if (!rlIp.success) {
    return NextResponse.json(
      { error: 'Rate limit excedido', retryAfterMs: rlIp.retryAfterMs },
      { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlIp.retryAfterMs / 1000)) } }
    )
  }

  try {
    const session = await auth()
    if (session?.user?.id) {
      const rlUser = await rateLimit(`monitor:item:user:${session.user.id}`, { interval: 60 * 1000, limit: 60 })
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

    const rlOrg = await rateLimit(`monitor:item:org:${access.organizationId}`, { interval: 60 * 1000, limit: 300 })
    if (!rlOrg.success) {
      return NextResponse.json(
        { error: 'Rate limit organización excedido', retryAfterMs: rlOrg.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(rlOrg.retryAfterMs / 1000)) } }
      )
    }

    const params = MonitorItemDetailParamsSchema.parse(await context.params)
    const item = await getImportRunItemDetail(params.itemId, access.organizationId)

    if (!item) {
      return NextResponse.json({ error: 'Item no encontrado' }, { status: 404, headers: SECURITY_HEADERS })
    }

    return NextResponse.json({
      success: true,
      item
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
    const errFp = fp32(fingerprint(`monitor_item_detail:${msgHash ?? errSummary.name}:${Date.now()}`))
    console.error(`[MON-ITEM-DETAIL-${errFp}] Error fetching monitor item detail:`, JSON.stringify(errSummary))
    return NextResponse.json(
      { error: 'No fue posible obtener el detalle del documento', errorRef: errFp },
      { status: 500, headers: SECURITY_HEADERS }
    )
  }
}

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SystemRole } from '@prisma/client'
import { auth } from '@/lib/auth'
import {
  updateTenantProgress,
  getPrimaryApprovedMembership,
  __tenantGetIpFromNextRequest
} from '@/lib/tenant'
import {
  rateLimitByUserId,
  rateLimitByClientId,
  RateLimitError
} from '@/lib/rate-limit'
import crypto from 'crypto'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { enrichUserWithMemberships, hasPermission, Permission } from '@/lib/permissions'

const TENANT_PROGRESS_DEDUP_WINDOW_MS = 5 * 60 * 1000

function mergeSatResponseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'private, no-store, no-cache',
    ...(extra ?? {})
  }
}

export async function POST(request: NextRequest) {
  const reqId = crypto.randomUUID()

  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: mergeSatResponseHeaders({ 'X-Request-Id': reqId }) }
      )
    }

    const ip = __tenantGetIpFromNextRequest(request)
    const membership = await getPrimaryApprovedMembership(session.user.id)
    if (!membership?.organization) {
      return NextResponse.json(
        { error: 'Sin organización activa', reqId },
        { status: 404, headers: mergeSatResponseHeaders({ 'X-Request-Id': reqId }) }
      )
    }
    const org = membership.organization
    if (org.isActive === false) {
      return NextResponse.json(
        { error: 'Tenant inactivo', reqId },
        { status: 403, headers: mergeSatResponseHeaders({ 'X-Request-Id': reqId }) }
      )
    }
    const organizationId = membership.organizationId

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })
    if (!hasPermission(enrichedUser, Permission.TENANT_MANAGE, organizationId)) {
      return NextResponse.json(
        { error: 'No tienes permisos', reqId },
        { status: 403, headers: mergeSatResponseHeaders({ 'X-Request-Id': reqId }) }
      )
    }

    try {
      rateLimitByClientId({
        clientId: ip,
        key: 'tenant:updateprogress:post:ip',
        limit: 40,
        windowMs: 60_000
      })
      rateLimitByUserId({
        userId: session.user.id,
        key: 'tenant:updateprogress:post:user',
        limit: 10,
        windowMs: 60_000
      })
      rateLimitByUserId({
        userId: `orgday:${organizationId}`,
        key: 'tenant:updateprogress:post:orgday',
        limit: 1000,
        windowMs: 24 * 60 * 60 * 1000
      })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          { error: rl.message, reqId },
          {
            status: 429,
            headers: mergeSatResponseHeaders({
              'X-Request-Id': reqId,
              'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000))
            })
          }
        )
      }
      throw rl
    }

    try {
      rateLimitByUserId({
        userId: `org:${organizationId}`,
        key: 'tenant-update-progress',
        limit: 1,
        windowMs: TENANT_PROGRESS_DEDUP_WINDOW_MS
      })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          {
            success: true,
            deduplicated: true,
            message: 'Actualización reciente, omitida',
            reqId
          },
          {
            status: 202,
            headers: mergeSatResponseHeaders({ 'X-Request-Id': reqId })
          }
        )
      }
      throw rl
    }

    await updateTenantProgress(organizationId)

    return NextResponse.json(
      {
        success: true,
        message: 'Progreso del tenant actualizado exitosamente',
        reqId
      },
      {
        headers: mergeSatResponseHeaders({ 'X-Request-Id': reqId })
      }
    )
  } catch (error) {
    const summary = safeErrSummarySat(error)
    return NextResponse.json(
      {
        error: 'Error interno del servidor',
        reqId,
        incidentFingerprint: summary.incidentFingerprint
      },
      {
        status: 500,
        headers: mergeSatResponseHeaders({ 'X-Request-Id': reqId })
      }
    )
  }
}

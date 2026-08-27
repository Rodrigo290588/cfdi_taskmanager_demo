import { NextRequest, NextResponse } from 'next/server'
import { SystemRole } from '@prisma/client'
import { auth } from '@/lib/auth'
import {
  getTenantStatus,
  checkOperationalAccess,
  getOnboardingSteps,
  getPrimaryApprovedMembership,
  __tenantGetIpFromNextRequest
} from '@/lib/tenant'
import { z } from 'zod'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { rateLimitByUserId, rateLimitByClientId, RateLimitError } from '@/lib/rate-limit'
import { enrichUserWithMemberships, hasPermission, Permission } from '@/lib/permissions'

function mergeSatResponseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'private, no-store, no-cache',
    ...(extra ?? {})
  }
}

const onboardingDataSchema = z.object({}).passthrough()

export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401, headers: mergeSatResponseHeaders() }
      )
    }

    const ip = __tenantGetIpFromNextRequest(request)
    try {
      rateLimitByClientId({ clientId: ip, key: 'tenant:status:get:ip', limit: 60, windowMs: 60_000 })
      rateLimitByUserId({ userId: session.user.id, key: 'tenant:status:get:user', limit: 120, windowMs: 60_000 })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          { error: rl.message },
          {
            status: 429,
            headers: mergeSatResponseHeaders({
              'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000))
            })
          }
        )
      }
      throw rl
    }

    const membership = await getPrimaryApprovedMembership(session.user.id)
    if (!membership?.organization) {
      return NextResponse.json(
        { error: 'No perteneces a ninguna organización' },
        { status: 404, headers: mergeSatResponseHeaders() }
      )
    }
    const org = membership.organization
    if (org.isActive === false) {
      return NextResponse.json(
        { error: 'Tenant inactivo' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })
    if (!hasPermission(enrichedUser, Permission.TENANT_VIEW, org.id)) {
      return NextResponse.json(
        { error: 'No tienes permisos para ver esta información' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    const organizationId = membership.organizationId
    const tenantStatus = await getTenantStatus(organizationId)
    const hasOperationalAccess = await checkOperationalAccess(organizationId)
    const onboardingSteps = getOnboardingSteps()

    const sessionUserTyped = session.user as {
      onboardingStep?: string
      onboardingData?: unknown
    }

    const onboardingDataParse = onboardingDataSchema.safeParse(
      sessionUserTyped.onboardingData ?? {}
    )
    const safeOnboardingData = onboardingDataParse.success
      ? onboardingDataParse.data
      : null

    return NextResponse.json(
      {
        success: true,
        tenant: {
          organizationId,
          organizationName: org.name,
          ownerId: org.ownerId,
          isOwner: org.ownerId === session.user.id,
          status: tenantStatus,
          hasOperationalAccess,
          onboardingSteps,
          userOnboarding: {
            step: sessionUserTyped.onboardingStep ?? null,
            data: safeOnboardingData
          }
        }
      },
      { headers: mergeSatResponseHeaders() }
    )

  } catch (error) {
    const summary = safeErrSummarySat(error)
    return NextResponse.json(
      {
        error: 'Error interno del servidor',
        incidentFingerprint: summary.incidentFingerprint
      },
      { status: 500, headers: mergeSatResponseHeaders() }
    )
  }
}

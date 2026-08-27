import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSat69BBlacklistQueue } from '@/lib/queue'
import { rateLimitByUserId, RateLimitError } from '@/lib/rate-limit'
import crypto from 'crypto'

/**
 * [SAST-FIX API-10] Anti Queue-DoS en sync manual SAT 69-B:
 *  - Rate limit: 2 peticiones por org cada 15 min
 *  - Dedupe de job activo: si existe uno pending/waiting/delayed, no crear otro
 *  - Solo Owner o ADMIN de la organización puede encolar
 */
const SAT_69B_BLACKLIST_MANUAL_JOB_NAME = 'sat-69b-blacklist-sync-manual'

interface Sat69BSyncJobData {
  organizationId: string
  triggeredByUserId: string
  requestedAt: string
  requestId?: string
}

export async function POST(request: NextRequest) {
  void request
  const reqId = crypto.randomUUID()

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const membership = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })

    if (!membership?.organization) {
      return NextResponse.json({ error: 'Sin organización activa', reqId }, { status: 404 })
    }

    const isOwner = membership.organization.ownerId === session.user.id
    const isAdmin = membership.role === 'ADMIN'

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Permisos insuficientes', reqId }, { status: 403 })
    }

    // [SAST-FIX API-10] Rate limit por org: 2 syncs cada 15 min
    try {
      rateLimitByUserId({
        userId: `org:${membership.organizationId}`,
        key: 'sat-69b-sync-attempt',
        limit: 2,
        windowMs: 15 * 60 * 1000
      })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          { error: rl.message, reqId },
          { status: rl.statusCode, headers: { 'X-Request-Id': reqId } }
        )
      }
      throw rl
    }

    // [SAST-FIX API-10] Deduplica job activo para esta organización
    const activeJobs = await getSat69BBlacklistQueue().getJobs(['active', 'waiting', 'delayed'])
    const runningForOrg = activeJobs.find((j) => j.name === SAT_69B_BLACKLIST_MANUAL_JOB_NAME && (j.data as Sat69BSyncJobData)?.organizationId === membership.organizationId)

    if (runningForOrg) {
      return NextResponse.json(
        {
          success: true,
          deduplicated: true,
          message: 'Ya existe una sincronización en curso',
          jobId: runningForOrg.id,
          reqId
        },
        { status: 202, headers: { 'X-Request-Id': reqId } }
      )
    }

    const job = await getSat69BBlacklistQueue().add(
      SAT_69B_BLACKLIST_MANUAL_JOB_NAME,
      {
        triggeredByUserId: session.user.id,
        organizationId: membership.organizationId,
        requestedAt: new Date().toISOString(),
        requestId: reqId
      },
      {
        removeOnComplete: 10,
        removeOnFail: 20,
        jobId: `${SAT_69B_BLACKLIST_MANUAL_JOB_NAME}-${membership.organizationId}-${Date.now()}`
      }
    )

    return NextResponse.json(
      {
        success: true,
        message: 'Sincronización 69-B encolada correctamente',
        jobId: job.id,
        reqId
      },
      { headers: { 'X-Request-Id': reqId } }
    )
  } catch (error) {
    console.error('[admin-sat-69b-sync 500]', {
      reqId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json(
      { error: 'Error interno del servidor', reqId },
      { status: 500, headers: { 'X-Request-Id': reqId } }
    )
  }
}

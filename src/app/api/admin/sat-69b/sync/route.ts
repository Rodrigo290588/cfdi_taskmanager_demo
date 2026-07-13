import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sat69BBlacklistQueue } from '@/lib/queue'

const SAT_69B_BLACKLIST_MANUAL_JOB_NAME = 'sat-69b-blacklist-sync-manual'

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const membership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: {
        organization: true
      }
    })

    if (!membership?.organization) {
      return NextResponse.json({ error: 'No perteneces a ninguna organización' }, { status: 404 })
    }

    const isOwner = membership.organization.ownerId === session.user.id
    const isAdmin = membership.role === 'ADMIN'

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'No tienes permisos para ejecutar esta sincronización' }, { status: 403 })
    }

    const job = await sat69BBlacklistQueue.add(
      SAT_69B_BLACKLIST_MANUAL_JOB_NAME,
      {
        triggeredByUserId: session.user.id,
        organizationId: membership.organizationId,
        requestedAt: new Date().toISOString()
      },
      {
        removeOnComplete: 10,
        removeOnFail: 20
      }
    )

    return NextResponse.json({
      success: true,
      message: 'Sincronización 69-B encolada correctamente',
      jobId: job.id
    })
  } catch (error) {
    console.error('Admin SAT 69-B sync enqueue error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

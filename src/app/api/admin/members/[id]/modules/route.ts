import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await context.params

    const target = await prisma.member.findUnique({ where: { id } })
    if (!target) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })
    }

    const requester = await prisma.member.findUnique({
      where: {
        userId_organizationId: {
          userId: session.user.id,
          organizationId: target.organizationId
        }
      },
      include: { organization: true }
    })

    if (!requester) {
      return NextResponse.json({ error: 'No tienes acceso a esta organización' }, { status: 403 })
    }

    const flags = {
      canViewEmission: target.canViewEmission,
      canViewReception: target.canViewReception,
      canViewPayroll: target.canViewPayroll,
      canViewSatPortal: target.canViewSatPortal,
      canViewMassDownloads: target.canViewMassDownloads,
      canManageOrg: target.canManageOrg,
    }
    return NextResponse.json({ success: true, modules: flags })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json()
    const {
      canViewEmission,
      canViewReception,
      canViewPayroll,
      canViewSatPortal,
      canViewMassDownloads,
      canManageOrg,
    } = body as Partial<{
      canViewEmission: boolean
      canViewReception: boolean
      canViewPayroll: boolean
      canViewSatPortal: boolean
      canViewMassDownloads: boolean
      canManageOrg: boolean
    }>

    const target = await prisma.member.findUnique({ where: { id } })
    if (!target) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })
    }

    const requester = await prisma.member.findUnique({
      where: {
        userId_organizationId: {
          userId: session.user.id,
          organizationId: target.organizationId
        }
      },
      include: { organization: true }
    })

    if (!requester) {
      return NextResponse.json({ error: 'No tienes acceso a esta organización' }, { status: 403 })
    }

    const isOwner = requester.organization.ownerId === session.user.id
    const isAdmin = requester.role === 'ADMIN'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Sin permisos para configurar módulos' }, { status: 403 })
    }

    const data: Record<string, boolean> = {}
    if (typeof canViewEmission === 'boolean') data.canViewEmission = canViewEmission
    if (typeof canViewReception === 'boolean') data.canViewReception = canViewReception
    if (typeof canViewPayroll === 'boolean') data.canViewPayroll = canViewPayroll
    if (typeof canViewSatPortal === 'boolean') data.canViewSatPortal = canViewSatPortal
    if (typeof canViewMassDownloads === 'boolean') data.canViewMassDownloads = canViewMassDownloads
    if (typeof canManageOrg === 'boolean') data.canManageOrg = canManageOrg

    await prisma.member.update({
      where: { id: target.id },
      data
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

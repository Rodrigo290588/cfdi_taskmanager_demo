import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { role } = body as { role?: 'ADMIN' | 'VIEWER' }
    if (!role || !['ADMIN', 'VIEWER'].includes(role)) {
      return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
    }

    const { id } = await context.params

    const targetMember = await prisma.member.findUnique({
      where: { id },
      include: { organization: true }
    })

    if (!targetMember) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })
    }

    const requesterMembership = await prisma.member.findFirst({
      where: { 
        userId: session.user.id, 
        status: 'APPROVED',
        organizationId: targetMember.organizationId
      },
      include: { organization: true }
    })

    if (!requesterMembership?.organization) {
      return NextResponse.json({ error: 'No tienes acceso a esta organización' }, { status: 403 })
    }

    const isOwner = requesterMembership.organization.ownerId === session.user.id
    const isAdmin = requesterMembership.role === 'ADMIN'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Sin permisos para asignar roles' }, { status: 403 })
    }

    const updated = await prisma.member.update({
      where: { id: targetMember.id },
      data: { role },
      include: { user: { select: { name: true, email: true } } }
    })

    return NextResponse.json({
      success: true,
      member: {
        id: updated.id,
        userId: updated.userId,
        name: updated.user?.name || updated.userId,
        email: updated.user?.email,
        role: updated.role,
        status: updated.status
      }
    })
  } catch (error) {
    console.error('Error updating member role:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

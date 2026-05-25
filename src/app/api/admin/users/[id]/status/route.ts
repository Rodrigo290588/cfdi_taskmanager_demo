import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id: membershipId } = await context.params
    const body = await request.json()
    const { status } = body

    if (!['APPROVED', 'INACTIVE'].includes(status)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    }

    // Verify permission
    const adminMembership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: { organization: true }
    })

    if (!adminMembership || (adminMembership.organization.ownerId !== session.user.id && adminMembership.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'No tienes permisos para realizar esta acción' }, { status: 403 })
    }

    // Ensure we are modifying a member of the same organization
    const targetMember = await prisma.member.findUnique({
      where: { id: membershipId }
    })

    if (!targetMember || targetMember.organizationId !== adminMembership.organizationId) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Prevent modifying the owner
    if (targetMember.userId === adminMembership.organization.ownerId) {
      return NextResponse.json({ error: 'No puedes inactivar al dueño de la organización' }, { status: 403 })
    }

    // Prevent self-inactivation
    if (targetMember.userId === session.user.id) {
      return NextResponse.json({ error: 'No puedes cambiar tu propio estado' }, { status: 403 })
    }

    await prisma.member.update({
      where: { id: membershipId },
      data: { status }
    })

    // If inactivating, we must forcefully kill their current active sessions
    if (status === 'INACTIVE') {
      await prisma.session.deleteMany({
        where: { userId: targetMember.userId }
      })
    }

    return NextResponse.json({ success: true, message: 'Estado actualizado correctamente' })

  } catch (error) {
    console.error('Update user status error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

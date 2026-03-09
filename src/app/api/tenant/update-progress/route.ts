import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { updateTenantProgress } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'

export async function POST() {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    // Get user's current organization
    const membership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: { equals: 'APPROVED' }
      },
      include: {
        organization: true
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'No perteneces a ninguna organización' },
        { status: 404 }
      )
    }

    // Only organization owner can update tenant progress
    if (membership.organization.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: 'No tienes permisos para actualizar la configuración del tenant' },
        { status: 403 }
      )
    }

    const organizationId = membership.organizationId
    
    // Update tenant progress
    await updateTenantProgress(organizationId)

    return NextResponse.json({
      success: true,
      message: 'Progreso del tenant actualizado exitosamente'
    })

  } catch (error) {
    console.error('Update tenant progress error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
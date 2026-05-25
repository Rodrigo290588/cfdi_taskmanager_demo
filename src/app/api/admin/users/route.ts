import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Get user's organization
    const membership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: {
        organization: true
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'No perteneces a ninguna organización' }, { status: 404 })
    }

    // Solo dueños o admins pueden ver la lista (opcional, ajusta según tu lógica de negocio)
    if (membership.organization.ownerId !== session.user.id && membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'No tienes permisos para ver los usuarios' }, { status: 403 })
    }

    const activeUsers = await prisma.member.findMany({
      where: {
        organizationId: membership.organizationId,
        status: {
          in: ['APPROVED', 'INACTIVE']
        }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true
          }
        },
        customRole: {
          select: {
            id: true,
            name: true
          }
        },
        companyAccesses: {
          select: {
            companyId: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json({
      success: true,
      users: activeUsers.map(member => ({
        id: member.id,
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
        role: member.customRole ? member.customRole.name : member.role,
        roleId: member.customRoleId || member.role,
        isCustomRole: !!member.customRole,
        status: member.status,
        joinedAt: member.createdAt,
        companyIds: member.companyAccesses.map(ca => ca.companyId)
      }))
    })

  } catch (error) {
    console.error('Get active users error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

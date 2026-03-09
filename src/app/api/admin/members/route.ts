import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: {
        organization: true
      }
    })

    if (!member?.organization) {
      return NextResponse.json({ members: [] }, { status: 200 })
    }

    const members = await prisma.member.findMany({
      where: { organizationId: member.organization.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({
      members: members.map(m => ({
        id: m.id,
        userId: m.userId,
        name: m.user?.name || m.user.email,
        email: m.user.email,
        image: m.user.image,
        role: m.role === 'AUDITOR' ? 'VIEWER' : m.role,
        status: m.status,
        createdAt: m.createdAt
      }))
    })
  } catch (error) {
    console.error('Error fetching members:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

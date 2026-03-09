import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Get user's organization through membership
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
      return NextResponse.json({ companies: [] }, { status: 200 })
    }

    const isOwner = member.organization.ownerId === session.user.id
    const isAdmin = member.role === 'ADMIN'

    let companies

    if (isOwner || isAdmin) {
      const members = await prisma.member.findMany({
        where: {
          organizationId: member.organization.id,
          status: 'APPROVED'
        },
        select: { userId: true }
      })

      const userIds = members.map(m => m.userId)

      companies = await prisma.company.findMany({
        where: { createdBy: { in: userIds } },
        select: { id: true, rfc: true, businessName: true, status: true, name: true },
        orderBy: { createdAt: 'desc' }
      })
    } else {
      const access = await prisma.$queryRaw<Array<{ company_id: string }>>`
        SELECT company_id FROM company_access WHERE member_id = ${member.id}
      `
      const companyIds = access.map(a => a.company_id)
      companies = await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: { id: true, rfc: true, businessName: true, status: true, name: true },
        orderBy: { createdAt: 'desc' }
      })
    }

    return NextResponse.json({
      companies: companies.map(company => ({
        id: company.id,
        rfc: company.rfc,
        businessName: company.businessName || company.name,
        isActive: company.status === 'APPROVED'
      }))
    })

  } catch (error) {
    console.error('Error fetching tenant companies:', error)
    return NextResponse.json({ 
      error: 'Error interno del servidor',
      details: error instanceof Error ? error.message : 'Error desconocido'
    }, { status: 500 })
  }
}

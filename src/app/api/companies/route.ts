import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'

export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    // Get user to check role
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          include: {
            organization: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    let companiesResult: Awaited<ReturnType<typeof prisma.company.findMany>> = []
    if (user.systemRole === 'SUPER_ADMIN' || user.systemRole === 'ADMIN') {
      companiesResult = await prisma.company.findMany({ orderBy: { createdAt: 'desc' } })
    } else {
    // Ensure membership is approved and belongs to an org
      const member = await prisma.member.findFirst({
        where: { userId: user.id, status: 'APPROVED' },
        include: { organization: true }
      })

      if (!member?.organization) {
        companiesResult = []
      } else {
        const isOwner = member.organization.ownerId === user.id
        const isAdmin = member.role === 'ADMIN'

        if (isOwner || isAdmin) {
          const members = await prisma.member.findMany({
            where: { organizationId: member.organization.id, status: 'APPROVED' },
            select: { userId: true }
          })
          const userIds = members.map(m => m.userId)
          companiesResult = await prisma.company.findMany({
            where: { createdBy: { in: userIds } },
            orderBy: { createdAt: 'desc' }
          })
        } else {
          const access = await prisma.$queryRaw<Array<{ company_id: string }>>`
            SELECT company_id FROM company_access WHERE member_id = ${member.id}
          `
          const companyIds = access.map(a => a.company_id)
          companiesResult = await prisma.company.findMany({
            where: { id: { in: companyIds } },
            orderBy: { createdAt: 'desc' }
          })
        }
      }
    }

    return NextResponse.json({
      companies: companiesResult.map(company => ({
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        businessName: company.businessName,
        status: company.status,
        createdAt: company.createdAt,
        approvedAt: company.approvedAt,
        approvedBy: company.approvedBy,
        rejectionReason: company.rejectionReason,
      }))
    })

  } catch (error) {
    console.error('Error fetching companies:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

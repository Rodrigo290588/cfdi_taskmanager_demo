import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('orgId') || undefined

    const membership = await prisma.member.findFirst({
      where: orgId
        ? { userId: session.user.id, organizationId: orgId, status: 'APPROVED' }
        : { userId: session.user.id, status: 'APPROVED' },
    })

    if (!membership) {
      return NextResponse.json({ hasAccess: false, companies: [] }, { status: 200 })
    }

    const accessRows = await prisma.companyAccess.findMany({
      where: { memberId: membership.id },
      include: {
        company: {
          select: {
            id: true,
            rfc: true,
            businessName: true,
            status: true,
            name: true
          }
        }
      }
    })

    const companies = accessRows
      .filter(row => Boolean(row.company))
      .map(row => ({
        id: row.company!.id,
        rfc: row.company!.rfc,
        businessName: row.company!.businessName || row.company!.name,
        isActive: row.company!.status === 'APPROVED',
        role: row.role
      }))

    return NextResponse.json({
      hasAccess: companies.length > 0,
      companies
    })
  } catch (error) {
    console.error('Error fetching user company access:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

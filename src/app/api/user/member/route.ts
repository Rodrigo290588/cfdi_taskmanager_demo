import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const orgId = request.nextUrl.searchParams.get('orgId') ?? undefined

    const member = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED',
        ...(orgId ? { organizationId: orgId } : {})
      }
    })

    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      member: {
        id: member.id,
        organizationId: member.organizationId,
        canViewEmission: member.canViewEmission,
        canViewReception: member.canViewReception,
        canViewPayroll: member.canViewPayroll,
        canViewSatPortal: member.canViewSatPortal,
        canViewMassDownloads: member.canViewMassDownloads,
        canManageOrg: member.canManageOrg,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

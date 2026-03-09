import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getTenantStatus, checkOperationalAccess, getOnboardingSteps } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { JsonValue } from '@prisma/client/runtime/library'

export async function GET() {
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

    const organizationId = membership.organizationId
    const tenantStatus = await getTenantStatus(organizationId)
    const hasOperationalAccess = await checkOperationalAccess(organizationId)
    const onboardingSteps = getOnboardingSteps()

    return NextResponse.json({
      success: true,
      tenant: {
        organizationId,
        organizationName: membership.organization.name,
        ownerId: membership.organization.ownerId,
        isOwner: membership.organization.ownerId === session.user.id,
        status: tenantStatus,
        hasOperationalAccess,
        onboardingSteps,
        userOnboarding: {
          step: (session.user as { onboardingStep?: string }).onboardingStep,
          data: (session.user as { onboardingData?: JsonValue }).onboardingData
        }
      }
    })

  } catch (error) {
    console.error('Tenant status error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
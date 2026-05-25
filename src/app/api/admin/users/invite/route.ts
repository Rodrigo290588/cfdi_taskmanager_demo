import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { inviteUserToOrganization } from '@/lib/user-invitation-service'

const inviteUserSchema = z.object({
  email: z.string().email('Correo electrónico inválido'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  roleId: z.string(), // ID del rol (puede ser del sistema o personalizado)
  companyIds: z.array(z.string()).optional().default([]),
  providerRfc: z.string().optional(),
  providerName: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = inviteUserSchema.parse(body)
    const { email, name, roleId, companyIds, providerRfc, providerName } = validatedData

    // Get user's organization
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

    // Only organization owner can invite users
    if (membership.organization.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: 'No tienes permisos para invitar usuarios' },
        { status: 403 }
      )
    }

    const invitation = await inviteUserToOrganization({
      organizationId: membership.organizationId,
      invitedByUserId: session.user.id,
      email,
      name,
      roleId,
      companyIds,
      providerRfc,
      providerName
    })

    return NextResponse.json({
      success: true,
      message: 'Usuario invitado exitosamente',
      existingUser: invitation.existingUser,
      invitationToken: invitation.invitationToken // Returned ONLY once so the admin can copy it immediately
    })

  } catch (error) {
    console.error('Invite user error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Datos inválidos',
          details: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    // Get user's organization
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

    // Only organization owner can view pending invitations
    if (membership.organization.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: 'No tienes permisos para ver las invitaciones' },
        { status: 403 }
      )
    }

    const pendingInvitations = await prisma.member.findMany({
      where: {
        organizationId: membership.organizationId,
        status: { in: ['PENDING', 'ONBOARDING'] }
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
        }
      }
    })

    return NextResponse.json({
      success: true,
      invitations: pendingInvitations.map(invitation => ({
        id: invitation.id,
        userId: invitation.userId,
        name: invitation.user.name,
        email: invitation.user.email,
        role: invitation.customRole ? invitation.customRole.name : invitation.role,
        isCustomRole: !!invitation.customRole,
        status: invitation.status,
        invitedAt: invitation.createdAt,
        // We do not return the token here because we only store the hash
        // invitationToken: invitation.invitationTokenHash
      }))
    })

  } catch (error) {
    console.error('Get invitations error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

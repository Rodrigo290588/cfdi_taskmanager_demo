import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

const inviteUserSchema = z.object({
  email: z.string().email('Correo electrónico inválido'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  role: z.enum(['ADMIN', 'AUDITOR', 'VIEWER']).default('VIEWER'),
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
    const { email, name, role } = validatedData

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

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      // Check if user is already a member of the organization
      const existingMembership = await prisma.member.findFirst({
        where: {
          userId: existingUser.id,
          organizationId: membership.organizationId
        }
      })

      if (existingMembership) {
        return NextResponse.json(
          { error: 'El usuario ya es miembro de esta organización' },
          { status: 409 }
        )
      }

      // Create membership for existing user
      await prisma.member.create({
        data: {
          userId: existingUser.id,
          organizationId: membership.organizationId,
          role: role,
          status: 'PENDING',
          invitationToken: crypto.randomUUID(),
        }
      })

      return NextResponse.json({
        success: true,
        message: 'Usuario invitado exitosamente',
        existingUser: true
      })
    }

    // Create new user with PENDING status
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        systemRole: 'USER',
        onboardingStep: 'ORGANIZATION_INVITATION',
        onboardingData: {
          invitedBy: session.user.id,
          invitedAt: new Date(),
          organizationId: membership.organizationId
        }
      }
    })

    // Create membership
    await prisma.member.create({
      data: {
        userId: newUser.id,
        organizationId: membership.organizationId,
        role: role,
        status: 'PENDING',
        invitationToken: crypto.randomUUID(),
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Usuario invitado exitosamente',
      existingUser: false
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
        status: 'PENDING'
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true
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
        role: invitation.role,
        status: invitation.status,
        invitedAt: invitation.createdAt,
        invitationToken: invitation.invitationToken
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
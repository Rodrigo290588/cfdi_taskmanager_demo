import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token no proporcionado' }, { status: 400 })
    }

    // Hasheamos el token recibido para buscarlo en la DB
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const membership = await prisma.member.findFirst({
      where: {
        invitationTokenHash: tokenHash,
        status: 'PENDING',
        invitationExpiresAt: {
          gt: new Date() // Aseguramos que no haya expirado
        }
      },
      include: {
        organization: true,
        user: true
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'La invitación no es válida, ha expirado o ya ha sido aceptada' },
        { status: 404 }
      )
    }

    // Check if user already has a password (means they are an existing user)
    const needsPassword = !membership.user.password

    return NextResponse.json({
      success: true,
      data: {
        organizationName: membership.organization.name,
        userEmail: membership.user.email,
        userName: membership.user.name,
        needsPassword
      }
    })

  } catch (error) {
    console.error('Verify invite error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

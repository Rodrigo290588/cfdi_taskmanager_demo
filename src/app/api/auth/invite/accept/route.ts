import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { SignJWT } from 'jose'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token } = body

    if (!token) {
      return NextResponse.json({ error: 'Token no proporcionado' }, { status: 400 })
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const membership = await prisma.member.findFirst({
      where: {
        invitationTokenHash: tokenHash,
        status: 'PENDING',
        invitationExpiresAt: { gt: new Date() }
      },
      include: {
        user: true
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'La invitación no es válida, expiró o ya fue aceptada' },
        { status: 404 }
      )
    }

    const needsPassword = !membership.user.password

    // Transaction to safely consume the token
    await prisma.$transaction(async (tx) => {
      // If user doesn't need password (already exists), approve directly
      if (!needsPassword) {
        await tx.member.update({
          where: { id: membership.id },
          data: {
            status: 'APPROVED',
            invitationTokenHash: null, // Destruimos el token
            invitationExpiresAt: null,
            approvedAt: new Date()
          }
        })
      }
      // If they need password, we DO NOT destroy the token yet.
      // We leave them as PENDING so they can click the link again if they abandon the page.
    })

    // If no password needed, just return success so frontend redirects to login
    if (!needsPassword) {
      return NextResponse.json({ success: true, redirect: '/auth/signin' })
    }

    // If password needed, create a short-lived signed HttpOnly cookie to transfer context securely
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev')
    const sessionToken = await new SignJWT({ userId: membership.userId, memberId: membership.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m') // 10 minutes lifespan
      .sign(secret)

    const response = NextResponse.json({ success: true, redirect: '/auth/complete-registration' })
    
    // Set secure cookie
    response.cookies.set({
      name: 'invite_session',
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10 // 10 mins
    })

    return response

  } catch (error) {
    console.error('Consume invite error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

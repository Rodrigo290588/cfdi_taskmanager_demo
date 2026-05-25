import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { jwtVerify } from 'jose'
import { validatePasswordStrength } from '@/lib/password-validator'

export async function POST(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('invite_session')
    
    if (!sessionCookie?.value) {
      return NextResponse.json(
        { error: 'Sesión de registro inválida o expirada' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { password } = body

    // Verify the JWT session token
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev')
    const { payload } = await jwtVerify(sessionCookie.value, secret)
    
    const userId = payload.userId as string
    const memberId = payload.memberId as string

    if (!userId || !memberId) {
      return NextResponse.json({ error: 'Token malformado' }, { status: 400 })
    }

    // Retrieve user name and email for validation
    const user = await prisma.user.findUnique({ where: { id: userId } })
    const validationResult = validatePasswordStrength(password, user?.name || '', user?.email || '')

    if (!validationResult.valida) {
      // Returning exact requested JSON format for invalid passwords
      return NextResponse.json(validationResult, { status: 400 })
    }

    // Transaction to set password and fully approve member
    await prisma.$transaction(async (tx) => {
      // 1. Update the user with the new password
      const hashedPassword = await bcrypt.hash(password, 10)
      await tx.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          emailVerified: new Date(),
          onboardingStep: 'COMPLETED'
        }
      })

      // 2. Mark the membership as fully APPROVED and destroy the token
      await tx.member.update({
        where: { id: memberId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          invitationTokenHash: null,
          invitationExpiresAt: null
        }
      })
    })

    // Delete the temporary cookie
    const response = NextResponse.json({ success: true, redirect: '/auth/signin' })
    response.cookies.delete('invite_session')

    return response

  } catch (error) {
    console.error('Complete registration error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor al completar el registro' },
      { status: 500 }
    )
  }
}

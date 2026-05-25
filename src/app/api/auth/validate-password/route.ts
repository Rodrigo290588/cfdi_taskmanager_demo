import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from '@/lib/prisma'
import { validatePasswordStrength } from '@/lib/password-validator'

export async function POST(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('invite_session')
    let userName = ''
    let userEmail = ''

    if (sessionCookie?.value) {
      try {
        const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev')
        const { payload } = await jwtVerify(sessionCookie.value, secret)
        if (payload.userId) {
          const user = await prisma.user.findUnique({ where: { id: payload.userId as string } })
          if (user) {
            userName = user.name || ''
            userEmail = user.email || ''
          }
        }
      } catch {
        // ignore
      }
    }

    const { password } = await request.json()

    const validationResult = validatePasswordStrength(password, userName, userEmail)

    return NextResponse.json(validationResult)

  } catch {
    return NextResponse.json({
      valida: false,
      nivel_fuerza: "Debil",
      errores: ["Error interno al validar la contraseña"],
      sugerencia: "Intenta de nuevo más tarde."
    })
  }
}


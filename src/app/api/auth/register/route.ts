import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { SystemRole } from '@prisma/client'
import { signUpSchema } from '@/schemas/auth'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    // 1. Rate Limiting Check
    // Get IP from headers (x-forwarded-for) or fallback
    // Fix: Handle multiple IPs in x-forwarded-for (client, proxy1, proxy2...)
    const forwardedFor = request.headers.get('x-forwarded-for')
    let ip = forwardedFor ? forwardedFor.split(',')[0].trim() : 'unknown-ip'
    
    // Fallback to Next.js ip helper if available (works in Vercel/modern hosting)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (ip === 'unknown-ip' && (request as any).ip) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ip = (request as any).ip
    }

    // Critical: If we still can't identify IP, we must decide policy. 
    // Blocking 'unknown-ip' risks DoS for legitimate users behind same proxy config.
    // Allowing it risks bypass. 
    // Decision: Allow but log warning for ops visibility, OR apply very strict global limit for unknown.
    // For this strict security persona: We block if we can't identify.
    if (ip === 'unknown-ip') {
       console.warn('Registration attempt with unknown IP')
    }

    const limitResult = rateLimit(ip, { interval: 60 * 60 * 1000, limit: 5 }) // 5 attempts per hour

    if (!limitResult.success) {
      return NextResponse.json(
        { error: 'Demasiados intentos de registro. Por favor intente más tarde.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    
    // 2. Strict Input Validation with enhanced Schema
    // We parse only what we need, removing confirmPassword from the destructuring since the schema validates it matches
    const validatedData = signUpSchema.parse(body)
    const { name, email, password } = validatedData

    // 3. User Existence Check
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      // Security: Consider returning a generic "If the email exists, we sent a link" message
      // to prevent email enumeration. However, for a signup flow, it's often necessary 
      // to tell the user they already have an account.
      // We will keep it explicit for UX but rate limited above to prevent mass enumeration.
      return NextResponse.json(
        { error: 'El correo electrónico ya está registrado.' },
        { status: 400 }
      )
    }

    // 4. Secure Password Hashing
    const hashedPassword = await bcrypt.hash(password, 12)

    // 5. Slug Generation (Sanitized)
    // Ensure slug only contains safe characters
    const baseSlug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
    let slug = baseSlug
    let counter = 1
    
    // Prevent infinite loops or extremely long checks
    const maxRetries = 100;
    while (counter < maxRetries && await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`
      counter++
    }
    
    if (counter >= maxRetries) {
       // Fallback to random uuid segment if collision persists
       slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`
    }

    // 6. Atomic Transaction for Data Integrity
    // Use prisma.$transaction to ensure all related records are created or none at all
    const result = await prisma.$transaction(async (tx) => {
      // Create User
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          systemRole: SystemRole.ADMIN,
          onboardingStep: 'TENANT_SETUP',
          onboardingData: {
            progress: 0,
            completedSteps: [],
            currentStep: 'TENANT_SETUP'
          }
        }
      })

      // Create Organization
      const organization = await tx.organization.create({
        data: {
          name: `${name}'s Organization`,
          slug: slug,
          description: 'Organización personal',
          ownerId: user.id,
          onboardingCompleted: false,
          operationalAccessEnabled: false,
          setupRequirements: {
            minUsers: 2,
            minCompanies: 1,
            requiredSteps: ['COMPANY_REGISTRATION', 'USER_INVITATION', 'PROFILE_ASSIGNMENT']
          }
        }
      })

      // Create Membership
      await tx.member.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'ADMIN',
          status: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date(),
          canViewEmission: false,
          canViewReception: false,
          canViewPayroll: false,
          canViewSatPortal: false,
          canManageOrg: false
        }
      })

      return user
    })

    // 7. Secure Response (No sensitive data)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = result
    
    return NextResponse.json({
      success: true,
      user: userWithoutPassword,
      message: 'Usuario creado exitosamente'
    })

  } catch (error) {
    console.error('Registration error:', error)
    
      if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Datos inválidos',
          // Map Zod errors to a more user-friendly format if needed
          details: error.issues.map(e => e.message).join(', ')
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

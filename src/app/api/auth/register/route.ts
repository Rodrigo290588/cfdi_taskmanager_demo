import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { SystemRole } from '@prisma/client'
import { signUpSchema } from '@/schemas/auth'
import { rateLimit, AUTH_RATE_LIMITS } from '@/lib/rate-limit'
import { createMachineClient } from '@/lib/machine-client-service'
import crypto from 'crypto'
import { PASSWORD_BCRYPT_ROUNDS, MIN_BCRYPT_ROUNDS } from '@/lib/auth-config'
import { getRealClientIp } from '@/lib/security'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = '16kb'
export const maxDuration = 30

const MAX_BODY_BYTES = 16 * 1024
const UNIFORM_REGISTER_RESP = Object.freeze({
  success: true,
  message: 'Si el correo no está registrado, la cuenta fue creada exitosamente. Las credenciales M2M serán enviadas por correo. Verifica tu bandeja de entrada.',
  nextStep: '/auth/signin'
})

const FRIENDLY_ERRORS: Record<string, string> = {
  name_min: 'El nombre es demasiado corto.',
  name_max: 'El nombre es demasiado largo.',
  name_regex: 'El nombre contiene caracteres no permitidos.',
  email_invalid: 'El formato del correo electrónico no es válido.',
  password_min: 'La contraseña no cumple con los requisitos mínimos de seguridad.',
  password_complexity: 'La contraseña no cumple con los requisitos mínimos de seguridad.',
  password_match: 'Las contraseñas no coinciden.',
  _generic: 'Uno o más campos son inválidos. Revisa la información e intenta de nuevo.'
}

function mapZodToSafe(_err: z.ZodError): { error: string; details: string } {
  const firstIssue = _err.issues[0]
  if (!firstIssue) {
    return { error: 'Datos inválidos', details: FRIENDLY_ERRORS._generic }
  }
  const path = firstIssue.path.join('.')
  const code = firstIssue.code as string
  let bucket = '_generic'
  if (path === 'name' && code === 'too_small') bucket = 'name_min'
  else if (path === 'name' && code === 'too_big') bucket = 'name_max'
  else if (path === 'name' && (code === 'invalid_string' || code === 'custom')) bucket = 'name_regex'
  else if (path === 'email') bucket = 'email_invalid'
  else if (path === 'password' && code === 'too_small') bucket = 'password_min'
  else if (path === 'password' && (code === 'invalid_string' || code === 'custom')) bucket = 'password_complexity'
  else if (path === 'confirmPassword') bucket = 'password_match'
  return { error: 'Datos inválidos', details: FRIENDLY_ERRORS[bucket] || FRIENDLY_ERRORS._generic }
}

export async function POST(request: NextRequest) {
  const startTs = Date.now()
  const res = NextResponse.next()
  Object.entries(SAT_SECURITY_HEADERS).forEach(([k, v]) => res.headers.set(k, v))
  res.headers.set('Cache-Control', 'no-store, private, no-cache, max-age=0')

  try {
    const ip = getRealClientIp(request.headers)

    const contentLenRaw = request.headers.get('content-length')
    const contentLen = contentLenRaw ? Number(contentLenRaw) : NaN
    if (Number.isFinite(contentLen) && contentLen > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload excede tamaño permitido' }, { status: 413, headers: res.headers })
    }

    const rawBodyBuf = await request.arrayBuffer()
    if (rawBodyBuf.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload excede tamaño permitido' }, { status: 413, headers: res.headers })
    }

    let body: unknown
    try {
      body = JSON.parse(Buffer.from(rawBodyBuf).toString('utf8') || '{}')
    } catch {
      return NextResponse.json({ error: 'Payload JSON inválido' }, { status: 400, headers: res.headers })
    }

    const validatedData = signUpSchema.safeParse(body)
    if (!validatedData.success) {
      return NextResponse.json(mapZodToSafe(validatedData.error), { status: 400, headers: res.headers })
    }
    const { name, email, password } = validatedData.data
    const normalizedEmail = email.toLowerCase().trim()

    const { success: rlIpOk } = await rateLimit(ip, { interval: AUTH_RATE_LIMITS.registerIp.windowMs, limit: AUTH_RATE_LIMITS.registerIp.limit })
    if (!rlIpOk) {
      return NextResponse.json(
        { error: 'Demasiados intentos de registro. Por favor intente más tarde.' },
        { status: 429, headers: res.headers }
      )
    }

    const rlIpEmailKey = AUTH_RATE_LIMITS.registerIpEmail.key + ':' + ip + ':' + normalizedEmail
    const { success: rlIpEmailOk } = await rateLimit(rlIpEmailKey, { interval: AUTH_RATE_LIMITS.registerIpEmail.windowMs, limit: AUTH_RATE_LIMITS.registerIpEmail.limit })
    if (!rlIpEmailOk) {
      const delta = Date.now() - startTs
      if (delta < 250) await new Promise<void>((r) => setTimeout(r, 250 - delta))
      return NextResponse.json(UNIFORM_REGISTER_RESP, { status: 202, headers: res.headers })
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    })

    if (existingUser) {
      try {
        const dummySalt = 'existing-user-timing-uniform-' + crypto.randomBytes(12).toString('base64')
        await bcrypt.hash(dummySalt, MIN_BCRYPT_ROUNDS)
      } catch (bcryptErr) {
        const s = safeErrSummarySat(bcryptErr)
        console.warn('[auth:register] dummy bcrypt INACTIVO:', s.name, s.incidentFingerprint)
      }
      const delta = Date.now() - startTs
      if (delta < 250) await new Promise<void>((r) => setTimeout(r, 250 - delta))
      return NextResponse.json(UNIFORM_REGISTER_RESP, { status: 202, headers: res.headers })
    }

    const hashedPassword = await bcrypt.hash(password, PASSWORD_BCRYPT_ROUNDS)

    const localPart = normalizedEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    if (!localPart) {
      return NextResponse.json({ error: 'Email inválido para crear organización' }, { status: 400, headers: res.headers })
    }
    const baseSlug = localPart
    const collisionCount = await prisma.organization.count({ where: { slug: { startsWith: baseSlug } } })
    const slug = collisionCount === 0
      ? baseSlug
      : `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email: normalizedEmail,
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

      const organization = await tx.organization.create({
        data: {
          name: `${name}'s Organization`,
          slug,
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

      await createMachineClient(tx, {
        organizationId: organization.id,
        organizationSlug: organization.slug,
        createdByUserId: user.id,
        description: `Cliente M2M inicial para ${organization.name}`
      })

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
    })

    const delta = Date.now() - startTs
    if (delta < 250) await new Promise<void>((r) => setTimeout(r, 250 - delta))
    return NextResponse.json(UNIFORM_REGISTER_RESP, { status: 202, headers: res.headers })

  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[auth:register] fatal err name=' + safe.name + ' fp=' + safe.incidentFingerprint)

    if (error instanceof z.ZodError) {
      const safeZod = mapZodToSafe(error)
      return NextResponse.json(safeZod, { status: 400, headers: res.headers })
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: res.headers }
    )
  }
}

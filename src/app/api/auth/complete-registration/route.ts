import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { jwtVerify } from 'jose'
import { validatePasswordStrength } from '@/lib/password-validator'
import { getAuthSecretOrThrow, fingerprint, getRealClientIp } from '@/lib/security'
import { PASSWORD_BCRYPT_ROUNDS } from '@/lib/auth-config'
import crypto from 'crypto'
import { z } from 'zod'
import { rateLimit, AUTH_RATE_LIMITS } from '@/lib/rate-limit'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = '16kb'
export const maxDuration = 15

const MAX_BODY_BYTES = 16 * 1024
const BASE_MIN_RESP_MS = 42
const HKDF_SALT = 'invite-session-v1'

function deriveHmacKey(secret: Uint8Array): Uint8Array {
  const ikm = Buffer.from(secret)
  const saltBuf = Buffer.from(HKDF_SALT, 'utf8')
  const prk = crypto.createHmac('sha256', saltBuf).update(ikm).digest()
  const info = Buffer.from('invite-session-cookie-v1', 'utf8')
  const okm = crypto.createHmac('sha256', prk).update(info).digest()
  return new Uint8Array(okm)
}

function verifyAndStripCookieSig(signed: string, key: Uint8Array): string | null {
  const lastDot = signed.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === signed.length - 1) return null
  const raw = signed.slice(0, lastDot)
  const sigExpected = signed.slice(lastDot + 1)
  const hmac = crypto.createHmac('sha256', Buffer.from(key))
  hmac.update(raw)
  const sigActual = hmac.digest('base64url')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sigExpected), Buffer.from(sigActual))) return null
  } catch { return null }
  return raw
}

export async function POST(request: NextRequest) {
  const startTs = Date.now()
  const res = NextResponse.next()
  Object.entries(SAT_SECURITY_HEADERS).forEach(([k, v]) => res.headers.set(k, v))
  res.headers.set('Cache-Control', 'no-store, private, no-cache, max-age=0')

  try {
    const ip = getRealClientIp(request.headers)
    const sessionCookie = request.cookies.get('invite_session')

    if (!sessionCookie?.value) {
      return NextResponse.json(
        { error: 'Sesión de registro inválida o expirada' },
        { status: 401, headers: res.headers }
      )
    }

    const contentLenRaw = request.headers.get('content-length')
    const contentLen = contentLenRaw ? Number(contentLenRaw) : NaN
    if (Number.isFinite(contentLen) && contentLen > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload excede tamaño permitido' }, { status: 413, headers: res.headers })
    }

    const rawBodyBuf = await request.arrayBuffer()
    if (rawBodyBuf.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload excede tamaño permitido' }, { status: 413, headers: res.headers })
    }
    const rawBody = Buffer.from(rawBodyBuf).toString('utf8')

    const fpSession = fingerprint(sessionCookie.value)
    const rlKeySession = AUTH_RATE_LIMITS.completeRegId.key + ':' + fpSession
    try {
      const rl = await rateLimit(rlKeySession, { interval: AUTH_RATE_LIMITS.completeRegId.windowMs, limit: AUTH_RATE_LIMITS.completeRegId.limit })
      if (!rl.success) {
        const waitMin = Math.ceil((rl.retryAfterMs || 0) / 60000)
        return NextResponse.json(
          { error: waitMin > 0 ? `Demasiados intentos. Intenta en ${waitMin} minutos.` : 'Demasiados intentos. Intenta más tarde.' },
          { status: 429, headers: res.headers }
        )
      }
    } catch (rlErr) {
      const s = safeErrSummarySat(rlErr)
      console.warn('[auth:complete-reg] rate limit unavailable:', s.name, s.incidentFingerprint)
    }
    void ip

    let body: unknown
    try { body = rawBody ? JSON.parse(rawBody) : {} } catch {
      return NextResponse.json({ error: 'Payload JSON inválido' }, { status: 400, headers: res.headers })
    }
    const password = typeof body === 'object' && body !== null && 'password' in body ? String((body as Record<string, unknown>).password) : undefined
    const secret = getAuthSecretOrThrow()

    const hmacKey = deriveHmacKey(secret)
    const unsignedCookie = verifyAndStripCookieSig(sessionCookie.value, hmacKey) || sessionCookie.value

    let userId: string | undefined
    let memberId: string | undefined

    try {
      const { payload } = await jwtVerify(unsignedCookie, secret, {
        algorithms: ['HS256']
      })
      userId = payload.userId as string
      memberId = payload.memberId as string
    } catch (jwtErr) {
      const safe = safeErrSummarySat(jwtErr)
      console.warn(
        `[auth:complete-registration] jwt_verify_failed fp=${fpSession} errName=${safe.name} fp=${safe.incidentFingerprint}`
      )
      return NextResponse.json({ error: 'Sesión de registro inválida o expirada' }, { status: 401, headers: res.headers })
    }

    if (!userId || !memberId) {
      return NextResponse.json({ error: 'Token malformado' }, { status: 400, headers: res.headers })
    }

    const passSchema = z.object({ password: z.string().min(12).max(128) })
    const passParsed = passSchema.safeParse({ password })
    if (!passParsed.success) {
      return NextResponse.json({
        valida: false,
        nivel_fuerza: 'Debil',
        errores: ['La contraseña no cumple con los requisitos mínimos de seguridad.'],
        sugerencia: 'Debe tener al menos 12 caracteres. Máximo 128.'
      } as const, { status: 400, headers: res.headers })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    const validationResult = validatePasswordStrength(
      passParsed.data.password,
      user?.name || '',
      user?.email || ''
    )
    if (!validationResult.valida) {
      return NextResponse.json(validationResult, { status: 400, headers: res.headers })
    }

    try {
      await prisma.$transaction(async (tx) => {
        const memberLocked = await tx.$queryRawUnsafe<Array<{ user_id: string; status: string; invitation_expires_at: Date | null }>>(
          `SELECT user_id, status, invitation_expires_at FROM "Member" WHERE id = $1 FOR NO KEY UPDATE`,
          [memberId]
        )
        const member = memberLocked?.[0]
        if (!member) throw new Error('MEMBER_NOT_FOUND')
        if (member.user_id !== userId) {
          console.error(`[complete-registration] CRITICAL mismatch: member ${memberId} no pertenece a user ${userId}`)
          throw new Error('TOKEN_MISMATCH')
        }
        const validStatuses = new Set(['PENDING', 'APPROVED'])
        if (!validStatuses.has(String(member.status))) throw new Error('MEMBER_WRONG_STATUS')
        if (member.invitation_expires_at && member.invitation_expires_at < new Date()) {
          throw new Error('INVITATION_EXPIRED')
        }
        if (!user) throw new Error('USER_NOT_FOUND')
        if (user.password) {
          throw new Error('USER_ALREADY_HAS_PASSWORD')
        }
        const hashedPassword = await bcrypt.hash(passParsed.data.password, PASSWORD_BCRYPT_ROUNDS)
        await tx.user.update({
          where: { id: userId },
          data: {
            password: hashedPassword,
            emailVerified: new Date(),
            onboardingStep: 'COMPLETED'
          }
        })
        await tx.member.update({
          where: { id: memberId },
          data: {
            status: 'APPROVED',
            approvedAt: new Date(),
            approvedBy: userId,
            invitationTokenHash: null,
            invitationExpiresAt: null
          }
        })
      })
    } catch (txErr: unknown) {
      const message = txErr instanceof Error ? txErr.message : String(txErr)
      const codeMap: Record<string, { msg: string, status: number }> = {
        MEMBER_NOT_FOUND: { msg: 'La sesión de registro no es válida.', status: 404 },
        TOKEN_MISMATCH: { msg: 'Token de sesión inválido.', status: 403 },
        MEMBER_WRONG_STATUS: { msg: 'Estado de membresía inválido para completar registro.', status: 409 },
        INVITATION_EXPIRED: { msg: 'La invitación expiró. Solicita una nueva.', status: 410 },
        USER_NOT_FOUND: { msg: 'Usuario no encontrado.', status: 404 },
        USER_ALREADY_HAS_PASSWORD: { msg: 'El usuario ya tiene contraseña. Inicia sesión.', status: 409 }
      }
      const mapped = codeMap[message]
      if (mapped) {
        return NextResponse.json({ error: mapped.msg }, { status: mapped.status, headers: res.headers })
      }
      throw txErr
    }

    const delta = Date.now() - startTs
    if (delta < BASE_MIN_RESP_MS) {
      await new Promise<void>((r) => setTimeout(r, BASE_MIN_RESP_MS - delta))
    }

    const response = NextResponse.json({ success: true, redirect: '/auth/signin' }, { headers: res.headers })
    response.cookies.delete('invite_session')
    return response

  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[auth:complete-registration] fatal err name=' + safe.name + ' fp=' + safe.incidentFingerprint)
    return NextResponse.json(
      { error: 'Error interno del servidor al completar el registro' },
      { status: 500, headers: res.headers }
    )
  }
}

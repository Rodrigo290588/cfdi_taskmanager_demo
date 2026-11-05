import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from '@/lib/prisma'
import { validatePasswordStrength } from '@/lib/password-validator'
import { rateLimit, AUTH_RATE_LIMITS } from '@/lib/rate-limit'
import { z } from 'zod'
import * as crypto from 'node:crypto'
import { getAuthSecretOrThrow, getRealClientIp, fingerprint } from '@/lib/security'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = '2kb'
export const maxDuration = 10

const HKDF_SALT = 'invite-session-v1'
const MAX_BODY_BYTES = 2 * 1024

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
  if (!crypto.timingSafeEqual(Buffer.from(sigExpected), Buffer.from(sigActual))) return null
  return raw
}

function badPass(mensaje: string) {
  return {
    valida: false,
    nivel_fuerza: 'Debil' as const,
    errores: [mensaje],
    sugerencia: 'Por favor revisa los requisitos e intenta de nuevo.'
  }
}

async function applyRateLimit(request: NextRequest, baseHeaders: Headers): Promise<NextResponse | null> {
  const ip = getRealClientIp(request.headers)
  const rl = await rateLimit(
    AUTH_RATE_LIMITS.validatePassIp.key + ':' + ip,
    { interval: AUTH_RATE_LIMITS.validatePassIp.windowMs, limit: AUTH_RATE_LIMITS.validatePassIp.limit }
  )
  if (!rl.success) {
    return NextResponse.json(badPass('Demasiadas solicitudes. Intenta más tarde.'), { status: 429, headers: baseHeaders })
  }
  return null
}

async function extractPasswordFromBody(request: NextRequest, baseHeaders: Headers): Promise<{ password?: string, errorResponse?: NextResponse }> {
  const contentLenRaw = request.headers.get('content-length')
  const contentLen = contentLenRaw ? Number.parseInt(contentLenRaw, 10) : Number.NaN
  if (Number.isFinite(contentLen) && contentLen > MAX_BODY_BYTES) {
    return { errorResponse: NextResponse.json(badPass('Payload excede tamaño permitido'), { status: 413, headers: baseHeaders }) }
  }

  const rawBodyBuf = await request.arrayBuffer()
  if (rawBodyBuf.byteLength > MAX_BODY_BYTES) {
    return { errorResponse: NextResponse.json(badPass('Payload excede tamaño permitido'), { status: 413, headers: baseHeaders }) }
  }
  const rawBody = Buffer.from(rawBodyBuf).toString('utf8')

  const schema = z.object({ password: z.string().max(128) })
  try {
    const parsed = schema.parse(rawBody.length ? JSON.parse(rawBody) : {})
    return { password: parsed.password }
  } catch {
    return { errorResponse: NextResponse.json(badPass('Datos inválidos'), { status: 400, headers: baseHeaders }) }
  }
}

async function getUserFromSession(request: NextRequest): Promise<{ userName: string, userEmail: string }> {
  const sessionCookie = request.cookies.get('invite_session')
  if (!sessionCookie?.value) {
    return { userName: '', userEmail: '' }
  }

  try {
    const secret = getAuthSecretOrThrow()
    const hmacKey = deriveHmacKey(secret)
    const unsignedToken = verifyAndStripCookieSig(sessionCookie.value, hmacKey) || sessionCookie.value
    const { payload } = await jwtVerify(unsignedToken, secret, { algorithms: ['HS256'] })
    
    if (payload.userId) {
      const user = await prisma.user.findUnique({ where: { id: payload.userId as string } })
      if (user) {
        return { userName: user.name || '', userEmail: user.email || '' }
      }
    }
  } catch (jwtErr) {
    const ip = getRealClientIp(request.headers)
    const fp = fingerprint(sessionCookie.value)
    const ua = (request.headers.get('user-agent') || '').slice(0, 96)
    const safe = safeErrSummarySat(jwtErr)
    console.warn(
      `[auth:validate-password] jwt_verify_failed fp=${fp} ip=${ip.slice(0, 32)} ua=${ua.slice(0, 64)} name=${safe.name} safeFp=${safe.incidentFingerprint}`
    )
  }
  
  return { userName: '', userEmail: '' }
}

export async function POST(request: NextRequest) {
  const baseHeaders = new Headers()
  Object.entries(SAT_SECURITY_HEADERS).forEach(([k, v]) => baseHeaders.set(k, v))
  baseHeaders.set('Cache-Control', 'no-store, private, no-cache, max-age=0')

  try {
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return NextResponse.json(badPass('Solicitud inválida'), { status: 415, headers: baseHeaders })
    }

    const rateLimitError = await applyRateLimit(request, baseHeaders)
    if (rateLimitError) return rateLimitError

    const { password, errorResponse } = await extractPasswordFromBody(request, baseHeaders)
    if (errorResponse || !password) return errorResponse as NextResponse

    const { userName, userEmail } = await getUserFromSession(request)

    return NextResponse.json(validatePasswordStrength(password, userName, userEmail), { headers: baseHeaders })

  } catch (err) {
    const safe = safeErrSummarySat(err)
    console.error('[auth:validate-password] fatal err name=' + safe.name + ' fp=' + safe.incidentFingerprint)
    return NextResponse.json({
      valida: false,
      nivel_fuerza: "Debil" as const,
      errores: ["Error interno al validar la contraseña"],
      sugerencia: "Intenta de nuevo más tarde."
    }, { status: 500, headers: baseHeaders })
  }
}

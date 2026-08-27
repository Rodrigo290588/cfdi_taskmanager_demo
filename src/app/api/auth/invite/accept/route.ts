import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { SignJWT } from 'jose'
import { getAuthSecretOrThrow, getPublicHostsAllowlist, getRealClientIp, fingerprint } from '@/lib/security'
import { rateLimit, AUTH_RATE_LIMITS } from '@/lib/rate-limit'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = '16kb'
export const maxDuration = 15

const MAX_BODY_BYTES = 16 * 1024
const HKDF_SALT = 'invite-session-v1'
const TOKEN_ALLOWED_RE = /^[A-Za-z0-9\-_]{8,128}$/
const BASE_MIN_RESP_MS = 42

function deriveHmacKey(secret: Uint8Array): Uint8Array {
  const ikm = Buffer.from(secret)
  const saltBuf = Buffer.from(HKDF_SALT, 'utf8')
  const prk = crypto.createHmac('sha256', saltBuf).update(ikm).digest()
  const info = Buffer.from('invite-session-cookie-v1', 'utf8')
  const okm = crypto.createHmac('sha256', prk).update(info).digest()
  return new Uint8Array(okm)
}

function signCookieValue(rawToken: string, key: Uint8Array): string {
  const hmac = crypto.createHmac('sha256', Buffer.from(key))
  hmac.update(rawToken)
  const sig = hmac.digest('base64url')
  return rawToken + '.' + sig
}

function checkOriginOrReferer(headers: Headers): boolean {
  const allowlist = getPublicHostsAllowlist()
  const origin = headers.get('origin')
  if (origin) {
    try {
      const u = new URL(origin)
      if (allowlist.has(u.host.toLowerCase())) return true
    } catch { /* fallthrough */ }
  }
  const referer = headers.get('referer')
  if (referer) {
    try {
      const u = new URL(referer)
      if (allowlist.has(u.host.toLowerCase())) return true
    } catch { /* fallthrough */ }
  }
  const host = headers.get('host')?.trim().toLowerCase()
  if (host && allowlist.has(host)) return true
  return false
}

export async function POST(request: NextRequest) {
  const startTs = Date.now()
  const res = NextResponse.next()
  Object.entries(SAT_SECURITY_HEADERS).forEach(([k, v]) => res.headers.set(k, v))
  res.headers.set('Cache-Control', 'no-store, private, no-cache, max-age=0')

  try {
    const ip = getRealClientIp(request.headers)

    if (!checkOriginOrReferer(request.headers)) {
      console.warn('[auth:invite-accept] CSRF origin/referer mismatch ip=' + ip.slice(0, 32))
      return NextResponse.json({ error: 'Solicitud no autorizada (CSRF).' }, { status: 403, headers: res.headers })
    }

    try {
      await rateLimit(
        AUTH_RATE_LIMITS.inviteAcceptIp.key + ':' + ip,
        { interval: AUTH_RATE_LIMITS.inviteAcceptIp.windowMs, limit: AUTH_RATE_LIMITS.inviteAcceptIp.limit }
      )
    } catch { /* best effort */ }

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
    try { body = JSON.parse(Buffer.from(rawBodyBuf).toString('utf8') || '{}') } catch {
      return NextResponse.json({ error: 'Payload JSON inválido' }, { status: 400, headers: res.headers })
    }
    const tokenRaw = typeof body === 'object' && body !== null && 'token' in body ? (body as Record<string, unknown>).token : undefined
    const token = typeof tokenRaw === 'string' && TOKEN_ALLOWED_RE.test(tokenRaw) ? tokenRaw : null

    if (!token) {
      return NextResponse.json({ error: 'Token no proporcionado o formato inválido' }, { status: 400, headers: res.headers })
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const membership = await prisma.member.findFirst({
      where: {
        invitationTokenHash: tokenHash,
        status: 'PENDING',
        invitationExpiresAt: { gt: new Date() }
      },
      include: { user: true }
    })

    if (!membership) {
      const delta = Date.now() - startTs
      if (delta < BASE_MIN_RESP_MS) await new Promise<void>((r) => setTimeout(r, BASE_MIN_RESP_MS - delta))
      return NextResponse.json(
        { error: 'La invitación no es válida, expiró o ya fue aceptada' },
        { status: 404, headers: res.headers }
      )
    }

    const needsPassword = !membership.user.password

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.member.updateMany({
          where: {
            id: membership.id,
            status: 'PENDING',
            invitationTokenHash: { not: null }
          },
          data: {
            status: needsPassword ? 'PENDING' : 'APPROVED',
            invitationTokenHash: null,
            invitationExpiresAt: needsPassword ? new Date(Date.now() + 1000 * 60 * 15) : null,
            approvedAt: !needsPassword ? new Date() : undefined,
            approvedBy: !needsPassword ? membership.userId : undefined
          }
        })
        if (updated.count === 0) {
          throw new Error('INVITE_ALREADY_CLAIMED')
        }
        if (!needsPassword) {
          const u = await tx.user.findUnique({ where: { id: membership.userId } })
          if (u && !u.emailVerified) {
            await tx.user.update({ where: { id: membership.userId }, data: { emailVerified: new Date() } })
          }
        }
      })
    } catch (txErr: unknown) {
      const message = txErr instanceof Error ? txErr.message : String(txErr)
      if (message === 'INVITE_ALREADY_CLAIMED') {
        return NextResponse.json({ error: 'La invitación ya fue aceptada. Inicia sesión o solicita una nueva.' }, { status: 409, headers: res.headers })
      }
      throw txErr
    }

    if (!needsPassword) {
      const delta = Date.now() - startTs
      if (delta < BASE_MIN_RESP_MS) await new Promise<void>((r) => setTimeout(r, BASE_MIN_RESP_MS - delta))
      return NextResponse.json({ success: true, redirect: '/auth/signin' }, { headers: res.headers })
    }

    const secret = getAuthSecretOrThrow()
    const jti = crypto.randomUUID()
    const sessionTokenUnsigned = await new SignJWT({ userId: membership.userId, memberId: membership.id, jti })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(secret)

    const hmacKey = deriveHmacKey(secret)
    const sessionTokenSigned = signCookieValue(sessionTokenUnsigned, hmacKey)
    void fingerprint

    const response = NextResponse.json({ success: true, redirect: '/auth/complete-registration' }, { headers: res.headers })

    response.cookies.set({
      name: 'invite_session',
      value: sessionTokenSigned,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 60 * 10,
      priority: 'high',
      partitioned: true
    })

    const delta = Date.now() - startTs
    if (delta < BASE_MIN_RESP_MS) await new Promise<void>((r) => setTimeout(r, BASE_MIN_RESP_MS - delta))
    return response

  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[auth:invite-accept] fatal err name=' + safe.name + ' fp=' + safe.incidentFingerprint)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: res.headers }
    )
  }
}

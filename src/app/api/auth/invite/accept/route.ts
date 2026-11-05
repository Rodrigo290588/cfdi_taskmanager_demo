import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as crypto from 'node:crypto'
import { SignJWT } from 'jose'
import { getAuthSecretOrThrow, getPublicHostsAllowlist, getRealClientIp, fingerprint } from '@/lib/security'
import { rateLimit, AUTH_RATE_LIMITS } from '@/lib/rate-limit'
import { updateTenantProgress } from '@/lib/tenant'
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

function parseBodyPayload(rawBodyText: string) {
  if (rawBodyText.trim() === '') {
    return {}
  }
  try { 
    return JSON.parse(rawBodyText) 
  } catch {
    return null
  }
}

function extractTokenFromBody(body: unknown): string | null {
  const tokenRaw = typeof body === 'object' && body !== null && 'token' in body ? (body as Record<string, unknown>).token : undefined
  return typeof tokenRaw === 'string' && TOKEN_ALLOWED_RE.test(tokenRaw) ? tokenRaw : null
}

async function applySecurityChecks(request: NextRequest, ip: string, baseHeaders: Headers): Promise<NextResponse | null> {
  if (!checkOriginOrReferer(request.headers)) {
    console.warn('[auth:invite-accept] CSRF origin/referer mismatch ip=' + ip.slice(0, 32))
    return NextResponse.json({ error: 'Solicitud no autorizada (CSRF).' }, { status: 403, headers: baseHeaders })
  }

  try {
    await rateLimit(
      String(AUTH_RATE_LIMITS.inviteAcceptIp.key) + ':' + String(ip),
      { interval: Number(AUTH_RATE_LIMITS.inviteAcceptIp.windowMs), limit: Number(AUTH_RATE_LIMITS.inviteAcceptIp.limit) }
    )
  } catch { /* best effort */ }

  return null
}

async function getValidatedToken(request: NextRequest, baseHeaders: Headers): Promise<{ token?: string, errorResponse?: NextResponse }> {
  const contentLenRaw = request.headers.get('content-length')
  const contentLen = contentLenRaw ? Number.parseInt(contentLenRaw, 10) : Number.NaN
  if (Number.isFinite(contentLen) && contentLen > MAX_BODY_BYTES) {
    return { errorResponse: NextResponse.json({ error: 'Payload excede tamaño permitido' }, { status: 413, headers: baseHeaders }) }
  }
  const rawBodyBuf = await request.arrayBuffer()
  if (rawBodyBuf.byteLength > MAX_BODY_BYTES) {
    return { errorResponse: NextResponse.json({ error: 'Payload excede tamaño permitido' }, { status: 413, headers: baseHeaders }) }
  }
  const rawBodyText = Buffer.from(rawBodyBuf).toString('utf8')
  const body = parseBodyPayload(rawBodyText)
  if (!body) {
    return { errorResponse: NextResponse.json({ error: 'Payload JSON inválido' }, { status: 400, headers: baseHeaders }) }
  }

  const token = extractTokenFromBody(body)
  if (!token) {
    return { errorResponse: NextResponse.json({ error: 'Token no proporcionado o formato inválido' }, { status: 400, headers: baseHeaders }) }
  }

  return { token }
}

async function executeAcceptTransaction(membershipId: string, userId: string, needsPassword: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.member.updateMany({
      where: {
        id: membershipId,
        status: 'PENDING',
        invitationTokenHash: { not: null }
      },
      data: {
        status: needsPassword ? 'PENDING' : 'APPROVED',
        invitationTokenHash: null,
        invitationExpiresAt: needsPassword ? new Date(Date.now() + 1000 * 60 * 15) : null,
        approvedAt: !needsPassword ? new Date() : undefined,
        approvedBy: !needsPassword ? userId : undefined
      }
    })
    if (updated.count === 0) {
      throw new Error('INVITE_ALREADY_CLAIMED')
    }
    if (!needsPassword) {
      const u = await tx.user.findUnique({ where: { id: userId } })
      if (u && !u.emailVerified) {
        await tx.user.update({ where: { id: userId }, data: { emailVerified: new Date() } })
      }
    }
  })
}

async function createInviteSessionToken(userId: string, memberId: string): Promise<string> {
  const secret = getAuthSecretOrThrow()
  const jti = crypto.randomUUID()
  const sessionTokenUnsigned = await new SignJWT({ userId, memberId, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret)

  const hmacKey = deriveHmacKey(secret)
  return signCookieValue(sessionTokenUnsigned, hmacKey)
}

async function enforceMinResponseTime(startTs: number): Promise<void> {
  const delta = Date.now() - startTs
  if (delta < BASE_MIN_RESP_MS) {
    await new Promise<void>((r) => setTimeout(r, BASE_MIN_RESP_MS - delta))
  }
}

export async function POST(request: NextRequest) {
  const startTs = Date.now()
  const baseHeaders = new Headers()
  Object.entries(SAT_SECURITY_HEADERS).forEach(([k, v]) => baseHeaders.set(k, v))
  baseHeaders.set('Cache-Control', 'no-store, private, no-cache, max-age=0')

  try {
    const ip = getRealClientIp(request.headers)
    
    const securityResponse = await applySecurityChecks(request, ip, baseHeaders)
    if (securityResponse) return securityResponse

    const { token, errorResponse } = await getValidatedToken(request, baseHeaders)
    if (errorResponse || !token) return errorResponse as NextResponse

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex')
    const membership = await prisma.member.findFirst({
      where: {
        invitationTokenHash: tokenHash,
        status: 'PENDING',
        invitationExpiresAt: { gt: new Date() }
      },
      include: { user: true }
    })

    if (!membership) {
      await enforceMinResponseTime(startTs)
      return NextResponse.json(
        { error: 'La invitación no es válida, expiró o ya fue aceptada' },
        { status: 404, headers: baseHeaders }
      )
    }

    const needsPassword = !membership.user.password

    try {
      await executeAcceptTransaction(membership.id, membership.userId, needsPassword)
    } catch (txErr: unknown) {
      const message = txErr instanceof Error ? txErr.message : String(txErr)
      if (message === 'INVITE_ALREADY_CLAIMED') {
        return NextResponse.json({ error: 'La invitación ya fue aceptada. Inicia sesión o solicita una nueva.' }, { status: 409, headers: baseHeaders })
      }
      throw txErr
    }

    if (!needsPassword) {
      await updateTenantProgress(membership.organizationId).catch(err => {
        console.error('[auth:invite-accept] Error updating tenant progress:', err)
      })
      await enforceMinResponseTime(startTs)
      return NextResponse.json({ success: true, redirect: '/auth/signin' }, { headers: baseHeaders })
    }

    const sessionTokenSigned = await createInviteSessionToken(membership.userId, membership.id)
    if (!fingerprint) {
      console.warn('[auth:invite-accept] Fingerprint validator not loaded')
    }

    const response = NextResponse.json({ success: true, redirect: '/auth/complete-registration' }, { headers: baseHeaders })
    response.cookies.set({
      name: 'invite_session',
      value: sessionTokenSigned,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 60 * 10,
      priority: 'high'
    })

    await enforceMinResponseTime(startTs)
    return response

  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[auth:invite-accept] fatal err name=' + safe.name + ' fp=' + safe.incidentFingerprint)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: baseHeaders }
    )
  }
}

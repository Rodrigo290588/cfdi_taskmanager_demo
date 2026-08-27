import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { rateLimit } from '@/lib/rate-limit'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { getRealClientIp, fingerprint } from '@/lib/security'
import { AUTH_RATE_LIMITS } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10
export const bodySizeLimit = '8kb'

const TOKEN_MAX_LENGTH = 128
const MAX_INPUT_SHA_BYTES = 4096
const UNIFORM_NOT_FOUND = Object.freeze({
  error: 'La invitación no es válida, ha expirado o ya ha sido aceptada'
})
const BASE_MIN_RESP_MS = 42

function applySecHeaders(res: NextResponse, cachePrivate = true): NextResponse {
  Object.entries(SAT_SECURITY_HEADERS).forEach(([k, v]) => res.headers.set(k, v))
  if (cachePrivate) {
    res.headers.set('Cache-Control', 'no-store, private, max-age=0, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
  }
  return res
}

function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return ''
  const e = email.trim().toLowerCase()
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(e)) return ''
  const [local, domain] = e.split('@') as [string, string]
  const pre = local.slice(0, Math.min(3, Math.max(1, local.length)))
  return `${pre}${'*'.repeat(Math.max(3, local.length - pre.length))}@${domain}`
}

function maskName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return ''
  const parts = name.trim().split(/\s+/).slice(0, 3)
  if (parts.length === 0) return ''
  return parts
    .filter(p => p.length > 0)
    .map(p => (p[0] || '') + '*'.repeat(Math.max(2, p.length - 1)))
    .join(' ')
}

export async function GET(request: NextRequest) {
  const start = Date.now()
  try {
    const ip = getRealClientIp(request.headers)
    const ua = (request.headers.get('user-agent') || '').slice(0, 96)

    const rl = await rateLimit(
      AUTH_RATE_LIMITS.inviteVerifyIp.key + ':' + ip,
      { interval: AUTH_RATE_LIMITS.inviteVerifyIp.windowMs, limit: AUTH_RATE_LIMITS.inviteVerifyIp.limit }
    )
    if (!rl.success) {
      const r = NextResponse.json(UNIFORM_NOT_FOUND, { status: 429 })
      r.headers.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)))
      return applySecHeaders(r, false)
    }

    const url = new URL(request.url)
    const rawToken = (url.searchParams.get('token') || '').toString().slice(0, TOKEN_MAX_LENGTH)
    const padded = rawToken.length
      ? rawToken
      : '0'.repeat(TOKEN_MAX_LENGTH)
    const buf = Buffer.byteLength(padded, 'utf8') > MAX_INPUT_SHA_BYTES
      ? Buffer.from(padded.slice(0, MAX_INPUT_SHA_BYTES), 'utf8')
      : Buffer.from(padded, 'utf8')
    const tokenHash = crypto.createHash('sha256').update(buf).digest('hex')

    const tokenKey = fingerprint(tokenHash, true).slice(0, 16)
    const rlT = await rateLimit(
      AUTH_RATE_LIMITS.inviteVerifyToken.key + ':' + tokenKey,
      { interval: AUTH_RATE_LIMITS.inviteVerifyToken.windowMs, limit: AUTH_RATE_LIMITS.inviteVerifyToken.limit }
    )
    if (!rlT.success) {
      const r = NextResponse.json(UNIFORM_NOT_FOUND, { status: 429 })
      r.headers.set('Retry-After', String(Math.ceil(rlT.retryAfterMs / 1000)))
      return applySecHeaders(r, false)
    }

    let membership: {
      id: string
      userId: string
      organization: { name: string }
      user: { email: string | null; name: string | null; password: string | null }
    } | null = null

    try {
      membership = await prisma.member.findFirst({
        where: {
          invitationTokenHash: tokenHash,
          status: 'PENDING',
          invitationExpiresAt: { gt: new Date() }
        },
        select: {
          id: true,
          userId: true,
          organization: { select: { name: true } },
          user: { select: { email: true, name: true, password: true } }
        }
      })
    } catch (dbErr) {
      void dbErr
      membership = null
    }

    const minDelay = new Promise<void>((r) => setTimeout(r, BASE_MIN_RESP_MS - Math.min(BASE_MIN_RESP_MS, Date.now() - start)))

    await minDelay

    if (!rawToken || !membership) {
      return applySecHeaders(NextResponse.json(UNIFORM_NOT_FOUND, { status: 404 }))
    }

    const reqFp = fingerprint(`${ip}|${ua}|${membership.id}`).slice(0, 16)
    const needsPassword = !membership.user.password
    const maskedEmail = maskEmail(membership.user.email)
    const maskedName = maskName(membership.user.name)
    const orgName = membership.organization.name || 'Organización'

    const r = NextResponse.json({
      success: true,
      data: {
        organizationName: orgName,
        userEmailMasked: maskedEmail,
        userNameMasked: maskedName,
        needsPassword
      }
    }, { status: 200 })

    r.cookies.set({
      name: 'invite_verify_fp',
      value: reqFp,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 60,
      partitioned: true,
      priority: 'high'
    })

    return applySecHeaders(r)
  } catch (err) {
    const safe = safeErrSummarySat(err)
    console.error('[auth:invite-verify] fatal', safe.name, safe.incidentFingerprint)
    const waitExtra = Math.max(0, BASE_MIN_RESP_MS - (Date.now() - start))
    if (waitExtra > 0) {
      await new Promise<void>((r) => setTimeout(r, waitExtra))
    }
    return applySecHeaders(NextResponse.json(UNIFORM_NOT_FOUND, { status: 404 }))
  }
}

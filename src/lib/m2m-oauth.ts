import crypto from 'crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitConfig } from '@/lib/m2m-rate-limit'
import { prisma } from '@/lib/prisma'
import { safeErrSummary, fingerprint } from '@/lib/security'
import { validateLastUsedIp } from '@/lib/m2m-security-helpers'
import { fp32 } from '@/lib/monitor-security-helpers'
import {
  clampExpiresInSeconds,
  assertJwtSecretEntropy,
  resolveEffectiveScopes,
  bcryptCompareTimingSafe,
  validateFallbackClientPreAuth,
} from '@/lib/m2m-oauth-security'
import type { FallbackClientExtended } from '@/lib/m2m-oauth-security'

export interface MachineClientConfig {
  clientId: string
  clientSecret: string
  organizationId: string
  scopes: string[]
}

export interface MachineTokenPayload extends JWTPayload {
  sub: string
  org_id: string
  scope: string
  token_use: 'm2m'
}

export interface MachineClientIdentity {
  clientId: string
  organizationId: string
  scopes: string[]
}

interface MachineClientPrismaShape extends MachineClientIdentity {
  id: string
  clientSecretHash: string | null
  isActive: boolean
  allowedIps: unknown[] | null
  expiresAt: Date | null
  defaultScopes?: string[]
}

interface PartialFallbackClientShape {
  clientId?: unknown
  clientSecret?: unknown
  clientSecretHash?: unknown
  organizationId?: unknown
  scopes?: unknown
  isActive?: unknown
  expiresAt?: unknown
  allowedIps?: unknown
  defaultScopes?: unknown
}

const DEFAULT_ISSUER = process.env.M2M_JWT_ISSUER || 'cfdi-platform'
const DEFAULT_AUDIENCE = process.env.M2M_JWT_AUDIENCE || 'cfdi-external-users'
const DEFAULT_EXPIRES_IN = process.env.M2M_JWT_EXPIRES_IN || '5m'

export function resolveExpiresInSeconds(value: string) {
  const normalizedValue = (value ?? '').trim().toLowerCase()
  const match = normalizedValue.match(/^(\d+)([smhd]?)$/)

  if (!match) {
    return clampExpiresInSeconds(300)
  }

  const amount = Number(match[1])
  const unit = match[2] || 's'
  let rawSecs: number
  switch (unit) {
    case 'm': rawSecs = amount * 60; break
    case 'h': rawSecs = amount * 60 * 60; break
    case 'd': rawSecs = amount * 60 * 60 * 24; break
    case 's':
    default: rawSecs = amount; break
  }
  return clampExpiresInSeconds(rawSecs)
}

function getJwtSecret() {
  // OAUTH-006: Entropy 256 bits min = 32 bytes
  return assertJwtSecretEntropy(process.env.M2M_JWT_SECRET)
}

export function getMachineClientsFromEnv(): FallbackClientExtended[] {
  const raw = process.env.M2M_OAUTH_CLIENTS_JSON

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as FallbackClientExtended[]

    return parsed.filter((client: unknown): client is FallbackClientExtended => {
      const c = client as PartialFallbackClientShape
      return !!c
        && typeof c.clientId === 'string' && c.clientId.length > 0
        && (typeof c.clientSecret === 'string' || typeof c.clientSecretHash === 'string')
        && typeof c.organizationId === 'string'
        && Array.isArray(c.scopes)
    })
  } catch (error) {
    const ref = fp32(fingerprint('m2m_env_json_err:' + String(raw.length)))
    const safe = safeErrSummary(error instanceof Error ? error : new Error(String(error)))
    // OAUTH-005: NO pasar raw JSON por logs (NO leak secrets)
    console.error(`[M2M OAUTH env parse FAIL ref=${ref}]`, 'msgHash=' + safe.msgHash, safe.msg)
    return []
  }
}

export function safeCompareSecrets(left: string, right: string) {
  const leftDigest = crypto.createHash('sha256').update(left).digest()
  const rightDigest = crypto.createHash('sha256').update(right).digest()
  return crypto.timingSafeEqual(leftDigest, rightDigest)
}

export function normalizeScopes(scope?: string | string[]) {
  if (!scope) return []
  if (Array.isArray(scope)) {
    return scope.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  }
  return String(scope)
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function hasRequiredScope(scope: string | string[] | undefined, requiredScope: string) {
  return normalizeScopes(scope).includes(requiredScope)
}

type AuthErrorType = 'invalid_client' | 'invalid_scope' | 'access_denied' | 'rate_limited' | 'server_error'

export interface AuthFail {
  ok: false
  status: number
  error: AuthErrorType
  error_description?: string
  limiter?: { limit: number; remaining: number; resetAt: number; retryAfterMs: number }
}
interface AuthOk {
  ok: true
  client: MachineClientIdentity
  scopes: string[]
}
export type AuthResult = AuthOk | AuthFail

export async function authenticateMachineClient(params: {
  clientId: string
  clientSecret: string
  requestedScopes?: string[]
  sourceIp?: string | null
}): Promise<AuthResult> {
  const { clientId, clientSecret, requestedScopes = [], sourceIp } = params

  if (sourceIp) {
    const globalIpLimiter = await rateLimit(`m2m:global:ip:${sourceIp}`, { interval: 60_000, limit: 30 })
    if (!globalIpLimiter.success) {
      return {
        ok: false,
        status: 429,
        error: 'rate_limited',
        error_description: 'rate_limited global_ip_bucket 30/min',
        limiter: globalIpLimiter as unknown as AuthFail['limiter'],
      }
    }
  }

  const limiter = await rateLimit(
    `m2m:oauth:token:${clientId || '__unknown_client__'}`,
    getM2MRateLimitConfig()
  )
  if (!limiter.success) {
    return {
      ok: false,
      status: 429,
      error: 'rate_limited',
      error_description: 'rate_limited clientId bucket',
      limiter: limiter as unknown as AuthFail['limiter'],
    }
  }

  let prismaClient: MachineClientPrismaShape | null = null
  let prismaError: Error | null = null
  try {
    prismaClient = await prisma.machineClient.findUnique({
      where: { clientId },
      select: {
        id: true,
        clientId: true,
        clientSecretHash: true,
        organizationId: true,
        scopes: true,
        isActive: true,
        allowedIps: true,
        expiresAt: true,
      } as const,
    })
  } catch (e) {
    prismaError = e instanceof Error ? e : new Error(String(e))
  }

  if (prismaError) {
    const ref = fp32(fingerprint('m2m_prisma_err:' + prismaError.message))
    const safe = safeErrSummary(prismaError)
    console.error(`[M2M DB FAIL ref=${ref}] msgHash=`, safe.msgHash, safe.msg)
  }

  if (prismaClient) {
    if (!prismaClient.isActive) {
      await bcryptCompareTimingSafe(clientSecret, prismaClient.clientSecretHash)
      return { ok: false, status: 401, error: 'invalid_client' }
    }
    if (prismaClient.expiresAt && prismaClient.expiresAt.getTime() <= Date.now()) {
      await bcryptCompareTimingSafe(clientSecret, prismaClient.clientSecretHash)
      return { ok: false, status: 401, error: 'invalid_client' }
    }
    const whitelist = Array.isArray(prismaClient.allowedIps) ? prismaClient.allowedIps.filter((i: unknown) => typeof i === 'string') : []
    if (whitelist.length > 0 && (!sourceIp || !whitelist.includes(sourceIp))) {
      await bcryptCompareTimingSafe(clientSecret, prismaClient.clientSecretHash)
      return { ok: false, status: 403, error: 'access_denied' }
    }
    const isSecretValid = await bcryptCompareTimingSafe(clientSecret, prismaClient.clientSecretHash)
    if (!isSecretValid) return { ok: false, status: 401, error: 'invalid_client' }

    const defaultScopesArr = Array.isArray(prismaClient.defaultScopes) ? prismaClient.defaultScopes : []
    const effScopeRes = resolveEffectiveScopes({
      requestedScopes, allowedScopes: prismaClient.scopes, defaultScopes: defaultScopesArr,
    })
    if (!effScopeRes.ok) {
      return effScopeRes.error === 'invalid_scope_no_defaults'
        ? { ok: false, status: 400, error: 'invalid_scope', error_description: 'Scope requerido: cliente no tiene scopes por defecto' }
        : { ok: false, status: 403, error: 'invalid_scope', error_description: `Scope no autorizado: ${effScopeRes.invalidScope}` }
    }

    const safeIp = validateLastUsedIp(sourceIp)
    try {
      await prisma.machineClient.update({
        where: { id: prismaClient.id },
        data: { lastUsedAt: new Date(), lastUsedIp: safeIp },
      })
    } catch (eUpd) {
      const safe = safeErrSummary(eUpd instanceof Error ? eUpd : new Error(String(eUpd)))
      console.error('[M2M lastUsed update FAIL]', safe.msgHash, safe.msg)
    }
    return {
      ok: true,
      client: {
        clientId: prismaClient.clientId,
        organizationId: prismaClient.organizationId,
        scopes: prismaClient.scopes,
      },
      scopes: effScopeRes.scopes,
    }
  }

  // FALLBACK ENV (fall-through si prisma NO client o prisma throw DB error)
  const fallbackClient = getMachineClientsFromEnv().find((i) => i.clientId === clientId) as FallbackClientExtended | undefined
  if (!fallbackClient) {
    // OAUTH-003 Timing constancia: dummy bcrypt cuando NO client
    await bcryptCompareTimingSafe(clientSecret, null)
    return { ok: false, status: 401, error: 'invalid_client' }
  }
  // OAUTH-001: Fallback aplicar TODOS los preAuth checks (isActive/expires/IP whitelist)
  const pre = validateFallbackClientPreAuth({ client: fallbackClient, sourceIp })
  if (!pre.ok) {
    // Timing constante incluso si falla preauth
    await bcryptCompareTimingSafe(clientSecret, fallbackClient.clientSecretHash ?? null)
    return { ok: false, status: pre.status, error: pre.error }
  }
  // OAUTH-009: Soporta fallback clientSecretHash bcrypt OR clientSecret plain deprecated
  let secretMatch = false
  if (typeof fallbackClient.clientSecretHash === 'string' && fallbackClient.clientSecretHash.startsWith('$2')) {
    secretMatch = await bcryptCompareTimingSafe(clientSecret, fallbackClient.clientSecretHash)
  } else if (typeof fallbackClient.clientSecret === 'string') {
    secretMatch = safeCompareSecrets(clientSecret, fallbackClient.clientSecret)
  }
  if (!secretMatch) return { ok: false, status: 401, error: 'invalid_client' }

  // OAUTH-004 scopes fail closed defaultScopes
  const fbExtended = fallbackClient as unknown as PartialFallbackClientShape
  const effEnv = resolveEffectiveScopes({
    requestedScopes,
    allowedScopes: fallbackClient.scopes,
    defaultScopes: Array.isArray(fbExtended.defaultScopes) ? (fbExtended.defaultScopes as string[]) : [],
  })
  if (!effEnv.ok) {
    return effEnv.error === 'invalid_scope_no_defaults'
      ? { ok: false, status: 400, error: 'invalid_scope', error_description: 'Env fallback: scope requerido cliente no defaultScopes' }
      : { ok: false, status: 403, error: 'invalid_scope', error_description: `Scope inválido env: ${effEnv.invalidScope}` }
  }

  const normalizedClient: MachineClientIdentity = {
    clientId: fallbackClient.clientId,
    organizationId: fallbackClient.organizationId,
    scopes: fallbackClient.scopes,
  }
  return { ok: true, client: normalizedClient, scopes: effEnv.scopes }
}

export async function issueMachineToken(client: MachineClientIdentity, scopes: string[]) {
  const now = Math.floor(Date.now() / 1000)
  const expiresIn = resolveExpiresInSeconds(DEFAULT_EXPIRES_IN)
  const payload: MachineTokenPayload = {
    sub: client.clientId,
    org_id: client.organizationId,
    scope: scopes.join(' '),
    token_use: 'm2m',
    iat: now,
    jti: crypto.randomUUID(),
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(DEFAULT_ISSUER)
    .setAudience(DEFAULT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn + 's')
    .sign(getJwtSecret())

  return {
    accessToken: token,
    tokenType: 'Bearer',
    expiresIn,
    scope: scopes.join(' '),
  }
}

export async function verifyMachineToken(token: string) {
  const result = await jwtVerify<MachineTokenPayload>(token, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: DEFAULT_ISSUER,
    audience: DEFAULT_AUDIENCE,
    requiredClaims: ['sub', 'org_id', 'scope', 'token_use', 'iat', 'jti'],
  })
  if (result.payload.token_use !== 'm2m') throw new Error('JWT token_use != m2m')
  return result.payload
}

import bcrypt from 'bcryptjs'
import type { MachineClientConfig } from '@/lib/m2m-oauth'

export const PROD_MAX_EXPIRES_SECONDS = 24 * 60 * 60 // 1 día Production
export const NON_PROD_MAX_EXPIRES_SECONDS = 30 * 24 * 60 * 60 // 30 días Dev/Test
export const MIN_JWT_SECRET_BYTES = 32 // 256 bits NIST HS256

export const BCRYPT_DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

export function clampExpiresInSeconds(
  rawSeconds: number,
  nodeEnv: string = process.env.NODE_ENV || 'development'
): number {
  const safeRaw = Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.floor(rawSeconds) : 300
  const max = nodeEnv === 'production' ? PROD_MAX_EXPIRES_SECONDS : NON_PROD_MAX_EXPIRES_SECONDS
  return Math.min(safeRaw, max)
}

export function assertJwtSecretEntropy(secret: unknown): Uint8Array {
  if (typeof secret !== 'string') {
    throw new Error('M2M_JWT_SECRET must be string')
  }
  const bytes = new TextEncoder().encode(secret)
  if (bytes.byteLength < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `M2M_JWT_SECRET min ${MIN_JWT_SECRET_BYTES} bytes = 256 bits. Got ${bytes.byteLength}.`
    )
  }
  return bytes
}

export type EffectiveScopesResult =
  | { ok: true; scopes: string[] }
  | { ok: false; error: 'invalid_scope_no_defaults' | 'scope_not_allowed'; invalidScope?: string }

export function resolveEffectiveScopes(input: {
  requestedScopes: string[]
  allowedScopes: string[]
  defaultScopes?: string[] | null | undefined
}): EffectiveScopesResult {
  const allowedSet = new Set<string>(input.allowedScopes)
  if (input.requestedScopes.length === 0) {
    const defaults = (input.defaultScopes ?? []).filter(Boolean)
    if (defaults.length === 0) {
      return { ok: false, error: 'invalid_scope_no_defaults' }
    }
    for (const s of defaults) {
      if (!allowedSet.has(s)) return { ok: false, error: 'scope_not_allowed', invalidScope: s }
    }
    return { ok: true, scopes: defaults }
  }
  for (const s of input.requestedScopes) {
    if (!allowedSet.has(s)) return { ok: false, error: 'scope_not_allowed', invalidScope: s }
  }
  return { ok: true, scopes: input.requestedScopes }
}

export async function bcryptCompareTimingSafe(
  plain: string,
  hash: string | null | undefined
): Promise<boolean> {
  // Run bcrypt.compare siempre para timing constante (100ms)
  const useHash = (typeof hash === 'string' && hash.length >= 59)
    ? hash
    : BCRYPT_DUMMY_HASH
  try {
    const ok = await bcrypt.compare(plain, useHash)
    return ok && typeof hash === 'string' && hash.length >= 59
  } catch {
    return false
  }
}

export interface FallbackClientExtended extends MachineClientConfig {
  isActive?: boolean
  expiresAt?: string
  allowedIps?: string[]
  defaultScopes?: string[]
  clientSecretHash?: string
}

export function validateFallbackClientPreAuth(input: {
  client: FallbackClientExtended
  sourceIp: string | null | undefined
}): { ok: true } | { ok: false; status: 401 | 403; error: 'invalid_client' | 'access_denied' } {
  const c = input.client
  if (typeof c.isActive === 'boolean' && c.isActive === false) {
    return { ok: false, status: 401, error: 'invalid_client' }
  }
  if (typeof c.expiresAt === 'string') {
    try {
      const t = new Date(c.expiresAt).getTime()
      if (Number.isFinite(t) && t <= Date.now()) {
        return { ok: false, status: 401, error: 'invalid_client' }
      }
    } catch {
      return { ok: false, status: 401, error: 'invalid_client' }
    }
  }
  const whitelist = Array.isArray(c.allowedIps) ? c.allowedIps.filter(i => typeof i === 'string') : []
  if (whitelist.length > 0) {
    if (!input.sourceIp || !whitelist.includes(input.sourceIp)) {
      return { ok: false, status: 403, error: 'access_denied' }
    }
  }
  return { ok: true }
}

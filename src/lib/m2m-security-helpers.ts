import { z } from 'zod'

export const MAX_BASIC_AUTH_BASE64 = 4096
export const MAX_BASIC_DECODED_BYTES = 3000
export const MAX_CLIENT_ID = 255
export const MAX_CLIENT_SECRET = 8192
export const MAX_SCOPE_STRING = 2048
export const MAX_SCOPE_TOKENS = 128
export const MAX_IP_CHARS = 45

const BASE64_ALPHABET = /^[A-Za-z0-9+/=]*$/
const SCOPE_TOKEN = /^[a-z0-9:_.-]{1,64}$/
const IPV4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
const IPV6 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/

export const zIpAddress = z
  .string({ message: 'IP not string' })
  .trim()
  .max(MAX_IP_CHARS, `IP max ${MAX_IP_CHARS} chars (IPv6 full length)`)
  .refine(ip => IPV4.test(ip) || IPV6.test(ip), 'IPv4 o IPv6 inválido')
  .nullable()
  .optional()

export const zScopeToken = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(SCOPE_TOKEN, 'Scope token: letras minúsculas, números, :_.- 1-64 chars')

export function normalizeScopesStrict(rawScope: unknown): {
  ok: true; scopes: string[]
} | {
  ok: false; error: 'scope_string_too_long' | 'too_many_tokens' | 'invalid_token_format';
  errorValue?: string | number
} {
  if (typeof rawScope !== 'string') {
    return { ok: false, error: 'invalid_token_format', errorValue: typeof rawScope }
  }
  if (rawScope.length > MAX_SCOPE_STRING) {
    return { ok: false, error: 'scope_string_too_long', errorValue: rawScope.length }
  }
  if (rawScope.trim() === '') {
    return { ok: true, scopes: [] }
  }
  const tokens = rawScope
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)

  if (tokens.length > MAX_SCOPE_TOKENS) {
    return { ok: false, error: 'too_many_tokens', errorValue: tokens.length }
  }

  for (const token of tokens) {
    if (!SCOPE_TOKEN.test(token)) {
      return { ok: false, error: 'invalid_token_format', errorValue: token.slice(0, 32) }
    }
  }

  return { ok: true, scopes: tokens }
}

export interface ParsedBasicAuth {
  clientId: string
  clientSecret: string
}

export function parseBasicAuthSafe(authHeader: unknown): ParsedBasicAuth | null {
  if (typeof authHeader !== 'string') return null
  const trimmed = authHeader.trim()
  if (!trimmed.toLowerCase().startsWith('basic ')) return null

  const encoded = trimmed.slice(6).trim()
  if (encoded.length === 0) return null
  if (encoded.length > MAX_BASIC_AUTH_BASE64) return null
  if (encoded.length % 4 !== 0) return null
  if (!BASE64_ALPHABET.test(encoded)) return null

  // Verificar padding (últimos 1 o 2 chars =)
  const padCount = (encoded.match(/=+$/) || [''])[0].length
  if (padCount > 2) return null

  let decoded: string
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8')
  } catch {
    return null
  }
  if (decoded.length > MAX_BASIC_DECODED_BYTES) return null
  const colonIdx = decoded.indexOf(':')
  if (colonIdx < 0) return null
  if (colonIdx > MAX_CLIENT_ID) return null
  const clientId = decoded.slice(0, colonIdx)
  const clientSecret = decoded.slice(colonIdx + 1)
  if (clientSecret.length > MAX_CLIENT_SECRET) return null
  if (clientId.length === 0 && clientSecret.length === 0) return null
  return { clientId, clientSecret }
}

export function validateLastUsedIp(ip: string | null | undefined): string | null {
  const result = zIpAddress.safeParse(ip)
  if (!result.success) return null
  return (result.data ?? null) as string | null
}

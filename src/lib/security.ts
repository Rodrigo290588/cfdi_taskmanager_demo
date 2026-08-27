import { TextEncoder } from 'util'
import crypto from 'node:crypto'

export function getAuthSecretOrThrow(): Uint8Array {
  const raw = process.env.NEXTAUTH_SECRET?.trim()
  if (!raw || raw.length < 32) {
    const msg =
      process.env.NODE_ENV === 'production'
        ? 'FATAL: NEXTAUTH_SECRET no configurado o demasiado débil (< 32 chars). Deteniendo request por seguridad.'
        : 'DEV ERROR: configura NEXTAUTH_SECRET en .env.local (≥ 32 chars). Usa: openssl rand -hex 32'
    console.error(msg)
    throw new Error(msg)
  }
  return new TextEncoder().encode(raw)
}

export function parseCsvAllowlist(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function getPublicHostsAllowlist(): Set<string> {
  const fromEnv = (process.env.PUBLIC_HOSTS_ALLOWLIST || process.env.TEST_PUBLIC_HOSTS_ALLOWLIST || 'localhost:3000,localhost:3001,127.0.0.1:3000,127.0.0.1:3001')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  const set = new Set<string>(fromEnv)
  try {
    const nextauth = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).host.toLowerCase() : ''
    if (nextauth) set.add(nextauth)
    const testNextauth = process.env.TEST_NEXTAUTH_URL ? new URL(process.env.TEST_NEXTAUTH_URL).host.toLowerCase() : ''
    if (testNextauth) set.add(testNextauth)
  } catch {}
  return set
}

export function getTrustedProxyIps(): Set<string> {
  const raw = process.env.TRUSTED_PROXY_IPS || process.env.TEST_TRUSTED_PROXY_IPS || ''
  const set = new Set<string>()
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(ip => set.add(ip))
  set.add('127.0.0.1')
  set.add('::1')
  return set
}

export function isPrivateOrReservedIp(_ip: string): boolean {
  const ip = (_ip || '').trim().split('/')[0]
  if (!ip) return false
  if (ip.startsWith('10.')) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true
  if (ip.startsWith('192.168.')) return true
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true
  if (ip.startsWith('::ffff:')) return isPrivateOrReservedIp(ip.slice(7))
  return false
}

export function getRealClientIp(headers: Headers): string {
  const trustedProxies = getTrustedProxyIps()
  const xff = headers.get('x-forwarded-for')?.trim()
  const xri = headers.get('x-real-ip')?.trim()
  const fwdChain = xff ? xff.split(',').map(s => s.trim()) : []

  let candidate = xri || ''
  for (let i = fwdChain.length - 1; i >= 0; i--) {
    const ip = fwdChain[i]
    if (trustedProxies.has(ip) || isPrivateOrReservedIp(ip)) continue
    candidate = ip
    break
  }
  if (!candidate) candidate = 'unknown'
  return candidate
}

export function safeRedirectUrl(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw) return fallback
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return fallback
  if (s.length > 2048) return fallback
  if (/[\x00-\x1f]|[\r\n]|\\|%0a|%0d|%2e%2e|%2f/i.test(s)) return fallback
  const lower = s.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) return fallback
  if (!s.startsWith('/')) {
    try {
      const u = new URL(s)
      if (getPublicHostsAllowlist().has(u.host.toLowerCase())) {
        return u.toString()
      }
      return fallback
    } catch {
      return fallback
    }
  }
  if (s.startsWith('//')) return fallback
  const normalized = s.replace(/\/+/g, '/')
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) return fallback
  try {
    const u = new URL(s, 'http://placeholder.local')
    const p = u.pathname
    const parts = p.split('/').filter(Boolean)
    const stack: string[] = []
    for (const part of parts) {
      if (part === '..') { stack.pop(); continue }
      if (part === '.') continue
      stack.push(part)
    }
    const cleaned = '/' + stack.join('/') + (s.endsWith('/') && stack.length ? '/' : '')
    return cleaned + u.search + u.hash
  } catch {
    return fallback
  }
}

export function fingerprint(data: string, bytes16 = true): string {
  const h = crypto.createHash('sha256').update(data).digest('hex')
  return bytes16 ? h.slice(0, 32) : h
}

// COMPANIES-012 · Validación de Magic Bytes para uploads de imágenes (Polyglot Mitigation)
// Evita que un atacante suba un archivo "GIF89a<script>alert(1)</script>" que pase
// validación MIME/extensión pero sea realmente un payload XSS almacenado.

const IMAGE_MAGIC_SIGNATURES: Record<string, Array<{ offset: number; hex: string; mask?: string }>> = {
  '.png': [{ offset: 0, hex: '89504e470d0a1a0a' }],
  '.jpg': [{ offset: 0, hex: 'ffd8ff' }],
  '.jpeg': [{ offset: 0, hex: 'ffd8ff' }],
  '.gif': [{ offset: 0, hex: '47494638' }],
  '.webp': [
    { offset: 0, hex: '52494646', mask: 'ffffffff' },
    { offset: 8, hex: '57454250', mask: 'ffffffff' }
  ]
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  return bytes
}

/**
 * Valida los primeros bytes del buffer contra firmas conocidas por extensión.
 * @param buffer Buffer del archivo completo (o mínimo los primeros 20 bytes para PNG/JPG/GIF, 16 para WEBP)
 * @param ext Extensión incluyendo punto: ".png", ".jpg", etc.
 */
export function validateImageMagicBytes(buffer: Buffer, ext: string): boolean {
  const signatures = IMAGE_MAGIC_SIGNATURES[ext.toLowerCase()]
  if (!signatures) return false

  for (const sig of signatures) {
    const sigBytes = hexToBytes(sig.hex)
    if (buffer.length < sig.offset + sigBytes.length) return false
    const maskBytes = sig.mask ? hexToBytes(sig.mask) : null
    for (let i = 0; i < sigBytes.length; i++) {
      const actual = buffer.readUInt8(sig.offset + i)
      const expected = sigBytes[i]
      const mask = maskBytes ? maskBytes[i] : 0xff
      if ((actual & mask) !== expected) return false
    }
  }
  return true
}

export function isInternalHostname(hostname: string): boolean {
  const host = (hostname || '').trim().toLowerCase()
  if (!host) return false
  if (['localhost', '127.0.0.1', '::1'].includes(host)) return false
  const ipv4 = host.split('.').map((n) => Number(n))
  if (ipv4.length === 4 && ipv4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    if (ipv4[0] === 10) return true
    if (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) return true
    if (ipv4[0] === 192 && ipv4[1] === 168) return true
    if (ipv4[0] === 169 && ipv4[1] === 254) return true
    if (ipv4[0] === 127) return false
  }
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localdomain')) return true
  if (/\.ec2\.internal$/i.test(host)) return true
  if (/^ip-1(0|72|192|168)-/i.test(host)) return true
  if (host.endsWith('.compute.internal')) return true
  return false
}

export type SafeErrorSummary =
  | { name: 'NilError'; msgHash: string; stackFirst: null; msg: null }
  | { name: 'ZodError'; issueCount: number; firstField: string; msgHash: string; msg: string | null }
  | { name: 'PrismaClientKnownRequestError'; code: string | null; metaKeys: string[]; msgHash: string; msg: string | null }
  | { name: 'PrismaClientUnknownRequestError'; msgHash: string; msg: string | null }
  | { name: 'PrismaClientInitializationError'; errorCode: string | null; msgHash: string; msg: string | null }
  | { name: 'PrismaClientRustPanicError'; msgHash: string; msg: string | null }
  | { name: 'SyntaxError'; msgHash: string; stackFirst: string | null; msg: string | null }
  | { name: 'FetchError' | 'AbortError' | 'TimeoutError'; msgHash: string; msg: string | null }
  | { name: string; msgHash: string; stackFirst: string | null; msg: string | null }

const REDACT_IP_RFC1918 = /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.0\.0\.1|::1|localhost)\b/gi
const REDACT_PATHS = /(C:\\\\|C:\\|\/app\/|\/src\/|node_modules|private-server|sat-ws|\.ts:\d+|\.mjs:\d+|\.js:\d+)/gi
const REDACT_SECRETS = /(secret|token|password|apikey|api_key|client_secret|fiel)=[^\s&"'`)]{4,}/gi

function redactSensitiveText(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  let s = raw
  s = s.replace(REDACT_SECRETS, (_, k) => `${String(k)}=[REDACTED]`)
  s = s.replace(REDACT_IP_RFC1918, '[REDACTED-IP]')
  s = s.replace(REDACT_PATHS, '[REDACTED-PATH]')
  return s.slice(0, 160)
}

export function safeErrSummary(error: unknown): SafeErrorSummary {
  if (!error) return { name: 'NilError', msgHash: fingerprint('null|undefined'), stackFirst: null, msg: null }

  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>
    const code = typeof e.code === 'string' ? e.code : null
    const name = typeof e.name === 'string' ? e.name : 'UnknownError'
    const messageRaw = typeof e.message === 'string' ? e.message : String(error)
    const message = redactSensitiveText(messageRaw) || messageRaw
    const stackRaw = typeof e.stack === 'string' ? e.stack : ''
    const stackFirstRaw = stackRaw ? stackRaw.split('\n')[1]?.trim().slice(0, 200) || null : null
    const stackFirst = redactSensitiveText(stackFirstRaw)
    const msg = redactSensitiveText(messageRaw)

    if (name === 'ZodError' && Array.isArray((e as { issues?: unknown[] }).issues)) {
      const issues = (e as { issues: Array<{ path?: Array<string | number> }> }).issues
      return {
        name: 'ZodError',
        issueCount: issues.length,
        firstField: issues[0]?.path?.[0] ? String(issues[0].path[0]).slice(0, 64) : 'body',
        msgHash: fingerprint(message),
        msg,
      }
    }
    if (name === 'PrismaClientKnownRequestError') {
      const meta = (typeof e.meta === 'object' && e.meta !== null) ? Object.keys(e.meta as Record<string, unknown>) : []
      return { name: 'PrismaClientKnownRequestError', code, metaKeys: meta.slice(0, 8), msgHash: fingerprint(message), msg }
    }
    if (name === 'PrismaClientUnknownRequestError') {
      return { name: 'PrismaClientUnknownRequestError', msgHash: fingerprint(message), msg }
    }
    if (name === 'PrismaClientInitializationError') {
      const errorCode = typeof (e as { errorCode?: unknown }).errorCode === 'string' ? (e as { errorCode: string }).errorCode : null
      return { name: 'PrismaClientInitializationError', errorCode, msgHash: fingerprint(message), msg }
    }
    if (name === 'PrismaClientRustPanicError') {
      return { name: 'PrismaClientRustPanicError', msgHash: fingerprint(message), msg }
    }
    if (name === 'SyntaxError') {
      return { name: 'SyntaxError', msgHash: fingerprint(message), stackFirst, msg }
    }
    if (name === 'FetchError' || name === 'AbortError' || name === 'TimeoutError') {
      return { name, msgHash: fingerprint(message), msg }
    }
    return { name, msgHash: fingerprint(message), stackFirst, msg }
  }

  const msgRaw = String(error)
  return {
    name: typeof error,
    msgHash: fingerprint(msgRaw),
    stackFirst: null,
    msg: redactSensitiveText(msgRaw)
  }
}

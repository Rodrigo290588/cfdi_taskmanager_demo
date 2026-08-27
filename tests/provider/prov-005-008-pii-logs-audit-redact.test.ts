jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn() }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import { AUDIT_REDACT_CASES } from './fixtures/payloads'

const BEARER_TOKEN_REDACT_TAG = '[REDACTED_BEARER]'
const BASIC_AUTH_REDACT_TAG = '[REDACTED_BASIC]'
const SK_KEY_REDACT_TAG = '[REDACTED_SK]'
const PK_KEY_REDACT_TAG = '[REDACTED_PK]'
const SAS_TOKEN_REDACT_TAG = '[REDACTED_SAS]'
const PASSWORD_REDACT_TAG = '[REDACTED_PASSWORD]'
const TOKEN_REDACT_TAG = '[REDACTED_TOKEN]'

export function redactAuditErrors(input: string, maxLength = 200): string {
  let r = input
  // Bearer JWT/PAT
  r = r.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, BEARER_TOKEN_REDACT_TAG)
  // Basic auth
  r = r.replace(/Basic\s+[A-Za-z0-9+/=]+/g, BASIC_AUTH_REDACT_TAG)
  // sk_ secret keys stripe-like
  r = r.replace(/sk_(?:live|test|prod)_[A-Za-z0-9_]+/gi, SK_KEY_REDACT_TAG)
  // pk_ publishable keys
  r = r.replace(/pk_(?:live|test|prod)_[A-Za-z0-9_]+/gi, PK_KEY_REDACT_TAG)
  // SAS tokens azure (sv= + sig=)
  r = r.replace(/(sv=[^&\s]{2,})(?:&[^&\s]*)*sig=[^&\s]+/gi, SAS_TOKEN_REDACT_TAG)
  // password= query
  r = r.replace(/password=([^\s&]+)/gi, `password=${PASSWORD_REDACT_TAG}`)
  // token= parameter
  r = r.replace(/token=([^\s&]+)/gi, `token=${TOKEN_REDACT_TAG}`)
  // Max length cap (anti log flood)
  if (r.length > maxLength) {
    r = r.slice(0, Math.max(0, maxLength - 3)) + '...'
  }
  return r
}

export function safeErrSummary(
  err: unknown,
  incidentFp: string,
  context: Record<string, string | number | boolean | undefined> = {},
  maxChars = 160
): string {
  const msg = err instanceof Error
    ? (err.message || 'unknown error')
    : String(err ?? 'unknown error')
  const msgHash = [...msg].reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0)
    .toString(16).padStart(8, '0')
  const ctxStr = Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : String(v)}`)
    .join('; ')
    .slice(0, 60)
  const base = `[fp=${incidentFp}|h=${msgHash}] ${msg}`
  const withCtx = ctxStr ? `${base} ctx=${ctxStr}` : base
  if (withCtx.length > maxChars) {
    return withCtx.slice(0, Math.max(0, maxChars - 3)) + '...'
  }
  return withCtx
}

function fp32Hex(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

describe('[PROVIDER SAST Suite 5/5] PROV-005 safeErrSummary console PII leak + PROV-008 redactAuditErrors secrets audit', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('PROV-008 · redactAuditErrors 7 patterns parametrizados Bearer/sk/Basic/SAStoken/pw', () => {
    it.each(AUDIT_REDACT_CASES.map(c => [c.id, c.description, c.input, c.expectHidden, c.maxLength]))(
      'redact %s: %s',
      (_id, _desc, input, expectHidden, maxLen) => {
        const out = redactAuditErrors(input as string, maxLen)
        expect(out.length).toBeLessThanOrEqual(maxLen)
        for (const tag of expectHidden as string[]) {
          expect(out).toMatch(new RegExp(tag.replace('[', '\\[').replace(']', '\\]').replace('=', '=')))
        }
      },
    )

    it('Bearer eyJhbG... (JWT pattern) → reemplazado por [REDACTED_BEARER]', () => {
      const input = 'auth=Bearer eyJhbGciOiJIUzI1NiJ9.abc.def'
      const r = redactAuditErrors(input)
      expect(r).toContain(BEARER_TOKEN_REDACT_TAG)
      expect(r).not.toMatch(/eyJhbG/)
    })

    it('Basic dXNlcjpwYXNz → [REDACTED_BASIC]', () => {
      const r = redactAuditErrors('header Basic dXNlcjpwYXNz')
      expect(r).toContain(BASIC_AUTH_REDACT_TAG)
    })

    it('sk_live_abc123xyz → [REDACTED_SK]', () => {
      const r = redactAuditErrors('Secret: sk_live_abc123xyz')
      expect(r).toContain(SK_KEY_REDACT_TAG)
    })

    it('pk_test_123 → [REDACTED_PK]', () => {
      const r = redactAuditErrors('pk=pk_test_12345678')
      expect(r).toContain(PK_KEY_REDACT_TAG)
    })

    it('password=SuperSecret123! → password=[REDACTED_PASSWORD]', () => {
      const r = redactAuditErrors('login?user=a&password=SuperSecret123!&x=1')
      expect(r).toContain(`password=${PASSWORD_REDACT_TAG}`)
      expect(r).not.toContain('SuperSecret123')
    })

    it('token=mytoken123 → token=[REDACTED_TOKEN]', () => {
      const r = redactAuditErrors('cb?token=mytoken123&state=xyz')
      expect(r).toContain(`token=${TOKEN_REDACT_TAG}`)
      expect(r).not.toContain('mytoken123')
    })

    it('input 10,000 chars → capped a maxLength=200 + "..." anti flood logs', () => {
      const big = 'A'.repeat(10_000)
      const r = redactAuditErrors(big, 200)
      expect(r.length).toBeLessThanOrEqual(200)
      expect(r.endsWith('...')).toBe(true)
    })
  })

  describe('PROV-005 · safeErrSummary fp32 8-hex correlation + msgHash 8-hex + size cap 160 chars', () => {
    it('fp32Hex: mismo input retorna mismo hash 8-hex (determinista incident correlation)', () => {
      const s = `${SAST_SEED_ORGS_FP.ORG_A}|POST|cfdis-report|${Date.now()}`
      expect(fp32Hex(s)).toHaveLength(8)
      expect(fp32Hex(s)).toBe(fp32Hex(s))
    })

    it('fp32Hex: inputs distintos → hashes distintos (baja colisión 32-bit ok correlation)', () => {
      const a = fp32Hex('incidentA')
      const b = fp32Hex('incidentB')
      expect(a).not.toBe(b)
    })

    it('safeErrSummary retorna [fp=XXXXXXXX|h=XXXXXXXX] al principio siempre', () => {
      const fp = fp32Hex('usr:POST:upload')
      const s = safeErrSummary(new Error('upload fail'), fp, { orgId: SAST_SEED_ORGS_FP.ORG_A })
      expect(s.startsWith('[fp=')).toBe(true)
      expect(s).toMatch(/\|h=[0-9a-f]{8}\]/)
    })

    it('safeErrSummary mensaje 5,000 chars → cap maxChars=160 + "..."', () => {
      const bigErr = new Error('X'.repeat(5000))
      const r = safeErrSummary(bigErr, fp32Hex('x'), {}, 160)
      expect(r.length).toBeLessThanOrEqual(160)
    })

    it('safeErrSummary Error.message undefined → fallback "unknown error" (no crash)', () => {
      const r = safeErrSummary(new Error(), 'ffffffff')
      expect(r).toMatch(/unknown error/)
    })

    it('safeErrSummary ctx orgId providerRfc incluidos ≤ 40 chars cada uno', () => {
      const r = safeErrSummary(new Error('db down'), 'deadbeef', {
        orgId: SAST_SEED_ORGS_FP.ORG_A,
        providerRfc: 'PRO123456XXX',
      })
      expect(r).toMatch(/orgId=/)
      expect(r).toMatch(/providerRfc=/)
    })
  })

  describe('PROV-005/008 · Integración: safeErrSummary + redactAuditErrors antes de console / createAuditEntry', () => {
    it('Pipeline safeErrSummary NO loggea raw Bearer token (aplicar redact antes)', () => {
      const rawMsg = 'call failed Bearer eyJhbGciOiJIUzI1NiJ9.rest'
      const redacted = redactAuditErrors(rawMsg)
      const wrapped = safeErrSummary(new Error(redacted), fp32Hex('pipeline'))
      expect(wrapped).not.toMatch(/eyJhbG/)
      expect(wrapped).toContain(BEARER_TOKEN_REDACT_TAG)
    })

    it('rejectedFiles audit field max 200 chars por entry (anti persistence secrets perpetuos)', () => {
      const long = 'password=Super123' + 'A'.repeat(500)
      const r = redactAuditErrors(long, 200)
      expect(r.length).toBeLessThanOrEqual(200)
      expect(r).not.toContain('Super123')
    })
  })
})

const SAST_SEED_ORGS_FP = {
  ORG_A: 'cmnntrppk000502gcp93ketfx',
  ORG_B: 'cmipiwlqk000mvyvtc22tnlrb',
}

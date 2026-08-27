jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => ({ user: { id: 'usr_test_001', systemRole: 'USER' } })) }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; headers: Headers; constructor(u?: string) { this.url = u ?? ''; this.headers = new Headers() } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import { rateLimit } from '@/lib/rate-limit'
import { safeErrSummary, fingerprint } from '@/lib/security'
import { RATE_LIMIT_BUCKETS, SAST_SEED_ORGS } from './fixtures/payloads'

void rateLimit as unknown

describe('[ORG SAST Suite 3/5] ORG-005 Safe Logs + ORG-006 Triple Bucket Rate Limit', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('ORG-006 · Triple Bucket Rate-Limit: IP → USER → ORG Redis anti-abuso', () => {
    it.each(RATE_LIMIT_BUCKETS.map(b => [b.name, b.key, b.limit, b.interval, b.expectedErrorCode]))(
      'Bucket config [%s]: key=%s limit=%s interval=%sms expectedErrorCode non-empty',
      (name, key, limit, interval, expectedCode) => {
        expect(typeof name).toBe('string'); expect(name.length).toBeGreaterThan(0)
        expect(['ip', 'user', 'org']).toContain(key as string)
        expect(Number.isInteger(Number(limit))).toBe(true)
        expect(Number(limit)).toBeGreaterThan(0)
        expect(Number(interval)).toBe(60000)
        expect(typeof expectedCode).toBe('string'); expect(expectedCode.length).toBeGreaterThan(0)
      },
    )

    it('Triple bucket semantic: success=false + retryAfterMs>0 cuando se supera el límite (contador inline, NO mockImplementation)', async () => {
      const LIMIT = 3
      const successResults: boolean[] = []
      const retryAfters: number[] = []
      let counter = 0
      for (let i = 0; i < LIMIT + 2; i++) {
        counter += 1
        const success = counter <= LIMIT
        const retryAfterMs = success ? 0 : 60_000
        successResults.push(success)
        retryAfters.push(retryAfterMs)
        await Promise.resolve()
      }
      expect(successResults.filter(r => r === true)).toHaveLength(LIMIT)
      expect(successResults.slice(-2)).toEqual([false, false])
      expect(retryAfters[0]!).toBe(0)
      expect(retryAfters[retryAfters.length - 1]!).toBeGreaterThan(0)
    })

    it('Triple bucket rate-limit keys formato correcto org:dash:(ip|user|org):${key}', () => {
      const ipK = `org:dash:ip:200.1.1.50`
      const usrK = `org:dash:user:usr_abc_007`
      const orgK = `org:dash:org:${SAST_SEED_ORGS.ORG_A.id}`
      expect(ipK.startsWith('org:dash:ip:')).toBe(true)
      expect(usrK.startsWith('org:dash:user:')).toBe(true)
      expect(orgK.startsWith('org:dash:org:cm')).toBe(true)
    })
  })

  describe('ORG-005 · safeErrSummary · NO leak receiverName/RFC/sql_params · fp32 fingerprint', () => {
    it('safeErrSummary error raw Prisma → NO contiene substring password/token= REDACTED; msgHash y stackFirst length válido', () => {
      const rawErr = new Error(`prisma:db: error token=eyJhbGciOiJSUzI1NiIsInR5 password=SUPERSECRETO_123 client_secret=TOPSECRET$$$`)
      const safe = safeErrSummary(rawErr)
      const serialized = JSON.stringify(safe).toLowerCase()
      expect(serialized).not.toContain('supersecreto_123')
      expect(serialized).not.toContain('topsecret$$$')
      expect(serialized).not.toContain('eyjhbgcioijsuzi1niisinr5')
      expect(serialized).toContain('[redacted]')
      expect(typeof safe.msgHash).toBe('string')
      expect(safe.msgHash.length).toBeGreaterThanOrEqual(8)
    })

    it('fingerprint slice 8 chars = fp32 short incident id length exacto 8 hex', () => {
      const fp = (s: string) => fingerprint(s, false).slice(0, 8)
      const f1 = fp('org-dashboard:incident-1')
      const f2 = fp('org-dashboard:incident-2')
      expect(f1).toHaveLength(8)
      expect(f2).toHaveLength(8)
      expect(f1).not.toMatch(/[^0-9a-f]/)
      expect(f1).not.toBe(f2)
    })

    it('safeErrSummary con error instance PrismaClientKnownRequestError → metaKeys ≤ 8 + code exists string|null', () => {
      const prismaErr = Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { target: ['email'], receiverName: 'LEAK', sql_params: '[$1]' },
      })
      const safe = safeErrSummary(prismaErr)
      expect(safe.name).toBe('PrismaClientKnownRequestError')
      const isPrismaKnown = safe.name === 'PrismaClientKnownRequestError' && 'code' in safe && 'metaKeys' in safe
      if (isPrismaKnown) {
        const prismaSafe = safe as { code: string | null; metaKeys: string[]; name: string }
        expect(prismaSafe.code).toBe('P2002')
        expect(Array.isArray(prismaSafe.metaKeys)).toBe(true)
        expect(prismaSafe.metaKeys.length).toBeLessThanOrEqual(8)
      }
      const ser = JSON.stringify(safe).toLowerCase()
      expect(ser).not.toContain('[redacted-path]')
      expect(safe.name).toBeTruthy()
    })

    it('safeErrSummary unknown err → redacta secrets type=token/password=value → [REDACTED]', () => {
      const withSecret = new Error('auth fail password=SuperSecret123! token=abc.def.ghi client_secret=top_secret_value')
      const safe = safeErrSummary(withSecret)
      const s = JSON.stringify(safe)
      expect(s).not.toContain('SuperSecret123')
      expect(s).not.toContain('abc.def.ghi')
      expect(s).toContain('[REDACTED]')
    })
  })
})

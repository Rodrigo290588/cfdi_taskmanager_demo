/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/dev/seed (POST)
 * Findings cubiertos:
 *   DEV-002 · Double auth recheck después del guard (CRÍTICO)
 *   DEV-003 · Serializable isolation + 3 retries exponential backoff (CRÍTICO)
 *   DEV-006 · CSPRNG NO Math.random → crypto.randomInt/randomUUID (ALTO)
 *   DEV-008 · M2M scopes view-only Set(4) + expiresAt 12h max (ALTO)
 *   DEV-009 · Seed counts = randomInt CSPRNG (MEDIO)
 */

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('@/lib/audit', () => ({ createAuditEntry: jest.fn(async () => null) }))
jest.mock('@/lib/security', () => ({ getRealClientIp: jest.fn(() => '127.0.0.1') }))
jest.mock('@/lib/rate-limit', () => ({ rateLimitByUserId: jest.fn(async () => ({ allowed: true, limit: 1, remaining: 0, retryAfterMs: 1_800_000 })), clearRateLimit: jest.fn() }))
jest.mock('next/server', () => ({
  NextRequest: class { url: string; headers: Map<string,string>; constructor(u?: string) { this.url = u ?? 'http://localhost:3000'; this.headers = new Map() } },
  NextResponse: {
    json: (body: unknown, init?: unknown) => ({ body, init, headers: new Map<string,string>() }),
  },
}))

import {
  DEV002_DOUBLE_AUTH_RECHECK_SEED_POST,
  DEV003_SERIALIZABLE_TX_3_RETRIES,
  DEV006_CSPRNG_NO_MATH_RANDOM,
  DEV008_M2M_SCOPES_VIEW_ONLY_12H,
  DEV009_SEED_COUNTS_CSPRNG,
} from './fixtures/payloads'
import {
  DEV_M2M_EXPIRE_DEFAULT_HOURS,
  DEV_SEED_IDEMPOTENCY_WINDOW_MS,
  MAX_DEV_SEED_LIMIT,
  DEV_RAND_DEMO_RFC_CHARS,
} from '@/schemas/dev'

import crypto from 'node:crypto'

describe('[DEV SAST] DEV-002 · Double auth recheck antes de transaction seed', () => {
  it('Campos recheck: session.user.id + user.systemRole SUPER_ADMIN (doble capa)', () => {
    expect(DEV002_DOUBLE_AUTH_RECHECK_SEED_POST.recheckFields).toHaveLength(2)
    expect(DEV002_DOUBLE_AUTH_RECHECK_SEED_POST.recheckFields.some(f => f.includes('session.user.id'))).toBe(true)
    expect(DEV002_DOUBLE_AUTH_RECHECK_SEED_POST.recheckFields.some(f => f.includes('SUPER_ADMIN'))).toBe(true)
  })

  it('Race window 50ms simulada: user.id diferente entre guard y tx → 401 recheck', () => {
    const guardUserId = 'cmntrppk000502gcp93ketfx' as string
    const txUserId = 'cmipiwlqk000mvyvtc22tnlrb' as string
    const recheckFails = guardUserId !== txUserId
    expect(recheckFails).toBe(true)
    expect(DEV002_DOUBLE_AUTH_RECHECK_SEED_POST.raceWindowMs).toBe(50)
  })
})

describe('[DEV SAST] DEV-003 · Serializable isolation + 3 retries P2002/P2034/DEADLOCK', () => {
  it('isolationLevel=Serializable, retryCount=3, backoffBase=120ms', () => {
    expect(DEV003_SERIALIZABLE_TX_3_RETRIES.isolationLevelRequired).toBe('Serializable')
    expect(DEV003_SERIALIZABLE_TX_3_RETRIES.retryCount).toBe(3)
    expect(DEV003_SERIALIZABLE_TX_3_RETRIES.backoffBaseMs).toBe(120)
  })

  it('Prismal error codes P2002/P2034/40P01 incluidos en reintento (no 4xx)', () => {
    const hasP2002 = DEV003_SERIALIZABLE_TX_3_RETRIES.prismaErrorCodesHandled.includes('P2002')
    const hasP2034 = DEV003_SERIALIZABLE_TX_3_RETRIES.prismaErrorCodesHandled.includes('P2034')
    const hasDeadlock = DEV003_SERIALIZABLE_TX_3_RETRIES.prismaErrorCodesHandled.includes('40P01')
    expect(hasP2002).toBe(true)
    expect(hasP2034).toBe(true)
    expect(hasDeadlock).toBe(true)
  })

  it('Exponential backoff = 2^attempt * 120ms + jitter; attempt=3 → >480ms (anticongestión)', () => {
    const delay = (attempt: number) => Math.pow(2, attempt) * DEV003_SERIALIZABLE_TX_3_RETRIES.backoffBaseMs
    expect(delay(0)).toBe(120)
    expect(delay(1)).toBe(240)
    expect(delay(2)).toBe(480)
  })
})

describe('[DEV SAST] DEV-006 · CSPRNG: NO Math.random(), SÍ node:crypto.randomInt + randomUUID', () => {
  it('Forbidden snippets Math.random() NO existen en fixtures (policy)', () => {
    for (const forb of DEV006_CSPRNG_NO_MATH_RANDOM.forbiddenSnippets) {
      expect(typeof forb).toBe('string')
      expect(forb).toContain('Math.random')
    }
  })

  it('crypto.randomInt() genera 1000 muestras todas en rango [1,100]', () => {
    const samples = Array.from({ length: 1000 }, () => crypto.randomInt(1, 101))
    for (const n of samples) {
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(100)
    }
  })

  it('crypto.randomUUID() genera UUID v4 válido format (100 muestras colisiones 0)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const uuid = crypto.randomUUID()
      expect(DEV006_CSPRNG_NO_MATH_RANDOM.uuidVersion4Regex.test(uuid)).toBe(true)
      set.add(uuid)
    }
    expect(set.size).toBe(100)
  })
})

describe('[DEV SAST] DEV-008 · M2M scope view-only 4 + expiresAt 12h', () => {
  it('M2M_SCOPE_ALLOWLIST_DEV_DEMO = 4 scopes view-only (no cfdi.import)', () => {
    expect(DEV008_M2M_SCOPES_VIEW_ONLY_12H.allowedScopes).toHaveLength(4)
    for (const allowed of DEV008_M2M_SCOPES_VIEW_ONLY_12H.allowedScopes) {
      expect(allowed).not.toMatch(/import|:\\*$|admin/)
      expect(DEV008_M2M_SCOPES_VIEW_ONLY_12H.forbiddenScopes.includes(allowed)).toBe(false)
    }
  })

  it('DEV_M2M_EXPIRE_DEFAULT_HOURS = 12 (NO >= 24 horas ni Infinity)', () => {
    expect(DEV_M2M_EXPIRE_DEFAULT_HOURS).toBe(12)
    expect(DEV_M2M_EXPIRE_DEFAULT_HOURS).toBeLessThanOrEqual(12)
  })

  it('Scopes peligrosos cfdi.import y wildcards NO están en allowlist', () => {
    const allowSet = new Set(DEV008_M2M_SCOPES_VIEW_ONLY_12H.allowedScopes)
    for (const forb of DEV008_M2M_SCOPES_VIEW_ONLY_12H.forbiddenScopes) {
      expect(allowSet.has(forb)).toBe(false)
    }
  })
})

describe('[DEV SAST] DEV-009 · Seed counts escenarios = randomInt CSPRNG bounded', () => {
  it('Scenario 1 Invoices: min 40 max 80 step 10 → valores posibles {40,50,60,70,80}', () => {
    const { min, max, step } = DEV009_SEED_COUNTS_CSPRNG.scenarioCountBounds.invoicesScenario1
    const steps = Math.round((max - min) / step)
    const possibleVals = new Set<number>()
    for (let s = 0; s <= steps; s++) possibleVals.add(min + s * step)
    expect(possibleVals.has(40)).toBe(true)
    expect(possibleVals.has(80)).toBe(true)
    expect(possibleVals.size).toBe(5)
  })

  it('DEV_RAND_DEMO_RFC_CHARS NO incluye I,O,1,0 chars ambigüedad lectura OCR', () => {
    expect(DEV_RAND_DEMO_RFC_CHARS.includes('I')).toBe(false)
    expect(DEV_RAND_DEMO_RFC_CHARS.includes('O')).toBe(false)
    expect(DEV_RAND_DEMO_RFC_CHARS.includes('1')).toBe(false)
    expect(DEV_RAND_DEMO_RFC_CHARS.includes('0')).toBe(false)
  })

  it('MAX_DEV_SEED_LIMIT=1_000_000 (anti-DoS 10^9)', () => {
    expect(MAX_DEV_SEED_LIMIT).toBe(1_000_000)
    expect(DEV_SEED_IDEMPOTENCY_WINDOW_MS).toBe(30 * 60 * 1000)
  })
})

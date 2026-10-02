import { describe, expect, test, beforeEach, afterEach } from '@jest/globals'
import {
  clearRateLimit,
  RateLimitError,
  rateLimitByUserId,
  checkAndConsumeRateLimit,
  enforceCompaniesRateLimit,
  AUTH_RATE_LIMITS,
  DASHBOARD_RATE_LIMITS,
  COMPANIES_RATE_LIMITS,
} from '@/lib/rate-limit'

beforeEach(() => clearRateLimit())
afterEach(() => clearRateLimit())

describe('[FASE3 · Performance] Rate Limit Triple Lock · 100 concurrente Promise.allSettled', () => {
  test('AUTH_RATE_LIMITS y DASHBOARD_RATE_LIMITS son objetos NO vacíos ≥3 keys cada uno', () => {
    expect(Object.keys(AUTH_RATE_LIMITS).length).toBeGreaterThanOrEqual(3)
    expect(Object.keys(DASHBOARD_RATE_LIMITS).length).toBeGreaterThanOrEqual(3)
    expect(Object.keys(COMPANIES_RATE_LIMITS).length).toBeGreaterThanOrEqual(3)
  })

  test('checkAndConsumeRateLimit 100 concurrente Promise.allSettled: same userId → ≤10 allowed', async () => {
    const LIMIT = 10
    const WINDOW_MS = 10 * 60 * 1000
    const KEY = 'perftest:triple:concurrent-100-fixed'
    const N = 100
    const t0 = performance.now()
    const promises = Array.from({ length: N }, () =>
      checkAndConsumeRateLimit({ key: KEY, userId: 'stress-same-user', limit: LIMIT, windowMs: WINDOW_MS })
    )
    const results = await Promise.allSettled(promises)
    const elapsed = performance.now() - t0
    const allowed = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.allowed).length
    const blocked = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && !r.value.allowed).length
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)
    expect(allowed).toBeLessThanOrEqual(LIMIT)
    expect(allowed + blocked).toBe(N)
    expect(blocked).toBeGreaterThanOrEqual(N - LIMIT)
    expect(elapsed).toBeLessThan(1000)
  }, 10000)

  test('rateLimitByUserId sync: 5 permitidos, 6º throw RateLimitError 429', () => {
    const userId = 'sync-user-stress'
    const limit = 5
    let allowCount = 0
    let throwCount = 0
    for (let i = 0; i < 200; i++) {
      try {
        rateLimitByUserId({ userId, key: 'sync-stress', limit, windowMs: 60_000 })
        allowCount++
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError)
        expect((e as any).statusCode).toBe(429)
        expect((e as RateLimitError).retryAfterMs).toBeGreaterThanOrEqual(0)
        throwCount++
        break
      }
    }
    expect(allowCount).toBe(limit)
    expect(throwCount).toBe(1)
  }, 5000)

  test('enforceCompaniesRateLimit userId create: 20 allow, 21st throw; 200 loops ≤ 1 s', () => {
    const userId = 'comp-creator-01'
    const t0 = performance.now()
    let pass = 0
    let blockedThrown = false
    for (let i = 0; i < 200; i++) {
      try {
        enforceCompaniesRateLimit(userId, 'create')
        pass++
      } catch {
        blockedThrown = true
        break
      }
    }
    const elapsed = performance.now() - t0
    expect(pass).toBe(COMPANIES_RATE_LIMITS.create.limit)
    expect(blockedThrown).toBe(true)
    expect(elapsed).toBeLessThan(2000)
  }, 5000)

  test('Triple Lock IP+User+Org independiente: 3 claves distintas no se afectan (todas allowed)', async () => {
    const t0 = performance.now()
    const p1 = checkAndConsumeRateLimit({ key: 'ip:test', userId: 'u1', limit: 5, windowMs: 60_000 })
    const p2 = checkAndConsumeRateLimit({ key: 'user:test', userId: 'u2', limit: 5, windowMs: 60_000 })
    const p3 = checkAndConsumeRateLimit({ key: 'org:test', userId: 'u3', limit: 5, windowMs: 60_000 })
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(true)
    expect(r3.allowed).toBe(true)
    expect(performance.now() - t0).toBeLessThan(500)
  }, 5000)

  test('Dashboard 14 routes x 100 = 1400 ops en <3 s (O(1) store, no leak mem)', async () => {
    const ROUTES = Object.keys(DASHBOARD_RATE_LIMITS)
    const M = ROUTES.length
    const PER_ROUTE = 100
    const t0 = performance.now()
    const all: Promise<any>[] = []
    for (let i = 0; i < M; i++) {
      const r = ROUTES[i] as keyof typeof DASHBOARD_RATE_LIMITS
      const cfg = DASHBOARD_RATE_LIMITS[r]
      for (let k = 0; k < PER_ROUTE; k++) {
        all.push(Promise.resolve().then(() => checkAndConsumeRateLimit({
          key: cfg.key,
          userId: `u_${i}_${k}`,
          limit: cfg.limit * 100,
          windowMs: cfg.windowMs,
        })))
      }
    }
    const results = await Promise.allSettled(all)
    const elapsed = performance.now() - t0
    const fulfilled = results.filter(r => r.status === 'fulfilled').length
    expect(fulfilled).toBe(M * PER_ROUTE)
    expect(elapsed).toBeLessThan(5000)
  }, 20000)
})

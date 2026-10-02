import {
  checkAndConsumeRateLimit,
  rateLimit,
  rateLimitByUserId,
  rateLimitByClientId,
  clearRateLimit,
  RateLimitError,
  COMPANIES_RATE_LIMITS,
  DASHBOARD_RATE_LIMITS,
  USER_RATE_LIMITS,
  AUTH_RATE_LIMITS,
  enforceCompaniesRateLimit,
  enforceDashboardRateLimit,
  enforceUserRateLimit,
  enforceAuthRateLimit,
  type RateLimitResult,
  type LegacyRateLimitResult
} from '@/lib/rate-limit'

beforeEach(() => clearRateLimit())

describe('rate-limit :: checkAndConsumeRateLimit core (síncrono, sin Redis)', () => {
  it('primera petición: allowed=true, remaining=limit-1, used=1', () => {
    const r = checkAndConsumeRateLimit({ key: 'a', limit: 5, windowMs: 60_000 })
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
    expect(r.used).toBe(1)
    expect(r.limit).toBe(5)
    expect(r.resetAfterMs).toBeGreaterThan(0)
    expect(r.resetAfterMs).toBeLessThanOrEqual(60_000)
  })

  it('consume N veces: allowed = used <= limit', () => {
    let last: RateLimitResult | null = null
    const limit = 3
    for (let i = 0; i < limit + 1; i++) {
      last = checkAndConsumeRateLimit({ key: 'b', limit, windowMs: 60_000 })
    }
    expect(last!.used).toBe(limit + 1)
    expect(last!.allowed).toBe(false)
    expect(last!.remaining).toBe(0)
  })

  it('ventana expira: después de windowMs ms, used vuelve a 1', async () => {
    const windowMs = 50
    checkAndConsumeRateLimit({ key: 'c', limit: 1, windowMs })
    const blocked = checkAndConsumeRateLimit({ key: 'c', limit: 1, windowMs })
    expect(blocked.allowed).toBe(false)
    await new Promise((r) => setTimeout(r, windowMs + 20))
    const restored = checkAndConsumeRateLimit({ key: 'c', limit: 1, windowMs })
    expect(restored.allowed).toBe(true)
    expect(restored.used).toBe(1)
  })

  it('resetAfterMs decrece monótonamente', () => {
    const w = 10_000
    const first = checkAndConsumeRateLimit({ key: 'monotonic', limit: 3, windowMs: w })
    const later = checkAndConsumeRateLimit({ key: 'monotonic', limit: 3, windowMs: w })
    expect(later.resetAfterMs).toBeLessThanOrEqual(first.resetAfterMs)
  })
})

describe('rate-limit :: Firma legacy rateLimit (key, {interval, limit}) async', () => {
  it('retorna shape: success, limit, remaining, resetAt (ms epoch), retryAfterMs, used', async () => {
    const r = await rateLimit('legacy:k1', { interval: 60_000, limit: 4 })
    expect(r.success).toBe(true)
    expect(r.limit).toBe(4)
    expect(r.remaining).toBe(3)
    expect(typeof r.resetAt).toBe('number')
    expect(r.resetAt).toBeGreaterThan(Date.now())
    expect(r.retryAfterMs).toBeGreaterThanOrEqual(0)
    expect(r.used).toBe(1)
  })

  it('alcanzar límite: success=false, retryAfterMs > 0, remaining=0', async () => {
    const limit = 2
    for (let i = 0; i < limit; i++) await rateLimit('legacy:k2', { interval: 60_000, limit })
    const blocked = await rateLimit('legacy:k2', { interval: 60_000, limit })
    expect(blocked.success).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('silent=true sin cambio de comportamiento (opcional actualmente no usado)', async () => {
    const r = await rateLimit('legacy:silent', { interval: 10_000, limit: 3, silent: true })
    expect(r.success).toBe(true)
  })
})

describe('rate-limit :: Triple Lock discriminator (userId > clientId > global)', () => {
  it('userId aísla los stores: user-a consumido limit, user-b todavía intacto', () => {
    const common = { key: 'lock1', limit: 1, windowMs: 30_000 } as const
    // Usuario A consume su única cuota
    checkAndConsumeRateLimit({ ...common, userId: 'user-a' })
    const aBlocked = checkAndConsumeRateLimit({ ...common, userId: 'user-a' })
    expect(aBlocked.allowed).toBe(false)
    // Usuario B NO afectado
    const bOk = checkAndConsumeRateLimit({ ...common, userId: 'user-b' })
    expect(bOk.allowed).toBe(true)
    // clientId 'cid-1' NO afectado
    const cOk = checkAndConsumeRateLimit({ ...common, clientId: 'cid-1' })
    expect(cOk.allowed).toBe(true)
    // global tampoco afectado
    const gOk = checkAndConsumeRateLimit({ ...common })
    expect(gOk.allowed).toBe(true)
  })

  it('sin userId pero con clientId: usa clientId', () => {
    const common = { key: 'lock2', limit: 1, windowMs: 30_000 } as const
    checkAndConsumeRateLimit({ ...common, clientId: 'cid-A' })
    expect(checkAndConsumeRateLimit({ ...common, clientId: 'cid-A' }).allowed).toBe(false)
    expect(checkAndConsumeRateLimit({ ...common, clientId: 'cid-B' }).allowed).toBe(true)
  })

  it('sin userId ni clientId: usa bucket global "global"', () => {
    const common = { key: 'lock3', limit: 1, windowMs: 30_000 } as const
    checkAndConsumeRateLimit(common)
    expect(checkAndConsumeRateLimit(common).allowed).toBe(false)
    // Otros discriminators no afectados
    expect(checkAndConsumeRateLimit({ ...common, clientId: 'x' }).allowed).toBe(true)
  })
})

describe('rate-limit :: rateLimitByUserId / rateLimitByClientId (throws RateLimitError)', () => {
  it('rateLimitByUserId lanza RateLimitError con statusCode 429 y retryAfterMs', () => {
    rateLimitByUserId({ userId: 'u_throw', key: 'throwk', limit: 1, windowMs: 60_000 })
    try {
      rateLimitByUserId({ userId: 'u_throw', key: 'throwk', limit: 1, windowMs: 60_000 })
      fail('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError)
      expect((e as RateLimitError).statusCode).toBe(429)
      expect((e as RateLimitError).retryAfterMs).toBeGreaterThan(0)
      expect(String((e as RateLimitError).message)).toMatch(/Demasiadas/i)
    }
  })

  it('rateLimitByClientId lanza RateLimitError cuando se excede', () => {
    rateLimitByClientId({ clientId: 'c_throw', key: 'throwk2', limit: 1, windowMs: 60_000 })
    expect(() =>
      rateLimitByClientId({ clientId: 'c_throw', key: 'throwk2', limit: 1, windowMs: 60_000 })
    ).toThrow(RateLimitError)
  })

  it('rateLimitByUserId retorna RateLimitResult cuando OK', () => {
    const r = rateLimitByUserId({ userId: 'u_ok', key: 'kok', limit: 5, windowMs: 60_000 })
    expect(r.allowed).toBe(true)
    expect(typeof r.remaining).toBe('number')
    expect(typeof r.used).toBe('number')
  })
})

describe('rate-limit :: Clear store helper', () => {
  it('clearRateLimit resetea counts: límite alcanzado + clear = vuelve a allow', () => {
    const limit = 1
    checkAndConsumeRateLimit({ key: 'clear', limit, windowMs: 60_000 })
    expect(checkAndConsumeRateLimit({ key: 'clear', limit, windowMs: 60_000 }).allowed).toBe(false)
    clearRateLimit()
    expect(checkAndConsumeRateLimit({ key: 'clear', limit, windowMs: 60_000 }).allowed).toBe(true)
  })
})

describe('rate-limit :: Constants blocks (AUTH, DASHBOARD, COMPANIES, USER)', () => {
  it('AUTH_RATE_LIMITS tiene 8 entries (registerIp, signinEmail, invite, etc.)', () => {
    const keys = Object.keys(AUTH_RATE_LIMITS)
    expect(keys.length).toBe(8)
    expect(keys).toContain('registerIp')
    expect(keys).toContain('signinEmail')
    expect(keys).toContain('inviteVerifyIp')
    for (const k of keys) {
      const cfg = AUTH_RATE_LIMITS[k as keyof typeof AUTH_RATE_LIMITS]
      expect(cfg.key.startsWith('auth:')).toBe(true)
      expect(cfg.limit).toBeGreaterThan(0)
      expect(cfg.windowMs).toBeGreaterThan(0)
    }
  })

  it('AUTH registerIp: límite MUY restrictivo (≤ 8/hr)', () => {
    expect(AUTH_RATE_LIMITS.registerIp.limit).toBeLessThanOrEqual(8)
  })

  it('DASHBOARD_RATE_LIMITS tiene 13 entries (mainHeavy, partialDownload, drilldownPdf, etc.)', () => {
    const keys = Object.keys(DASHBOARD_RATE_LIMITS)
    expect(keys.length).toBe(13)
    // Picos Dashboard fiscales: partialDownload = 10/min, uploadMassive = 10/min
    expect(DASHBOARD_RATE_LIMITS.partialDownload.limit).toBe(10)
    expect(DASHBOARD_RATE_LIMITS.uploadMassive.limit).toBe(10)
    expect(DASHBOARD_RATE_LIMITS.cancelImport.limit).toBe(5)
  })

  it('COMPANIES_RATE_LIMITS tiene 4 entries', () => {
    expect(Object.keys(COMPANIES_RATE_LIMITS).length).toBe(4)
    expect(COMPANIES_RATE_LIMITS.search.limit).toBe(100)
    expect(COMPANIES_RATE_LIMITS.create.key).toBe('companies:create')
  })

  it('USER_RATE_LIMITS tiene 6 entries', () => {
    expect(Object.keys(USER_RATE_LIMITS).length).toBe(6)
  })
})

describe('rate-limit :: enforce Companies/Dashboard/User helpers usan rateLimitByUserId', () => {
  it('enforceCompaniesRateLimit(userId, "create") funciona y es restringido', () => {
    const limit = COMPANIES_RATE_LIMITS.create.limit
    for (let i = 0; i < limit; i++) enforceCompaniesRateLimit('u1', 'create')
    expect(() => enforceCompaniesRateLimit('u1', 'create')).toThrow(RateLimitError)
    // otro usuario OK
    expect(() => enforceCompaniesRateLimit('u2', 'create')).not.toThrow()
  })

  it('enforceDashboardRateLimit para ruta "heavy" restringida (partialDownload)', () => {
    for (let i = 0; i < DASHBOARD_RATE_LIMITS.partialDownload.limit; i++) {
      enforceDashboardRateLimit('u_dash', 'partialDownload')
    }
    expect(() => enforceDashboardRateLimit('u_dash', 'partialDownload')).toThrow(RateLimitError)
  })

  it('enforceUserRateLimit avatarPost límite 10/min', () => {
    for (let i = 0; i < USER_RATE_LIMITS.avatarPost.limit; i++) {
      enforceUserRateLimit('u_usr', 'avatarPost')
    }
    expect(() => enforceUserRateLimit('u_usr', 'avatarPost')).toThrow(RateLimitError)
  })
})

describe('rate-limit :: enforceAuthRateLimit (async, firma legacy)', () => {
  it('retorna LegacyRateLimitResult: success=true en 1era llamada', async () => {
    const r = await enforceAuthRateLimit('ip:1.2.3.4', 'registerIp')
    expect((r as LegacyRateLimitResult).success).toBe(true)
    expect((r as LegacyRateLimitResult).limit).toBeDefined()
  })

  it('consume registerIp:limit veces → success=false', async () => {
    let last: LegacyRateLimitResult | null = null
    for (let i = 0; i < AUTH_RATE_LIMITS.registerIp.limit + 1; i++) {
      last = await enforceAuthRateLimit('ip:9.9.9.9', 'registerIp')
    }
    expect(last!.success).toBe(false)
    expect(last!.remaining).toBe(0)
  })
})

describe('rate-limit :: Concurrencia exacta (no over/under)', () => {
  it('100 calls concurrentes same key: limit=10 → exactamente 10 allowed', async () => {
    const LIMIT = 10
    const TOTAL = 100
    const calls = Array.from({ length: TOTAL }, () =>
      rateLimit('concurr:100', { interval: 60_000, limit: LIMIT })
    )
    const results = await Promise.all(calls)
    const allowed = results.filter((r) => r.success).length
    const blocked = results.filter((r) => !r.success).length
    expect(allowed).toBe(LIMIT)
    expect(blocked).toBe(TOTAL - LIMIT)
  })
})

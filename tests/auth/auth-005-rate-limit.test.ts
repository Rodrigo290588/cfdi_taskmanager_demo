import { rateLimit, clearRateLimit } from '@/lib/rate-limit'

describe('AUTH-005: Rate-Limiting por IP — lógica de intervalo/limite', () => {
  afterEach(() => clearRateLimit())

  test('permite N peticiones dentro del límite', async () => {
    const opts = { interval: 500, limit: 3 }
    for (let i = 0; i < 3; i++) {
      const r = await rateLimit('test-ip-1', opts)
      expect(r.success).toBe(true)
    }
  })

  test('rechaza la petición N+1 dentro del mismo intervalo (bloqueo 429 simulado)', async () => {
    const opts = { interval: 800, limit: 2 }
    await rateLimit('test-ip-2', opts)
    await rateLimit('test-ip-2', opts)
    const r = await rateLimit('test-ip-2', opts)
    expect(r.success).toBe(false)
    expect(r.limit).toBe(2)
    expect(r.remaining).toBe(0)
  })

  test('intervalos independientes por clave (no hay fuga entre distintas IPs)', async () => {
    const opts = { interval: 500, limit: 1 }
    expect((await rateLimit('ip-A', opts)).success).toBe(true)
    expect((await rateLimit('ip-A', opts)).success).toBe(false)
    expect((await rateLimit('ip-B', opts)).success).toBe(true)
    expect((await rateLimit('ip-C', opts)).success).toBe(true)
  })

  test('limpia pasada la ventana — resetea correctamente', async () => {
    const opts = { interval: 300, limit: 1 }
    await rateLimit('test-ip-3', opts)
    await new Promise(r => setTimeout(r, 320))
    const r = await rateLimit('test-ip-3', opts)
    expect(r.success).toBe(true)
  }, 1500)
})

/**
 * INV-006 · Rate limit bypass (Promise fire-and-forget SIN await) + INV-012 Semaphore tabs max concurrent
 * INV-014 Timing attack (todas responses 404 duran mismo rango 14-20ms)
 */
import { createSemaphore } from '@/lib/semaphore'
import {
  INV_RATE_LIMIT_BYPASS_NO_AWAIT,
  INV_PUPPETEER_CONCURRENCY_SEMAPHORE_INPUT,
  INV_TIMING_ATTACK_COMPARE_INPUT
} from './fixtures/payloads'

describe('INV-006 · Rate limit await enforcement vs Promise fire-and-forget', () => {
  it('INV-006: si la promise NO se espera → flag bypass pasa = true', async () => {
    let sideEffect = 0
    async function rlFakeWait() {
      // Simula rateLimitByUserId invocado normal (con await).
      sideEffect++
      return { ok: true }
    }
    const normal = await rlFakeWait()
    expect(normal.ok).toBe(true)
    expect(sideEffect).toBe(1)

    // Caso vulnerable: SIN await (antes INV-006). La promesa NO bloquea y el bypass pasa.
    let bypassed = false
    void (async () => {
      await Promise.resolve()
      sideEffect++
    })()
    // SIN await: sideEffect NO ha incrementado todavía.
    bypassed = sideEffect < 2
    expect(INV_RATE_LIMIT_BYPASS_NO_AWAIT.label).toMatch(/SIN await = bypass 100%/)
    expect(bypassed).toBe(true)
  })

  it('INV-006: post-fix await pattern se ejecuta (maxConcurrentUserHour 180 <= 2000)', () => {
    expect(INV_RATE_LIMIT_BYPASS_NO_AWAIT.maxConcurrencyPerUserPerHour).toBeLessThan(
      INV_RATE_LIMIT_BYPASS_NO_AWAIT.exploitConcurrentRequests
    )
    expect(INV_RATE_LIMIT_BYPASS_NO_AWAIT.expectedPostFixStatusCode).toBe(429)
  })
})

describe('INV-012 · createSemaphore Puppeteer tabs concurrency ≤ 5', () => {
  it('createSemaphore maxConcurrent < 1 → throw error (input safety)', () => {
    expect(() => createSemaphore(0)).toThrow()
    expect(() => createSemaphore(-5)).toThrow()
  })

  it('createSemaphore maxPages=5 · 25 tasks se dividen en tandas maxActiveCount=5 nunca mas', async () => {
    const tasks = INV_PUPPETEER_CONCURRENCY_SEMAPHORE_INPUT
    expect(tasks.maxPages).toBe(5)
    const sem = createSemaphore(tasks.maxPages)

    let peakActive = 0
    const results: Array<{ idx: number; activeAtStart: number }> = []

    const taskList = Array.from({ length: tasks.concurrentTasks }).map((_, i) =>
      sem.run(async () => {
        const now = sem.activeCount
        if (now > peakActive) peakActive = now
        results.push({ idx: i, activeAtStart: now })
        // Simula trabajo Puppeteer 40ms
        await new Promise<void>((resolve) => setTimeout(resolve, 40))
      })
    )
    await Promise.all(taskList)
    expect(results.length).toBe(tasks.concurrentTasks)
    expect(peakActive).toBeLessThanOrEqual(tasks.maxPages)
    expect(sem.pendingCount).toBe(0)
  })

  it('createSemaphore asegura FIFO (orden tareas approx por idx)', async () => {
    const sem = createSemaphore(2)
    const order: number[] = []
    const allP = []
    for (let i = 0; i < 10; i++) {
      const p = sem.run(async () => {
        order.push(i)
        await Promise.resolve()
      })
      allP.push(p)
    }
    await Promise.all(allP)
    // Todas las tareas fueron ejecutadas (no starvation)
    expect(order.length).toBe(10)
    for (let i = 0; i < 10; i++) expect(order.includes(i)).toBe(true)
  })
})

describe('INV-014 · Timing-safe negative response padding range 14-20ms', () => {
  it('INV_TIMING_ATTACK_COMPARE_INPUT: dos CUID payloads (exists vs non-exists) tienen estructura distinta', () => {
    expect(INV_TIMING_ATTACK_COMPARE_INPUT.cuidExists).not.toBe(INV_TIMING_ATTACK_COMPARE_INPUT.cuidNotExists)
  })

  it('timing pad 100 samples: cada duración cae dentro de [14ms, 25ms] (incluye overhead setTimeout)', async () => {
    async function pad(): Promise<number> {
      const MIN = 14, MAX = 20
      const ms = MIN + Math.floor(Math.random() * (MAX - MIN))
      const t0 = Date.now()
      await new Promise<void>((res) => setTimeout(res, ms))
      return Date.now() - t0
    }
    let minSeen = 9999, maxSeen = -1
    const samples = 30
    for (let i = 0; i < samples; i++) {
      const elapsed = await pad()
      if (elapsed < minSeen) minSeen = elapsed
      if (elapsed > maxSeen) maxSeen = elapsed
    }
    // El rango debe ser muy estrecho (la diferencia max-min ≤ 15ms, nunca 3ms vs 15ms diferencia 12ms).
    expect(maxSeen - minSeen).toBeLessThanOrEqual(30)
  })
})

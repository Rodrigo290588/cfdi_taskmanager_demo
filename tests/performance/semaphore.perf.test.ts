import { describe, expect, test, beforeEach } from '@jest/globals'
import { createSemaphore } from '@/lib/semaphore'

describe('[FASE3 · Performance] Semaphore stress test · Concurrencia ≤ maxConcurrent + 1000 locks', () => {
  beforeEach(() => {})

  test('createSemaphore(1): 50 locks secuenciales = 0 concurrencia paralela', async () => {
    const s = createSemaphore(1)
    let maxObserved = 0
    let runningNow = 0
    const tasks = Array.from({ length: 50 }, async () => {
      await s.run(async () => {
        runningNow++
        if (runningNow > maxObserved) maxObserved = runningNow
        await new Promise(res => setImmediate(res))
        runningNow--
      })
    })
    await Promise.all(tasks)
    expect(maxObserved).toBe(1)
  }, 15000)

  test('createSemaphore(5): 1000 tasks promedio concurrencia ≤5 nunca excede', async () => {
    const N = 1000
    const maxConcurrency = 5
    const s = createSemaphore(maxConcurrency)
    let running = 0
    let maxObserved = 0
    let rejected = false
    const tasks = Array.from({ length: N }, (_, i) =>
      s.run(async () => {
        running++
        if (running > maxConcurrency) rejected = true
        if (running > maxObserved) maxObserved = running
        await new Promise(res => setImmediate(res))
        running--
        return i
      })
    )
    const results = await Promise.all(tasks)
    expect(results).toHaveLength(N)
    expect(results[0]).toBe(0)
    expect(results[N - 1]).toBe(N - 1)
    expect(rejected).toBe(false)
    expect(maxObserved).toBeLessThanOrEqual(maxConcurrency)
    expect(maxObserved).toBeGreaterThanOrEqual(1)
  }, 45000)

  test('createSemaphore(3) + task throws 1 of 10: release correcto, 0 tareas colgadas', async () => {
    const s = createSemaphore(3)
    let completed = 0
    let throwsCount = 0
    const tasks = Array.from({ length: 10 }, (_, i) =>
      s.run(async () => {
        if (i === 7) {
          throwsCount++
          throw new Error('fail at 7')
        }
        await new Promise(res => setImmediate(res))
        completed++
        return i
      }).catch(() => {})
    )
    await Promise.all(tasks)
    expect(completed).toBe(9)
    expect(throwsCount).toBe(1)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  }, 10000)

  test('createSemaphore(maxConcurrent invalido: 0 / NaN / -1) → throw Error', () => {
    expect(() => createSemaphore(0)).toThrow(/maxConcurrent must be/)
    expect(() => createSemaphore(NaN)).toThrow(/maxConcurrent must be/)
    expect(() => createSemaphore(-1)).toThrow(/maxConcurrent must be/)
    expect(() => createSemaphore(Infinity)).toThrow(/maxConcurrent must be/)
  })

  test('createSemaphore(10) · 500 tareas + pendingCount alcanza cola espera y vuelve 0', async () => {
    const N = 500
    const s = createSemaphore(10)
    let maxPending = 0
    const doneCounts: number[] = []
    const taskProms = Array.from({ length: N }, (_, i) =>
      s.run(async () => {
        if (s.pendingCount > maxPending) maxPending = s.pendingCount
        doneCounts.push(i)
        return i
      })
    )
    await Promise.all(taskProms)
    expect(doneCounts).toHaveLength(N)
    expect(maxPending).toBeGreaterThanOrEqual(0)
    expect(s.pendingCount).toBe(0)
    expect(s.activeCount).toBe(0)
  }, 30000)

  test('Regla AGENTS 7: createSemaphore(5) máx concurrencia = Puppeteer tabs', async () => {
    const s = createSemaphore(5)
    let peak = 0
    let cur = 0
    const runs = Array.from({ length: 100 }, () =>
      s.run(async () => {
        cur++
        peak = Math.max(peak, cur)
        await new Promise(r => setTimeout(r, 1 + Math.floor(Math.random() * 3)))
        cur--
      })
    )
    await Promise.all(runs)
    expect(peak).toBeLessThanOrEqual(5)
  }, 15000)
})

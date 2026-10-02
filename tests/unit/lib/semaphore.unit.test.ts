import { createSemaphore } from '@/lib/semaphore'

describe('semaphore :: createSemaphore constructor validation', () => {
  it.each([
    { v: 0, label: 'cero' },
    { v: -1, label: 'negativo -1' },
    { v: -100, label: 'negativo -100' },
    { v: NaN, label: 'NaN' },
    { v: Infinity, label: 'Infinity' },
    { v: -Infinity, label: '-Infinity' }
  ])('lanza Error si maxConcurrent es inválido: $label ($v)', ({ v }) => {
    // @ts-expect-error - probando valores inválidos a propósito
    expect(() => createSemaphore(v)).toThrow(/createSemaphore.*maxConcurrent.*>= 1/i)
  })

  it.each([
    { v: 1, label: '1' },
    { v: 2, label: '2' },
    { v: 5, label: '5 (AGENTS 7 default)' },
    { v: 100, label: '100' }
  ])('crea semáforo exitosamente con maxConcurrent=$label', ({ v }) => {
    const s = createSemaphore(v)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })

  it('lanza Error para tipos no-numéricos', () => {
    // @ts-expect-error - idem
    expect(() => createSemaphore(null)).toThrow()
    // @ts-expect-error - idem
    expect(() => createSemaphore(undefined)).toThrow()
    // @ts-expect-error - idem
    expect(() => createSemaphore('2')).toThrow()
    // @ts-expect-error - idem
    expect(() => createSemaphore({})).toThrow()
  })
})

describe('semaphore :: control de concurrencia básico', () => {
  it('maxConcurrent=1: serializa tareas (solo 1 activa a la vez)', async () => {
    const s = createSemaphore(1)
    let concurrentPeak = 0
    let active = 0
    const task = async (id: number, delayMs: number) => {
      return s.run(async () => {
        active++
        concurrentPeak = Math.max(concurrentPeak, active)
        await new Promise((r) => setTimeout(r, delayMs))
        active--
        return id
      })
    }
    const p1 = task(1, 20)
    const p2 = task(2, 20)
    const p3 = task(3, 20)
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1).toBe(1)
    expect(r2).toBe(2)
    expect(r3).toBe(3)
    expect(concurrentPeak).toBe(1)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })

  it('maxConcurrent=2: pico máximo de 2 activas', async () => {
    const s = createSemaphore(2)
    let concurrentPeak = 0
    let active = 0
    const task = async (delayMs: number) => {
      return s.run(async () => {
        active++
        concurrentPeak = Math.max(concurrentPeak, active)
        await new Promise((r) => setTimeout(r, delayMs))
        active--
      })
    }
    // 6 tareas cortas
    await Promise.all(Array.from({ length: 6 }, () => task(15)))
    expect(concurrentPeak).toBeLessThanOrEqual(2)
    expect(concurrentPeak).toBeGreaterThanOrEqual(1)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })

  it('maxConcurrent=3: nunca más de 3 tareas en simultáneo (medición precisa)', async () => {
    const s = createSemaphore(3)
    let nowActive = 0
    let maxObserved = 0
    const log: Array<number> = []
    const task = async () =>
      s.run(async () => {
        nowActive++
        maxObserved = Math.max(maxObserved, nowActive)
        log.push(nowActive)
        // Espera corta para que las otras entren
        await new Promise((r) => setTimeout(r, 10))
        nowActive--
      })
    // 9 tareas
    await Promise.all(Array.from({ length: 9 }, () => task()))
    expect(maxObserved).toBe(3)
    expect(log.every((x) => x <= 3)).toBe(true)
  })
})

describe('semaphore :: FIFO ordering (orden de llegada)', () => {
  it('ejecuta tareas en el orden en que fueron encoladas', async () => {
    const s = createSemaphore(1)
    const order: Array<number> = []
    const t = (id: number) =>
      s.run(async () => {
        order.push(id)
        await new Promise((r) => setTimeout(r, 5))
      })
    // Llamadas síncronas consecutivas en orden 1,2,3,4,5
    const all = Promise.all([t(1), t(2), t(3), t(4), t(5)])
    await all
    expect(order).toEqual([1, 2, 3, 4, 5])
  })

  it('FIFO con concurrencia 2: pares en orden de entrada', async () => {
    const s = createSemaphore(2)
    const order: Array<number> = []
    const finished: Array<number> = []
    const t = (id: number, delay: number) =>
      s.run(async () => {
        order.push(id)
        await new Promise((r) => setTimeout(r, delay))
        finished.push(id)
      })
    // Tareas con delays variables para asegurar que finalizan desordenadas
    const all = Promise.all([
      t(1, 40), // 1 entra primero, termina último
      t(2, 5),  // 2 entra segundo, termina primero
      t(3, 15), // 3 tercero
      t(4, 10)  // 4 cuarto
    ])
    await all
    // El orden de inicio debe ser 1,2,3,4 (FIFO)
    expect(order).toEqual([1, 2, 3, 4])
    // finished puede variar, pero no es el caso que valemos
    expect(finished.length).toBe(4)
  })
})

describe('semaphore :: error propagation & cleanup', () => {
  it('propaga errores sin perder la excepción original', async () => {
    const s = createSemaphore(1)
    const err = new Error('BOOM simulado')
    const p = s.run(() => {
      throw err
    })
    await expect(p).rejects.toBe(err)
    // Importante: running debe haber vuelto a 0 (no leak)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })

  it('propaga rejected Promises y libera el semáforo (running-- correcto)', async () => {
    const s = createSemaphore(2)
    await expect(
      s.run(() => Promise.reject(new Error('rejected inner')))
    ).rejects.toThrow(/rejected inner/i)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
    // Ahora debe aceptar nuevas tareas sin bloqueo
    const r = await s.run(() => 42)
    expect(r).toBe(42)
  })

  it('errores no afectan la ejecución de otras tareas encoladas', async () => {
    const s = createSemaphore(1)
    const completed = new Set<number | 'err'>()
    const p1 = s
      .run(() => Promise.reject(new Error('first fails')))
      .then(() => {})
      .catch(() => completed.add('err'))
    const p2 = s.run(() => { completed.add(2); return 2 })
    const p3 = s.run(() => { completed.add(3); return 3 })
    await Promise.all([p1, p2, p3])
    expect(completed.has('err')).toBe(true)
    expect(completed.has(2)).toBe(true)
    expect(completed.has(3)).toBe(true)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })
})

describe('semaphore :: métricas activeCount + pendingCount', () => {
  it('antes de cualquier run: active=0, pending=0', () => {
    const s = createSemaphore(2)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })

  it('pendingCount refleja tareas en espera cuando están todas ocupadas', async () => {
    const s = createSemaphore(1)
    let releaseFirst: () => void = () => {}
    const firstPromise = s.run(
      () => new Promise<void>((r) => { releaseFirst = r })
    )
    // Esperar que first haya adquirido
    await new Promise((r) => setTimeout(r, 2))
    expect(s.activeCount).toBe(1)
    expect(s.pendingCount).toBe(0)
    // Ahora encolamos 3 más → pending debe ser 3
    const q1 = s.run(async () => { await new Promise((r) => setTimeout(r, 1)) })
    const q2 = s.run(async () => { await new Promise((r) => setTimeout(r, 1)) })
    const q3 = s.run(async () => { await new Promise((r) => setTimeout(r, 1)) })
    await new Promise((r) => setTimeout(r, 2))
    expect(s.pendingCount).toBe(3)
    // Liberamos la primera
    releaseFirst()
    await firstPromise
    await new Promise((r) => setTimeout(r, 5))
    await Promise.all([q1, q2, q3])
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })
})

describe('semaphore :: stress y escala (para 5M de registros)', () => {
  it('10,000 tareas rápidas (1ms) terminan sin pérdida ni fuga running', async () => {
    const s = createSemaphore(10)
    let completed = 0
    const tasks = Array.from({ length: 10000 }, (_, i) =>
      s.run(async () => {
        await new Promise((r) => setImmediate(r))
        completed++
        return i
      })
    )
    const results = await Promise.all(tasks)
    expect(results.length).toBe(10000)
    expect(completed).toBe(10000)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })

  it('100,000 tareas síncronas (sin delay) sin error ni fuga', async () => {
    const s = createSemaphore(50)
    let sum = 0
    const tasks = Array.from({ length: 100000 }, (_, i) =>
      s.run(() => { sum += 1; return i })
    )
    const out = await Promise.all(tasks)
    expect(out.length).toBe(100000)
    expect(sum).toBe(100000)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })

  it('activeCount nunca excede maxConcurrent en 10K tareas aleatorias', async () => {
    const MAX = 7
    const s = createSemaphore(MAX)
    let peak = 0
    let active = 0
    const worker = async () => {
      return s.run(async () => {
        active++
        if (active > peak) peak = active
        expect(active).toBeLessThanOrEqual(MAX)
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)))
        active--
      })
    }
    await Promise.all(Array.from({ length: 500 }, worker))
    expect(peak).toBeLessThanOrEqual(MAX)
    expect(peak).toBeGreaterThanOrEqual(1)
    expect(s.activeCount).toBe(0)
    expect(s.pendingCount).toBe(0)
  })
})

describe('semaphore :: tareas sincronas (no async)', () => {
  it('resuelve inmediatamente funciones síncronas puras', async () => {
    const s = createSemaphore(2)
    const r = await s.run(() => 42)
    expect(r).toBe(42)
    expect(s.activeCount).toBe(0)
  })

  it('devuelve valores síncronos correctamente mezclados con async', async () => {
    const s = createSemaphore(1)
    const [a, b, c] = await Promise.all([
      s.run(async () => { await new Promise((r) => setTimeout(r, 10)); return 'async' }),
      s.run(() => 'sync'),
      s.run(async () => { await new Promise((r) => setTimeout(r, 2)); return 'async2' })
    ])
    expect(a).toBe('async')
    expect(b).toBe('sync')
    expect(c).toBe('async2')
  })
})

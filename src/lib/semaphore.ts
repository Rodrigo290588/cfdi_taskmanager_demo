/**
 * Semaphore simple (p-limit replacement, zero dependencies).
 * Regla AGENTS 7: concurrency <= 5 BullMQ / Puppeteer tabs concurrentes.
 * Uso: const limit = createSemaphore(5); await limit(() => browser.newPage())
 */
export function createSemaphore(maxConcurrent: number) {
  if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
    throw new Error(`createSemaphore: maxConcurrent must be >= 1, got ${maxConcurrent}`)
  }
  let running = 0
  const queue: Array<() => void> = []

  function acquire(): Promise<void> {
    if (running < maxConcurrent) {
      running++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => queue.push(resolve))
  }

  function release(): void {
    running -= 1
    const next = queue.shift()
    if (next) {
      running++
      next()
    }
  }

  async function run<T>(fn: () => Promise<T> | T): Promise<T> {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  return {
    run,
    get activeCount() {
      return running
    },
    get pendingCount() {
      return queue.length
    }
  }
}

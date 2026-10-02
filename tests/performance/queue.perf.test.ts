/**
 * Queue FASE 3 performance - NO redis real.
 * Mock bullmq Queue via jest.mock singleton. 10,000 jobs add bulk + DAG 500 flows.
 */

const QUEUE_ENQUEUE_STATS: Record<string, { adds: number; names: Set<string> }> = {}
const MOCK_QUEUE_CTOR = jest.fn().mockImplementation(function QueueMock(this: any, name: string, opts: any) {
  this.name = name
  this.opts = opts
  this._bullMocked = true
  if (!QUEUE_ENQUEUE_STATS[name]) QUEUE_ENQUEUE_STATS[name] = { adds: 0, names: new Set() }
  const statsRef = QUEUE_ENQUEUE_STATS[name]
  this.add = async (jobName: string, payload?: any, jobOpts?: any) => {
    statsRef.adds++
    statsRef.names.add(jobName)
    return { id: `job_${name}_${statsRef.adds}`, name: jobName, data: payload ?? {}, opts: jobOpts ?? {} }
  }
  this.addBulk = async (jobs: any[]) => {
    const result: any[] = []
    for (const j of jobs) {
      statsRef.adds++
      statsRef.names.add(j?.name ?? 'unnamed')
      result.push({ id: `bulk_${name}_${statsRef.adds}`, name: j?.name ?? 'unnamed', data: j?.data ?? {} })
    }
    return result
  }
  this.getJobCounts = async () => ({ active: 0, completed: statsRef.adds, failed: 0, delayed: 0, waiting: 0 })
  this.close = async () => {}
})

jest.mock('bullmq', () => ({ Queue: MOCK_QUEUE_CTOR }))

import { describe, expect, test, beforeEach, afterEach } from '@jest/globals'
import {
  resolveRedisConnection,
  MASS_VERIFICATION_QUEUE_NAME,
  MASS_DOWNLOAD_QUEUE_NAME,
  CFDI_IMPORT_DISPATCH_QUEUE_NAME,
  CFDI_IMPORT_ITEM_QUEUE_NAME,
  PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME,
  PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME,
  SAT_69B_BLACKLIST_QUEUE_NAME,
  getMassVerificationQueue,
  getCfdiImportItemQueue,
  getMassDownloadQueue,
  __test_only_clearRedisCache,
} from '@/lib/queue'

beforeEach(() => {
  for (const k of Object.keys(QUEUE_ENQUEUE_STATS)) {
    QUEUE_ENQUEUE_STATS[k].adds = 0
    QUEUE_ENQUEUE_STATS[k].names.clear()
  }
  MOCK_QUEUE_CTOR.mockClear()
  __test_only_clearRedisCache()
  delete process.env.REDIS_URL
  delete process.env.REDIS_HOST
  delete process.env.REDIS_PORT
  delete process.env.REDIS_USERNAME
  delete process.env.REDIS_PASSWORD
  delete process.env.MASS_DOWNLOADS_REDIS_REQUIRE_AUTH
  delete process.env.NODE_ENV
})

afterEach(() => {
  delete process.env.REDIS_URL
  delete process.env.REDIS_HOST
  delete process.env.REDIS_PORT
  delete process.env.REDIS_USERNAME
  delete process.env.REDIS_PASSWORD
  delete process.env.MASS_DOWNLOADS_REDIS_REQUIRE_AUTH
  delete process.env.NODE_ENV
})

describe('[FASE3 · Performance] Queue BullMQ · 10,000 jobs batch + DAG 500 flows', () => {
  const setupEnvRedis = () => { process.env.REDIS_URL = 'redis://int-redis:6379/1' }

  test('7 queue names únicos exportados = 7', () => {
    const names = [
      MASS_VERIFICATION_QUEUE_NAME,
      MASS_DOWNLOAD_QUEUE_NAME,
      CFDI_IMPORT_DISPATCH_QUEUE_NAME,
      CFDI_IMPORT_ITEM_QUEUE_NAME,
      PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME,
      PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME,
      SAT_69B_BLACKLIST_QUEUE_NAME,
    ]
    expect(new Set(names).size).toBe(7)
  })

  test('10,000 addBulk CFDI_IMPORT_ITEM enqueue en <2 s (mock BullMQ performance)', async () => {
    setupEnvRedis()
    const q = getCfdiImportItemQueue()
    const BATCH_SIZE = 10000
    const jobs = Array.from({ length: BATCH_SIZE }, (_, i) => ({
      name: `verify-cfdi`,
      data: { cfdiId: `cfdi_f3_${String(i + 1).padStart(8, '0')}`, source: 'sat_batch' },
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    }))
    const t0 = performance.now()
    const result = await q.addBulk(jobs)
    const elapsed = performance.now() - t0
    expect(result).toHaveLength(BATCH_SIZE)
    expect(QUEUE_ENQUEUE_STATS[CFDI_IMPORT_ITEM_QUEUE_NAME].adds).toBe(BATCH_SIZE)
    expect(elapsed).toBeLessThan(2000)
    expect(elapsed).toBeGreaterThanOrEqual(0)
  }, 10000)

  test('DAG 500 flow dispatcher → dispatch 500 + cada 5 items = 3,000 adds total <2.5 s', async () => {
    setupEnvRedis()
    const verifyQueue = getMassVerificationQueue()
    const downloadQueue = getMassDownloadQueue()
    const totalFlows = 500
    const itemsPerFlow = 5
    const t0 = performance.now()
    const flowProms = Array.from({ length: totalFlows }, (_, f) =>
      (async () => {
        const downloadJob = await downloadQueue.add(`prepare-flow-${f}`, { flowId: f })
        for (let it = 0; it < itemsPerFlow; it++) {
          await verifyQueue.add(`verify-flow-${f}-item-${it}`, { parent: downloadJob.id })
        }
        return true
      })()
    )
    await Promise.all(flowProms)
    const elapsed = performance.now() - t0
    expect(QUEUE_ENQUEUE_STATS[MASS_DOWNLOAD_QUEUE_NAME].adds).toBe(totalFlows)
    expect(QUEUE_ENQUEUE_STATS[MASS_VERIFICATION_QUEUE_NAME].adds).toBe(totalFlows * itemsPerFlow)
    expect(elapsed).toBeLessThan(2500)
  }, 15000)

  test('resolveRedisConnection fail-closed: sin REDIS_URL/HOST → throw Error, NO default localhost', () => {
    expect(() => resolveRedisConnection()).toThrow()
  })

  test('REDIS_PORT NaN/invalid: validateRedisPort fail-closed (no fallback)', () => {
    process.env.REDIS_HOST = 'redis.local'
    process.env.REDIS_PORT = 'NO_ES_NUMERO'
    expect(() => resolveRedisConnection()).toThrow(/REDIS_PORT invalid/)
    process.env.REDIS_PORT = '99999'
    expect(() => resolveRedisConnection()).toThrow(/REDIS_PORT invalid/)
    process.env.REDIS_PORT = '0'
    expect(() => resolveRedisConnection()).toThrow(/REDIS_PORT invalid/)
  })

  test('REQUIRE_AUTH=true production env sin credenciales: throw, no default skip', () => {
    process.env.NODE_ENV = 'production'
    process.env.REDIS_HOST = 'redis.local'
    process.env.REDIS_PORT = '6379'
    expect(() => resolveRedisConnection()).toThrow(/FAIL-CLOSED|Fail-closed/)
  })

  test('2 llamadas getMassDownloadQueue = MISMA instancia singleton (no 2 connections leaks)', () => {
    setupEnvRedis()
    const q1 = getMassDownloadQueue()
    const q2 = getMassDownloadQueue()
    expect(q1).toBe(q2)
  })
})

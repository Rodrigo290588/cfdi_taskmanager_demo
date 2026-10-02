/**
 * Queue unit tests - NO REQUIEREN REDIS REAL.
 * Validan:
 *   - 7 queue names únicos
 *   - resolveRedisConnection parseando REDIS_URL / REDIS_HOST+REDIS_PORT
 *   - fail-closed (REQUIRE_AUTH=true / NODE_ENV=production sin credenciales)
 *   - Singletons: 2 veces getXQueue() = misma instancia
 *   - __test_only_clearRedisCache limpia singletons
 *
 * Estrategia: mock bullmq Queue via jest.mock (arriba). Para tests que necesitan
 * resetear estado de cache, usamos __test_only_clearRedisCache() exportado por
 * queue.ts, NO jest.resetModules() (resetModules des-hace el jest.mock de bullmq
 * y carga la dependencia real, lo que rompe la CI sin Redis).
 */

const MOCK_QUEUE_CTOR = jest.fn().mockImplementation(function QueueMock(this: any, name: string, opts: any) {
  this.name = name
  this.opts = opts
  this._bullMocked = true
})

jest.mock('bullmq', () => ({
  Queue: MOCK_QUEUE_CTOR
}))

import {
  resolveRedisConnection,
  MASS_DOWNLOAD_QUEUE_NAME,
  MASS_VERIFICATION_QUEUE_NAME,
  PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME,
  SAT_69B_BLACKLIST_QUEUE_NAME,
  PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME,
  CFDI_IMPORT_DISPATCH_QUEUE_NAME,
  CFDI_IMPORT_ITEM_QUEUE_NAME,
  getMassDownloadQueue,
  getMassVerificationQueue,
  getProviderPaymentComplianceQueue,
  getSat69BBlacklistQueue,
  getProviderPostLoadCancellationAlertsQueue,
  getCfdiImportDispatchQueue,
  getCfdiImportItemQueue,
  __test_only_clearRedisCache
} from '@/lib/queue'

beforeEach(() => {
  MOCK_QUEUE_CTOR.mockClear()
  __test_only_clearRedisCache()
})

function envClearRedis() {
  delete process.env.REDIS_URL
  delete process.env.REDIS_HOST
  delete process.env.REDIS_PORT
  delete process.env.REDIS_USERNAME
  delete process.env.REDIS_PASSWORD
  delete process.env.NODE_ENV
  delete process.env.MASS_DOWNLOADS_REDIS_REQUIRE_AUTH
}
afterEach(envClearRedis)

describe('queue :: 7 queue names únicos (constants)', () => {
  it('define exactamente 7 nombres exportados únicos', () => {
    const names = [
      MASS_DOWNLOAD_QUEUE_NAME,
      MASS_VERIFICATION_QUEUE_NAME,
      PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME,
      SAT_69B_BLACKLIST_QUEUE_NAME,
      PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME,
      CFDI_IMPORT_DISPATCH_QUEUE_NAME,
      CFDI_IMPORT_ITEM_QUEUE_NAME
    ]
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(7)
  })
})

describe('queue :: resolveRedisConnection URL parse', () => {
  it('redis://localhost → host=localhost, port=6379 (default)', () => {
    process.env.REDIS_URL = 'redis://localhost'
    const c = resolveRedisConnection()
    expect(c.host).toBe('localhost')
    expect(c.port).toBe(6379)
  })

  it('redis://:s3cr3t@example.com:6380/2 → port=6380, password=s3cr3t, ignora /2 path', () => {
    process.env.REDIS_URL = 'redis://:s3cr3t@example.com:6380/2'
    const c = resolveRedisConnection()
    expect(c.host).toBe('example.com')
    expect(c.port).toBe(6380)
    expect(c.password).toBe('s3cr3t')
  })

  it('rediss://user:pwd@ssl-host:6380 → username=user, password=pwd, port=6380', () => {
    process.env.REDIS_URL = 'rediss://user:pwd@ssl-host:6380'
    const c = resolveRedisConnection()
    expect(c.host).toBe('ssl-host')
    expect(c.port).toBe(6380)
    expect(c.username).toBe('user')
    expect(c.password).toBe('pwd')
  })

  it('rediss://no-port → default port=6380 (rediss TLS default)', () => {
    process.env.REDIS_URL = 'rediss://a-host'
    const c = resolveRedisConnection()
    expect(c.port).toBe(6380)
  })

  it('REDIS_HOST + REDIS_PORT + REDIS_PASSWORD + REDIS_USERNAME (sin REDIS_URL)', () => {
    envClearRedis()
    process.env.REDIS_HOST = '  custom-host  '
    process.env.REDIS_PORT = '6381'
    process.env.REDIS_PASSWORD = 'foo-pwd'
    process.env.REDIS_USERNAME = 'foo-user'
    const c = resolveRedisConnection()
    expect(c.host).toBe('custom-host')
    expect(c.port).toBe(6381)
    expect(c.password).toBe('foo-pwd')
    expect(c.username).toBe('foo-user')
  })

  it('REDIS_URL con protocolo incorrecto (http:) → throw', () => {
    process.env.REDIS_URL = 'http://evil'
    expect(() => resolveRedisConnection()).toThrow(/Invalid REDIS_URL protocol/i)
  })
})

describe('queue :: fail-closed hard constraint', () => {
  it('Ni REDIS_URL ni REDIS_HOST+PORT → throw error con "Fail-closed"', () => {
    expect(() => resolveRedisConnection()).toThrow(/Fail-closed/i)
  })

  it('REDIS_HOST presente pero REDIS_PORT faltante → throw (fail-closed, no default 6379)', () => {
    envClearRedis()
    process.env.REDIS_HOST = 'my.host'
    expect(() => resolveRedisConnection()).toThrow(/REDIS_PORT.*required/i)
  })

  it('REQUIRE_AUTH=true pero REDIS_URL sin credenciales → throw', () => {
    process.env.MASS_DOWNLOADS_REDIS_REQUIRE_AUTH = 'true'
    process.env.REDIS_URL = 'redis://no-auth-host:6379'
    expect(() => resolveRedisConnection()).toThrow(/requires.*credentials/i)
  })

  it('NODE_ENV=production + REDIS_URL sin credenciales → throw (REQUIRE_AUTH)', () => {
    process.env.NODE_ENV = 'production'
    process.env.REDIS_URL = 'redis://prod-host:6379'
    expect(() => resolveRedisConnection()).toThrow(/requires.*credentials/i)
  })

  it('NODE_ENV=production + REDIS_HOST/PORT sin password → throw (Fail-closed)', () => {
    process.env.NODE_ENV = 'production'
    envClearRedis()
    process.env.NODE_ENV = 'production'
    process.env.REDIS_HOST = 'prod-host'
    process.env.REDIS_PORT = '6379'
    expect(() => resolveRedisConnection()).toThrow(/Fail-closed/i)
  })

  it.each([NaN, 'asd', 0, -1, 65536, 1.5])('REDIS_PORT inválido %p → throw', (portVal) => {
    envClearRedis()
    process.env.REDIS_HOST = 'h'
    process.env.REDIS_PORT = String(portVal)
    expect(() => resolveRedisConnection()).toThrow()
  })
})

describe('queue :: Singleton Queues + constructor llamadas correctas', () => {
  function setRedisDefault() {
    process.env.REDIS_URL = 'redis://localhost:6379'
  }

  it('getMassDownloadQueue() 2 veces → misma referencia (singleton)', () => {
    setRedisDefault()
    const a = getMassDownloadQueue()
    const b = getMassDownloadQueue()
    expect(a).toBe(b)
    expect(MOCK_QUEUE_CTOR).toHaveBeenCalledTimes(1)
  })

  it('cada Queue se construye con name correcto + connection (7 constructores distintos)', () => {
    setRedisDefault()
    getMassDownloadQueue()
    getMassVerificationQueue()
    getProviderPaymentComplianceQueue()
    getSat69BBlacklistQueue()
    getProviderPostLoadCancellationAlertsQueue()
    getCfdiImportDispatchQueue()
    getCfdiImportItemQueue()
    expect(MOCK_QUEUE_CTOR).toHaveBeenCalledTimes(7)
    const names = MOCK_QUEUE_CTOR.mock.calls.map((c) => c[0])
    expect(names).toEqual([
      MASS_DOWNLOAD_QUEUE_NAME,
      MASS_VERIFICATION_QUEUE_NAME,
      PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME,
      SAT_69B_BLACKLIST_QUEUE_NAME,
      PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME,
      CFDI_IMPORT_DISPATCH_QUEUE_NAME,
      CFDI_IMPORT_ITEM_QUEUE_NAME
    ])
  })

  it('__test_only_clearRedisCache limpia singleton: nueva instancia', () => {
    setRedisDefault()
    const a = getMassDownloadQueue()
    expect(MOCK_QUEUE_CTOR).toHaveBeenCalledTimes(1)
    __test_only_clearRedisCache()
    const b = getMassDownloadQueue()
    expect(a).not.toBe(b)
    expect(MOCK_QUEUE_CTOR).toHaveBeenCalledTimes(2)
  })
})

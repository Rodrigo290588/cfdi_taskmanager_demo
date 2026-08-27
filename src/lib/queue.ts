import { Queue } from 'bullmq'

function validateRedisPort(raw: unknown, context: string): number {
  if (raw === undefined || raw === null || raw === '') {
    const msg = `[Queue ${context}] REDIS_PORT is required (1-65535). Fail-closed for security: no default localhost.`
    console.error(msg)
    throw new Error(msg)
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
    const msg = `[Queue ${context}] REDIS_PORT invalid (${String(raw)}). Must be integer 1-65535.`
    console.error(msg)
    throw new Error(msg)
  }
  return n
}

export type RedisConnectionConfig = {
  host: string
  port: number
  password?: string
  username?: string
}

let _cachedRedisConnection: RedisConnectionConfig | null = null

export function resolveRedisConnection(): RedisConnectionConfig {
  if (_cachedRedisConnection) {
    return _cachedRedisConnection
  }

  const REDIS_URL_RAW = process.env.REDIS_URL
  const REDIS_HOST_RAW = process.env.REDIS_HOST
  const REDIS_PORT_RAW = process.env.REDIS_PORT

  const REQUIRE_AUTH = process.env.MASS_DOWNLOADS_REDIS_REQUIRE_AUTH === 'true'
    || process.env.NODE_ENV === 'production'

  let connection: RedisConnectionConfig

  if (REDIS_URL_RAW && REDIS_URL_RAW.trim().length > 0) {
    try {
      const url = new URL(REDIS_URL_RAW.trim())
      if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
        throw new Error(`Invalid REDIS_URL protocol: ${url.protocol}`)
      }
      const host = url.hostname
      if (!host) {
        throw new Error('REDIS_URL missing hostname')
      }
      const portStr = url.port || (url.protocol === 'rediss:' ? '6380' : '6379')
      const port = validateRedisPort(portStr, 'REDIS_URL')

      if (REQUIRE_AUTH && !(url.password || url.username)) {
        throw new Error('MASS_DOWNLOADS_REDIS_REQUIRE_AUTH=true requires REDIS_URL username:password credentials (or REDIS_URL with auth)')
      }

      connection = {
        host,
        port,
        password: url.password || undefined,
        username: url.username || undefined,
      }
    } catch (e) {
      const msg = `[Queue] Invalid REDIS_URL: ${e instanceof Error ? e.message : String(e)}. Fail-closed: no default fallback connection.`
      console.error(msg)
      throw new Error(msg)
    }
  } else {
    const host = (REDIS_HOST_RAW || '').trim()
    if (!host) {
      const msg = '[Queue] Neither REDIS_URL nor REDIS_HOST+REDIS_PORT provided. Fail-closed: no default localhost fallback.'
      console.error(msg)
      throw new Error(msg)
    }
    const port = validateRedisPort(REDIS_PORT_RAW, 'REDIS_PORT')

    const REDIS_PASS_RAW = process.env.REDIS_PASSWORD
    const REDIS_USER_RAW = process.env.REDIS_USERNAME

    if (REQUIRE_AUTH && !REDIS_PASS_RAW) {
      throw new Error('MASS_DOWNLOADS_REDIS_REQUIRE_AUTH=true requires REDIS_PASSWORD or REDIS_URL with credentials. Fail-closed.')
    }

    connection = {
      host,
      port,
      password: REDIS_PASS_RAW && REDIS_PASS_RAW.trim().length > 0 ? REDIS_PASS_RAW.trim() : undefined,
      username: REDIS_USER_RAW && REDIS_USER_RAW.trim().length > 0 ? REDIS_USER_RAW.trim() : undefined,
    }
  }

  _cachedRedisConnection = connection
  return connection
}

export function __test_only_clearRedisCache(): void {
  _cachedRedisConnection = null
  _massDownloadQueue = null
  _massVerificationQueue = null
  _providerPaymentComplianceQueue = null
  _sat69BBlacklistQueue = null
  _providerPostLoadCancellationAlertsQueue = null
  _cfdiImportDispatchQueue = null
  _cfdiImportItemQueue = null
}

export const MASS_DOWNLOAD_QUEUE_NAME = 'mass-download-queue'
export const MASS_VERIFICATION_QUEUE_NAME = 'mass-verification-queue'
export const PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME = 'provider-payment-compliance-queue'
export const SAT_69B_BLACKLIST_QUEUE_NAME = 'sat-69b-blacklist-queue'
export const PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME = 'provider-post-load-cancellation-alerts-queue'
export const CFDI_IMPORT_DISPATCH_QUEUE_NAME = 'cfdi-import-dispatch-queue'
export const CFDI_IMPORT_ITEM_QUEUE_NAME = 'cfdi-import-item-queue'

let _massDownloadQueue: Queue | null = null
let _massVerificationQueue: Queue | null = null
let _providerPaymentComplianceQueue: Queue | null = null
let _sat69BBlacklistQueue: Queue | null = null
let _providerPostLoadCancellationAlertsQueue: Queue | null = null
let _cfdiImportDispatchQueue: Queue | null = null
let _cfdiImportItemQueue: Queue | null = null

export function getMassDownloadQueue(): Queue {
  if (!_massDownloadQueue) {
    const connection = resolveRedisConnection()
    _massDownloadQueue = new Queue(MASS_DOWNLOAD_QUEUE_NAME, { connection })
  }
  return _massDownloadQueue
}

export function getMassVerificationQueue(): Queue {
  if (!_massVerificationQueue) {
    const connection = resolveRedisConnection()
    _massVerificationQueue = new Queue(MASS_VERIFICATION_QUEUE_NAME, { connection })
  }
  return _massVerificationQueue
}

export function getProviderPaymentComplianceQueue(): Queue {
  if (!_providerPaymentComplianceQueue) {
    const connection = resolveRedisConnection()
    _providerPaymentComplianceQueue = new Queue(PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME, { connection })
  }
  return _providerPaymentComplianceQueue
}

export function getSat69BBlacklistQueue(): Queue {
  if (!_sat69BBlacklistQueue) {
    const connection = resolveRedisConnection()
    _sat69BBlacklistQueue = new Queue(SAT_69B_BLACKLIST_QUEUE_NAME, { connection })
  }
  return _sat69BBlacklistQueue
}

export function getProviderPostLoadCancellationAlertsQueue(): Queue {
  if (!_providerPostLoadCancellationAlertsQueue) {
    const connection = resolveRedisConnection()
    _providerPostLoadCancellationAlertsQueue = new Queue(PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME, { connection })
  }
  return _providerPostLoadCancellationAlertsQueue
}

export function getCfdiImportDispatchQueue(): Queue {
  if (!_cfdiImportDispatchQueue) {
    const connection = resolveRedisConnection()
    _cfdiImportDispatchQueue = new Queue(CFDI_IMPORT_DISPATCH_QUEUE_NAME, { connection })
  }
  return _cfdiImportDispatchQueue
}

export function getCfdiImportItemQueue(): Queue {
  if (!_cfdiImportItemQueue) {
    const connection = resolveRedisConnection()
    _cfdiImportItemQueue = new Queue(CFDI_IMPORT_ITEM_QUEUE_NAME, { connection })
  }
  return _cfdiImportItemQueue
}

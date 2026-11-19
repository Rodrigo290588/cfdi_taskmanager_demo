import { Queue } from 'bullmq'

function validateRedisPort(raw: unknown, context: string): number {
  if (raw === undefined || raw === null || raw === '') {
    const msg = `[Queue ${context}] REDIS_PORT is required (1-65535). Fail-closed for security: no default localhost.`
    console.error(msg)
    throw new Error(msg)
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
    const msg = `[Queue ${context}] REDIS_PORT invalid (${formatPortValue(raw)}). Must be integer 1-65535.`
    console.error(msg)
    throw new Error(msg)
  }
  return n
}

function formatPortValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString()
  }
  return '[non-primitive value]'
}

export type RedisConnectionConfig = {
  host: string
  port: number
  password?: string
  username?: string
}

let _cachedRedisConnection: RedisConnectionConfig | null = null

export function resolveRedisConnection(): RedisConnectionConfig {
  if (_cachedRedisConnection) return _cachedRedisConnection

  const requireAuth = isRedisAuthenticationRequired()
  const rawUrl = process.env.REDIS_URL?.trim()
  const connection = rawUrl
    ? resolveRedisUrlConnection(rawUrl, requireAuth)
    : resolveRedisHostConnection(requireAuth)

  _cachedRedisConnection = connection
  return connection
}

function isRedisAuthenticationRequired(): boolean {
  return process.env.MASS_DOWNLOADS_REDIS_REQUIRE_AUTH === 'true'
    || process.env.NODE_ENV === 'production'
}

function resolveRedisUrlConnection(rawUrl: string, requireAuth: boolean): RedisConnectionConfig {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      throw new Error(`Invalid REDIS_URL protocol: ${url.protocol}`)
    }
    if (!url.hostname) throw new Error('REDIS_URL missing hostname')
    if (requireAuth && !(url.password || url.username)) {
      throw new Error('MASS_DOWNLOADS_REDIS_REQUIRE_AUTH=true requires REDIS_URL username:password credentials (or REDIS_URL with auth)')
    }
    return {
      host: url.hostname,
      port: validateRedisPort(url.port || (url.protocol === 'rediss:' ? '6380' : '6379'), 'REDIS_URL'),
      password: url.password || undefined,
      username: url.username || undefined,
    }
  } catch (error) {
    const msg = `[Queue] Invalid REDIS_URL: ${error instanceof Error ? error.message : String(error)}. Fail-closed: no default fallback connection.`
    console.error(msg)
    throw new Error(msg)
  }
}

function resolveRedisHostConnection(requireAuth: boolean): RedisConnectionConfig {
  const host = process.env.REDIS_HOST?.trim()
  if (!host) {
    const msg = '[Queue] Neither REDIS_URL nor REDIS_HOST+REDIS_PORT provided. Fail-closed: no default localhost fallback.'
    console.error(msg)
    throw new Error(msg)
  }
  const password = process.env.REDIS_PASSWORD?.trim()
  if (requireAuth && !password) {
    throw new Error('MASS_DOWNLOADS_REDIS_REQUIRE_AUTH=true requires REDIS_PASSWORD or REDIS_URL with credentials. Fail-closed.')
  }
  return {
    host,
    port: validateRedisPort(process.env.REDIS_PORT, 'REDIS_PORT'),
    password: password || undefined,
    username: process.env.REDIS_USERNAME?.trim() || undefined,
  }
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
  _massDownloadRoutineQueue = null
  _fiscalControlExportQueue = null
}

export const MASS_DOWNLOAD_QUEUE_NAME = 'mass-download-queue'
export const MASS_VERIFICATION_QUEUE_NAME = 'mass-verification-queue'
export const MASS_PACKAGE_DOWNLOAD_QUEUE_NAME = 'mass-package-download-queue'
export const PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME = 'provider-payment-compliance-queue'
export const SAT_69B_BLACKLIST_QUEUE_NAME = 'sat-69b-blacklist-queue'
export const PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME = 'provider-post-load-cancellation-alerts-queue'
export const CFDI_IMPORT_DISPATCH_QUEUE_NAME = 'cfdi-import-dispatch-queue'
export const CFDI_IMPORT_ITEM_QUEUE_NAME = 'cfdi-import-item-queue'
export const CFDI_IMPORT_QUEUE_NAME = 'cfdi-import-queue'
export const MASS_DOWNLOAD_ROUTINE_QUEUE_NAME = 'mass-download-routine-queue'
export const FISCAL_CONTROL_EXPORT_QUEUE_NAME = 'fiscal-control-export-queue'

let _massDownloadQueue: Queue | null = null
let _massVerificationQueue: Queue | null = null
let _massPackageDownloadQueue: Queue | null = null
let _providerPaymentComplianceQueue: Queue | null = null
let _sat69BBlacklistQueue: Queue | null = null
let _providerPostLoadCancellationAlertsQueue: Queue | null = null
let _cfdiImportDispatchQueue: Queue | null = null
let _cfdiImportItemQueue: Queue | null = null
let _cfdiImportQueue: Queue | null = null
let _massDownloadRoutineQueue: Queue | null = null
let _fiscalControlExportQueue: Queue | null = null

export function getMassDownloadQueue(): Queue {
  if (!_massDownloadQueue) {
    const connection = resolveRedisConnection()
    _massDownloadQueue = new Queue(MASS_DOWNLOAD_QUEUE_NAME, { connection })
  }
  return _massDownloadQueue
}

export function getMassPackageDownloadQueue(): Queue {
  if (!_massPackageDownloadQueue) {
    const connection = resolveRedisConnection()
    _massPackageDownloadQueue = new Queue(MASS_PACKAGE_DOWNLOAD_QUEUE_NAME, { connection })
  }
  return _massPackageDownloadQueue
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

export function getCfdiImportQueue(): Queue {
  if (!_cfdiImportQueue) {
    const connection = resolveRedisConnection()
    _cfdiImportQueue = new Queue(CFDI_IMPORT_QUEUE_NAME, { connection })
  }
  return _cfdiImportQueue
}

export function getMassDownloadRoutineQueue(): Queue {
  if (!_massDownloadRoutineQueue) {
    const connection = resolveRedisConnection()
    _massDownloadRoutineQueue = new Queue(MASS_DOWNLOAD_ROUTINE_QUEUE_NAME, { connection })
  }
  return _massDownloadRoutineQueue
}

export function getFiscalControlExportQueue(): Queue {
  _fiscalControlExportQueue ??= new Queue(FISCAL_CONTROL_EXPORT_QUEUE_NAME, {
    connection: resolveRedisConnection(),
  })
  return _fiscalControlExportQueue
}

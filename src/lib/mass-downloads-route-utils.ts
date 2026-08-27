import crypto from 'node:crypto'
import { z } from 'zod'
import { NextResponse } from 'next/server'
import {
  fingerprint as fp32,
  safeErrSummary,
  getRealClientIp as getRealClientIpBase,
} from '@/lib/security'
import { SECURITY_HEADERS as BASE_SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export { fp32, safeErrSummary }

export const MAX_DYNAMIC_FILTERS = 3

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  ...BASE_SECURITY_HEADERS,
  'X-Frame-Options': 'DENY',
}

export const REDACT_HEADER_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'set-cookie',
  'x-request-id',
  'cf-ray',
  'x-cache',
  'x-amz-request-id',
  'x-ms-request-id',
])

const SAT_RESPONSE_PREVIEW_MAX = 200
export function truncateSatPreview(text: string | null | undefined, max = SAT_RESPONSE_PREVIEW_MAX): string {
  if (!text) return ''
  const clean = text.replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  return clean.slice(0, max) + `...[truncated ${clean.length - max} chars]`
}

export const REDACT_KEYS_IN_SAT_ERROR: ReadonlySet<string> = new Set([
  'rawResponse',
  'soapRequest',
  'token',
  'authorization',
  'privateKey',
  'password',
])
export function redactSatErrorLog(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!data) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (REDACT_KEYS_IN_SAT_ERROR.has(k.toLowerCase())) {
      const str = typeof v === 'string' ? v : JSON.stringify(v ?? '')
      out[k] = `[REDACTED length=${str.length} sha256=${crypto.createHash('sha256').update(str).digest('hex').slice(0, 12)}]`
    } else if (k === 'message' && typeof v === 'string') {
      out[k] = v.length > 512 ? v.slice(0, 512) + `...[truncated]` : v
    } else {
      out[k] = v
    }
  }
  return out
}

export function massDownloadJsonResponse<T>(
  body: T,
  init: { status?: number; headers?: Record<string, string>; retryAfter?: number } = {}
): NextResponse<T> {
  const { status = 200, headers = {}, retryAfter } = init
  const mergedHeaders: Record<string, string> = {
    ...SECURITY_HEADERS,
    ...headers,
  }
  if (retryAfter !== undefined) {
    mergedHeaders['Retry-After'] = String(retryAfter)
  }
  return NextResponse.json(body, { status, headers: mergedHeaders })
}

export const MASS_DOWNLOADS_MAX_ZIP_BYTES = 150 * 1024 * 1024
export const MASS_DOWNLOADS_ZIP_BASE64_MAX_CHARS = Math.ceil(MASS_DOWNLOADS_MAX_ZIP_BYTES * 1.37) + 1024

export const RFC_SEMAPHORE_TTL_SECONDS = 10 * 60
export const RFC_CONCURRENCY_LIMIT = 2
export const RFC_SEMAPHORE_LUA_SCRIPT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local newval = redis.call('INCR', key)
if newval == 1 then
  redis.call('EXPIRE', key, ttl)
end
if newval > limit then
  redis.call('DECR', key)
  return {err = 'RFC_CONCURRENCY_LIMIT'}
end
return newval
`

export function getRealClientIp(headers: Headers): string {
  const ip = getRealClientIpBase(headers)
  if (ip.length > 45) return ip.slice(0, 45)
  return ip
}

export const ALLOWED_FC_FILTER_COLUMNS: ReadonlySet<string> = new Set([
  'uuid',
  'issuerRfc',
  'receiverRfc',
  'receiverName',
  'issuerName',
  'certificationPac',
  'cfdiType',
  'total',
  'issuanceDate',
  'certificationDate',
  'cancelationDate',
  'folio',
])

export const ALLOWED_FC_DB_FIELDS: Readonly<Record<string, string>> = {
  uuid: 'uuid',
  issuerRfc: 'rfcEmisor',
  receiverRfc: 'rfcReceptor',
  receiverName: 'nombreReceptor',
  issuerName: 'nombreEmisor',
  certificationPac: 'rfcPac',
  cfdiType: 'efectoComprobante',
  total: 'monto',
  issuanceDate: 'fechaEmision',
  certificationDate: 'fechaCertificacionSat',
  cancelationDate: 'fechaCancelacion',
} as const

const DDE_PREFIX_REGEX = /^[=+@\t\r-]/

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = String(value)
  let safe = raw
  if (DDE_PREFIX_REGEX.test(safe)) {
    safe = "'" + safe
  }
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    safe = `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

export function buildCsvRow(cells: Array<unknown>): string {
  return cells.map(escapeCsvValue).join(',') + '\r\n'
}

export const CSV_BOM = '\uFEFF'

export function buildCsvWithBom(rows: Array<Array<unknown>>, headers?: Array<string>): string {
  const lines: string[] = []
  if (headers && headers.length > 0) {
    lines.push(buildCsvRow(headers))
  }
  for (const row of rows) {
    lines.push(buildCsvRow(row))
  }
  return CSV_BOM + lines.join('')
}

const HEADER_INJECT_BLACKLIST = new Set([
  'set-cookie',
  'content-type',
  'content-disposition',
  'mime-version',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-requested-with',
  'x-amz',
  'x-ms-',
  'x-inject',
  'x-custom',
])

const URL_DECODE_STEP_REGEX = /%([0-9A-Fa-f]{2})/g

function stripPercentEncodedOnce(raw: string): string {
  return raw.replace(URL_DECODE_STEP_REGEX, (_, hex) => {
    const code = parseInt(hex, 16)
    if (code <= 0x1f || code === 0x7f) return '_'
    if (code === 0x0d || code === 0x0a) return '_'
    return String.fromCharCode(code)
  })
}

export function sanitizeFilename(raw: string, fallback = 'download'): string {
  if (!raw || typeof raw !== 'string') return fallback
  let s = stripPercentEncodedOnce(raw)
  s = s.replace(/[\x00-\x1f\x7f\r\n]/g, '_')
  for (const keyword of HEADER_INJECT_BLACKLIST) {
    s = s.replace(new RegExp(keyword, 'gi'), '_REDACT_')
  }
  s = s.replace(/x-[a-z0-9_-]+/gi, '_REDACT_XHDR_')
  s = s.replace(/\.\.\//g, '_').replace(/\.\./g, '_').replace(/\/+/g, '_').replace(/\\+/g, '_')
  s = s.replace(/[<>:"|?*;=&^%#@!`~[\]{}()+,]/g, '_')
  s = s.trim().replace(/\s+/g, '_').replace(/^[._]+|[._]+$/g, '')
  if (s.length > 64) s = s.slice(0, 64)
  return s || fallback
}

export function buildRfc6266ContentDisposition(filename: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const safe = sanitizeFilename(filename, 'download')
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_')
  const encoded = encodeURIComponent(safe).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`)
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export const INVOICE_CIPHER_WHITELIST: ReadonlySet<string> = new Set([
  'aes-256-gcm',
  'aes-128-gcm',
])

export function assertValidAesGcmAlgorithm(algorithm: string): void {
  const normalized = (algorithm || '').toString().trim().toLowerCase()
  if (!INVOICE_CIPHER_WHITELIST.has(normalized)) {
    throw new Error(`Crypto algorithm not allowed: ${algorithm}`)
  }
}

export function assertValidIvHex(ivHex: string): void {
  if (!ivHex || typeof ivHex !== 'string') {
    throw new Error('Crypto IV is required')
  }
  const trimmed = ivHex.trim()
  if (!/^[0-9A-Fa-f]+$/.test(trimmed)) {
    throw new Error('Crypto IV must be hex')
  }
  const bytes = trimmed.length / 2
  if (bytes !== 12 && bytes !== 16) {
    throw new Error(`Crypto IV invalid length: ${bytes} bytes`)
  }
}

export function assertValidAuthTagHex(authTagHex: string): void {
  if (!authTagHex || typeof authTagHex !== 'string') {
    throw new Error('Crypto authTag is required')
  }
  const trimmed = authTagHex.trim()
  if (!/^[0-9A-Fa-f]+$/.test(trimmed)) {
    throw new Error('Crypto authTag must be hex')
  }
  const bytes = trimmed.length / 2
  if (bytes < 12 || bytes > 16) {
    throw new Error(`Crypto authTag invalid length: ${bytes} bytes`)
  }
}

export function assertValidEncryptionKeyLength(keyBuffer: { length: number }): void {
  if (!keyBuffer || typeof keyBuffer.length !== 'number') {
    throw new Error('Crypto key is required')
  }
  if (keyBuffer.length !== 16 && keyBuffer.length !== 32) {
    throw new Error(`Crypto key invalid length: ${keyBuffer.length} bytes`)
  }
  if (process.env.DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES === 'true' && keyBuffer.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES requires 32 byte key')
  }
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

const RFC_REGEX = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/i
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

export const RfcStringSchema = z
  .string()
  .trim()
  .min(12)
  .max(13)
  .regex(RFC_REGEX, 'RFC inválido')

export const UuidStringSchema = z.string().trim().regex(UUID_REGEX, 'UUID inválido')

export const DateStringSchema = z
  .string()
  .trim()
  .regex(DATE_REGEX, 'Fecha inválida (YYYY-MM-DD)')

export const NonEmptyStringSchema = z.string().trim().min(1).max(1024)

export const PostCreateMassRequestSchema = z.strictObject({
  companyId: UuidStringSchema,
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  receiverRfc: RfcStringSchema.optional(),
  issuerRfc: RfcStringSchema.optional(),
  requestingRfc: RfcStringSchema,
  retrievalType: z.enum(['emitidos', 'recibidos', 'folio']).default('emitidos'),
  requestType: z.enum(['metadata', 'cfdi']),
  voucherType: z.enum(['I', 'E', 'P', 'T', 'N']).optional(),
  status: z.enum(['Todos', 'Cancelado', 'Vigente']).default('Todos'),
  thirdPartyRfc: RfcStringSchema.optional().or(z.literal('')),
  complement: z.string().trim().max(64).optional().or(z.literal('')),
  folio: z.string().trim().max(64).optional().or(z.literal('')),
})

export const FiscalControlQuerySchema = z.strictObject({
  companyId: UuidStringSchema,
  rfc: RfcStringSchema.optional(),
  cfdiType: z.enum(['ALL', 'INGRESO', 'EGRESO', 'TRASLADO', 'NOMINA', 'PAGO']).optional(),
  satStatus: z.enum(['ALL', 'VIGENTE', 'CANCELADO']).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
})

export const PackageDownloadsQuerySchema = z.strictObject({
  rfc: RfcStringSchema,
  companyId: UuidStringSchema.optional(),
})

export const RequestsListQuerySchema = z.strictObject({
  companyId: UuidStringSchema.optional(),
  rfc: RfcStringSchema.optional(),
  status: z.enum(['Todos', 'Cancelado', 'Vigente', 'SOLICITADO', 'EN_PROCESO', 'TERMINADO', 'RECHAZADO', 'VENCIDO']).optional(),
  requestType: z.enum(['metadata', 'cfdi']).optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  folio: z.string().trim().max(64).optional(),
})

export const CredentialsUploadFormSchema = z.strictObject({
  organizationId: UuidStringSchema,
  rfc: RfcStringSchema,
  password: NonEmptyStringSchema.max(256),
})

export const FcDynamicColumnFilterValueSchema = z.string().trim().min(1).max(256)

export type FcDynamicFilters = Record<string, string>

export function validateFcDynamicFilters(raw: Record<string, string>): FcDynamicFilters {
  const safe: FcDynamicFilters = {}
  let applied = 0
  for (const [key, value] of Object.entries(raw || {})) {
    if (applied >= MAX_DYNAMIC_FILTERS) break
    if (!ALLOWED_FC_FILTER_COLUMNS.has(key)) continue
    const parsed = FcDynamicColumnFilterValueSchema.safeParse(value)
    if (!parsed.success) continue
    safe[key] = parsed.data
    applied++
  }
  return safe
}

export function parsePositiveInt(raw: string | null | undefined, fallback: number, max?: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback
  const withCap = typeof max === 'number' ? Math.min(n, max) : n
  return withCap
}

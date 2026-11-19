import { safeErrSummary } from '@/lib/security'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogContext {
  readonly service: string
  readonly correlationId?: string
  readonly routineId?: string
  readonly runId?: string
  readonly massDownloadRequestId?: string
  readonly satRequestId?: string
  readonly jobId?: string
}

const SENSITIVE_KEY_REGEX = /password|private|certificate|token|authorization|signature|soap|xml|body|path|file/i
const RFC_REGEX = /\b[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}\b/gi
const MAX_STRING_LENGTH = 512
const MAX_OBJECT_KEYS = 25

export function createLogger(context: LogContext) {
  return {
    info: (event: string, details?: Record<string, unknown>) => writeLog('info', event, context, details),
    warn: (event: string, details?: Record<string, unknown>) => writeLog('warn', event, context, details),
    error: (event: string, error?: unknown, details?: Record<string, unknown>) => {
      const safeError = safeErrSummary(error)
      writeLog('error', event, context, { ...details, error: safeError })
    },
  } as const
}

function writeLog(
  level: LogLevel,
  event: string,
  context: LogContext,
  details: Record<string, unknown> | undefined,
): void {
  try {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      event: sanitizeText(event, 120),
      service: sanitizeText(context.service, 80),
      correlationId: context.correlationId ? sanitizeIdentifier(context.correlationId) : undefined,
      routineId: context.routineId ? sanitizeIdentifier(context.routineId) : undefined,
      runId: context.runId ? sanitizeIdentifier(context.runId) : undefined,
      massDownloadRequestId: context.massDownloadRequestId ? sanitizeIdentifier(context.massDownloadRequestId) : undefined,
      satRequestId: context.satRequestId ? sanitizeIdentifier(context.satRequestId) : undefined,
      jobId: context.jobId ? sanitizeIdentifier(context.jobId) : undefined,
      details: details ? sanitizeDetails(details) : undefined,
    }
    const serialized = JSON.stringify(payload)
    if (level === 'error') {
      console.error(serialized)
    } else if (level === 'warn') {
      console.warn(serialized)
    } else {
      console.info(serialized)
    }
  } catch {
    // La telemetría nunca debe modificar el resultado del flujo SAT.
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [index, [key, value]] of Object.entries(input).entries()) {
    if (index >= MAX_OBJECT_KEYS) break
    if (SENSITIVE_KEY_REGEX.test(key)) {
      output[key] = '[REDACTED]'
      continue
    }
    output[key] = sanitizeValue(value)
  }
  return output
}

function sanitizeValue(value: unknown): boolean | number | string | null | Record<string, unknown> | Array<unknown> {
  if (value === null) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sanitizeText(value, MAX_STRING_LENGTH)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.slice(0, 10).map(sanitizeValue)
  if (typeof value === 'object') {
    return sanitizeDetails(value as Record<string, unknown>)
  }
  return '[UNSUPPORTED]'
}

function sanitizeIdentifier(value: string): string {
  return sanitizeText(value, 128)
}

function sanitizeText(value: string, maximumLength: number): string {
  const trimmed = value.slice(0, maximumLength)
  return trimmed.replace(RFC_REGEX, (rfc) => `${rfc.slice(0, 3)}***${rfc.slice(-3)}`)
}

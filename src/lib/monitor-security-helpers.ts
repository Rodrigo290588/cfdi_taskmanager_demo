import crypto from 'node:crypto'
import type { z } from 'zod'

export interface SafeLikePatternResult {
  pattern: string
  escapeChar: string
}

// MON-003 · A03:2021 Injection · Wildcard characters escape PostgreSQL
// Escapa \ primero, luego %, luego _. Garantiza que ILIKE trate wildcards como literal chars
// y usa ESCAPE clause en SQL para evitar Sequential Scan abusivo (DoS).
export function buildSafeLikePattern(input: string): SafeLikePatternResult {
  const ESCAPE_CHAR = '\\'
  const trimmed = (input || '').trim()
  const escaped = trimmed
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
  return {
    pattern: `%${escaped}%`,
    escapeChar: ESCAPE_CHAR,
  }
}

// MON-004 · Fingerprint 32-bit (fp32) hex de 8 chars: suficiente para correlación
// de errores en soporte sin revelar datos sensibles en logs / JSON responses.
// Basado en SHA-256 truncado a 4 bytes (8 hex chars) = 2^32 espacio (colisiones aceptables
// para fines de troubleshooting).
export function fp32(hex: string): string {
  if (!hex || typeof hex !== 'string') return '00000000'
  const clean = hex.trim()
  if (/^[0-9a-f]{8,}$/i.test(clean)) {
    return clean.slice(0, 8).toLowerCase()
  }
  return crypto.createHash('sha256').update(clean).digest('hex').slice(0, 8)
}

// MON-008 · Helpers para evitar Object.fromEntries() override silencioso con params duplicados
// en query strings. Garantiza que search params no se repitan (Regla 19.2.3 strict Zod).
export function parseUniqueSearchParams<T extends Record<string, string> = Record<string, string>>(
  sp: URLSearchParams,
): T {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  for (const key of sp.keys()) {
    if (seen.has(key)) {
      const error = new Error(`SEARCH_PARAMS_DUPLICATE_KEY:${key}`)
      error.name = 'ZodCustomValidationError'
      throw error
    }
    seen.add(key)
    const values = sp.getAll(key)
    if (values.length > 1) {
      const error = new Error(`SEARCH_PARAMS_DUPLICATE_VALUE:${key}`)
      error.name = 'ZodCustomValidationError'
      throw error
    }
    out[key] = values[0]
  }
  return out as T
}

// MON-006 · A03:2021 Injection + Enumeration · Zod flatten sanitizer.
// (a) No refleja el valor user-written completo (trunca a 120 chars).
// (b) Quita strings "received 'XYZ'" para no enumerar qué inputs mandó el atacante.
// (c) Quita regex literales y reglas de enum para no leakear la regla de validación.
export function sanitizeZodFlatten(
  flatten: ReturnType<typeof z.ZodError.prototype.flatten>,
) {
  const safeFields: Record<string, string[]> = {}
  const cleanOne = (msg: unknown): string => {
    if (typeof msg !== 'string') return ''
    let s = msg.slice(0, 120)
    s = s.replace(/received\s+'[^']*'/gi, "received '[REDACTED]'")
    s = s.replace(/Expected\s+('[^']+'\|?)+/g, "Expected [VALORES_PERMITIDOS]")
    s = s.replace(/\\[dDwWsS]\{[^}]*\}|\\[dDwWsS]/g, '[PATTERN]')
    s = s.replace(/\^[^\s$]{6,}\$/g, '[FORMATO_ESPERADO]')
    return s
  }
  for (const [field, errs] of Object.entries(flatten.fieldErrors ?? {})) {
    const k = String(field).slice(0, 32)
    safeFields[k] = Array.isArray(errs) ? errs.map(cleanOne).filter(Boolean) : []
  }
  return {
    formErrors: Array.isArray(flatten.formErrors)
      ? flatten.formErrors.map(cleanOne).filter(Boolean).slice(0, 5)
      : [],
    fieldErrors: safeFields,
  }
}

import { z } from 'zod'

declare global {
  var __RFC_TEXT_ENCODER_INSTANCE__: TextEncoder | undefined
  var __RFC_FORBIDDEN_SET__: ReadonlySet<string> | undefined
  var __RFC_CHAR_TO_VALUE_MAP__: ReadonlyMap<string, number> | undefined
}

export const RFC_MAX_LENGTH = 13
export const RFC_MIN_LENGTH_MORAL = 12
export const RFC_POST_BODY_HARD_CAP_BYTES = 64 * 1024
export const RFC_GET_ALLOWED_ORIGINS_DEVELOPMENT = 'http://localhost:3000'
export const RFC_DEPLOY_YEAR_HINT_CUTOFF = 30

const RFC_STRICT_PATTERN_SOURCE = '^[A-Z\\u00d1&]{3,4}\\d{6}[A-Z0-9]{3}$'
export const RFC_STRICT_REGEX_UNICODE = new RegExp(RFC_STRICT_PATTERN_SOURCE, 'u')

export const rfcValidationSchema = z.object({
  rfc: z
    .string({
      message: 'RFC debe ser una cadena de texto',
    })
    .trim()
    .min(1, { message: 'RFC es requerido' })
    .min(RFC_MIN_LENGTH_MORAL, { message: `RFC debe tener al menos ${RFC_MIN_LENGTH_MORAL} caracteres` })
    .max(RFC_MAX_LENGTH, { message: `RFC no puede exceder ${RFC_MAX_LENGTH} caracteres` })
    .regex(RFC_STRICT_REGEX_UNICODE, { message: 'RFC con formato inválido. Patrón aceptado: XXXX000000XXX' }),
})

export type RfcType = 'person' | 'company'
export type RfcDateValidation =
  | { ok: true; year4: number; month: number; day: number }
  | { ok: false; error: string }

export interface ValidateRfcResult {
  isValid: boolean
  type: RfcType
  errors: string[]
  dateValidation: RfcDateValidation | null
  homoclave: string | null
}

export interface SafeValidateInputOk {
  ok: true
  rfc: string
}
export interface SafeValidateInputFail {
  ok: false
  httpStatus: 400 | 413 | 422
  error: string
  details?: Array<{ field: string; message: string }>
}
export type SafeValidateInputResult = SafeValidateInputOk | SafeValidateInputFail

const _FORBIDDEN_ENTRIES_UNIQUE = Object.freeze([
  'BUEI','BUEY','CACA','CACO','CAGA','CAGO','CAKA','CAKO','COGE','COJA','COJE','COJI','COJO',
  'CULO','FETO','GUEY','JOTO','KACA','KACO','KAGA','KAGO','KOGE','KOJO','KULO','MAME','MAMO',
  'MEAR','MEAS','MEON','MION','MOCO','MULA','PEDA','PEDO','PENE','PUTA','PUTO','QULO','RATA','RUIN',
])

export function getRfcForbiddenWordsSet(): ReadonlySet<string> {
  if (globalThis.__RFC_FORBIDDEN_SET__) return globalThis.__RFC_FORBIDDEN_SET__
  const s = new Set<string>(_FORBIDDEN_ENTRIES_UNIQUE as readonly string[])
  globalThis.__RFC_FORBIDDEN_SET__ = s
  return s
}

const _SAT_CHAR_VALUE_ENTRIES: ReadonlyArray<readonly [string, number]> = Object.freeze([
  ['0',0],['1',1],['2',2],['3',3],['4',4],['5',5],['6',6],['7',7],['8',8],['9',9],
  ['A',10],['B',11],['C',12],['D',13],['E',14],['F',15],['G',16],['H',17],['I',18],['J',19],
  ['K',20],['L',21],['M',22],['N',23],['&',24],['O',25],['P',26],['Q',27],['R',28],['S',29],
  ['T',30],['U',31],['V',32],['W',33],['X',34],['Y',35],['Z',36],['Ñ',37],
])

export function getSatCharValueMap(): ReadonlyMap<string, number> {
  if (globalThis.__RFC_CHAR_TO_VALUE_MAP__) return globalThis.__RFC_CHAR_TO_VALUE_MAP__
  const m = new Map<string, number>(_SAT_CHAR_VALUE_ENTRIES as Array<[string, number]>)
  globalThis.__RFC_CHAR_TO_VALUE_MAP__ = m
  return m
}

function _getTextEncoderSingleton(): TextEncoder {
  if (globalThis.__RFC_TEXT_ENCODER_INSTANCE__) return globalThis.__RFC_TEXT_ENCODER_INSTANCE__
  const enc = new TextEncoder()
  globalThis.__RFC_TEXT_ENCODER_INSTANCE__ = enc
  return enc
}

export function rfcByteSizeUtf8(s: string): number {
  return _getTextEncoderSingleton().encode(s).byteLength
}

export function escapeHtml(unsafe: unknown): string {
  const s = String(unsafe ?? '')
  if (!s) return ''
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    switch (c) {
      case 34: out += '&quot;'; break
      case 38: out += '&amp;'; break
      case 39: out += '&#39;'; break
      case 60: out += '&lt;'; break
      case 62: out += '&gt;'; break
      case 96: out += '&#96;'; break
      default:
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
          out += '\ufffd'
        } else {
          out += s[i]
        }
    }
  }
  return out
}

export function _isLeapYear(y: number): boolean {
  if (!Number.isFinite(y)) return false
  if (y < 1900) return false
  if (y % 4 !== 0) return false
  if (y % 100 !== 0) return true
  return y % 400 === 0
}

export function _daysInMonth(m: number, y: number): number {
  const table = [31,28,31,30,31,30,31,31,30,31,30,31]
  if (m < 1 || m > 12 || !Number.isInteger(m)) return 0
  const base = table[m - 1]
  if (m === 2 && _isLeapYear(y)) return 29
  return base
}

export function validateRfcDatePart(datePart: string): RfcDateValidation {
  if (!datePart || typeof datePart !== 'string' || datePart.length !== 6) {
    return { ok: false, error: 'Fecha YYMMDD debe ser de 6 dígitos' }
  }
  if (!/^\d{6}$/.test(datePart)) {
    return { ok: false, error: 'Fecha YYMMDD contiene caracteres no numéricos' }
  }
  const yy = Number(datePart.substring(0, 2))
  const mm = Number(datePart.substring(2, 4))
  const dd = Number(datePart.substring(4, 6))
  if (!Number.isInteger(yy) || !Number.isInteger(mm) || !Number.isInteger(dd)) {
    return { ok: false, error: 'Componentes de fecha inválidos' }
  }
  const now = new Date()
  const currentY = now.getUTCFullYear()
  const century = Math.floor(currentY / 100)
  const y4 = yy < RFC_DEPLOY_YEAR_HINT_CUTOFF
    ? century * 100 + yy
    : (century - 1) * 100 + yy
  if (y4 < 1900 || y4 > currentY) {
    return { ok: false, error: 'Año RFC fuera de rango permitido (1900-año actual)' }
  }
  if (mm < 1 || mm > 12) return { ok: false, error: 'Mes RFC fuera de rango (01-12)' }
  const daysAllowed = _daysInMonth(mm, y4)
  if (dd < 1 || dd > daysAllowed) {
    if (mm === 2 && dd === 29) return { ok: false, error: 'Febrero no tiene 29 días en este año (no es año bisiesto)' }
    return { ok: false, error: `Día RFC ${dd} fuera de rango para mes ${mm}` }
  }
  return { ok: true, year4: y4, month: mm, day: dd }
}

export function validateRfc(rawRfc: string): ValidateRfcResult {
  const errors: string[] = []
  if (typeof rawRfc !== 'string') {
    return { isValid: false, type: 'person', errors: ['RFC debe ser un string'], dateValidation: null, homoclave: null }
  }
  // FAIL FAST antes regex para evitar ReDoS: longitud estricta 12/13
  if (!rawRfc || rawRfc.length < RFC_MIN_LENGTH_MORAL || rawRfc.length > RFC_MAX_LENGTH) {
    errors.push(`RFC debe tener entre ${RFC_MIN_LENGTH_MORAL} y ${RFC_MAX_LENGTH} caracteres`)
    return { isValid: false, type: 'person', errors, dateValidation: null, homoclave: null }
  }
  const upper = rawRfc.toUpperCase()
  if (!RFC_STRICT_REGEX_UNICODE.test(upper)) {
    errors.push('Formato de RFC inválido. Ejemplos: ODE8604257UA (física) / ABC9202018X1 (moral)')
    return { isValid: false, type: 'person', errors, dateValidation: null, homoclave: null }
  }
  const type: RfcType = upper.length === 12 ? 'company' : 'person'
  const nameLetters = upper.substring(0, type === 'person' ? 4 : 3)
  const datePart = upper.substring(type === 'person' ? 4 : 3, type === 'person' ? 10 : 9)
  const homoclave = upper.substring(type === 'person' ? 10 : 9)
  const setForbid = getRfcForbiddenWordsSet()
  if (setForbid.has(nameLetters)) {
    errors.push('RFC contiene palabra prohibida en letras iniciales (Artículo 15 CFF)')
  }
  const dv = validateRfcDatePart(datePart)
  if (!dv.ok) errors.push(dv.error)
  if (!/^[A-Z0-9]{3}$/.test(homoclave)) {
    errors.push('Homoclave RFC inválida (3 caracteres alfanuméricos finales)')
  }
  return {
    isValid: errors.length === 0,
    type,
    errors,
    dateValidation: dv,
    homoclave,
  }
}

/**
 * Implementación OFICIAL SAT DOF Cálculo dígito verificador (Código de Verificación CV).
 * Pesos descendientes 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 para los 12 primeros chars.
 * Mod 11 → 0="0", 1="A", resto 11 - res.
 * @param rfcNormalized RFC 12 o 13 caracteres. Si 13, se usa substring(0,12) automáticamente.
 */
export function calculateOfficialSatVerificationDigit(rfcNormalized: string): string {
  if (typeof rfcNormalized !== 'string') return '0'
  const trimmed = rfcNormalized.trim().toUpperCase()
  if (trimmed.length < 12 || trimmed.length > 13) return '0'
  const chars12 = trimmed.length === 13 ? trimmed.substring(0, 12) : trimmed
  // FAIL FAST anti ReDoS: verifica que chars12 cumpla pattern
  if (!/^[A-Z\u00d1&\d]{12}$/u.test(chars12)) return '0'
  const valueMap = getSatCharValueMap()
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const ch = chars12[i]
    const v = valueMap.get(ch)
    if (v === undefined) {
      sum += 0
    } else {
      sum += v * (13 - i)
    }
  }
  const mod = sum % 11
  if (mod === 0) return '0'
  if (mod === 1) return 'A'
  return String(11 - mod)
}

export const RFC_VALIDATION_SUGGESTIONS: readonly string[] = Object.freeze([
  'Verifique que el RFC tenga el formato correcto (3 letras morales / 4 físicas + 6 dígitos fecha + 3 homoclave).',
  'Asegúrese de que la fecha YYMMDD sea válida y no futura.',
  'Revise que no contenga caracteres especiales no permitidos (solo letras mayúsculas A-Z, Ñ, & y dígitos).',
  'Para personas físicas: 4 letras nombre/apellidos + 6 dígitos fecha nacimiento YYMMDD + 3 homoclave.',
  'Para personas morales: 3 letras razón social + 6 dígitos fecha constitución YYMMDD + 3 homoclave.',
])

export function safeValidateRfcInput(input: unknown): SafeValidateInputResult {
  if (input === null || input === undefined) {
    return { ok: false, httpStatus: 400, error: 'Cuerpo de solicitud vacío. Proporcione campo JSON "rfc".' }
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.rfc === 'string' && rfcByteSizeUtf8(obj.rfc) > 1024) {
      return { ok: false, httpStatus: 413, error: 'Campo RFC excede tamaño máximo permitido (1024 bytes UTF-8).' }
    }
  } else if (typeof input === 'string') {
    if (rfcByteSizeUtf8(input) > 1024) return { ok: false, httpStatus: 413, error: 'RFC excede tamaño máximo.' }
  }
  const schema = rfcValidationSchema
  let normalizedInput: Record<string, unknown>
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>
    normalizedInput = { ...obj, rfc: typeof obj.rfc === 'string' ? obj.rfc.trim().toUpperCase() : obj.rfc }
  } else {
    normalizedInput = { rfc: typeof input === 'string' ? input.trim().toUpperCase() : '' }
  }
  const parse = schema.safeParse(normalizedInput)
  if (!parse.success) {
    const details = parse.error.issues.map(issue => ({
      field: issue.path.join('.') || 'rfc',
      message: issue.message,
    }))
    return {
      ok: false,
      httpStatus: 400,
      error: 'Datos de RFC inválidos',
      details,
    }
  }
  return { ok: true, rfc: parse.data.rfc.toUpperCase() }
}

export function redactZodIssuesEscaped(issues: SafeValidateInputFail['details']): SafeValidateInputFail['details'] {
  if (!issues) return undefined
  return issues.map(i => ({
    field: escapeHtml(i.field).slice(0, 120),
    message: escapeHtml(i.message).slice(0, 240),
  }))
}

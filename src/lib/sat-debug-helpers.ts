import path from 'node:path'
import fs from 'node:fs'
import { RFC_STRICT_REGEX_UNICODE } from '@/lib/rfc-validate'

declare global {
  var __SAT_DEBUG_ROOT_DIR_LOCKED__: string | undefined
  var __SAT_DEBUG_TEXT_ENCODER__: TextEncoder | undefined
}

export const SAT_DEBUG_DEFAULT_DIRNAME = '.sat-debug'
export const SAT_DEBUG_MAX_RFC_BYTES = 13
export const SAT_DEBUG_MAX_TIMESTAMP_CHARS = 32
export const SAT_DEBUG_SOAP_TIMEOUT_MS = 30_000
export const SAT_SOAP_USER_AGENT = 'Platfi-Intelligence-SAT-SOAP/1.0 (+https://platfi.mx/security.txt)'
export const SAT_DEBUG_WRAP_TOKEN_MAX_LEN = 64

export const SAT_DEBUG_SOAP_AUTH_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc'
export const SAT_DEBUG_SOAP_SOLICITA_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc'
export const SAT_DEBUG_SOAP_VERIFICA_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/VerificaSolicitudDescargaService.svc'
export const SAT_DEBUG_SOAP_DESCARGA_URL = 'https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc'

export const SAT_SOAP_OFFICIAL_ALLOWLIST = Object.freeze(new Set([
  'cfdidescargamasivasolicitud.clouda.sat.gob.mx',
  'cfdidescargamasiva.clouda.sat.gob.mx',
  'portalcfdi.facturaelectronica.sat.gob.mx',
  'www.sat.gob.mx',
  'sat.gob.mx',
]))

export type SatDebugFilenameKind = 'solicitud' | 'verificacion' | 'autenticacion' | 'descarga'

export const SAT_DEBUG_FILENAME_EXTENSIONS: Readonly<Record<SatDebugFilenameKind, string>> = {
  solicitud: 'xml',
  verificacion: 'xml',
  autenticacion: 'xml',
  descarga: 'zip',
}

export interface SafeSatDebugPathResult {
  allowed: boolean
  status: 403 | 400 | 500 | 200
  safePath?: string
  reasonCode:
  | 'SAT_DEBUG_FF_PROD_DISABLED'
  | 'SAT_DEBUG_RFC_INVALID'
  | 'SAT_DEBUG_RFC_TOO_BIG'
  | 'SAT_DEBUG_KIND_INVALID'
  | 'SAT_DEBUG_TIMESTAMP_INVALID'
  | 'SAT_DEBUG_ROOT_MKDIR_FAIL'
  | 'SAT_DEBUG_ESCAPE_ROOT_DETECTED'
  | 'SAT_DEBUG_OK'
  reasonHuman: string
  incidentFp?: string
}

function __satSafeTextEncoder(): TextEncoder {
  if (!globalThis.__SAT_DEBUG_TEXT_ENCODER__) {
    globalThis.__SAT_DEBUG_TEXT_ENCODER__ = new TextEncoder()
  }
  return globalThis.__SAT_DEBUG_TEXT_ENCODER__
}

function __satNormalizeBasenameRfc(rawRfc: string): string {
  const trimmed = String(rawRfc ?? '').trim()
  const upper = trimmed.length > 0 ? trimmed.toUpperCase() : ''
  const safe = upper.replace(/[^A-Z0-9Ñ&]/g, '')
  if (safe.length === 0) return ''
  const encoded = __satSafeTextEncoder().encode(safe)
  if (encoded.length > SAT_DEBUG_MAX_RFC_BYTES) return safe.slice(0, SAT_DEBUG_MAX_RFC_BYTES)
  return safe
}

function __satSanitizeTimestamp(rawTs: string | number | Date | null | undefined): string {
  if (rawTs == null) return String(Date.now())
  if (rawTs instanceof Date) return String(rawTs.getTime())
  const str = String(rawTs).replace(/[^0-9A-Za-z_\-]/g, '')
  if (str.length === 0) return String(Date.now())
  if (str.length > SAT_DEBUG_MAX_TIMESTAMP_CHARS) return str.slice(0, SAT_DEBUG_MAX_TIMESTAMP_CHARS)
  return str
}

function __satIncidentFp16(prefix: string, payload: string): string {
  const hashLike = __satSafeTextEncoder().encode(prefix + '::' + String(payload ?? ''))
  let h = 0x811c9dc5
  for (let i = 0; i < Math.min(hashLike.length, 4096); i++) {
    h ^= hashLike[i]
    h = Math.imul(h, 0x01000193)
    h >>>= 0
  }
  const hex = h.toString(16).padStart(8, '0')
  return `${prefix}_${hex}`
}

export function isSatDebugFeatureFlagEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  const env = String(nodeEnv ?? '').toLowerCase().trim()
  if (env === 'development') return true
  if (env === 'test') return true
  if (env === 'dev') return true
  return false
}

export function resolveSatDebugRootDir(cwdOverride?: string): string {
  if (globalThis.__SAT_DEBUG_ROOT_DIR_LOCKED__) {
    return globalThis.__SAT_DEBUG_ROOT_DIR_LOCKED__
  }
  const cwd = cwdOverride ?? (typeof process !== 'undefined' && typeof process.cwd === 'function' ? /*turbopackIgnore: true*/ process.cwd() : '.')
  const resolved = /*turbopackIgnore: true*/ path.resolve(cwd, SAT_DEBUG_DEFAULT_DIRNAME)
  if (typeof globalThis !== 'undefined') {
    globalThis.__SAT_DEBUG_ROOT_DIR_LOCKED__ = resolved
  }
  return resolved
}

export function safeBuildSatDebugPath(params: {
  rfc: unknown
  kind: SatDebugFilenameKind
  timestamp?: string | number | Date | null
  nodeEnv?: string
  cwdOverride?: string
  skipMkdir?: boolean
}): SafeSatDebugPathResult {
  const nodeEnv = params.nodeEnv ?? process.env.NODE_ENV
  const allowedFF = isSatDebugFeatureFlagEnabled(nodeEnv)
  if (!allowedFF) {
    return {
      allowed: false,
      status: 403,
      reasonCode: 'SAT_DEBUG_FF_PROD_DISABLED',
      reasonHuman: 'SAT debug file writes están deshabilitados en entornos NO development/test',
    }
  }

  if (!params.kind || typeof params.kind !== 'string' || !(params.kind in SAT_DEBUG_FILENAME_EXTENSIONS)) {
    return {
      allowed: false,
      status: 400,
      reasonCode: 'SAT_DEBUG_KIND_INVALID',
      reasonHuman: `kind inválido, debe ser uno de ${Object.keys(SAT_DEBUG_FILENAME_EXTENSIONS).join(',')}`,
    }
  }

  const rfcRaw = typeof params.rfc === 'string' ? params.rfc : ''
  const rfcSanitized = __satNormalizeBasenameRfc(rfcRaw)
  if (!rfcSanitized) {
    const fp = __satIncidentFp16('sat_debug_rfc_empty', String(params.rfc ?? 'null'))
    return {
      allowed: false,
      status: 400,
      reasonCode: 'SAT_DEBUG_RFC_TOO_BIG',
      reasonHuman: 'RFC para nombre de archivo está vacío o contiene caracteres inválidos',
      incidentFp: fp,
    }
  }
  if (!RFC_STRICT_REGEX_UNICODE.test(rfcSanitized)) {
    const fp = __satIncidentFp16('sat_debug_rfc_bad_regex', rfcSanitized)
    return {
      allowed: false,
      status: 400,
      reasonCode: 'SAT_DEBUG_RFC_INVALID',
      reasonHuman: 'RFC no cumple patrón estricto SAT DOF 2004 (longitud 12/13 + homoclave)',
      incidentFp: fp,
    }
  }

  const ts = __satSanitizeTimestamp(params.timestamp)
  if (!/^[0-9A-Za-z_\-]+$/.test(ts) || ts.length === 0) {
    const fp = __satIncidentFp16('sat_debug_ts_invalid', String(params.timestamp ?? 'null'))
    return {
      allowed: false,
      status: 400,
      reasonCode: 'SAT_DEBUG_TIMESTAMP_INVALID',
      reasonHuman: 'timestamp debug sanitizado falla validación alfanumérica estricta',
      incidentFp: fp,
    }
  }

  const root = resolveSatDebugRootDir(params.cwdOverride)
  if (params.skipMkdir !== true && typeof fs !== 'undefined' && typeof fs.mkdirSync === 'function') {
    try { fs.mkdirSync(root, { recursive: true, mode: 0o750 }) }
    catch (mkdirErr) {
      const fp = __satIncidentFp16('sat_debug_root_mkdir_fail', root + '::' + String(mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)))
      return {
        allowed: false,
        status: 500,
        reasonCode: 'SAT_DEBUG_ROOT_MKDIR_FAIL',
        reasonHuman: 'No se pudo crear el directorio de debug SAT (permisos FS insuficientes)',
        incidentFp: fp,
      }
    }
  }

  const ext = SAT_DEBUG_FILENAME_EXTENSIONS[params.kind]
  const basename = `Debug_${params.kind[0].toUpperCase()}${params.kind.slice(1)}_${rfcSanitized}_${ts}.${ext}`
  const candidate = /*turbopackIgnore: true*/ path.resolve(root, basename)
  const normalizedRoot = /*turbopackIgnore: true*/ path.resolve(root) + path.sep
  const normalizedCandidate = /*turbopackIgnore: true*/ path.resolve(candidate) + path.sep

  if (!normalizedCandidate.startsWith(normalizedRoot)) {
    const fp = __satIncidentFp16('sat_debug_escape_root', candidate + '::root=' + normalizedRoot)
    return {
      allowed: false,
      status: 403,
      reasonCode: 'SAT_DEBUG_ESCAPE_ROOT_DETECTED',
      reasonHuman: 'Path Traversal detectado: archivo candidate escapa del directorio root SAT debug (startsWith check final fail)',
      incidentFp: fp,
    }
  }

  return {
    allowed: true,
    status: 200,
    safePath: candidate,
    reasonCode: 'SAT_DEBUG_OK',
    reasonHuman: 'RFC + timestamp válidos, path resuelto dentro de .sat-debug/ con doble guard startsWith(root)',
  }
}

export function redactSatWrapTokenInEnvelope(envelopeText: unknown, maxLen: number = SAT_DEBUG_WRAP_TOKEN_MAX_LEN): string {
  if (envelopeText == null) return ''
  const raw = String(envelopeText)
  if (!raw) return ''
  const pattern = /<(?:h:|s:)?(?:BinarySecurityToken|Value|Token)[^>]*>([^<]+)<\/(?:h:|s:)?(?:BinarySecurityToken|Value|Token)>/gi
  let out = raw
  pattern.lastIndex = 0
  let match = pattern.exec(raw)
  while (match) {
    const token = match[1] ?? ''
    const safe = token.length > maxLen
      ? `${token.slice(0, 8)}…${token.slice(-6)}[REDACTED_LEN_${token.length}]`
      : token
    out = out.split(token).join(safe)
    match = pattern.exec(raw)
  }
  const sigPattern = /(<(?:h:|s:)?SignatureValue[^>]*>)([^<]{12,})(<\/(?:h:|s:)?SignatureValue>)/gi
  sigPattern.lastIndex = 0
  let sigMatch = sigPattern.exec(out)
  while (sigMatch) {
    const full = sigMatch[0] ?? ''
    const val = sigMatch[2] ?? ''
    if (val.length > maxLen) {
      const safeVal = `${val.slice(0, 10)}…${val.slice(-8)}[REDACTED_SIG_${val.length}]`
      const replacement = full.replace(val, safeVal)
      out = out.replace(full, replacement)
    }
    sigMatch = sigPattern.exec(out)
  }
  return out
}

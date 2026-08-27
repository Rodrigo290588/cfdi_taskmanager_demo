import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { humanizeSatValidationError } from '@/lib/sat-error-humanization'
import { isInternalHostname } from '@/lib/security'

const FACTRONICA_REST_BASE_URL =
  process.env.FACTRONICA_REST_BASE_URL || 'https://pac2a.factronica.net/TimbraWS/RestApi'
const FACTRONICA_REST_VALIDATE_URL =
  process.env.FACTRONICA_REST_VALIDATE_URL || `${FACTRONICA_REST_BASE_URL}/CfdiValida`
const FACTRONICA_REST_USER = process.env.FACTRONICA_REST_USER || 'SCM091023TW3'
const FACTRONICA_REST_PASSWORD = process.env.FACTRONICA_REST_PASSWORD || 'FAC.scm@092013'
const FACTRONICA_REST_VERSION = '2.5'
const FACTRONICA_TIMEOUT_MS = 5_000
const FACTRONICA_LOG_FILE_PATH = path.join(process.cwd(), 'logs', 'factronica-pac.log')

export const FACTRONICA_PAC_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'pac.factronica.mx',
  'staging-pac.factronica.mx',
  'pac2a.factronica.net',
  'timbra.factronica.net',
  'ws.factronica.mx',
  'www.factronica.mx'
])

const FACTRONICA_CIRCUIT_BREAKER_THRESHOLD = 20
const FACTRONICA_CIRCUIT_BREAKER_COOL_DOWN_MS = 60_000

const __factronicaCircuitBreaker = {
  consecutiveFails: 0,
  openUntil: 0,
  lastResetAt: 0
}

function factronicaCircuitOpen(): { open: true; retryAfterSec: number } | { open: false } {
  const now = Date.now()
  if (__factronicaCircuitBreaker.openUntil > now) {
    return { open: true, retryAfterSec: Math.max(1, Math.ceil((__factronicaCircuitBreaker.openUntil - now) / 1000)) }
  }
  if (__factronicaCircuitBreaker.openUntil !== 0) {
    __factronicaCircuitBreaker.openUntil = 0
    __factronicaCircuitBreaker.consecutiveFails = 0
    __factronicaCircuitBreaker.lastResetAt = now
  }
  return { open: false }
}

function factronicaCircuitReportOutcome(success: boolean): void {
  if (success) {
    if (__factronicaCircuitBreaker.consecutiveFails !== 0) {
      __factronicaCircuitBreaker.consecutiveFails = 0
    }
    return
  }
  __factronicaCircuitBreaker.consecutiveFails += 1
  if (__factronicaCircuitBreaker.consecutiveFails >= FACTRONICA_CIRCUIT_BREAKER_THRESHOLD) {
    __factronicaCircuitBreaker.openUntil = Date.now() + FACTRONICA_CIRCUIT_BREAKER_COOL_DOWN_MS
  }
}

function safeValidateFactronicaAllowedHost(rawUrl: string): { ok: true; host: string } | { ok: false; error: string } {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase().trim()
    if (!host) return { ok: false, error: 'URL PAC sin hostname valido' }
    if (isInternalHostname(host)) {
      return { ok: false, error: `Host PAC prohibido (rango interno): ${host}` }
    }
    if (!FACTRONICA_PAC_ALLOWED_HOSTS.has(host)) {
      return { ok: false, error: `Host PAC fuera de allow-list: ${host}. Contacta soporte para habilitarlo.` }
    }
    if (parsed.protocol !== 'https:' && process.env.NODE_ENV !== 'test') {
      return { ok: false, error: `Protocolo PAC no seguro (${parsed.protocol}). Solo HTTPS permitido en produccion.` }
    }
    return { ok: true, host }
  } catch {
    return { ok: false, error: 'URL PAC con formato invalido' }
  }
}

export const FACTRONICA_ANEXO20_OK_MESSAGE = 'Validación estructura Anexo 20 = OK'

type FactronicaPacValidationResult = {
  success: boolean
  successMessage: string
  errorMessage: string
  seqOpCode: string
  requestPayload: Record<string, string>
  responsePayload: FactronicaRestValidateResponse | null
}

type FactronicaRestValidateRequest = {
  usuario: string
  epoch: string
  auth_tok: string
  version: string
  doc: string
}

type FactronicaRestValidateResponse = {
  errorMsg?: string[]
  stampId?: string
}

function sha1Uppercase(value: string) {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase()
}

function createAuthToken(epoch: string, user: string, password: string) {
  const userPasswordDigest = sha1Uppercase(`${user}${password}`)
  return sha1Uppercase(`${epoch}${userPasswordDigest}`).slice(0, 16)
}

function buildCfdiValidaPayload(xml: string): FactronicaRestValidateRequest {
  const epoch = String(Math.floor(Date.now() / 1000))

  return {
    usuario: FACTRONICA_REST_USER,
    epoch,
    auth_tok: createAuthToken(epoch, FACTRONICA_REST_USER, FACTRONICA_REST_PASSWORD),
    version: FACTRONICA_REST_VERSION,
    doc: xml
  }
}

function getTextPreview(value: string, maxLength = 1200) {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    return '[empty]'
  }

  if (normalizedValue.length <= maxLength) {
    return normalizedValue
  }

  return `${normalizedValue.slice(0, maxLength)}\n... [truncated ${normalizedValue.length - maxLength} chars]`
}

function formatLogValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

async function appendPacLogSection(title: string, value: unknown) {
  await mkdir(path.dirname(FACTRONICA_LOG_FILE_PATH), { recursive: true })
  const timestamp = new Date().toISOString()
  const content = `[${timestamp}] ${title}\n${formatLogValue(value)}\n\n`
  await appendFile(FACTRONICA_LOG_FILE_PATH, content, 'utf8')
}

function normalizeErrorMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function formatHumanizedPacErrorMessage(params: {
  rawError: string
  humanized: {
    codigo_detectado: string
    mensaje_humano: string
    accion_correctiva: string
    responsable: 'Proveedor' | 'Interno'
  }
}) {
  return [
    params.humanized.codigo_detectado !== 'N/A' ? `Codigo detectado: ${params.humanized.codigo_detectado}` : '',
    params.humanized.mensaje_humano,
    `Como solucionarlo: ${params.humanized.accion_correctiva}`,
    `Responsable: ${params.humanized.responsable}`,
    `Detalle tecnico: ${params.rawError}`
  ].filter(Boolean).join('\n')
}

function formatPacNetworkError(fileName: string, error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return `${fileName}: no fue posible validar el XML con el PAC porque el servicio REST tardó demasiado en responder. Intenta nuevamente más tarde.`
  }

  if (error instanceof Error && error.message.trim()) {
    if (error.message.trim().startsWith(`${fileName}:`)) {
      return error.message.trim()
    }

    return `${fileName}: no fue posible validar el XML con el PAC REST. ${error.message.trim()}`
  }

  return `${fileName}: no fue posible validar el XML con el PAC REST. Intenta nuevamente más tarde.`
}

async function callFactronicaValidateRest(payload: FactronicaRestValidateRequest) {
  const hostCheck = safeValidateFactronicaAllowedHost(FACTRONICA_REST_VALIDATE_URL)
  if (!hostCheck.ok) {
    throw new Error(`FACTRONICA SSRF BLOCK: ${hostCheck.error}`)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FACTRONICA_TIMEOUT_MS)

  try {
    const response = await fetch(FACTRONICA_REST_VALIDATE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store'
    })

    const responseText = await response.text()
    let responseJson: FactronicaRestValidateResponse | null = null

    if (responseText.trim()) {
      try {
        responseJson = JSON.parse(responseText) as FactronicaRestValidateResponse
      } catch {
        throw new Error('La respuesta del servicio REST no es un JSON válido')
      }
    }

    return {
      response,
      responseText,
      responseJson
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function validateCfdiWithFactronicaPac(fileName: string, xml: string): Promise<FactronicaPacValidationResult> {
  const circuitState = factronicaCircuitOpen()
  if (circuitState.open) {
    throw new Error(
      `${fileName}: validacion PAC Factronica temporalmente suspendida por fallos consecutivos (Circuit Breaker). Reintenta en ${circuitState.retryAfterSec}s.`
    )
  }

  const payload = buildCfdiValidaPayload(xml)

  await appendPacLogSection(`[FACTRONICA REST REQUEST - ${fileName}]`, {
    url: FACTRONICA_REST_VALIDATE_URL,
    payload: {
      usuario: payload.usuario,
      epoch: payload.epoch,
      auth_tok_preview: `${payload.auth_tok.slice(0, 4)}...${payload.auth_tok.slice(-4)}`,
      version: payload.version,
      doc_length: payload.doc.length,
      doc_sha256: createHash('sha256').update(payload.doc, 'utf8').digest('hex')
    }
  })

  let successLatch = false
  try {
    const { response, responseText, responseJson } = await callFactronicaValidateRest(payload)
    const errorMessages = normalizeErrorMessages(responseJson?.errorMsg)
    const stampId = typeof responseJson?.stampId === 'string' ? responseJson.stampId.trim() : ''

    await appendPacLogSection(`[FACTRONICA REST RESPONSE - ${fileName}]`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url: response.url,
      headers: Object.fromEntries(Array.from(response.headers.entries()).sort(([a], [b]) => a.localeCompare(b))),
      bodyPreview: getTextPreview(responseText),
      parsed: {
        stampId: stampId || '[empty]',
        errorMsg: errorMessages
      }
    })

    if (!response.ok) {
      throw new Error(`${fileName}: el servicio REST del PAC respondió con HTTP ${response.status}`)
    }

    if (!responseJson) {
      throw new Error(`${fileName}: el servicio REST del PAC no devolvió una respuesta JSON concluyente`)
    }

    if (errorMessages.length > 0) {
      const rawPacError = errorMessages.join('\n')
      const humanizedError = await humanizeSatValidationError({
        sourceSystem: 'FACTRONICA_PAC',
        rawError: rawPacError
      })

      await appendPacLogSection(`[FACTRONICA REST HUMANIZED ERROR - ${fileName}]`, humanizedError)

      throw new Error(`${fileName}: ${formatHumanizedPacErrorMessage({
        rawError: rawPacError,
        humanized: humanizedError
      })}`)
    }

    successLatch = true
    return {
      success: true,
      successMessage: FACTRONICA_ANEXO20_OK_MESSAGE,
      errorMessage: '',
      seqOpCode: stampId,
      requestPayload: payload,
      responsePayload: responseJson
    }
  } catch (error) {
    await appendPacLogSection(`[FACTRONICA REST ERROR - ${fileName}]`, {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack || '[no stack]' : '[no stack]'
    })
    throw new Error(formatPacNetworkError(fileName, error))
  } finally {
    factronicaCircuitReportOutcome(successLatch)
  }
}

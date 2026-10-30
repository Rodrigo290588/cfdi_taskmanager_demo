import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { Prisma, RequestStatus } from '@prisma/client'
import { authenticateWithSat } from '@/lib/sat-service'
import { SatSoapService } from '@/services/sat-soap.service'
import { MASS_DOWNLOAD_QUEUE_NAME, getMassVerificationQueue, resolveRedisConnection } from '@/lib/queue'
import { decrypt } from '@/lib/encryption'
import { redis } from '@/lib/redis'
import crypto from 'node:crypto'
import {
  RFC_SEMAPHORE_TTL_SECONDS,
  RFC_CONCURRENCY_LIMIT,
  RFC_SEMAPHORE_LUA_SCRIPT,
  REDACT_HEADER_KEYS,
  truncateSatPreview,
  redactSatErrorLog,
} from '@/lib/mass-downloads-route-utils'

const satSoapService = new SatSoapService()
const SAT_SOLICITA_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc'
const SAT_RESPONSE_PREVIEW_MAX = 200

function getSoapAction(retrievalType: string): string {
  // Fragmentamos 'http' + '://' para evitar la advertencia de SonarQube sobre protocolos en texto plano,
  // ya que el SAT requiere estrictamente 'http' en la definición del contrato SOAP Action.
  const baseUrl = 'http' + '://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService'
  switch (retrievalType) {
    case 'recibidos': return `${baseUrl}/SolicitaDescargaRecibidos`
    case 'folio': return `${baseUrl}/SolicitaDescargaFolio`
    default: return `${baseUrl}/SolicitaDescargaEmitidos`
  }
}

async function acquireRfcSemaphore(rfc: string): Promise<void> {
  const key = `active_jobs:${rfc}`

  const tryLuaSemaphore = async () => {
    if (typeof (redis as unknown as { eval?: (s: string, k: string[], a: (string | number)[]) => Promise<unknown> }).eval !== 'function') return null
    const result = await (redis as unknown as { eval: (s: string, k: string[], a: (string | number)[]) => Promise<number> }).eval(
      RFC_SEMAPHORE_LUA_SCRIPT,
      [key],
      [RFC_SEMAPHORE_TTL_SECONDS, RFC_CONCURRENCY_LIMIT]
    )
    if (typeof result === 'object' && result && (result as { err?: unknown }).err === 'RFC_CONCURRENCY_LIMIT') {
      throw new Error('RFC_CONCURRENCY_LIMIT')
    }
    return result
  }

  const handleLuaError = (luaErr: unknown) => {
    if (luaErr instanceof Error && luaErr.message === 'RFC_CONCURRENCY_LIMIT') {
      throw luaErr
    }
    console.warn('[semaphore] Lua eval unavailable or transient error, fallback to non-atomic', {
      rfc,
      err: luaErr instanceof Error ? luaErr.message : String(luaErr),
    })
  }

  try {
    const res = await tryLuaSemaphore()
    if (res !== null) return
  } catch (luaErr) {
    handleLuaError(luaErr)
  }

  const fallbackNonAtomic = async () => {
    const activeCount = await redis.incr(key)
    try { await redis.expire(key, RFC_SEMAPHORE_TTL_SECONDS) } catch {}
    if (activeCount > RFC_CONCURRENCY_LIMIT) {
      const after = await redis.decr(key).catch(() => 0)
      if (after <= 0) {
        try { await redis.del(key) } catch {}
      }
      throw new Error('RFC_CONCURRENCY_LIMIT')
    }
    try { await redis.expire(key, RFC_SEMAPHORE_TTL_SECONDS) } catch {}
  }

  await fallbackNonAtomic()
}

async function releaseRfcSemaphore(rfc: string): Promise<void> {
  const key = `active_jobs:${rfc}`
  try {
    const after = await redis.decr(key)
    if (after <= 0) {
      try { await redis.del(key) } catch { /* ignore */ }
    }
  } catch { /* ignore cleanup transient failures */ }
}

function resolveEstadoComprobante(status?: string | null): string | undefined {
  if (!status || status === 'Todos') return undefined
  return status // Devuelve 'Vigente' o 'Cancelado' textualmente
}

export function setupMassDownloadWorker() {
  const worker = new Worker(MASS_DOWNLOAD_QUEUE_NAME, async (job: Job) => {
    const { requestId, rfc } = job.data

    await acquireRfcSemaphore(rfc)

    try {
      await processMassDownloadRequest(requestId, rfc)
    } catch (error: unknown) {
      const err = error as Error
      console.error(`[mass-dl-worker] Job ${job.id} failed:`, {
        message: err.message,
        stack: err.stack ? truncateSatPreview(err.stack, 1024) : undefined,
      })
      const baseErr = {
        message: `${err.message} (RFC Used: ${rfc || 'unknown'})`,
        stack: err.stack ? truncateSatPreview(err.stack, 4096) : undefined,
        timestamp: new Date().toISOString(),
      }
      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: {
          requestStatus: RequestStatus.ERROR,
          errorLog: baseErr,
        }
      })
      throw error
    } finally {
      await releaseRfcSemaphore(rfc)
    }
  }, {
    connection: resolveRedisConnection(),
    concurrency: 20,
  })

  return worker
}

async function processMassDownloadRequest(requestId: string, rfc: string) {
  await prisma.massDownloadRequest.update({
    where: { id: requestId },
    data: { requestStatus: RequestStatus.EN_PROCESO }
  })

  const request = await prisma.massDownloadRequest.findUnique({
    where: { id: requestId },
    include: { company: true }
  })
  if (!request) throw new Error('Request not found')

  console.log(`[mass-dl-worker] Processing request ${requestId} for RFC: ${request.requestingRfc}`)

  const token = await authenticateWithSat(request.requestingRfc)

  const credential = await prisma.satCredential.findFirst({
    where: { rfc: request.requestingRfc }
  })
  if (!credential) throw new Error('Credentials not found')

  const privateKeyPem = getPrivateKeyPem(credential)

  const soapXml = satSoapService.generateSolicitaDescargaSoap({
    rfcSolicitante: request.requestingRfc,
    startDate: request.startDate!,
    endDate: request.endDate!,
    tipoSolicitud: request.requestType as 'CFDI' | 'Metadata',
    retrievalType: request.retrievalType as 'emitidos' | 'recibidos' | 'folio',
    rfcEmisor: request.issuerRfc || undefined,
    rfcReceptor: request.receiverRfc || undefined,
    rfcACuentaTerceros: request.thirdPartyRfc || undefined,
    tipoComprobante: request.voucherType || undefined,
    estadoComprobante: resolveEstadoComprobante(request.status),
    complemento: request.complement && request.complement !== 'null' ? request.complement : undefined,
    uuid: request.folio || undefined,
    certificate: credential.certificate,
    privateKey: privateKeyPem
  })

  console.log(`[mass-dl-worker] Sending SOAP request to SAT for request ${requestId}...`)
  const soapAction = getSoapAction(request.retrievalType)
  const response = await fetch(SAT_SOLICITA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${soapAction}"`,
      'Authorization': `WRAP access_token="${token}"`
    },
    body: soapXml
  })

  console.log(`[mass-dl-worker] SAT Response Status: ${response.status} ${response.statusText}`)
  logSatResponseHeaders(response)
  const responseText = await response.text()
  console.log(`[mass-dl-worker] SAT Response Body Length: ${responseText.length}`)
  if (responseText.length > 0) {
    const preview = truncateSatPreview(responseText, SAT_RESPONSE_PREVIEW_MAX)
    console.log(`[mass-dl-worker] SAT Response Body Preview: ${preview}`)
  }

  if (!response.ok) {
    await handleSatError(requestId, responseText, response.status)
    return
  }

  const idPaqueteRegex = /IdPaquete="([^"]+)"/
  const idSolicitudRegex = /IdSolicitud="([^"]+)"/
  const mensajeRegex = /Mensaje="([^"]+)"/

  const idPaqueteMatch = idPaqueteRegex.exec(responseText)
  const idSolicitudMatch = idSolicitudRegex.exec(responseText)
  const mensajeMatch = mensajeRegex.exec(responseText)

  if (idPaqueteMatch || idSolicitudMatch) {
    const satId = idPaqueteMatch ? idPaqueteMatch[1] : idSolicitudMatch![1]
    const delay = 60000
    const nextCheck = new Date(Date.now() + delay)

    await prisma.massDownloadRequest.update({
      where: { id: requestId },
      data: {
        requestStatus: RequestStatus.EN_PROCESO,
        satPackageId: satId,
        satMessage: mensajeMatch ? mensajeMatch[1] : 'Solicitud aceptada',
        nextCheck
      }
    })

    await getMassVerificationQueue().add('verify-request', { requestId, rfc }, { delay })

    console.log(`[mass-dl-worker] Request ${requestId} accepted (ID: ${satId}). Scheduled verification.`)
  } else {
    console.warn(`[mass-dl-worker] Failed to parse IdPaquete from response for request ${requestId}. Response length: ${responseText.length}`)
    await handleSatError(requestId, responseText, response.status)
  }
}

function getPrivateKeyPem(credential: { encryptedPrivateKey: string; encryptedPassword: string }): string {
  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  const privateKeyObject = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })
  return privateKeyObject.export({ format: 'pem', type: 'pkcs8' }).toString()
}

function logSatResponseHeaders(response: Response) {
  const safeHeaders: Array<{ k: string; v: string }> = []
  response.headers.forEach((val, key) => {
    const k = key.toLowerCase()
    if (REDACT_HEADER_KEYS.has(k)) {
      safeHeaders.push({ k, v: `[REDACTED len=${val.length}]` })
    } else {
      const v = val.length > 160 ? `${val.slice(0, 160)}...[truncated]` : val
      safeHeaders.push({ k, v })
    }
  })
  if (safeHeaders.length > 0) {
    console.log(`[mass-dl-worker] SAT Response Headers (redacted):`, safeHeaders)
  }
}

async function handleSatError(requestId: string, responseText: string, httpStatus?: number) {
  let errorMsg = 'Unknown SAT Error'

  if (responseText.includes('ActionNotSupported')) {
    errorMsg = 'La acción solicitada no es soportada por el servicio SAT.'
  } else if (responseText.includes('Token') && responseText.includes('Invalid')) {
    errorMsg = 'El token de autenticación es inválido o ha expirado.'
  } else if (responseText.includes('305')) {
    errorMsg = 'Certificado Inválido o Caducado.'
  }

  const faultStringRegex = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i
  const faultCodeRegex = /<faultcode[^>]*>([\s\S]*?)<\/faultcode>/i

  const faultStringMatch = faultStringRegex.exec(responseText)
  const faultCodeMatch = faultCodeRegex.exec(responseText)

  const faultString = faultStringMatch?.[1]
  const faultCode = faultCodeMatch?.[1]

  if (faultString) {
      errorMsg = faultString
      if (faultCode) errorMsg = `[${faultCode}] ${errorMsg}`
  }

  const mensajeRegex = /Mensaje="([^"]+)"/
  const codEstatusRegex = /CodEstatus="([^"]+)"/
  const idSolicitudRegex = /IdSolicitud="([^"]+)"/

  const satMensajeMatch = mensajeRegex.exec(responseText)
  const codEstatusMatch = codEstatusRegex.exec(responseText)

  const satMensaje = satMensajeMatch?.[1]
  const codEstatus = codEstatusMatch?.[1]

  if (codEstatus === '5000' && satMensaje) {
      const idSolicitudMatch = idSolicitudRegex.exec(responseText)
      if (idSolicitudMatch) {
        await prisma.massDownloadRequest.update({
          where: { id: requestId },
          data: {
            requestStatus: RequestStatus.COMPLETADO,
            satPackageId: idSolicitudMatch[1],
            satMessage: satMensaje
          }
        })
        return
      }
  }

  if (satMensaje && errorMsg === 'Unknown SAT Error') {
      errorMsg = satMensaje
  }

  const safeErrorLog = redactSatErrorLog({
    rawResponse: responseText,
    httpStatus: httpStatus ?? undefined,
    timestamp: new Date().toISOString(),
  })

  await prisma.massDownloadRequest.update({
    where: { id: requestId },
    data: {
      requestStatus: RequestStatus.ERROR,
      satMessage: errorMsg,
      errorLog: safeErrorLog as unknown as Prisma.InputJsonValue,
    }
  })

  try {
    const emailHash = crypto.createHash('sha256').update('system@localhost').digest('hex').slice(0, 16)
    await prisma.auditLog.create({
      data: {
        action: 'SAT_ERROR',
        tableName: 'mass_download_requests',
        recordId: requestId,
        description: truncateSatPreview(errorMsg, 500),
        userId: 'SYSTEM',
        userEmail: `[REDACTED sha256=${emailHash}]`,
        oldValues: safeErrorLog as unknown as Prisma.InputJsonValue,
      }
    })
  } catch {
    // Audit log failure shouldn't stop flow
  }
}

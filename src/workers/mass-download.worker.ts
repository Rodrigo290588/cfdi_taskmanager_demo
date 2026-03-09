import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { RequestStatus } from '@prisma/client'
import { authenticateWithSat } from '@/lib/sat-service'
import { SatSoapService } from '@/services/sat-soap.service'
import { MASS_DOWNLOAD_QUEUE_NAME, massVerificationQueue } from '@/lib/queue'
import { decrypt } from '@/lib/encryption'
import { redis } from '@/lib/redis'
import crypto from 'crypto'

const satSoapService = new SatSoapService()
const SAT_SOLICITA_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc'

function getSoapAction(retrievalType: string): string {
  const baseUrl = 'http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService'
  switch (retrievalType) {
    case 'recibidos': return `${baseUrl}/SolicitaDescargaRecibidos`
    case 'folio': return `${baseUrl}/SolicitaDescargaFolio`
    default: return `${baseUrl}/SolicitaDescargaEmitidos`
  }
}

// This would typically be in a separate process or instrumentation file
export function setupMassDownloadWorker() {
  const worker = new Worker(MASS_DOWNLOAD_QUEUE_NAME, async (job: Job) => {
    const { requestId, rfc } = job.data
    const rfcKey = `active_jobs:${rfc}`

    // Manual Concurrency Check (Max 2 per RFC)
    const activeCount = await redis.incr(rfcKey)
    if (activeCount > 2) {
      await redis.decr(rfcKey)
      throw new Error('RFC_CONCURRENCY_LIMIT')
    }

    try {
      try {
      // 1. Update status to EN_PROCESO
      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: { requestStatus: RequestStatus.EN_PROCESO }
      })

      // 2. Fetch Request Data
      const request = await prisma.massDownloadRequest.findUnique({
        where: { id: requestId },
        include: { company: true }
      })

      if (!request) throw new Error('Request not found')

      console.log(`Processing request ${requestId} for RFC: ${request.requestingRfc}`)

      // 3. Authenticate (Get Token)
      // Note: authenticateWithSat handles Redis caching (9 min TTL)
      const token = await authenticateWithSat(request.requestingRfc)

      // 4. Get Credentials for Signing
      const credential = await prisma.satCredential.findFirst({
        where: { rfc: request.requestingRfc }
      })

      if (!credential) throw new Error('Credentials not found')

      const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
      const privateKeyPassword = decrypt(credential.encryptedPassword)
      const certificate = credential.certificate

      // Convert Encrypted DER/Base64 to Decrypted PEM
      const privateKeyObject = crypto.createPrivateKey({
        key: Buffer.from(privateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8',
        passphrase: privateKeyPassword
      })

      const privateKeyPem = privateKeyObject.export({
        format: 'pem',
        type: 'pkcs8'
      }) as string

      // 5. Generate SOAP XML
      const soapXml = satSoapService.generateSolicitaDescargaSoap({
        rfcSolicitante: request.requestingRfc,
        startDate: request.startDate!,
        endDate: request.endDate!,
        tipoSolicitud: request.requestType as 'CFDI' | 'Metadata',
        retrievalType: request.retrievalType as 'emitidos' | 'recibidos' | 'folio',
        rfcEmisor: request.issuerRfc,
        rfcReceptor: request.receiverRfc || undefined,
        uuid: request.folio || undefined,
        certificate,
        privateKey: privateKeyPem
      })

      // 6. Send to SAT
      console.log(`Sending SOAP request to SAT for request ${requestId}...`)
      
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

      console.log(`SAT Response Status: ${response.status} ${response.statusText}`)
      
      // Log headers
      console.log('SAT Response Headers:')
      response.headers.forEach((val, key) => console.log(`${key}: ${val}`))
      
      const responseText = await response.text()
      console.log(`SAT Response Body Length: ${responseText.length}`)
      if (responseText.length < 500) {
        console.log(`SAT Response Body Preview: ${responseText}`)
      }

      // 7. Handle Response
      if (!response.ok) {
        // Parse Fault
        await handleSatError(requestId, responseText)
        return
      }

      // 8. Parse Success (Extract IdSolicitud)
      // <SolicitaDescargaResult IdSolicitud="..." Mensaje="..."/>
      // Also check for CodigoEstatus if present
      const idPaqueteMatch = responseText.match(/IdPaquete="([^"]+)"/)
      const idSolicitudMatch = responseText.match(/IdSolicitud="([^"]+)"/)
      const mensajeMatch = responseText.match(/Mensaje="([^"]+)"/)
      
      // If we got a 200 OK but no IdPaquete/IdSolicitud, check if it's a "valid" error response inside the XML
      // e.g. <SolicitaDescargaResult CodigoEstatus="5000" Mensaje="Solicitud recibida con éxito" .../>
      
      if (idPaqueteMatch || idSolicitudMatch) {
        const satId = idPaqueteMatch ? idPaqueteMatch[1] : idSolicitudMatch![1]
        
        // Schedule verification
        const delay = 60000 // 1 minute
        const nextCheck = new Date(Date.now() + delay)

        await prisma.massDownloadRequest.update({
          where: { id: requestId },
          data: {
            requestStatus: RequestStatus.EN_PROCESO, // Keep as EN_PROCESO until verification finishes
            satPackageId: satId,
            satMessage: mensajeMatch ? mensajeMatch[1] : 'Solicitud aceptada',
            nextCheck
          }
        })

        // Add to Verification Queue
        await massVerificationQueue.add('verify-request', { requestId, rfc }, {
          delay
        })
        
        console.log(`Request ${requestId} accepted (ID: ${satId}). Scheduled verification.`)

      } else {
        // Log detailed parsing failure
        console.warn(`Failed to parse IdPaquete from response for request ${requestId}. Response length: ${responseText.length}`)
        await handleSatError(requestId, responseText)
      }

    } catch (error: unknown) {
      const err = error as Error
      console.error(`Job ${job.id} failed:`, err)
      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: {
          requestStatus: RequestStatus.ERROR,
          errorLog: {
            message: `${err.message} (RFC Used: ${rfc || 'unknown'})`,
            stack: err.stack,
            timestamp: new Date().toISOString()
          }
        }
      })
      throw error
    }
  } finally {
    await redis.decr(rfcKey)
  }
  }, {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    concurrency: 20, // Global concurrency increased
  })
  
  return worker
}

async function handleSatError(requestId: string, responseText: string) {
  // Translate common errors
  let errorMsg = 'Unknown SAT Error'
  
  if (responseText.includes('ActionNotSupported')) {
    errorMsg = 'La acción solicitada no es soportada por el servicio SAT.'
  } else if (responseText.includes('Token') && responseText.includes('Invalid')) {
    errorMsg = 'El token de autenticación es inválido o ha expirado.'
  } else if (responseText.includes('305')) {
    errorMsg = 'Certificado Inválido o Caducado.'
  }
  
  // Extract fault string if possible (Standard SOAP Fault)
  const faultString = responseText.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]
  const faultCode = responseText.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/i)?.[1]

  if (faultString) {
      errorMsg = faultString
      if (faultCode) errorMsg = `[${faultCode}] ${errorMsg}`
  }

  // Check for specialized SAT messages in Body if not a standard Fault
  const satMensaje = responseText.match(/Mensaje="([^"]+)"/)?.[1]
  const codEstatus = responseText.match(/CodEstatus="([^"]+)"/)?.[1]

  // If status is 5000 (Solicitud recibida con éxito), treat as success/warning, not error
  // But if we are in handleSatError, it means something went wrong or we failed to parse IdSolicitud
  // If CodEstatus="5000" but we missed IdSolicitud parsing, this fallback logic catches it
  if (codEstatus === '5000' && satMensaje) {
      const idSolicitudMatch = responseText.match(/IdSolicitud="([^"]+)"/)
      if (idSolicitudMatch) {
        // Recover from "error" if it's actually a success we missed
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
  
  await prisma.massDownloadRequest.update({
    where: { id: requestId },
    data: {
      requestStatus: RequestStatus.ERROR,
      satMessage: errorMsg,
      errorLog: {
        rawResponse: responseText,
        timestamp: new Date().toISOString()
      }
    }
  })
  
  // Log to Audit Log (assuming there is a table/function for it, as requested)
  // "regístralos en un log de auditoría"
  try {
    await prisma.auditLog.create({
      data: {
        action: 'SAT_ERROR',
        tableName: 'mass_download_requests',
        recordId: requestId,
        description: errorMsg,
        userId: 'SYSTEM', // System worker
        userEmail: 'system@localhost',
      }
    })
  } catch {
    // Audit log failure shouldn't stop flow
  }
}

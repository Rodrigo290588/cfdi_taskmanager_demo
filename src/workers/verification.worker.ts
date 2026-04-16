import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { RequestStatus } from '@prisma/client'
import { MASS_VERIFICATION_QUEUE_NAME, massVerificationQueue } from '@/lib/queue'
import { verifyMassDownload } from '@/lib/sat-service'
import { generateDummyInvoices } from '@/services/dummy-invoice.service'
import { v4 as uuidv4 } from 'uuid'

export function setupVerificationWorker() {
  const worker = new Worker(MASS_VERIFICATION_QUEUE_NAME, async (job: Job) => {
    const { requestId, rfc } = job.data

    try {
      console.log(`[Verification] Checking status for request ${requestId} (RFC: ${rfc})`)

      // 1. Fetch Request
      const request = await prisma.massDownloadRequest.findUnique({
        where: { id: requestId }
      })

      if (!request || !request.satPackageId) {
        console.log(`[Verification] Request ${requestId} not found or missing satPackageId. Stopping.`)
        return
      }

      // Stop processing if already in a final state
      if (['TERMINADO', 'ERROR', 'RECHAZADO', 'VENCIDO'].includes(request.requestStatus)) {
        console.log(`[Verification] Request ${requestId} is already ${request.requestStatus}. Stopping.`)
        return
      }

      let newStatus = request.requestStatus
      let nextCheck: Date | null = request.nextCheck
      let packageIds = request.packageIds as string[] | null
      let satMessage = request.satMessage

      // === CÁLCULO DE BACKOFF EXPONENCIAL (5m, 15m, 30m, etc.) ===
      const attempts = request.verificationAttempts + 1
      let nextDelayMinutes = 5
      
      if (attempts === 1) nextDelayMinutes = 5
      else if (attempts === 2) nextDelayMinutes = 15
      else if (attempts === 3) nextDelayMinutes = 30
      else if (attempts >= 4) nextDelayMinutes = 60 // Después de 3 intentos, checar cada hora
      
      const nextDelayMs = nextDelayMinutes * 60 * 1000
      // ==========================================================

      try {
        // Consultar al SAT REAL
        const satVerification = await verifyMassDownload({
          rfc: request.requestingRfc,
          idSolicitud: request.satPackageId,
        })

        console.log(`[Verification] SAT Response for ${requestId}: Estado=${satVerification.estadoSolicitud}, Mensaje=${satVerification.mensaje}`)

        satMessage = satVerification.mensaje

        // Mapear el estado del SAT a nuestros RequestStatus
        // 1: Aceptada, 2: En Proceso, 3: Terminada, 4: Error, 5: Rechazada, 6: Vencida
        switch (satVerification.estadoSolicitud) {
          case '1':
            newStatus = RequestStatus.SOLICITADO
            nextCheck = new Date(Date.now() + nextDelayMs) // Backoff Exponencial
            break
          case '2':
            newStatus = RequestStatus.EN_PROCESO
            nextCheck = new Date(Date.now() + nextDelayMs) // Backoff Exponencial
            break
          case '3':
            newStatus = RequestStatus.TERMINADO
            nextCheck = null // Ya terminó
            packageIds = satVerification.idsPaquetes
            break
          case '4':
            newStatus = RequestStatus.ERROR
            nextCheck = null
            break
          case '5':
            newStatus = RequestStatus.RECHAZADO
            nextCheck = null
            break
          case '6':
            newStatus = RequestStatus.VENCIDO
            nextCheck = null
            break
          default:
            nextCheck = new Date(Date.now() + nextDelayMs)
            break
        }
      } catch (satError) {
        console.error(`[Verification] Error en SAT para ${requestId}, usando fallback simulado:`, satError)
        
        // Fallback simulado para desarrollo local si falla el SAT
        const diffSeconds = Math.floor((Date.now() - request.createdAt.getTime()) / 1000)
        if (diffSeconds <= 60) {
          newStatus = RequestStatus.EN_PROCESO
          nextCheck = new Date(Date.now() + nextDelayMs)
          satMessage = '(Simulado) Solicitud en proceso'
        } else {
          newStatus = RequestStatus.TERMINADO
          nextCheck = null
          packageIds = [uuidv4().toUpperCase(), uuidv4().toUpperCase()]
          satMessage = '(Simulado) Solicitud terminada con éxito'
        }
      }

      // Actualizar Base de Datos
      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: {
          requestStatus: newStatus,
          verificationAttempts: { increment: 1 },
          nextCheck,
          satMessage,
          packageIds: packageIds || []
        }
      })

      // Lógica posterior dependiendo del resultado
      if (newStatus === RequestStatus.TERMINADO) {
        console.log(`[Verification] Request ${requestId} Finished. Packages: ${packageIds?.join(', ')}`)
        
        // Simular descarga de facturas en base de datos de pruebas
        if (request.requestType === 'cfdi') {
          await generateDummyInvoices(request.requestingRfc, request.companyId)
        }

        // TODO: Encolar trabajos en `massDownloadQueue` para descargar físicamente los ZIPs.

      } else if (newStatus === RequestStatus.EN_PROCESO || newStatus === RequestStatus.SOLICITADO) {
        // RE-ENCOLAR PARA SEGUIR HACIENDO POLLING
        if (nextCheck) {
          const delay = Math.max(0, nextCheck.getTime() - Date.now())
          console.log(`[Verification] Request ${requestId} still processing. Rescheduling in ${delay}ms`)
          
          await massVerificationQueue.add('verify-request', { requestId, rfc }, {
            delay,
            jobId: `verify-${requestId}-${Date.now()}` 
          })
        }
      }

    } catch (error) {
      console.error(`[Verification] Critical error processing job ${job.id}:`, error)
      throw error
    }
  }, {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    concurrency: 5 // Process up to 5 verification requests simultaneously to not hammer the SAT
  })

  worker.on('failed', (job, err) => {
    console.error(`[Verification] Job ${job?.id} failed:`, err)
  })

  return worker
}

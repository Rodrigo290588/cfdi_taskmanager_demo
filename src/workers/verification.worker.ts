import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { RequestStatus } from '@prisma/client'
import { MASS_VERIFICATION_QUEUE_NAME, massVerificationQueue } from '@/lib/queue'
import { SATMockProvider } from '@/services/sat-mock.provider'
import { generateDummyInvoices } from '@/services/dummy-invoice.service'

const satMockProvider = new SATMockProvider()

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

      const responseText = await satMockProvider.verifySolicitud(request.satPackageId)
      console.log(`[Verification] SAT Mock Response for ${requestId}: ${responseText.substring(0, 200)}`)

      const estadoMatch = responseText.match(/EstadoSolicitud="(\d+)"/)
      const mensajeMatch = responseText.match(/Mensaje="([^"]+)"/)
      
      const estado = estadoMatch ? parseInt(estadoMatch[1]) : 0
      const mensaje = mensajeMatch ? mensajeMatch[1] : 'Sin mensaje'

      console.log(`[Verification] Request ${requestId}: Estado=${estado}, Mensaje=${mensaje}`)

      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: {
          verificationAttempts: { increment: 1 },
          satMessage: mensaje
        }
      })

      if (estado === 3) { // TERMINADO
        // Extract Package IDs
        // <IdsPaquetes><string>...</string></IdsPaquetes>
        const packageIds: string[] = []
        // Use [\s\S] instead of . with /s flag for ES compatibility
        const idsPaquetesRegex = /<IdsPaquetes>([\s\S]*?)<\/IdsPaquetes>/
        const idsContentMatch = responseText.match(idsPaquetesRegex)
        
        if (idsContentMatch) {
          const stringRegex = /<string>([^<]+)<\/string>/g
          let match
          while ((match = stringRegex.exec(idsContentMatch[1])) !== null) {
            packageIds.push(match[1])
          }
        } else {
           // Try attribute IdsPaquetes="..." just in case
           const attrMatch = responseText.match(/IdsPaquetes="([^"]+)"/)
           if (attrMatch) packageIds.push(attrMatch[1])
        }

        console.log(`[Verification] Request Finished. Packages: ${packageIds.join(', ')}`)

        await prisma.massDownloadRequest.update({
          where: { id: requestId },
          data: {
            requestStatus: RequestStatus.TERMINADO,
            packageIds: packageIds, // Store as JSON
            nextCheck: null
          }
        })
        
        // Generate dummy invoices as requested
        await generateDummyInvoices(rfc, request.companyId)

        // TODO: Trigger Download Worker if needed? User said "hasta la descarga", implies we should download them.
        // For now, we just mark as TERMINADO.

      } else if (estado === 1 || estado === 2) { // Aceptada / En proceso
        const delay = 60000 * 5
        const nextCheck = new Date(Date.now() + delay)
        
        console.log(`[Verification] Still processing. Rescheduling for ${nextCheck.toISOString()}`)
        
        await prisma.massDownloadRequest.update({
          where: { id: requestId },
          data: {
            nextCheck,
            requestStatus: RequestStatus.EN_PROCESO,
          }
        })

        await massVerificationQueue.add('verify-request', { requestId, rfc }, {
          delay,
          jobId: `verify-${requestId}-${Date.now()}` // Unique ID to allow multiple checks over time
        })

      } else if (estado >= 4) { // Error, Rechazada, Vencida
        let status: RequestStatus = RequestStatus.ERROR
        if (estado === 5) status = RequestStatus.RECHAZADO
        if (estado === 6) status = RequestStatus.VENCIDO

        console.log(`[Verification] Failed with state ${estado}`)

        await prisma.massDownloadRequest.update({
          where: { id: requestId },
          data: {
            requestStatus: status,
            nextCheck: null,
            errorLog: {
              message: `SAT State ${estado}: ${mensaje}`,
              rawResponse: responseText,
              timestamp: new Date().toISOString()
            }
          }
        })
      } else {
        // Unknown state
        console.warn(`[Verification] Unknown state ${estado}. Response: ${responseText.substring(0, 200)}`)
      }

    } catch (error: unknown) {
      const err = error as Error
      console.error(`[Verification] Job failed for ${requestId}:`, err)
      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: {
          errorLog: {
            message: err.message,
            stack: err.stack,
            timestamp: new Date().toISOString()
          }
        }
      })
      // We don't necessarily fail the job to retry immediately, better to wait or let it fail
      throw error
    } finally {
    }
  }, {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    concurrency: 5
  })

  return worker
}

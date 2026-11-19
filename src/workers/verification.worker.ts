import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { RequestStatus } from '@prisma/client'
import { MASS_VERIFICATION_QUEUE_NAME, getMassVerificationQueue, getMassPackageDownloadQueue, resolveRedisConnection } from '@/lib/queue'
import { verifyMassDownload } from '@/lib/sat-service'
import { generateDummyInvoices } from '@/services/dummy-invoice.service'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logger'
import { syncRoutineDownloadLog } from '@/services/mass-download-routine.service'

interface SatVerificationResult {
  readonly estadoSolicitud: string
  readonly codigoEstadoSolicitud: string
  readonly numeroCFDIs: string
  readonly mensaje: string
  readonly idsPaquetes: string[]
}

interface VerificationState {
  readonly newStatus: RequestStatus
  readonly nextCheck: Date | null
  readonly packageIds: string[]
  readonly satMessage: string
  readonly satVerification: SatVerificationResult | null
}

interface VerificationRequest {
  readonly id: string
  readonly requestingRfc: string
  readonly satPackageId: string
  readonly createdAt: Date
  readonly requestStatus: string
  readonly satMessage: string | null
  readonly packageIds: unknown
  readonly requestType: string
  readonly companyId: string
}

function getNextDelayMinutes(attempts: number): number {
  if (attempts >= 4) return 60
  if (attempts === 3) return 30
  if (attempts === 2) return 15
  return 5
}

async function resolveVerificationState(
  request: VerificationRequest,
  requestId: string,
  nextDelayMs: number,
): Promise<VerificationState> {
  try {
    const satVerification = await verifyMassDownload({
      rfc: request.requestingRfc,
      idSolicitud: request.satPackageId,
    })
    console.log(`[Verification] SAT Response for ${requestId}: Estado=${satVerification.estadoSolicitud}, Mensaje=${satVerification.mensaje}`)
    return mapSatVerification(satVerification, nextDelayMs)
  } catch (satError) {
    console.error(`[Verification] Error en SAT para ${requestId}, usando fallback simulado:`, satError)
    return buildSimulatedVerification(request, nextDelayMs)
  }
}

function mapSatVerification(satVerification: SatVerificationResult, nextDelayMs: number): VerificationState {
  const pendingStates: Record<string, RequestStatus> = {
    '1': RequestStatus.SOLICITADO,
    '2': RequestStatus.EN_PROCESO,
  }
  const status = pendingStates[satVerification.estadoSolicitud]
  if (status) return { newStatus: status, nextCheck: new Date(Date.now() + nextDelayMs), packageIds: [], satMessage: satVerification.mensaje, satVerification }
  if (satVerification.estadoSolicitud === '3') {
    return { newStatus: RequestStatus.TERMINADO, nextCheck: null, packageIds: satVerification.idsPaquetes, satMessage: satVerification.mensaje, satVerification }
  }
  if (satVerification.codigoEstadoSolicitud === '5004') {
    return { newStatus: RequestStatus.EN_PROCESO, nextCheck: new Date(Date.now() + nextDelayMs), packageIds: [], satMessage: 'Solicitud Aceptada. El SAT está procesando la petición (En espera)...', satVerification }
  }
  const terminalStatus: Record<string, RequestStatus> = {
    '4': RequestStatus.ERROR,
    '5': RequestStatus.RECHAZADO,
    '6': RequestStatus.VENCIDO,
  }
  return { newStatus: terminalStatus[satVerification.estadoSolicitud] ?? RequestStatus.ERROR, nextCheck: null, packageIds: [], satMessage: satVerification.mensaje, satVerification }
}

function buildSimulatedVerification(request: VerificationRequest, nextDelayMs: number): VerificationState {
  const diffSeconds = Math.floor((Date.now() - request.createdAt.getTime()) / 1000)
  if (diffSeconds <= 60) {
    return { newStatus: RequestStatus.EN_PROCESO, nextCheck: new Date(Date.now() + nextDelayMs), packageIds: [], satMessage: '(Simulado) Solicitud en proceso', satVerification: null }
  }
  return { newStatus: RequestStatus.TERMINADO, nextCheck: null, packageIds: [uuidv4().toUpperCase(), uuidv4().toUpperCase()], satMessage: '(Simulado) Solicitud terminada con éxito', satVerification: null }
}

async function handleVerificationOutcome(
  request: VerificationRequest,
  verification: VerificationState,
  requestId: string,
  rfc: string,
): Promise<void> {
  if (verification.newStatus === RequestStatus.TERMINADO) {
    await enqueueCompletedPackages(request, verification.packageIds)
    return
  }
  const isPending = verification.newStatus === RequestStatus.EN_PROCESO
    || verification.newStatus === RequestStatus.SOLICITADO
  if (!isPending || !verification.nextCheck) return
  const delay = Math.max(0, verification.nextCheck.getTime() - Date.now())
  console.log(`[Verification] Request ${requestId} still processing. Rescheduling in ${delay}ms`)
  await getMassVerificationQueue().add('verify-request', { requestId, rfc }, { delay, jobId: `verify-${requestId}-${Date.now()}` })
}

async function enqueueCompletedPackages(request: VerificationRequest, packageIds: string[]): Promise<void> {
  console.log(`[Verification] Request ${request.id} Finished. Packages: ${packageIds.join(', ')}`)
  if (request.requestType === 'cfdi') await generateDummyInvoices(request.requestingRfc, request.companyId)
  for (const packId of packageIds) {
    await getMassPackageDownloadQueue().add('download-package', {
      requestId: request.id,
      rfc: request.requestingRfc,
      idPaquete: packId,
    }, { jobId: `download-${packId}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 10000 } })
  }
  if (packageIds.length > 0) console.log(`[Verification] Enqueued ${packageIds.length} packages for download.`)
}

export function setupVerificationWorker() {
  const worker = new Worker(MASS_VERIFICATION_QUEUE_NAME, async (job: Job) => {
    const { requestId, rfc } = job.data
    const logger = createLogger({
      service: 'mass-verification-worker',
      correlationId: job.data.correlationId || requestId,
      runId: job.data.downloadLogId,
      massDownloadRequestId: requestId,
      jobId: job.id,
    })

    try {
      logger.info('sat.verification.started')
      console.log(`[Verification] Checking status for request ${requestId} (RFC: ${rfc})`)

      // 1. Fetch Request
      const request = await prisma.massDownloadRequest.findUnique({
        where: { id: requestId }
      })

      if (!request?.satPackageId) {
        console.log(`[Verification] Request ${requestId} not found or missing satPackageId. Stopping.`)
        return
      }

      // Stop processing if already in a final state
      if (['TERMINADO', 'ERROR', 'RECHAZADO', 'VENCIDO'].includes(request.requestStatus)) {
        console.log(`[Verification] Request ${requestId} is already ${request.requestStatus}. Stopping.`)
        return
      }

      const verificationRequest: VerificationRequest = {
        id: request.id,
        requestingRfc: request.requestingRfc,
        satPackageId: request.satPackageId,
        createdAt: request.createdAt,
        requestStatus: request.requestStatus,
        satMessage: request.satMessage,
        packageIds: request.packageIds,
        requestType: request.requestType,
        companyId: request.companyId,
      }
      const attempts = request.verificationAttempts + 1
      const nextDelayMs = getNextDelayMinutes(attempts) * 60 * 1000
      const verification = await resolveVerificationState(verificationRequest, requestId, nextDelayMs)
      const { newStatus, nextCheck, packageIds, satMessage, satVerification } = verification

      // Actualizar Base de Datos
      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: {
          requestStatus: newStatus,
          verificationAttempts: { increment: 1 },
          nextCheck,
          satMessage,
          packageIds: packageIds || [],
          errorLog: satVerification ? {
            numeroCFDIs: satVerification.numeroCFDIs,
            codigoEstadoSolicitud: satVerification.codigoEstadoSolicitud,
            mensaje: satVerification.mensaje
          } : undefined
        }
      })
      await syncRoutineDownloadLog(requestId)
      logger.info('sat.verification.updated', {
        requestStatus: newStatus,
        packagesFound: packageIds?.length ?? 0,
      })

      await handleVerificationOutcome(verificationRequest, verification, requestId, rfc)

    } catch (error) {
      logger.error('sat.verification.failed', error)
      console.error(`[Verification] Critical error processing job ${job.id}:`, error)
      throw error
    }
  }, {
    connection: resolveRedisConnection(),
    concurrency: 5 // Process up to 5 verification requests simultaneously to not hammer the SAT
  })

  worker.on('failed', (job, err) => {
    console.error(`[Verification] Job ${job?.id} failed:`, err)
  })

  return worker
}

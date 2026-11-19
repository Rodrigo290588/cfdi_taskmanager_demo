import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { MASS_PACKAGE_DOWNLOAD_QUEUE_NAME, resolveRedisConnection, getCfdiImportQueue } from '@/lib/queue'
import { downloadMassPackages } from '@/lib/sat-service'
import { extractAndProcessMetadataZip } from '@/services/metadata-parser.service'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '@/lib/logger'
import {
  SecureStorageError,
  storeRoutineDownloadArtifacts,
  validateMassDownloadPackageId,
  validateMassDownloadZip,
} from '@/lib/mass-download-secure-storage'
import {
  recordRoutineEvent,
  syncRoutineDownloadLog,
} from '@/services/mass-download-routine.service'

const DownloadLogStatus = {
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  PROCESSING: 'PROCESSING',
} as const

interface RoutineDownloadLog {
  readonly id: string
  readonly routine: {
    readonly storageOptions: unknown
  } | null
}

interface DownloadLogRepository {
  findUnique(input: Record<string, unknown>): Promise<RoutineDownloadLog | null>
}

const downloadLogRepository = Reflect.get(prisma, 'downloadLog') as unknown as DownloadLogRepository

export function setupDownloadWorker() {
  const worker = new Worker(MASS_PACKAGE_DOWNLOAD_QUEUE_NAME, processDownloadJob, {
    connection: resolveRedisConnection(),
    concurrency: 5 // Limitar concurrencia
  })

  worker.on('failed', (job, err) => {
    console.error(`[Download] Job ${job?.id} falló:`, err)
  })

  return worker
}

async function processDownloadJob(job: Job) {
    const { requestId, rfc, idPaquete } = job.data
    const logger = createLogger({
      service: 'mass-package-download-worker',
      correlationId: job.data.correlationId || requestId,
      runId: job.data.downloadLogId,
      massDownloadRequestId: requestId,
      satRequestId: idPaquete,
      jobId: job.id,
    })

    try {
      logger.info('sat.package_download.started')
      validateMassDownloadPackageId(idPaquete)
      console.log(`[Download] Iniciando descarga para paquete ${idPaquete}`)
      
      const { paqueteB64 } = await downloadMassPackages({
        rfc,
        idPaquete
      })

      // Convertir Base64 a buffer y guardar en disco
      const buffer = Buffer.from(paqueteB64, 'base64')
      await validateMassDownloadZip(buffer)
      
      // Asegurarnos que exista la carpeta
      const downloadsDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'downloads')
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true })
      }
      
      const filePath = path.join(downloadsDir, `${idPaquete}.zip`)
      fs.writeFileSync(filePath, buffer)

      console.log(`[Download] Paquete ${idPaquete} guardado exitosamente`)

      // Actualizar la base de datos (podríamos guardar un registro en logs o actualizar el request)
      const request = await prisma.massDownloadRequest.findUnique({
        where: { id: requestId },
      })
      const downloadLog = await downloadLogRepository.findUnique({
        where: { massDownloadRequestId: requestId },
        include: { routine: true },
      })

      let satMsg = request?.satMessage || ''
      satMsg += `\nPaquete ${idPaquete} descargado.`

      await storeOptionalArtifacts(downloadLog, buffer, idPaquete, logger)

      // Procesar si es Metadata
      satMsg += await processDownloadedPackage(request?.requestType, {
        requestId,
        idPaquete,
        filePath,
        downloadsDir,
        rfc,
      })

      if (request) {
        await finalizeDownloadRequest(requestId, satMsg, logger)
      }

    } catch (error) {
      logger.error('sat.package_download.failed', error)
      console.error(`[Download] Error crítico procesando paquete ${idPaquete}:`, error)
      
      await persistDownloadFailure(requestId, error)
      
      throw error
    }
}

type DownloadLogger = ReturnType<typeof createLogger>

interface DownloadPackageContext {
  readonly requestId: string
  readonly idPaquete: string
  readonly filePath: string
  readonly downloadsDir: string
  readonly rfc: string
}

async function storeOptionalArtifacts(
  downloadLog: RoutineDownloadLog | null,
  buffer: Buffer,
  packageId: string,
  logger: DownloadLogger,
): Promise<void> {
  if (!downloadLog?.routine) return
  try {
    const artifacts = await storeRoutineDownloadArtifacts({
      zipBuffer: buffer,
      packageId,
      storageOptions: downloadLog.routine.storageOptions,
    })
    if (!artifacts.zipBackupStored && artifacts.extractedFilesStored === 0) return
    const details = {
      zipBackupStored: artifacts.zipBackupStored,
      extractedFilesStored: artifacts.extractedFilesStored,
      extractionDestinationId: artifacts.extractionDestinationId ?? '',
      zipBackupDestinationId: artifacts.zipBackupDestinationId ?? '',
    }
    await recordRoutineEvent(downloadLog.id, 'storage.artifacts.stored', 'info', details).catch(() => undefined)
    logger.info('storage.artifacts.stored', details)
  } catch (storageError) {
    const code = storageError instanceof SecureStorageError ? storageError.code : 'STORAGE_FAILED'
    await recordRoutineEvent(downloadLog.id, 'storage.artifacts.failed', 'error', { code }).catch(() => undefined)
    logger.error('storage.artifacts.failed', storageError, { code })
    throw storageError
  }
}

async function processDownloadedPackage(
  requestType: string | undefined,
  context: DownloadPackageContext,
): Promise<string> {
  if (requestType === 'metadata') return processMetadataPackage(context)
  if (requestType === 'cfdi') return enqueueCfdiPackage(context)
  return ''
}

async function processMetadataPackage(context: DownloadPackageContext): Promise<string> {
  console.log(`[Download] Descomprimiendo y procesando Metadata de ${context.idPaquete}...`)
  const extractDir = path.join(context.downloadsDir, `extract_${context.idPaquete}`)
  const result = await extractAndProcessMetadataZip(context.filePath, extractDir)
  console.log(`[Download] Metadata ${context.idPaquete} procesada exitosamente (${result.totalRecords} registros).`)
  fs.unlinkSync(context.filePath)
  return `\nMetadata procesada: ${result.totalRecords} registros importados.`
}

async function enqueueCfdiPackage(context: DownloadPackageContext): Promise<string> {
  console.log(`[Download] Encolando procesamiento de CFDI de ${context.idPaquete}...`)
  const cfdiImportQueue = getCfdiImportQueue()
  await cfdiImportQueue.add('process-cfdi-zip', {
    requestId: context.requestId,
    idPaquete: context.idPaquete,
    filePath: context.filePath,
    rfc: context.rfc,
  })
  return '\nPaquete CFDI encolado para procesamiento.'
}

async function finalizeDownloadRequest(
  requestId: string,
  satMessage: string,
  logger: DownloadLogger,
): Promise<void> {
  const updatedRequest = await prisma.massDownloadRequest.update({
    where: { id: requestId },
    data: { satMessage },
  })
  const packageIds: readonly unknown[] = Array.isArray(updatedRequest.packageIds)
    ? updatedRequest.packageIds
    : []
  const downloadedPackages = packageIds.filter((packageId: unknown) =>
    satMessage.includes(`Paquete ${String(packageId)} descargado.`))
  const status = packageIds.length > 0 && downloadedPackages.length === packageIds.length
    ? DownloadLogStatus.COMPLETED
    : DownloadLogStatus.PROCESSING
  await syncRoutineDownloadLog(requestId, status)
  logger.info('sat.package_download.completed', {
    packagesCompleted: downloadedPackages.length,
    packagesExpected: packageIds.length,
  })
}

async function persistDownloadFailure(requestId: string, error: unknown): Promise<void> {
  try {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await prisma.massDownloadRequest.update({
      where: { id: requestId },
      data: {
        requestStatus: 'ERROR',
        satMessage: errorMsg,
        errorLog: {
          message: errorMsg,
          timestamp: new Date().toISOString(),
        },
      },
    })
    await syncRoutineDownloadLog(requestId, DownloadLogStatus.FAILED)
    console.log(`[Download] Estado de la solicitud ${requestId} actualizado a ERROR.`)
  } catch (dbError) {
    console.error(`[Download] No se pudo actualizar el estado de error en la BD para ${requestId}:`, dbError)
  }
}

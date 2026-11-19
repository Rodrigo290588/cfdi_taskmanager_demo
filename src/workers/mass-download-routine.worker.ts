import crypto from 'node:crypto'
import { Job, Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { createLogger } from '@/lib/logger'
import { validateRoutineStorageOptions } from '@/lib/mass-download-secure-storage'
import {
  getMassDownloadQueue,
  getMassDownloadRoutineQueue,
  MASS_DOWNLOAD_ROUTINE_QUEUE_NAME,
  resolveRedisConnection,
} from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import {
  buildMassDownloadRequestData,
  createOrGetRoutineOccurrence,
  getNextScheduledRun,
  recordRoutineEvent,
  resolveRoutinePeriod,
} from '@/services/mass-download-routine.service'

const RECONCILIATION_INTERVAL_MS = 60_000
const MAX_RECONCILED_ROUTINES = 200

const DownloadLogStatus = {
  FAILED: 'FAILED',
  QUEUED: 'QUEUED',
  REQUESTING: 'REQUESTING',
  SCHEDULED: 'SCHEDULED',
  SKIPPED: 'SKIPPED',
} as const

type DownloadLogStatus = typeof DownloadLogStatus[keyof typeof DownloadLogStatus]

const RequestStatus = {
  COMPLETADO: 'COMPLETADO',
  EN_PROCESO: 'EN_PROCESO',
  ERROR: 'ERROR',
  RECHAZADO: 'RECHAZADO',
  SOLICITADO: 'SOLICITADO',
  TERMINADO: 'TERMINADO',
  VENCIDO: 'VENCIDO',
} as const

type RequestStatus = typeof RequestStatus[keyof typeof RequestStatus]

const RoutineStatus = {
  ACTIVE: 'ACTIVE',
} as const

type RoutineStatus = typeof RoutineStatus[keyof typeof RoutineStatus]

interface RoutineJobData {
  readonly routineId?: string
  readonly downloadLogId?: string
  readonly correlationId?: string
}

interface RoutineRecord {
  readonly id: string
  readonly organizationId: string
  readonly companyId: string
  readonly requestingRfc: string
  readonly requestType: 'CFDI' | 'METADATA'
  readonly retrievalType: 'EMITIDOS' | 'RECIBIDOS'
  readonly filters: Prisma.JsonValue
  readonly periodPreset: 'CURRENT_DAY' | 'PREVIOUS_DAY' | 'CURRENT_WEEK' | 'PREVIOUS_WEEK' | 'LAST_SEVEN_DAYS' | 'CURRENT_MONTH' | 'PREVIOUS_MONTH' | 'CUSTOM'
  readonly customStartDate: Date | null
  readonly customEndDate: Date | null
  readonly timezone: string
  readonly scheduleFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  readonly scheduledHour: number
  readonly scheduledMinute: number
  readonly weekDays: readonly number[]
  readonly monthDays: readonly number[]
  readonly storageOptions: unknown
  readonly deletedAt: Date | null
  readonly nextRunAt: Date | null
  readonly lastRunAt: Date | null
  readonly status: RoutineStatus
}

interface DownloadLogRecord {
  readonly id: string
  readonly routineId: string | null
  readonly correlationId: string
  readonly massDownloadRequestId: string | null
  readonly effectiveStartDate: Date | null
  readonly effectiveEndDate: Date | null
  readonly status: DownloadLogStatus
  readonly routine: RoutineRecord | null
}

interface RoutineRepository {
  findMany(input: Record<string, unknown>): Promise<ReadonlyArray<RoutineRecord>>
  update(input: Record<string, unknown>): Promise<unknown>
}

interface DownloadLogRepository {
  findUnique(input: Record<string, unknown>): Promise<DownloadLogRecord | null>
  update(input: Record<string, unknown>): Promise<DownloadLogRecord>
}

const routineRepository = Reflect.get(prisma, 'downloadRoutine') as unknown as RoutineRepository
const downloadLogRepository = Reflect.get(prisma, 'downloadLog') as unknown as DownloadLogRepository

export async function setupMassDownloadRoutineWorker(): Promise<Worker> {
  const queue = getMassDownloadRoutineQueue()
  await queue.upsertJobScheduler(
    'mass-download-routine-reconciliation',
    { every: RECONCILIATION_INTERVAL_MS },
    {
      name: 'reconcile-routines',
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 10 },
    },
  )

  const worker = new Worker<RoutineJobData>(
    MASS_DOWNLOAD_ROUTINE_QUEUE_NAME,
    async (job) => {
      if (job.name === 'reconcile-routines') {
        await reconcileRoutineSchedules()
        return
      }
      if (job.name === 'run-routine') {
        await executeRoutineOccurrence(job)
      }
    },
    {
      connection: resolveRedisConnection(),
      concurrency: 5,
    },
  )

  worker.on('failed', async (job, error) => {
    if (job?.name !== 'run-routine' || !isFinalAttempt(job)) return
    await markOccurrenceFailed(job.data.downloadLogId, error, job.id)
  })

  await reconcileRoutineSchedules()
  return worker
}

export async function reconcileRoutineSchedules(referenceDate = new Date()): Promise<void> {
  const logger = createLogger({
    service: 'mass-download-routine-worker',
    correlationId: crypto.randomUUID(),
  })

  const unscheduledRoutines = await routineRepository.findMany({
    where: {
      status: RoutineStatus.ACTIVE,
      deletedAt: null,
      nextRunAt: null,
    },
    take: MAX_RECONCILED_ROUTINES,
  })
  for (const routine of unscheduledRoutines) {
    const nextRunAt = getNextScheduledRun(routine, referenceDate)
    await routineRepository.update({
      where: { id: routine.id },
      data: { nextRunAt },
    })
    logger.info('routine.schedule.initialized', { routineId: routine.id, nextRunAt: nextRunAt.toISOString() })
  }

  const dueRoutines = await routineRepository.findMany({
    where: {
      status: RoutineStatus.ACTIVE,
      deletedAt: null,
      nextRunAt: { lte: referenceDate },
    },
    take: MAX_RECONCILED_ROUTINES,
  })
  for (const routine of dueRoutines) {
    await enqueueRoutineOccurrence(routine)
  }
}

async function enqueueRoutineOccurrence(
  routine: RoutineRecord,
): Promise<void> {
  if (!routine.nextRunAt) return

  const scheduledFor = routine.nextRunAt
  const period = resolveRoutinePeriod(routine, scheduledFor)
  const occurrence = await createOrGetRoutineOccurrence(routine, scheduledFor, period)
  const jobId = `routine-run-${routine.id}-${scheduledFor.getTime()}`
  const logger = createLogger({
    service: 'mass-download-routine-worker',
    correlationId: occurrence.correlationId,
    routineId: routine.id,
    runId: occurrence.id,
    jobId,
  })

  try {
    await getMassDownloadRoutineQueue().add(
      'run-routine',
      {
        routineId: routine.id,
        downloadLogId: occurrence.id,
        correlationId: occurrence.correlationId,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 10,
      },
    )
    await routineRepository.update({
      where: { id: routine.id },
      data: { nextRunAt: getNextScheduledRun(routine, new Date(scheduledFor.getTime() + 1)) },
    })
    if (occurrence.status === DownloadLogStatus.SCHEDULED) {
      await downloadLogRepository.update({
        where: { id: occurrence.id },
        data: { status: DownloadLogStatus.QUEUED },
      })
      await recordRoutineEvent(occurrence.id, 'routine.queued', 'info', { scheduledFor: scheduledFor.toISOString() })
    }
    logger.info('routine.execution.queued', { scheduledFor: scheduledFor.toISOString() })
  } catch (error) {
    logger.error('routine.execution.enqueue_failed', error)
    throw error
  }
}

async function executeRoutineOccurrence(job: Job<RoutineJobData>): Promise<void> {
  const downloadLogId = job.data.downloadLogId
  if (!downloadLogId) throw new Error('El trabajo no contiene una ejecución de rutina')

  const occurrence = await downloadLogRepository.findUnique({
    where: { id: downloadLogId },
    include: { routine: true },
  })
  if (!occurrence?.routine) return

  const logger = createLogger({
    service: 'mass-download-routine-worker',
    correlationId: occurrence.correlationId,
    routineId: occurrence.routineId ?? undefined,
    runId: occurrence.id,
    massDownloadRequestId: occurrence.massDownloadRequestId ?? undefined,
    jobId: job.id,
  })

  if (occurrence.massDownloadRequestId) {
    await enqueueExistingMassRequest(occurrence, logger)
    return
  }

  if (occurrence.routine.status !== RoutineStatus.ACTIVE || occurrence.routine.deletedAt) {
    await markOccurrenceSkipped(occurrence.id, 'Rutina pausada o eliminada antes de ejecutarse')
    logger.warn('routine.execution.skipped')
    return
  }

  const isExecutionValid = await validateRoutineExecution(occurrence.routine)
  if (!isExecutionValid) {
    await markOccurrenceFailed(occurrence.id, new Error('La empresa o la credencial FIEL ya no es válida'), job.id)
    return
  }

  if (!occurrence.effectiveStartDate || !occurrence.effectiveEndDate) {
    await markOccurrenceFailed(occurrence.id, new Error('La ejecución no tiene un periodo resuelto'), job.id)
    return
  }

  const request = await prisma.massDownloadRequest.create({
    data: buildMassDownloadRequestData({
      routine: occurrence.routine,
      period: {
        startDate: occurrence.effectiveStartDate,
        endDate: occurrence.effectiveEndDate,
      },
    }),
  })

  await downloadLogRepository.update({
    where: { id: occurrence.id },
    data: {
      massDownloadRequestId: request.id,
      status: DownloadLogStatus.REQUESTING,
      startedAt: new Date(),
    },
  })
  await routineRepository.update({
    where: { id: occurrence.routine.id },
    data: { lastRunAt: new Date() },
  })
  await recordRoutineEvent(occurrence.id, 'routine.mass_request_created', 'info', { requestId: request.id })

  await enqueueExistingMassRequest(
    {
      ...occurrence,
      massDownloadRequestId: request.id,
    },
    logger,
  )
}

async function enqueueExistingMassRequest(
  occurrence: {
    readonly id: string
    readonly correlationId: string
    readonly routineId: string | null
    readonly massDownloadRequestId: string | null
    readonly routine?: { readonly requestingRfc: string } | null
  },
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  if (!occurrence.massDownloadRequestId) return
  const request = await prisma.massDownloadRequest.findUnique({
    where: { id: occurrence.massDownloadRequestId },
    select: { id: true, requestingRfc: true, requestStatus: true },
  })
  if (!request) throw new Error('La solicitud masiva de la rutina no existe')
  if (isTerminalRequestStatus(request.requestStatus)) return

  await getMassDownloadQueue().add(
    'init-mass-download-request',
    {
      requestId: request.id,
      rfc: request.requestingRfc,
      downloadLogId: occurrence.id,
      correlationId: occurrence.correlationId,
    },
    {
      jobId: `mass-req-init-${request.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  )
  await recordRoutineEvent(occurrence.id, 'routine.sat_request_queued', 'info', { requestId: request.id })
  logger.info('routine.sat_request_queued', { requestId: request.id })
}

async function validateRoutineExecution(
  routine: {
    readonly organizationId: string
    readonly companyId: string
    readonly requestingRfc: string
    readonly storageOptions: unknown
  },
): Promise<boolean> {
  const company = await prisma.company.findUnique({
    where: { id: routine.companyId },
    select: { status: true, rfc: true },
  })
  if (company?.status !== 'APPROVED' || company?.rfc !== routine.requestingRfc) return false

  const fiscalEntity = await prisma.fiscalEntity.findFirst({
    where: { organizationId: routine.organizationId, rfc: routine.requestingRfc, isActive: true },
    select: { id: true },
  })
  if (!fiscalEntity) return false

  const credential = await prisma.satCredential.findUnique({
    where: {
      organizationId_rfc: {
        organizationId: routine.organizationId,
        rfc: routine.requestingRfc,
      },
    },
    select: { id: true },
  })
  if (!credential) return false

  try {
    await validateRoutineStorageOptions(routine.storageOptions)
    return true
  } catch {
    return false
  }
}

async function markOccurrenceSkipped(downloadLogId: string, message: string): Promise<void> {
  await downloadLogRepository.update({
    where: { id: downloadLogId },
    data: {
      status: DownloadLogStatus.SKIPPED,
      finishedAt: new Date(),
      errorMessage: message,
    },
  })
  await recordRoutineEvent(downloadLogId, 'routine.skipped', 'warn', { message })
}

async function markOccurrenceFailed(downloadLogId: string | undefined, error: unknown, jobId?: string): Promise<void> {
  if (!downloadLogId) return
  const message = error instanceof Error ? error.message.slice(0, 500) : 'Error al ejecutar la rutina'
  const occurrence = await downloadLogRepository.update({
    where: { id: downloadLogId },
    data: {
      status: DownloadLogStatus.FAILED,
      finishedAt: new Date(),
      errorCode: 'ROUTINE_EXECUTION_FAILED',
      errorMessage: message,
    },
    select: { massDownloadRequestId: true, correlationId: true, routineId: true },
  })
  if (occurrence.massDownloadRequestId) {
    await prisma.massDownloadRequest.update({
      where: { id: occurrence.massDownloadRequestId },
      data: {
        requestStatus: RequestStatus.ERROR,
        satMessage: message,
        errorLog: { code: 'ROUTINE_EXECUTION_FAILED', message },
      },
    })
  }
  await recordRoutineEvent(downloadLogId, 'routine.failed', 'error', { code: 'ROUTINE_EXECUTION_FAILED' })
  createLogger({
    service: 'mass-download-routine-worker',
    correlationId: occurrence.correlationId,
    routineId: occurrence.routineId ?? undefined,
    runId: downloadLogId,
    jobId,
  }).error('routine.execution.failed', error)
}

function isTerminalRequestStatus(status: RequestStatus): boolean {
  return status === RequestStatus.ERROR
    || status === RequestStatus.RECHAZADO
    || status === RequestStatus.VENCIDO
    || status === RequestStatus.TERMINADO
    || status === RequestStatus.COMPLETADO
}

function isFinalAttempt(job: Job<RoutineJobData>): boolean {
  const attempts = job.opts.attempts ?? 1
  return job.attemptsMade >= attempts
}

import { Prisma } from '@prisma/client'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'

const DownloadLogStatus = {
  COMPLETED: 'COMPLETED',
  DOWNLOADING: 'DOWNLOADING',
  FAILED: 'FAILED',
  PROCESSING: 'PROCESSING',
  QUEUED: 'QUEUED',
  REQUESTING: 'REQUESTING',
  SCHEDULED: 'SCHEDULED',
  SKIPPED: 'SKIPPED',
  VERIFYING: 'VERIFYING',
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

const RoutinePeriodPreset = {
  CURRENT_DAY: 'CURRENT_DAY',
  CURRENT_MONTH: 'CURRENT_MONTH',
  CURRENT_WEEK: 'CURRENT_WEEK',
  CUSTOM: 'CUSTOM',
  LAST_SEVEN_DAYS: 'LAST_SEVEN_DAYS',
  PREVIOUS_DAY: 'PREVIOUS_DAY',
  PREVIOUS_MONTH: 'PREVIOUS_MONTH',
  PREVIOUS_WEEK: 'PREVIOUS_WEEK',
} as const

type RoutinePeriodPreset = typeof RoutinePeriodPreset[keyof typeof RoutinePeriodPreset]

const RoutineScheduleFrequency = {
  DAILY: 'DAILY',
  MONTHLY: 'MONTHLY',
  WEEKLY: 'WEEKLY',
} as const

type RoutineScheduleFrequency = typeof RoutineScheduleFrequency[keyof typeof RoutineScheduleFrequency]

interface DownloadLogRecord {
  readonly id: string
  readonly correlationId: string
  readonly status: DownloadLogStatus
}

interface DownloadLogRepository {
  findUnique(input: Record<string, unknown>): Promise<DownloadLogRecord | null>
  create(input: Record<string, unknown>): Promise<DownloadLogRecord>
  update(input: Record<string, unknown>): Promise<unknown>
}

interface DownloadLogEventRepository {
  create(input: Record<string, unknown>): Promise<unknown>
}

const downloadLogRepository = Reflect.get(prisma, 'downloadLog') as unknown as DownloadLogRepository
const downloadLogEventRepository = Reflect.get(prisma, 'downloadLogEvent') as unknown as DownloadLogEventRepository

export interface RoutinePeriod {
  readonly startDate: Date
  readonly endDate: Date
}

interface RoutineScheduleInput {
  readonly scheduleFrequency: RoutineScheduleFrequency
  readonly scheduledHour: number
  readonly scheduledMinute: number
  readonly weekDays: readonly number[]
  readonly monthDays: readonly number[]
  readonly timezone: string
}

interface RoutinePeriodInput {
  readonly periodPreset: RoutinePeriodPreset
  readonly customStartDate: Date | null
  readonly customEndDate: Date | null
  readonly timezone: string
}

interface RoutineFilterValues {
  readonly issuerRfc?: string
  readonly receiverRfc?: string
  readonly voucherType?: string
  readonly status?: string
  readonly thirdPartyRfc?: string
  readonly complement?: string
}

export function resolveRoutinePeriod(input: RoutinePeriodInput, referenceDate = new Date()): RoutinePeriod {
  const currentDate = getZonedCalendarDate(referenceDate, input.timezone)
  const range = resolvePeriodDates(input, currentDate)
  return {
    startDate: zonedDateTimeToUtc(range.start, input.timezone, 0, 0, 0, 0),
    endDate: zonedDateTimeToUtc(range.end, input.timezone, 23, 59, 59, 999),
  }
}

export function getNextScheduledRun(input: RoutineScheduleInput, referenceDate = new Date()): Date {
  const initialDate = getZonedCalendarDate(referenceDate, input.timezone)
  for (let offset = 0; offset <= 370; offset++) {
    const candidateDate = addCalendarDays(initialDate, offset)
    if (!matchesSchedule(input, candidateDate)) continue
    const candidate = zonedDateTimeToUtc(
      candidateDate,
      input.timezone,
      input.scheduledHour,
      input.scheduledMinute,
      0,
      0,
    )
    if (candidate.getTime() > referenceDate.getTime()) return candidate
  }
  throw new Error('No fue posible calcular la siguiente ejecución de la rutina')
}

export function getLastScheduledRun(input: RoutineScheduleInput, referenceDate = new Date()): Date {
  const initialDate = getZonedCalendarDate(referenceDate, input.timezone)
  for (let offset = 0; offset <= 370; offset++) {
    const candidateDate = addCalendarDays(initialDate, -offset)
    if (!matchesSchedule(input, candidateDate)) continue
    const candidate = zonedDateTimeToUtc(
      candidateDate,
      input.timezone,
      input.scheduledHour,
      input.scheduledMinute,
      0,
      0,
    )
    if (candidate.getTime() <= referenceDate.getTime()) return candidate
  }
  throw new Error('No fue posible calcular la última ejecución de la rutina')
}

export function buildMassDownloadRequestData(input: {
  readonly routine: {
    readonly companyId: string
    readonly requestingRfc: string
    readonly requestType: 'CFDI' | 'METADATA'
    readonly retrievalType: 'EMITIDOS' | 'RECIBIDOS'
    readonly filters: Prisma.JsonValue
  }
  readonly period: RoutinePeriod
}) {
  const filters = readRoutineFilters(input.routine.filters)
  const retrievalType = input.routine.retrievalType === 'EMITIDOS' ? 'emitidos' : 'recibidos'
  const isIssued = retrievalType === 'emitidos'

  return {
    companyId: input.routine.companyId,
    requestingRfc: input.routine.requestingRfc,
    issuerRfc: isIssued ? input.routine.requestingRfc : filters.issuerRfc ?? '',
    receiverRfc: isIssued ? filters.receiverRfc : input.routine.requestingRfc,
    startDate: input.period.startDate,
    endDate: input.period.endDate,
    requestType: input.routine.requestType === 'CFDI' ? 'cfdi' : 'metadata',
    retrievalType,
    voucherType: filters.voucherType,
    status: filters.status ?? 'Todos',
    thirdPartyRfc: filters.thirdPartyRfc,
    complement: filters.complement,
    requestStatus: RequestStatus.SOLICITADO,
    satPackageId: '',
    satMessage: 'Solicitud de rutina encolada. El SAT será contactado por el trabajador asíncrono.',
    packageIds: [],
    verificationAttempts: 0,
    nextCheck: new Date(Date.now() + 5 * 60 * 1000),
  }
}

export async function createOrGetRoutineOccurrence(
  routine: {
    readonly id: string
    readonly organizationId: string
    readonly companyId: string
  },
  scheduledFor: Date,
  period: RoutinePeriod,
) {
  const existing = await downloadLogRepository.findUnique({
    where: {
      routineId_scheduledFor: {
        routineId: routine.id,
        scheduledFor,
      },
    },
  })
  if (existing) return existing

  try {
    const occurrence = await downloadLogRepository.create({
      data: {
        routineId: routine.id,
        organizationId: routine.organizationId,
        companyId: routine.companyId,
        correlationId: crypto.randomUUID(),
        scheduledFor,
        effectiveStartDate: period.startDate,
        effectiveEndDate: period.endDate,
        status: DownloadLogStatus.SCHEDULED,
      },
    })
    await recordRoutineEvent(occurrence.id, 'routine.scheduled', 'info', {
      scheduledFor: scheduledFor.toISOString(),
      effectiveStartDate: period.startDate.toISOString(),
      effectiveEndDate: period.endDate.toISOString(),
    })
    return occurrence
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const concurrentOccurrence = await downloadLogRepository.findUnique({
      where: {
        routineId_scheduledFor: {
          routineId: routine.id,
          scheduledFor,
        },
      },
    })
    if (!concurrentOccurrence) throw error
    return concurrentOccurrence
  }
}

export async function syncRoutineDownloadLog(
  massDownloadRequestId: string,
  statusOverride?: DownloadLogStatus,
): Promise<void> {
  const request = await prisma.massDownloadRequest.findUnique({
    where: { id: massDownloadRequestId },
    select: {
      id: true,
      requestStatus: true,
      satPackageId: true,
      packageIds: true,
      satMessage: true,
      errorLog: true,
    },
  })
  if (!request) return

  const downloadLog = getEmbeddedDownloadLog(request)
    ?? await downloadLogRepository.findUnique({ where: { massDownloadRequestId } })
  if (!downloadLog) return

  const status = statusOverride ?? mapRequestStatus(request.requestStatus)
  const packagesFound = Array.isArray(request.packageIds) ? request.packageIds.length : 0
  const isTerminal = status === DownloadLogStatus.COMPLETED || status === DownloadLogStatus.FAILED || status === DownloadLogStatus.SKIPPED

  await downloadLogRepository.update({
    where: { id: downloadLog.id },
    data: {
      status,
      satRequestId: request.satPackageId || null,
      packagesFound,
      ...(status === DownloadLogStatus.REQUESTING ? { startedAt: new Date() } : {}),
      ...(isTerminal ? { finishedAt: new Date() } : {}),
      ...(status === DownloadLogStatus.FAILED
        ? {
            errorCode: request.requestStatus,
            errorMessage: sanitizeBusinessMessage(request.satMessage ?? 'Error en la solicitud SAT'),
            errorDetails: safeErrorDetails(request.errorLog),
          }
        : {}),
    },
  })

  await recordRoutineEvent(downloadLog.id, `sat.${status.toLowerCase()}`, status === DownloadLogStatus.FAILED ? 'error' : 'info', {
    requestStatus: request.requestStatus,
    packagesFound,
    ...(status === DownloadLogStatus.FAILED
      ? {
          errorCode: request.requestStatus,
          errorMessage: sanitizeBusinessMessage(request.satMessage ?? 'Error en la solicitud SAT'),
        }
      : {}),
  })
}

export async function recordRoutineEvent(
  downloadLogId: string,
  eventName: string,
  level: 'info' | 'warn' | 'error',
  details?: Record<string, boolean | number | string>,
): Promise<void> {
  await downloadLogEventRepository.create({
    data: {
      downloadLogId,
      eventName: eventName.slice(0, 120),
      level,
      details: details ?? undefined,
    },
  })
}

function resolvePeriodDates(input: RoutinePeriodInput, currentDate: CalendarDate): { start: CalendarDate; end: CalendarDate } {
  switch (input.periodPreset) {
    case RoutinePeriodPreset.CURRENT_DAY:
      return { start: currentDate, end: currentDate }
    case RoutinePeriodPreset.PREVIOUS_DAY: {
      const previousDay = addCalendarDays(currentDate, -1)
      return { start: previousDay, end: previousDay }
    }
    case RoutinePeriodPreset.CURRENT_WEEK:
      return { start: startOfWeek(currentDate), end: addCalendarDays(startOfWeek(currentDate), 6) }
    case RoutinePeriodPreset.PREVIOUS_WEEK: {
      const currentWeekStart = startOfWeek(currentDate)
      const previousWeekStart = addCalendarDays(currentWeekStart, -7)
      return { start: previousWeekStart, end: addCalendarDays(previousWeekStart, 6) }
    }
    case RoutinePeriodPreset.LAST_SEVEN_DAYS:
      return { start: addCalendarDays(currentDate, -6), end: currentDate }
    case RoutinePeriodPreset.CURRENT_MONTH:
      return {
        start: { year: currentDate.year, month: currentDate.month, day: 1 },
        end: { year: currentDate.year, month: currentDate.month, day: daysInMonth(currentDate.year, currentDate.month) },
      }
    case RoutinePeriodPreset.PREVIOUS_MONTH: {
      const previousMonth = addMonths({ year: currentDate.year, month: currentDate.month, day: 1 }, -1)
      return {
        start: previousMonth,
        end: { year: previousMonth.year, month: previousMonth.month, day: daysInMonth(previousMonth.year, previousMonth.month) },
      }
    }
    case RoutinePeriodPreset.CUSTOM:
      if (!input.customStartDate || !input.customEndDate) {
        throw new Error('El periodo personalizado requiere ambas fechas')
      }
      return {
        start: dateToCalendarDate(input.customStartDate),
        end: dateToCalendarDate(input.customEndDate),
      }
  }
}

function mapRequestStatus(status: RequestStatus): DownloadLogStatus {
  if (status === RequestStatus.ERROR || status === RequestStatus.RECHAZADO || status === RequestStatus.VENCIDO) {
    return DownloadLogStatus.FAILED
  }
  if (status === RequestStatus.TERMINADO || status === RequestStatus.COMPLETADO) {
    return DownloadLogStatus.DOWNLOADING
  }
  if (status === RequestStatus.EN_PROCESO) {
    return DownloadLogStatus.VERIFYING
  }
  return DownloadLogStatus.QUEUED
}

function readRoutineFilters(value: Prisma.JsonValue): RoutineFilterValues {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {}
  const raw = value as Record<string, Prisma.JsonValue>
  return {
    issuerRfc: readString(raw.issuerRfc),
    receiverRfc: readString(raw.receiverRfc),
    voucherType: readString(raw.voucherType),
    status: readString(raw.status),
    thirdPartyRfc: readString(raw.thirdPartyRfc),
    complement: readString(raw.complement),
  }
}

function getEmbeddedDownloadLog(value: unknown): DownloadLogRecord | null {
  if (!value || typeof value !== 'object' || !('downloadLog' in value)) return null
  const downloadLog = value.downloadLog
  if (!downloadLog || typeof downloadLog !== 'object' || !('id' in downloadLog) || typeof downloadLog.id !== 'string') {
    return null
  }
  return { id: downloadLog.id, correlationId: '', status: DownloadLogStatus.SCHEDULED }
}

function readString(value: Prisma.JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function safeErrorDetails(value: Prisma.JsonValue | null): Prisma.InputJsonValue | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined
  const details: Record<string, string> = {}
  for (const [key, currentValue] of Object.entries(value as Record<string, Prisma.JsonValue>)) {
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('soap') || key.toLowerCase().includes('xml')) continue
    if (typeof currentValue === 'string') details[key] = sanitizeBusinessMessage(currentValue)
  }
  return details
}

function sanitizeBusinessMessage(value: string): string {
  return value
    .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}\b/gi, '[RFC-REDACTED]')
    .slice(0, 500)
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

function getZonedCalendarDate(referenceDate: Date, timezone: string): CalendarDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(referenceDate)
  return {
    year: getNumericPart(parts, 'year'),
    month: getNumericPart(parts, 'month'),
    day: getNumericPart(parts, 'day'),
  }
}

function zonedDateTimeToUtc(
  date: CalendarDate,
  timezone: string,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  const provisionalUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second, millisecond)
  const firstOffset = getTimezoneOffsetMilliseconds(new Date(provisionalUtc), timezone)
  const adjusted = new Date(provisionalUtc - firstOffset)
  const finalOffset = getTimezoneOffsetMilliseconds(adjusted, timezone)
  return finalOffset === firstOffset ? adjusted : new Date(provisionalUtc - finalOffset)
}

function getTimezoneOffsetMilliseconds(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const localTimestamp = Date.UTC(
    getNumericPart(parts, 'year'),
    getNumericPart(parts, 'month') - 1,
    getNumericPart(parts, 'day'),
    getNumericPart(parts, 'hour'),
    getNumericPart(parts, 'minute'),
    getNumericPart(parts, 'second'),
  ) + date.getUTCMilliseconds()
  return localTimestamp - date.getTime()
}

function getNumericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value
  return Number(value)
}

function matchesSchedule(input: RoutineScheduleInput, date: CalendarDate): boolean {
  if (input.scheduleFrequency === RoutineScheduleFrequency.DAILY) return true
  if (input.scheduleFrequency === RoutineScheduleFrequency.WEEKLY) {
    return input.weekDays.includes(new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay())
  }
  return input.monthDays.includes(date.day)
}

function startOfWeek(date: CalendarDate): CalendarDate {
  const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  return addCalendarDays(date, mondayOffset)
}

function addCalendarDays(date: CalendarDate, amount: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + amount))
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
}

function addMonths(date: CalendarDate, amount: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1 + amount, 1))
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: 1 }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dateToCalendarDate(value: Date): CalendarDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}

import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import {
  loadRoutineActor,
  resolveRoutineScope,
  RoutineAccessError,
} from '@/lib/mass-download-routine-access'
import { createLogger } from '@/lib/logger'
import {
  SecureStorageError,
  validateRoutineStorageOptions,
} from '@/lib/mass-download-secure-storage'
import { getRealClientIp, massDownloadJsonResponse, safeErrSummary } from '@/lib/mass-downloads-route-utils'
import { prisma } from '@/lib/prisma'
import {
  CreateRoutineSchema,
  ListRoutinesQuerySchema,
} from '@/lib/validations/mass-download-routine.schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_ROUTINE_BODY_BYTES = 16 * 1024

interface CreatedRoutineRecord {
  readonly id: string
  readonly [key: string]: unknown
}

interface RoutineRepository {
  findMany(input: Record<string, unknown>): Promise<ReadonlyArray<unknown>>
  create(input: Record<string, unknown>): Promise<CreatedRoutineRecord>
}

const routineRepository = Reflect.get(prisma, 'downloadRoutine') as unknown as RoutineRepository

export async function GET(request: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const searchParams = new URL(request.url).searchParams
    const parsedQuery = ListRoutinesQuerySchema.safeParse({
      companyId: searchParams.get('companyId') ?? undefined,
      includeDeleted: searchParams.get('includeDeleted') ?? undefined,
    })
    if (!parsedQuery.success) {
      return invalidRequestResponse(reqId, parsedQuery.error.issues)
    }

    const actor = await loadRoutineActor(session.user.id)
    const scope = await resolveRoutineScope(actor, parsedQuery.data.companyId, true)
    const routines = await routineRepository.findMany({
      where: {
        organizationId: scope.organizationId,
        companyId: scope.company.id,
        ...(parsedQuery.data.includeDeleted === 'true' ? {} : { deletedAt: null }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })

    return massDownloadJsonResponse({ data: routines, reqId }, { headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    return routineErrorResponse(error, reqId, 'Error al consultar rutinas')
  }
}

export async function POST(request: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }
    if (isRequestTooLarge(request)) {
      return massDownloadJsonResponse({ error: 'Solicitud demasiado grande', reqId }, { status: 413 })
    }

    const body = await parseJsonBody(request, reqId)
    if ('response' in body) return body.response

    const parsedBody = CreateRoutineSchema.safeParse(body.value)
    if (!parsedBody.success) {
      return invalidRequestResponse(reqId, parsedBody.error.issues)
    }

    const actor = await loadRoutineActor(session.user.id)
    const scope = await resolveRoutineScope(actor, parsedBody.data.companyId, true)
    await validateRoutineStorageOptions(toJsonObject(parsedBody.data.storageOptions))
    const routine = await routineRepository.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.company.id,
        name: parsedBody.data.name,
        requestingRfc: scope.company.rfc,
        requestType: parsedBody.data.requestType,
        retrievalType: parsedBody.data.retrievalType,
        filters: toJsonObject(parsedBody.data.filters),
        periodPreset: parsedBody.data.periodPreset,
        customStartDate: parsedBody.data.customStartDate ? toUtcDate(parsedBody.data.customStartDate) : null,
        customEndDate: parsedBody.data.customEndDate ? toUtcDate(parsedBody.data.customEndDate, true) : null,
        timezone: parsedBody.data.schedule.timezone,
        scheduleFrequency: parsedBody.data.schedule.frequency,
        scheduledHour: parsedBody.data.schedule.scheduledHour,
        scheduledMinute: parsedBody.data.schedule.scheduledMinute,
        weekDays: parsedBody.data.schedule.weekDays,
        monthDays: parsedBody.data.schedule.monthDays,
        storageOptions: toJsonObject(parsedBody.data.storageOptions),
        createdByUserId: actor.id,
      },
    })

    await writeRoutineAudit({
      action: 'CREATE',
      routineId: routine.id,
      companyId: scope.company.id,
      userId: actor.id,
      userEmail: actor.email,
      request,
      description: 'Rutina de descarga masiva creada',
    })
    createLogger({
      service: 'mass-download-routines-route',
      correlationId: reqId,
      routineId: routine.id,
    }).info('routine.created', { companyId: scope.company.id })

    return massDownloadJsonResponse({ data: routine, reqId }, { status: 201, headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    return routineErrorResponse(error, reqId, 'Error al crear rutina')
  }
}

function isRequestTooLarge(request: Request): boolean {
  const contentLength = request.headers.get('content-length')
  if (!contentLength) return false
  const size = Number(contentLength)
  return !Number.isFinite(size) || size > MAX_ROUTINE_BODY_BYTES
}

async function parseJsonBody(
  request: Request,
  reqId: string,
): Promise<{ value: unknown } | { response: Response }> {
  try {
    return { value: await request.json() }
  } catch {
    return {
      response: massDownloadJsonResponse(
        { error: 'Cuerpo JSON inválido', reqId },
        { status: 400 },
      ),
    }
  }
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue> = {}
  for (const [key, currentValue] of Object.entries(value)) {
    if (typeof currentValue === 'string' || typeof currentValue === 'number' || typeof currentValue === 'boolean') {
      result[key] = currentValue
    }
  }
  return result
}

function toUtcDate(value: string, endOfDay = false): Date {
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'
  return new Date(`${value}${suffix}`)
}

function invalidRequestResponse(
  reqId: string,
  issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string }[],
) {
  return massDownloadJsonResponse(
    {
      error: 'Parámetros de rutina inválidos',
      reqId,
      issues: issues.map(({ path, code }) => ({ path: path.join('.'), code })),
    },
    { status: 400 },
  )
}

async function writeRoutineAudit(input: {
  readonly action: 'CREATE'
  readonly routineId: string
  readonly companyId: string
  readonly userId: string
  readonly userEmail: string
  readonly request: Request
  readonly description: string
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tableName: 'download_routines',
        recordId: input.routineId,
        action: input.action,
        newValues: { routineId: input.routineId, companyId: input.companyId },
        userId: input.userId,
        userEmail: input.userEmail,
        ipAddress: getRealClientIp(input.request.headers),
        userAgent: input.request.headers.get('user-agent') ?? undefined,
        companyId: input.companyId,
        description: input.description,
      },
    })
  } catch (auditError) {
    const summary = safeErrSummary(auditError)
    console.warn('[mass-download-routine audit failed]', { routineId: input.routineId, summary })
  }
}

function routineErrorResponse(error: unknown, reqId: string, fallbackMessage: string) {
  if (error instanceof RoutineAccessError) {
    return massDownloadJsonResponse({ error: error.message, reqId }, { status: error.status })
  }
  if (error instanceof SecureStorageError) {
    return massDownloadJsonResponse({ error: error.message, reqId }, { status: 422 })
  }

  const summary = safeErrSummary(error)
  createLogger({
    service: 'mass-download-routines-route',
    correlationId: reqId,
  }).error('routine.route_failed', error)
  console.error('[mass-download-routine route failed]', { reqId, summary })
  return massDownloadJsonResponse({ error: fallbackMessage, reqId }, { status: 500 })
}

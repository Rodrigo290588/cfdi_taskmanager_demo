import crypto from 'node:crypto'
import { AuditAction, Prisma } from '@prisma/client'
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
  RoutineActionSchema,
  RoutineActionInput,
  RoutineIdSchema,
} from '@/lib/validations/mass-download-routine.schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_ROUTINE_BODY_BYTES = 16 * 1024

interface RoutineRecord {
  readonly id: string
  readonly status: string
  readonly companyId: string
  readonly organizationId: string
}

interface RoutineRepository {
  findUnique(input: { readonly where: { readonly id: string } }): Promise<RoutineRecord | null>
  update(input: { readonly where: { readonly id: string }; readonly data: Record<string, unknown> }): Promise<unknown>
}

const routineRepository = Reflect.get(prisma, 'downloadRoutine') as unknown as RoutineRepository

type RouteContext = Readonly<{
  params: Promise<{
    routineId: string
  }>
}>

export async function GET(_request: Request, context: RouteContext) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const routineId = await parseRoutineId(context, reqId)
    if ('response' in routineId) return routineId.response

    const actor = await loadRoutineActor(session.user.id)
    const routine = await findAccessibleRoutine(actor, routineId.value, true)
    return massDownloadJsonResponse({ data: routine, reqId }, { headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    return routineErrorResponse(error, reqId, 'Error al consultar rutina')
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }
    if (isRequestTooLarge(request)) {
      return massDownloadJsonResponse({ error: 'Solicitud demasiado grande', reqId }, { status: 413 })
    }

    const routineId = await parseRoutineId(context, reqId)
    if ('response' in routineId) return routineId.response

    const body = await parseJsonBody(request, reqId)
    if ('response' in body) return body.response

    const parsedBody = RoutineActionSchema.safeParse(body.value)
    if (!parsedBody.success) {
      return invalidRequestResponse(reqId, parsedBody.error.issues)
    }

    const actor = await loadRoutineActor(session.user.id)
    const routine = await findAccessibleRoutine(actor, routineId.value, true)
    if (parsedBody.data.action === 'update') {
      await validateRoutineStorageOptions(toJsonObject(parsedBody.data.routine.storageOptions))
    }
    const updatedRoutine = await applyRoutineAction(routine.id, parsedBody.data)

    await writeRoutineAudit({
      action: AuditAction.UPDATE,
      routineId: routine.id,
      companyId: routine.companyId,
      userId: actor.id,
      userEmail: actor.email,
      request,
      description: routineActionDescription(parsedBody.data.action),
    })
    createLogger({
      service: 'mass-download-routines-route',
      correlationId: reqId,
      routineId: routine.id,
    }).info('routine.updated', { action: parsedBody.data.action })

    return massDownloadJsonResponse({ data: updatedRoutine, reqId }, { headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    return routineErrorResponse(error, reqId, 'Error al actualizar rutina')
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const routineId = await parseRoutineId(context, reqId)
    if ('response' in routineId) return routineId.response

    const actor = await loadRoutineActor(session.user.id)
    const routine = await findAccessibleRoutine(actor, routineId.value, true)
    const deletedRoutine = await routineRepository.update({
      where: { id: routine.id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        nextRunAt: null,
      },
    })

    await writeRoutineAudit({
      action: AuditAction.DELETE,
      routineId: routine.id,
      companyId: routine.companyId,
      userId: actor.id,
      userEmail: actor.email,
      request,
      description: 'Rutina de descarga masiva eliminada',
    })
    createLogger({
      service: 'mass-download-routines-route',
      correlationId: reqId,
      routineId: routine.id,
    }).info('routine.deleted')

    return massDownloadJsonResponse({ data: deletedRoutine, reqId }, { headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    return routineErrorResponse(error, reqId, 'Error al eliminar rutina')
  }
}

async function findAccessibleRoutine(
  actor: Awaited<ReturnType<typeof loadRoutineActor>>,
  routineId: string,
  requireCredential: boolean,
) {
  const routine = await routineRepository.findUnique({
    where: { id: routineId },
  })
  if (!routine || routine.status === 'DELETED') {
    throw new RoutineAccessError('Rutina no encontrada', 404)
  }

  const scope = await resolveRoutineScope(actor, routine.companyId, requireCredential)
  if (routine.organizationId !== scope.organizationId || routine.companyId !== scope.company.id) {
    throw new RoutineAccessError('Rutina no encontrada', 404)
  }
  return routine
}

async function applyRoutineAction(
  routineId: string,
  action: RoutineActionInput,
) {
  if (action.action === 'pause') {
    return routineRepository.update({
      where: { id: routineId },
      data: { status: 'PAUSED', nextRunAt: null },
    })
  }
  if (action.action === 'resume') {
    return routineRepository.update({
      where: { id: routineId },
      data: { status: 'ACTIVE', nextRunAt: null },
    })
  }

  return routineRepository.update({
    where: { id: routineId },
    data: {
      name: action.routine.name,
      requestType: action.routine.requestType,
      retrievalType: action.routine.retrievalType,
      filters: toJsonObject(action.routine.filters),
      periodPreset: action.routine.periodPreset,
      customStartDate: action.routine.customStartDate ? toUtcDate(action.routine.customStartDate) : null,
      customEndDate: action.routine.customEndDate ? toUtcDate(action.routine.customEndDate, true) : null,
      timezone: action.routine.schedule.timezone,
      scheduleFrequency: action.routine.schedule.frequency,
      scheduledHour: action.routine.schedule.scheduledHour,
      scheduledMinute: action.routine.schedule.scheduledMinute,
      weekDays: action.routine.schedule.weekDays,
      monthDays: action.routine.schedule.monthDays,
      storageOptions: toJsonObject(action.routine.storageOptions),
      nextRunAt: null,
    },
  })
}

function routineActionDescription(action: 'update' | 'pause' | 'resume'): string {
  if (action === 'pause') return 'Rutina de descarga masiva pausada'
  if (action === 'resume') return 'Rutina de descarga masiva reactivada'
  return 'Rutina de descarga masiva actualizada'
}

async function parseRoutineId(
  context: RouteContext,
  reqId: string,
): Promise<{ value: string } | { response: Response }> {
  const { routineId } = await context.params
  const parsed = RoutineIdSchema.safeParse(routineId)
  if (parsed.success) return { value: parsed.data }
  return {
    response: massDownloadJsonResponse({ error: 'Identificador de rutina inválido', reqId }, { status: 400 }),
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

async function writeRoutineAudit(input: {
  readonly action: AuditAction
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

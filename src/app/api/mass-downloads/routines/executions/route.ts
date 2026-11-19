import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import {
  loadRoutineActor,
  resolveRoutineScope,
  RoutineAccessError,
} from '@/lib/mass-download-routine-access'
import { createLogger } from '@/lib/logger'
import { massDownloadJsonResponse, safeErrSummary } from '@/lib/mass-downloads-route-utils'
import { prisma } from '@/lib/prisma'
import { ListRoutineExecutionsQuerySchema } from '@/lib/validations/mass-download-routine.schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DownloadLogRepository {
  findMany(input: Record<string, unknown>): Promise<ReadonlyArray<unknown>>
}

const downloadLogRepository = Reflect.get(prisma, 'downloadLog') as unknown as DownloadLogRepository

export async function GET(request: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const searchParams = new URL(request.url).searchParams
    const parsedQuery = ListRoutineExecutionsQuerySchema.safeParse({
      companyId: searchParams.get('companyId') ?? undefined,
      routineId: searchParams.get('routineId') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    })
    if (!parsedQuery.success) {
      return massDownloadJsonResponse({ error: 'Parámetros de ejecución inválidos', reqId }, { status: 400 })
    }

    const actor = await loadRoutineActor(session.user.id)
    const scope = await resolveRoutineScope(actor, parsedQuery.data.companyId, true)
    const executions = await downloadLogRepository.findMany({
      where: {
        organizationId: scope.organizationId,
        companyId: scope.company.id,
        ...(parsedQuery.data.routineId ? { routineId: parsedQuery.data.routineId } : {}),
      },
      select: {
        id: true,
        routineId: true,
        correlationId: true,
        scheduledFor: true,
        effectiveStartDate: true,
        effectiveEndDate: true,
        status: true,
        satRequestId: true,
        startedAt: true,
        finishedAt: true,
        packagesFound: true,
        retryAttempt: true,
        errorCode: true,
        errorMessage: true,
        errorDetails: true,
        routine: {
          select: {
            name: true,
            requestType: true,
            retrievalType: true,
          },
        },
        events: {
          select: {
            id: true,
            eventName: true,
            level: true,
            details: true,
            occurredAt: true,
          },
          orderBy: { occurredAt: 'desc' },
          take: 50,
        },
      },
      orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
      take: parsedQuery.data.limit,
    })

    return massDownloadJsonResponse({ data: executions, reqId }, { headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    if (error instanceof RoutineAccessError) {
      return massDownloadJsonResponse({ error: error.message, reqId }, { status: error.status })
    }

    createLogger({
      service: 'mass-download-routine-executions-route',
      correlationId: reqId,
    }).error('routine.executions.list_failed', error)
    console.error('[mass-download-routine-executions route failed]', {
      reqId,
      summary: safeErrSummary(error),
    })
    return massDownloadJsonResponse({ error: 'Error al consultar ejecuciones', reqId }, { status: 500 })
  }
}

import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logger'
import {
  listConfiguredStorageDestinations,
  SecureStorageError,
} from '@/lib/mass-download-secure-storage'
import {
  loadRoutineActor,
  resolveRoutineScope,
  RoutineAccessError,
} from '@/lib/mass-download-routine-access'
import { massDownloadJsonResponse, safeErrSummary } from '@/lib/mass-downloads-route-utils'
import { CompanyIdSchema } from '@/lib/validations/mass-download-routine.schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const companyId = new URL(request.url).searchParams.get('companyId')
    const parsedCompanyId = CompanyIdSchema.safeParse(companyId)
    if (!parsedCompanyId.success) {
      return massDownloadJsonResponse({ error: 'Empresa inválida', reqId }, { status: 400 })
    }

    const actor = await loadRoutineActor(session.user.id)
    await resolveRoutineScope(actor, parsedCompanyId.data, true)
    const destinations = listConfiguredStorageDestinations()
    return massDownloadJsonResponse({ data: destinations, reqId }, { headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    if (error instanceof RoutineAccessError) {
      return massDownloadJsonResponse({ error: error.message, reqId }, { status: error.status })
    }
    if (error instanceof SecureStorageError) {
      return massDownloadJsonResponse({ error: error.message, reqId }, { status: 422 })
    }

    createLogger({
      service: 'mass-download-storage-destinations-route',
      correlationId: reqId,
    }).error('storage.destinations.list_failed', error)
    console.error('[mass-download-storage-destinations route failed]', {
      reqId,
      summary: safeErrSummary(error),
    })
    return massDownloadJsonResponse({ error: 'Error al consultar destinos de almacenamiento', reqId }, { status: 500 })
  }
}

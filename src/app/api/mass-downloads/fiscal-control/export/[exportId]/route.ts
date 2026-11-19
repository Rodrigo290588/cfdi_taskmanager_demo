import { auth } from '@/lib/auth'
import { getFiscalControlExportQueue } from '@/lib/queue'
import { massDownloadJsonResponse } from '@/lib/mass-downloads-route-utils'
import type { FiscalControlExportJobData } from '@/workers/fiscal-control-export.worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const reqId = crypto.randomUUID()
  const session = await auth()
  if (!session?.user?.id) return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
  const { exportId } = await params
  const job = await getFiscalControlExportQueue().getJob(exportId)
  const data = job?.data as FiscalControlExportJobData | undefined
  if (!job || !data || data.requestedByUserId !== session.user.id) {
    return massDownloadJsonResponse({ error: 'Exportación no encontrada', reqId }, { status: 404 })
  }
  return massDownloadJsonResponse({
    reqId, exportId, status: await job.getState(), progress: job.progress,
    downloadUrl: (await job.getState()) === 'completed'
      ? `/api/mass-downloads/fiscal-control/export/${exportId}/download`
      : null,
  })
}

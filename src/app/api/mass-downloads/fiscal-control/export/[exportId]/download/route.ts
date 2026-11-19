import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { readDecryptedFiscalExport } from '@/lib/fiscal-control-export-storage'
import { getFiscalControlExportQueue } from '@/lib/queue'
import { buildRfc6266ContentDisposition, massDownloadJsonResponse, SECURITY_HEADERS } from '@/lib/mass-downloads-route-utils'
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
  if (!job || !data || data.requestedByUserId !== session.user.id || (await job.getState()) !== 'completed') {
    return massDownloadJsonResponse({ error: 'Archivo no disponible', reqId }, { status: 404 })
  }
  try {
    const body = await readDecryptedFiscalExport(exportId)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': buildRfc6266ContentDisposition(`panel_fiscal_${exportId}.csv`, 'attachment'),
        'X-Request-Id': reqId,
      },
    })
  } catch {
    return massDownloadJsonResponse({ error: 'Archivo expirado o no disponible', reqId }, { status: 404 })
  }
}

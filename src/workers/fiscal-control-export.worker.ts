import { Worker, type Job } from 'bullmq'

import { iterateFiscalControlCsv } from '@/lib/fiscal-control-export'
import { writeEncryptedFiscalExport } from '@/lib/fiscal-control-export-storage'
import {
  FISCAL_CONTROL_EXPORT_QUEUE_NAME,
  resolveRedisConnection,
} from '@/lib/queue'
import type { FiscalControlReconciliationFilters } from '@/lib/fiscal-control-conciliation-types'

export type FiscalControlExportJobData = Readonly<{
  exportId: string
  requestedByUserId: string
  organizationId: string
  filters: FiscalControlReconciliationFilters
}>

async function processFiscalControlExport(job: Job<FiscalControlExportJobData>) {
  await job.updateProgress({ stage: 'GENERATING', processedRows: 0 })
  const artifact = await writeEncryptedFiscalExport(
    job.data.exportId,
    iterateFiscalControlCsv(job.data.filters),
  )
  await job.updateProgress({
    stage: 'COMPLETED',
    expiresAt: artifact.expiresAt.toISOString(),
  })
  return {
    exportId: job.data.exportId,
    expiresAt: artifact.expiresAt.toISOString(),
  }
}

export function setupFiscalControlExportWorker() {
  return new Worker<FiscalControlExportJobData>(
    FISCAL_CONTROL_EXPORT_QUEUE_NAME,
    processFiscalControlExport,
    { connection: resolveRedisConnection(), concurrency: 1 },
  )
}

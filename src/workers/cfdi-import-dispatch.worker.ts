import { Job, Worker } from 'bullmq'
import { CFDI_IMPORT_DISPATCH_QUEUE_NAME, resolveRedisConnection } from '@/lib/queue'
import { dispatchImportRun } from '@/lib/external-cfdi-import-processing'

export function setupCfdiImportDispatchWorker() {
  const worker = new Worker(CFDI_IMPORT_DISPATCH_QUEUE_NAME, async (job: Job) => {
    const { importRunId } = job.data as { importRunId?: string }

    if (!importRunId) {
      throw new Error('Job de dispatch sin importRunId')
    }

    return dispatchImportRun(importRunId)
  }, {
    connection: resolveRedisConnection(),
    concurrency: 2
  })

  worker.on('failed', (job, err) => {
    console.error(`[CFDI Import Dispatch] Job ${job?.id} failed:`, err)
  })

  return worker
}

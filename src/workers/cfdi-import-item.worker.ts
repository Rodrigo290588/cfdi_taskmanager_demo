import { Job, Worker } from 'bullmq'
import { CFDI_IMPORT_ITEM_QUEUE_NAME, resolveRedisConnection } from '@/lib/queue'
import { classifyImportRunItem } from '@/lib/external-cfdi-import-processing'

export function setupCfdiImportItemWorker() {
  const worker = new Worker(CFDI_IMPORT_ITEM_QUEUE_NAME, async (job: Job) => {
    const { itemId } = job.data as { itemId?: string }

    if (!itemId) {
      throw new Error('Job de clasificación sin itemId')
    }

    return classifyImportRunItem(itemId)
  }, {
    connection: resolveRedisConnection(),
    concurrency: 5
  })

  worker.on('failed', (job, err) => {
    console.error(`[CFDI Import Item] Job ${job?.id} failed:`, err)
  })

  return worker
}

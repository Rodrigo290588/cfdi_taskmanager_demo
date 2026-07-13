import { Worker } from 'bullmq'
import {
  providerPostLoadCancellationAlertsQueue,
  PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME
} from '@/lib/queue'
import { syncProviderPostLoadCancellationAlerts } from '@/lib/provider-post-load-cancellation-alerts'

const PROVIDER_POST_LOAD_CANCELLATION_ALERTS_JOB_NAME = 'provider-post-load-cancellation-alerts-scan'
const PROVIDER_POST_LOAD_CANCELLATION_ALERTS_JOB_ID = 'provider-post-load-cancellation-alerts-scan'
const PROVIDER_POST_LOAD_CANCELLATION_ALERTS_CRON = '0 0 * * *'
const PROVIDER_POST_LOAD_CANCELLATION_ALERTS_TIMEZONE = 'America/Mexico_City'

export async function ensureProviderPostLoadCancellationAlertsRoutineScheduled() {
  await providerPostLoadCancellationAlertsQueue.add(
    PROVIDER_POST_LOAD_CANCELLATION_ALERTS_JOB_NAME,
    {},
    {
      jobId: PROVIDER_POST_LOAD_CANCELLATION_ALERTS_JOB_ID,
      repeat: {
        pattern: PROVIDER_POST_LOAD_CANCELLATION_ALERTS_CRON,
        tz: PROVIDER_POST_LOAD_CANCELLATION_ALERTS_TIMEZONE
      },
      removeOnComplete: 10,
      removeOnFail: 20
    }
  )
}

export function setupProviderPostLoadCancellationAlertsWorker() {
  const worker = new Worker(PROVIDER_POST_LOAD_CANCELLATION_ALERTS_QUEUE_NAME, async () => {
    const result = await syncProviderPostLoadCancellationAlerts()

    console.log(
      `[ProviderPostLoadCancellationAlerts] scanned=${result.scannedCandidates} checked=${result.checkedCandidates} cancelled=${result.detectedCancelled} updated=${result.updatedStatuses} errors=${result.errors}`
    )
  }, {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    concurrency: 1
  })

  worker.on('failed', (job, err) => {
    console.error(`[ProviderPostLoadCancellationAlerts] Job ${job?.id} failed:`, err)
  })

  ensureProviderPostLoadCancellationAlertsRoutineScheduled().catch(error => {
    console.error('[ProviderPostLoadCancellationAlerts] No fue posible programar la rutina periódica:', error)
  })

  return worker
}

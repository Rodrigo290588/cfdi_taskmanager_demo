import { Worker } from 'bullmq'
import { getSat69BBlacklistQueue, SAT_69B_BLACKLIST_QUEUE_NAME, resolveRedisConnection } from '@/lib/queue'
import { syncSat69BBlacklist } from '@/lib/sat-69b-blacklist'

const SAT_69B_BLACKLIST_JOB_NAME = 'sat-69b-blacklist-sync'
const SAT_69B_BLACKLIST_JOB_ID = 'sat-69b-blacklist-sync'
const SAT_69B_BLACKLIST_CRON = '30 0 * * 1'
const SAT_69B_BLACKLIST_TIMEZONE = 'America/Mexico_City'

export async function ensureSat69BBlacklistRoutineScheduled() {
  await getSat69BBlacklistQueue().add(
    SAT_69B_BLACKLIST_JOB_NAME,
    {},
    {
      jobId: SAT_69B_BLACKLIST_JOB_ID,
      repeat: {
        pattern: SAT_69B_BLACKLIST_CRON,
        tz: SAT_69B_BLACKLIST_TIMEZONE
      },
      removeOnComplete: 10,
      removeOnFail: 20
    }
  )
}

export function setupSat69BBlacklistWorker() {
  const worker = new Worker(SAT_69B_BLACKLIST_QUEUE_NAME, async () => {
    const result = await syncSat69BBlacklist()

    console.log(
      `[Sat69BBlacklist] skipped=${result.skipped} processed=${result.processedLines} parsed=${result.parsedEntries} activeRisk=${result.activeRiskEntries} removed=${result.removedStaleEntries}`
    )
  }, {
    connection: resolveRedisConnection(),
    concurrency: 1
  })

  worker.on('failed', (job, err) => {
    console.error(`[Sat69BBlacklist] Job ${job?.id} failed:`, err)
  })

  ensureSat69BBlacklistRoutineScheduled().catch(error => {
    console.error('[Sat69BBlacklist] No fue posible programar la rutina periódica:', error)
  })

  return worker
}

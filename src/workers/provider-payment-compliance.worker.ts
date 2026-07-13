import { Worker } from 'bullmq'
import { providerPaymentComplianceQueue, PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME } from '@/lib/queue'
import { syncProviderPaymentComplianceBlocks } from '@/lib/provider-payment-compliance'

const PROVIDER_PAYMENT_COMPLIANCE_JOB_NAME = 'provider-payment-compliance-scan'
const PROVIDER_PAYMENT_COMPLIANCE_JOB_ID = 'provider-payment-compliance-scan'
const PROVIDER_PAYMENT_COMPLIANCE_CRON = '0 0 * * *'
const PROVIDER_PAYMENT_COMPLIANCE_TIMEZONE = 'America/Mexico_City'

export async function ensureProviderPaymentComplianceRoutineScheduled() {
  await providerPaymentComplianceQueue.add(
    PROVIDER_PAYMENT_COMPLIANCE_JOB_NAME,
    {},
    {
      jobId: PROVIDER_PAYMENT_COMPLIANCE_JOB_ID,
      repeat: {
        pattern: PROVIDER_PAYMENT_COMPLIANCE_CRON,
        tz: PROVIDER_PAYMENT_COMPLIANCE_TIMEZONE
      },
      removeOnComplete: 10,
      removeOnFail: 20
    }
  )
}

export function setupProviderPaymentComplianceWorker() {
  const worker = new Worker(PROVIDER_PAYMENT_COMPLIANCE_QUEUE_NAME, async () => {
    const result = await syncProviderPaymentComplianceBlocks()

    console.log(
      `[ProviderPaymentCompliance] scan=${result.scannedCandidates} overdue=${result.overdueInvoices} blocked=${result.blockedMembers} unblocked=${result.unblockedMembers}`
    )
  }, {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    concurrency: 1
  })

  worker.on('failed', (job, err) => {
    console.error(`[ProviderPaymentCompliance] Job ${job?.id} failed:`, err)
  })

  ensureProviderPaymentComplianceRoutineScheduled().catch(error => {
    console.error('[ProviderPaymentCompliance] No fue posible programar la rutina periódica:', error)
  })

  return worker
}

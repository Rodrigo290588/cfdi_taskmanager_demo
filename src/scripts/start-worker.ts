import { loadEnvConfig } from '@next/env'
import { setupVerificationWorker } from '../workers/verification.worker'
import { setupDownloadWorker } from '../workers/download.worker'
import { setupProviderPaymentComplianceWorker } from '../workers/provider-payment-compliance.worker'
import { setupProviderPostLoadCancellationAlertsWorker } from '../workers/provider-post-load-cancellation-alerts.worker'
import { setupSat69BBlacklistWorker } from '../workers/sat-69b-blacklist.worker'
import { setupCfdiImportDispatchWorker } from '../workers/cfdi-import-dispatch.worker'
import { setupCfdiImportItemWorker } from '../workers/cfdi-import-item.worker'

loadEnvConfig(process.cwd())

console.log('Starting Background Workers (SAT Verification, Download, Provider Payment Compliance, SAT 69-B Blacklist & Provider Post-Load Cancellation Alerts)...')
setupVerificationWorker()
setupDownloadWorker()
setupProviderPaymentComplianceWorker()
setupProviderPostLoadCancellationAlertsWorker()
setupSat69BBlacklistWorker()
setupCfdiImportDispatchWorker()
setupCfdiImportItemWorker()
console.log('Workers started. Listening for jobs...')

// Keep process alive
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

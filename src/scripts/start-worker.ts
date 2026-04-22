import { setupVerificationWorker } from '../workers/verification.worker'
import { setupDownloadWorker } from '../workers/download.worker'

console.log('Starting Background Workers (SAT Verification & Download)...')
setupVerificationWorker()
setupDownloadWorker()
console.log('Workers started. Listening for jobs...')

// Keep process alive
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

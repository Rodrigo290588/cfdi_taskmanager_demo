import { setupVerificationWorker } from '../workers/verification.worker'

console.log('Starting Verification Worker (SAT Mock)...')
setupVerificationWorker()
console.log('Verification Worker started. Listening for jobs...')

// Keep process alive
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

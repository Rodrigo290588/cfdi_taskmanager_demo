
import { Queue } from 'bullmq'

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
}

const MASS_DOWNLOAD_QUEUE_NAME = 'mass-download-queue'
const queue = new Queue(MASS_DOWNLOAD_QUEUE_NAME, { connection })

async function main() {
  console.log(`Draining queue: ${MASS_DOWNLOAD_QUEUE_NAME}...`)
  
  // Clean different states
  await queue.obliterate({ force: true })
  
  console.log('Queue obliterated (all jobs removed).')
}

main()
  .catch(console.error)
  .finally(() => queue.close())

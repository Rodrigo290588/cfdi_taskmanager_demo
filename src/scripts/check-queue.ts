import { massDownloadQueue } from '../lib/queue'

async function checkQueue() {
  const counts = await massDownloadQueue.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed')
  console.log('Queue Status:', counts)
  
  const failed = await massDownloadQueue.getFailed()
  if (failed.length > 0) {
    console.log('Failed Jobs:')
    failed.forEach(job => {
      console.log(`- Job ${job.id}: ${job.failedReason}`)
      // console.log(job.stacktrace)
    })
  }

  process.exit(0)
}

checkQueue().catch(console.error)

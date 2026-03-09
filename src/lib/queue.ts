import { Queue } from 'bullmq'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Parse Redis URL to connection options if needed, or let BullMQ handle it if it supports URL (BullMQ usually takes connection object)
// Simple parsing for standard redis://host:port
let connection: { host: string; port: number; password?: string; username?: string } = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
}

if (REDIS_URL.startsWith('redis://')) {
  try {
    const url = new URL(REDIS_URL)
    connection = {
      host: url.hostname,
      port: parseInt(url.port || '6379'),
      password: url.password || undefined,
      username: url.username || undefined,
    }
  } catch (e) {
    console.error('Invalid REDIS_URL', e)
  }
}

export const MASS_DOWNLOAD_QUEUE_NAME = 'mass-download-queue'
export const MASS_VERIFICATION_QUEUE_NAME = 'mass-verification-queue'

export const massDownloadQueue = new Queue(MASS_DOWNLOAD_QUEUE_NAME, {
  connection,
})

export const massVerificationQueue = new Queue(MASS_VERIFICATION_QUEUE_NAME, {
  connection,
})

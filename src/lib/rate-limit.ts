// Simple in-memory rate limiter for serverless environments (approximate)
// For production with multiple replicas, use Redis/Upstash

const rateLimitMap = new Map<string, { count: number; expiresAt: number }>()

interface RateLimitOptions {
  interval: number // in milliseconds
  limit: number // max requests per interval
}

export function rateLimit(identifier: string, options: RateLimitOptions = { interval: 60000, limit: 5 }) {
  const now = Date.now()
  const record = rateLimitMap.get(identifier)

  // Clean up expired entry
  if (record && now > record.expiresAt) {
    rateLimitMap.delete(identifier)
  }

  const currentRecord = rateLimitMap.get(identifier)

  if (!currentRecord) {
    rateLimitMap.set(identifier, {
      count: 1,
      expiresAt: now + options.interval
    })
    return { success: true }
  }

  if (currentRecord.count >= options.limit) {
    return { success: false, expiresAt: currentRecord.expiresAt }
  }

  currentRecord.count++
  return { success: true }
}

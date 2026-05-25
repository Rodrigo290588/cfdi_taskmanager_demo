import { redis } from '@/lib/redis'

interface RateLimitOptions {
  interval: number // in milliseconds
  limit: number // max requests per interval
}

export async function rateLimit(identifier: string, options: RateLimitOptions = { interval: 60000, limit: 5 }) {
  const key = `rate_limit:${identifier}`
  const now = Date.now()

  const currentCount = await redis.incr(key)

  if (currentCount === 1) {
    await redis.pexpire(key, options.interval)
  }

  let ttlMs = await redis.pttl(key)

  if (ttlMs < 0) {
    await redis.pexpire(key, options.interval)
    ttlMs = options.interval
  }

  const resetAt = now + ttlMs

  if (currentCount > options.limit) {
    return {
      success: false,
      limit: options.limit,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(ttlMs, 0)
    }
  }

  return {
    success: true,
    limit: options.limit,
    remaining: Math.max(options.limit - currentCount, 0),
    resetAt,
    retryAfterMs: 0
  }
}

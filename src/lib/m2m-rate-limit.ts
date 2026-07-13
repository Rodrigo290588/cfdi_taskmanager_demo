export const M2M_RATE_LIMIT_WINDOW_MS = 1000
export const M2M_RATE_LIMIT_MAX_REQUESTS = 5

export function getM2MRateLimitConfig() {
  return {
    interval: M2M_RATE_LIMIT_WINDOW_MS,
    limit: M2M_RATE_LIMIT_MAX_REQUESTS
  }
}

export function getM2MRateLimitHeaders(limiter: {
  limit: number
  remaining: number
  resetAt: number
  retryAfterMs: number
}) {
  return {
    'Retry-After': String(Math.max(1, Math.ceil(limiter.retryAfterMs / 1000))),
    'X-RateLimit-Limit': String(limiter.limit),
    'X-RateLimit-Remaining': String(limiter.remaining),
    'X-RateLimit-Reset': String(limiter.resetAt)
  }
}

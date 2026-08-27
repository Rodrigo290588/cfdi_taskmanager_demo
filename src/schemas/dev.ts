import { z } from 'zod'

export const MAX_DEV_SEED_LIMIT = 1_000_000
export const MAX_DEV_SAT_INVOICES_LIMIT = 50
export const DEV_SEED_IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000
export const DEV_M2M_EXPIRE_DEFAULT_HOURS = 12
export const DEV_STEP_UP_AUTH_MAX_MINUTES = 15

export const RFC_STRICT_REGEX_SAT = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/

export const SAT_VALID_RFC_LENGTHS = new Set([12, 13])

export const DEV_RAND_DEMO_RFC_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const DevSatInvoicesQuerySchema = z.strictObject({
  limit: z
    .string({ message: 'limit debe ser string query param' })
    .optional()
    .transform((v) => {
      if (!v || v.trim() === '') return 10
      const n = Number(v.trim())
      if (!Number.isFinite(n)) return 10
      const floored = Number.isInteger(n) ? n : Math.floor(n)
      return Math.min(Math.max(floored, 1), MAX_DEV_SAT_INVOICES_LIMIT)
    }),
  rfc: z
    .string({ message: 'RFC debe ser string' })
    .trim()
    .max(40, { message: 'RFC muy largo (max 40 chars)' })
    .optional()
    .superRefine((val, ctx) => {
      if (!val) return
      if (!SAT_VALID_RFC_LENGTHS.has(val.length)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `RFC longitud ${val.length} inválida (12-13)` })
        return
      }
      if (!RFC_STRICT_REGEX_SAT.test(val.toUpperCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'RFC no cumple formato SAT oficial' })
        return
      }
    })
    .transform((v) => (v ? v.toUpperCase() : undefined))
    .pipe(z.string().optional()),
  includeDeleted: z.enum(['true', 'false'], { message: 'includeDeleted true|false' }).optional().default('false').transform((v) => v === 'true')
})

export type DevSatInvoicesQueryParsed = z.infer<typeof DevSatInvoicesQuerySchema>

export const DevSeedEnvWhitelistSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
  ALLOW_DEV_ENDPOINTS: z
    .string({ message: 'ALLOW_DEV_ENDPOINTS env must be string' })
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => v === 'true' || v === '1' || v === 'yes' || v === 'on'),
  SEED_DEMO_RFC_1: z.string().trim().min(10).max(14).optional(),
  SEED_DEMO_RFC_2: z.string().trim().min(10).max(14).optional(),
  SEED_DEMO_BUSINESS_1: z.string().trim().min(3).max(120).optional(),
  SEED_DEMO_BUSINESS_2: z.string().trim().min(3).max(120).optional()
})

export type DevSeedEnvWhitelistParsed = z.infer<typeof DevSeedEnvWhitelistSchema>

export const DevSeedHeadersStrictSchema = z.strictObject({
  'x-step-up-session-fresh': z
    .string()
    .optional()
    .default('false')
    .transform((v) => v?.toLowerCase() === 'true'),
  'x-request-trace-id': z.string().trim().min(4).max(64).optional(),
  'x-forwarded-for': z.string().trim().max(512).optional(),
  'user-agent': z.string().trim().max(512).optional()
}).strip()

export type DevSeedHeadersParsed = z.infer<typeof DevSeedHeadersStrictSchema>

export const DEV_STAGE_ALLOWED_NODE_ENVS = new Set(['development', 'test', 'staging'])

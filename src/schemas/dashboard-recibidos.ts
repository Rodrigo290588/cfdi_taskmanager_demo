import { z } from 'zod'

const SAFE_ID_RE = /^(cm[a-z0-9_]{12,64})$/
const UUID_V4_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[4][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const NANO_ID_RE = /^[A-Za-z0-9_-]{16,64}$/

export const PrismaNanoIdSchema = z
  .string({ message: 'ID requerido' })
  .trim()
  .min(10)
  .max(64)
  .refine(val => SAFE_ID_RE.test(val) || UUID_V4_RE.test(val) || NANO_ID_RE.test(val), {
    message: 'Formato ID inválido (Prisma nanoId / UUID v4 / NanoId alfanumérico esperado)',
  })

export const CompanyIdSchema = PrismaNanoIdSchema
export const FiscalEntityIdSchema = PrismaNanoIdSchema
export const RecordIdSchema = z.string().trim().min(6).max(128).refine(
  v => UUID_V4_RE.test(v) || SAFE_ID_RE.test(v) || /^[A-Za-z0-9_-]{8,128}$/.test(v),
  'recordId con formato inválido'
)

export const IsoDateSchema = z
  .string({ message: 'Fecha requerida (YYYY-MM-DD)' })
  .trim()
  .regex(ISO_DATE_RE, 'Fecha con formato inválido. Usa YYYY-MM-DD (ISO 8601)')
  .refine(val => {
    const d = new Date(val + 'T00:00:00Z')
    return !Number.isNaN(d.getTime())
  }, 'Fecha inválida (no calendario real)')

const MAX_MONTHS = 36
const MAX_HEAVY_MONTHS = 12
const MAX_DAYS_HEAVY = 366

export const DateRangeSchema = z
  .strictObject({ startDate: IsoDateSchema, endDate: IsoDateSchema })
  .superRefine(({ startDate, endDate }, ctx) => {
    const start = new Date(startDate + 'T00:00:00Z').getTime()
    const end = new Date(endDate + 'T23:59:59Z').getTime()
    if (end < start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endDate debe ser mayor o igual que startDate' })
      return
    }
    const months =
      (new Date(endDate).getUTCFullYear() - new Date(startDate).getUTCFullYear()) * 12 +
      (new Date(endDate).getUTCMonth() - new Date(startDate).getUTCMonth()) +
      1
    if (months > MAX_MONTHS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rango demasiado amplio para visualización. Máximo ${MAX_MONTHS} meses (${Math.floor(MAX_MONTHS / 12)} años).`,
      })
    }
  })

export const DashboardRecibidosCommonQuerySchema = z
  .strictObject({
    companyId: CompanyIdSchema,
    orgId: CompanyIdSchema.optional(),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    includeHeavyMetrics: z.enum(['true', 'false']).optional().default('false'),
    page: z.coerce.number().int().min(1).max(10000).optional().default(1),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  })
  .and(DateRangeSchema)
  .superRefine((data, ctx) => {
    if (data.includeHeavyMetrics === 'true') {
      const days =
        (new Date(data.endDate + 'T23:59:59Z').getTime() - new Date(data.startDate + 'T00:00:00Z').getTime()) /
        86400000
      if (days > MAX_DAYS_HEAVY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['includeHeavyMetrics'],
          message: `includeHeavyMetrics=true requiere rango ≤ ${MAX_DAYS_HEAVY} días.` })
      }
      const months =
        (new Date(data.endDate).getUTCFullYear() - new Date(data.startDate).getUTCFullYear()) * 12 +
        (new Date(data.endDate).getUTCMonth() - new Date(data.startDate).getUTCMonth()) +
        1
      if (months > MAX_HEAVY_MONTHS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['includeHeavyMetrics'],
          message: `includeHeavyMetrics=true requiere rango ≤ ${MAX_HEAVY_MONTHS} meses.` })
      }
    }
  })

export const DashboardRecibidosUploadFormSchema = z.strictObject({
  companyId: CompanyIdSchema,
  orgId: CompanyIdSchema.optional(),
})

export const DashboardRecibidosDownloadQuerySchema = z.strictObject({
  companyId: CompanyIdSchema,
  orgId: CompanyIdSchema.optional(),
  id: RecordIdSchema,
})

export const InvoiceWorkpaperQuerySchema = z.strictObject({
  companyId: CompanyIdSchema,
  orgId: CompanyIdSchema.optional(),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100000).optional().default(20),
  query: z.string().trim().max(128).optional().default(''),
  satStatus: z.string().trim().max(32).optional().default(''),
  status: z.string().trim().max(32).optional().default(''),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
  cfdiType: z.string().trim().max(64).optional().default(''),
  export: z.enum(['csv','json','']).optional().default(''),
  origin: z.string().trim().max(64).optional().default(''),
})

export const DashboardRecibidosDrilldownQuerySchema = z.strictObject({
  companyId: CompanyIdSchema,
  orgId: CompanyIdSchema.optional(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  groupBy: z.string().trim().max(64).optional().default(''),
}).and(DateRangeSchema)

export type DashboardRecibidosCommonQueryParsed = z.infer<typeof DashboardRecibidosCommonQuerySchema>
export type DashboardRecibidosUploadParsed = z.infer<typeof DashboardRecibidosUploadFormSchema>
export type DashboardRecibidosDownloadParsed = z.infer<typeof DashboardRecibidosDownloadQuerySchema>
export type InvoiceWorkpaperQueryParsed = z.infer<typeof InvoiceWorkpaperQuerySchema>
export type DashboardRecibidosDrilldownQueryParsed = z.infer<typeof DashboardRecibidosDrilldownQuerySchema>

export const RECEPTION_HAS_FLAGS = new Set([
  'hasIva16Trasladado',
  'hasIva0Exento',
  'hasIsrRetenido',
  'hasIvaRetenido',
  'hasIeps',
  'hasImpuestoLocal',
  'hasComplementoPago',
  'hasCancelacionRelacionada',
  'hasObjetoImpNoIdentificado',
  'hasNomina',
  'hasDonativo',
  'hasCombustible',
] as const)

export const MAX_HAS_FILTERS = 8
export const MAX_NUMERIC_PROJECTION_FILTERS = 3
export const INVOICE_WORKPAPER_HARD_VISUAL_LIMIT = 500
export const SAT_VALID_REGIMES_2026 = new Set([
  '601','603','605','606','607','608','609','610','611','612','614',
  '615','616','620','621','622','623','624','625','626','627','628','629','630',
  '631','632','633','634','635','636','637','638','639','640','699',
  '701','702','703','704','705','706','707','708','709','710','711','712','713','714','715','716',
])

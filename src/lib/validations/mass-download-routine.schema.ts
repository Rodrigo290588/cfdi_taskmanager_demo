import { z } from 'zod'

const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/i
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/
const CUID_REGEX = /^c[a-z0-9]{24}$/
const DESTINATION_ID_REGEX = /^[a-z][a-z0-9_-]{0,63}$/
const RELATIVE_STORAGE_PATH_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})*$/

export const RoutineIdSchema = z
  .string()
  .trim()
  .regex(CUID_REGEX, 'Identificador de rutina inválido')

export const CompanyIdSchema = z
  .string()
  .trim()
  .regex(CUID_REGEX, 'Identificador de empresa inválido')

export const RoutineRfcSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(RFC_REGEX, 'RFC inválido')

export const RoutineDateSchema = z
  .string()
  .trim()
  .regex(DATE_ONLY_REGEX, 'La fecha debe usar el formato AAAA-MM-DD')
  .refine(isValidDateOnly, 'La fecha no es válida')

const OptionalRfcSchema = RoutineRfcSchema.optional()
const OptionalShortTextSchema = z.string().trim().min(1).max(64).optional()

const RoutineFiltersSchema = z.strictObject({
  issuerRfc: OptionalRfcSchema,
  receiverRfc: OptionalRfcSchema,
  voucherType: z.enum(['I', 'E', 'P', 'T', 'N']).optional(),
  status: z.enum(['Todos', 'Vigente', 'Cancelado']).default('Todos'),
  thirdPartyRfc: OptionalRfcSchema,
  complement: OptionalShortTextSchema,
})

const DestinationIdSchema = z
  .string()
  .trim()
  .regex(DESTINATION_ID_REGEX, 'Destino de almacenamiento inválido')

const RelativeStoragePathSchema = z
  .string()
  .trim()
  .max(240)
  .regex(RELATIVE_STORAGE_PATH_REGEX, 'Ruta relativa de almacenamiento inválida')

const RoutineStorageOptionsSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    extractionDestinationId: DestinationIdSchema.optional(),
    zipBackupDestinationId: DestinationIdSchema.optional(),
    extractionRelativePath: RelativeStoragePathSchema.optional(),
    zipBackupRelativePath: RelativeStoragePathSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enabled && !data.extractionDestinationId && !data.zipBackupDestinationId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Selecciona al menos un destino de almacenamiento',
        path: ['extractionDestinationId'],
      })
    }
  })

const RoutineScheduleSchema = z
  .strictObject({
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    scheduledHour: z.number().int().min(0).max(23),
    scheduledMinute: z.number().int().min(0).max(59).default(0),
    weekDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    monthDays: z.array(z.number().int().min(1).max(31)).max(31).default([]),
    timezone: z.string().trim().min(1).max(64).default('America/Mexico_City'),
  })
  .superRefine((data, ctx) => {
    if (!isValidTimeZone(data.timezone)) {
      ctx.addIssue({ code: 'custom', message: 'Zona horaria inválida', path: ['timezone'] })
    }
    if (data.frequency === 'WEEKLY' && data.weekDays.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Selecciona al menos un día de la semana', path: ['weekDays'] })
    }
    if (data.frequency === 'MONTHLY' && data.monthDays.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Selecciona al menos un día del mes', path: ['monthDays'] })
    }
    if (data.frequency !== 'WEEKLY' && data.weekDays.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'Los días de semana solo aplican a frecuencia semanal', path: ['weekDays'] })
    }
    if (data.frequency !== 'MONTHLY' && data.monthDays.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'Los días de mes solo aplican a frecuencia mensual', path: ['monthDays'] })
    }
    if (new Set(data.weekDays).size !== data.weekDays.length) {
      ctx.addIssue({ code: 'custom', message: 'No repitas días de semana', path: ['weekDays'] })
    }
    if (new Set(data.monthDays).size !== data.monthDays.length) {
      ctx.addIssue({ code: 'custom', message: 'No repitas días de mes', path: ['monthDays'] })
    }
  })

export const RoutineConfigurationSchema = z
  .strictObject({
    name: z.string().trim().min(3).max(120),
    requestType: z.enum(['CFDI', 'METADATA']),
    retrievalType: z.enum(['EMITIDOS', 'RECIBIDOS']),
    filters: RoutineFiltersSchema.default({ status: 'Todos' }),
    periodPreset: z.enum([
      'CURRENT_DAY',
      'PREVIOUS_DAY',
      'CURRENT_WEEK',
      'PREVIOUS_WEEK',
      'LAST_SEVEN_DAYS',
      'CURRENT_MONTH',
      'PREVIOUS_MONTH',
      'CUSTOM',
    ]),
    customStartDate: RoutineDateSchema.optional(),
    customEndDate: RoutineDateSchema.optional(),
    schedule: RoutineScheduleSchema,
    storageOptions: RoutineStorageOptionsSchema.default({ enabled: false }),
  })
  .superRefine((data, ctx) => {
    if (data.requestType === 'CFDI' && data.filters.status === 'Cancelado') {
      ctx.addIssue({
        code: 'custom',
        path: ['filters', 'status'],
        message: 'El SAT no permite descargar XML CFDI cancelados. Selecciona Vigente.',
      })
    }
    if (data.periodPreset === 'CUSTOM') {
      if (!data.customStartDate) {
        ctx.addIssue({ code: 'custom', message: 'La fecha inicial es requerida', path: ['customStartDate'] })
      }
      if (!data.customEndDate) {
        ctx.addIssue({ code: 'custom', message: 'La fecha final es requerida', path: ['customEndDate'] })
      }
      if (data.customStartDate && data.customEndDate && data.customStartDate > data.customEndDate) {
        ctx.addIssue({ code: 'custom', message: 'La fecha inicial no puede ser posterior a la final', path: ['customStartDate'] })
      }
    } else if (data.customStartDate || data.customEndDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'Las fechas personalizadas solo aplican al periodo personalizado',
        path: ['periodPreset'],
      })
    }
  })

export const CreateRoutineSchema = RoutineConfigurationSchema.extend({
  companyId: CompanyIdSchema,
})

export const UpdateRoutineSchema = RoutineConfigurationSchema

export const RoutineActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('update'),
    routine: UpdateRoutineSchema,
  }),
  z.strictObject({
    action: z.literal('pause'),
  }),
  z.strictObject({
    action: z.literal('resume'),
  }),
])

export const ListRoutinesQuerySchema = z.strictObject({
  companyId: CompanyIdSchema,
  includeDeleted: z.enum(['true', 'false']).optional().default('false'),
})

export const ListRoutineExecutionsQuerySchema = z.strictObject({
  companyId: CompanyIdSchema,
  routineId: RoutineIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
})

export type CreateRoutineInput = z.infer<typeof CreateRoutineSchema>
export type RoutineConfigurationInput = z.infer<typeof RoutineConfigurationSchema>
export type RoutineActionInput = z.infer<typeof RoutineActionSchema>

function isValidDateOnly(value: string): boolean {
  const [yearString, monthString, dayString] = value.split('-')
  const year = Number(yearString)
  const month = Number(monthString)
  const day = Number(dayString)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

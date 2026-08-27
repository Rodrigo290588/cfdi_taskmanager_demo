import { z } from 'zod'

export const RFC_STRICT_REGEX_SAT = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i

export const MAX_EXTERNAL_USERS_BATCH = 500
export const MAX_EXTERNAL_CFDI_IMPORT_FILES = 500
export const MAX_EXTERNAL_PAYLOAD_BYTES = 50 * 1024 * 1024
export const MAX_EXTERNAL_QUERY_PAGESIZE = 500

export const EXTERNAL_STAGE_ALLOWED_NODE_ENVS = new Set(['development', 'test', 'staging', 'production'])

export const BASE64_CHARS_REGEX = /^[A-Za-z0-9+/]+={0,2}$/
export const SHA256_HEX_REGEX = /^[a-fA-F0-9]{64}$/

export const EMAIL_RFC5322_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

export const MAX_CONTENT_BASE64_BYTES = 5 * 1024 * 1024
export const MAX_CONTENT_BASE64_CHARS = Math.ceil(MAX_CONTENT_BASE64_BYTES * 4 / 3)

export const CFDI_IMPORT_STATUS_QUERY_VALUES = ['STAGED', 'QUEUED', 'PROCESSING', 'PROCESSING_WITH_EXTERNAL_WAIT', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'] as const
export const CFDI_IMPORT_DIRECTION_VALUES = ['EMITTED', 'RECEIVED'] as const
export const CFDI_IMPORT_VALIDATION_BUCKETS = ['VALID_APPROVED', 'VALID_PENDING_EXTERNAL', 'REJECTED_INVALID_XML', 'REJECTED_RFC_MISMATCH', 'REJECTED_DUPLICATE', 'ERROR'] as const

export const ExternalBaseFields = z.strictObject({}).strict()

export const M2MSafeFieldWhiteList = new Set([
  'user',
  'users',
  'correo',
  'nombre_usuario',
  'rol_empresa',
  'empresas',
  'rfc_proveedor',
  'nombre_proveedor',
  'externalId',
  'uuid',
  'estatus_pago',
  'fecha_pago',
  'batchId',
  'source',
  'directoryControl',
  'executionId',
  'totalXmlFiles',
  'skippedByProgressFiles',
  'newXmlFiles',
  'items',
  'fileName',
  'contentBase64',
  'contentSha256',
  'importRunId',
  'page',
  'pageSize',
  'status',
  'direction',
  'validationBucket',
  'hasErrors',
  'waitingExternalValidation'
])

export function sanitizeZodFieldName(raw: unknown): string {
  if (typeof raw !== 'string') return 'campo_desconocido'
  if (M2MSafeFieldWhiteList.has(raw)) return raw
  if (raw.length > 64) return 'campo_desconocido'
  if (/[^a-zA-Z0-9_]/.test(raw)) return 'campo_desconocido'
  return 'campo_desconocido'
}

export function sanitizeZodIssues(issues: z.ZodIssue[]) {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? sanitizeZodFieldName(issue.path[0]) + (issue.path.length > 1 ? `.[${issue.path.length - 1} nested]` : '') : 'body',
    message: 'Valor inválido para el campo solicitado; consulta la documentación M2M.'
  }))
}

export const EXTERNAL_PROVIDER_PAYMENT_STATUS_VALUES = ['INICIAL', 'EN_PROCESO', 'PAGADO', 'COMPLETO'] as const

export const ExternalProviderPaymentUpdateSchema = z.strictObject({
  uuid: z.string().trim().min(32).max(48).regex(/^[A-Fa-f0-9-]{32,48}$/),
  estatus_pago: z.enum(EXTERNAL_PROVIDER_PAYMENT_STATUS_VALUES),
  fecha_pago: z.string().trim().min(10).max(32).datetime({ offset: true }).optional()
}).strict().superRefine((payload, ctx) => {
  if (payload.estatus_pago === 'PAGADO' && !payload.fecha_pago) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fecha_pago'], message: 'fecha_pago es obligatorio cuando estatus_pago=PAGADO' })
  }
  if (payload.estatus_pago !== 'PAGADO' && typeof payload.fecha_pago !== 'undefined') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fecha_pago'], message: 'fecha_pago solo permitido cuando estatus_pago=PAGADO' })
  }
})

export const ExternalCfdiImportItemSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z
    .string()
    .trim()
    .min(1)
    .max(MAX_CONTENT_BASE64_CHARS, 'contentBase64 excede MAX_BYTES_PER_FILE')
    .regex(BASE64_CHARS_REGEX, 'contentBase64 no es base64 válido'),
  contentSha256: z
    .string()
    .trim()
    .regex(SHA256_HEX_REGEX, 'contentSha256 inválido; requiere hex 64 chars')
    .optional()
}).strict()

export const ExternalCfdiDirectoryControlSchema = z.strictObject({
  executionId: z.string().trim().min(1).max(191),
  totalXmlFiles: z.number().int().min(0),
  skippedByProgressFiles: z.number().int().min(0),
  newXmlFiles: z.number().int().min(0)
}).strict().superRefine((value, ctx) => {
  if (value.totalXmlFiles < value.skippedByProgressFiles) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['totalXmlFiles'], message: 'totalXmlFiles debe ser >= skippedByProgressFiles' })
  }
  if (value.totalXmlFiles - value.skippedByProgressFiles !== value.newXmlFiles) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newXmlFiles'], message: 'newXmlFiles debe ser igual a totalXmlFiles - skippedByProgressFiles' })
  }
})

export const ExternalCfdiImportCreateSchema = z.strictObject({
  batchId: z.string().trim().min(1).max(191).optional(),
  source: z.literal('M2M_JAVA_CLIENT').default('M2M_JAVA_CLIENT'),
  directoryControl: ExternalCfdiDirectoryControlSchema.optional(),
  items: z.array(ExternalCfdiImportItemSchema).min(1).max(MAX_EXTERNAL_CFDI_IMPORT_FILES)
}).strict()

export const ExternalCfdiImportRunParamsSchema = z.strictObject({
  importRunId: z.string().min(1).max(191)
}).strict()

export const ExternalCfdiImportItemsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_EXTERNAL_QUERY_PAGESIZE).default(100),
  status: z.enum(CFDI_IMPORT_STATUS_QUERY_VALUES).optional(),
  direction: z.enum(CFDI_IMPORT_DIRECTION_VALUES).optional(),
  validationBucket: z.enum(CFDI_IMPORT_VALIDATION_BUCKETS).optional(),
  hasErrors: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  waitingExternalValidation: z.enum(['true', 'false']).transform(v => v === 'true').optional()
}).strict()

export const CFDI_IMPORT_CREATE_SCOPE = 'cfdi.import:create'
export const CFDI_IMPORT_RUNS_READ_SCOPE = 'cfdi.import.runs:read'
export const EXTERNAL_USERS_CREATE_SCOPE = 'users:create'

export const EXTERNAL_EMAIL_MAX_LEN = 254
export const EXTERNAL_USERNAME_REGEX = /^[\p{L}\p{N}]+(?:[ _-][\p{L}\p{N}]+)*$/u

export const ExternalUserSingleSchema = z.strictObject({
  correo: z.string().trim().min(5).max(EXTERNAL_EMAIL_MAX_LEN).regex(EMAIL_RFC5322_REGEX, 'Correo inválido (RFC5322)'),
  nombre_usuario: z.string().trim().min(1).max(128).regex(EXTERNAL_USERNAME_REGEX, 'Nombre usuario debe ser alfanumérico unicode'),
  rol_empresa: z.string().trim().min(1).max(64),
  empresas: z.array(z.string().trim().min(12).max(13).regex(RFC_STRICT_REGEX_SAT, 'Cada empresa debe ser RFC mexicano 12-13 chars')).min(1).max(200),
  rfc_proveedor: z.string().trim().min(12).max(13).regex(RFC_STRICT_REGEX_SAT, 'RFC proveedor inválido').optional(),
  nombre_proveedor: z.string().trim().min(1).max(255).optional(),
  externalId: z.string().trim().min(1).max(191).optional()
}).strict().superRefine((d, ctx) => {
  const isProvider = d.rol_empresa.trim().toLowerCase() === 'proveedor'
  if (isProvider) {
    if (!d.rfc_proveedor) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rfc_proveedor'], message: 'rfc_proveedor obligatorio para rol proveedor' })
    if (!d.nombre_proveedor) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nombre_proveedor'], message: 'nombre_proveedor obligatorio para rol proveedor' })
  } else {
    if (typeof d.rfc_proveedor !== 'undefined') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rfc_proveedor'], message: 'rfc_proveedor solo permitido con rol proveedor' })
    if (typeof d.nombre_proveedor !== 'undefined') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nombre_proveedor'], message: 'nombre_proveedor solo permitido con rol proveedor' })
  }
})

export const ExternalUserBulkSchema = z.strictObject({
  user: ExternalUserSingleSchema,
  users: z.never().optional()
}).strict().or(z.strictObject({
  users: z.array(ExternalUserSingleSchema).min(1).max(MAX_EXTERNAL_USERS_BATCH),
  user: z.never().optional()
}).strict())

export type ExternalUserInput = z.infer<typeof ExternalUserSingleSchema>
export type ExternalCfdiImportCreatePayload = z.infer<typeof ExternalCfdiImportCreateSchema>
export type ExternalProviderPaymentUpdatePayload = z.infer<typeof ExternalProviderPaymentUpdateSchema>

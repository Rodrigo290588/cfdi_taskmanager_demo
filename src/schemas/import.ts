import { z } from 'zod'
import { isStrictRfc4122Uuid } from '@/lib/xml-sanitize'

export const ENV_IMPORTS = {
  get MAX_BATCH_SIZE(): number {
    const raw = process.env.MAX_BATCH_SIZE_OVERRIDE ? Number(process.env.MAX_BATCH_SIZE_OVERRIDE) : NaN
    if (Number.isFinite(raw) && raw > 0 && raw <= 500) return Math.floor(raw)
    return 50
  },
  get MAX_XML_BYTES(): number {
    const raw = process.env.MAX_XML_BYTES_OVERRIDE ? Number(process.env.MAX_XML_BYTES_OVERRIDE) : NaN
    if (Number.isFinite(raw) && raw > 50_000 && raw <= 50 * 1024 * 1024) return Math.floor(raw)
    return 5 * 1024 * 1024
  },
  get MIN_XML_BYTES(): number { return 200 },
  get MAX_TOTAL_BATCH_BYTES(): number {
    return 250 * 1024 * 1024
  },
  get MAX_SOURCE_FILE_NAME(): number { return 255 }
} as const

export type ImportRecordInput = {
  xmlContent?: unknown
  xml?: unknown
  rawXml?: unknown
  source_file?: unknown
  relatedUuid?: unknown
}

const ALLOWED_XML_ALIASES = ['xmlContent', 'xml', 'rawXml'] as const
type XmlAlias = typeof ALLOWED_XML_ALIASES[number]

function pickXmlAlias(r: ImportRecordInput): { alias: XmlAlias; value: unknown } | null {
  for (const a of ALLOWED_XML_ALIASES) {
    const v = r[a]
    if (typeof v === 'string' && v.length > 0) return { alias: a, value: v }
  }
  return null
}

export const importRecordSchema = z.strictObject({
  xmlContent: z.string().max(ENV_IMPORTS.MAX_XML_BYTES, 'XML excede MAX_XML_BYTES').optional(),
  xml: z.string().max(ENV_IMPORTS.MAX_XML_BYTES, 'XML excede MAX_XML_BYTES').optional(),
  rawXml: z.string().max(ENV_IMPORTS.MAX_XML_BYTES, 'XML excede MAX_XML_BYTES').optional(),
  source_file: z.string().trim().max(ENV_IMPORTS.MAX_SOURCE_FILE_NAME).optional(),
  relatedUuid: z.string().optional()
}).superRefine((r, ctx) => {
  const picked = pickXmlAlias(r)
  if (!picked) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['xml'],
      message: 'Se requiere al menos xml, xmlContent o rawXml por registro'
    })
    return
  }
  const xmlStr = String(picked.value)
  const bytes = Buffer.byteLength(xmlStr, 'utf8')
  if (bytes < ENV_IMPORTS.MIN_XML_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: ENV_IMPORTS.MIN_XML_BYTES,
      inclusive: true,
      type: 'string',
      origin: 'string',
      path: [picked.alias, 'bytes'],
      message: `XML demasiado pequeño: ${bytes} < ${ENV_IMPORTS.MIN_XML_BYTES} bytes`
    })
  }
  if (bytes > ENV_IMPORTS.MAX_XML_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: ENV_IMPORTS.MAX_XML_BYTES,
      inclusive: true,
      type: 'string',
      origin: 'string',
      path: [picked.alias, 'bytes'],
      message: `XML excede tamaño máximo: ${bytes} > ${ENV_IMPORTS.MAX_XML_BYTES} bytes`
    })
  }
  if (typeof r.source_file === 'string' && r.source_file.length > 0) {
    if (/[\x00-\x1f\\/:*?"<>|]/.test(r.source_file)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_file'],
        message: 'source_file contiene caracteres de control o path traversal prohibidos'
      })
    }
  }
  if (typeof r.relatedUuid === 'string' && r.relatedUuid.length > 0) {
    if (!isStrictRfc4122Uuid(r.relatedUuid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relatedUuid'],
        message: 'relatedUuid debe ser UUID RFC 4122 versión 1-5 variante 8/9/a/b'
      })
    }
  }
})

export type ImportRecordParsed = z.infer<typeof importRecordSchema>

export const importBatchSchema = z.array(importRecordSchema)
  .min(1, 'Batch vacío: al menos 1 registro')
  .max(ENV_IMPORTS.MAX_BATCH_SIZE, `Batch excede MAX_BATCH_SIZE=${ENV_IMPORTS.MAX_BATCH_SIZE}`)
  .superRefine((batch, ctx) => {
    let totalBytes = 0
    const uuidSet = new Set<string>()
    const uuidsAtPath = new Map<string, Array<number>>()
    for (let i = 0; i < batch.length; i++) {
      const r = batch[i] as ImportRecordInput
      const picked = pickXmlAlias(r)
      if (picked) {
        totalBytes += Buffer.byteLength(String(picked.value), 'utf8')
        if (totalBytes > ENV_IMPORTS.MAX_TOTAL_BATCH_BYTES) {
          ctx.addIssue({
            code: z.ZodIssueCode.too_big,
            maximum: ENV_IMPORTS.MAX_TOTAL_BATCH_BYTES,
            inclusive: true,
            type: 'number',
            origin: 'number',
            path: ['batch', i, 'totalBytes'],
            message: `Suma total de XML del batch excede MAX_TOTAL_BATCH_BYTES=${ENV_IMPORTS.MAX_TOTAL_BATCH_BYTES}`
          })
          break
        }
      }
      if (typeof r.relatedUuid === 'string' && r.relatedUuid.length > 0) {
        const up = r.relatedUuid.toUpperCase()
        uuidsAtPath.set(up, (uuidsAtPath.get(up) || []).concat(i))
      }
    }
    for (const [up, indices] of uuidsAtPath.entries()) {
      if (indices.length > 1) {
        uuidSet.add(up)
        for (const idx of indices) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [idx, 'relatedUuid'],
            message: `relatedUuid duplicado en mismo batch (indices=${indices.join(',')})`
          })
        }
      }
    }
  })

export type ImportBatchParsed = z.infer<typeof importBatchSchema>

export function sanitizeZodIssuesForClient(issues: ReadonlyArray<z.ZodIssue>): Array<{ path: string; code: string; message: string }> {
  return issues.map(issue => {
    const pathSafe = issue.path.map(p => typeof p === 'number' ? '<index>' : String(p).slice(0, 64)).join('.')
    return {
      path: pathSafe,
      code: issue.code,
      message: issue.message.slice(0, 240)
    }
  })
}

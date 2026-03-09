import { z } from 'zod'

export const trasladoSchema = z.object({
  impuesto: z.union([z.string(), z.number()]).transform(String), // '002' (IVA), '001' (ISR), '003' (IEPS)
  tipoFactor: z.string().optional(),
  tasaOCuota: z.union([z.string(), z.number()]).optional().transform(v => (v == null ? undefined : String(v))),
  base: z.union([z.string(), z.number()]).optional().transform(v => (v == null ? undefined : String(v))),
  importe: z.union([z.string(), z.number()]).transform(String)
})

export const retencionSchema = z.object({
  impuesto: z.union([z.string(), z.number()]).transform(String),
  importe: z.union([z.string(), z.number()]).transform(String)
})

const impuestosConceptoSchema = z.object({
  traslados: z
    .union([trasladoSchema, z.array(trasladoSchema)])
    .optional()
    .transform(v => (v == null ? [] : Array.isArray(v) ? v : [v])),
  retenciones: z
    .union([retencionSchema, z.array(retencionSchema)])
    .optional()
    .transform(v => (v == null ? [] : Array.isArray(v) ? v : [v]))
})

const conceptoSchema = z.object({
  claveProdServ: z.string(),
  noIdentificacion: z.string().optional(),
  cantidad: z.union([z.string(), z.number()]).transform(String),
  claveUnidad: z.string(),
  unidad: z.string().optional(),
  descripcion: z.string(),
  valorUnitario: z.union([z.string(), z.number()]).transform(String),
  importe: z.union([z.string(), z.number()]).transform(String),
  descuento: z.union([z.string(), z.number()]).optional().transform(v => (v == null ? undefined : String(v))),
  objetoImp: z.string(),
  impuestos: impuestosConceptoSchema.optional(),
  parte: z
    .union([
      z.object({
        claveProdServ: z.string(),
        noIdentificacion: z.string().optional(),
        cantidad: z.union([z.string(), z.number()]).transform(String),
        unidad: z.string().optional(),
        descripcion: z.string(),
        valorUnitario: z.union([z.string(), z.number()]).transform(String),
        importe: z.union([z.string(), z.number()]).transform(String)
      }),
      z.array(
        z.object({
          claveProdServ: z.string(),
          noIdentificacion: z.string().optional(),
          cantidad: z.union([z.string(), z.number()]).transform(String),
          unidad: z.string().optional(),
          descripcion: z.string(),
          valorUnitario: z.union([z.string(), z.number()]).transform(String),
          importe: z.union([z.string(), z.number()]).transform(String)
        })
      )
    ])
    .optional()
    .transform(v => (v == null ? [] : Array.isArray(v) ? v : [v]))
})

const cfdiRelacionadosSchema = z.object({
  tipoRelacion: z.string(),
  uuids: z.union([z.string(), z.array(z.string())]).transform(v => (Array.isArray(v) ? v : [v]))
})

const impuestosComprobanteSchema = z.object({
  traslados: z
    .union([trasladoSchema, z.array(trasladoSchema)])
    .optional()
    .transform(v => (v == null ? [] : Array.isArray(v) ? v : [v])),
  retenciones: z
    .union([retencionSchema, z.array(retencionSchema)])
    .optional()
    .transform(v => (v == null ? [] : Array.isArray(v) ? v : [v]))
})

export const cfdiInputSchema = z.object({
  comprobante: z.object({
    serie: z.string().optional(),
    folio: z.string().optional(),
    moneda: z.string().default('MXN'),
    tipoCambio: z.union([z.number(), z.string()]).optional(),
    exportacion: z.string().default('01'),
    lugarExpedicion: z.string(),
    metodoPago: z.string(),
    formaPago: z.string(),
    condicionesDePago: z.string().optional(),
    fecha: z.string().datetime(),
    impuestos: impuestosComprobanteSchema.optional(),
    objetoImp: z.string().optional(),
    subtotal: z.union([z.string(), z.number()]).optional(),
    descuento: z.union([z.string(), z.number()]).optional(),
    total: z.union([z.string(), z.number()]).optional()
  }),
  emisor: z.object({ rfc: z.string(), nombre: z.string() }),
  receptor: z.object({ rfc: z.string(), nombre: z.string(), usoCfdi: z.string() }),
  conceptos: z
    .union([conceptoSchema, z.array(conceptoSchema)])
    .transform(v => (Array.isArray(v) ? v : [v])),
  cfdiRelacionados: z
    .union([cfdiRelacionadosSchema, z.array(cfdiRelacionadosSchema)])
    .optional()
    .transform(v => (v == null ? [] : Array.isArray(v) ? v : [v]))
})

export type CFDIInput = z.infer<typeof cfdiInputSchema>

export type CFDIConceptoNormalizado = {
  claveProdServ: string
  noIdentificacion?: string
  cantidad: string
  claveUnidad: string
  unidad?: string
  descripcion: string
  valorUnitario: string
  importe: string
  descuento?: string
  objetoImp: string
  impuestos: {
    traslados: Array<{ impuesto: string; tipoFactor?: string; tasaOCuota?: string; base?: string; importe: string }>
    retenciones: Array<{ impuesto: string; importe: string }>
  }
  partes: Array<{
    claveProdServ: string
    noIdentificacion?: string
    cantidad: string
    unidad?: string
    descripcion: string
    valorUnitario: string
    importe: string
  }>
}

export type CFDIRelacionNormalizada = {
  tipoRelacion: string
  uuids: string[]
}

export type CFDINormalizado = {
  comprobante: {
    serie?: string
    folio?: string
    moneda: string
    tipoCambio?: string
    exportacion: string
    lugarExpedicion: string
    metodoPago: string
    formaPago: string
    condicionesDePago?: string
    fecha: string
    impuestos: {
      traslados: Array<{ impuesto: string; tipoFactor?: string; tasaOCuota?: string; base?: string; importe: string }>
      retenciones: Array<{ impuesto: string; importe: string }>
    }
    objetoImp?: string
    subtotal: string
    descuento: string
    total: string
  }
  emisor: { rfc: string; nombre: string }
  receptor: { rfc: string; nombre: string; usoCfdi: string }
  conceptos: CFDIConceptoNormalizado[]
  cfdiRelacionados: CFDIRelacionNormalizada[]
}

import { z } from 'zod'
import { PROVIDER_PAYMENT_STATUS_VALUES } from '@/lib/provider-cfdi-storage'

export const PAYMENTS_UPDATE_SCOPE = 'payments:update'

export const providerPaymentUpdateSchema = z.object({
  uuid: z.string().uuid('uuid debe ser un UUID válido'),
  estatus_pago: z.enum(PROVIDER_PAYMENT_STATUS_VALUES, {
    error: () => ({ message: 'estatus_pago debe ser uno de: INICIAL, EN_PROCESO, PAGADO, COMPLETO' })
  }),
  fecha_pago: z.string().datetime({ offset: true, message: 'fecha_pago debe usar formato ISO 8601 con zona horaria' }).optional()
}).strict().superRefine((payload, ctx) => {
  if (payload.estatus_pago === 'PAGADO' && !payload.fecha_pago) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fecha_pago'],
      message: 'fecha_pago es obligatorio cuando estatus_pago es PAGADO'
    })
  }

  if (payload.estatus_pago !== 'PAGADO' && typeof payload.fecha_pago !== 'undefined') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fecha_pago'],
      message: 'fecha_pago solo debe enviarse cuando estatus_pago es PAGADO'
    })
  }
})

export type ProviderPaymentUpdatePayload = z.infer<typeof providerPaymentUpdateSchema>

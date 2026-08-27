import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type PaymentMethodVsPaymentFormDrilldownRow = {
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  payment_method: string | null
  payment_form: string | null
  total: unknown
}

export type ResicoRetentionDrilldownRow = {
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  receiver_rfc: string
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  issuer_fiscal_regime: string | null
  has_resico_isr_retention: boolean
  total: unknown
}

export type ObjetoImpTaxDrilldownRow = {
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  receiver_rfc: string
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  objetoimp_tax_mismatch_reason: string | null
  total: unknown
}

export type PaymentMethodVsPaymentFormSummary = {
  cfdiCount: number
  amount: number
  supplierCount: number
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeUpperText(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

export function hasPaymentMethodVsPaymentFormViolation(params: {
  paymentMethod: string | null | undefined
  paymentForm: string | null | undefined
}) {
  return normalizeUpperText(params.paymentMethod) === 'PUE'
    && normalizeUpperText(params.paymentForm) === '99'
}

export function buildPaymentMethodVsPaymentFormViolationMessage() {
  return [
    'la validación "Método de pago vs Forma de pago" detectó que el CFDI tiene MetodoPago = PUE y FormaPago = 99.',
    'Cuando MetodoPago es PUE, la FormaPago no debe contener el valor 99.'
  ].join(' ')
}

export function hasResicoRetentionViolation(params: {
  issuerFiscalRegime: string | null | undefined
  receiverRfc: string | null | undefined
  hasResicoIsrRetention: boolean | null | undefined
}) {
  const receiverRfc = normalizeUpperText(params.receiverRfc)

  return normalizeUpperText(params.issuerFiscalRegime) === '626'
    && receiverRfc.length === 12
    && params.hasResicoIsrRetention !== true
}

export function buildResicoRetentionViolationMessage() {
  return [
    'Rechazado por Falta de Retención RESICO.',
    'El CFDI proviene de un emisor con RegimenFiscalEmisor = 626 (RESICO), el receptor corresponde a Persona Moral y no se localizó una Retención ISR con tasa exacta 0.012500.',
    'Deducción e IVA en riesgo si se paga así.'
  ].join(' ')
}

export function hasObjetoImpTaxViolation(params: {
  hasObjetoImpTaxMismatch: boolean | null | undefined
}) {
  return params.hasObjetoImpTaxMismatch === true
}

export function buildObjetoImpTaxViolationMessage(details?: string | null | undefined) {
  const header = [
    'Error de Coherencia de Impuestos en CFDI 4.0 (ObjetoImp vs IVA Trasladado Exento / No Exento).',
    'El SAT rechazará este amarre de IVA en sus prellenados y validaciones post-carga.'
  ].join(' ')
  if (!details) {
    return `${header} Consulte el detalle técnico de este archivo para revisar concepto por concepto.`
  }
  return `${header} Detalle por concepto y traslado: ${details}`
}

export async function getPaymentMethodVsPaymentFormRuleSummary(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const rows = await prisma.$queryRaw<Array<{
    cfdi_count: number
    amount: unknown
    supplier_count: number
  }>>(Prisma.sql`
    SELECT
      COUNT(*)::int AS cfdi_count,
      COALESCE(SUM(total), 0) AS amount,
      COUNT(DISTINCT issuer_rfc)::int AS supplier_count
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type <> 'P'
      AND UPPER(TRIM(COALESCE(payment_method, ''))) = 'PUE'
      AND UPPER(TRIM(COALESCE(payment_form, ''))) = '99'
      ${params.startDate ? Prisma.sql`AND issuance_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND issuance_date <= ${params.endDate}` : Prisma.empty}
  `)

  const row = rows[0]

  return {
    cfdiCount: Number(row?.cfdi_count || 0),
    amount: toNumber(row?.amount),
    supplierCount: Number(row?.supplier_count || 0)
  } satisfies PaymentMethodVsPaymentFormSummary
}

export async function listPaymentMethodVsPaymentFormRuleViolations(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  return prisma.$queryRaw<PaymentMethodVsPaymentFormDrilldownRow[]>(Prisma.sql`
    SELECT
      uuid,
      file_name,
      issuer_rfc,
      issuer_name,
      cfdi_type,
      series,
      folio,
      issuance_date,
      payment_method,
      payment_form,
      total
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type <> 'P'
      AND UPPER(TRIM(COALESCE(payment_method, ''))) = 'PUE'
      AND UPPER(TRIM(COALESCE(payment_form, ''))) = '99'
      ${params.startDate ? Prisma.sql`AND issuance_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND issuance_date <= ${params.endDate}` : Prisma.empty}
    ORDER BY issuance_date DESC NULLS LAST, uuid DESC
  `)
}

export async function getResicoRetentionRuleSummary(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const rows = await prisma.$queryRaw<Array<{
    cfdi_count: number
    amount: unknown
    supplier_count: number
  }>>(Prisma.sql`
    SELECT
      COUNT(*)::int AS cfdi_count,
      COALESCE(SUM(total), 0) AS amount,
      COUNT(DISTINCT issuer_rfc)::int AS supplier_count
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type <> 'P'
      AND UPPER(TRIM(COALESCE(issuer_fiscal_regime, ''))) = '626'
      AND LENGTH(TRIM(COALESCE(receiver_rfc, ''))) = 12
      AND has_resico_isr_retention = false
      ${params.startDate ? Prisma.sql`AND issuance_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND issuance_date <= ${params.endDate}` : Prisma.empty}
  `)

  const row = rows[0]

  return {
    cfdiCount: Number(row?.cfdi_count || 0),
    amount: toNumber(row?.amount),
    supplierCount: Number(row?.supplier_count || 0)
  } satisfies PaymentMethodVsPaymentFormSummary
}

export async function listResicoRetentionRuleViolations(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  return prisma.$queryRaw<ResicoRetentionDrilldownRow[]>(Prisma.sql`
    SELECT
      uuid,
      file_name,
      issuer_rfc,
      issuer_name,
      receiver_rfc,
      cfdi_type,
      series,
      folio,
      issuance_date,
      issuer_fiscal_regime,
      has_resico_isr_retention,
      total
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type <> 'P'
      AND UPPER(TRIM(COALESCE(issuer_fiscal_regime, ''))) = '626'
      AND LENGTH(TRIM(COALESCE(receiver_rfc, ''))) = 12
      AND has_resico_isr_retention = false
      ${params.startDate ? Prisma.sql`AND issuance_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND issuance_date <= ${params.endDate}` : Prisma.empty}
    ORDER BY issuance_date DESC NULLS LAST, uuid DESC
  `)
}

export async function getObjetoImpTaxRuleSummary(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const rows = await prisma.$queryRaw<Array<{
    cfdi_count: number
    amount: unknown
    supplier_count: number
  }>>(Prisma.sql`
    SELECT
      COUNT(*)::int AS cfdi_count,
      COALESCE(SUM(total), 0) AS amount,
      COUNT(DISTINCT issuer_rfc)::int AS supplier_count
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type <> 'P'
      AND has_objetoimp_tax_mismatch = true
      ${params.startDate ? Prisma.sql`AND issuance_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND issuance_date <= ${params.endDate}` : Prisma.empty}
  `)

  const row = rows[0]

  return {
    cfdiCount: Number(row?.cfdi_count || 0),
    amount: toNumber(row?.amount),
    supplierCount: Number(row?.supplier_count || 0)
  } satisfies PaymentMethodVsPaymentFormSummary
}

export async function listObjetoImpTaxRuleViolations(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  return prisma.$queryRaw<ObjetoImpTaxDrilldownRow[]>(Prisma.sql`
    SELECT
      uuid,
      file_name,
      issuer_rfc,
      issuer_name,
      receiver_rfc,
      cfdi_type,
      series,
      folio,
      issuance_date,
      objetoimp_tax_mismatch_reason,
      total
    FROM provider_uploaded_cfdis
    WHERE organization_id = ${params.organizationId}
      AND receiver_company_id = ${params.companyId}
      AND validation_status = 'APPROVED'
      AND cfdi_type <> 'P'
      AND has_objetoimp_tax_mismatch = true
      ${params.startDate ? Prisma.sql`AND issuance_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND issuance_date <= ${params.endDate}` : Prisma.empty}
    ORDER BY issuance_date DESC NULLS LAST, uuid DESC
  `)
}

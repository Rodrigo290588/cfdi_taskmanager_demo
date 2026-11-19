/**
 * Contrato de lectura para conciliar metadatos SAT con CFDI persistidos.
 * Los importes usan texto decimal para no perder precisión antes de presentarlos.
 */

export const FISCAL_CONTROL_ORIGINS = ['EMITIDO', 'RECIBIDO', 'NOMINA'] as const
export type FiscalControlOrigin = (typeof FISCAL_CONTROL_ORIGINS)[number]

export const FISCAL_CONTROL_RECONCILIATION_STATUSES = [
  'CONCILIADO',
  'METADATO_SIN_XML',
  'XML_SIN_METADATO',
  'XML_NO_DISPONIBLE',
  'CONFLICTO',
] as const
export type FiscalControlReconciliationStatus =
  (typeof FISCAL_CONTROL_RECONCILIATION_STATUSES)[number]

export const FISCAL_CONTROL_STATUS_DIFFERENCES = ['VIGENTE', 'CANCELADO'] as const
export type FiscalControlStatusDifference =
  (typeof FISCAL_CONTROL_STATUS_DIFFERENCES)[number]

export const FISCAL_CONTROL_XML_STORAGES = [
  'INVOICE_BLOB',
  'INVOICE_LEGACY_CONTENT',
  'PROVIDER_UPLOADED_CFDI_BLOB',
  'SAT_INVOICE_LEGACY_CONTENT',
  'SIN_XML',
] as const
export type FiscalControlXmlStorage = (typeof FISCAL_CONTROL_XML_STORAGES)[number]

export const FISCAL_CONTROL_COLUMN_FILTER_KEYS = [
  'uuid',
  'issuerRfc',
  'issuerName',
  'receiverRfc',
  'receiverName',
  'cfdiType',
  'total',
  'issuanceDate',
  'certificationDate',
  'cancelationDate',
  'certificationPac',
  'origins',
  'reconciliationStatus',
  'satStatus',
  'hasXml',
] as const
export type FiscalControlColumnFilterKey =
  (typeof FISCAL_CONTROL_COLUMN_FILTER_KEYS)[number]
export type FiscalControlColumnFilters = Readonly<
  Partial<Record<FiscalControlColumnFilterKey, string>>
>

export type FiscalControlSourceAvailability = Readonly<{
  origin: FiscalControlOrigin
  hasXml: boolean
  xmlStorage: Exclude<FiscalControlXmlStorage, 'SIN_XML'>
}>

export type FiscalControlNormalizedRow = Readonly<{
  uuid: string
  origins: readonly FiscalControlOrigin[]
  hasMetadata: boolean
  hasXml: boolean
  xmlStorage: FiscalControlXmlStorage
  reconciliationStatus: FiscalControlReconciliationStatus
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  cfdiType: string
  satStatus: string
  issuanceDate: Date | null
  payrollPaymentDate: Date | null
  total: string | null
  metadataTotal: string | null
  xmlTotal: string | null
  sourceAvailability: readonly FiscalControlSourceAvailability[]
}>

export type FiscalControlSourceCount = Readonly<{
  metadata: number
  xmlAvailable: number
  reconciled: number
  metadataWithoutXml: number
  xmlWithoutMetadata: number
  conflicts: number
}>

export type FiscalControlReconciliationSummary = Readonly<{
  byOrigin: Readonly<Record<FiscalControlOrigin, FiscalControlSourceCount>>
  consolidated: Readonly<{
    metadataTotal: number
    xmlTotal: number
    reconciled: number
    metadataWithoutXml: number
    xmlWithoutMetadata: number
    duplicateUuids: number
    conflicts: number
    metadataAmount: string
    xmlAmount: string
    absoluteAmountDifference: string
    differencePercent: number | null
  }>
}>

export type FiscalControlReconciliationFilters = Readonly<{
  organizationId: string
  companyId: string
  companyRfc: string
  fiscalEntityId?: string
  origins?: readonly FiscalControlOrigin[]
  rfc?: string
  cfdiType?: string
  satStatus?: string
  columnFilters?: FiscalControlColumnFilters
  issuanceStartDate?: Date
  issuanceEndDate?: Date
  payrollPaymentStartDate?: Date
  payrollPaymentEndDate?: Date
}>

export const FISCAL_CONTROL_ASYNC_EXPORT_THRESHOLD = 10_000

export function normalizeFiscalControlUuid(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

export function hasFiscalControlOrigin(
  origins: readonly FiscalControlOrigin[],
  origin: FiscalControlOrigin,
): boolean {
  return origins.includes(origin)
}

import type {
  FiscalControlNormalizedRow,
  FiscalControlOrigin,
} from '@/lib/fiscal-control-conciliation-types'

export function canAccessFiscalControlOrganization(
  allowedOrganizationIds: ReadonlySet<string>,
  targetOrganizationId: string | null,
): boolean {
  return Boolean(targetOrganizationId && allowedOrganizationIds.has(targetOrganizationId))
}

function mapCfdiType(value: string): string {
  const map: Record<string, string> = {
    I: 'INGRESO',
    E: 'EGRESO',
    T: 'TRASLADO',
    N: 'NOMINA',
    P: 'PAGO',
  }
  return map[value] ?? (value || 'DESCONOCIDO')
}

function mapSatStatus(value: string): string {
  if (value === '1') return 'VIGENTE'
  if (value === '0') return 'CANCELADO'
  return value || 'SIN_ESTATUS'
}

export function mapFiscalControlConciliationRow(row: FiscalControlNormalizedRow) {
  return {
    uuid: row.uuid,
    issuerRfc: row.issuerRfc,
    issuerName: row.issuerName,
    receiverRfc: row.receiverRfc,
    receiverName: row.receiverName,
    issuanceDate: row.issuanceDate?.toISOString() ?? '',
    total: Number(row.total ?? 0),
    totalDecimal: row.total,
    metadataTotal: row.metadataTotal,
    xmlTotal: row.xmlTotal,
    satStatus: mapSatStatus(row.satStatus),
    hasXml: row.hasXml,
    xmlContent: '',
    cfdiType: mapCfdiType(row.cfdiType),
    series: '',
    folio: '',
    currency: 'MXN',
    exchangeRate: 1,
    subtotal: 0,
    discount: 0,
    ivaTrasladado: 0,
    ivaRetenido: 0,
    isrRetenido: 0,
    iepsRetenido: 0,
    certificationDate: '',
    cancelationDate: null,
    certificationPac: '',
    paymentMethod: '',
    paymentForm: '',
    usageCfdi: '',
    expeditionPlace: '',
    origins: row.origins,
    reconciliationStatus: row.reconciliationStatus,
    xmlStorage: row.xmlStorage,
    payrollPaymentDate: row.payrollPaymentDate?.toISOString() ?? null,
    sourceAvailability: row.sourceAvailability,
  }
}

export function buildFiscalControlPageReconciliationSummary(
  rows: readonly FiscalControlNormalizedRow[],
) {
  const origins: FiscalControlOrigin[] = ['EMITIDO', 'RECIBIDO', 'NOMINA']
  const sourceCounts = {
    metadata: rows.filter(row => row.hasMetadata).length,
    emitidos: rows.filter(row => row.origins.includes('EMITIDO')).length,
    recibidos: rows.filter(row => row.origins.includes('RECIBIDO')).length,
    nomina: rows.filter(row => row.origins.includes('NOMINA')).length,
  }

  return {
    scope: 'PAGE' as const,
    sourceCounts,
    reconciliationSummary: {
      totalRows: rows.length,
      reconciled: rows.filter(row => row.reconciliationStatus === 'CONCILIADO').length,
      metadataWithoutXml: rows.filter(row => row.reconciliationStatus === 'METADATO_SIN_XML').length,
      xmlWithoutMetadata: rows.filter(row => row.reconciliationStatus === 'XML_SIN_METADATO').length,
      xmlUnavailable: rows.filter(row => row.reconciliationStatus === 'XML_NO_DISPONIBLE').length,
      conflicts: rows.filter(row => row.reconciliationStatus === 'CONFLICTO').length,
      byOrigin: Object.fromEntries(
        origins.map(origin => [
          origin,
          rows.filter(row => row.origins.includes(origin)).length,
        ]),
      ) as Record<FiscalControlOrigin, number>,
    },
  }
}

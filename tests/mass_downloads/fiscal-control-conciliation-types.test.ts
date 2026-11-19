import {
  FISCAL_CONTROL_ASYNC_EXPORT_THRESHOLD,
  FISCAL_CONTROL_COLUMN_FILTER_KEYS,
  FISCAL_CONTROL_ORIGINS,
  FISCAL_CONTROL_RECONCILIATION_STATUSES,
  FISCAL_CONTROL_XML_STORAGES,
  hasFiscalControlOrigin,
  normalizeFiscalControlUuid,
} from '@/lib/fiscal-control-conciliation-types'

describe('fiscal control multi-origin contract', () => {
  it('normalizes UUID values before cross-source reconciliation', () => {
    expect(normalizeFiscalControlUuid(' 3eb6955e-27e4-4796-958e-48f149f43401 ')).toBe(
      '3EB6955E-27E4-4796-958E-48F149F43401',
    )
  })

  it('defines only the approved XML origins and safe storage indicators', () => {
    expect(FISCAL_CONTROL_ORIGINS).toEqual(['EMITIDO', 'RECIBIDO', 'NOMINA'])
    expect(FISCAL_CONTROL_XML_STORAGES).toEqual([
      'INVOICE_BLOB',
      'INVOICE_LEGACY_CONTENT',
      'PROVIDER_UPLOADED_CFDI_BLOB',
      'SAT_INVOICE_LEGACY_CONTENT',
      'SIN_XML',
    ])
    expect(FISCAL_CONTROL_RECONCILIATION_STATUSES).toContain('CONFLICTO')
  })

  it('accepts only approved cross-source filter columns', () => {
    expect(FISCAL_CONTROL_COLUMN_FILTER_KEYS).toContain('uuid')
    expect(FISCAL_CONTROL_COLUMN_FILTER_KEYS).toContain('issuerRfc')
    expect(FISCAL_CONTROL_COLUMN_FILTER_KEYS).not.toContain('xmlContent')
    expect(FISCAL_CONTROL_COLUMN_FILTER_KEYS).not.toContain('organizationId')
  })

  it('supports a consolidated row with more than one origin', () => {
    expect(hasFiscalControlOrigin(['EMITIDO', 'RECIBIDO'], 'EMITIDO')).toBe(true)
    expect(hasFiscalControlOrigin(['EMITIDO', 'RECIBIDO'], 'NOMINA')).toBe(false)
  })

  it('uses the approved asynchronous export threshold', () => {
    expect(FISCAL_CONTROL_ASYNC_EXPORT_THRESHOLD).toBe(10_000)
  })
})

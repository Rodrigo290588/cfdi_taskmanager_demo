import { afterEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}))

import {
  __testables,
  consolidateFiscalControlCandidates,
  readFiscalControlGlobalReconciliationSummary,
  readFiscalControlMonthlyTypeDistribution,
  readFiscalControlStatusDifferences,
} from '@/lib/fiscal-control-conciliation-service'
import { prisma } from '@/lib/prisma'

const mockQueryRaw = prisma.$queryRaw as unknown as jest.Mock
const mockExecuteRaw = prisma.$executeRaw as unknown as jest.Mock
const mockTransaction = prisma.$transaction as unknown as jest.Mock

afterEach(() => {
  mockExecuteRaw.mockReset()
  mockQueryRaw.mockReset()
  mockTransaction.mockReset()
})

describe('fiscal control multi-origin consolidation', () => {
  it('consolidates matching metadata and received XML by normalized UUID', () => {
    const rows = consolidateFiscalControlCandidates([
      {
        uuid: ' 3eb6955e-27e4-4796-958e-48f149f43401 ',
        hasMetadata: true,
        hasXml: false,
        xmlStorage: 'SIN_XML',
        issuerRfc: 'AAA010101AAA',
        issuerName: 'Proveedor',
        receiverRfc: 'DMC750410C41',
        receiverName: 'Empresa',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-09T12:00:00.000Z'),
        payrollPaymentDate: null,
        total: '1500.50',
      },
      {
        uuid: '3EB6955E-27E4-4796-958E-48F149F43401',
        origin: 'RECIBIDO',
        hasMetadata: false,
        hasXml: true,
        xmlStorage: 'PROVIDER_UPLOADED_CFDI_BLOB',
        issuerRfc: 'AAA010101AAA',
        issuerName: 'Proveedor',
        receiverRfc: 'DMC750410C41',
        receiverName: 'Empresa',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-09T12:00:00.000Z'),
        payrollPaymentDate: null,
        total: '1500.50',
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      uuid: '3EB6955E-27E4-4796-958E-48F149F43401',
      origins: ['RECIBIDO'],
      reconciliationStatus: 'CONCILIADO',
      hasMetadata: true,
      hasXml: true,
    })
  })

  it('marks amount mismatches as conflicts without changing decimal values', () => {
    const rows = consolidateFiscalControlCandidates([
      {
        uuid: 'A',
        hasMetadata: true,
        hasXml: false,
        xmlStorage: 'SIN_XML',
        issuerRfc: '',
        issuerName: '',
        receiverRfc: '',
        receiverName: '',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-01T00:00:00.000Z'),
        payrollPaymentDate: null,
        total: '100.01',
      },
      {
        uuid: 'A',
        origin: 'EMITIDO',
        hasMetadata: false,
        hasXml: true,
        xmlStorage: 'INVOICE_BLOB',
        issuerRfc: '',
        issuerName: '',
        receiverRfc: '',
        receiverName: '',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-01T00:00:00.000Z'),
        payrollPaymentDate: null,
        total: '100.02',
      },
    ])

    expect(rows[0]).toMatchObject({
      reconciliationStatus: 'CONFLICTO',
      metadataTotal: '100.01',
      xmlTotal: '100.02',
    })
  })

  it('does not report a received row without a blob as available XML', () => {
    const rows = consolidateFiscalControlCandidates([
      {
        uuid: 'B',
        origin: 'RECIBIDO',
        hasMetadata: false,
        hasXml: false,
        xmlStorage: 'SIN_XML',
        issuerRfc: 'AAA010101AAA',
        issuerName: 'Proveedor',
        receiverRfc: 'DMC750410C41',
        receiverName: 'Empresa',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-01T00:00:00.000Z'),
        payrollPaymentDate: null,
        total: '100.00',
      },
    ])

    expect(rows[0]).toMatchObject({
      hasXml: false,
      xmlStorage: 'SIN_XML',
      reconciliationStatus: 'XML_NO_DISPONIBLE',
    })
  })

  it('classifies metadata-only, XML-only, and conflicting duplicate UUIDs', () => {
    const rows = consolidateFiscalControlCandidates([
      {
        uuid: 'metadata-only',
        hasMetadata: true,
        hasXml: false,
        xmlStorage: 'SIN_XML',
        issuerRfc: '',
        issuerName: '',
        receiverRfc: '',
        receiverName: '',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-01T00:00:00.000Z'),
        payrollPaymentDate: null,
        total: '100.00',
      },
      {
        uuid: 'xml-only',
        origin: 'EMITIDO',
        hasMetadata: false,
        hasXml: true,
        xmlStorage: 'INVOICE_BLOB',
        issuerRfc: '',
        issuerName: '',
        receiverRfc: '',
        receiverName: '',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-02T00:00:00.000Z'),
        payrollPaymentDate: null,
        total: '200.00',
      },
      {
        uuid: 'duplicate-conflict',
        origin: 'EMITIDO',
        hasMetadata: false,
        hasXml: true,
        xmlStorage: 'INVOICE_BLOB',
        issuerRfc: '',
        issuerName: '',
        receiverRfc: '',
        receiverName: '',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-03T00:00:00.000Z'),
        payrollPaymentDate: null,
        total: '300.00',
      },
      {
        uuid: 'duplicate-conflict',
        origin: 'RECIBIDO',
        hasMetadata: false,
        hasXml: true,
        xmlStorage: 'PROVIDER_UPLOADED_CFDI_BLOB',
        issuerRfc: '',
        issuerName: '',
        receiverRfc: '',
        receiverName: '',
        cfdiType: 'I',
        satStatus: 'VIGENTE',
        issuanceDate: new Date('2024-12-03T00:00:00.000Z'),
        payrollPaymentDate: null,
        total: '300.01',
      },
    ])

    expect(rows.find(row => row.uuid === 'METADATA-ONLY')).toMatchObject({
      reconciliationStatus: 'METADATO_SIN_XML',
    })
    expect(rows.find(row => row.uuid === 'XML-ONLY')).toMatchObject({
      reconciliationStatus: 'XML_SIN_METADATO',
    })
    expect(rows.find(row => row.uuid === 'DUPLICATE-CONFLICT')).toMatchObject({
      origins: ['EMITIDO', 'RECIBIDO'],
      reconciliationStatus: 'CONFLICTO',
    })
  })

  it('uses bounded page sizes and validates opaque cursors', () => {
    const cursor = __testables.encodeCursor({
      v: 1,
      issuanceDate: '2024-12-01T00:00:00.000Z',
      uuid: 'abc',
    })

    expect(__testables.decodeCursor(cursor)).toMatchObject({ uuid: 'abc' })
    expect(__testables.decodeCursor('not-a-cursor')).toBeNull()
    expect(__testables.getPageSize(10_000)).toBe(100)
    expect(__testables.getPageSize(undefined)).toBe(50)
  })

  it('preserves canonical UUID case when reading source details', () => {
    expect(__testables.normalizeDetailLookupUuids([
      '3eb6955e-27e4-4796-958e-48f149f43401',
      ' 3EB6955E-27E4-4796-958E-48F149F43401 ',
      '',
    ])).toEqual([
      '3EB6955E-27E4-4796-958E-48F149F43401',
      '3EB6955E-27E4-4796-958E-48F149F43401',
    ])
  })

  it('normalizes business filters for sources with different SAT representations', () => {
    expect(__testables.normalizeCfdiType('INGRESO')).toBe('I')
    expect(__testables.normalizeCfdiType('nomina')).toBe('N')
    expect(__testables.normalizeStoredCfdiType('INGRESO')).toBe('INGRESO')
    expect(__testables.normalizeStoredCfdiType('N')).toBe('NOMINA')
    expect(__testables.normalizeMetadataSatStatus('VIGENTE')).toBe('1')
    expect(__testables.normalizeMetadataSatStatus('CANCELADO')).toBe('0')
  })

  it('returns the database aggregate without reading XML ciphertext', async () => {
    mockExecuteRaw.mockResolvedValueOnce(0)
    mockQueryRaw.mockResolvedValueOnce([
      {
        totalRows: BigInt(6),
        metadata: BigInt(4),
        emitidos: BigInt(2),
        recibidos: BigInt(3),
        nomina: BigInt(1),
        reconciled: BigInt(2),
        metadataWithoutXml: BigInt(1),
        xmlWithoutMetadata: BigInt(1),
        xmlUnavailable: BigInt(1),
        conflicts: BigInt(1),
        metadataVigentes: BigInt(3),
        metadataCancelados: BigInt(1),
        xmlVigentes: BigInt(4),
        xmlCancelados: BigInt(1),
      },
    ])
    mockTransaction.mockImplementationOnce(async statements => Promise.all(statements))

    const summary = await readFiscalControlGlobalReconciliationSummary({
      organizationId: 'org-1',
      companyId: 'company-1',
      companyRfc: 'DMC750410C41',
      fiscalEntityId: 'entity-1',
      origins: ['EMITIDO', 'RECIBIDO', 'NOMINA'],
      rfc: 'AAA010101AAA',
      cfdiType: 'INGRESO',
      satStatus: 'VIGENTE',
      columnFilters: {
        issuerRfc: 'AAA010101AAA',
        origins: 'Recibido',
        reconciliationStatus: 'Conciliado',
        satStatus: 'Vigente',
        hasXml: 'XML',
      },
      issuanceStartDate: new Date('2024-12-01T00:00:00.000Z'),
      issuanceEndDate: new Date('2024-12-31T23:59:59.999Z'),
    })

    expect(summary).toEqual({
      scope: 'RANGE',
      sourceCounts: {
        metadata: 4,
        emitidos: 2,
        recibidos: 3,
        nomina: 1,
      },
      reconciliationSummary: {
        totalRows: 6,
        reconciled: 2,
        metadataWithoutXml: 1,
        xmlWithoutMetadata: 1,
        xmlUnavailable: 1,
        conflicts: 1,
      },
      statusComparison: {
        vigentes: {
          metadata: 3,
          xml: 4,
          difference: -1,
        },
        cancelados: {
          metadata: 1,
          xml: 1,
          difference: 0,
        },
      },
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1)
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)

    const [query] = mockQueryRaw.mock.calls[0] as [
      { strings: readonly string[]; values: readonly unknown[] },
    ]
    const queryText = query.strings.join(' ')
    expect(queryText).toContain('WITH candidates')
    expect(queryText).toContain('GROUP BY uuid')
    expect(queryText).toContain('CONCAT_WS')
    expect(queryText).toContain('reconciliation_status')
    expect(queryText).toContain('metadataVigentes')
    expect(queryText).toContain('xmlCancelados')
    expect(queryText).toContain('UPPER(BTRIM(p."sat_estado"))')
    expect(queryText).not.toContain('xml_ciphertext')
    expect(query.values).toEqual(expect.arrayContaining(['org-1', 'company-1', 'entity-1']))
  })

  it('returns only UUIDs with a mismatched requested status', async () => {
    mockExecuteRaw.mockResolvedValueOnce(0)
    mockQueryRaw.mockResolvedValueOnce([
      {
        uuid: 'STATUS-DIFFERENCE-1',
        issuanceDate: new Date('2024-12-20T00:00:00.000Z'),
        issuerRfc: 'AAA010101AAA',
        issuerName: 'Proveedor',
        receiverRfc: 'DMC750410C41',
        receiverName: 'Empresa',
        cfdiType: 'INGRESO',
        total: { toFixed: () => '123.45' },
        metadataVigente: true,
        metadataCancelado: false,
        xmlVigente: false,
        xmlCancelado: true,
        origins: ['EMITIDO'],
      },
    ])
    mockTransaction.mockImplementationOnce(async statements => Promise.all(statements))

    const rows = await readFiscalControlStatusDifferences({
      organizationId: 'org-1',
      companyId: 'company-1',
      companyRfc: 'DMC750410C41',
      fiscalEntityId: 'entity-1',
      issuanceStartDate: new Date('2024-12-01T00:00:00.000Z'),
      issuanceEndDate: new Date('2024-12-31T23:59:59.999Z'),
    }, 'VIGENTE')

    expect(rows).toEqual([expect.objectContaining({
      uuid: 'STATUS-DIFFERENCE-1',
      metadataStatus: 'VIGENTE',
      xmlStatus: 'CANCELADO',
      total: '123.45',
    })])
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('consolidates monthly amounts by source and preserves the payment amount', async () => {
    mockExecuteRaw.mockResolvedValueOnce(0)
    mockQueryRaw.mockResolvedValueOnce([
      {
        source: 'METADATA',
        month: new Date('2024-12-01T00:00:00.000Z'),
        cfdiType: 'I',
        total: { toString: () => '450.25' },
      },
      {
        source: 'XML',
        month: new Date('2024-12-01T00:00:00.000Z'),
        cfdiType: 'PAGO',
        total: { toString: () => '125.50' },
      },
    ])
    mockTransaction.mockImplementationOnce(async statements => Promise.all(statements))

    const rows = await readFiscalControlMonthlyTypeDistribution({
      organizationId: 'org-1',
      companyId: 'company-1',
      companyRfc: 'DMC750410C41',
      fiscalEntityId: 'entity-1',
      origins: ['EMITIDO', 'RECIBIDO', 'NOMINA'],
      issuanceStartDate: new Date('2024-12-01T00:00:00.000Z'),
      issuanceEndDate: new Date('2024-12-31T23:59:59.999Z'),
    })

    expect(rows).toEqual([{
      month: '2024-12',
      metadata: {
        ingresos: 450.25,
        egresos: 0,
        nomina: 0,
        pagos: 0,
        traslados: 0,
      },
      xml: {
        ingresos: 0,
        egresos: 0,
        nomina: 0,
        pagos: 125.5,
        traslados: 0,
      },
    }])

    const [query] = mockQueryRaw.mock.calls[0] as [
      { strings: readonly string[] },
    ]
    const queryText = query.strings.join(' ')
    expect(queryText).toContain('GROUP BY source, uuid')
    expect(queryText).toContain('montoTotalPagos')
    expect(queryText).toContain('montoPagado')
  })
})

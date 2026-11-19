import { describe, expect, it } from '@jest/globals'

import {
  buildFiscalControlPageReconciliationSummary,
  canAccessFiscalControlOrganization,
  mapFiscalControlConciliationRow,
} from '@/lib/fiscal-control-response-adapter'

const receivedRow = {
  uuid: '3EB6955E-27E4-4796-958E-48F149F43401',
  origins: ['RECIBIDO'] as const,
  hasMetadata: true,
  hasXml: true,
  xmlStorage: 'PROVIDER_UPLOADED_CFDI_BLOB' as const,
  reconciliationStatus: 'CONCILIADO' as const,
  issuerRfc: 'AAA010101AAA',
  issuerName: 'Proveedor',
  receiverRfc: 'DMC750410C41',
  receiverName: 'Empresa de prueba',
  cfdiType: 'I',
  satStatus: 'VIGENTE',
  issuanceDate: new Date('2024-12-09T12:00:00.000Z'),
  payrollPaymentDate: null,
  total: '100.00',
  metadataTotal: '100.00',
  xmlTotal: '100.00',
  sourceAvailability: [
    {
      origin: 'RECIBIDO' as const,
      hasXml: true,
      xmlStorage: 'PROVIDER_UPLOADED_CFDI_BLOB' as const,
    },
  ],
}

describe('adaptador de respuesta de Fiscal Control', () => {
  it('mantiene los campos heredados y agrega conciliación sin contenido XML', () => {
    expect(mapFiscalControlConciliationRow(receivedRow)).toMatchObject({
      uuid: receivedRow.uuid,
      cfdiType: 'INGRESO',
      origins: ['RECIBIDO'],
      reconciliationStatus: 'CONCILIADO',
      xmlContent: '',
    })
  })

  it('resume los orígenes y estados de la página actual', () => {
    expect(buildFiscalControlPageReconciliationSummary([receivedRow])).toMatchObject({
      scope: 'PAGE',
      sourceCounts: {
        metadata: 1,
        emitidos: 0,
        recibidos: 1,
        nomina: 0,
      },
      reconciliationSummary: {
        reconciled: 1,
      },
    })
  })

  it('bloquea la organización que no pertenece a la membresía activa', () => {
    expect(canAccessFiscalControlOrganization(new Set(['org-a']), 'org-a')).toBe(true)
    expect(canAccessFiscalControlOrganization(new Set(['org-a']), 'org-b')).toBe(false)
    expect(canAccessFiscalControlOrganization(new Set(['org-a']), null)).toBe(false)
  })
})

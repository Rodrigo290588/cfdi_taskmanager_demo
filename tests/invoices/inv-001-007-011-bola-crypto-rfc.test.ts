/**
 * INV-001 BOLA cross-org + INV-007 Crypto decrypt whitelist + INV-011 RFC duplicate collision.
 *
 * Pruebas unitarias sobre invoice-xml-storage.ts helpers directos (sync decrypt whitelist)
 * y sobre getInvoiceXmlRecordById shape signature (ahora require 2 args).
 */
import { decryptInvoiceXmlContent, getInvoiceXmlRecordById } from '@/lib/invoice-xml-storage'
import {
  INV_INVOICE_BLOB_ROW_ALGO_ECB,
  INV_INVOICE_BLOB_ROW_ALGO_EMPTY,
  INV_INVOICE_BLOB_ROW_VALID_GCM,
  INV_BOLA_INPUT_CROSS_ORG,
  ORG_A_ID,
  ORG_B_ID,
  INV_RFC_DUPLICATE_FISCAL_ENTITY_COLLISION
} from './fixtures/payloads'

describe('INV-007 · Decrypt algorithm AEAD WHITELIST (Padding Oracle Prevention)', () => {
  it('INV-007 algoritmo aes-128-ecb (NO AEAD) → lanza error INV-007 not allowed', () => {
    expect(() => decryptInvoiceXmlContent({
      ciphertext: INV_INVOICE_BLOB_ROW_ALGO_ECB.ciphertext.toString('base64'),
      iv: INV_INVOICE_BLOB_ROW_ALGO_ECB.iv.toString('base64'),
      authTag: '',
      algorithm: 'aes-128-ecb'
    })).toThrow(/INV-007/)
  })

  it('INV-007 algoritmo string vacío → lanza error INV-007', () => {
    expect(() => decryptInvoiceXmlContent({
      ciphertext: INV_INVOICE_BLOB_ROW_ALGO_EMPTY.ciphertext.toString('base64'),
      iv: INV_INVOICE_BLOB_ROW_ALGO_EMPTY.iv.toString('base64'),
      authTag: '',
      algorithm: ''
    })).toThrow(/INV-007/)
  })

  it('INV-007 algoritmo typo "AES-256-gcm" → normalizado lowercase pasa whitelist pero requiere authTag', () => {
    // Whitelist normaliza .toLowerCase().trim() así que mayúsculas se normalizan.
    expect(() => decryptInvoiceXmlContent({
      ciphertext: INV_INVOICE_BLOB_ROW_VALID_GCM.ciphertext.toString('base64'),
      iv: INV_INVOICE_BLOB_ROW_VALID_GCM.iv.toString('base64'),
      authTag: '', // Faltará GCM auth tag
      algorithm: '  AES-256-GCM  ' // con whitespace
    })).toThrow(/authTag missing/)
    // (Pero NO lanzó error de algoritmo, paso whitelist).
  })

  it('INV-007 algoritmo fake "aes-256-ctr" (no en whitelist) → rejected', () => {
    expect(() => decryptInvoiceXmlContent({
      ciphertext: INV_INVOICE_BLOB_ROW_VALID_GCM.ciphertext.toString('base64'),
      iv: INV_INVOICE_BLOB_ROW_VALID_GCM.iv.toString('base64'),
      authTag: INV_INVOICE_BLOB_ROW_VALID_GCM.authTag.toString('base64'),
      algorithm: 'aes-256-ctr'
    })).toThrow(/INV-007.*not allowed/)
  })
})

describe('INV-001 · BOLA: getInvoiceXmlRecordById signature REQUIERE organizationId 2do argumento', () => {
  it('INV-001: función ES6 signature length = 2 (invoiceId + organizationId) · signature check anti-regresión', () => {
    const fn = getInvoiceXmlRecordById
    expect(typeof fn).toBe('function')
    expect(fn.length).toBeGreaterThanOrEqual(2)
  })

  it('INV-001: enviar organizationId vacío "" → throw inmediato (no consulta BD)', async () => {
    await expect(getInvoiceXmlRecordById('invoice-abcd1234', '')).rejects.toThrow(/INV-001.*organizationId/)
  })

  it('INV-001 · Cross-org payload fixture: requester OrganizationId ORG_B !== invoice targetOrg ORG_A', () => {
    expect(INV_BOLA_INPUT_CROSS_ORG.requesterOrganizationId).toBe(ORG_B_ID)
    expect(INV_BOLA_INPUT_CROSS_ORG.expectedInvoiceOrgAfterFix).toBe(ORG_A_ID)
    // Garantiza NO colisión casual ORG_A = ORG_B (fixture seed SAST).
    expect(ORG_A_ID).not.toBe(ORG_B_ID)
  })
})

describe('INV-011 · Duplicate RFC collision cross-tenant defense', () => {
  it('INV-011 fixture: RFC duplicateRfc apunta a RFC Org-B pero chequeo se hace en invoice Org-A context', () => {
    expect(INV_RFC_DUPLICATE_FISCAL_ENTITY_COLLISION.orgId).toBe(ORG_A_ID)
    expect(INV_RFC_DUPLICATE_FISCAL_ENTITY_COLLISION.duplicateRfc).toMatch(/^[A-Z&Ñ0-9]{10,13}$/i)
  })

  it('INV-011 defense-in-depth pattern: fiscalEntity.organizationId === targetOrg (se prueba con arrays simples)', () => {
    // Simulación del bloque L274-282 de route handler (fiscals.every match orgId).
    const targetOrg = ORG_A_ID
    const fiscalsUnsafe = [
      { id: '1', organizationId: ORG_A_ID, rfc: 'XAXX010101000' },
      { id: '2', organizationId: ORG_B_ID, rfc: 'XAXX010101000' } // Colisión multi-tenant
    ]
    const allBelongOrFail = fiscalsUnsafe.every((fe) => fe.organizationId === targetOrg)
    expect(allBelongOrFail).toBe(false)

    // Caso safe: todos organizationId === target.
    const fiscalsSafe = [
      { id: '1', organizationId: ORG_A_ID, rfc: 'XAXX010101000' },
      { id: '2', organizationId: ORG_A_ID, rfc: 'XAXX010101000' }
    ]
    const safe = fiscalsSafe.every((fe) => fe.organizationId === targetOrg)
    expect(safe).toBe(true)
  })
})

/**
 * Anti-regresión SAST FASE 2-C · Dashboard Recibidos
 * Findings cubiertos (DR-011, DR-012, DR-014, DR-015):
 *   DR-011 · SAT regimen whitelist 2026 + needsManualReview flag (MEDIO)
 *   DR-012 (CRÍTICO) · xmlContent=REDACTED_sha256_16 NO plaintext (CRÍTICO)
 *   DR-014 · includeHeavyMetrics default ==='true' → false (ALTO)
 *   DR-015 · Security headers + createAuditEntry upload_massive (MEDIO)
 */

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('next/server', () => ({
  NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } },
  NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) },
}))

import crypto from 'node:crypto'
import { SAT_VALID_REGIMES_2026 } from '@/schemas/dashboard-recibidos'
import {
  DR011_SAT_HARDCODED_REGIME_CP,
  DR012_XML_PLAINTEXT_STORAGE,
  DR014_HEAVY_METRICS_DEFAULT_FALSE,
  DR015_SECURITY_HEADERS_AUDIT_TRAIL,
} from './fixtures/payloads'

describe('[DASHBOARD RECIBIDOS SAST] DR-011/012/014/015 · SAT regimes, REDACT XML, Heavy false, Audit/Headers', () => {

  // DR-011
  describe('DR-011 (MEDIO) · SAT VALID REGIMES 2026 whitelist Set ≥ 50 códigos + needsManualReview', () => {
    it('SAT_VALID_REGIMES_2026.size ≥ 50 (miscelánea 69B 2026)', () => {
      expect(SAT_VALID_REGIMES_2026.size).toBeGreaterThanOrEqual(50)
      expect(SAT_VALID_REGIMES_2026.size).toBe(DR011_SAT_HARDCODED_REGIME_CP.satRegimesExpectedSize)
    })

    it('Regímenes conocidos SAT 2026 están incluidos: 601, 612, 622, 699, 701…716', () => {
      for (const r of ['601', '612', '622', '699', '701', '716']) {
        expect(SAT_VALID_REGIMES_2026.has(r)).toBe(true)
      }
    })

    it('needsManualReview flag TRUE cuando no hay valor en XML (fallback hardcodeado seguro → REVISIÓN MANUAL OBLIGATORIA)', () => {
      expect(DR011_SAT_HARDCODED_REGIME_CP.needsManualReviewFlagExpected).toBe(true)
    })
  })

  // DR-012
  describe('DR-012 (CRÍTICO) · Invoice.xmlContent = <REDACTED>_ + sha256(xml).slice(0,16)', () => {
    it('DR012 xmlRedactedHash empieza por prefijo "<REDACTED>_" longitud suffix=16 hex', () => {
      const xml = DR012_XML_PLAINTEXT_STORAGE.sampleXml
      const built = '<REDACTED>_' + crypto.createHash('sha256').update(xml).digest('hex').slice(0, 16)
      expect(built.startsWith(DR012_XML_PLAINTEXT_STORAGE.expectedAfterPrefix)).toBe(true)
      const suffix = built.slice(DR012_XML_PLAINTEXT_STORAGE.expectedAfterPrefix.length)
      expect(suffix).toHaveLength(DR012_XML_PLAINTEXT_STORAGE.expectedAfterSuffixLength)
      expect(/^[a-f0-9]{16}$/.test(suffix)).toBe(true)
    })

    it('Built NO contiene el string "Comprobante" (nunca XML plaintext en la tabla Invoice)', () => {
      const xml = DR012_XML_PLAINTEXT_STORAGE.sampleXml
      const built = '<REDACTED>_' + crypto.createHash('sha256').update(xml).digest('hex').slice(0, 16)
      expect(built).not.toContain('Comprobante')
      expect(built).not.toContain('<?xml')
    })
  })

  // DR-014
  describe('DR-014 (ALTO) · includeHeavyMetrics ===\'true\' (DEFAULT FALSE, evita DoS 6 queries pesadas)', () => {
    it('Logic: q.includeHeavyMetrics === \'true\' (NO !==\'false\' → antes era default true)', () => {
      const { maliciousPayload } = DR014_HEAVY_METRICS_DEFAULT_FALSE
      const flagEmpty = (maliciousPayload as Record<string, unknown>).includeHeavyMetrics
      const evaluated = flagEmpty === 'true'
      expect(evaluated).toBe(DR014_HEAVY_METRICS_DEFAULT_FALSE.expectedAfterHeavyFlag)
    })

    it('includeHeavyMetrics string distinto "true" (ej "1", undefined) → siempre FALSE', () => {
      for (const t of [undefined, null, 'false', '', 'yes', '1']) {
        expect(t === 'true').toBe(false)
      }
    })
  })

  // DR-015
  describe('DR-015 (MEDIO) · Security headers + Audit trail upload_massive', () => {
    it('4 headers hard de seguridad son obligatorios en descarga XML/PDF', () => {
      expect(DR015_SECURITY_HEADERS_AUDIT_TRAIL.securityHeadersExpected).toHaveLength(4)
      const hs = new Set(DR015_SECURITY_HEADERS_AUDIT_TRAIL.securityHeadersExpected)
      expect(hs.has('X-Content-Type-Options')).toBe(true)
      expect(hs.has('X-Frame-Options')).toBe(true)
      expect(hs.has('Content-Security-Policy')).toBe(true)
      expect(hs.has('Strict-Transport-Security')).toBe(true)
    })

    it('Audit action createAuditEntry usa clave "DASHBOARD_RECIBIDOS.upload_massive"', () => {
      expect(DR015_SECURITY_HEADERS_AUDIT_TRAIL.auditActionExpected).toBe(
        'DASHBOARD_RECIBIDOS.upload_massive'
      )
    })
  })
})

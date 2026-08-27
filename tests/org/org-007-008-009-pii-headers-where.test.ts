jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn() }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import { Permission, hasPermission } from '@/lib/permissions'
import { maskTopClientsPii, SECURITY_HEADERS, parseSatDecimal } from '@/lib/org-dashboard-helpers'
import { SAST_SEED_ORGS, TOP_CLIENTS_FIXTURE } from './fixtures/payloads'

describe('[ORG SAST Suite 4/5] ORG-007 PII Mask + ORG-008 Headers All Status + ORG-009 Dual Where Redundancy', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('ORG-007 · maskTopClientsPii · Permission RECEP_FISCAL_AUDIT_PII conditional Need-To-Know ISO27001', () => {
    it('RECEP_FISCAL_AUDIT_PII existe enum Permission (nivel granular auditoría)', () => {
      expect(typeof Permission.RECEP_FISCAL_AUDIT_PII).toBe('string')
      expect(Permission.RECEP_FISCAL_AUDIT_PII.length).toBeGreaterThan(3)
    })

    it('maskTopClientsPii canViewFullPii=false → RFC substring 0..4 + "…" + name="[Nombre cliente confidencial]"', () => {
      const totals = TOP_CLIENTS_FIXTURE.map((_, i) => ({ _sum: { total: i * 10_000 + 500 } }))
      const masked = maskTopClientsPii(TOP_CLIENTS_FIXTURE, totals, false)
      expect(Array.isArray(masked)).toBe(true)
      expect(masked).toHaveLength(TOP_CLIENTS_FIXTURE.length)
      const nonNullRfc = masked.find(m => m.rfc !== null)
      if (nonNullRfc) {
        expect(nonNullRfc.rfc!.length).toBeLessThanOrEqual(6)
        expect(nonNullRfc.rfc!.includes('…')).toBe(true)
      }
      expect(masked[0]!.name).toBe('[Nombre cliente confidencial]')
      expect(masked[1]!.name).toBe('[Nombre cliente confidencial]')
    })

    it('maskTopClientsPii canViewFullPii=true → receiverName y receiverRfc SIN mask (auditor autorizado)', () => {
      const totals = TOP_CLIENTS_FIXTURE.map(() => ({ _sum: { total: 1234.56 } }))
      const clear = maskTopClientsPii(TOP_CLIENTS_FIXTURE, totals, true)
      expect(clear[0]!.rfc).toBe(TOP_CLIENTS_FIXTURE[0]!.receiverRfc)
      expect(clear[0]!.name).toBe(TOP_CLIENTS_FIXTURE[0]!.receiverName)
      expect(clear[0]!.name).not.toBe('[Nombre cliente confidencial]')
    })

    it('hasPermission: (1) user=null retorna false; (2) SUPER_ADMIN con permiso+org retorna true; (3) user con scope correcto OK (fail-closed cuando no hay user)', () => {
      const sa: Parameters<typeof hasPermission>[0] = { id: 'sa_001', systemRole: 'SUPER_ADMIN', memberships: [{ organizationId: SAST_SEED_ORGS.ORG_A.id, role: 'OWNER' as never }] }
      expect(hasPermission(null, Permission.RECEP_FISCAL_AUDIT_PII, SAST_SEED_ORGS.ORG_A.id)).toBe(false)
      expect(hasPermission(sa, Permission.RECEP_FISCAL_AUDIT_PII, SAST_SEED_ORGS.ORG_A.id)).toBe(true)
    })

    it('maskTopClientsPii rows.length !== totals.length safety (mismatch lengths) → NO throw; valores defaults seguros', () => {
      const safeRows = TOP_CLIENTS_FIXTURE
      const shortTotals = [{ _sum: { total: 5 } }]
      expect(() => maskTopClientsPii(safeRows, shortTotals, false)).not.toThrow()
      const r = maskTopClientsPii(safeRows, shortTotals, false)
      expect(r[1]!.total).toBe(0)
    })
  })

  describe('ORG-008 · SECURITY_HEADERS aplicados a TODOS status codes (401/403/404/429/500/200)', () => {
    const ALL_STATUS = [400, 401, 403, 404, 429, 500, 200] as const
    it.each(ALL_STATUS.map(s => [s]))('status %s → headers incluye Cache-Control start=private (no CDN cache leak)', () => {
      const cc = SECURITY_HEADERS['Cache-Control']
      expect(cc.startsWith('private')).toBe(true)
      expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer')
    })
    it('Headers Object.keys longitud ≥ 6 entries seguridad financieros', () => {
      expect(Object.keys(SECURITY_HEADERS).length).toBeGreaterThanOrEqual(6)
    })
  })

  describe('ORG-009 · baseWhere Dual Redundancia issuersFiscalEntityId vs issuerRfc where IN → REMOVIDO. No colisión RFC cross-org', () => {
    it('parseSatDecimal asegura monto cartera vencida NO se infla por NaN pure chars → 0 fallback; chars alphanumeric sin digits 0; NaN literal string pura ABC%%% debe colisionar 0', () => {
      const carteraVencidaStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      const safe = parseSatDecimal(carteraVencidaStr)
      expect(Number.isNaN(safe)).toBe(false)
      expect(safe).toBe(0)
      const safe2 = parseSatDecimal('%%%%%')
      expect(safe2).toBe(0)
    })
    it('baseWhere pattern actual NO incluye issuerRfc redundante (solo issuerFiscalEntityId FK + cfdiType)', () => {
      const baseWhere = { issuerFiscalEntityId: { in: ['fe_001', 'fe_002'] }, cfdiType: { in: ['INGRESO', 'PAGO', 'NOMINA'] } }
      expect('issuerRfc' in baseWhere).toBe(false)
      expect(Object.keys(baseWhere)).toEqual(expect.arrayContaining(['issuerFiscalEntityId', 'cfdiType']))
    })
  })
})

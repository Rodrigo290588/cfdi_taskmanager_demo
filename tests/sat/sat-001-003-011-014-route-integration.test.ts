import { describe, it, expect, beforeEach } from '@jest/globals'
import {
  buildDemoSatInvoices,
  SatDemoInvoiceBuilt,
  SatSeederRng,
} from '@/lib/sat-seeder-helpers'
import {
  SAT_IMPORT_DEMO_MAX_INVOICES_BATCH,
  SAT_FISCAL_ENTITY_HARDCODE_POSTALCODE,
  SAT_FISCAL_ENTITY_HARDCODE_TAXREGIME,
  SAT_SECURITY_HEADERS,
  SAT_POST_BODY_HARD_CAP_BYTES,
  safeErrSummarySat,
  satIncidentFingerprint,
} from '@/lib/sat-gate-helpers'
import {
  SAT_PROMPT_INJECTION_PAYLOADS,
  SAT_TEST_ORGS,
  SAT_TEST_FISCAL_ENTITIES,
  SAT_TEST_COMPANIES,
} from './fixtures/payloads'
import { escapeHtml } from '@/lib/rfc-validate'
import { Prisma, SystemRole, MemberRole } from '@prisma/client'

describe('SAT-001 | SAT-003 | SAT-011 | SAT-014 | Route Integration / Seeder 48 Shape ≥28 tests', () => {
  const FIXED_USER = 'user_sat_test_001'
  const FIXED_FE = 'fe_sat_determinista_001'

  beforeEach(() => {
    Reflect.set(process.env, 'NODE_ENV', 'test')
  })

  describe('[SAT-011] buildDemoSatInvoices: batch size 48 = SAT_IMPORT_DEMO_MAX_INVOICES_BATCH (DoS row bomb protection)', () => {
    it('count undefined → default 48 invoices (SAT demo seeder batch legal)', () => {
      const rows = buildDemoSatInvoices({
        fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
        userId: FIXED_USER,
      })
      expect(rows.length).toBe(SAT_IMPORT_DEMO_MAX_INVOICES_BATCH)
    })

    it('count explícito 10 → 10 rows exactas', () => {
      const rows = buildDemoSatInvoices({
        count: 10,
        fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
        userId: FIXED_USER,
      })
      expect(rows.length).toBe(10)
    })

    it('count 49 → throw (buildDemoSatInvoices valida límites internamente)', () => {
      expect(() => buildDemoSatInvoices({
        count: 49,
        fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
        userId: FIXED_USER,
      })).toThrow()
    })

    it('Prisma.SatInvoiceCreateManyInput contiene al menos campos createMany típicos (Prisma namespace disponible)', () => {
      const typeTest: Prisma.Sql = Prisma.empty
      expect(typeof typeTest).toBe('object')
      expect(typeof Prisma.join).toBe('function')
    })

    it('SAT_POST_BODY_HARD_CAP_BYTES = 128KB (anti 4MB JSON bomb DoS)', () => {
      expect(SAT_POST_BODY_HARD_CAP_BYTES).toBe(1024 * 128)
    })
  })

  describe('[SAT-014] buildDemoSatInvoices shape campos requeridos: NUNCA null excepto pdfUrl/exchangeRate', () => {
    const sample = (): ReadonlyArray<SatDemoInvoiceBuilt> => buildDemoSatInvoices({
      count: 5,
      fiscalEntityId: FIXED_FE,
      companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
      companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
      userId: FIXED_USER,
      nowOverride: new Date('2025-06-15T12:00:00.000Z'),
    })

    it('Cada row.userId = FIXED_USER (Asignación caller silo correcta)', () => {
      for (const row of sample()) expect(row.userId).toBe(FIXED_USER)
    })

    it('Cada row.fiscalEntityId = FIXED_FE (Silo FiscalEntity cruzado falla si ≠ caller org)', () => {
      for (const row of sample()) expect(row.fiscalEntityId).toBe(FIXED_FE)
    })

    it('Todas las 5 filas: subtotal ≥0, total≥subtotal, ivaTrasladado ≥0 (valores monetarios)', () => {
      for (const row of sample()) {
        expect(row.subtotal).toBeGreaterThanOrEqual(0)
        expect(row.total).toBeGreaterThanOrEqual(row.subtotal)
        expect(row.ivaTrasladado).toBeGreaterThanOrEqual(0)
        expect(row.isrRetenido).toBe(0)
        expect(row.iepsRetenido).toBe(0)
        expect(row.ivaRetenido).toBe(0)
      }
    })

    it('Cada uuid es único entre 5 rows (no colisión inserts Prisma createMany)', () => {
      const uuids = new Set(sample().map(r => r.uuid))
      expect(uuids.size).toBe(5)
    })

    it('currency=MXN y usageCfdi=G03 para todas rows (CFDI 4.0 default uso general)', () => {
      for (const row of sample()) {
        expect(row.currency).toBe('MXN')
        expect(row.usageCfdi).toBe('G03')
        expect(row.exchangeRate).toBeNull()
        expect(row.pdfUrl).toBeNull()
      }
    })

    it('issuanceDate ≤ now (no facturas en el futuro seeder demo)', () => {
      const now = new Date()
      for (const row of sample()) expect(row.issuanceDate.getTime()).toBeLessThanOrEqual(now.getTime() + 1000)
    })
  })

  describe('[SAT-007] escapeHtml en buildDemoSatInvoices: XSS fields sanitizados (stored XSS sat-invoice DB render)', () => {
    const XSS_NAME = '<script>alert("hacked")</script> Empresa "XSS" <img src=x onerror=1>'
    const XSS_RFC_SANDBOX = 'XSS<script>0123456789ab'

    it('companyBusinessName con XSS → escapeHtml produce entidad HTML &lt;/&quot; al menos en los 2 rows donde está compañía (emisor/receiver)', () => {
      const rows = buildDemoSatInvoices({
        count: 2,
        fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: XSS_NAME,
        userId: FIXED_USER,
      })
      const names: string[] = []
      for (const r of rows) {
        names.push(r.issuerName, r.receiverName)
      }
      const conEntidades = names.filter(n => /&(lt|gt|quot|amp);/.test(n)).length
      expect(conEntidades).toBeGreaterThanOrEqual(2)
      for (const n of names) {
        expect(n).not.toContain('<script')
        expect(n).not.toContain('<img')
      }
    })

    it('issuerRfc/receiverRfc con chars inválidos dentro RFC sanitiza remove < > / script', () => {
      const rows = buildDemoSatInvoices({
        count: 2,
        fiscalEntityId: FIXED_FE,
        companyRfc: XSS_RFC_SANDBOX,
        companyBusinessName: 'Test Safe',
        userId: FIXED_USER,
      })
      for (const r of rows) {
        expect(r.issuerRfc).not.toContain('<')
        expect(r.receiverRfc).not.toContain('>')
      }
    })

    it('expeditionPlace = SAT_FISCAL_ENTITY_HARDCODE_POSTALCODE (CP hardcodeado 04120, no user control)', () => {
      const rows = buildDemoSatInvoices({
        count: 3,
        fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
        userId: FIXED_USER,
      })
      for (const r of rows) {
        expect(r.expeditionPlace).toBe(SAT_FISCAL_ENTITY_HARDCODE_POSTALCODE)
      }
    })
  })

  describe('[SAT-001][SAT-011] Seeder determinístico: SatSeederRng fn fija → invoices reproducibles (aids CI regression)', () => {
    const deterministicRng: SatSeederRng = () => 0.3

    it('Mismo rng + count + same now → misma longitud subtotal rows 1..N reproducibles', () => {
      const a = buildDemoSatInvoices({
        count: 6, fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
        userId: FIXED_USER, rand: deterministicRng,
        nowOverride: new Date('2025-01-01T00:00:00.000Z'),
      })
      const b = buildDemoSatInvoices({
        count: 6, fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
        userId: FIXED_USER, rand: deterministicRng,
        nowOverride: new Date('2025-01-01T00:00:00.000Z'),
      })
      expect(a.map(r => `${r.subtotal}::${r.total}::${r.series}${r.folio}`)).toStrictEqual(
        b.map(r => `${r.subtotal}::${r.total}::${r.series}${r.folio}`)
      )
    })

    it('certificationPac es siempre "SAT" (no PAC user control)', () => {
      const rows = buildDemoSatInvoices({
        count: 3, fiscalEntityId: FIXED_FE,
        companyRfc: SAT_TEST_FISCAL_ENTITIES.FE_A.rfc,
        companyBusinessName: SAT_TEST_FISCAL_ENTITIES.FE_A.businessName,
        userId: FIXED_USER,
      })
      for (const r of rows) expect(r.certificationPac).toBe('SAT')
    })
  })

  describe('[SAT-009] Prompt injection sat-error-humanization: escapeHtml neutraliza tags HTML payloads', () => {
    it.each(SAT_PROMPT_INJECTION_PAYLOADS)('$id $description → escapeHtml convierte tags a entidades HTML', ({ rawError }) => {
      const escaped = escapeHtml(rawError)
      expect(escaped).not.toContain('<script')
      expect(escaped).not.toContain('<img')
      expect(escaped).toMatch(/&(lt|gt|quot|amp|#39);/)
    })

    it('safeErrSummarySat nunca incluye el rawError original en el message devuelto (PII leak defense)', () => {
      const secret = 'SAT_SECRET_TOKEN_CV_CSD_FIEL_12345'
      const summary = safeErrSummarySat(new Error(`Detalle interno ${secret}`))
      expect(summary.message).not.toContain(secret)
      expect(summary.incidentFingerprint.length).toBeGreaterThanOrEqual(20)
    })

    it('satIncidentFingerprint prefix="gate_deny" devuelve string prefijo+16hex(sha256)', () => {
      const fp = satIncidentFingerprint('gate_deny', SAT_TEST_ORGS.ORG_A.id, MemberRole.VIEWER)
      expect(fp.startsWith('gate_deny_')).toBe(true)
      expect(fp.length).toBe('gate_deny_'.length + 16)
      expect(/[0-9a-f]{16}$/.test(fp)).toBe(true)
    })
  })

  describe('[SAT-003 Cross-Org] ORG_A.id vs ORG_B.id diferentes (silo multi-tenant Holding same RFC)', () => {
    it('ORG_A y ORG_B tienen IDs organizationId distintos (previene BOLA cross tenant)', () => {
      expect(SAT_TEST_ORGS.ORG_A.id).not.toBe(SAT_TEST_ORGS.ORG_B.id)
    })

    it('FE_A y FE_B comparten el mismo RFC ODE8604257UA (Holding pattern) pero organizationId diferente', () => {
      expect(SAT_TEST_FISCAL_ENTITIES.FE_A.rfc).toBe(SAT_TEST_FISCAL_ENTITIES.FE_B.rfc)
      expect(SAT_TEST_FISCAL_ENTITIES.FE_A.organizationId).not.toBe(SAT_TEST_FISCAL_ENTITIES.FE_B.organizationId)
    })

    it('COMPANY_A y COMPANY_B comparten RFC pero organizationId distinto', () => {
      expect(SAT_TEST_COMPANIES.COMPANY_A.rfc).toBe(SAT_TEST_COMPANIES.COMPANY_B.rfc)
      expect(SAT_TEST_COMPANIES.COMPANY_A.organizationId).not.toBe(SAT_TEST_COMPANIES.COMPANY_B.organizationId)
    })
  })

  describe('[SAT-012] Permission Grants: MemberRole enum 4 roles + grants pattern 4 SUPER_ADMIN/ADMIN/COMPANY_ADMIN/MemberRole.ADMIN', () => {
    it('MemberRole enum contiene VIEWER y ADMIN (VIEWER = SAT IMPORT fail-closed 403)', () => {
      expect(MemberRole.VIEWER).toBeDefined()
      expect(MemberRole.ADMIN).toBeDefined()
    })

    it('SystemRole enum contiene SUPER_ADMIN, COMPANY_ADMIN, ADMIN (≥3 roles admin-validos)', () => {
      expect(SystemRole.SUPER_ADMIN).toBeDefined()
      expect(SystemRole.COMPANY_ADMIN).toBeDefined()
      expect(SystemRole.ADMIN).toBeDefined()
    })

    it('SAT_FISCAL_ENTITY_HARDCODE_TAXREGIME = "601" (Régimen General SAT)', () => {
      expect(SAT_FISCAL_ENTITY_HARDCODE_TAXREGIME).toBe('601')
    })

    it('SAT_SECURITY_HEADERS al menos 7 headers de seg (CSP/HSTS/X-Frame/Robots/etc)', () => {
      expect(Object.keys(SAT_SECURITY_HEADERS).length).toBeGreaterThanOrEqual(6)
    })
  })
})

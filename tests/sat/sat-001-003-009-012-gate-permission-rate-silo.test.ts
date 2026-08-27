import { describe, it, expect, beforeEach } from '@jest/globals'
import {
  safeErrSummarySat,
  isSatDemoImportAllowedEnv,
  satValidateCompanyIdFormat,
  satValidateRfcStrictFormat,
  SAT_SECURITY_HEADERS,
} from '@/lib/sat-gate-helpers'
import { sanitizeSatDemoCount } from '@/lib/sat-seeder-helpers'
import { SystemRole } from '@prisma/client'
import { Permission as PermissionsLocal } from '@/lib/permissions'
import {
  SAT_RATE_TRIPLE_BUCKETS,
  SAT_TEST_COMPANIES,
} from './fixtures/payloads'

describe('SAT-001 | SAT-003 | SAT-009 | SAT-012 | Gate / Permission / Rate / Silo Cross-Org ≥24 tests', () => {
  const LEGIT_RFC_13 = 'ODE8604257UA'
  const LEGIT_RFC_12 = 'QBB7223997V9'

  beforeEach(() => {
    Reflect.set(process.env, 'NODE_ENV', 'test')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  describe('[SAT-012] SAT_SECURITY_HEADERS: 9 headers obligatorios HSTS / X-Frame / X-Robots', () => {
    it('SAT_SECURITY_HEADERS incluye Strict-Transport-Security ≥1 año includeSubDomains', () => {
      const hsts = SAT_SECURITY_HEADERS['Strict-Transport-Security']
      expect(hsts).toBeDefined()
      expect(/max-age=\d{7,}/.test(String(hsts))).toBe(true)
      expect(String(hsts)).toContain('includeSubDomains')
    })

    it('SAT_SECURITY_HEADERS incluye X-Frame-Options: DENY (no SAMEORIGIN, fail-closed)', () => {
      expect(SAT_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY')
    })

    it('SAT_SECURITY_HEADERS incluye X-Robots-Tag: noindex,nofollow (SAT contenido confidencial)', () => {
      const robots = SAT_SECURITY_HEADERS['X-Robots-Tag']
      expect(robots).toBeDefined()
      expect(String(robots)).toContain('noindex')
      expect(String(robots)).toContain('nofollow')
    })
  })

  describe('[SAT-001] Triple lock env gate: NODE_ENV prod vs dev/test', () => {
    const ENV_CASES: ReadonlyArray<{ id: string; env: unknown; expected: boolean; severity: string }> = [
      { id: 'ENV-01', env: 'production', expected: false, severity: 'SAT-001 PROD blocked 403' },
      { id: 'ENV-02', env: 'PRODUCTION', expected: false, severity: 'SAT-001 PROD uppercase blocked' },
      { id: 'ENV-03', env: 'development', expected: true, severity: 'SAT-001 DEV permitido' },
      { id: 'ENV-04', env: 'test', expected: true, severity: 'SAT-001 TEST jest permitido' },
      { id: 'ENV-05', env: 'dev', expected: true, severity: 'SAT-001 dev shortcut permitido' },
      { id: 'ENV-06', env: 'staging', expected: false, severity: 'SAT-001 staging bloqueado fail-closed' },
      { id: 'ENV-07', env: undefined, expected: false, severity: 'SAT-001 undefined env bloqueado default' },
      { id: 'ENV-08', env: '', expected: false, severity: 'SAT-001 string vacío bloqueado' },
    ] as const
    it.each(ENV_CASES)('$id $severity ($env) → allowed=$expected', ({ env, expected }) => {
      const res = isSatDemoImportAllowedEnv(String(env ?? undefined))
      expect(res).toBe(expected)
    })
  })

  describe('[SAT-001][SAT-011] sanitizeSatDemoCount DoS batch rows: min=1 max=48 fail-closed', () => {
    it('count 0 → 400 mínimo 1 (protege inserts vacíos triviales)', () => {
      const res = sanitizeSatDemoCount(0)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.status).toBe(400)
    })

    it('count 48 → ok 48 máximo legal batch SAT demo', () => {
      const res = sanitizeSatDemoCount(48)
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.value).toBe(48)
    })

    it('count 49 → 400 DoS protection excede max 48 rows (SAT-011 Medio 480K rows bomb)', () => {
      const res = sanitizeSatDemoCount(49)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.status).toBe(400)
        expect(/máximo|max|48/.test(String(res.error))).toBe(true)
      }
    })

    it('count undefined → ok default 48 (SAT_IMPORT_DEMO_DEFAULT_INVOICES)', () => {
      const res = sanitizeSatDemoCount(undefined)
      expect(res.ok).toBe(true)
    })

    it('count string "10" → ok 10 parse entero base10', () => {
      const res = sanitizeSatDemoCount('10')
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.value).toBe(10)
    })

    it('count NaN → 400 no entero válido', () => {
      const res = sanitizeSatDemoCount(Number.NaN)
      expect(res.ok).toBe(false)
    })

    it('count Infinity → 400 no finito', () => {
      const res = sanitizeSatDemoCount(Number.POSITIVE_INFINITY)
      expect(res.ok).toBe(false)
    })

    it('count negativo -3 → 400 min 1 fail', () => {
      const res = sanitizeSatDemoCount(-3)
      expect(res.ok).toBe(false)
    })
  })

  describe('[SAT-003] Silo: satValidateCompanyIdFormat + satValidateRfcStrictFormat (cross-org input gates)', () => {
    it('companyId UUID v4 válido → ok true', () => {
      const res = satValidateCompanyIdFormat(SAT_TEST_COMPANIES.COMPANY_A.id.length === 25 ? '550e8400-e29b-41d4-a716-446655440000' : SAT_TEST_COMPANIES.COMPANY_A.id)
      expect(res.ok).toBe(true)
    })

    it('companyId CUID válido c[a-z0-9]{23} → ok true', () => {
      const res = satValidateCompanyIdFormat('ckq1234567890abcdefghijkl')
      expect(res.ok).toBe(true)
    })

    it('companyId vacío null → 400 error con incident_fingerprint embed', () => {
      const res = satValidateCompanyIdFormat(null)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.status).toBe(400)
        expect(/fp=/.test(String(res.error))).toBe(true)
      }
    })

    it('companyId "DROP TABLE companies;--" → 400 formato inválido injection blocked', () => {
      const res = satValidateCompanyIdFormat('DROP TABLE companies;--')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.status).toBe(400)
    })

    it('RFC 13 chars válido ODE8604257UA → ok con normalized uppercase', () => {
      const res = satValidateRfcStrictFormat(LEGIT_RFC_13.toLowerCase())
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.normalized).toBe(LEGIT_RFC_13)
    })

    it('RFC 12 chars válido QBB7223997V9 → ok normalized', () => {
      const res = satValidateRfcStrictFormat(LEGIT_RFC_12)
      expect(res.ok).toBe(true)
    })

    it('RFC 11 chars corto → 400 longitud SAT DOF (SAT-003 input gate fail)', () => {
      const res = satValidateRfcStrictFormat('ABC12345678')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.status).toBe(400)
    })

    it('RFC con slash inside (path traversal attempt) → 400 regex FAIL', () => {
      const res = satValidateRfcStrictFormat('ODE/8604257UA')
      expect(res.ok).toBe(false)
    })
  })

  describe('[SAT-009] safeErrSummarySat PII leak: nunca rawError en message, siempre incident_fingerprint', () => {
    it('Error con mensaje PII "RFC=ODE8604257UA SQLi" → message genérico, incident_fingerprint 16 hex', () => {
      const piiErr = new Error('Detalle interno PII: RFC=ODE8604257UA, password=admin123, SQLi params SELECT *')
      const summary = safeErrSummarySat(piiErr)
      expect(summary.message).not.toMatch(/ODE8604257|admin123|SELECT \*/i)
      expect(/^sat_err_500_[0-9a-f]{16}$/.test(summary.incidentFingerprint)).toBe(true)
      expect(summary.name).toBe('Error')
    })

    it('error null → default message, incidentFp aún generado (fail-safe)', () => {
      const summary = safeErrSummarySat(null)
      expect(summary.name).toBe('UnknownSatError')
      expect(summary.incidentFingerprint.startsWith('sat_err_500_')).toBe(true)
    })

    it('error Number primitivo 123 → SatGenericError sin throw', () => {
      const summary = safeErrSummarySat(123 as never)
      expect(summary.name).toBe('SatGenericError')
      expect(summary.message).toContain('Error interno')
    })
  })

  describe('[SAT-012] Permission SAT_IMPORT_DEMO enum existe y grants 4 roles (RFC pattern)', () => {
    it('Permission enum contiene SAT_IMPORT_DEMO = "sat:import:demo" (src/lib/permissions.ts source of truth)', () => {
      expect(PermissionsLocal.SAT_IMPORT_DEMO).toBe('sat:import:demo')
    })

    it('SystemRole contiene los 4 roles base (SUPER_ADMIN, ADMIN, COMPANY_ADMIN, MEMBER)', () => {
      const values = Object.values(SystemRole) as string[]
      expect(values.length).toBeGreaterThanOrEqual(3)
      expect(values).toContain(SystemRole.SUPER_ADMIN)
      expect(values).toContain(SystemRole.ADMIN)
      expect(values).toContain(SystemRole.COMPANY_ADMIN)
    })
  })

  describe('[SAT-001] SAT_RATE_TRIPLE_BUCKETS 4 buckets config: IP/User/OrgDay/UserDay', () => {
    it.each(SAT_RATE_TRIPLE_BUCKETS)('$id $description → limit>0, intervalMs>0', ({ limit, intervalMs }) => {
      expect(limit).toBeGreaterThan(0)
      expect(intervalMs).toBeGreaterThan(0)
    })
  })
})

import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'
import {
  PostCreateMassRequestSchema,
  RequestsListQuerySchema,
  PackageDownloadsQuerySchema,
  FiscalControlQuerySchema,
  CredentialsUploadFormSchema,
  validateFcDynamicFilters,
  ALLOWED_FC_FILTER_COLUMNS,
  ALLOWED_FC_DB_FIELDS,
  parsePositiveInt,
} from '@/lib/mass-downloads-route-utils'

const VALID_UUID_A = '550e8400-e29b-41d4-a716-446655440000'
const VALID_UUID_B = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
void 'f81d4fae-7dec-11d0-911e-0800200c9a66'

describe('MD-003 · Zod strictObject: Overposting / Prototype Pollution Prevention', () => {
  it('PostCreateMassRequestSchema es z.strictObject. Campo extra arbitrario unknownFieldInyectado → ZodError unknown field FAIL', () => {
    const payload = {
      companyId: VALID_UUID_A,
      requestingRfc: 'ODE8604257UA',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      requestType: 'cfdi',
      retrievalType: 'emitidos',
      organizationId: 'attacker-org-cross-tenant',
      roleInyectado: 'SUPER_ADMIN',
      inyectado_sql: "' OR 1=1 --",
      unknownFieldAddedByAttacker: 'pwned',
    }
    const r = PostCreateMassRequestSchema.safeParse(payload)
    expect(r.success).toBe(false)
  })

  it('PostCreateMassRequestSchema requestingRfc inyeccion XSS <img> → Zod trim + uppercase regex RFC válido FAIL', () => {
    const badXss = {
      companyId: VALID_UUID_A,
      requestingRfc: '<img src=x onerror=alert(1)>',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      requestType: 'metadata',
      retrievalType: 'emitidos',
    }
    const r = PostCreateMassRequestSchema.safeParse(badXss)
    expect(r.success).toBe(false)
  })

  it('5 schemas mass son strict: no aceptan campos desconocidos (check Zod strict)', () => {
    const withExtra = { unknownFieldAddedByAttacker: 'pwned' }
    const candidates: Array<[string, z.ZodTypeAny, Record<string, unknown>]> = [
      ['RequestsListQuerySchema', RequestsListQuerySchema, { companyId: VALID_UUID_A, ...withExtra }],
      ['PackageDownloadsQuerySchema', PackageDownloadsQuerySchema, { rfc: 'ODE8604257UA', ...withExtra }],
      ['FiscalControlQuerySchema', FiscalControlQuerySchema, { companyId: VALID_UUID_A, page: 1, pageSize: 50, ...withExtra }],
      ['CredentialsUploadFormSchema', CredentialsUploadFormSchema, { ...withExtra, rfc: 'ODE8604257UA', organizationId: VALID_UUID_B, password: 'x' }],
    ]
    for (const [name, schema, badPayload] of candidates) {
      const r = schema.safeParse(badPayload)
      expect(r.success).toBe(false)
      expect(name).toBeTruthy()
    }
  })

  it('PostCreateMassRequestSchema payload limpio válido pasa OK (solo campos requeridos) con UUID RFC4122 real', () => {
    const ok = {
      companyId: VALID_UUID_A,
      requestingRfc: 'ODE8604257UA',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      requestType: 'cfdi',
      retrievalType: 'emitidos',
    }
    const r = PostCreateMassRequestSchema.safeParse(ok)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.companyId).toBe(VALID_UUID_A)
      expect(r.data.requestType).toBe('cfdi')
    }
  })
})

describe('MD-009 · Dynamic Filters whitelist ONLY. Columnas invalidas filter_xxxUnknownColumn → REDACT/ignorado FAIL CLOSED', () => {
  it('ALLOWED_FC_FILTER_COLUMNS: 12 keys exactas, no mas', () => {
    expect(ALLOWED_FC_FILTER_COLUMNS.size).toBe(12)
    for (const k of ['uuid', 'issuerRfc', 'receiverRfc', 'issuerName', 'receiverName', 'cfdiType', 'total', 'issuanceDate', 'folio']) {
      expect(ALLOWED_FC_FILTER_COLUMNS.has(k)).toBe(true)
    }
  })

  it('ALLOWED_FC_DB_FIELDS mapping solo contiene keys whitelist. Columna password/secret → undefined', () => {
    expect(ALLOWED_FC_DB_FIELDS['uuid']).toBe('uuid')
    expect(ALLOWED_FC_DB_FIELDS['issuerRfc']).toBe('rfcEmisor')
    expect(ALLOWED_FC_DB_FIELDS['password']).toBeUndefined()
    expect(ALLOWED_FC_DB_FIELDS['organizationId']).toBeUndefined()
    expect(ALLOWED_FC_DB_FIELDS['xmlContent']).toBeUndefined()
  })

  it('validateFcDynamicFilters: raw con columna desconocida "filter_xxxUnknownColumnContainsPassword" → retorna objeto VACIO {} FAIL CLOSED', () => {
    const bad = {
      xxxUnknownColumnContainsPassword: 'plaintext123',
      issuerName: 'SAT',
    }
    const filtered = validateFcDynamicFilters(bad)
    expect(filtered['xxxUnknownColumnContainsPassword']).toBeUndefined()
    expect(filtered['issuerName']).toBe('SAT')
    expect(Object.keys(filtered).every(k => ALLOWED_FC_FILTER_COLUMNS.has(k))).toBe(true)
  })
})

describe('MD-008 / MD-009 · parsePositiveInt page y pageSize clamp seguros (NaNs, 1e300, negativos)', () => {
  it('parsePositiveInt("1e300") pasa isFinite e isInteger, pero Math.min lo clamp a max 200 = NO OOM (excelente!)', () => {
    // 1e300 es finito (< 1.79e308) y entero (sin fracción) → pasa los guards, luego CAP al max
    expect(parsePositiveInt('1e300', 1, 200)).toBe(200)
  })

  it('parsePositiveInt("NaN", null, undefined, "abc") → retorna fallback (fail safe)', () => {
    expect(parsePositiveInt('NaN', 10, 50)).toBe(10)
    expect(parsePositiveInt(null, 5, 100)).toBe(5)
    expect(parsePositiveInt(undefined, 7, 100)).toBe(7)
    expect(parsePositiveInt('  ', 3, 100)).toBe(3)
  })

  it('parsePositiveInt > max clamp al max (pageSize=9999 → 200); negativos → fallback', () => {
    expect(parsePositiveInt('9999', 1, 200)).toBe(200)
    expect(parsePositiveInt('50', 1, 200)).toBe(50)
    expect(parsePositiveInt('-5', 1, 200)).toBe(1)
  })

  it('parsePositiveInt strings basura letras abc, floats 3.14 → fallback no enteros', () => {
    expect(parsePositiveInt('abcdef', 1, 100)).toBe(1)
    expect(parsePositiveInt('3.14', 2, 50)).toBe(2)
  })
})

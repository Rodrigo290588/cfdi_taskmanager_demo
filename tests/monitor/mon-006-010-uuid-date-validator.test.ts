import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'
import {
  parseDateFilterStrict,
  UUID_RFC4122_V4,
  ORG_ID_FORMAT,
  zOrgIdSafe
} from '@/lib/monitor-date-uuid-helpers'
import { MonitorRunItemsParamsSchema } from '@/app/api/monitor/runs/[importRunId]/items/route'
import { MonitorItemDetailParamsSchema } from '@/app/api/monitor/items/[itemId]/route'

describe('MON-006 · UUID RFC 4122 Versión 4 Strict. Route params anti IDOR/Path-Traversal/SQLi.', () => {
  it('MON-006: UUID_RFC4122_V4 regex acepta exactamente 36 chars formato 8-4-4-4-12. Válidos PASS.', () => {
    const valids = [
      '550e8400-e29b-41d4-a716-446655440000',
      '3f0e4e3a-613e-4733-9f19-b565e9c22a17',
      'a1b2c3d4-5678-4abc-8def-0123456789ab',
      '00000000-0000-4000-8000-000000000000',
      'FFFFFFFF-FFFF-4FFF-9FFF-FFFFFFFFFFFF',
      '123e4567-e89b-42d3-a456-426614174000'
    ]
    for (const u of valids) {
      expect(UUID_RFC4122_V4.test(u)).toBe(true)
    }
  })

  it("MON-006: UUID_RFC4122_V4 rechaza inválidos: V3, NULL bytes, OR 1=1 --, path traversal, XSS, V1 time-based", () => {
    const invalids = [
      "' OR 1=1 --",
      '../../etc/passwd%00',
      '<img src=x onerror=alert(1)>',
      '550e8400-e29b-11d1-a716-446655440000', // version 1
      '550e8400-e29b-31d4-a716-446655440000', // version 3
      '550e8400-e29b-51d4-a716-446655440000', // version 5
      '550e8400-e29b-41d4-0716-446655440000', // variant 0xxx (no 89ab)
      '550e8400-e29b-41d4-c716-446655440000', // variant c = 110x (no RFC4122 89ab = 10xx)
      '',
      'hola-mundo',
      'ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ',
      '12345678-1234-1234-1234-1234567890123' // 37 chars
    ]
    for (const u of invalids) {
      expect(UUID_RFC4122_V4.test(u)).toBe(false)
    }
  })

  it('MON-006: zUuidV4 factory Zod - válido parsea; inválido ZodError. MonitorRunItemsParamsSchema importa zUuidV4 y es STRICT.', () => {
    const invalidPayloads = [
      { importRunId: "' OR 1=1 --" },
      { importRunId: '../../etc/passwd' },
      { importRunId: '<img src=x onerror=alert(1)>' },
      { importRunId: '550e8400-e29b-11d1-a716-446655440000' },
      { importRunId: 'no-es-uuid', unknownExtra: 'pwned' }
    ]
    for (const p of invalidPayloads) {
      const r = MonitorRunItemsParamsSchema.safeParse(p)
      expect(r.success).toBe(false)
    }
  })

  it('MON-006: MonitorItemDetailParamsSchema itemId uuid válido + unknown key = FAIL strict (400)', () => {
    const r = MonitorItemDetailParamsSchema.safeParse({
      itemId: '550e8400-e29b-41d4-a716-446655440000',
      extra_unknown: 'injected'
    })
    expect(r.success).toBe(false)
  })

  it('MON-006: zOrgIdSafe formato regex alfanum _- length 10-64. Invalido < 10, > 64 o chars especiales FAIL', () => {
    const s = z.object({ orgId: zOrgIdSafe() })
    expect(s.safeParse({ orgId: 'abc' }).success).toBe(false)
    expect(s.safeParse({ orgId: 'a'.repeat(70) }).success).toBe(false)
    expect(s.safeParse({ orgId: "org'; DROP TABLE orgs;--" }).success).toBe(false)
    expect(s.safeParse({ orgId: 'cmnntrppk000502gcp93ketfx' }).success).toBe(true)
    expect(s.safeParse({}).success).toBe(true) // optional
  })

  it('MON-006: ORG_ID_FORMAT match 10-64 alfanum _ - . Inválidos FAIL.', () => {
    const validOrgs = ['cmnntrppk000502gcp93ketfx', 'cmipiwlqk000mvyvtc22tnlrb', 'org-a_b-C-123']
    const invalidOrgs = ['a', "' OR 1=1 --", 'org<script>', '../../shadow', 'a'.repeat(65)]
    for (const o of validOrgs) expect(ORG_ID_FORMAT.test(o)).toBe(true)
    for (const o of invalidOrgs) expect(ORG_ID_FORMAT.test(o)).toBe(false)
  })
})

describe('MON-010 · parseDateFilterStrict. Validación calendario REAL (no regex loose). Febrero no bisiesto, mes 13, día 45 FAIL (400).', () => {
  it('MON-010: Fechas inválidas calendario real → THROW ZodError. 2025-02-29 no bisiesto / 2025-13-01 mes 13 / 2025-04-31 abril no 31 / 2025-04-45 día 45 / año <1900 o >2200', () => {
    const invalids = [
      ['2025-13-01', 'start'],
      ['2025-04-45', 'end'],
      ['2025-02-29', 'start'],
      ['2025-04-31', 'end'],
      ['1800-01-01', 'start'],
      ['2300-01-01', 'end'],
      ['2025-00-01', 'start'],
      ['2025-01-00', 'end'],
    ] as const
    for (const [d, b] of invalids) {
      let threw = false
      try { parseDateFilterStrict(d, b as 'start' | 'end') } catch { threw = true }
      expect(threw).toBe(true)
    }
  })

  it('MON-010: Fechas VÁLIDAS (incluyendo bisiestos 2024/2028-02-29) NO throw + retornan Date start 00:00:00 / end 23:59:59.999', () => {
    const s1 = parseDateFilterStrict('2025-01-15', 'start')
    expect(s1).toBeInstanceOf(Date)
    expect(s1?.getUTCFullYear()).toBe(2025)
    expect(s1?.getUTCMonth()).toBe(0) // Jan 0
    expect(s1?.getUTCDate()).toBe(15)
    expect(s1?.getUTCHours()).toBe(0)
    expect(s1?.getUTCMinutes()).toBe(0)
    expect(s1?.getUTCSeconds()).toBe(0)
    expect(s1?.getUTCMilliseconds()).toBe(0)

    const e1 = parseDateFilterStrict('2024-12-31', 'end')
    expect(e1?.getUTCHours()).toBe(23)
    expect(e1?.getUTCMinutes()).toBe(59)
    expect(e1?.getUTCSeconds()).toBe(59)
    expect(e1?.getUTCMilliseconds()).toBe(999)

    const leap1 = parseDateFilterStrict('2024-02-29', 'start')
    expect(leap1).toBeInstanceOf(Date)

    const leap2 = parseDateFilterStrict('2028-02-29', 'end')
    expect(leap2).toBeInstanceOf(Date)
  })

  it('MON-010: Valores basura (null, undefined, "", "hola", "<img>") → return undefined SIN throw (silent fail-safe, no crash)', () => {
    expect(parseDateFilterStrict(null, 'start')).toBeUndefined()
    expect(parseDateFilterStrict(undefined, 'end')).toBeUndefined()
    expect(parseDateFilterStrict('', 'start')).toBeUndefined()
    expect(parseDateFilterStrict('no-soy-fecha', 'start')).toBeUndefined()
  })

  it('MON-010: Roundtrip garantiza que Date parseado retorna mismos componentes. Anti timezone bug UTC.', () => {
    const d = parseDateFilterStrict('1999-09-09', 'start')
    expect(d?.getUTCFullYear()).toBe(1999)
    expect(d?.getUTCMonth()).toBe(8) // Sep = 8 zero-based
    expect(d?.getUTCDate()).toBe(9)
  })
})

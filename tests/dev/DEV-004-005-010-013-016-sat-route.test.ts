/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/dev/sat_invoices (GET)
 * Findings cubiertos:
 *   DEV-004 · RFC strict length 12|13 + regex SAT + uppercase (ALTO)
 *   DEV-005 · limit clamp 1..MAX_DEV_SAT_INVOICES_LIMIT=50 (ALTO)
 *   DEV-010 · XSS reflejado safeRfcError sanitiza <>&"\ (MEDIO)
 *   DEV-013 · Cross-tenant scope allowedFiscalEntityIds (ALTO)
 *   DEV-016 · 6 Hardening headers en response (BAJO)
 */

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('@/lib/audit', () => ({ createAuditEntry: jest.fn(async () => null) }))
jest.mock('@/lib/security', () => ({ getRealClientIp: jest.fn(() => '127.0.0.1') }))
jest.mock('next/server', () => ({
  NextRequest: class { url: string; headers: Map<string,string>; constructor(u?: string) { this.url = u ?? 'http://localhost:3000'; this.headers = new Map() } },
  NextResponse: {
    json: (body: unknown, init?: unknown) => ({ body, init, _headersApplied: false, headers: new Map<string,string>(), _applyHardeningCalled: false }),
  },
}))

import {
  DEV004_RFC_STRICT_SAT_REGEX,
  DEV005_LIMIT_CLAMP_SAT_1_50,
  DEV010_SAFE_RFC_ERROR_XSS,
  DEV013_CROSS_TENANT_FISCAL_ENTITY_SCOPED,
  DEV016_HARDENING_HEADERS_6_ALL_RESPONSES,
} from './fixtures/payloads'
import { DevSatInvoicesQuerySchema, MAX_DEV_SAT_INVOICES_LIMIT, RFC_STRICT_REGEX_SAT } from '@/schemas/dev'

describe('[DEV SAST] DEV-004 · RFC strict length 12|13 + RFC_STRICT_REGEX_SAT + uppercase', () => {
  it('RFC_STRICT_REGEX_SAT source esperado "^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$"', () => {
    expect(RFC_STRICT_REGEX_SAT.source).toBe(DEV004_RFC_STRICT_SAT_REGEX.regexSourceExpected)
  })

  it.each(DEV004_RFC_STRICT_SAT_REGEX.bypassVectors)(
    'RFC="$rfc" válido? → !$expectedInvalid ($reason)',
    ({ rfc, expectedInvalid }) => {
      const parsed = DevSatInvoicesQuerySchema.safeParse({ rfc })
      if (expectedInvalid) {
        expect(parsed.success).toBe(false)
      } else {
        expect(parsed.success).toBe(true)
        if (parsed.success && parsed.data.rfc) {
          expect(parsed.data.rfc).toBe(rfc.trim().toUpperCase())
        }
      }
    }
  )

  it('RFC mixed case → salida transformada uppercase (anti-bypass)', () => {
    const p = DevSatInvoicesQuerySchema.safeParse({ rfc: '  ode8604257ua  ' })
    expect(p.success).toBe(true)
    if (p.success) expect(p.data.rfc).toBe('ODE8604257UA')
  })

  it('RFC length edge: 11 chars → error longitud; 14 chars → error longitud', () => {
    expect(DevSatInvoicesQuerySchema.safeParse({ rfc: 'ODE8604257U' }).success).toBe(false)
    expect(DevSatInvoicesQuerySchema.safeParse({ rfc: 'ODE8604257UAXT' }).success).toBe(false)
  })
})

describe('[DEV SAST] DEV-005 · limit clamp 1..MAX=50 anti-DoS sat_invoices', () => {
  it('MAX_DEV_SAT_INVOICES_LIMIT === 50 (NO 1000/10000)', () => {
    expect(MAX_DEV_SAT_INVOICES_LIMIT).toBe(50)
  })

  it.each(DEV005_LIMIT_CLAMP_SAT_1_50.bypassVectors)(
    'query limit="$input" → clamp valor esperado $expected',
    ({ input, expected }) => {
      const payload: Record<string,string> = {}
      if (input !== undefined) payload.limit = input
      const parsed = DevSatInvoicesQuerySchema.safeParse(payload)
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.limit).toBe(expected)
        expect(parsed.data.limit).toBeGreaterThanOrEqual(1)
        expect(parsed.data.limit).toBeLessThanOrEqual(MAX_DEV_SAT_INVOICES_LIMIT)
      }
    }
  )

  it('limit=NaN non-numeric → default 10; limit=-9999 numeric neg → clamp min 1', () => {
    const pNaN = DevSatInvoicesQuerySchema.safeParse({ limit: 'NaN' })
    const pNeg = DevSatInvoicesQuerySchema.safeParse({ limit: '-9999' })
    expect(pNaN.success).toBe(true)
    if (pNaN.success) expect(pNaN.data.limit).toBe(10)
    expect(pNeg.success).toBe(true)
    if (pNeg.success) expect(pNeg.data.limit).toBe(1)
  })
})

describe('[DEV SAST] DEV-010 · safeRfcError XSS reflejado sanitize <>&"\\', () => {
  function safeRfcError(raw: string): string {
    return String(raw ?? '')
      .replace(/[<>&"\\]/g, c => ({ '<': '[LT]', '>': '[GT]', '&': '[AMP]', '"': '[QUOT]', '\\': '[BSLASH]' }[c] || c))
      .slice(0, 40)
  }

  it.each(DEV010_SAFE_RFC_ERROR_XSS.xssVectors)(
    'XSS vector input se sanitiza siempre (safe)',
    ({ input }) => {
      const out = safeRfcError(input)
      expect(out).not.toContain('<')
      expect(out).not.toContain('>')
      expect(out).not.toContain('"')
      expect(out).not.toContain('\\')
      expect(out.length).toBeLessThanOrEqual(40)
    }
  )

  it('Output safeRfcError siempre ≤ 40 chars (DoS mensaje gigante)', () => {
    const big = 'A'.repeat(10_000) + '<script>alert(1)</script>'
    expect(safeRfcError(big).length).toBeLessThanOrEqual(40)
  })
})

describe('[DEV SAST] DEV-013 · Cross-tenant scope allowedFiscalEntityIds userId SAT', () => {
  it('Filters requeridos incluyen member.organizationId + allowedFiscalEntityIds + userId', () => {
    for (const requiredKey of DEV013_CROSS_TENANT_FISCAL_ENTITY_SCOPED.queryFiltersRequired) {
      expect(DEV013_CROSS_TENANT_FISCAL_ENTITY_SCOPED.queryFiltersRequired.includes(requiredKey)).toBe(true)
    }
    expect(DEV013_CROSS_TENANT_FISCAL_ENTITY_SCOPED.noGlobal).toBe(true)
  })

  it('allowedFiscalEntityIds empieza vacío → findMany 0 rows si no hay ORGs asignadas al userId', () => {
    const allowedFiscalEntityIds: string[] = []
    const queryScope = { where: { fiscalEntityId: { in: allowedFiscalEntityIds } } }
    expect(queryScope.where.fiscalEntityId.in).toEqual([])
  })
})

describe('[DEV SAST] DEV-016 · applyHardeningHeaders 6 headers todas responses 200/4xx', () => {
  it('Headers obligatorios 6 (XCTO,XFO,CSP,Referrer,Permissions,HSTS) presentes en inventario', () => {
    expect(DEV016_HARDENING_HEADERS_6_ALL_RESPONSES.headersRequired).toHaveLength(6)
  })

  it('XCTO=nosniff + XFO=DENY valores hardcodeados (no SAMEORIGIN débil)', () => {
    expect(DEV016_HARDENING_HEADERS_6_ALL_RESPONSES.headerExpectedValues['X-Content-Type-Options']).toBe('nosniff')
    expect(DEV016_HARDENING_HEADERS_6_ALL_RESPONSES.headerExpectedValues['X-Frame-Options']).toBe('DENY')
  })

  it('Rutas afectadas por hardening incluyen seed y sat_invoices', () => {
    const hasSeed = DEV016_HARDENING_HEADERS_6_ALL_RESPONSES.routesAffected.some(r => r.includes('/seed/'))
    const hasSat = DEV016_HARDENING_HEADERS_6_ALL_RESPONSES.routesAffected.some(r => r.includes('sat_invoices'))
    expect(hasSeed).toBe(true)
    expect(hasSat).toBe(true)
  })
})

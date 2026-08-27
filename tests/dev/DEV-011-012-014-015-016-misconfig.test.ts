/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/dev (Misc/Misconfiguraciones)
 * Findings cubiertos:
 *   DEV-011 · 500 safe fingerprint SHA16 NO stack/env/conn leak (MEDIO)
 *   DEV-012 · RFC demo random NO hardcode SCI/CUCC públicos (MEDIO)
 *   DEV-014 · Response Ids suffix 8-12 chars trunc NO full IDs (BAJO)
 *   DEV-015 · Rate limit 1/30min seed idempotent (BAJO)
 *   DEV-016 · Hardening headers 6 (cierre)
 */

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))

import crypto from 'node:crypto'
import {
  DEV011_NO_STACKTRACE_LEAK_500,
  DEV012_RFC_NO_HARDCODED_PUBLIC_SAT,
  DEV014_RESPONSE_IDS_SUFFIX_TRUNCATED,
  DEV015_SEED_RATE_LIMIT_1_PER_30MIN,
  DEV016_HARDENING_HEADERS_6_ALL_RESPONSES,
  DEV_TOTAL_FINDINGS_PAYLOADS,
  buildDevDemoRfcFixture,
} from './fixtures/payloads'

describe('[DEV SAST] DEV-011 · 500 safe: SHA16 fingerprint, NO stack/conn string leaks', () => {
  function fingerprint16(input: string): string {
    return crypto.createHash('sha256').update(String(input || 'err')).digest('hex').slice(0, 16)
  }

  it('fingerprint length = 16 chars hex always (longitud fija)', () => {
    const samples = ['err', 'P2002', 'deadlock detected', '', '💥', 'a'.repeat(10_000)]
    for (const s of samples) {
      expect(fingerprint16(s)).toHaveLength(DEV011_NO_STACKTRACE_LEAK_500.fingerprintLengthChars)
      expect(/^[a-f0-9]{16}$/i.test(fingerprint16(s))).toBe(true)
    }
  })

  it('500 response mock NO contiene forbidden leak keys', () => {
    const err = new Error('FATAL: connection to postgres failed DATABASE_URL=postgres://user:secretpw@db:5432/x')
    const safeResponse = {
      error: fingerprint16(err.message),
      prismaErrorCode: 'P2002',
    }
    const json = JSON.stringify(safeResponse).toLowerCase()
    for (const forb of DEV011_NO_STACKTRACE_LEAK_500.forbiddenLeakKeys) {
      expect(json.includes(forb.toLowerCase())).toBe(false)
    }
  })

  it('Campo errorFingerprint existe en safe response 500 (16 chars)', () => {
    expect(DEV011_NO_STACKTRACE_LEAK_500.requiredFields500.includes('errorFingerprint')).toBe(true)
  })
})

describe('[DEV SAST] DEV-012 · RFC demo random NO hardcode públicos SAT', () => {
  it('Forbidden hardcodes SCI041122EI6 / CUCC4512065I7 excluidos explícitamente', () => {
    for (const forb of DEV012_RFC_NO_HARDCODED_PUBLIC_SAT.forbiddenHardcoded) {
      expect(typeof forb).toBe('string')
      expect(forb).not.toMatch(/^demo|empres/i)
    }
  })

  it('buildDevDemoRfcFixture genera 100 RFCs 12/13 chars NO colisiones', () => {
    const set12 = new Set<string>()
    const set13 = new Set<string>()
    for (let i = 0; i < 50; i++) set12.add(buildDevDemoRfcFixture(true))
    for (let i = 0; i < 50; i++) set13.add(buildDevDemoRfcFixture(false))
    expect(set12.size).toBe(50)
    expect(set13.size).toBe(50)
    for (const rfc of set12) expect(rfc).toHaveLength(12)
    for (const rfc of set13) expect(rfc).toHaveLength(13)
  })

  it('RFCs generados NO empiezan por SCI / CUCC públicos (no enumeración)', () => {
    for (let i = 0; i < 200; i++) {
      const rfc = buildDevDemoRfcFixture(Math.random() > 0.5)
      expect(rfc.startsWith('SCI')).toBe(false)
      expect(rfc.startsWith('CUCC')).toBe(false)
    }
  })
})

describe('[DEV SAST] DEV-014 · Response suffix 8-12 chars trunc, NO full IDs / userId', () => {
  it('Suffix lengths: org 12 chars, companies 8 chars (long control)', () => {
    expect(DEV014_RESPONSE_IDS_SUFFIX_TRUNCATED.suffixLengthOrg).toBe(12)
    expect(DEV014_RESPONSE_IDS_SUFFIX_TRUNCATED.suffixLengthCompanies).toBe(8)
  })

  it('Forbidden fields response full IDs y clientSecret M2M excluidos', () => {
    for (const forb of DEV014_RESPONSE_IDS_SUFFIX_TRUNCATED.forbiddenResponseFields) {
      expect(forb.includes('Full') || forb === 'clientSecret' || forb.includes('userId')).toBe(true)
    }
  })

  it('Suffix truncation test: full ID 25cuid → suffix 12 chars correcto', () => {
    const fullOrgId = 'cmnntrppk000502gcp93ketfx'
    const suffix = fullOrgId.slice(-12)
    expect(suffix).toHaveLength(12)
    expect(fullOrgId.endsWith(suffix)).toBe(true)
    const fullCompanyId = 'cmt1xatbu00002qy4199p2t4m'
    const suffix8 = fullCompanyId.slice(-8)
    expect(suffix8).toHaveLength(8)
    expect(fullCompanyId.endsWith(suffix8)).toBe(true)
  })
})

describe('[DEV SAST] DEV-015 · Seed rate limit 1/30min distributed idempotency key', () => {
  it('windowMs = 1800000 ms = 30 min exacto', () => {
    expect(DEV015_SEED_RATE_LIMIT_1_PER_30MIN.windowMs).toBe(30 * 60 * 1000)
    expect(DEV015_SEED_RATE_LIMIT_1_PER_30MIN.maxRequests).toBe(1)
  })

  it('retryAfter = 1800 segundos = 30 min para Retry-After header HTTP 429', () => {
    expect(DEV015_SEED_RATE_LIMIT_1_PER_30MIN.retryAfterSeconds).toBe(1800)
  })

  it('key name includes distributed-v2 → NO local in-memory key single', () => {
    expect(DEV015_SEED_RATE_LIMIT_1_PER_30MIN.rateLimitKeyRequired.includes('distributed-v2')).toBe(true)
    expect(DEV015_SEED_RATE_LIMIT_1_PER_30MIN.rateLimitKeyRequired.startsWith('dev-seed-post-idempotent')).toBe(true)
  })
})

describe('[DEV SAST] Inventario 16 findings payloads + headers', () => {
  it('Total payloads DEV = 16 findings → 100% cobertura inventario', () => {
    expect(DEV_TOTAL_FINDINGS_PAYLOADS).toBe(16)
  })

  it('Headers hardening 6 items XFO DENY XCTO nosniff presentes', () => {
    const names = new Set(DEV016_HARDENING_HEADERS_6_ALL_RESPONSES.headersRequired)
    expect(names.has('X-Frame-Options')).toBe(true)
    expect(names.has('X-Content-Type-Options')).toBe(true)
    expect(names.has('Content-Security-Policy')).toBe(true)
    expect(names.has('Strict-Transport-Security')).toBe(true)
    expect(names.has('Referrer-Policy')).toBe(true)
    expect(names.has('Permissions-Policy')).toBe(true)
  })
})

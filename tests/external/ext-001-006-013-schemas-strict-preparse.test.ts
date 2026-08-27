/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/external/* M2M Schemas + Pre-parse
 * Findings cubiertos:
 *   EXT-001 · Strict schemas externalCfdiImport + MAX contentBase64 length (ALTO)
 *   EXT-006 · Scopes granular CFDI_IMPORT_CREATE_SCOPE vs CFDI_IMPORT_RUNS_READ_SCOPE (MEDIO)
 *   EXT-013 · Pre-parse Content-Length threshold 1.35x MAX return 413 antes malloc (ALTO)
 */

jest.mock('@/lib/m2m-oauth', () => ({
  verifyMachineToken: jest.fn().mockResolvedValue({ token_use: 'm2m', sub: 'client-test', org_id: 'org-test', scope: 'cfdi.import:create' }),
  hasRequiredScope: jest.fn().mockReturnValue(true),
  normalizeScopes: jest.fn().mockReturnValue([])
}))

jest.mock('next/server', () => ({
  NextRequest: class { url: string; headers: Map<string, string>; method: string
    constructor(u?: string, opts?: { method?: string; headers?: Record<string, string> }) {
      this.url = u ?? 'http://localhost:3000'
      this.method = opts?.method ?? 'POST'
      this.headers = new Map(Object.entries(opts?.headers ?? {}))
    } },
  NextResponse: {
    json: (body: unknown, init?: unknown) => ({ body, init, _nextResponse: true }),
  },
}))

import {
  ExternalCfdiImportCreateSchema,
  ExternalCfdiImportItemsQuerySchema,
  ExternalUserBulkSchema,
  ExternalProviderPaymentUpdateSchema,
  CFDI_IMPORT_CREATE_SCOPE,
  CFDI_IMPORT_RUNS_READ_SCOPE,
  MAX_EXTERNAL_PAYLOAD_BYTES,
  MAX_EXTERNAL_CFDI_IMPORT_FILES,
  MAX_CONTENT_BASE64_BYTES,
  MAX_CONTENT_BASE64_CHARS
} from '@/schemas/external'
import { validateM2MRequestHeaders } from '@/lib/m2m-route'
import { EXT_M2M_PAYLOADS } from './fixtures/payloads'
import type { NextRequest as MockNextRequestType } from 'next/server'

type MockNR = { method: string; headers: Map<string, string>; url: string } & MockNextRequestType

function mkRequest(method: string, headers: Record<string, string>): MockNR {
  return {
    method,
    headers: new Map(Object.entries(headers)),
    url: 'http://localhost:3000/api/external/cfdi-import'
  } as unknown as MockNR
}

describe('[EXT SAST] EXT-001 · Strict Schemas Zod + MAX contentBase64 length', () => {
  it('ExternalCfdiImportCreateSchema es strict: unknown field → ZodError (prototype pollution/overposting)', () => {
    const r = ExternalCfdiImportCreateSchema.safeParse({
      items: [{ fileName: 'a.xml', contentBase64: 'YWJj' }],
      campo_no_declarado_123: 'value_should_fail'
    })
    expect(r.success).toBe(false)
  })

  it('MAX_EXTERNAL_CFDI_IMPORT_FILES = 500 (igual a MAX_FILES_PER_REQUEST staging)', () => {
    expect(MAX_EXTERNAL_CFDI_IMPORT_FILES).toBe(500)
  })

  it('MAX_CONTENT_BASE64_BYTES = 5MB, chars=ceil(bytes*4/3) no overflow', () => {
    expect(MAX_CONTENT_BASE64_BYTES).toBe(5 * 1024 * 1024)
    expect(typeof MAX_CONTENT_BASE64_CHARS).toBe('number')
    expect(MAX_CONTENT_BASE64_CHARS).toBeGreaterThan(MAX_CONTENT_BASE64_BYTES)
  })

  it('contentBase64 > MAX_CONTENT_BASE64_CHARS → ZodError no OOM alloc', () => {
    const big = 'A'.repeat(MAX_CONTENT_BASE64_CHARS + 100)
    const r = ExternalCfdiImportCreateSchema.safeParse({
      items: [{ fileName: 'oversize.xml', contentBase64: big }]
    })
    expect(r.success).toBe(false)
  })

  it('ExternalUserBulkSchema strict: campo extra → ZodError', () => {
    const r = ExternalUserBulkSchema.safeParse({
      users: [{ correo: 'a@b.co', nombre_usuario: 'X', rol_empresa: 'ADMIN', empresas: ['ABC123456789'] }],
      campo_interno_bd: 'leak_value'
    })
    expect(r.success).toBe(false)
  })

  it('ExternalProviderPaymentUpdateSchema strict: UUID regex 32-48 chars hex/dash', () => {
    const r = ExternalProviderPaymentUpdateSchema.safeParse({
      uuid: 'NOT-A-UUID!!',
      estatus_pago: 'PAGADO'
    })
    expect(r.success).toBe(false)
  })

  it('ExternalCfdiImportItemsQuerySchema strict: unknown_field → rechaza unrecognized_keys (strict mode)', () => {
    const r = ExternalCfdiImportItemsQuerySchema.safeParse({
      hasErrors: 'true',
      waitingExternalValidation: 'false',
      unknown_field_XYZ: 'should fail strict'
    } as unknown as Record<string, string>)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.code).toBe('unrecognized_keys')
    }
  })

  it('ExternalCfdiImportItemsQuerySchema: hasErrors/waiting string transform → boolean', () => {
    const r = ExternalCfdiImportItemsQuerySchema.parse({
      hasErrors: 'true',
      waitingExternalValidation: 'false'
    } as unknown as Record<string, string>)
    expect(typeof r.hasErrors === 'boolean').toBe(true)
    expect(typeof r.waitingExternalValidation === 'boolean').toBe(true)
    expect(r.hasErrors).toBe(true)
    expect(r.waitingExternalValidation).toBe(false)
  })
})

describe('[EXT SAST] EXT-006 · Scopes Granulares CFDI_CREATE vs RUNS_READ NO overlap genérico', () => {
  it('CFDI_IMPORT_CREATE_SCOPE = cfdi.import:create (no cfdi.import genérico)', () => {
    expect(CFDI_IMPORT_CREATE_SCOPE).toBe('cfdi.import:create')
    expect(CFDI_IMPORT_CREATE_SCOPE).not.toBe('cfdi.import')
  })

  it('CFDI_IMPORT_RUNS_READ_SCOPE = cfdi.import.runs:read (distinto al create)', () => {
    expect(CFDI_IMPORT_RUNS_READ_SCOPE).toBe('cfdi.import.runs:read')
    expect(CFDI_IMPORT_RUNS_READ_SCOPE).not.toBe(CFDI_IMPORT_CREATE_SCOPE)
  })

  it('POST cfdi-import vs GET runs / items usan scopes DISTINTOS (matchea importado en routes)', () => {
    expect(CFDI_IMPORT_CREATE_SCOPE.endsWith(':create')).toBe(true)
    expect(CFDI_IMPORT_RUNS_READ_SCOPE.endsWith(':read')).toBe(true)
  })
})

describe('[EXT SAST] EXT-013 · Pre-parse Content-Length threshold 1.35x MAX (413 antes malloc)', () => {
  const THRESHOLD = Math.ceil(MAX_EXTERNAL_PAYLOAD_BYTES * 1.35)

  it(`MAX_EXTERNAL_PAYLOAD_BYTES = 50MB, threshold=ceil(50*1.35)=${THRESHOLD} bytes`, () => {
    expect(MAX_EXTERNAL_PAYLOAD_BYTES).toBe(50 * 1024 * 1024)
    expect(THRESHOLD).toBeGreaterThan(MAX_EXTERNAL_PAYLOAD_BYTES)
  })

  it('Content-Length > threshold → validateM2MRequestHeaders retorna NextResponse.json status=413', () => {
    const req = mkRequest('POST', {
      'content-type': 'application/json',
      'content-length': String(THRESHOLD + 999_999)
    })
    const res = validateM2MRequestHeaders(req) as unknown as { init?: { status: number } } | null
    expect(res).not.toBeNull()
    expect(res?.init?.status).toBe(413)
  })

  it('Content-Length justo en threshold-1 → pasa (no hay early 413)', () => {
    const req = mkRequest('POST', {
      'content-type': 'application/json',
      'content-length': String(THRESHOLD - 1)
    })
    const res = validateM2MRequestHeaders(req)
    expect(res).toBeNull()
  })

  it(`EXT_M2M_PAYLOADS.PAYLOAD_013_PRE_PARSE_CL_BIGGER.status = ${EXT_M2M_PAYLOADS.PAYLOAD_013_PRE_PARSE_CL_BIGGER.httpStatus}`, () => {
    expect(EXT_M2M_PAYLOADS.PAYLOAD_013_PRE_PARSE_CL_BIGGER.httpStatus).toBe(413)
  })
})

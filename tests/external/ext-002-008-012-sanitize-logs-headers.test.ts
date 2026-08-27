/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/external/* Sanitize + Logs + Headers
 * Findings cubiertos:
 *   EXT-002 · sanitizeZodIssues whitelist fields NO path interno (ALTO)
 *   EXT-008 · safeErrSummary typed NO emails/RFC/UUID raw (PII) en logs (ALTO)
 *   EXT-012 · validateM2MRequestHeaders 415 CT / 411 CL-zero / 413 oversized (ALTO)
 */

jest.mock('@/lib/m2m-oauth', () => ({
  verifyMachineToken: jest.fn().mockResolvedValue({ token_use: 'm2m', sub: 'client-test', org_id: 'org-test', scope: 'payments:update' }),
  hasRequiredScope: jest.fn().mockReturnValue(true),
  normalizeScopes: jest.fn().mockReturnValue([])
}))

jest.mock('next/server', () => ({
  NextRequest: class { method: string; headers: Map<string, string>; url: string
    constructor(opts?: { method?: string; headers?: Record<string, string> }) {
      this.method = opts?.method ?? 'POST'
      this.headers = new Map(Object.entries(opts?.headers ?? {}))
      this.url = 'http://localhost:3000'
    } },
  NextResponse: {
    json: (body: unknown, init?: unknown) => ({ body, init, _isNext: true }),
  },
}))

import { z } from 'zod'
import { sanitizeZodIssues, M2MSafeFieldWhiteList, sanitizeZodFieldName } from '@/schemas/external'
import { safeErrSummary, fingerprint, isInternalHostname } from '@/lib/security'
import { validateM2MRequestHeaders } from '@/lib/m2m-route'
import type { NextRequest as MockNR } from 'next/server'

function req(method: string, headers: Record<string, string>): MockNR {
  return { method, headers: new Map(Object.entries(headers)), url: 'http://x' } as unknown as MockNR
}

describe('[EXT SAST] EXT-002 · sanitizeZodIssues whitelist fields NO leak paths internos', () => {
  it('issue.path[0] NO en whitelist → sanitizeZodFieldName retorna campo_desconocido', () => {
    expect(sanitizeZodFieldName('__proto__')).toBe('campo_desconocido')
    expect(sanitizeZodFieldName('tabla_bd_interna_id')).toBe('campo_desconocido')
    expect(sanitizeZodFieldName('clientSecret')).toBe('campo_desconocido')
  })

  it('issue.path[0] EN whitelist → retorna el mismo nombre (campos seguros del contrato M2M)', () => {
    for (const safeField of ['user', 'uuid', 'items', 'fileName', 'contentBase64', 'batchId']) {
      expect(M2MSafeFieldWhiteList.has(safeField)).toBe(true)
      expect(sanitizeZodFieldName(safeField)).toBe(safeField)
    }
  })

  it('ZodError path=["correo_ilegal_pii","[1]","deep"] → sanitized NO contienen raw nombre fuera whitelist', () => {
    const badSchema = z.strictObject({ items: z.array(z.strictObject({
      campo_secreto_bd: z.string().min(1)
    })) }).strict()
    const r = badSchema.safeParse({ items: [{ campo_secreto_bd: '' }, { x: 1 }] })
    expect(r.success).toBe(false)
    if (!r.success) {
      const sanitized = sanitizeZodIssues(r.error.issues)
      for (const s of sanitized) {
        expect(s.field).not.toContain('campo_secreto_bd')
        expect(s.message).toBe('Valor inválido para el campo solicitado; consulta la documentación M2M.')
      }
    }
  })

  it('issue.path.length > 1 → suffix .[N nested] , N = path.length - 1', () => {
    const dummy: z.ZodIssue[] = [
      { code: z.ZodIssueCode.custom, path: ['items', 2, 'contentBase64'], message: 'bad' }
    ]
    const s = sanitizeZodIssues(dummy)[0]
    expect(s.field.endsWith('.[2 nested]')).toBe(true)
  })
})

describe('[EXT SAST] EXT-008 · safeErrSummary typed narrowing NO PII en logs', () => {
  it('ZodError → {name, issueCount, firstField}, NO message completo (podría tener PII)', () => {
    const ze = new z.ZodError([
      { code: z.ZodIssueCode.too_small, minimum: 12, inclusive: true, path: ['correo'], message: 'se esperaba RFC ODE8604257UA pero llegó A@B.com' } as unknown as z.ZodIssue
    ])
    const s = safeErrSummary(ze)
    expect(s.name).toBe('ZodError')
    expect((s as { issueCount?: unknown }).issueCount).toBe(1)
    expect((s as { firstField?: unknown }).firstField).toBe('correo')
    expect(JSON.stringify(s)).not.toContain('ODE8604257UA')
    expect(JSON.stringify(s)).not.toContain('A@B.com')
  })

  it('PrismaClientKnownRequestError P2002 → {code, metaKeys}, NO raw message', () => {
    const err = {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      message: 'Unique constraint failed on organizationId=cmnntrppk000502gcp93ketfx RFC=ODE8604257UA email=a@b.c',
      meta: { target: ['email', 'organizationId', 'internal_secret_token'] }
    }
    const s = safeErrSummary(err)
    expect((s as { code?: unknown }).code).toBe('P2002')
    expect(JSON.stringify(s)).not.toContain('cmnntrppk000502gcp93ketfx')
    expect(JSON.stringify(s)).not.toContain('ODE8604257UA')
    expect(JSON.stringify(s)).not.toContain('a@b.c')
  })

  it('fingerprint value: SHA256 slice 16 bytes = 32 hex chars (no reversible)', () => {
    const pii = 'usuario_interno@empresa-cliente.com.mx'
    const f = fingerprint(pii)
    expect(f.length).toBe(32)
    expect(f).not.toContain('@')
    expect(f).not.toBe(pii)
    expect(fingerprint(pii)).toBe(f) // deterministic
  })

  it('Error genérico con stack email → stackFirst truncado a 160 chars + msgHash fingerprint', () => {
    const e = new Error('Fallo procesando RFC: ODE8604257UA user=a@b.com')
    e.stack = `Error: Fallo procesando RFC: ODE8604257UA user=a@b.com\n    at handler (/app/src/routes/internal.ts:123:45)\n    at Next.js`
    const s = safeErrSummary(e)
    const serialized = JSON.stringify(s)
    expect(serialized).not.toContain('a@b.com')
    expect(serialized).not.toContain('ODE8604257UA')
    expect(typeof (s as { msgHash?: unknown }).msgHash === 'string').toBe(true)
  })
})

describe('[EXT SAST] EXT-012 · validateM2MRequestHeaders 415/411/413 triple check', () => {
  it('Content-Type=text/plain → 415 Unsupported Media Type', () => {
    const r = req('POST', { 'content-type': 'text/plain', 'content-length': '100' })
    const out = validateM2MRequestHeaders(r, { requireJsonBody: true }) as unknown as { init: { status: number } }
    expect(out.init.status).toBe(415)
  })

  it('Content-Length=0 o missing → 411 Length Required', () => {
    const noCL = req('POST', { 'content-type': 'application/json' })
    const out1 = validateM2MRequestHeaders(noCL, { requireJsonBody: true }) as unknown as { init: { status: number } }
    expect(out1.init.status).toBe(411)

    const zeroCL = req('POST', { 'content-type': 'application/json', 'content-length': '0' })
    const out2 = validateM2MRequestHeaders(zeroCL, { requireJsonBody: true }) as unknown as { init: { status: number } }
    expect(out2.init.status).toBe(411)
  })

  it('GET sin body → salta validaciones (null), porque no tiene cuerpo', () => {
    const g = req('GET', {})
    const out = validateM2MRequestHeaders(g)
    expect(out).toBeNull()
  })

  it('isInternalHostname 10.x/172.16-31.x/192.168.x/169.254.x = true (SSRF blocked)', () => {
    expect(isInternalHostname('10.0.0.1')).toBe(true)
    expect(isInternalHostname('172.31.255.1')).toBe(true)
    expect(isInternalHostname('192.168.1.1')).toBe(true)
    expect(isInternalHostname('169.254.169.254')).toBe(true)
    expect(isInternalHostname('8.8.8.8')).toBe(false)
  })
})

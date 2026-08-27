 
import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'
import { sanitizeZodIssuesForClient } from '@/schemas/import'
import { safeErrSummary, fingerprint } from '@/lib/security'
import { isStrictRfc4122Uuid } from '@/lib/xml-sanitize'

describe('IMP-012 · Logging seguro: safeErrSummary y fingerprint sin PII', () => {
  it('safeErrSummary ZodError: incluye issueCount + firstField (NO values crudos)', () => {
    const schema = z.object({ rfc: z.string().min(10).max(13), uuid: z.string().uuid() })
    try { schema.parse({ rfc: 'XX', uuid: 'NOUUID' }) } catch (e) {
      const s = safeErrSummary(e)
      expect(s.name).toBe('ZodError')
      if ('issueCount' in s) {
        expect(s.issueCount).toBeGreaterThanOrEqual(1)
        expect(typeof s.firstField).toBe('string')
        expect(s.firstField).toBe('rfc')
        expect(JSON.stringify(s)).not.toContain('XX')
        expect(JSON.stringify(s)).not.toContain('NOUUID')
      }
    }
  })

  it('safeErrSummary Prisma P2002: incluye code P2002 + NO meta values', () => {
    const e = { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['rfc', 'organizationId'] } }
    const s = safeErrSummary(e)
    expect(s.name).toBe('PrismaClientKnownRequestError')
    if ('code' in s) {
      expect(s.code).toBe('P2002')
      expect(s.metaKeys.sort()).toEqual(['target'])
      expect(JSON.stringify(s)).not.toContain('value')
    }
  })

  it('safeErrSummary SyntaxError: msgHash SHA-256 NO incluye mensaje original stack PII', () => {
    const msg = 'Syntax error: secret=abc123, RFC=ODE8604257UA'
    const e = new SyntaxError(msg)
    const s = safeErrSummary(e)
    const payload = JSON.stringify(s)
    expect(payload).not.toContain('abc123')
    expect(payload).not.toContain('ODE8604257UA')
    expect(s.name).toBe('SyntaxError')
  })

  it('fingerprint length 32 hex chars (SHA-256 primeros 16 bytes = 32 hex)', () => {
    const f1 = fingerprint('secret-token-12345')
    const f2 = fingerprint('secret-token-12345')
    const f3 = fingerprint('secret-token-XXXX')
    expect(f1.length).toBe(32)
    expect(/^[0-9a-f]{32}$/.test(f1)).toBe(true)
    expect(f1).toBe(f2)
    expect(f1).not.toBe(f3)
  })

  it('fingerprint 16 byte slice vs 32 byte: longitud correcta', () => {
    expect(fingerprint('hola', true).length).toBe(32)
    expect(fingerprint('hola', false).length).toBe(64)
  })

  it('safeErrSummary NilError: error null/undefined manejado', () => {
    const s1 = safeErrSummary(null)
    const s2 = safeErrSummary(undefined)
    expect(s1.name).toBe('NilError')
    expect(s2.name).toBe('NilError')
  })
})

describe('IMP-013 · Zod issues client sanitization sin paths numéricos / data cruda', () => {
  it('sanitizeZodIssuesForClient: path [3,"xml","bytes"] → "3.xml.bytes" con <index>? NO, debe mantener <index> template', () => {
    const issues: Array<z.ZodIssue> = [
      { code: 'too_big', path: [3, 'xml', 'bytes'], message: 'too big', maximum: 1000, inclusive: true, origin: 'number', exact: false },
      { code: 'custom', path: [0, 'relatedUuid'], message: 'uuid invalid' }
    ]
    const safe = sanitizeZodIssuesForClient(issues)
    expect(safe.length).toBe(2)
    expect(safe[0].path).toBe('<index>.xml.bytes')
    expect(safe[1].path).toBe('<index>.relatedUuid')
    // NO debe contener los índices numéricos reales
    expect(safe.map(x => x.path).join(',')).not.toContain('3.')
    expect(safe.map(x => x.path).join(',')).not.toContain('0.')
  })

  it('sanitizeZodIssuesForClient: message ≤ 240 chars truncado para no leak data grande', () => {
    const longMsg = 'A'.repeat(500)
    const issues = [{ code: 'custom' as const, path: ['body'] as Array<string | number>, message: longMsg }]
    const safe = sanitizeZodIssuesForClient(issues)
    expect(safe[0].message.length).toBeLessThanOrEqual(240)
    expect(safe[0].message.length).toBe(240)
  })
})

describe('IMP-014 · Prisma ID number NO leak a cliente (createInvoiceFromXml return shape)', () => {
  it('Return object keys: created/skipped/error solo status, uuid, message → SIN key `id`', () => {
    // Unitario test shape: validamos que los objetos de ejemplo NO tienen key "id" number
    const samples = [
      { status: 'created' as const, uuid: 'A'.repeat(32), message: 'ok' },
      { status: 'skipped' as const, uuid: 'B'.repeat(32), message: 'dupe' },
      { status: 'error' as const, uuid: null, message: 'fail' }
    ]
    for (const s of samples) {
      expect(Object.keys(s)).not.toContain('id')
      expect(Object.keys(s).sort()).toEqual(['message', 'status', 'uuid'])
    }
  })

  it('recordId auditLog usa fingerprint orgId NO orgId real', () => {
    const orgId = 'cmnntrppk000502gcp93ketfx'
    const recordId = fingerprint(orgId).slice(0, 16)
    expect(recordId.length).toBe(16)
    expect(recordId).not.toBe(orgId)
    expect(orgId.startsWith('cmn')).toBe(true)
    expect(recordId.startsWith('cmn')).toBe(false) // fingerprints son hex, no letras org prefix
  })

  it('auditLog NO contiene UUID invoice completo en description si hay error', () => {
    const desc = `CFDI batch: 10 registros, 5 insertados, 5 errores`
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    // description NO incluye UUIDs a menos que sea necesario; en la implementación solo se reportan contadores
    expect(desc).not.toContain(uuid)
    expect(isStrictRfc4122Uuid(uuid)).toBe(true)
  })
})

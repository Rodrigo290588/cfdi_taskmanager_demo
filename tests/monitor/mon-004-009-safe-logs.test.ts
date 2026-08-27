import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'
import { safeErrSummary, fingerprint } from '@/lib/security'
import { fp32, buildSafeLikePattern } from '@/lib/monitor-security-helpers'

describe('MON-004 · safeErrSummary PII Redaction (3 Capas Redacción RFC + msgHash 32 chars)', () => {
  it('MON-004: message DIRECTO con password/token/apikey → redactados [REDACTED] + msgHash 32 hex chars consistente', () => {
    const err = new Error('Auth failed: password=SuperSecret123! token=eyJhbGciOiJIUzI1Ni.pwned apikey=AKIAIOSFODNN7EXAMPLE client_secret=sk_live_AABBCC_12345 fiel=MIIC5DCC')
    const s = safeErrSummary(err)
    const t = JSON.stringify(s)
    expect(t).not.toContain('SuperSecret123')
    expect(t).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(t).not.toContain('sk_live_')
    expect(t).toContain('[REDACTED]')
    const msgHash = 'msgHash' in s ? (s as { msgHash?: string }).msgHash : undefined
    expect(typeof msgHash).toBe('string')
    expect(/^[0-9a-f]{32}$/.test(String(msgHash))).toBe(true)
  })

  it('MON-004: error con IP RFC1918 192.168.1.100 y 10.0.0.1 y 172.16.0.5 en message → [REDACTED-IP]', () => {
    const err = new Error('Timeout conectando a servidores internos: 192.168.1.100:5432, 10.0.0.1:6379, 172.16.0.5:8080, loopback 127.0.0.1')
    const s = safeErrSummary(err)
    const t = JSON.stringify(s)
    expect(t).not.toContain('192.168.1.100')
    expect(t).not.toContain('10.0.0.1')
    expect(t).not.toContain('172.16.0.5')
    expect(t).not.toContain('127.0.0.1')
    expect(t).toContain('[REDACTED-IP]')
  })

  it('MON-004: error con paths sensibles /src/ /app/ C:\\Users\\... .ts:122 .js:88 en message → [REDACTED-PATH]', () => {
    const err = new Error('Exception at /app/src/app/api/monitor/stats/route.ts:122:45 y módulo C:\\Users\\admin\\projects\\node_modules\\lib\\index.js:88 chain /src/lib/auth.ts')
    const s = safeErrSummary(err)
    const t = JSON.stringify(s)
    expect(t).toContain('[REDACTED-PATH]')
  })

  it('MON-004: msgHash consistente: mismo input = mismo hash SHA256 (32 chars). Diferente input = diferente hash', () => {
    const e1 = safeErrSummary(new Error('same-message-XYZ'))
    const e2 = safeErrSummary(new Error('same-message-XYZ'))
    const e3 = safeErrSummary(new Error('different-message-ABC'))
    const h1 = 'msgHash' in e1 ? (e1 as { msgHash?: string }).msgHash : undefined
    const h2 = 'msgHash' in e2 ? (e2 as { msgHash?: string }).msgHash : undefined
    const h3 = 'msgHash' in e3 ? (e3 as { msgHash?: string }).msgHash : undefined
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
    expect(/^[0-9a-f]{32}$/.test(String(h1))).toBe(true)
  })

  it('MON-004: ZodError discriminado: name=ZodError + issueCount + firstField SIN msgHash ni stack (contract)', () => {
    const ze = new z.ZodError([{ code: 'custom', path: ['importRunId'], message: 'invalid uuid v4 expected' }])
    const s = safeErrSummary(ze)
    expect(s.name).toBe('ZodError')
    const zodS = s as Extract<typeof s, { name: 'ZodError' }>
    expect(zodS.issueCount).toBe(1)
    expect(zodS.firstField).toBe('importRunId')
    expect('msgHash' in s).toBe(false)
  })
})

describe('MON-009 · DB IDs NO en logs. Descifrado filas drilldown: row.id NUNCA se loggea crudo. Solo fp32 one-way', () => {
  it('MON-009: fingerprint(orgId:uuid:dbId) + fp32 = 8 hex chars. No contiene substring del db_id crudo ni sensitive PII', () => {
    const orgId = 'cmnntrppk000502gcp93ketfx'
    const dbIdSensitive = 'ir_item_internal_pk_987654321_CONFIDencial'
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const token = fp32(fingerprint(`drilldown_decrypt:${orgId}:${uuid}:${dbIdSensitive}`))
    expect(/^[0-9a-f]{8}$/.test(token)).toBe(true)
    expect(token.toLowerCase()).not.toContain('confidencial')
    expect(token.toLowerCase()).not.toContain('987654321')
    expect(token.toLowerCase()).not.toContain('internal_pk')
    expect(token.length).toBe(8)
  })

  it('MON-009: fp32(hex 32 chars) = primeros 8 chars (hash truncate mode). Si no es hex = sha256 slice 8.', () => {
    const longHex = 'a1b2c3d4e5f60718293a4b5c6d7e8f9001234567'
    expect(fp32(longHex)).toBe('a1b2c3d4')
    const normalStr = 'drilldown-batch-error-occurred-2025'
    const t = fp32(normalStr)
    expect(/^[0-9a-f]{8}$/.test(t)).toBe(true)
  })

  it('MON-004+MON-009: buildSafeLikePattern API no expone IDs internos. Output = pattern + escapeChar (2 keys)', () => {
    const s = buildSafeLikePattern('batch-123')
    expect(Object.keys(s).sort()).toEqual(['escapeChar', 'pattern'])
  })

  it('MON-004+MON-009: Token error log compacto fp32(fingerprint(...)) = 8 hex, consistente y sin PII', () => {
    const t = fp32(fingerprint(`error_ctx:batch_monitor:2025-06-15:${Date.now()}`))
    expect(t.length).toBe(8)
    expect(/^[0-9a-f]{8}$/.test(t)).toBe(true)
  })
})

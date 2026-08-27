/* Suite 4: OAUTH-005 safeErrSummary NO leak PII + OAUTH-008 BasicAuth max 4096b */
jest.mock('@/lib/prisma', () => ({ prisma: { machineClient: { findUnique: jest.fn() } } }))
import { safeErrSummary } from '@/lib/security'
import { parseBasicAuthSafe } from '@/lib/m2m-security-helpers'
import { getMachineClientsFromEnv } from '@/lib/m2m-oauth'
import { PAYLOADS_BASIC_AUTH } from './fixtures/payloads'

describe('OAUTH-005 safeErrSummary redacta 3 capas PII (secrets/IPs/paths) + msgHash 32hex', () => {
  const SECRET_VALUE = 'client_secret=TOPSECRET_CLIENT_123_MEGGS_FOOBAR'

  it('error con client_secret= → [REDACTED] no leak', () => {
    const err = new Error('Error SQLi fail ' + SECRET_VALUE)
    const s = safeErrSummary(err)
    expect('msg' in s).toBe(true)
    if ('msg' in s) {
      expect(s.msg).not.toContain('TOPSECRET_CLIENT_123_MEGGS')
      expect(s.msg).toContain('[REDACTED]')
    }
    if ('msgHash' in s) {
      expect(s.msgHash).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('IP RFC1918 + source path → redactados', () => {
    const s = safeErrSummary(new Error('conexión desde 10.1.2.3 y 192.168.1.1 falló C:\\src\\index.ts:123'))
    if ('msg' in s) {
      expect(s.msg).toContain('[REDACTED-IP]')
      expect(s.msg).toContain('[REDACTED-PATH]')
      expect(s.msg).not.toContain('10.1.2.3')
    }
  })

  it('M2M_OAUTH_CLIENTS_JSON corrupto: NO raw JSON leak, safeErrSummary muestra ref= fp32', () => {
    const OLD = process.env.M2M_OAUTH_CLIENTS_JSON
    process.env.M2M_OAUTH_CLIENTS_JSON = '{"broken": json!!! broken {'
    const spyErr = jest.spyOn(console, 'error').mockImplementation(() => {})
    const list = getMachineClientsFromEnv()
    expect(list.length).toBe(0)
    const errStr = spyErr.mock.calls.map(c => c.join(' ')).join(' ')
    expect(errStr).not.toContain('{"broken"')
    expect(errStr).toMatch(/ref=/)
    spyErr.mockRestore()
    process.env.M2M_OAUTH_CLIENTS_JSON = OLD
  })

  it('JSON corrupto retorna [] (fail closed sin crash)', () => {
    const old = process.env.M2M_OAUTH_CLIENTS_JSON
    process.env.M2M_OAUTH_CLIENTS_JSON = '{'
    expect(getMachineClientsFromEnv()).toEqual([])
    process.env.M2M_OAUTH_CLIENTS_JSON = old
  })
})

describe('OAUTH-008 parseBasicAuthSafe longitud max 4096 + alphabet + padding', () => {
  it('longitud 8192 chars >4096 → NULL (DoS alloc prevent)', () => {
    const hdr = 'Basic ' + 'A'.repeat(8192)
    expect(parseBasicAuthSafe(hdr)).toBeNull()
  })

  type BasicAuthPayload = { id: string; rawHeader?: string; expected: string }
  it.each((PAYLOADS_BASIC_AUTH.filter(p => p.rawHeader && p.expected === 'reject') as BasicAuthPayload[]))
  ('parseBasicAuthSafe return null $id', (p: BasicAuthPayload) => {
    expect(parseBasicAuthSafe(p.rawHeader)).toBeNull()
  })

  it('Padding mod 4 inválido (AAAAA len=5) → null', () => {
    expect(parseBasicAuthSafe('Basic AAAAA')).toBeNull()
  })

  it('Alphabet chars inválidos → null', () => {
    expect(parseBasicAuthSafe('Basic !!!!@@@@####$$$$')).toBeNull()
  })

  it('Decoded largo > 3000 → null', () => {
    const s = 'x:' + 'A'.repeat(4000)
    expect(parseBasicAuthSafe('Basic ' + Buffer.from(s).toString('base64'))).toBeNull()
  })

  it('clientId largo 300 chars >255 → null', () => {
    const s = 'a'.repeat(300) + ':secret123'
    expect(parseBasicAuthSafe('Basic ' + Buffer.from(s).toString('base64'))).toBeNull()
  })
})

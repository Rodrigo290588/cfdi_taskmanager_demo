/* Suite 5: OAUTH-006 JWT entropy 32 bytes + OAUTH-011 expires clamp 86400 prod */
import {
  assertJwtSecretEntropy,
  clampExpiresInSeconds,
  PROD_MAX_EXPIRES_SECONDS,
  NON_PROD_MAX_EXPIRES_SECONDS,
  MIN_JWT_SECRET_BYTES,
} from '@/lib/m2m-oauth-security'
import type { MachineClientIdentity } from '@/lib/m2m-oauth'
import { resolveExpiresInSeconds, issueMachineToken, verifyMachineToken } from '@/lib/m2m-oauth'
import { PAYLOADS_JWT_MISCONFIG } from './fixtures/payloads'

describe('OAUTH-006 assertJwtSecretEntropy MIN 256 bits = MIN_JWT_SECRET_BYTES 32', () => {
  type JwtMisconfigPayload = { id: string; secret?: string; expiresIn: string; expected: string }
  it.each((PAYLOADS_JWT_MISCONFIG.filter(p => p.expected === 'reject') as JwtMisconfigPayload[]))
  ('secret corto → throw ($id)', (p: JwtMisconfigPayload) => {
    expect(() => assertJwtSecretEntropy(p.secret)).toThrow()
  })

  it('31 bytes (MIN - 1) → throw error "min 32 bytes"', () => {
    expect(() => assertJwtSecretEntropy('A'.repeat(MIN_JWT_SECRET_BYTES - 1))).toThrow(/min 32 bytes/)
  })

  it('32 bytes exactos OK devuelve Uint8Array', () => {
    const r = assertJwtSecretEntropy('A'.repeat(32))
    expect(r).toBeInstanceOf(Uint8Array)
    expect(r.byteLength).toBeGreaterThanOrEqual(32)
  })

  it('secret null → throw', () => {
    expect(() => assertJwtSecretEntropy(null as unknown as string)).toThrow()
  })
})

describe('OAUTH-011 clampExpiresInSeconds MAX clamp 86400 prod', () => {
  type JwtMisconfigPayload2 = { id: string; expiresIn: string; expected: string }
  it.each((PAYLOADS_JWT_MISCONFIG.filter(p => p.expiresIn === '30d' || /^999/.test(p.expiresIn)) as JwtMisconfigPayload2[]))
  ('$id · NO excede NON_PROD_MAX_EXPIRES_SECONDS', (p: JwtMisconfigPayload2) => {
    const t = resolveExpiresInSeconds(p.expiresIn)
    expect(t).toBeLessThanOrEqual(NON_PROD_MAX_EXPIRES_SECONDS)
  })

  it('PROD clamp 30 días a 86400 segundos', () => {
    expect(clampExpiresInSeconds(30 * 24 * 3600, 'production')).toBe(PROD_MAX_EXPIRES_SECONDS)
  })

  it('7200s < 86400 = sin cambios', () => {
    expect(clampExpiresInSeconds(7200, 'production')).toBe(7200)
  })

  it('99999999999s = clamp 86400 prod', () => {
    expect(clampExpiresInSeconds(999999999, 'production')).toBe(PROD_MAX_EXPIRES_SECONDS)
  })
})

describe('JWT issue/verify HS256 (alg whitelist)', () => {
  const OLD = process.env.M2M_JWT_SECRET
  beforeAll(() => { process.env.M2M_JWT_SECRET = 'k'.repeat(40) })
  afterAll(() => { process.env.M2M_JWT_SECRET = OLD })

  it('issueMachineToken expiresIn clamp NON_PROD_MAX', async () => {
    process.env.M2M_JWT_EXPIRES_IN = '999d'
    const t = await issueMachineToken({
      clientId: 'x',
      organizationId: 'org1',
      scopes: ['a'],
    } as MachineClientIdentity, ['a'])
    expect(t.expiresIn).toBeLessThanOrEqual(NON_PROD_MAX_EXPIRES_SECONDS)
  })

  it('verifyMachineToken RS256 algorithm rechaza (whitelist)', async () => {
    await expect(verifyMachineToken('eyJhbGciOiJSUzI1NiJ9.e30.')).rejects.toBeDefined()
  })
})

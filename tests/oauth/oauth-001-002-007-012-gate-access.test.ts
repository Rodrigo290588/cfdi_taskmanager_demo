/* Suite 1: Gate Access (OAUTH-001, 002, 007, 012) */
jest.mock('@/lib/prisma', () => ({ prisma: { machineClient: { findUnique: jest.fn(), update: jest.fn() } } }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(() => Promise.resolve({ success: true, limit: 5, remaining: 4, resetAt: Date.now() + 1000, retryAfterMs: 1000 })) }))
import { authenticateMachineClient } from '@/lib/m2m-oauth'
import { validateLastUsedIp, normalizeScopesStrict } from '@/lib/m2m-security-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import { FIXTURE_DISABLED_CLIENT, FIXTURE_EXPIRED_CLIENT, FIXTURE_IP_RESTRICTED_CLIENT, FIXTURE_VALID_CLIENT, SAST_SEED_ORGS } from './fixtures/payloads'

const prismaMock = prisma as unknown as { machineClient: { findUnique: jest.Mock; update: jest.Mock } }

const VALID_DB_CLIENT = {
  id: 'mc_valid',
  clientId: FIXTURE_VALID_CLIENT.clientId,
  clientSecretHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  organizationId: SAST_SEED_ORGS.ORG_A.id,
  scopes: FIXTURE_VALID_CLIENT.scopes,
  defaultScopes: FIXTURE_VALID_CLIENT.defaultScopes,
  isActive: true,
  allowedIps: [],
  expiresAt: null,
}

beforeEach(() => { jest.clearAllMocks() })

describe('OAUTH-001 Fallback Env Access Controls (isActive/expiresAt/IP whitelist)', () => {
  const OLD_ENV = { ...process.env }
  afterEach(() => { process.env = { ...OLD_ENV } })

  it('fallback env DESACTIVADO → 401 invalid_client', async () => {
    process.env.M2M_OAUTH_CLIENTS_JSON = JSON.stringify([{
      clientId: FIXTURE_DISABLED_CLIENT.clientId,
      clientSecret: 'EnvSecret123',
      isActive: false,
      organizationId: SAST_SEED_ORGS.ORG_A.id,
      scopes: ['a'],
      defaultScopes: ['a'],
    }])
    prismaMock.machineClient.findUnique.mockResolvedValueOnce(null)
    const r = await authenticateMachineClient({ clientId: FIXTURE_DISABLED_CLIENT.clientId, clientSecret: 'EnvSecret123', requestedScopes: ['a'] })
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.status).toBe(401); expect(r.error).toBe('invalid_client') }
  })

  it('fallback env CADUCADO expiresAt 2024 → 401', async () => {
    process.env.M2M_OAUTH_CLIENTS_JSON = JSON.stringify([{
      clientId: FIXTURE_EXPIRED_CLIENT.clientId,
      clientSecret: 'X',
      expiresAt: FIXTURE_EXPIRED_CLIENT.expiresAt,
      organizationId: SAST_SEED_ORGS.ORG_A.id,
      scopes: ['a'],
      defaultScopes: ['a'],
    }])
    prismaMock.machineClient.findUnique.mockResolvedValueOnce(null)
    const r = await authenticateMachineClient({ clientId: FIXTURE_EXPIRED_CLIENT.clientId, clientSecret: 'X', requestedScopes: ['a'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })

  it('fallback env allowedIps whitelist + IP fuera → 403 access_denied', async () => {
    process.env.M2M_OAUTH_CLIENTS_JSON = JSON.stringify([{
      clientId: FIXTURE_IP_RESTRICTED_CLIENT.clientId,
      clientSecret: 'OK',
      allowedIps: ['10.0.0.8'],
      organizationId: SAST_SEED_ORGS.ORG_A.id,
      scopes: ['scope_a'],
      defaultScopes: ['scope_a'],
    }])
    prismaMock.machineClient.findUnique.mockResolvedValueOnce(null)
    const r = await authenticateMachineClient({ clientId: FIXTURE_IP_RESTRICTED_CLIENT.clientId, clientSecret: 'OK', requestedScopes: ['scope_a'], sourceIp: '187.150.20.5' })
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.status).toBe(403); expect(r.error).toBe('access_denied') }
  })

  it('fallback env allowedIps IN sourceIp → 200 OK', async () => {
    process.env.M2M_OAUTH_CLIENTS_JSON = JSON.stringify([{
      clientId: 'env_whitelist_ok_011',
      clientSecret: 'S3cret!',
      allowedIps: ['10.0.0.8'],
      organizationId: SAST_SEED_ORGS.ORG_A.id,
      scopes: ['scope_a'],
      defaultScopes: ['scope_a'],
    }])
    prismaMock.machineClient.findUnique.mockResolvedValueOnce(null)
    const r = await authenticateMachineClient({ clientId: 'env_whitelist_ok_011', clientSecret: 'S3cret!', requestedScopes: ['scope_a'], sourceIp: '10.0.0.8' })
    expect(r.ok).toBe(true)
  })

  it('prisma throw connection error → fallback applies rules NO crash', async () => {
    process.env.M2M_OAUTH_CLIENTS_JSON = JSON.stringify([{
      clientId: 'env_errprisma_ok',
      clientSecret: 'X!',
      isActive: true,
      organizationId: SAST_SEED_ORGS.ORG_A.id,
      scopes: ['cfdi:read'],
      defaultScopes: ['cfdi:read'],
    }])
    prismaMock.machineClient.findUnique.mockRejectedValueOnce(new Error('P2002 connection refused'))
    const r = await authenticateMachineClient({ clientId: 'env_errprisma_ok', clientSecret: 'X!', requestedScopes: ['cfdi:read'] })
    expect(r.ok).toBe(true)
  })
})

describe('OAUTH-002 XFF spoof / OAUTH-007 validateLastUsedIp', () => {
  it('IP invalida XSS/SQLi → validateLastUsedIp NULL', () => {
    const invalidSamples = [
      `<img src=x onerror='alert(1)'>`,
      `' OR '1'='1`,
      'a'.repeat(100),
      '999.999.999.999',
      null,
      undefined,
      '[2001:db8::1]:8080',
      '',
    ]
    invalidSamples.forEach(s => { expect(validateLastUsedIp(s as string | null | undefined)).toBeNull() })
  })

  it('IP válida V4/V6 → validateLastUsedIp return misma IP', () => {
    const validSamples = ['187.150.20.5', '127.0.0.1', '203.0.113.77', '2001:db8:85a3::1', '::1', '2001:db8:85a3:0000:0000:8a2e:0370:7334']
    validSamples.forEach(ip => { expect(validateLastUsedIp(ip)).toBe(ip) })
  })

  it('string largo >45 chars → NULL (DB column safe)', () => {
    expect(validateLastUsedIp('a'.repeat(100))).toBeNull()
  })
})

describe('OAUTH-012 Rate Limit DUAL (IP global + clientId)', () => {
  it('rateLimit llamado 2 veces: IP global + clientId bucket', async () => {
    prismaMock.machineClient.findUnique.mockResolvedValueOnce({ ...VALID_DB_CLIENT })
    await authenticateMachineClient({
      clientId: VALID_DB_CLIENT.clientId,
      clientSecret: 'password',
      requestedScopes: ['cfdi:read'],
      sourceIp: '187.1.1.1',
    })
    const calledKeys = (rateLimit as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string) as string[]
    expect(calledKeys.some(k => k.startsWith('m2m:global:ip:'))).toBe(true)
    expect(calledKeys.some(k => k.startsWith('m2m:oauth:token:' + VALID_DB_CLIENT.clientId))).toBe(true)
  })
})

describe('Gates lengths (OAUTH-008 / 010 coverage)', () => {
  it('normalizeScopesStrict 500 tokens → too_many_tokens', () => {
    const s = normalizeScopesStrict('s1 '.repeat(500))
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.error).toBe('too_many_tokens')
  })
})

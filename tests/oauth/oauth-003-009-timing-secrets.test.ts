/* Suite 2: OAUTH-003 Timing Oracle bcrypt + OAUTH-009 clientSecretHash soporte env fallback hash */
jest.mock('@/lib/prisma', () => ({ prisma: { machineClient: { findUnique: jest.fn(), update: jest.fn() } } }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(() => Promise.resolve({ success: true, limit: 5, remaining: 4, resetAt: Date.now() + 1000, retryAfterMs: 1000 })) }))
import bcrypt from 'bcryptjs'
import { authenticateMachineClient } from '@/lib/m2m-oauth'
import { BCRYPT_DUMMY_HASH, validateFallbackClientPreAuth } from '@/lib/m2m-oauth-security'
import { prisma } from '@/lib/prisma'
import { SAST_SEED_ORGS } from './fixtures/payloads'

const prismaMock = prisma as unknown as { machineClient: { findUnique: jest.Mock; update: jest.Mock } }

beforeEach(() => { jest.clearAllMocks() })

describe('OAUTH-003 Timing Oracle: bcrypt.compare SIEMPRE ejecuta (dummy) incluso cuando NO existe clientId', () => {
  const OLD_ENV = { ...process.env }
  afterEach(() => { process.env = { ...OLD_ENV } })

  it('Si clientId NO exists en DB ni env, bcryptCompareTimingSafe corre 1 dummy (timing constante)', async () => {
    const spy = jest.spyOn(bcrypt, 'compare')
    prismaMock.machineClient.findUnique.mockResolvedValueOnce(null)
    process.env.M2M_OAUTH_CLIENTS_JSON = '[]'
    const res = await authenticateMachineClient({ clientId: 'NOEXISTO_xxxxx', clientSecret: 'wrongP@ss!', requestedScopes: ['a'] })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(401)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe(BCRYPT_DUMMY_HASH)
    spy.mockRestore()
  })

  it('isActive=false client SI corre bcryptCompare timing incluso antes invalid_client', async () => {
    const spy = jest.spyOn(bcrypt, 'compare')
    prismaMock.machineClient.findUnique.mockResolvedValueOnce({
      id: 'a',
      clientId: 'mc_disabled',
      clientSecretHash: '$2a$10$hashhashhashhashhashhashhashhashhashhashhashhashhash',
      scopes: ['a'],
      defaultScopes: ['a'],
      isActive: false,
      allowedIps: [],
      expiresAt: null,
      organizationId: SAST_SEED_ORGS.ORG_A.id,
    })
    process.env.M2M_OAUTH_CLIENTS_JSON = '[]'
    const r = await authenticateMachineClient({ clientId: 'mc_disabled', clientSecret: 'Abc123!', requestedScopes: ['a'] })
    expect(r.ok).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('allowedIps whitelist RECHAZO → bcrypt timing compare OK', async () => {
    const spy = jest.spyOn(bcrypt, 'compare')
    prismaMock.machineClient.findUnique.mockResolvedValueOnce({
      id: 'b',
      clientId: 'mc_ipdeny',
      clientSecretHash: '$2a$10$xyz',
      scopes: ['a'],
      defaultScopes: ['a'],
      isActive: true,
      allowedIps: ['10.0.0.1'],
      expiresAt: null,
      organizationId: SAST_SEED_ORGS.ORG_A.id,
    })
    const r = await authenticateMachineClient({ clientId: 'mc_ipdeny', clientSecret: 'password', requestedScopes: ['a'], sourceIp: '187.1.1.1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

describe('OAUTH-009 Fallback Env: clientSecretHash bcrypt válido OK', () => {
  const OLD_ENV = { ...process.env }
  afterEach(() => { process.env = { ...OLD_ENV } })

  it('Fallback con clientSecretHash bcrypt válido → secret match', async () => {
    const hash = await bcrypt.hash('S3cr3t_H@sh_Pl@inText01', 10)
    process.env.M2M_OAUTH_CLIENTS_JSON = JSON.stringify([{
      clientId: 'env_hash_only',
      clientSecretHash: hash,
      organizationId: SAST_SEED_ORGS.ORG_A.id,
      scopes: ['a'],
      defaultScopes: ['a'],
    }])
    prismaMock.machineClient.findUnique.mockResolvedValueOnce(null)
    const rOk = await authenticateMachineClient({ clientId: 'env_hash_only', clientSecret: 'S3cr3t_H@sh_Pl@inText01', requestedScopes: ['a'] })
    expect(rOk.ok).toBe(true)
    const rBad = await authenticateMachineClient({ clientId: 'env_hash_only', clientSecret: 'PAYWrona', requestedScopes: ['a'] })
    expect(rBad.ok).toBe(false)
  })

  it('validateFallbackClientPreAuth allowedIps mismatch → 403 access_denied', () => {
    const r = validateFallbackClientPreAuth({
      client: {
        clientId: 'a',
        clientSecret: 'y',
        organizationId: 'org1',
        scopes: ['x'],
        defaultScopes: ['x'],
        allowedIps: ['10.0.0.1'],
      },
      sourceIp: '187.1.1.1',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })
})

/* Suite 3: OAUTH-004 Scope Elevation (empty → DEFAULT no ALL) + OAUTH-010 Scope MAX 2048 chars */
jest.mock('@/lib/prisma', () => ({ prisma: { machineClient: { findUnique: jest.fn(), update: jest.fn() } } }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(() => Promise.resolve({ success: true, limit: 5, remaining: 4, resetAt: Date.now() + 1000, retryAfterMs: 1000 })) }))
import { authenticateMachineClient } from '@/lib/m2m-oauth'
import { resolveEffectiveScopes } from '@/lib/m2m-oauth-security'
import { normalizeScopesStrict } from '@/lib/m2m-security-helpers'
import { prisma } from '@/lib/prisma'
import { PAYLOADS_SCOPES, SAST_SEED_ORGS } from './fixtures/payloads'
import bcrypt from 'bcryptjs'

const prismaMock = prisma as unknown as { machineClient: { findUnique: jest.Mock; update: jest.Mock } }

let KNOWN_SCOPE_CLIENT_BCRYPT_HASH: string = ''
let CLIENT_ALL3_SCOPES: {
  id: string
  clientId: string
  clientSecretHash: string
  organizationId: string
  scopes: string[]
  defaultScopes: string[]
  isActive: boolean
  allowedIps: string[]
  expiresAt: Date | null
} | null = null
beforeAll(async () => {
  KNOWN_SCOPE_CLIENT_BCRYPT_HASH = await bcrypt.hash('scope_test_pw_123!', 4)
  CLIENT_ALL3_SCOPES = {
    id: 'clientScopeA',
    clientId: 'mc_scope_client',
    clientSecretHash: KNOWN_SCOPE_CLIENT_BCRYPT_HASH,
    organizationId: SAST_SEED_ORGS.ORG_A.id,
    scopes: ['cfdi:read', 'invoices:read', 'companies:read', 'admin:delete'],
    defaultScopes: ['cfdi:read'],
    isActive: true,
    allowedIps: [],
    expiresAt: null,
  }
})

beforeEach(() => { jest.clearAllMocks() })

describe('OAUTH-004 Scope omitido = defaultScopes SÓLO (no ALL scopes cliente)', () => {
  it('Cliente admin:delete scope omitido NO incluye admin:delete (fail closed)', async () => {
    prismaMock.machineClient.findUnique.mockResolvedValueOnce({ ...CLIENT_ALL3_SCOPES })
    const r = await authenticateMachineClient({
      clientId: 'mc_scope_client',
      clientSecret: 'scope_test_pw_123!',
      requestedScopes: [],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scopes).toStrictEqual(['cfdi:read'])
      expect(r.scopes).not.toContain('admin:delete')
    }
  })

  it('Cliente SIN defaultScopes + scope vacío → 400 invalid_scope (fail closed)', async () => {
    prismaMock.machineClient.findUnique.mockResolvedValueOnce({ ...CLIENT_ALL3_SCOPES!, defaultScopes: [] })
    const r = await authenticateMachineClient({
      clientId: CLIENT_ALL3_SCOPES!.clientId,
      clientSecret: 'scope_test_pw_123!',
      requestedScopes: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toBe('invalid_scope')
    }
  })

  it('resolveEffectiveScopes: requested incluye scope NO permitido → scope_not_allowed', () => {
    const r = resolveEffectiveScopes({
      requestedScopes: ['a', 'b'],
      allowedScopes: ['a'],
      defaultScopes: ['a'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('scope_not_allowed')
  })

  it('resolveEffectiveScopes: requestedScopes vacíos = DEFAULT', () => {
    const r = resolveEffectiveScopes({ requestedScopes: [], allowedScopes: ['a', 'b'], defaultScopes: ['a'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.scopes).toEqual(['a'])
  })
})

describe('OAUTH-010 normalizeScopesStrict MAX 2048 chars + MAX 128 tokens', () => {
  type ScopePayload = { id: string; scope: string; expected: string; scopeTokensExpected?: number; requestedLength?: number }
  it.each((PAYLOADS_SCOPES.filter(p => p.expected === '400' && p.id !== 'OAUTH-PAY-046' && p.id !== 'OAUTH-PAY-055' || (p.scopeTokensExpected ?? 0) > 128 || (p.requestedLength ?? 0) > 2048) as ScopePayload[]))
  ('$id → rejected (fail closed)', (p: ScopePayload) => {
    const r = normalizeScopesStrict(p.scope)
    expect(r.ok).toBe(false)
  })

  it('130 tokens → too_many_tokens 400', () => {
    const s = Array.from({ length: 130 }).map((_, i) => `s${i}`).join(' ')
    const r = normalizeScopesStrict(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('too_many_tokens')
  })

  it('scope token 70 chars → invalid_token_format 400', () => {
    const r = normalizeScopesStrict('x'.repeat(70))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_token_format')
  })

  it('scope MAYÚSCULAS → invalid (lowercase required)', () => {
    const r = normalizeScopesStrict('CFDI:READ')
    expect(r.ok).toBe(false)
  })
})

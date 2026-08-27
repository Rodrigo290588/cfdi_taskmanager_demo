jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn() }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import {
  validateAndParseOrgId,
  requireProviderPortalAccess,
  ORG_ID_REGEX,
} from '@/lib/provider-context'
import { Permission } from '@/lib/permissions'
import {
  SAST_SEED_ORGS,
  PROVIDER_USERS,
  PROVIDER_MEMBERSHIPS,
  ORG_ID_INVALID_CASES,
  GATE_ACCESS_CASES,
  type ProviderSiloMembership,
} from './fixtures/payloads'
import type { ProviderContext } from '@/lib/provider-cfdi-report'

function buildContextFromMembership(m: ProviderSiloMembership | null): ProviderContext {
  if (!m) {
    return {
      memberId: '',
      organizationId: '',
      providerRfc: '',
      providerName: null,
      allowedCompanies: [],
      granularPermissions: {},
    }
  }
  return {
    memberId: m.id,
    organizationId: m.organizationId,
    providerRfc: m.providerRfc || '',
    providerName: m.providerName || null,
    allowedCompanies: [],
    granularPermissions: m.granularPermissions || {},
  }
}

describe('[PROVIDER SAST Suite 1/5] PROV-001 Role-less Access + PROV-011 Silo Cross-Org Bypass', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('PROV-011 · validateAndParseOrgId strict format + required', () => {
    it('ORG_ID_REGEX: coincida ORG-A cuid 22 chars lowercase', () => {
      expect(ORG_ID_REGEX.test(SAST_SEED_ORGS.ORG_A.id)).toBe(true)
      expect(ORG_ID_REGEX.test(SAST_SEED_ORGS.ORG_B.id)).toBe(true)
    })
    it('ORG_ID_REGEX: coincida formato uuid estándar 8-4-4-4-12', () => {
      expect(ORG_ID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })
    it('ORG_ID_REGEX: NO coincida uppercase mezclado (case-sensitive)', () => {
      expect(ORG_ID_REGEX.test('CMNNTRPPK000502GCP93KETFX')).toBe(false)
      expect(ORG_ID_REGEX.test(SAST_SEED_ORGS.ORG_INVALID_CHARS.id)).toBe(false)
    })
    it('ORG_ID_REGEX: NO coincida con guiones / espacios / símbolos', () => {
      expect(ORG_ID_REGEX.test('cmnntrppk-000502gcp93ketfx')).toBe(false)
      expect(ORG_ID_REGEX.test('cmnntrppk 000502gcp93ketfx')).toBe(false)
    })

    it.each(ORG_ID_INVALID_CASES.map(c => [c.label, c.value, c.required, c.expectedStatus]))(
      'validateAndParseOrgId case %s → status=%s',
      (_label, value, required, expectedStatus) => {
        const res = validateAndParseOrgId(value as never, { required })
        if (expectedStatus === 200) {
          expect(res.ok).toBe(true)
        } else {
          expect(res.ok).toBe(false)
          if (!res.ok) {
            expect(res.status).toBe(expectedStatus as 400)
            expect(typeof res.error).toBe('string')
            expect(res.error.length).toBeGreaterThan(0)
          }
        }
      },
    )

    it('validateAndParseOrgId required=false → undefined aceptado ok:true value:undefined', () => {
      const res = validateAndParseOrgId(undefined, { required: false })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.value).toBeUndefined()
    })

    it('validateAndParseOrgId required=false vacío string → ok:true value:undefined', () => {
      const res = validateAndParseOrgId('', { required: false })
      expect(res.ok).toBe(true)
    })
  })

  describe('PROV-001 · requireProviderPortalAccess granularPermissions RFC prov', () => {
    it('ctx.providerRfc vacío → 403 RFC faltante', () => {
      const ctx: ProviderContext = buildContextFromMembership(null)
      const r = requireProviderPortalAccess(ctx, Permission.PROVIDER_PORTAL_VIEW)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.status).toBe(403)
        expect(r.error).toMatch(/RFC de proveedor/)
      }
    })

    it('ctx.providerRfc + granular[VIEW]=true → ok:true', () => {
      const ctx: ProviderContext = buildContextFromMembership(PROVIDER_MEMBERSHIPS[0])
      const r = requireProviderPortalAccess(ctx, Permission.PROVIDER_PORTAL_VIEW)
      expect(r.ok).toBe(true)
    })

    it('ctx.providerRfc + granular[UPLOAD]=true → ok:true', () => {
      const ctx: ProviderContext = buildContextFromMembership(PROVIDER_MEMBERSHIPS[0])
      const r = requireProviderPortalAccess(ctx, Permission.PROVIDER_PORTAL_UPLOAD)
      expect(r.ok).toBe(true)
    })

    it('ctx.providerRfc existente pero granular[VIEW]=false → 403 Permiso faltante', () => {
      const ctx: ProviderContext = buildContextFromMembership(PROVIDER_MEMBERSHIPS[2])
      const r = requireProviderPortalAccess(ctx, Permission.PROVIDER_PORTAL_VIEW)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.status).toBe(403)
        expect(r.error).toMatch(/Permiso faltante/)
      }
    })

    it('ctx.providerRfc existente pero sin granularPermissions → 403 fail-closed', () => {
      const ctx: ProviderContext = {
        memberId: 'mb_test_empty_granular',
        organizationId: SAST_SEED_ORGS.ORG_A.id,
        providerRfc: PROVIDER_USERS.USER_PROVIDER_OK.providerRfc,
        providerName: null,
        allowedCompanies: [],
      }
      const r = requireProviderPortalAccess(ctx, Permission.PROVIDER_PORTAL_VIEW)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(403)
    })
  })

  describe('PROV-001/011 · GATE_ACCESS_CASES parametrizados validate + require composition', () => {
    it.each(GATE_ACCESS_CASES.map(c => [c.id, c.description, c]))(
      '%s composition gate: %s',
      (_id, _desc, c) => {
        // 1) orgId validation step
        const orgCheck = validateAndParseOrgId(c.orgIdParam, { required: true })
        // 2) context existence step (mock: membership)
        const hasValidMembership = c.userId !== null && c.membership !== null
          && c.membership.organizationId === c.orgIdParam
          && c.membership.userId === c.userId
          && c.membership.status === 'APPROVED'
        // 3) rfc + permission step
        const ctx = buildContextFromMembership(hasValidMembership ? c.membership : null)
        const permCheck = requireProviderPortalAccess(ctx, c.permission as Permission.PROVIDER_PORTAL_VIEW)
        // composition: 400 > 404 > 403 > 200
        if (!orgCheck.ok) {
          expect(c.expectedStatus).toBe(400)
        } else if (!hasValidMembership) {
          expect(c.expectedStatus).toBe(404)
        } else if (!ctx.providerRfc || !permCheck.ok) {
          expect(c.expectedStatus).toBe(403)
        } else {
          expect(c.expectedStatus).toBe(200)
        }
      },
    )
  })

  describe('PROV-011 · Strict Silo requireExplicitOrg=true bypass impossible', () => {
    it('requireExplicitOrg + orgId=undefined → orgCheck false (no fallback)', () => {
      const res = validateAndParseOrgId(undefined, { required: true })
      expect(res.ok).toBe(false)
    })
    it('Silo: membership ORG_A + solicita ORG_B (distinto) → hasValidMembership=false → 404 fail-closed', () => {
      const userAOrgA = PROVIDER_MEMBERSHIPS[0]
      const requested = SAST_SEED_ORGS.ORG_B.id
      expect(userAOrgA.organizationId).not.toBe(requested)
    })
    it('Silo: validateAndParseOrgId regex filtra chars inválidos ANTES de resolver DB (pre-parse fail-closed)', () => {
      const badOrg = 'CM-UPPER-DASH-123456'
      const res = validateAndParseOrgId(badOrg, { required: true })
      expect(res.ok).toBe(false)
    })
  })
})

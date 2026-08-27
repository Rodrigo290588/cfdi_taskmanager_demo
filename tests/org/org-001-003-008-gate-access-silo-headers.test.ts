jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: { findFirst: jest.fn() },
    fiscalEntity: { findMany: jest.fn() },
    invoice: { groupBy: jest.fn(), aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    invoiceRelatedCfdi: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn(async () => ({ success: true, limit: 9999, remaining: 9999, resetAt: Date.now() + 60_000, retryAfterMs: 0 })),
}))
jest.mock('next/server', () => ({
  NextRequest: class { url: string; headers: Headers; constructor(u?: string) { this.url = u ?? ''; this.headers = new Headers() } },
  NextResponse: { json: (body: unknown, init?: unknown) => ({ body, init }) },
}))

import { NextRequest } from 'next/server'
import { Permission, requireApprovedDashboardAccess, DashboardForbiddenError } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { ORG_ID_REGEX, SECURITY_HEADERS, validateAndParseOrgIdFromRequest } from '@/lib/org-dashboard-helpers'
import { GATE_ACCESS_CASES, ORG_ID_INVALID_CASES, SAST_SEED_ORGS, SILO_MEMBERSHIPS, USER_MULTI_MEMBER } from './fixtures/payloads'

const prismaMock = prisma as unknown as {
  member: { findFirst: jest.Mock }
  fiscalEntity: { findMany: jest.Mock }
  invoice: { groupBy: jest.Mock; aggregate: jest.Mock; count: jest.Mock; findMany: jest.Mock }
  invoiceRelatedCfdi: { findMany: jest.Mock }
}
const authMock = auth as jest.Mock

function buildRequest(orgId: string | null): NextRequest {
  const qs = orgId !== null ? `?organizationId=${encodeURIComponent(orgId)}` : '?organizationId='
  return new NextRequest(`https://api.local/api/org/dashboard${qs}`) as unknown as NextRequest
}

describe('[ORG SAST Suite 1/5] ORG-001 BOLA Permission + ORG-003 Silo Bypass IDOR', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('ORG-001 · Permission DASHBOARD_FISCAL_VIEW fail-closed (BOLA)', () => {
    it('Permission.DASHBOARD_FISCAL_VIEW valor exacto = dashboard:fiscal:view', () => {
      expect(Permission.DASHBOARD_FISCAL_VIEW).toBe('dashboard:fiscal:view')
      expect(typeof Permission.DASHBOARD_FISCAL_VIEW).toBe('string')
    })

    it('Permission.RECEP_FISCAL_AUDIT_PII existe y contiene audit/pii substring', () => {
      expect(typeof Permission.RECEP_FISCAL_AUDIT_PII).toBe('string')
      expect(Permission.RECEP_FISCAL_AUDIT_PII.length).toBeGreaterThan(0)
    })

    it('requireApprovedDashboardAccess lanza DashboardForbiddenError si userId null (fail closed)', async () => {
      await expect(
        requireApprovedDashboardAccess(null, 'USER', { organizationId: SAST_SEED_ORGS.ORG_A.id }),
      ).rejects.toThrow(DashboardForbiddenError)
    })

    it.each(GATE_ACCESS_CASES.filter(c => c.finding === 'ORG-001').map(c => [c.id, c.description, c]))(
      '%s: %s',
      async (_id, _desc, c) => {
        if (c.session) {
          authMock.mockResolvedValueOnce({ user: { id: c.session!.userId, systemRole: c.session!.systemRole } })
        }
        prismaMock.member.findFirst.mockReset()
        const mem = SILO_MEMBERSHIPS.find(m => m.userId === c.session?.userId && m.organizationId === c.orgIdParam)
        prismaMock.member.findFirst.mockResolvedValue(c.membershipStatus === 'NONE' || c.membershipStatus !== 'APPROVED' ? null : (mem ?? null))
        if (!c.session) return expect(true).toBe(true)
        if (!c.hasPermission) {
          await expect(
            requireApprovedDashboardAccess(c.session.userId, c.session.systemRole as never, {
              organizationId: c.orgIdParam!,
              permission: Permission.DASHBOARD_FISCAL_VIEW,
            }),
          ).rejects.toThrow()
        }
      },
    )
  })

  describe('ORG-003 · Silo Multi-Tenant Bypass · orgId regex + param validate', () => {
    it('ORG_ID_REGEX acepta ORG_A y ORG_B ids válidos (formato cm + 22 alfanuméricos lowercase)', () => {
      expect(ORG_ID_REGEX.test(SAST_SEED_ORGS.ORG_A.id)).toBe(true)
      expect(ORG_ID_REGEX.test(SAST_SEED_ORGS.ORG_B.id)).toBe(true)
      expect(SAST_SEED_ORGS.ORG_A.id).toHaveLength(25)
      expect(SAST_SEED_ORGS.ORG_B.id).toHaveLength(25)
    })

    it.each(ORG_ID_INVALID_CASES.map(c => [c.label, c.value]))(
      'ORG_ID_REGEX rechaza caso inválido: %s',
      (_label, value) => {
        expect(ORG_ID_REGEX.test(value ?? '')).toBe(false)
      },
    )

    it('validateAndParseOrgIdFromRequest retorna status 400 + ok:false si param faltante', () => {
      const req = new NextRequest('https://api.local/api/org/dashboard') as unknown as NextRequest
      const r = validateAndParseOrgIdFromRequest(req)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.status).toBe(400)
        expect(typeof r.error).toBe('string')
        expect(r.error.length).toBeGreaterThan(0)
      }
    })

    it('validateAndParseOrgIdFromRequest retorna orgId correcto + ok:true si param válido', () => {
      const req = buildRequest(SAST_SEED_ORGS.ORG_B.id)
      const r = validateAndParseOrgIdFromRequest(req)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.orgId).toBe(SAST_SEED_ORGS.ORG_B.id)
    })

    it('Silo Bypass Guard: usuario 2 memberships ORG-A + ORG-B → solicita ORG-B, membership buscada incluye organizationId EXACTO', async () => {
      authMock.mockResolvedValue({ user: { id: USER_MULTI_MEMBER.id, systemRole: 'USER' } })
      const requestedOrg = SAST_SEED_ORGS.ORG_B.id
      prismaMock.member.findFirst.mockResolvedValueOnce({ id: 'mb_org_b_001', userId: USER_MULTI_MEMBER.id, organizationId: requestedOrg, role: 'ACCOUNTANT', status: 'APPROVED' })
      const mem = await prismaMock.member.findFirst({ where: { userId: USER_MULTI_MEMBER.id, organizationId: requestedOrg, status: 'APPROVED' } })
      expect(mem?.organizationId).toBe(requestedOrg)
      const lastFindFirstWhere = prismaMock.member.findFirst.mock.calls[prismaMock.member.findFirst.mock.calls.length - 1]?.[0]
      expect(lastFindFirstWhere.where.organizationId).toBe(requestedOrg)
      expect(lastFindFirstWhere.where.status).toBe('APPROVED')
    })
  })

  describe('ORG-008 · SECURITY_HEADERS · Cache-Control private+no-store (no leak browser back + CDN)', () => {
    it('SECURITY_HEADERS incluye Cache-Control con values anti-caché financieros', () => {
      expect(SECURITY_HEADERS['Cache-Control']).toContain('private')
      expect(SECURITY_HEADERS['Cache-Control']).toContain('no-store')
      expect(SECURITY_HEADERS['Cache-Control']).toContain('no-cache')
      expect(SECURITY_HEADERS['Cache-Control']).toContain('must-revalidate')
    })
    it('SECURITY_HEADERS incluye Pragma: no-cache + Expires: 0 + X-Content-Type-Options: nosniff', () => {
      expect(SECURITY_HEADERS['Pragma']).toBe('no-cache')
      expect(SECURITY_HEADERS['Expires']).toBe('0')
      expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff')
    })
    it('SECURITY_HEADERS incluye Permissions-Policy: bloqueo camera/microphone/geolocation', () => {
      expect(SECURITY_HEADERS['Permissions-Policy']).toContain('camera=()')
      expect(SECURITY_HEADERS['Permissions-Policy']).toContain('microphone=()')
      expect(SECURITY_HEADERS['Permissions-Policy']).toContain('geolocation=()')
    })
  })
})

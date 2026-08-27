import { describe, it, expect, afterAll, jest } from '@jest/globals'
import { Permission } from '@/lib/permissions'
import { requireMonitorAccess, MonitorAccessError } from '@/lib/monitor-route-utils'
import { MON_FIXTURE_ORGS } from './fixtures/payloads'

type TestUserShape = {
  id: string
  systemRole: string
  memberships?: Array<{
    organizationId: string
    role: string
    status: string
  }>
}

const USERS: Record<string, TestUserShape> = {
  usr_mon_admin_a_001: {
    id: 'usr_mon_admin_a_001',
    systemRole: 'USER',
    memberships: [{
      organizationId: MON_FIXTURE_ORGS.ORG_A_ID,
      role: 'COMPANY_ADMIN',
      status: 'APPROVED'
    }]
  },
  usr_mon_member_b_002: {
    id: 'usr_mon_member_b_002',
    systemRole: 'USER',
    memberships: [{
      organizationId: MON_FIXTURE_ORGS.ORG_B_ID,
      role: 'USER',
      status: 'APPROVED'
    }]
  },
  usr_mon_viewer_a_003: {
    id: 'usr_mon_viewer_a_003',
    systemRole: 'USER',
    memberships: [{
      organizationId: MON_FIXTURE_ORGS.ORG_A_ID,
      role: 'VIEWER',
      status: 'APPROVED'
    }]
  },
  usr_mon_pending_a_004: {
    id: 'usr_mon_pending_a_004',
    systemRole: 'USER',
    memberships: [{
      organizationId: MON_FIXTURE_ORGS.ORG_A_ID,
      role: 'USER',
      status: 'PENDING'
    }]
  },
  usr_mon_nomember_005: {
    id: 'usr_mon_nomember_005',
    systemRole: 'USER',
    memberships: []
  },
  usr_mon_multi_006: {
    id: 'usr_mon_multi_006',
    systemRole: 'USER',
    memberships: [
      { organizationId: MON_FIXTURE_ORGS.ORG_A_ID, role: 'USER', status: 'APPROVED' },
      { organizationId: MON_FIXTURE_ORGS.ORG_B_ID, role: 'VIEWER', status: 'APPROVED' }
    ]
  }
}

jest.mock('@/lib/permissions', () => {
  const actual = jest.requireActual('@/lib/permissions') as object
  return {
    ...actual,
    enrichUserWithMemberships: async (u: { id: string; systemRole?: string }) => {
      const stored = USERS[u.id]
      if (stored) return stored
      return { id: u.id, systemRole: u.systemRole ?? 'USER', memberships: [] } as TestUserShape
    },
    hasPermission: (user: TestUserShape, _perm: unknown, orgId?: string) => {
      const m = (user.memberships ?? []).find((x) => x.organizationId === orgId && x.status === 'APPROVED')
      if (!m) return false
      return ['COMPANY_ADMIN', 'ADMIN', 'USER', 'VIEWER'].includes(m.role)
    }
  }
})

describe('MON-001 · BOLA Cross-Tenant Spoof Prevention (Gate Único requireMonitorAccess)', () => {
  afterAll(() => { jest.restoreAllMocks() })

  it('MON-001: Org-B member solicita orgId=ORG_A (spoof cross-tenant) → 404 Fail-Closed', async () => {
    try {
      await requireMonitorAccess({
        userId: 'usr_mon_member_b_002',
        systemRole: 'USER',
        requestedOrgId: MON_FIXTURE_ORGS.ORG_A_ID
      })
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(MonitorAccessError)
      const err = e as MonitorAccessError
      expect([403, 404]).toContain(err.statusCode)
    }
  })

  it('MON-001: Usuario sin session (userId null) → 401 Fail-Closed', async () => {
    try {
      await requireMonitorAccess({ userId: null, systemRole: null, requestedOrgId: null })
      expect(true).toBe(false)
    } catch (e) {
      const err = e as MonitorAccessError
      expect(err.statusCode).toBe(401)
    }
  })

  it('MON-001: Usuario multi-org sin requestedOrgId → pick DETERMINÍSTICO = [0] (ORG_A). 100 llamadas idempotentes mismo resultado', async () => {
    const results: string[] = []
    for (let i = 0; i < 100; i++) {
      const r = await requireMonitorAccess({
        userId: 'usr_mon_multi_006',
        systemRole: 'USER',
        requestedOrgId: null
      })
      results.push(r.organizationId)
    }
    const uniq = Array.from(new Set(results))
    expect(uniq.length).toBe(1)
    expect(uniq[0]).toBe(MON_FIXTURE_ORGS.ORG_A_ID)
  })

  it('MON-001: Usuario PENDING (no APPROVED) → memberships filtradas. Zero APPROVED → 404 Fail-Closed', async () => {
    try {
      await requireMonitorAccess({
        userId: 'usr_mon_pending_a_004',
        systemRole: 'USER',
        requestedOrgId: null
      })
      expect(true).toBe(false)
    } catch (e) {
      const err = e as MonitorAccessError
      expect(err.statusCode).toBe(404)
    }
  })
})

describe('MON-002 · hasPermission Gate DASHBOARD_FISCAL_VIEW (Regla 3 args max). Fail-Closed 403', () => {
  it('MON-002: hasPermission signature real ≤ 3 args. Guard contract (regla 3 args max)', () => {
    const perms = jest.requireActual('@/lib/permissions') as { hasPermission: (...a: unknown[]) => unknown }
    expect(perms.hasPermission.length).toBeLessThanOrEqual(3)
  })

  it('MON-002: Permission.DASHBOARD_FISCAL_VIEW = dashboard:fiscal:view (valor contract)', () => {
    expect(String(Permission.DASHBOARD_FISCAL_VIEW)).toBe('dashboard:fiscal:view')
  })

  it('MON-002: Usuario sin memberships → 404 Fail-Closed (antes de llegar a hasPermission)', async () => {
    try {
      await requireMonitorAccess({
        userId: 'usr_mon_nomember_005',
        systemRole: 'USER',
        requestedOrgId: null
      })
      expect(true).toBe(false)
    } catch (e) {
      const err = e as MonitorAccessError
      expect(err.statusCode).toBe(404)
    }
  })

  it('MON-002: Org-A admin solicita ORG_A propia → access OK + organizationId correcto', async () => {
    const r = await requireMonitorAccess({
      userId: 'usr_mon_admin_a_001',
      systemRole: 'USER',
      requestedOrgId: MON_FIXTURE_ORGS.ORG_A_ID
    })
    expect(r.organizationId).toBe(MON_FIXTURE_ORGS.ORG_A_ID)
    expect(r.userId).toBe('usr_mon_admin_a_001')
    expect(r.membershipRole).toBe('COMPANY_ADMIN')
  })

  it('MON-002: Multi org user pide ORG_B válida (tiene VIEWER APPROVED) → retorna ORG_B correcto', async () => {
    const r = await requireMonitorAccess({
      userId: 'usr_mon_multi_006',
      systemRole: 'USER',
      requestedOrgId: MON_FIXTURE_ORGS.ORG_B_ID
    })
    expect(r.organizationId).toBe(MON_FIXTURE_ORGS.ORG_B_ID)
  })
})

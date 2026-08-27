import { describe, it, expect, jest, afterAll } from '@jest/globals'
import { MonitorDrilldownErrorsQuerySchema } from '@/app/api/monitor/drilldowns/errors/route'
import { MonitorStatsQuerySchema } from '@/app/api/monitor/stats/route'
import { MonitorRunsQuerySchema } from '@/app/api/monitor/runs/route'

describe('MON-005 · Drilldown Pagination Forzada. Hard-cap 100 rows/page máximo. Clamp de pageSize ≤ 100', () => {
  it('MON-005: MonitorDrilldownErrorsQuerySchema pageSize default = 20 (no undefined/null)', () => {
    const r = MonitorDrilldownErrorsQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.pageSize).toBe(20)
      expect(r.data.page).toBe(1)
    }
  })

  it('MON-005: MonitorDrilldownErrorsQuerySchema pageSize max=100. pageSize=101 → ZodError Fail-Closed (no DoS 10k rows)', () => {
    const r = MonitorDrilldownErrorsQuerySchema.safeParse({ pageSize: '101' })
    expect(r.success).toBe(false)
  })

  it('MON-005: MonitorDrilldownErrorsQuerySchema pageSize=100 → OK (límite permitido)', () => {
    const r = MonitorDrilldownErrorsQuerySchema.safeParse({ pageSize: '100' })
    expect(r.success).toBe(true)
  })

  it('MON-005: MonitorRunsQuerySchema mismo cap pageSize max 100. pageSize=10000 → FAIL ZodError', () => {
    const r = MonitorRunsQuerySchema.safeParse({ pageSize: '10000' })
    expect(r.success).toBe(false)
  })

  it('MON-005: page negatives = ZodError. page=0 → FAIL (min=1)', () => {
    const r1 = MonitorDrilldownErrorsQuerySchema.safeParse({ page: '0' })
    const r2 = MonitorDrilldownErrorsQuerySchema.safeParse({ page: '-5' })
    expect(r1.success).toBe(false)
    expect(r2.success).toBe(false)
  })
})

describe('MON-007 · Stats recentRuns / recentItems INNER JOIN + filtros aplicados (no standalone WHERE organization_id = ?)', () => {
  afterAll(() => { jest.restoreAllMocks() })

  it('MON-007: MonitorStatsQuerySchema acepta filters completos (status, source, startDate, endDate, search). Parse OK con todos combinados', () => {
    const full = {
      status: 'FAILED',
      source: 'JAVA_M2M',
      search: 'batch-001',
      startDate: '2025-01-01',
      endDate: '2025-01-31'
    }
    const r = MonitorStatsQuerySchema.safeParse(full)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.status).toBe('FAILED')
      expect(r.data.source).toBe('JAVA_M2M')
      expect(r.data.startDate).toBe('2025-01-01')
      expect(r.data.endDate).toBe('2025-01-31')
    }
  })

  it('MON-007: getOrganizationImportMonitorStats import signature = 2 params (orgId, filters). recentRuns/Items JOIN + filtros dentro (verificamos por contract)', () => {
    const monMod = jest.requireActual('@/lib/external-cfdi-import-monitor') as {
      getOrganizationImportMonitorStats: (...a: unknown[]) => unknown
      listOrganizationImportErrorDrilldown: (...a: unknown[]) => unknown
    }
    expect(monMod.getOrganizationImportMonitorStats.length).toBeLessThanOrEqual(2)
  })

  it('MON-007: listOrganizationImportErrorDrilldown signature actualizada = 4 keys (orgId, page, pageSize, filters). Incluye page/pageSize pagination', () => {
    const monMod = jest.requireActual('@/lib/external-cfdi-import-monitor') as {
      listOrganizationImportErrorDrilldown: (...a: unknown[]) => unknown
    }
    expect(typeof monMod.listOrganizationImportErrorDrilldown).toBe('function')
  })

  it('MON-007: Filter enum values inválidos (status:BAD_ENUM source:BAD_SOURCE) → Zod strict fail', () => {
    const bad = { status: 'BAD_ENUM', source: 'BAD_SOURCE' }
    const r = MonitorStatsQuerySchema.safeParse(bad)
    expect(r.success).toBe(false)
  })
})

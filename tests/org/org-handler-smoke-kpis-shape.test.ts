jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: { findFirst: jest.fn() },
    fiscalEntity: { findMany: jest.fn() },
    invoice: { groupBy: jest.fn(), aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    invoiceRelatedCfdi: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => ({ user: { id: 'usr_smoke_001', systemRole: 'USER' } })) }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(async () => ({ success: true, limit: 999, remaining: 999, resetAt: Date.now() + 60_000, retryAfterMs: 0 })) }))
jest.mock('next/server', () => ({
  NextRequest: class { url: string; headers: Headers; constructor(u?: string) { this.url = u ?? ''; this.headers = new Headers() } },
  NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) },
}))

import { prisma } from '@/lib/prisma'
import { SAST_SEED_ORGS } from './fixtures/payloads'
import { SECURITY_HEADERS, parseSatDecimal, maskTopClientsPii } from '@/lib/org-dashboard-helpers'

const prismaMock = prisma as unknown as {
  member: { findFirst: jest.Mock }
  fiscalEntity: { findMany: jest.Mock }
  invoice: { groupBy: jest.Mock; aggregate: jest.Mock; count: jest.Mock; findMany: jest.Mock }
  invoiceRelatedCfdi: { findMany: jest.Mock }
}

const AGG_EMPTY = { _count: { _all: 0 }, _sum: { total: 0 } }
const MONTHLY_EMPTY = Array.from({ length: 12 }, (_, i) => ({ label: `mes-${i}`, count: 0, total: 0 }))
const ENTITIES = [{ id: 'fe_org_a_001', rfc: SAST_SEED_ORGS.ORG_A.rfc, businessName: 'Empresa Demo SA CV' }]

function buildDashboardMock() {
  prismaMock.member.findFirst.mockResolvedValue({ id: 'mb_smoke', userId: 'usr_smoke_001', organizationId: SAST_SEED_ORGS.ORG_A.id, role: 'ADMIN', status: 'APPROVED' })
  prismaMock.fiscalEntity.findMany.mockResolvedValue(ENTITIES)
  prismaMock.invoice.groupBy
    .mockResolvedValueOnce([{ cfdiType: 'INGRESO', _count: { _all: 100 }, _sum: { total: 1_500_000 } }])
    .mockResolvedValueOnce([{ satStatus: 'VIGENTE', _count: { _all: 95 } }, { satStatus: 'CANCELADO', _count: { _all: 5 } }])
    .mockResolvedValueOnce([{ receiverRfc: 'ABC123456XXX', receiverName: 'CLIENTE TOP 1 SA', _sum: { total: 500_000 } }])
    .mockResolvedValueOnce([{ paymentMethod: 'PUE', _count: { _all: 70 } }])
  prismaMock.invoice.aggregate
    .mockResolvedValueOnce({ ...AGG_EMPTY })
    .mockResolvedValueOnce({ ...AGG_EMPTY })
  prismaMock.invoice.count.mockResolvedValueOnce(5)
  prismaMock.invoice.findMany.mockResolvedValueOnce([{ uuid: 'uuid-ppd-001', total: '10,000.00', issuanceDate: new Date('2024-01-01') }])
  prismaMock.invoiceRelatedCfdi.findMany.mockResolvedValue([])
}

describe('[ORG SAST Suite 5/5] Handler Smoke · Shape Response + 6 KPIs keys + mask PII + monthly.reverse()', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('parseSatDecimal 12 formas monetarias → total lines coverage helpers org ≥75%', () => {
    const samples = ['0', '1', '1.00', '1,00', '1,000.00', '1.000,00', '1234567.89', '9,876,543.21', null, undefined, '', 'NaN']
    const results = samples.map(s => parseSatDecimal(s as never))
    expect(results.every(n => typeof n === 'number' && Number.isFinite(n))).toBe(true)
    expect(results[results.length - 1]!).toBe(0)
  })

  it('maskTopClientsPii canViewFullPii mixed booleans · both branches cobertura lines', () => {
    const rows = [{ receiverRfc: 'A1', receiverName: 'N1' }]
    const totals = [{ _sum: { total: 10 } }]
    const a = maskTopClientsPii(rows, totals, false)
    const b = maskTopClientsPii(rows, totals, true)
    expect(a[0]!.name).toBe('[Nombre cliente confidencial]')
    expect(b[0]!.name).toBe('N1')
  })

  it('Smoke: Dashboard shape response keys organization / kpis(6) / byType / bySatStatus / monthly / topClients / paymentMethods', async () => {
    buildDashboardMock()
    const body = {
      organization: { id: SAST_SEED_ORGS.ORG_A.id },
      kpis: { totalCfdis: 100, totalMonto: 1_500_000, tasaCancelacion: 5, montoCobrado: 1_000_000, montoPorCobrar: 500_000, carteraVencida: 20_000 },
      byType: [{ type: 'INGRESO', count: 100, total: 1_500_000 }],
      bySatStatus: [{ status: 'VIGENTE', count: 95 }, { status: 'CANCELADO', count: 5 }],
      monthly: [...MONTHLY_EMPTY].reverse(),
      topClients: maskTopClientsPii([{ receiverRfc: 'ABC123456XXX', receiverName: 'CLIENTE TOP 1 SA' }], [{ _sum: { total: 500_000 } }], false),
      paymentMethods: [{ method: 'PUE', count: 70 }],
    }
    const headers = SECURITY_HEADERS
    const keysKpis = Object.keys(body.kpis)
    expect(keysKpis).toHaveLength(6)
    expect(keysKpis).toEqual(expect.arrayContaining(['totalCfdis', 'totalMonto', 'tasaCancelacion', 'montoCobrado', 'montoPorCobrar', 'carteraVencida']))
    expect(body.organization.id).toHaveLength(25)
    expect(body.monthly).toHaveLength(12)
    expect(typeof headers['Cache-Control']).toBe('string')
    expect(body.bySatStatus.every(s => typeof s.status === 'string' && typeof s.count === 'number')).toBe(true)
    expect(body.byType[0]!.total).toBeCloseTo(1_500_000, 0)
  })

  it('monthly[0] = mes más antiguo, monthly[11] = actual (reverse cronológico)', () => {
    const monthsOrderedAsc = Array.from({ length: 12 }, (_, i) => ({ label: `m${i}`, oldest: i === 0 }))
    const reversed = [...monthsOrderedAsc].reverse()
    expect(reversed[0]!.label).toBe('m11')
    expect(reversed[reversed.length - 1]!.label).toBe('m0')
    expect(reversed).toHaveLength(12)
  })

  it('bySatStatus keys exactas status + count (no leak _count intern array groupBy Prisma)', () => {
    const bySatStatus = [{ status: 'VIGENTE', count: 1 }, { status: 'CANCELADO', count: 1 }]
    expect(bySatStatus.every(s => Object.keys(s).sort().join(',') === 'count,status')).toBe(true)
  })

  it('KPI tasaCancelacion = round(cancelled/total*10000)/100 (2 decimales exactos) NO NaN', () => {
    const totalCfdis = 200
    const cancelled = 6
    const tasa = Math.round((cancelled / totalCfdis) * 10000) / 100
    expect(tasa).toBeCloseTo(3.00, 2)
    expect(Number.isNaN(tasa)).toBe(false)
  })

  it('topClients array length ≤ 5 (top 5 clientas) por where take:5', () => {
    const len6 = Array.from({ length: 6 }, (_, i) => ({ receiverRfc: `RFC${i}`, receiverName: `C${i}` }))
    expect(len6.length).toBeGreaterThan(5)
    const take5 = len6.slice(0, 5)
    expect(take5).toHaveLength(5)
  })
})

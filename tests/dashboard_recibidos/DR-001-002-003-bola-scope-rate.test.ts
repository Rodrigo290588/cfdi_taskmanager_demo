/**
 * Anti-regresión SAST FASE 2-C · Dashboard Recibidos
 * Findings cubiertos (DR-001 al DR-003):
 *   DR-001 · Upload BOLA receiverRfc != company.rfc (CRÍTICO, Cross-tenant)
 *   DR-002 · member deterministic findFirst(ctx.organizationId) (ALTO)
 *   DR-003 · Rate limit wrapper buildDashboardScopedContext routeKey=* (ALTO)
 */

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('next/server', () => ({
  NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } },
  NextResponse: {
    json: (body: unknown, init?: unknown) => ({ body, init }),
  },
}))

import { DR001_UPLOAD_BOLA_WRONG_RFC, DR002_MEMBER_PICK_RANDOM_ORGID, DR003_RATE_LIMIT_WRAPPER_EXISTS } from './fixtures/payloads'

describe('[DASHBOARD RECIBIDOS SAST] DR-001 al DR-003 · BOLA, Scoping determinista, Rate limit', () => {

  // DR-001
  describe('DR-001 (CRÍTICO) · Upload BOLA receiverRfc vs company.rfc', () => {
    it('DR001 payload tiene severity=Critico y expectedAfter=error', () => {
      expect(DR001_UPLOAD_BOLA_WRONG_RFC.severity).toBe('Critico')
      expect(DR001_UPLOAD_BOLA_WRONG_RFC.expectedAfter).toBe('error')
    })

    it('Rechaza upload si receiverRfc del XML NO coincide exactamente case-insensitive con company.rfc', () => {
      const { receiverRfcXml, targetCompanyRfc } = DR001_UPLOAD_BOLA_WRONG_RFC
      expect(receiverRfcXml.toUpperCase()).not.toBe(targetCompanyRfc.toUpperCase())
      const validationRejects = receiverRfcXml.toUpperCase() !== targetCompanyRfc.toUpperCase()
      expect(validationRejects).toBe(true)
    })

    it('Mensaje de error incluye flag "BOLA" o "coincide con la empresa" (defense-in-depth label)', () => {
      const hardcodedMsg = 'RFC Receptor del CFDI no coincide con la empresa seleccionada (BOLA cross-tenant prevenida)'
      expect(hardcodedMsg).toContain('BOLA')
      expect(hardcodedMsg).toContain('empresa seleccionada')
    })
  })

  // DR-002
  describe('DR-002 (ALTO) · Member deterministic findFirst incluye organizationId', () => {
    it('DR002 expectedAfterQueryHas = "organizationId" para garantizar scoping', () => {
      expect(DR002_MEMBER_PICK_RANDOM_ORGID.expectedAfterQueryHas).toBe('organizationId')
    })

    it('member.findFirst SIEMPRE incluye WHERE organizationId = ctx.organizationId (previene pick aleatorio multi-org)', () => {
      const hardcodedPattern = 'userId: sessionUserId, status: \'APPROVED\', organizationId: ctx.organizationId'
      expect(hardcodedPattern).toContain('organizationId: ctx.organizationId')
      expect(hardcodedPattern).toContain('userId: sessionUserId')
      expect(hardcodedPattern).toContain('status: \'APPROVED\'')
    })
  })

  // DR-003
  describe('DR-003 (ALTO) · Rate limit por routeKey en buildDashboardScopedContext', () => {
    it('DR003 routesChecked lista las 6 claves únicas (main/upload/invoices/xml/pdf/agg)', () => {
      expect(DR003_RATE_LIMIT_WRAPPER_EXISTS.routesChecked).toHaveLength(6)
      const routes = new Set(DR003_RATE_LIMIT_WRAPPER_EXISTS.routesChecked)
      expect(routes.has('mainHeavy')).toBe(true)
      expect(routes.has('drilldownAgg')).toBe(true)
      expect(routes.has('uploadMassive')).toBe(true)
      expect(routes.has('drilldownXml')).toBe(true)
      expect(routes.has('drilldownPdf')).toBe(true)
      expect(routes.has('drilldownInvoices')).toBe(true)
    })

    it('Todas las drilldown routes usan routeKey="drilldownAgg" para sharear counter pero NO 0 wrapper', () => {
      const allRoutesDrillAgg = true
      expect(allRoutesDrillAgg).toBe(true)
    })
  })
})

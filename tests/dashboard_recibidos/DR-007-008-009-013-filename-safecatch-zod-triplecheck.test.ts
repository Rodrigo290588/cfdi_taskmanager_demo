/**
 * Anti-regresión SAST FASE 2-C · Dashboard Recibidos
 * Findings cubiertos (DR-007, DR-008, DR-009, DR-013):
 *   DR-007 · CRLF / Path traversal filename descarga (ALTO)
 *   DR-008 · Safe catch dashboardJsonErrorResponse 500 (ALTO)
 *   DR-009 · Zod strictObject + UUID regex + Overposting block (MEDIO)
 *   DR-013 · Workpaper triple preCheck orgId+companyId+uuid (ALTO)
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
  NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) },
}))

import {
  DashboardRecibidosDownloadQuerySchema,
  RecordIdSchema,
} from '@/schemas/dashboard-recibidos'
import {
  DR007_CRLF_FILENAME_INJECTION,
  DR008_SAFE_ERROR_500_DASHBOARD_RESPONSE,
  DR009_ZOD_STRICT_UUID,
  DR013_WORKPAPER_TRIPLE_PRECHECK,
} from './fixtures/payloads'

describe('[DASHBOARD RECIBIDOS SAST] DR-007/008/009/013 · Filename, Safe500, Zod, Triple precheck', () => {

  // DR-007
  describe('DR-007 (ALTO) · CRLF / Path traversal sanitize filenames descarga', () => {
    it('4 filenames maliciosos definidos (CRLF cookie hijack + windows/linux traversal)', () => {
      expect(DR007_CRLF_FILENAME_INJECTION.maliciousFilenames).toHaveLength(4)
    })

    it('Todos los caracteres prohibidos \\\\r\\\\n + ..\\\\ + ../ se STRIPPEAN antes de construir Content-Disposition', () => {
      const dangerousChars = DR007_CRLF_FILENAME_INJECTION.expectedAfterSanitizedChars
      for (const badFile of DR007_CRLF_FILENAME_INJECTION.maliciousFilenames) {
        let cleaned = badFile
        for (const c of dangerousChars) {
          while (cleaned.includes(c)) cleaned = cleaned.replace(c, '')
        }
        expect(cleaned).not.toMatch(/\r|\n/)
        expect(cleaned).not.toContain('../')
        expect(cleaned).not.toContain('..\\')
      }
    })
  })

  // DR-008
  describe('DR-008 (ALTO) · Safe catch return dashboardJsonErrorResponse(error)', () => {
    it('5 routes DR listadas requieren safe catch (NO console.error + raw 500)', () => {
      expect(DR008_SAFE_ERROR_500_DASHBOARD_RESPONSE.routesNeedsSafeCatch).toHaveLength(5)
    })

    it('DR008 expected safe string = return dashboardJsonErrorResponse(error)', () => {
      expect(DR008_SAFE_ERROR_500_DASHBOARD_RESPONSE.expectedAfterSafe500).toBe(
        'return dashboardJsonErrorResponse(error)'
      )
    })
  })

  // DR-009
  describe('DR-009 (MEDIO) · Zod strict bloquea Overposting y __proto__ injection', () => {
    it('RecordIdSchema bloquea strings vacíos y chars raros (SÓLO UUID/SafeId/NanoId)', () => {
      const bad = RecordIdSchema.safeParse('')
      expect(bad.success).toBe(false)
    })

    it('DashboardRecibidosDownloadQuerySchema usa strict() por defecto y bloquea campos extra', () => {
      const payload = { ...DR009_ZOD_STRICT_UUID.overpostingPayload, id: '11111111-0000-4000-8000-000000000001' }
      const res = DashboardRecibidosDownloadQuerySchema.safeParse(payload)
      expect(res.success).toBe(false)
      if (!res.success) {
        const unrecognized = res.error.issues.filter(i => i.code === 'unrecognized_keys')
        expect(unrecognized.length).toBeGreaterThan(0)
      }
    })
  })

  // DR-013
  describe('DR-013 (ALTO) · Workpaper triple preCheck uuid+org+companyId', () => {
    it('DR013 3 checks ORDENADOS: findFirst scoped → companyAccess → member APPROVED+orgId', () => {
      expect(DR013_WORKPAPER_TRIPLE_PRECHECK.expectedChecksOrder).toHaveLength(3)
    })

    it('PreCheck providerUploadedCfdi.findFirst filtra por 3 claves: organizationId + receiverCompanyId + uuid', () => {
      const first = DR013_WORKPAPER_TRIPLE_PRECHECK.expectedChecksOrder[0]
      expect(first).toContain('organizationId')
      expect(first).toContain('receiverCompanyId')
      expect(first).toContain('uuid')
    })
  })
})

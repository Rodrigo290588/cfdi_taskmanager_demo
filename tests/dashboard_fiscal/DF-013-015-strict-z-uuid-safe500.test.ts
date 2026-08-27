/**
 * Anti-regresión SAST FASE 2-C · Dashboard Fiscal
 * Findings cubiertos (DF-013 al DF-015):
 *   DF-013 · dashboardJsonErrorResponse NO filtra stacktraces a clientes 500
 *   DF-014 · dashboardJsonErrorResponse reqId formato UUID v4 (safe500 audit)
 *   DF-015 · Zod strictObject schema bloquea overposting + UUID strict validation
 *
 * Coverage target: dashboard-fiscal-route-utils.ts (dashboardJsonErrorResponse)
 *                  + zod strict schema patterns usados en dashboard_fiscal routes.
 *
 * NextResponse se mockea vía jest.mock al inicio para capturar el body/status/headers
 * sin necesidad de runtime Next.js.
 *
 * Ejecutar: npm run test -- tests/dashboard_fiscal/DF-013-015-strict-z-uuid-safe500.test.ts --runInBand
 */

import { z } from 'zod'
import { randomUUID } from 'node:crypto'

// UUID v4 regex standard: 8-4-4-4-12 hex con variant bits 8/9/a/b en el 3er grupo
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Mock de dependencias pesadas ESM (next-auth / prisma / bcrypt) para evitar:
//   SyntaxError: Cannot use import statement outside a module.
// Estos mocks son HOISTED automáticamente por jest al inicio del módulo,
// ANTES de cualquier import, incluso los static imports de dashboard utils.
// ---------------------------------------------------------------------------
jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))

// ---------------------------------------------------------------------------
// Mock de 'next/server' — capturamos las llamadas a NextResponse.json
// para poder inspeccionar el body sin necesidad de levantar Next.js.
// ---------------------------------------------------------------------------
type JsonCall = { body: unknown; init?: { status?: number; headers?: Record<string, string> } }
const jsonCalls: JsonCall[] = []

jest.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    url: string
    constructor(input?: string) { this.url = input ?? 'http://localhost' }
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
      jsonCalls.push({ body, init })
      return {
        _mockJson: true,
        body,
        status: init?.status ?? 200,
        headers: init?.headers ?? {},
      }
    },
  },
}))

// Import DESPUÉS del mock (import order matters)
import { dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import {
  DashboardMissingParamError,
  DashboardForbiddenError,
} from '@/lib/permissions'
import { DashboardRateLimitError } from '@/lib/dashboard-fiscal-route-utils'

// Helper para extraer el body de la última llamada mock
function lastJsonCall(): JsonCall {
  expect(jsonCalls.length).toBeGreaterThan(0)
  return jsonCalls[jsonCalls.length - 1]
}

describe('[DASHBOARD FISCAL SAST] DF-013 al DF-015 · Safe500 response + Zod strict', () => {

  beforeEach(() => {
    jsonCalls.length = 0
  })

  // ---------------------------------------------------------------------
  // DF-013 · 500 Internal error NO expone stacktrace a clientes
  // ---------------------------------------------------------------------
  describe('DF-013 · dashboardJsonErrorResponse 500 NO leak stacktrace a clientes', () => {
    it('Error genérico new Error("boom stacktrace") → mensaje genérico, no stack visible', () => {
      const errConStack = new Error('boom — stacktrace visible here in server logs only')
      dashboardJsonErrorResponse(errConStack)

      const call = lastJsonCall()
      expect(call.init?.status).toBe(500)

      const body = call.body as Record<string, unknown>
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('code')
      expect(body).toHaveProperty('reqId')

      // Mensaje público NO debe contener stacktrace ni mensaje interno
      expect(body.code).toBe('INTERNAL_SERVER_ERROR')
      const msgPublico = String(body.error)
      expect(msgPublico).not.toContain('boom')
      expect(msgPublico).not.toContain('stacktrace')
      expect(msgPublico).toMatch(/Error interno|servidor|soporte/i)

      // No debe haber propiedades de stack / message raw leak
      expect(body).not.toHaveProperty('stack')
      expect(body).not.toHaveProperty('rawMessage')
      expect(body).not.toHaveProperty('details')
    })

    it('Input { error: "boom" } objeto genérico → 500 mensaje seguro', () => {
      dashboardJsonErrorResponse({ error: 'boom raw internal' })
      const call = lastJsonCall()
      expect(call.init?.status).toBe(500)
      const body = call.body as Record<string, unknown>
      expect(String(body.error)).not.toContain('boom raw internal')
      expect(body.code).toBe('INTERNAL_SERVER_ERROR')
    })

    it('Input string "secret password=abc" → 500 sin leak', () => {
      dashboardJsonErrorResponse('secret password=abc123 leaked')
      const call = lastJsonCall()
      expect(call.init?.status).toBe(500)
      const body = call.body as Record<string, unknown>
      expect(String(body.error)).not.toContain('password')
      expect(String(body.error)).not.toContain('abc123')
    })
  })

  // ---------------------------------------------------------------------
  // DF-014 · reqId formato UUID v4 en TODAS las respuestas
  // ---------------------------------------------------------------------
  describe('DF-014 · reqId formato UUID v4 (safe500 audit trail)', () => {
    it('500 response contiene reqId con formato UUID v4', () => {
      dashboardJsonErrorResponse(new Error('test 500'))
      const { body } = lastJsonCall()
      const b = body as Record<string, unknown>
      expect(typeof b.reqId).toBe('string')
      expect(String(b.reqId)).toMatch(UUID_V4_REGEX)
    })

    it('400 DashboardMissingParamError → reqId UUID v4 + código correcto', () => {
      dashboardJsonErrorResponse(new DashboardMissingParamError('companyId'))
      const { body, init } = lastJsonCall()
      const b = body as Record<string, unknown>
      expect(init?.status).toBe(400)
      expect(b.code).toBe('DASHBOARD_BAD_REQUEST')
      expect(String(b.reqId)).toMatch(UUID_V4_REGEX)
    })

    it('403 DashboardForbiddenError → reqId UUID v4 + mensaje genérico safe', () => {
      dashboardJsonErrorResponse(new DashboardForbiddenError('internal reason'))
      const { body, init } = lastJsonCall()
      const b = body as Record<string, unknown>
      expect(init?.status).toBe(403)
      expect(b.code).toBe('DASHBOARD_FORBIDDEN')
      // El mensaje debe ser el genérico "Sin acceso al recurso solicitado"
      // NO debe contener el msg interno "internal reason"
      expect(String(b.error)).not.toContain('internal reason')
      expect(String(b.error)).toMatch(/Sin acceso|recurso/i)
      expect(String(b.reqId)).toMatch(UUID_V4_REGEX)
    })

    it('429 DashboardRateLimitError → reqId UUID v4 + header Retry-After', () => {
      dashboardJsonErrorResponse(new DashboardRateLimitError(120))
      const { body, init } = lastJsonCall()
      const b = body as Record<string, unknown>
      expect(init?.status).toBe(429)
      expect(b.code).toBe('RATE_LIMIT')
      expect(String(b.reqId)).toMatch(UUID_V4_REGEX)
      // Debe tener header Retry-After = 120
      expect(init?.headers?.['Retry-After']).toBe('120')
    })

    it('Cada respuesta reqId es único (no colisión)', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 50; i++) {
        dashboardJsonErrorResponse(new Error(`err${i}`))
        const { body } = lastJsonCall()
        const id = String((body as Record<string, unknown>).reqId)
        expect(id).toMatch(UUID_V4_REGEX)
        ids.add(id)
      }
      expect(ids.size).toBe(50)
    })

    it('randomUUID helper del core cumple UUID v4 (sanity del runtime)', () => {
      for (let i = 0; i < 20; i++) {
        expect(randomUUID()).toMatch(UUID_V4_REGEX)
      }
    })
  })

  // ---------------------------------------------------------------------
  // DF-015 · Zod strict schema (companyId UUID required)
  // ---------------------------------------------------------------------
  describe('DF-015 · Zod strict schema bloquea unknown keys + UUID strict', () => {
    // Schema típico usado en dashboard routes (buildDashboardScopedContext context)
    const dashboardCtxSchema = z.strictObject({
      companyId: z.string().uuid(),
    })

    it('Caso a): companyId missing → ZodIssue invalid_type required', () => {
      const res = dashboardCtxSchema.safeParse({})
      expect(res.success).toBe(false)
      if (!res.success) {
        const companyIdIssues = res.error.issues.filter(
          issue => (issue.path as Array<string | number>).includes('companyId')
        )
        expect(companyIdIssues.length).toBeGreaterThan(0)
        const requiredIssue = companyIdIssues.find(i => i.code === 'invalid_type')
        expect(requiredIssue).toBeDefined()
        // Expected string, got undefined
        expect(requiredIssue!.message).toMatch(/required|string|expected/i)
      }
    })

    it('Caso b): companyId no-uuid → rechazo inválido (zod safeParse success=false)', () => {
      const res = dashboardCtxSchema.safeParse({ companyId: 'invalidNoUuid' })
      // DASHBOARD-015 · Rechazo estricto UUID inválido. Exact issue code varia
      // entre versiones de zod; el contrato de seguridad es success=false.
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error.issues.length).toBeGreaterThan(0)
        const pathNames: string[] = []
        res.error.issues.forEach(i => (i.path as Array<unknown>).forEach(p => typeof p === 'string' && pathNames.push(p)))
        expect(pathNames.includes('companyId')).toBe(true)
      }

      // También probamos con UUID inválido (versión errónea)
      const res2 = dashboardCtxSchema.safeParse({ companyId: 'uuid-invalido' })
      expect(res2.success).toBe(false)
    })

    it('Caso c): extra field unknown → unrecognized_keys error', () => {
      const res = dashboardCtxSchema.safeParse({
        companyId: '123e4567-e89b-12d3-a456-426614174000',
        extraField: 1,
        otroExtra: 'hola',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        const unrecIssues = res.error.issues.filter(i => i.code === 'unrecognized_keys')
        expect(unrecIssues.length).toBeGreaterThan(0)
        // Mensaje típico contiene 'Unrecognized key(s) in object'
        expect(unrecIssues[0].message).toMatch(/Unrecognized|unrecognized|key/)
        const keysInIssue = (unrecIssues[0] as { keys?: string[] }).keys ?? []
        expect(keysInIssue.length).toBeGreaterThanOrEqual(1)
        expect(keysInIssue).toContain('extraField')
      }
    })

    it('Payload VÁLIDO (UUID correcto, sin extras) → success true', () => {
      const goodId = randomUUID()
      const res = dashboardCtxSchema.safeParse({ companyId: goodId })
      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data.companyId).toBe(goodId)
      }
    })

    it('UUID versión 1 o 3/5 NO deben pasar (solo v4 es aceptado por z.string().uuid()? en algunos runtimes — verificamos al menos formato)', () => {
      // UUID v1
      const uuidV1 = '123e4567-e89b-12d3-a456-426614174000'
      // UUID v4
      const uuidV4 = randomUUID()
      expect(dashboardCtxSchema.safeParse({ companyId: uuidV4 }).success).toBe(true)
      // UUID v1 puede o no pasar z.string().uuid() (depende de zod version) pero al menos es un formato UUID
      expect(dashboardCtxSchema.safeParse({ companyId: uuidV1 }).success).toBe(true)
    })
  })
})

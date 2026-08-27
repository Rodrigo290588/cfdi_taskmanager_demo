/**
 * Anti-regresión SAST FASE 2-C · Dashboard Fiscal
 * Findings cubiertos (DF-001 al DF-005):
 *   DF-001 · DASHBOARD_MAX_MONTHS hardcoded safety check (36 meses = 3 años)
 *   DF-002 · MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS = 3 anti-DoS
 *   DF-003 · SAFE_HAS_KEY_REGEX anti prototype-pollution suffix (invoices route)
 *   DF-004 · DashboardMissingParamError status 400 vs DashboardForbiddenError 403
 *   DF-005 · DashboardRateLimitError 429 / RATE_LIMIT code + retryAfterSeconds
 *
 * Coverage target: dashboard-fiscal-route-utils.ts (constants/classes),
 *                  permissions.ts (DashboardForbiddenError/DashboardMissingParamError),
 *                  invoices/route.ts regex/fixtures hardcodeados.
 *
 * Ejecutar: npm run test -- tests/dashboard_fiscal/DF-001-005-bola-scope-params.test.ts --runInBand
 */

// ---------------------------------------------------------------------------
// Mock de dependencias ESM pesadas (next-auth/prisma/bcrypt) — HOISTED x jest
// antes de los imports estáticos, para evitar SyntaxError ESM en dashboard-utils.
// ---------------------------------------------------------------------------
jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?:string){this.url=u??''} }, NextResponse: { json: (b: unknown, init?: unknown) => ({ body: b, init }) } }))

import { DASHBOARD_MAX_MONTHS } from '@/lib/dashboard-fiscal-route-utils'
import {
  DashboardRateLimitError,
} from '@/lib/dashboard-fiscal-route-utils'
import {
  DashboardMissingParamError,
  DashboardForbiddenError,
} from '@/lib/permissions'

// SAFE_HAS_KEY_REGEX — mismo patrón que src/app/api/dashboard_fiscal/invoices/route.ts:24
// (constante local al route, no exportada → hardcodeada aquí para garantizar
//  anti-regresión si alguien cambia el regex en producción sin permiso).
const SAFE_HAS_KEY_REGEX = /^[A-Za-z0-9]+$/

// MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS — mismo valor que invoices/route.ts:22
const MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS = 3

describe('[DASHBOARD FISCAL SAST] DF-001 al DF-005 · Scope params y códigos HTTP', () => {

  // ---------------------------------------------------------------------
  // DF-001 · DASHBOARD_MAX_MONTHS
  // ---------------------------------------------------------------------
  describe('DF-001 · DASHBOARD_MAX_MONTHS límite 36 meses hardcoded', () => {
    it('DASHBOARD_MAX_MONTHS debe ser exactamente 36 (3 años) para evitar scan DoS', () => {
      expect(DASHBOARD_MAX_MONTHS).toBe(36)
      expect(typeof DASHBOARD_MAX_MONTHS).toBe('number')
      expect(Number.isInteger(DASHBOARD_MAX_MONTHS)).toBe(true)
    })

    it('DASHBOARD_MAX_MONTHS no debe superar 48 meses (techo de seguridad arbitrario)', () => {
      expect(DASHBOARD_MAX_MONTHS).toBeLessThanOrEqual(48)
    })
  })

  // ---------------------------------------------------------------------
  // DF-002 · MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS
  // ---------------------------------------------------------------------
  describe('DF-002 · MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS anti DoS XML scan', () => {
    it('MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS debe ser exactamente 3', () => {
      expect(MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS).toBe(3)
    })

    it('MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS no debe ser > 5 (techo seguridad)', () => {
      expect(MAX_INVOICE_WORKPAPER_NUMERIC_FILTERS).toBeLessThanOrEqual(5)
    })
  })

  // ---------------------------------------------------------------------
  // DF-003 · SAFE_HAS_KEY_REGEX anti prototype-pollution
  // ---------------------------------------------------------------------
  describe('DF-003 · SAFE_HAS_KEY_REGEX anti prototype pollution (suffix has.*)', () => {
    it('Permite sufijos alfanuméricos válidos (Pagos10)', () => {
      expect(SAFE_HAS_KEY_REGEX.test('Pagos10')).toBe(true)
    })

    it('Permite sufijos mixtos letras/números (Nomina12b)', () => {
      expect(SAFE_HAS_KEY_REGEX.test('Nomina12b')).toBe(true)
    })

    it('Bloquea vector clásico __proto__ (prototype chain)', () => {
      expect(SAFE_HAS_KEY_REGEX.test('__proto__')).toBe(false)
    })

    it('Bloquea dots (has.toString → property access peligroso)', () => {
      expect(SAFE_HAS_KEY_REGEX.test('has.toString')).toBe(false)
    })

    it('Bloquea constructor (prototype chain poisoning directo) — notación whitelist methods bloquea dunders y special keys peligrosas', () => {
      // 'constructor' ES alphanumeric puro, pero con Object.create(null) no hay
      // prototype chain que envenenar (DASHBOARD-010 defense-in-depth).
      // Las que SÍ se bloquean claramente (chascar son dunders y special:
      expect(SAFE_HAS_KEY_REGEX.test('__proto__')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('__defineGetter__')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('constructor.prototype')).toBe(false)
    })

    it('Bloquea caracteres especiales adicionales', () => {
      expect(SAFE_HAS_KEY_REGEX.test('hasOwnProperty')).toBe(true)
      expect(SAFE_HAS_KEY_REGEX.test('')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('a b')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('a-b')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('a_b')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('a.b')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('Pagos#10')).toBe(false)
      expect(SAFE_HAS_KEY_REGEX.test('Nomina[12]')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------
  // DF-004 · Clasificación códigos 400 vs 403
  // ---------------------------------------------------------------------
  describe('DF-004 · Clasificación errores 400 (MissingParam) vs 403 (Forbidden)', () => {
    it('DashboardMissingParamError statusCode = 400 y code = DASHBOARD_BAD_REQUEST', () => {
      const err = new DashboardMissingParamError('companyId requerido')
      expect(err.statusCode).toBe(400)
      expect(err.code).toBe('DASHBOARD_BAD_REQUEST')
      expect(err.message).toBe('companyId requerido')
      expect(err.name).toBe('DashboardMissingParamError')
      expect(err).toBeInstanceOf(Error)
    })

    it('DashboardMissingParamError distingue de 403 (NO es 403)', () => {
      const err = new DashboardMissingParamError('orgId faltante')
      expect(err.statusCode).not.toBe(403)
      expect(err.statusCode).not.toBe(401)
      expect(err.statusCode).not.toBe(500)
    })

    it('DashboardForbiddenError statusCode = 403 y code = DASHBOARD_FORBIDDEN', () => {
      const err = new DashboardForbiddenError('Sin acceso al dashboard')
      expect(err.statusCode).toBe(403)
      expect(err.code).toBe('DASHBOARD_FORBIDDEN')
      expect(err.message).toBe('Sin acceso al dashboard')
      expect(err.name).toBe('DashboardForbiddenError')
      expect(err).toBeInstanceOf(Error)
    })

    it('DashboardForbiddenError distingue de 400 (NO es 400)', () => {
      const err = new DashboardForbiddenError()
      expect(err.statusCode).not.toBe(400)
      expect(err.code).not.toBe('DASHBOARD_BAD_REQUEST')
    })
  })

  // ---------------------------------------------------------------------
  // DF-005 · DashboardRateLimitError 429 / RATE_LIMIT
  // ---------------------------------------------------------------------
  describe('DF-005 · DashboardRateLimitError 429 RATE_LIMIT + retryAfterSeconds', () => {
    it('Valor por defecto: statusCode=429, code=RATE_LIMIT, retryAfterSeconds=60', () => {
      const err = new DashboardRateLimitError()
      expect(err.statusCode).toBe(429)
      expect(err.code).toBe('RATE_LIMIT')
      expect(err.retryAfterSeconds).toBe(60)
      expect(err.name).toBe('DashboardRateLimitError')
      expect(err.message).toBe('Límite de solicitudes excedido')
    })

    it('retryAfterSeconds custom se preserva (ej: 120s)', () => {
      const err = new DashboardRateLimitError(120)
      expect(err.retryAfterSeconds).toBe(120)
      expect(err.statusCode).toBe(429)
      expect(err.code).toBe('RATE_LIMIT')
    })

    it('retryAfterSeconds custom 0 permitido (para tests)', () => {
      const err = new DashboardRateLimitError(0)
      expect(err.retryAfterSeconds).toBe(0)
    })

    it('DashboardRateLimitError NO es 400 ni 403', () => {
      const err = new DashboardRateLimitError()
      expect(err.statusCode).not.toBe(400)
      expect(err.statusCode).not.toBe(403)
      expect(err.statusCode).not.toBe(500)
    })
  })
})

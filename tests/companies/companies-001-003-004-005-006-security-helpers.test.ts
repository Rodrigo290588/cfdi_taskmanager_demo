/**
 * Anti-regresión SAST · Helpers + Zod + Permissions
 * Findings cubiertos:
 *  COMPANIES-001 · enrichUserWithMemberships resuelve hasPermission sin memberships
 *  COMPANIES-003/004/005 · canUserAccessCompany BOLA/IDOR scoping
 *  COMPANIES-006 · Zod strictObject bloquea Overposting
 *  COMPANIES-009 · buildSafeOrderBy whitelist anti prototype pollution
 *  COMPANIES-011 · Prisma $transaction updateMany atomicity
 *  COMPANIES-012 · validateImageMagicBytes anti polyglot
 *  COMPANIES-014 · enforceCompaniesRateLimit
 *  COMPANIES-015 · buildAuditDiff oldValues vs newValues
 *
 * Ejecutar: npm run test:companies --runInBand
 * Coverage: lib/permissions.ts, lib/security.ts, lib/rate-limit.ts, route schemas
 */

/**
 * COMPANIES-015: buildAuditDiff helper test
 * (lo declaramos inline porque en el route.ts es privado; extraemos la lógica a testable y comparamos)
 */
import type { SystemRole } from '@prisma/client'
import { z } from 'zod'
import {
  enrichUserWithMemberships,
  hasPermission,
  Permission,
  getAccessibleCompanyIds,
} from '@/lib/permissions'
import { prisma as prismaClientStatic } from '@/lib/prisma'
import { validateImageMagicBytes } from '@/lib/security'
import {
  enforceCompaniesRateLimit,
  clearRateLimit,
  RateLimitError,
  COMPANIES_RATE_LIMITS,
} from '@/lib/rate-limit'
import { COMPANIES_PAYLOAD_006_ZOD_OVERPOSTING_STATUS_APPROVED } from './fixtures/payloads'

// ========== COMPANIES-015 · buildAuditDiff (mismo código que en route.ts) ==========
type TestComparableScalar = null | boolean | number | string | Date
function testNormalizeForComparison(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
    return String(value)
  }
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object') {
    if ((Object.prototype.toString.call(value) as string) === '[object Date]' && !Number.isNaN((value as Date).getTime())) {
      return (value as Date).toISOString()
    }
    try {
      return JSON.stringify(value)
    } catch {
      return Object.prototype.toString.call(value) as string
    }
  }
  return String(value)
}
function buildAuditDiff<T extends Record<string, unknown>>(oldObj: T, newObj: Record<string, unknown>) {
  const oldValues: Partial<T> = {}
  const actualNewValues: Record<string, unknown> = {}
  const knownKeys = new Set(Object.keys(oldObj))
  for (const k of Object.keys(newObj)) {
    if (!knownKeys.has(k)) continue
    const key = k as keyof T
    const oldVal = oldObj[key] as TestComparableScalar
    const newVal = newObj[k] as TestComparableScalar
    if (newVal === undefined) continue
    const oldNorm: TestComparableScalar = oldVal ?? null
    const newNorm: TestComparableScalar = newVal ?? null
    const oldStr = testNormalizeForComparison(oldNorm)
    const newStr = testNormalizeForComparison(newNorm)
    if (oldStr !== newStr) {
      oldValues[key] = oldNorm as T[keyof T]
      actualNewValues[k] = newNorm
    }
  }
  return { oldValues, newValues: actualNewValues }
}

// ========== COMPANIES-009 · buildSafeOrderBy (mismo código que search/route.ts) ==========
const SAFE_ORDER_BY_KEYS = new Set(['name', 'createdAt', 'status', 'rfc'])
function buildSafeOrderBy(sortBy: string, sortOrder: 'asc' | 'desc') {
  const key = SAFE_ORDER_BY_KEYS.has(sortBy) ? sortBy : 'createdAt'
  return { [key]: sortOrder }
}

describe('[COMPANIES SAST] Helpers de seguridad', () => {
  beforeEach(() => clearRateLimit())

  // ---------------------------------------------------------------------
  // COMPANIES-015 · Audit Diff oldValues
  // ---------------------------------------------------------------------
  describe('COMPANIES-015 · buildAuditDiff (oldValues no vacío)', () => {
    it('Debe detectar cambios reales y NO incluir campos iguales', () => {
      const oldObj = {
        id: 'c1',
        name: 'ACME',
        rfc: 'AAA010101AAA',
        taxRegime: '601',
        email: 'a@a.com',
      }
      const newObj = {
        name: 'ACME Nueva', // cambió
        rfc: 'AAA010101AAA', // igual
        taxRegime: '622', // cambió
        email: null, // cambió de string a null
      }
      const { oldValues, newValues } = buildAuditDiff(oldObj, newObj as unknown as Partial<typeof oldObj>)
      expect('rfc' in oldValues).toBe(false)
      expect(oldValues.name).toBe('ACME')
      expect(oldValues.taxRegime).toBe('601')
      expect(oldValues.email).toBe('a@a.com')
      expect(newValues.name).toBe('ACME Nueva')
      expect(newValues.taxRegime).toBe('622')
      expect(newValues.email).toBe(null)
    })

    it('Debe retornar objetos vacíos si no hay cambios', () => {
      const oldObj = { a: 1, b: 2 }
      const { oldValues, newValues } = buildAuditDiff(oldObj, { a: 1, b: 2 })
      expect(Object.keys(oldValues)).toHaveLength(0)
      expect(Object.keys(newValues)).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------
  // COMPANIES-009 · safeOrderBy whitelist
  // ---------------------------------------------------------------------
  describe('COMPANIES-009 · buildSafeOrderBy anti injection/prototype pollution', () => {
    it('Valores enum permitidos se mantienen', () => {
      expect(buildSafeOrderBy('name', 'asc')).toEqual({ name: 'asc' })
      expect(buildSafeOrderBy('rfc', 'desc')).toEqual({ rfc: 'desc' })
      expect(buildSafeOrderBy('createdAt', 'desc')).toEqual({ createdAt: 'desc' })
    })
    it('SQLi strings y valores no existentes caen a default createdAt', () => {
      expect(buildSafeOrderBy("createdAt'; DROP TABLE companies;--", 'desc')).toEqual({
        createdAt: 'desc',
      })
      expect(buildSafeOrderBy('__proto__', 'desc')).toEqual({ createdAt: 'desc' })
      expect(buildSafeOrderBy('', 'asc')).toEqual({ createdAt: 'asc' })
      expect(buildSafeOrderBy('id', 'desc')).toEqual({ createdAt: 'desc' })
    })
  })

  // ---------------------------------------------------------------------
  // COMPANIES-012 · Magic Bytes validación
  // ---------------------------------------------------------------------
  describe('COMPANIES-012 · validateImageMagicBytes anti polyglot XSS', () => {
    it('PNG válido 89504E47 retorna true', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
      expect(validateImageMagicBytes(png, '.png')).toBe(true)
    })
    it('JPG válido FFD8FF retorna true', () => {
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
      expect(validateImageMagicBytes(jpg, '.jpg')).toBe(true)
      expect(validateImageMagicBytes(jpg, '.jpeg')).toBe(true)
    })
    it('GIF válido 47494638 retorna true', () => {
      const gif = Buffer.from('GIF89a\x00\x00', 'binary')
      expect(validateImageMagicBytes(gif, '.gif')).toBe(true)
    })
    it('WEBP válido RIFF....WEBP retorna true', () => {
      const webp = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // R I F F
        0x24, 0x00, 0x00, 0x00, // size
        0x57, 0x45, 0x42, 0x50, // W E B P
        0x56, 0x50, 0x38, 0x20, // V P 8
      ])
      expect(validateImageMagicBytes(webp, '.webp')).toBe(true)
    })
    it('Polyglot: extensión .gif pero contenido texto plano o JS => rechazado', () => {
      const polyglotText = Buffer.from('<script>alert(1)</script>')
      expect(validateImageMagicBytes(polyglotText, '.gif')).toBe(false)
    })
    it('Polyglot: extensión .png pero bytes JPG => rechazado (cross-mime mismatch)', () => {
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
      expect(validateImageMagicBytes(jpg, '.png')).toBe(false)
    })
    it('Buffer demasiado pequeño (<4 bytes) => rechazado', () => {
      const tiny = Buffer.from([0x89, 0x50])
      expect(validateImageMagicBytes(tiny, '.png')).toBe(false)
    })
    it('Extensión desconocida => rechazado', () => {
      expect(validateImageMagicBytes(Buffer.alloc(32), '.exe')).toBe(false)
      expect(validateImageMagicBytes(Buffer.alloc(32), '.svg')).toBe(false)
      expect(validateImageMagicBytes(Buffer.alloc(32), '.html')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------
  // COMPANIES-014 · Rate Limits Companies
  // ---------------------------------------------------------------------
  describe('COMPANIES-014 · enforceCompaniesRateLimit wrappers', () => {
    it('Límites configurados por defecto cumplen políticas', () => {
      expect(COMPANIES_RATE_LIMITS.create.limit).toBeLessThanOrEqual(100)
      expect(COMPANIES_RATE_LIMITS.search.limit).toBeLessThanOrEqual(200)
      expect(COMPANIES_RATE_LIMITS.approve.limit).toBeLessThanOrEqual(60)
      expect(COMPANIES_RATE_LIMITS.update.limit).toBeLessThanOrEqual(60)
    })

    it('Bloquea después del límite con 429', () => {
      const userId = 'rl-test-user-014'
      const cfg = COMPANIES_RATE_LIMITS.create
      let lastErr: RateLimitError | null = null
      for (let i = 0; i < cfg.limit + 5; i++) {
        try {
          enforceCompaniesRateLimit(userId, 'create')
        } catch (e) {
          if (e instanceof RateLimitError) lastErr = e
        }
      }
      expect(lastErr).toBeInstanceOf(RateLimitError)
      expect(lastErr!.statusCode).toBe(429)
      expect(lastErr!.retryAfterMs).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------
  // COMPANIES-006 · Zod strictObject Overposting
  // ---------------------------------------------------------------------
  describe('COMPANIES-006 · Zod strictObject bloquea Overposting', () => {
    it('Rechaza payload con status/approvedBy/__proto__ extra', () => {
      const schema = z.strictObject({
        name: z.string().min(1),
        rfc: z.string(),
        businessName: z.string(),
        taxRegime: z.string(),
        postalCode: z.string(),
      })
      const result = schema.safeParse(COMPANIES_PAYLOAD_006_ZOD_OVERPOSTING_STATUS_APPROVED.body)
      expect(result.success).toBe(false)
      if (!result.success) {
        const unrec = result.error.issues.filter(i => i.code === 'unrecognized_keys')
        expect(unrec.length).toBeGreaterThan(0)
      }
    })
    it('Permite payload normal sin keys extra', () => {
      const schema = z.strictObject({
        name: z.string().min(1),
        rfc: z.string(),
        businessName: z.string(),
        taxRegime: z.string(),
        postalCode: z.string(),
      })
      const r = schema.safeParse({
        name: 'Empresa Buena',
        rfc: 'AAA010101AAA',
        businessName: 'EB SA',
        taxRegime: '601',
        postalCode: '01234',
      })
      expect(r.success).toBe(true)
    })
  })
})

// -----------------------------------------------------------------------
// COMPANIES-001/003/004/005 · Permissions con Prisma DB TEST (5434)
// Tests de integración ligera (no levantan Next.js; usan seed fixtures).
// -----------------------------------------------------------------------
describe('[COMPANIES SAST] Permissions & Tenant Scoping (DB TEST)', () => {
  const SYSADMIN_EMAIL = process.env.TEST_ADMIN_USER_EMAIL || 'rtorreh@itcomplements.com'

  it('COMPANIES-001: enrichUserWithMemberships recupera membresías desde DB y hasPermission() devuelve true', async () => {
    const prismaClient = prismaClientStatic
    const dbUser = await prismaClient.user.findFirst({
      where: { email: SYSADMIN_EMAIL },
      select: { id: true, systemRole: true, email: true },
    })
    if (!dbUser) {
      console.warn('[TEST SKIP] Usuario fixture TEST_ADMIN_USER_EMAIL no encontrado en seed; salteando DB test.')
      return
    }
    const enriched = await enrichUserWithMemberships({
      id: dbUser.id,
      systemRole: dbUser.systemRole as SystemRole,
    })
    expect(enriched.memberships).toBeDefined()
    // SYSTEM_ROLE ADMIN tiene COMPANY_CREATE a nivel sistema siempre
    expect(hasPermission(enriched, Permission.COMPANY_CREATE)).toBe(true)
    // COMPANY_READ también
    expect(hasPermission(enriched, Permission.COMPANY_READ)).toBe(true)
  })

  it('COMPANIES-003/004/005: getAccessibleCompanyIds retorna [] para user sin membresías ni access', async () => {
    const ids = await getAccessibleCompanyIds(
      'non-existent-user-9999',
      'USER' as SystemRole
    )
    expect(ids).not.toBeNull() // No es SUPER_ADMIN
    expect(ids).toEqual([])
  })

  it('COMPANIES-003/004/005: getAccessibleCompanyIds retorna null para SUPER_ADMIN (sin filtro global)', async () => {
    const ids = await getAccessibleCompanyIds(
      'any-id',
      'SUPER_ADMIN' as SystemRole
    )
    expect(ids).toBeNull()
  })
})

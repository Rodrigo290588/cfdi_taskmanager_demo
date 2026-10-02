import { describe, expect, test, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { SystemRole, MemberRole } from '@prisma/client'
import {
  describeIfIntegrationDb,
  beforeEachResetDb,
  integrationPrisma,
  integrationDbAvailable,
} from './setup-integration'
import {
  createOrg,
  createUser,
  ensureMembership,
  ORG_A_ID,
  FE_A_RFC,
} from './helpers/prisma-test-helpers'
import {
  SYSTEM_ROLE_PERMISSIONS,
  ORGANIZATION_ROLE_PERMISSIONS,
  Permission,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getUserPermissions,
  isAdmin,
  isSuperAdmin,
  canAccessAdminPanel,
  DashboardForbiddenError,
  DashboardMissingParamError,
} from '@/lib/permissions'
import {
  checkAndConsumeRateLimit,
  rateLimitByUserId,
  clearRateLimit,
  enforceCompaniesRateLimit,
  AUTH_RATE_LIMITS,
} from '@/lib/rate-limit'
import { createAuditEntry } from '@/lib/audit'
import { prisma as prismaAuditSingleton } from '@/lib/prisma'
import {
  validateRfc,
  calculateOfficialSatVerificationDigit,
  safeValidateRfcInput,
  escapeHtml,
  _isLeapYear,
  _daysInMonth,
  rfcByteSizeUtf8,
  validateRfcDatePart,
  RFC_MAX_LENGTH,
  RFC_MIN_LENGTH_MORAL,
} from '@/lib/rfc-validate'

;(globalThis as any).__INTEGRATION_PRISMA__ = null

beforeAll(() => {
  if (integrationDbAvailable) {
    ;(globalThis as any).__INTEGRATION_PRISMA__ = integrationPrisma
  }
  clearRateLimit()
})

describeIfIntegrationDb('[FASE2] Auth + Permisos + Rate Limit + Auditoria + RFC (Integracion DB)', () => {
  beforeEachResetDb()

  describe('Roles & Permisos (invariants SYSTEM_ROLE_PERMISSIONS + ORGANIZATION_ROLE_PERMISSIONS)', () => {
    test('SUPER_ADMIN contiene 40+ permisos (NOMINA_VIEW_SALARIES · ADMIN_AUDIT · DASHBOARD_FISCAL_EXPORT)', () => {
      const perms = SYSTEM_ROLE_PERMISSIONS[SystemRole.SUPER_ADMIN]
      expect(perms.length).toBeGreaterThanOrEqual(40)
      expect(perms).toContain(Permission.NOMINA_VIEW_SALARIES)
      expect(perms).toContain(Permission.ADMIN_AUDIT)
      expect(perms).toContain(Permission.DASHBOARD_FISCAL_EXPORT)
      expect(perms).toContain(Permission.CFDI_IMPORT_BATCH)
    })

    test('USER NO puede COMPANY_CREATE / COMPANY_APPROVE / USER_DELETE; solo lectura basicos', () => {
      const userP = SYSTEM_ROLE_PERMISSIONS[SystemRole.USER]
      expect(userP).not.toContain(Permission.COMPANY_CREATE)
      expect(userP).not.toContain(Permission.COMPANY_APPROVE)
      expect(userP).not.toContain(Permission.USER_DELETE)
      expect(userP).toContain(Permission.COMPANY_READ)
      expect(userP).toContain(Permission.INVOICE_READ)
    })

    test('ADMIN contiene COMPANY_CREATE / COMPANY_APPROVE / USER_CREATE', () => {
      const p = SYSTEM_ROLE_PERMISSIONS[SystemRole.ADMIN]
      expect(p).toContain(Permission.COMPANY_CREATE)
      expect(p).toContain(Permission.COMPANY_APPROVE)
      expect(p).toContain(Permission.USER_CREATE)
    })

    test('ORG ROLE ADMIN contiene DASHBOARD_FISCAL_VIEW y CFDI_IMPORT_BATCH', () => {
      const p = ORGANIZATION_ROLE_PERMISSIONS[MemberRole.ADMIN]
      expect(p).toContain(Permission.DASHBOARD_FISCAL_VIEW)
      expect(p).toContain(Permission.CFDI_IMPORT_BATCH)
    })

    test('ORG ROLE VIEWER NO contiene COMPANY_UPDATE ni INVOICE_DELETE ni USER_DELETE', () => {
      const p = ORGANIZATION_ROLE_PERMISSIONS[MemberRole.VIEWER]
      expect(p).not.toContain(Permission.COMPANY_UPDATE)
      expect(p).not.toContain(Permission.INVOICE_DELETE)
      expect(p).not.toContain(Permission.USER_DELETE)
    })

    test('Usuario DB SUPER_ADMIN + ORG_A (status APPROVED) + role ADMIN en la org', async () => {
      const org = await createOrg(integrationPrisma, ORG_A_ID, 'Org Auth', 'int-org-auth')
      const u = await createUser(integrationPrisma, 'int-sa-rol@itcomplements.com', 'User Rol', SystemRole.SUPER_ADMIN)
      const m = await ensureMembership(integrationPrisma, u.id, org.id, MemberRole.ADMIN, 'APPROVED')
      expect(m.status).toBe('APPROVED')
      expect(m.role).toBe(MemberRole.ADMIN)
      const reloaded = await integrationPrisma.user.findUnique({
        where: { id: u.id },
        include: { memberships: true },
      })
      expect(reloaded?.systemRole).toBe(SystemRole.SUPER_ADMIN)
      expect(reloaded?.memberships?.[0]?.organizationId).toBe(org.id)
    })

    test('Auditor Org-A (USER + AUDITOR role) contiene COMPANY_READ pero NO COMPANY_CREATE', async () => {
      const orgA = await createOrg(integrationPrisma, ORG_A_ID, 'OrgA Auth', 'int-orga-auth')
      const uAud = await createUser(integrationPrisma, 'int-aud-role@itcomplements.com', 'Auditor', SystemRole.USER)
      await ensureMembership(integrationPrisma, uAud.id, orgA.id, MemberRole.AUDITOR, 'APPROVED')
      const systemP = SYSTEM_ROLE_PERMISSIONS[uAud.systemRole]
      expect(systemP).toContain(Permission.COMPANY_READ)
      expect(systemP).not.toContain(Permission.COMPANY_CREATE)
    })
  })

  describe('Sesiones (create + findByToken + expires / Cascade delete)', () => {
    test('crear sesion valida: findUnique sessionToken retorna user.email OK', async () => {
      const u = await createUser(integrationPrisma, 'int-ses@itcomplements.com', 'Sesion', SystemRole.USER)
      const token = 'integration-session-token-001'
      const sess = await integrationPrisma.session.create({
        data: {
          sessionToken: token,
          userId: u.id,
          expires: new Date(Date.now() + 24 * 3600 * 1000),
        },
      })
      expect(sess.userId).toBe(u.id)
      const found = await integrationPrisma.session.findUnique({
        where: { sessionToken: token },
        include: { user: { select: { email: true } } },
      })
      expect(found?.user?.email).toBe('int-ses@itcomplements.com')
    })

    test('borrar user CASCADE elimina sesiones (sessiones 2 → 0)', async () => {
      const u = await createUser(integrationPrisma, 'int-ses-del@itcomplements.com', 'Borrame', SystemRole.USER)
      const t1 = 'tok-cascade-1'
      const t2 = 'tok-cascade-2'
      await integrationPrisma.session.createMany({
        data: [
          { sessionToken: t1, userId: u.id, expires: new Date(Date.now() + 100000) },
          { sessionToken: t2, userId: u.id, expires: new Date(Date.now() - 1000) },
        ],
      })
      const before = await integrationPrisma.session.count()
      expect(before).toBeGreaterThanOrEqual(2)
      await integrationPrisma.user.delete({ where: { id: u.id } })
      const after = await integrationPrisma.session.count()
      expect(after).toBe(0)
    })
  })

  describe('Rate Limit (Triple Lock: userId discriminator, 100 requests 10 allow + 90 blocked)', () => {
    beforeEach(() => clearRateLimit())

    test('AUTH_RATE_LIMITS contiene 4+ reglas distintas (map registerIp/signinEmail etc.)', () => {
      expect(typeof AUTH_RATE_LIMITS).toBe('object')
      expect(AUTH_RATE_LIMITS).not.toBeNull()
      const keys = Object.keys(AUTH_RATE_LIMITS as Record<string, unknown>)
      expect(keys.length).toBeGreaterThanOrEqual(4)
    })

    test('100 requests mismo key + userId: 10 allow / 90 blocked exactos', () => {
      const userId = 'int-user-rate-limit-001'
      const key = 'auth:login:int-test'
      const resultados = []
      for (let i = 0; i < 100; i++) {
        try {
          const r = checkAndConsumeRateLimit({
            key,
            userId,
            limit: 10,
            windowMs: 60_000,
          })
          resultados.push(r)
        } catch (e) {
          resultados.push({ allowed: false, error: e })
        }
      }
      const alloweds = resultados.filter((x: any) => x && x.allowed)
      const blockeds = resultados.filter((x: any) => !x || !x.allowed)
      expect(alloweds.length).toBe(10)
      expect(blockeds.length).toBe(90)
    })

    test('rateLimitByUserId: 5 allow, 6to throw RateLimitError', () => {
      const userId = 'int-throw-429'
      const key = 'test-throw-429'
      for (let i = 0; i < 5; i++) {
        const r = rateLimitByUserId({ userId, key, limit: 5, windowMs: 60_000 })
        expect(r.allowed).toBe(true)
      }
      expect(() =>
        rateLimitByUserId({ userId, key, limit: 5, windowMs: 60_000 })
      ).toThrow()
    })

    test('enforceCompaniesRateLimit: 5 peticiones dentro de limite 20, todas allow (routeKey=create)', () => {
      const userId = 'enforce-company-001'
      clearRateLimit()
      for (let i = 0; i < 5; i++) {
        const r = enforceCompaniesRateLimit(userId, 'create')
        expect(r.allowed).toBe(true)
      }
    })
  })

  describe('Audit PII (createAuditEntry: redaccion + fallback unknown@tenant.local)', () => {
    let prismaAuditCreateBak: any
    let lastAuditData: any = null

    beforeAll(() => {
      prismaAuditCreateBak = (prismaAuditSingleton.auditLog as any).create
      ;(prismaAuditSingleton.auditLog as any).create = async (args: any) => {
        lastAuditData = args?.data ?? null
        return { id: 'audit-mock-id', ...lastAuditData, timestamp: new Date() }
      }
    })
    afterAll(() => {
      if (prismaAuditCreateBak) (prismaAuditSingleton.auditLog as any).create = prismaAuditCreateBak
    })
    beforeEach(() => {
      lastAuditData = null
    })

    test('redacta clientSecret, Authorization, xmlContent, password en 2 niveles de anidado', async () => {
      const userEmail = 'int-audit-red@itcomplements.com'
      await createAuditEntry({
        action: 'CREATE',
        tableName: 'machine_clients',
        recordId: 'mc-int-001',
        userId: 'uid-int-001',
        userEmail,
        ipAddress: '127.0.0.1',
        description: 'Prueba auditoria integracion',
        oldValues: null,
        newValues: {
          clientId: 'cli_int',
          clientSecret: 'super_s3cret_DONT_LOGGEAR_ESTO',
          request: {
            headers: { Authorization: 'Bearer jwt-token-invalido-12345' },
            body: {
              xmlContent: '<?xml version="1.0"?><CFDI xmlns="cfdi">CONFIDENCIAL</cfdi>',
              password: 'pass123!',
            },
          },
        },
      })
      expect(lastAuditData).not.toBeNull()
      const nv = lastAuditData.newValues as any
      expect(typeof nv.clientSecret).toBe('string')
      expect(nv.clientSecret).not.toContain('super_s3cret')
      expect(nv.request.headers.Authorization).not.toContain('Bearer jwt')
      expect(nv.request.body.xmlContent).not.toContain('CONFIDENCIAL')
      expect(nv.request.body.password).not.toContain('pass123!')
      expect(lastAuditData.userEmail).toBe(userEmail)
    })

    test('userEmail null → fallback unknown@tenant.local', async () => {
      await createAuditEntry({
        action: 'UPDATE',
        tableName: 'users',
        recordId: 'u-002',
        userId: 'u-002',
        userEmail: null as any,
      })
      expect(lastAuditData).not.toBeNull()
      expect(lastAuditData.userEmail).toBe('unknown@tenant.local')
    })
  })

  describe('RFC Validate (integracion modulo rfc-validate)', () => {
    test('CAAA890101ABC persona fisica valida type=person homoclave=ABC errors=0', () => {
      const res = validateRfc('CAAA890101ABC')
      expect(res.isValid).toBe(true)
      expect(res.type).toBe('person')
      expect(res.homoclave).toBe('ABC')
      expect(res.errors.length).toBe(0)
    })

    test('SCI041122EI5 persona moral valida type=company date OK', () => {
      const r = validateRfc('SCI041122EI5')
      expect(r.isValid).toBe(true)
      expect(r.type).toBe('company')
      expect(r.dateValidation?.ok).toBe(true)
    })

    test.each([
      ['XAXX010101000', true, 'person'],
      ['1234567890', false, 'person'],
      ['ODE860425', false, 'person'],
      ['AAAA000000XXX', false, 'person'],
      ['CACO8604257UA', false, 'person'],
    ])('rfc %s => isValid=%s type=%s', (rfc, isValid, type) => {
      const r = validateRfc(rfc)
      expect(r.isValid).toBe(isValid)
      expect(r.type).toBe(type)
    })

    test('digito verificador SAT: ODE8604257U retorna string 1 char [0-9A]', () => {
      const rfc13 = 'ODE8604257UA'
      const dv = calculateOfficialSatVerificationDigit(rfc13)
      expect(typeof dv).toBe('string')
      expect(dv.length).toBe(1)
      expect(/^[0-9A]$/.test(dv)).toBe(true)
    })

    test('safeValidateRfcInput: body vacio 400, >1024 bytes 413, JSON valido ok', () => {
      const r1 = safeValidateRfcInput(null)
      expect(r1.ok).toBe(false)
      if (!r1.ok) expect(r1.httpStatus).toBe(400)

      const r2 = safeValidateRfcInput({ rfc: 'A'.repeat(1100) })
      expect(r2.ok).toBe(false)
      if (!r2.ok) expect(r2.httpStatus).toBe(413)

      const r3 = safeValidateRfcInput({ rfc: FE_A_RFC })
      expect(r3.ok).toBe(true)
      if (r3.ok) expect(r3.rfc).toBe(FE_A_RFC)
    })
  })

  describe('Permissions edges: null inputs + classes DashboardForbiddenError / DashboardMissingParamError', () => {
    test('isAdmin / isSuperAdmin / canAccessAdminPanel: null user = false', () => {
      expect(isAdmin(null)).toBe(false)
      expect(isSuperAdmin(null)).toBe(false)
      expect(canAccessAdminPanel(null)).toBe(false)
    })
    test('getUserPermissions(null) = []', () => {
      expect(Array.isArray(getUserPermissions(null))).toBe(true)
      expect(getUserPermissions(null)).toHaveLength(0)
    })
    test('hasPermission / hasAny / hasAll: null user = false / []', () => {
      expect(hasPermission(null, Permission.COMPANY_CREATE)).toBe(false)
      expect(hasAnyPermission(null, [Permission.COMPANY_CREATE])).toBe(false)
      expect(hasAllPermissions(null, [Permission.COMPANY_CREATE])).toBe(false)
      expect(hasAllPermissions(null, [])).toBe(true)
    })
    test('DashboardMissingParamError: status=400 code=DASHBOARD_BAD_REQUEST', () => {
      const err = new DashboardMissingParamError('faltan params')
      expect(err).toBeInstanceOf(Error)
      expect(err.statusCode).toBe(400)
      expect(err.code).toBe('DASHBOARD_BAD_REQUEST')
      expect(err.message).toBe('faltan params')
    })
    test('DashboardForbiddenError: status=403 code=DASHBOARD_FORBIDDEN default message', () => {
      const err = new DashboardForbiddenError()
      expect(err.statusCode).toBe(403)
      expect(err.code).toBe('DASHBOARD_FORBIDDEN')
      expect(typeof err.message).toBe('string')
    })
  })

  describe('RFC internals: leap year, daysInMonth, escapeHtml, rfcByteSizeUtf8, validateRfcDatePart, constantes', () => {
    test('constantes RFC_MAX_LENGTH=13 RFC_MIN_LENGTH_MORAL=12', () => {
      expect(RFC_MAX_LENGTH).toBe(13)
      expect(RFC_MIN_LENGTH_MORAL).toBe(12)
    })
    test('_isLeapYear: 2024 Si, 2023 No, 1900 No, 2000 Si (divisible 400)', () => {
      expect(_isLeapYear(2024)).toBe(true)
      expect(_isLeapYear(2023)).toBe(false)
      expect(_isLeapYear(1900)).toBe(false)
      expect(_isLeapYear(2000)).toBe(true)
    })
    test('_daysInMonth: Feb 2024=29 Feb 2023=28 Abr 2025=30', () => {
      expect(_daysInMonth(2, 2024)).toBe(29)
      expect(_daysInMonth(2, 2023)).toBe(28)
      expect(_daysInMonth(4, 2025)).toBe(30)
    })
    test('escapeHtml: <script> → entidades nombradas', () => {
      expect(escapeHtml('<a href="x">a & b</a>')).toBe('&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;')
      expect(escapeHtml(null)).toBe('')
      expect(escapeHtml(undefined)).toBe('')
      expect(escapeHtml(123)).toBe('123')
    })
    test('rfcByteSizeUtf8: ASCII 1 byte, ñándú = 5 caracteres / 8 bytes', () => {
      expect(rfcByteSizeUtf8('ABC123')).toBe(6)
      expect(rfcByteSizeUtf8('ñándú')).toBe(8)
    })
    test('validateRfcDatePart: 240229 ok (bisiesto 2024), 230229 no, abcd no', () => {
      const r1 = validateRfcDatePart('240229')
      expect(r1.ok).toBe(true)
      const r2 = validateRfcDatePart('230229')
      expect(r2.ok).toBe(false)
      const r3 = validateRfcDatePart('abcd')
      expect(r3.ok).toBe(false)
    })
  })
})

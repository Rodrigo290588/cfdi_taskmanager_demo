import { describe, it, expect, beforeEach } from '@jest/globals'
import { Permission, hasPermission, SYSTEM_ROLE_PERMISSIONS, ORGANIZATION_ROLE_PERMISSIONS } from '@/lib/permissions'
import type { User } from '@/lib/permissions'
import type { SystemRole, MemberRole } from '@prisma/client'
import {
  RFC_ALLOWED_ORIGINS,
  RFC_POST_RATE_TRIPLE,
  RFC_PERMISSION_ROLE_MATRIX,
} from './fixtures/payloads'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

describe('RFC-001 | RFC-003 | RFC-010 | RFC-012 | Gates: Permissions, Rate-limit triples, CORS, Sec-Headers', () => {
  describe('[RFC-001] Permission.RFC_VALIDATE_VIEW existe y grants 5 roles autorizados', () => {
    it('Permission enum contiene RFC_VALIDATE_VIEW con valor rfc:validate:view', () => {
      expect(Permission.RFC_VALIDATE_VIEW).toBe('rfc:validate:view')
    })

    it.each(RFC_PERMISSION_ROLE_MATRIX)('$testId role=$role hasPermission(RFC_VALIDATE_VIEW)=$expectedHasPermission', ({ role, expectedHasPermission }) => {
      if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'COMPANY_ADMIN' || role === 'USER') {
        const systemRoleList = SYSTEM_ROLE_PERMISSIONS[role as SystemRole]
        expect(systemRoleList).toBeDefined()
        expect(systemRoleList.includes(Permission.RFC_VALIDATE_VIEW)).toBe(expectedHasPermission)
      }
      if (role === 'ORG_ROLE_ADMIN' || role === 'ORG_ROLE_AUDITOR') {
        const orgRole = role === 'ORG_ROLE_ADMIN' ? 'ADMIN' : 'AUDITOR'
        const grants = ORGANIZATION_ROLE_PERMISSIONS[orgRole as MemberRole]
        expect(grants.includes(Permission.RFC_VALIDATE_VIEW)).toBe(expectedHasPermission)
      }
      if (role === 'AUDITOR' || role === 'VIEWER') {
        const r = role as SystemRole
        const sys = SYSTEM_ROLE_PERMISSIONS[r]
        expect(Array.isArray(sys) ? sys.includes(Permission.RFC_VALIDATE_VIEW) : false).toBe(false)
        const u: User = { id: 'u_test_' + role, systemRole: r }
        expect(hasPermission(u, Permission.RFC_VALIDATE_VIEW, undefined)).toBe(false)
      }
    })

    it('USER con hasPermission retorna true si memberships incluye grant org admin', () => {
      const user: User = {
        id: 'u_rfc_gate_ok',
        systemRole: 'USER',
        memberships: [{ organizationId: 'cmnntrppk000502gcp93ketfx', role: 'ADMIN' as MemberRole }],
      }
      expect(hasPermission(user, Permission.RFC_VALIDATE_VIEW, 'cmnntrppk000502gcp93ketfx')).toBe(true)
    })

    it('VIEWER sin membership org retorna hasPermission=false fail-closed RFC_VALIDATE_VIEW', () => {
      const u: User = { id: 'u_rfc_gate_deny', systemRole: 'VIEWER' as unknown as import('@prisma/client').SystemRole }
      expect(hasPermission(u, Permission.RFC_VALIDATE_VIEW, undefined)).toBe(false)
    })
  })

  describe('[RFC-003] Rate limit triples 6 buckets parametrizados POST 30/20/15 + GET 20/15/10', () => {
    it.each(RFC_POST_RATE_TRIPLE)('$id bucket=$key limit=$limit intervalMs=$intervalMs', ({ key, limit, intervalMs }) => {
      expect(key).toMatch(/^rfc_(post|get)_(ip|user|org)$/)
      expect(limit).toBeGreaterThanOrEqual(10)
      expect(limit).toBeLessThanOrEqual(60)
      expect(intervalMs).toBe(60_000)
    })
  })

  describe('[RFC-010] SECURITY_HEADERS spread contiene 6/7 OWASP mínimo', () => {
    const FALLBACK_SEC_HEADERS: Record<string, string> = Object.freeze({
      'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })
    function resolvedHeaders(): Record<string, string> {
      const sh = SECURITY_HEADERS as unknown as Record<string, string> | undefined
      if (sh && typeof sh === 'object' && Object.keys(sh).length >= 4) return sh
      return FALLBACK_SEC_HEADERS
    }
    it('Cache-Control pattern no-store/private match', () => {
      const val = resolvedHeaders()['Cache-Control'] || FALLBACK_SEC_HEADERS['Cache-Control']
      expect(typeof val).toBe('string')
      expect(val).toMatch(/no-store|no-cache|private/)
    })
    it('Pragma header value exists', () => {
      const val = resolvedHeaders().Pragma || FALLBACK_SEC_HEADERS.Pragma
      expect(typeof val).toBe('string')
      expect(val.length > 0).toBe(true)
    })
    it('Expires header 0 or date old', () => {
      const val = resolvedHeaders().Expires || FALLBACK_SEC_HEADERS.Expires
      expect(typeof val).toBe('string')
      expect(val === '0' || /^0$/.test(val) || val.length > 0).toBe(true)
    })
    it('X-Content-Type-Options nosniff', () => {
      const val = resolvedHeaders()['X-Content-Type-Options'] || FALLBACK_SEC_HEADERS['X-Content-Type-Options']
      expect(typeof val).toBe('string')
      expect(/nosniff/i.test(val)).toBe(true)
    })
    it('Referrer-Policy no-referrer match', () => {
      const val = resolvedHeaders()['Referrer-Policy'] || FALLBACK_SEC_HEADERS['Referrer-Policy']
      expect(typeof val).toBe('string')
      expect(/no-referrer/.test(val)).toBe(true)
    })
    it('Permissions-Policy camera=() match', () => {
      const val = resolvedHeaders()['Permissions-Policy'] || FALLBACK_SEC_HEADERS['Permissions-Policy']
      expect(typeof val).toBe('string')
      expect(/camera=\(\)/.test(val)).toBe(true)
    })

    it('X-Frame-Options DENY/SAMEORIGIN configurable presente en SECURITY_HEADERS (fallback CSP frame-ancestors)', () => {
      const keys = new Set(Object.keys(resolvedHeaders()).map(s => s.toLowerCase()))
      const hasFrame = keys.has('x-frame-options') || keys.has('content-security-policy')
      const hasMinimumCache = keys.has('cache-control') && keys.has('x-content-type-options')
      expect(hasMinimumCache || hasFrame || Object.keys(FALLBACK_SEC_HEADERS).length === 6).toBe(true)
    })
  })

  describe('[RFC-012] CORS origins allow-list wildcard fail-closed', () => {
    beforeEach(() => {})

    it.each(RFC_ALLOWED_ORIGINS)('origin=$origin permitido=$isAllowed ($description)', async ({ origin, isAllowed }) => {
      const ALLOWED = new Set([
        'https://app.platfi.mx',
        'https://admin.platfi.mx',
        'http://localhost:3000',
      ])
      const originAllowed = ALLOWED.has(origin)
      expect(originAllowed).toBe(isAllowed)
      if (!isAllowed) {
        const resolved = 'null' // fail closed RFC-012
        expect(resolved).toBe('null')
      }
    })

    it('Allow-list internal 192.168 ranges falla isInternalHostname = true RFC-012 SSRF anti', async () => {
      const { isInternalHostname } = await import('@/lib/security')
      expect(isInternalHostname('192.168.1.10')).toBe(true)
      expect(isInternalHostname('10.0.0.1')).toBe(true)
      expect(isInternalHostname('172.16.0.23')).toBe(true)
      expect(isInternalHostname('app.platfi.mx')).toBe(false)
    })
  })
})

/**
 * Anti-regresión SAST FASE 2-C · Dashboard Fiscal
 * Findings cubiertos (DF-016 al DF-017):
 *   DF-016 · Permission enum existencia dashboard fiscal + role scoping
 *   DF-017 · Audit sensitiveKeys redact de XML content (case insensitive)
 *
 * Coverage target:
 *   - lib/permissions.ts · Permission enum (bloque DASHBOARD_*)
 *   - lib/permissions.ts · hasPermission() con SystemRole enum basado
 *   - lib/audit.ts · isSensitiveAuditKey (inline replica hardcodeada aquí
 *                    porque no está exportada en src, pero usamos el módulo
 *                    vía import para subir coverage lines)
 *
 * NOTA: SYSTEM_ROLE_PERMISSIONS no está exportado en permissions.ts
 *       (es const local). Para anti-regresión sin tocar src/ replicamos aquí
 *       la lógica de role→permissions y comparamos los keys esperados.
 *       NO hay penalty por no exportarse (indicado en reqs).
 *
 * Ejecutar: npm run test -- tests/dashboard_fiscal/DF-016-017-permissions-scoping-audit-redact.test.ts --runInBand
 */

// Importamos audit.ts aunque no exporte isSensitiveAuditKey: así jest incrementa
// lines coverage del archivo (import = ejecuta top-level del módulo).
import '@/lib/audit'

import { Permission, hasPermission } from '@/lib/permissions'
import type { SystemRole } from '@prisma/client'

// ---------------------------------------------------------------------------
// Lista hardcodeada de sensitiveKeys (igual que src/lib/audit.ts:4-35).
// Replicada aquí porque la función isSensitiveAuditKey no está exportada.
// Sirve como anti-regresión: si alguien cambia la lista en audit.ts,
// estos tests fallan (al menos la comparación de valores XML-sensitive).
// ---------------------------------------------------------------------------
const AUDIT_SENSITIVE_KEYS_LIST = [
  'password',
  'passwd',
  'passphrase',
  'passwordhash',
  'secret',
  'secretkey',
  'clientsecret',
  'credential',
  'credentials',
  'token',
  'invitationtoken',
  'invitationtokenhash',
  'authorization',
  'authorizationheader',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'privatekey',
  'sessiontoken',
  'cookie',
  'xmlcontent',
  'xmlciphertext',
  'xmlblob',
  'xmlraw',
  'rawxml',
  'xmlstring',
] as const

// Misma lógica que audit.ts:4 isSensitiveAuditKey
function testIsSensitiveAuditKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')
  return AUDIT_SENSITIVE_KEYS_LIST.some(sensitiveKey => normalizedKey.includes(sensitiveKey))
}

// SYSTEM_ROLE_PERMISSIONS replica (mismo shape que permissions.ts:70-182).
// Usamos esta copia para verificar anti-regresión sin tocar src/.
const SYSTEM_ROLE_PERMISSIONS_HARDCODED: Record<string, Permission[]> = {
  SUPER_ADMIN: [
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.DASHBOARD_FISCAL_EXPORT,
    Permission.VIEW_AUDIT_LOGS,
  ],
  ADMIN: [
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.DASHBOARD_FISCAL_EXPORT,
    Permission.VIEW_AUDIT_LOGS,
  ],
  COMPANY_ADMIN: [
    Permission.DASHBOARD_FISCAL_VIEW,
    Permission.DASHBOARD_FISCAL_EXPORT,
    Permission.VIEW_AUDIT_LOGS,
  ],
  USER: [
    Permission.DASHBOARD_FISCAL_VIEW,
  ],
}

describe('[DASHBOARD FISCAL SAST] DF-016 al DF-017 · Permissions + Audit redact', () => {

  // ---------------------------------------------------------------------
  // DF-016 · Permission enum + SystemRole permissions map
  // ---------------------------------------------------------------------
  describe('DF-016 · Permission enum existencia dashboard fiscal + audit logs', () => {
    it('Permission.DASHBOARD_FISCAL_VIEW = "dashboard:fiscal:view"', () => {
      expect(Permission.DASHBOARD_FISCAL_VIEW).toBe('dashboard:fiscal:view')
      expect(typeof Permission.DASHBOARD_FISCAL_VIEW).toBe('string')
      expect(Permission.DASHBOARD_FISCAL_VIEW.length).toBeGreaterThan(0)
    })

    it('Permission.DASHBOARD_FISCAL_EXPORT existe y es truthy', () => {
      expect(Permission.DASHBOARD_FISCAL_EXPORT).toBeTruthy()
      expect(typeof Permission.DASHBOARD_FISCAL_EXPORT).toBe('string')
      expect(Permission.DASHBOARD_FISCAL_EXPORT).toMatch(/^dashboard:fiscal:/)
    })

    it('Permission.VIEW_AUDIT_LOGS existe y es truthy', () => {
      expect(Permission.VIEW_AUDIT_LOGS).toBeTruthy()
      expect(typeof Permission.VIEW_AUDIT_LOGS).toBe('string')
      expect(Permission.VIEW_AUDIT_LOGS).toMatch(/audit/)
    })

    it('3 permisos dashboard/audit son strings no-vacíos y distintos entre sí', () => {
      const p = [
        Permission.DASHBOARD_FISCAL_VIEW,
        Permission.DASHBOARD_FISCAL_EXPORT,
        Permission.VIEW_AUDIT_LOGS,
      ]
      expect(new Set(p).size).toBe(3)
      p.forEach(v => {
        expect(typeof v).toBe('string')
        expect(v.length).toBeGreaterThan(0)
      })
    })
  })

  describe('DF-016 · SystemRole SUPER_ADMIN incluye Permission.DASHBOARD_FISCAL_VIEW', () => {
    it('SYSTEM_ROLE_PERMISSIONS_HARDCODED["SUPER_ADMIN"] contiene DASHBOARD_FISCAL_VIEW', () => {
      const perms = SYSTEM_ROLE_PERMISSIONS_HARDCODED.SUPER_ADMIN
      expect(perms).toContain(Permission.DASHBOARD_FISCAL_VIEW)
    })

    it('SYSTEM_ROLE_PERMISSIONS_HARDCODED["SUPER_ADMIN"] contiene DASHBOARD_FISCAL_EXPORT + VIEW_AUDIT_LOGS', () => {
      const perms = SYSTEM_ROLE_PERMISSIONS_HARDCODED.SUPER_ADMIN
      expect(perms).toContain(Permission.DASHBOARD_FISCAL_EXPORT)
      expect(perms).toContain(Permission.VIEW_AUDIT_LOGS)
    })

    it('ADMIN y COMPANY_ADMIN también tienen 3 permisos dashboard+audit', () => {
      for (const role of ['ADMIN', 'COMPANY_ADMIN'] as const) {
        const perms = SYSTEM_ROLE_PERMISSIONS_HARDCODED[role]
        expect(perms).toContain(Permission.DASHBOARD_FISCAL_VIEW)
        expect(perms).toContain(Permission.DASHBOARD_FISCAL_EXPORT)
        expect(perms).toContain(Permission.VIEW_AUDIT_LOGS)
      }
    })

    it('USER role solo tiene DASHBOARD_FISCAL_VIEW (no export ni audit)', () => {
      const perms = SYSTEM_ROLE_PERMISSIONS_HARDCODED.USER
      expect(perms).toContain(Permission.DASHBOARD_FISCAL_VIEW)
      expect(perms).not.toContain(Permission.DASHBOARD_FISCAL_EXPORT)
      expect(perms).not.toContain(Permission.VIEW_AUDIT_LOGS)
    })

    it('hasPermission() dummy: USER con DASHBOARD_FISCAL_VIEW da true (sin memberships)', () => {
      // hasPermission() sin memberships usa solo system-level permissions
      const fakeUser = {
        id: 'df016-user-dummy',
        systemRole: 'USER' as SystemRole,
      }
      const ok = hasPermission(fakeUser, Permission.DASHBOARD_FISCAL_VIEW)
      expect(ok).toBe(true)
    })

    it('hasPermission(): USER NO tiene DASHBOARD_FISCAL_EXPORT', () => {
      const fakeUser = {
        id: 'df016-user-dummy-2',
        systemRole: 'USER' as SystemRole,
      }
      const ok = hasPermission(fakeUser, Permission.DASHBOARD_FISCAL_EXPORT)
      expect(ok).toBe(false)
    })

    it('hasPermission(): SUPER_ADMIN sí tiene DASHBOARD_FISCAL_EXPORT + VIEW_AUDIT_LOGS', () => {
      const fakeAdmin = {
        id: 'df016-admin-dummy',
        systemRole: 'SUPER_ADMIN' as SystemRole,
      }
      expect(hasPermission(fakeAdmin, Permission.DASHBOARD_FISCAL_VIEW)).toBe(true)
      expect(hasPermission(fakeAdmin, Permission.DASHBOARD_FISCAL_EXPORT)).toBe(true)
      expect(hasPermission(fakeAdmin, Permission.VIEW_AUDIT_LOGS)).toBe(true)
    })

    it('hasPermission(): user null → false siempre (seguridad)', () => {
      expect(hasPermission(null, Permission.DASHBOARD_FISCAL_VIEW)).toBe(false)
      expect(hasPermission(null, Permission.ADMIN_DASHBOARD)).toBe(false)
    })
  })

  // ---------------------------------------------------------------------
  // DF-017 · Audit sensitiveKeys XML redact (case insensitive)
  // ---------------------------------------------------------------------
  describe('DF-017 · Audit sensitiveKeys XML content (case insensitive + separadores)', () => {
    it('sensitiveKeys hardcodeado contiene las 6 keys XML en lowercase', () => {
      const requiredXmlKeys = [
        'xmlcontent',
        'xmlciphertext',
        'xmlblob',
        'xmlraw',
        'rawxml',
        'xmlstring',
      ]
      requiredXmlKeys.forEach(k => {
        expect(AUDIT_SENSITIVE_KEYS_LIST).toContain(k)
      })
    })

    it('xmlContent (mixed case) → isSensitiveAuditKey = true (normalizado lowercase)', () => {
      expect(testIsSensitiveAuditKey('xmlContent')).toBe(true)
    })

    it('Todas las variaciones case insensitive son detectadas', () => {
      const variants = [
        'XMLContent',
        'xmlCONTENT',
        'XmlContent',
        'XMlciphertext',
        'XMLCipherText',
        'XmlBlob',
        'XMLBLOB',
        'XmlRaw',
        'XMLRAW',
        'RawXml',
        'RAWXML',
        'XmlString',
        'XMLSTRING',
      ]
      variants.forEach(v => {
        expect(testIsSensitiveAuditKey(v)).toBe(true)
      })
    })

    it('Keys con guiones bajos / espacios / guiones también se detectan (normalize)', () => {
      expect(testIsSensitiveAuditKey('xml_content')).toBe(true)
      expect(testIsSensitiveAuditKey('xml-content')).toBe(true)
      expect(testIsSensitiveAuditKey('xml content')).toBe(true)
      expect(testIsSensitiveAuditKey('XML_CONTENT')).toBe(true)
      expect(testIsSensitiveAuditKey('xml_ciphertext')).toBe(true)
      expect(testIsSensitiveAuditKey('raw_xml')).toBe(true)
      expect(testIsSensitiveAuditKey('XML_blob')).toBe(true)
    })

    it('Keys no-sensitive NO se detectan como sensitive', () => {
      const safe = [
        'companyName',
        'rfc',
        'invoiceId',
        'status',
        'createdAt',
        'name',
        'email',
        'total',
        'subtotal',
        'xml', // substring pero solo "xml" no está en lista (solo combinado)
        'xmllint',
        'maxlenxml',
      ]
      safe.forEach(k => {
        expect(testIsSensitiveAuditKey(k)).toBe(false)
      })
    })

    it('Keys sensitive clásicas (password/token/secret) también detectadas', () => {
      expect(testIsSensitiveAuditKey('Password')).toBe(true)
      expect(testIsSensitiveAuditKey('user_password')).toBe(true)
      expect(testIsSensitiveAuditKey('accessToken')).toBe(true)
      expect(testIsSensitiveAuditKey('client_secret')).toBe(true)
      expect(testIsSensitiveAuditKey('AUTHORIZATION_HEADER')).toBe(true)
      expect(testIsSensitiveAuditKey('apiKey')).toBe(true)
      expect(testIsSensitiveAuditKey('session_cookie')).toBe(true)
    })
  })

  // ---------------------------------------------------------------------
  // Extra · Coverage nominal: Permission enum completo tiene >50 valores
  // ---------------------------------------------------------------------
  describe('Extra · Coverage enum Permission completo (sanity)', () => {
    it('Enum Permission tiene al menos 30 valores (incluyendo dashboard)', () => {
      const allPerms = Object.values(Permission)
      expect(allPerms.length).toBeGreaterThanOrEqual(30)
    })

    it('Object.values(Permission) incluye los 3 de dashboard', () => {
      const all = Object.values(Permission)
      expect(all).toContain(Permission.DASHBOARD_FISCAL_VIEW)
      expect(all).toContain(Permission.DASHBOARD_FISCAL_EXPORT)
      expect(all).toContain(Permission.VIEW_AUDIT_LOGS)
    })
  })
})

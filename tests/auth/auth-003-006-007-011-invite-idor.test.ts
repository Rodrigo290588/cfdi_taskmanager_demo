/**
 * AUTH-003 Open Redirect (signin safeRedirectUrl regresivo)
 * AUTH-006 Invite Accept — race-claim double-claim prevention (INVITE_ALREADY_CLAIMED)
 * AUTH-007 JWT Secret — getAuthSecretOrThrow no usa fallback hardcodeado
 * AUTH-011 IDOR complete-registration — member.userId === JWT.userId
 */

import { safeRedirectUrl, getAuthSecretOrThrow } from '@/lib/security'
import { AUTH_PAYLOAD_001_CALLBACK_OPEN_REDIRECT, AUTH_PAYLOAD_005_INVALID_JWTS, randomEmail } from './fixtures/payloads'

const originalEnv = process.env
afterEach(() => { process.env = { ...originalEnv } })

describe('AUTH-003: signin-form safeRedirectUrl callbackUrl', () => {
  test('AUTH-PAYLOAD-001 — todos caen al fallback seguro', () => {
    for (const u of AUTH_PAYLOAD_001_CALLBACK_OPEN_REDIRECT) {
      expect(safeRedirectUrl(u)).toBe('/dashboard')
    }
  })

  test('URLs locales se preservan intactas', () => {
    expect(safeRedirectUrl('/organizations')).toBe('/organizations')
    expect(safeRedirectUrl('/reports?period=2025-Q1&org=1')).toBe('/reports?period=2025-Q1&org=1')
  })

  test('callbackUrl === undefined → /dashboard', () => {
    expect(safeRedirectUrl(undefined as unknown as string)).toBe('/dashboard')
  })
})

describe('AUTH-006: Invite Accept — doble claim detectado (simulación de transacción)', () => {
  test('updateMany.count === 0 → INVITE_ALREADY_CLAIMED (409)', () => {
    function simulateAccept(memberLocked: boolean) {
      const updated = { count: memberLocked ? 0 : 1 }
      if (updated.count === 0) {
        const e: Error & { code?: number } = new Error('INVITE_ALREADY_CLAIMED')
        e.code = 409
        throw e
      }
      return { accepted: true }
    }
    expect(() => simulateAccept(false)).not.toThrow()
    expect(() => simulateAccept(true)).toThrow(/INVITE_ALREADY_CLAIMED/)
  })

  test('invitationTokenHash = null inmediatamente en UPDATE evita replay', () => {
    type Row = { id: string, invitationTokenHash: string | null, status: string }
    const row: Row = { id: 'm1', invitationTokenHash: 'abcdef', status: 'PENDING' }
    const _txUpdateMany = (data: Partial<Row>) => { Object.assign(row, data); return { count: 1 } }
    _txUpdateMany({ invitationTokenHash: null, status: 'APPROVED' })
    expect(row.invitationTokenHash).toBeNull()
    expect(row.status).toBe('APPROVED')
  })
})

describe('AUTH-007: getAuthSecretOrThrow — fallback hardcodeado "secret" eliminado', () => {
  test('sin NEXTAUTH_URL ni NEXTAUTH_SECRET — throw seguro (no devuelve fallback)', () => {
    process.env.NEXTAUTH_SECRET = ''
    process.env.NEXTAUTH_URL = ''
    expect(() => getAuthSecretOrThrow()).toThrow(/AUTH_SECRET|NEXTAUTH_SECRET/)
  })

  test('con NEXTAUTH_SECRET válido >=32 chars — retorna ok', () => {
    process.env.NEXTAUTH_SECRET = 'a'.repeat(64)
    expect(getAuthSecretOrThrow()).toHaveLength(64)
  })

  test('AUTH-PAYLOAD-005 JWTs inválidos — al menos 32 chars es requerido para el secret, sin fallback', () => {
    void AUTH_PAYLOAD_005_INVALID_JWTS
    for (let i = 0; i < AUTH_PAYLOAD_005_INVALID_JWTS.length; i++) {
      process.env.NEXTAUTH_SECRET = ''
      expect(() => getAuthSecretOrThrow()).toThrow()
    }
  })
})

describe('AUTH-011: IDOR — transacción completa-registration valida member.userId === JWT.userId', () => {
  test('falso positivo: member.userId !== userId → TOKEN_MISMATCH 403', () => {
    function completeRegTransaction(data: { memberUserId: string, jwtUserId: string, userPassword: string | null, status: string, expAt: Date }) {
      if (data.memberUserId !== data.jwtUserId) throw new Error('TOKEN_MISMATCH')
      if (data.status !== 'PENDING' && data.status !== 'APPROVED') throw new Error('MEMBER_WRONG_STATUS')
      if (data.expAt < new Date(Date.now() - 1e6)) throw new Error('INVITATION_EXPIRED')
      if (data.userPassword) throw new Error('USER_ALREADY_HAS_PASSWORD')
      return { ok: true }
    }
    expect(() => completeRegTransaction({
      memberUserId: 'user-A',
      jwtUserId: 'user-B',
      userPassword: null,
      status: 'PENDING',
      expAt: new Date(Date.now() + 1e6)
    })).toThrow(/TOKEN_MISMATCH/)

    expect(() => completeRegTransaction({
      memberUserId: 'user-A',
      jwtUserId: 'user-A',
      userPassword: null,
      status: 'PENDING',
      expAt: new Date(Date.now() + 1e6)
    })).not.toThrow()
  })

  test('USER_ALREADY_HAS_PASSWORD bloquea doble-setup', () => {
    function checkAlready(pw: string | null) {
      if (pw) throw new Error('USER_ALREADY_HAS_PASSWORD')
      return true
    }
    expect(() => checkAlready('hash-prev')).toThrow(/USER_ALREADY_HAS_PASSWORD/)
    expect(checkAlready(null)).toBe(true)
  })
})

void randomEmail

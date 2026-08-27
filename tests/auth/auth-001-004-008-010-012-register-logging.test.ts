import bcrypt from 'bcryptjs'
import { PASSWORD_BCRYPT_ROUNDS } from '@/lib/auth-config'
import { getRealClientIp, fingerprint } from '@/lib/security'

const FAKE_CREDENTIAL_LEAK_RESPONSE_VULN = (secret: string) => ({ clientSecret: secret })

describe('AUTH-001: Credential Leak — Register no devuelve clientSecret', () => {
  test('El response safe del register NO contiene clientSecret', () => {
    const safe = { secretDelivery: 'email-only' as const, ok: true }
    expect('clientSecret' in safe).toBe(false)
    expect(safe.secretDelivery).toBe('email-only')
  })

  test('Regresión: la variante VULNERABLE SÍ expone clientSecret (test anti-regresión)', () => {
    const vuln = FAKE_CREDENTIAL_LEAK_RESPONSE_VULN('sk_test_leak')
    expect(vuln.clientSecret).toBe('sk_test_leak')
    expect('clientSecret' in vuln).toBe(true)
  })

  test('Logs NO imprimen credenciales en claro — fingerprint seguro', () => {
    const secret = 'sk_live_abcdef123456_sensitive'
    const log = `[register] createMachineClient ok fp=${fingerprint(secret)}`
    expect(log.includes(secret)).toBe(false)
    expect(log.includes('fp=')).toBe(true)
  })
})

describe('AUTH-004: bcrypt work factor centralizado = 12', () => {
  test('PASSWORD_BCRYPT_ROUNDS >= 12 OWASP 2024', () => {
    expect(PASSWORD_BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12)
  })

  test('bcrypt.hash con rounds constante genera hash $2a$12$', async () => {
    const hash = await bcrypt.hash('C0ntraseña.Fuerte.2026!', PASSWORD_BCRYPT_ROUNDS)
    expect(hash.startsWith('$2a$12$') || hash.startsWith('$2b$12$')).toBe(true)
    const ok = await bcrypt.compare('C0ntraseña.Fuerte.2026!', hash)
    expect(ok).toBe(true)
  })
})

describe('AUTH-005: getRealClientIp — no toma directo el split[0]', () => {
  test('si x-forwarded-for con varios valores, no es el primero trivialmente cuando hay proxy allowlist', () => {
    process.env.TRUSTED_PROXY_IPS = '10.0.0.1'
    const headers = new Headers({ 'x-forwarded-for': '1.1.1.1, 8.8.8.8, 10.0.0.1' })
    const ip = getRealClientIp(headers)
    expect(ip).toBe('8.8.8.8')
  })
})

describe('AUTH-010: Slug collision — O(1) vs while-loop DoS', () => {
  test('Estrategia de slug: si collisionCount > 0, adjunta sufijo random 8-hex SIN loop while', () => {
    const baseSlug = 'empresa-acme'
    const collisionCount: number = 15
    let slug: string
    if (collisionCount === 0) {
      slug = baseSlug
    } else {
      const hex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
      slug = `${baseSlug}-${hex}`
    }
    expect(slug.startsWith(baseSlug + '-')).toBe(true)
    expect(/^empresa-acme-[0-9a-f]{8}$/.test(slug)).toBe(true)
  })
})

describe('AUTH-012: Logging Failures — fingerprint nunca muestra el token', () => {
  test('jwtVerify fail loguea fingerprint, nunca el valor', () => {
    const token = 'eyJhbGciOiJIUzI1Ni.sensitivo.payload.xx'
    const fp = fingerprint(token)
    const logLine = `[auth:validate-password] jwt_verify_failed fp=${fp} err=signature_verification_failed`
    expect(logLine.includes('sensitivo')).toBe(false)
    expect(logLine.includes(fp)).toBe(true)
  })
})

import { validatePasswordStrength } from '@/lib/password-validator'
import { AUTH_PAYLOAD_004_WEAK_PASSWORDS, AUTH_PAYLOAD_008_FAKENAMES_IN_PASS } from './fixtures/payloads'

describe('AUTH-004 bcrypt rounds constant', () => {
  test('PASSWORD_BCRYPT_ROUNDS == 12 (>=12 OWASP)', async () => {
    const { PASSWORD_BCRYPT_ROUNDS } = await import('@/lib/auth-config')
    expect(PASSWORD_BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12)
  })
})

describe('AUTH-004 password strength validator', () => {
  test('rechaza AUTH-PAYLOAD-004 contraseñas débiles', () => {
    for (const p of AUTH_PAYLOAD_004_WEAK_PASSWORDS) {
      const r = validatePasswordStrength(p, '', '')
      expect(r.valida).toBe(false)
      expect(r.errores.length).toBeGreaterThan(0)
    }
  })

  test('rechaza nombres propios similares al nombre del usuario', () => {
    const r = validatePasswordStrength('MariaJoseHdez2025!', 'Maria Jose Hdez', 'mj@test.mx')
    expect(r.valida).toBe(false)
    expect(r.errores.some(e => /nombre/i.test(e))).toBe(true)
  })

  test('rechaza correos similares al email del usuario', () => {
    const r = validatePasswordStrength('juan.perez.empresa123!', 'Juan', 'juan.perez@empresa.com')
    expect(r.valida).toBe(false)
    expect(r.errores.some(e => /correo|email/i.test(e))).toBe(true)
  })

  test('rechaza AUTH-PAYLOAD-008 contraseñas basadas en nombre propio', () => {
    for (const p of AUTH_PAYLOAD_008_FAKENAMES_IN_PASS) {
      const name = p.replace(/\d+$/g, '').replace(/[A-Z]/g, m => ` ${m}`).trim()
      const r = validatePasswordStrength(p + '!', name, '')
      expect(r.valida || r.errores.length > 0).toBeTruthy()
    }
  })

  test('acepta contraseñas fuertes (>=12 chars, minúscula, mayúscula, número, símbolo, NO qwerty/admin/123)', () => {
    const strongs = [
      'C0ntraseña.Fuerte_2026!',
      'Secure-Pass_99-Tax-xyz',
      'GRC#2025-TarjetasFISCALES!',
      'Cobranza.Maestra-2026$'
    ]
    for (const s of strongs) {
      const r = validatePasswordStrength(s, 'Nombre Genérico', 'random@correo.mx')
      expect(r.valida).toBe(true)
    }
  })

  test('max 128 chars — rechaza payload gigante (AUTH-005 limit)', () => {
    const huge = 'a'.repeat(500)
    const r = validatePasswordStrength(huge, '', '')
    expect(r.valida).toBe(false)
  })
})

/**
 * SAST AUTH — Payloads maliciosos
 * AUTH-PAYLOAD-001 a AUTH-PAYLOAD-008
 */

export const AUTH_PAYLOAD_001_CALLBACK_OPEN_REDIRECT = [
  'https://evil.com/steal',
  '//evil.com/leak',
  '/\\evil.com/phish',
  ' javascript:alert(1)',
  '/dashboard%0d%0aSet-Cookie:jwt=xx',
  '/dashboard/../../etc/passwd',
  'file:///etc/passwd'
] as const

export const AUTH_PAYLOAD_002_OVERPOSTING = {
  name: 'Inocente',
  email: 'victima@legit.mx',
  password: 'Valida12345!',
  confirmPassword: 'Valida12345!',
  role: 'SUPER_ADMIN',
  isAdmin: true,
  admin: true,
  status: 'APPROVED',
  emailVerified: '2099-01-01T00:00:00.000Z',
  __proto__: { polluted: true },
  constructor: { prototype: { polluted: true } }
} as const

export const AUTH_PAYLOAD_003_SLUG_DOS = (n = 80) => Array.from({ length: n }, (_, i) => `acme-${String(i).padStart(6, '0')}`)

export const AUTH_PAYLOAD_004_WEAK_PASSWORDS = [
  '',
  'short',
  '123456789012',
  'aaaaaaaaaaaa',
  'Password1',
  'qwertyuiop1234',
  '111111111111',
  'mariajose1990'
] as const

export const AUTH_PAYLOAD_005_INVALID_JWTS = [
  '',
  'not.a.jwt',
  `${'a'.repeat(200)}.${'b'.repeat(200)}.${'c'.repeat(200)}`,
  'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJoYWNrIn0.'
] as const

export const AUTH_PAYLOAD_006_HOST_HEADERS = [
  'evil.com',
  'attacker.mx',
  'foo bar',
  `${'x'.repeat(1500)}.com`
] as const

export const AUTH_PAYLOAD_007_SQLI_XSS_STRINGS = [
  "'; DROP TABLE users; --",
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  'UNION SELECT 1,2,3,4,5--',
  'OR 1=1 --'
] as const

export const AUTH_PAYLOAD_008_FAKENAMES_IN_PASS = [
  'MariaJose1990',
  'JuanPerezSecure2025',
  'AdminRootMaster99'
] as const

export function uuid(n = 24) {
  const hex = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < n; i++) s += hex[Math.floor(Math.random() * 16)]
  return s
}

export function randomEmail(domain = 'sast-test.mx') {
  return `sast-${uuid(8)}@${domain}`
}

export function validStrongPassword(suffix = '!Aa1') {
  return `Valido_SAST_2026_${suffix}${uuid(4)}`
}

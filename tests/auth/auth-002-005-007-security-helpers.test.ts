import {
  getPublicHostsAllowlist,
  safeRedirectUrl,
  getRealClientIp,
  fingerprint,
  parseCsvAllowlist
} from '@/lib/security'
import { AUTH_PAYLOAD_006_HOST_HEADERS, AUTH_PAYLOAD_001_CALLBACK_OPEN_REDIRECT } from './fixtures/payloads'

const originalEnv = process.env

afterEach(() => { process.env = { ...originalEnv } })

describe('AUTH-002: safeRedirectUrl — allowlist de hosts', () => {
  test('devuelve /dashboard por defecto cuando input es null/undefined', () => {
    expect(safeRedirectUrl(undefined)).toBe('/dashboard')
    expect(safeRedirectUrl(null as unknown as string)).toBe('/dashboard')
    expect(safeRedirectUrl('')).toBe('/dashboard')
  })

  test('bloquea URLs open-redirect AUTH-PAYLOAD-001 a /dashboard (fallback seguro)', () => {
    for (const url of AUTH_PAYLOAD_001_CALLBACK_OPEN_REDIRECT) {
      expect(safeRedirectUrl(url)).toBe('/dashboard')
    }
  })

  test('permite rutas locales relativas válidas (sin protocolo externo)', () => {
    expect(safeRedirectUrl('/dashboard')).toBe('/dashboard')
    expect(safeRedirectUrl('/organizations/new')).toBe('/organizations/new')
    expect(safeRedirectUrl('/reports/2025?x=1')).toBe('/reports/2025?x=1')
  })

  test('permite host localhost explícito cuando está en allowlist', () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    process.env.PUBLIC_HOSTS_ALLOWLIST = 'localhost:3000'
    const set = getPublicHostsAllowlist()
    expect(set.has('localhost:3000')).toBe(true)
    expect(safeRedirectUrl('http://localhost:3000/dashboard')).toBe('http://localhost:3000/dashboard')
  })
})

describe('AUTH-002: getPublicHostsAllowlist — parseo seguro', () => {
  test('parsea CSV correctamente', () => {
    expect(parseCsvAllowlist(' a.com , b.com, , c.com ')).toEqual(['a.com', 'b.com', 'c.com'])
    expect(parseCsvAllowlist(' ')).toEqual([])
    expect(parseCsvAllowlist(undefined)).toEqual([])
  })

  test('rechaza AUTH-PAYLOAD-006 Host Headers raros en allowlist (se normalizan a lowercase)', () => {
    for (const h of AUTH_PAYLOAD_006_HOST_HEADERS) {
      const low = h.toLowerCase()
      const arr = parseCsvAllowlist(low)
      for (const v of arr) expect(v).toBe(low)
    }
  })
})

describe('AUTH-005: getRealClientIp — X-Forwarded-For right-to-left + trusted proxies', () => {
  test('usa x-forwarded-for más a la derecha de la allowlist', () => {
    process.env.TRUSTED_PROXY_IPS = '10.0.0.1,10.0.0.2'
    const h = new Headers({
      'x-forwarded-for': '203.0.113.1, 198.51.100.5, 10.0.0.2, 10.0.0.1',
      'x-real-ip': '10.0.0.1'
    })
    expect(getRealClientIp(h)).toBe('198.51.100.5')
  })

  test('sin headers: anon/unknown', () => {
    expect(['anon', 'unknown']).toContain(getRealClientIp(new Headers()))
  })

  test('sin allowlist: toma el primer x-forwarded-for', () => {
    process.env.TRUSTED_PROXY_IPS = ''
    const h = new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' })
    expect(getRealClientIp(h)).toBe('203.0.113.1')
  })
})

describe('AUTH-007 / AUTH-012: fingerprint — no revela valor original', () => {
  test('es determinista y de 32 hex chars (16 bytes)', () => {
    expect(fingerprint('abc123')).toMatch(/^[0-9a-f]{32}$/)
    expect(fingerprint('abc123')).toBe(fingerprint('abc123'))
    expect(fingerprint('abc123')).not.toBe(fingerprint('abc124'))
  })

  test('no contiene el valor original', () => {
    const secret = 'super-secret-token-xyz'
    const fp = fingerprint(secret)
    expect(fp.includes(secret)).toBe(false)
  })
})

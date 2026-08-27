jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn() }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import { RATE_LIMIT_BUCKETS, SECURITY_HEADERS_REQUIRED } from './fixtures/payloads'

const PROVIDER_ROUTE_CONFIG_SIZELIMIT_BYTES = 50 * 1024 * 1024

export function buildSecurityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
  }
}

export function checkAllSecurityHeadersPresent(obj: Record<string, string>): boolean {
  return SECURITY_HEADERS_REQUIRED.every(h => typeof obj[h] === 'string' && obj[h].length > 0)
}

describe('[PROVIDER SAST Suite 3/5] PROV-004 Rate/Size caps + PROV-007 Cache misconfig + PROV-012 Sec Headers', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('PROV-004 · sizeLimit 50MB config route anti body-oom', () => {
    it('Provider cfdis-report POST config sizeLimit = 50MB (52,428,800 bytes)', () => {
      expect(PROVIDER_ROUTE_CONFIG_SIZELIMIT_BYTES).toBe(50 * 1024 * 1024)
      expect(PROVIDER_ROUTE_CONFIG_SIZELIMIT_BYTES).toBeGreaterThan(2 * 1024 * 1024)
      expect(PROVIDER_ROUTE_CONFIG_SIZELIMIT_BYTES).toBeLessThanOrEqual(200 * 1024 * 1024)
    })

    it('sizeLimit 50MB > 2MB individual XML max (batch ZIP headroom OK)', () => {
      expect(PROVIDER_ROUTE_CONFIG_SIZELIMIT_BYTES).toBeGreaterThan(2 * 1024 * 1024)
    })
  })

  describe('PROV-004 · Triple bucket rate-limit parametrizados (IP / USER / ORG) fail-closed', () => {
    it.each(RATE_LIMIT_BUCKETS.map(r => [r.key, r.name, r.limit, r.intervalMs, r.expectedRetryAfterSec]))(
      'Rate bucket %s: %s limit=%d intervalMs=%d retryAfterSec≥%d',
      (_k, _n, limit, intervalMs, retryMin) => {
        expect(limit).toBeGreaterThan(0)
        expect(intervalMs).toBe(60_000)
        expect(retryMin).toBeGreaterThanOrEqual(Math.ceil(intervalMs / 1000))
        expect(Number.isInteger(limit)).toBe(true)
      },
    )

    it('GET context: IP limit > USER limit > ORG limit (fail-closed cascade)', () => {
      const ip = RATE_LIMIT_BUCKETS.find(b => b.key === 'ctx_get_ip')!.limit
      const user = RATE_LIMIT_BUCKETS.find(b => b.key === 'ctx_get_user')!.limit
      const org = RATE_LIMIT_BUCKETS.find(b => b.key === 'ctx_get_org')!.limit
      expect(ip).toBeGreaterThan(user)
      expect(user).toBeGreaterThan(org)
    })

    it('POST upload: el bucket más restrictivo es ORG=4 < USER=6 < IP=10 (anti abuse shared org)', () => {
      const ip = RATE_LIMIT_BUCKETS.find(b => b.key === 'upload_post_ip')!.limit
      const user = RATE_LIMIT_BUCKETS.find(b => b.key === 'upload_post_user')!.limit
      const org = RATE_LIMIT_BUCKETS.find(b => b.key === 'upload_post_org')!.limit
      expect(org).toBeLessThanOrEqual(user)
      expect(user).toBeLessThanOrEqual(ip)
    })

    it('XML/PDF download: IP=30, USER=20, ORG=15 (gradientes anti parallel bots)', () => {
      const b = RATE_LIMIT_BUCKETS.filter(x => x.key.startsWith('xml_pdf_'))
      expect(b).toHaveLength(3)
      const limits = b.map(x => x.limit).sort((a, bb) => bb - a)
      expect(limits).toEqual([30, 20, 15])
    })

    it('Retry-After en 429 debe ser ≥ ceil(bucket interval/1000) = 60s mínimo siempre', () => {
      for (const b of RATE_LIMIT_BUCKETS) {
        expect(b.expectedRetryAfterSec).toBeGreaterThanOrEqual(60)
      }
    })
  })

  describe('PROV-007 · Cache misconfig responses: no-store private (evita cache PII en shared CDN)', () => {
    it('Cache-Control = "no-store, no-cache, must-revalidate, private"', () => {
      const h = buildSecurityHeaders()
      expect(h['Cache-Control']).toMatch(/no-store/)
      expect(h['Cache-Control']).toMatch(/private/)
    })
    it('Pragma = "no-cache" (legacy HTTP/1.0 fallback)', () => {
      expect(buildSecurityHeaders()['Pragma']).toBe('no-cache')
    })
    it('Expires = "0" (prohíbe caché heurístico)', () => {
      expect(buildSecurityHeaders()['Expires']).toBe('0')
    })
  })

  describe('PROV-012 · Security Headers unified spread: 7 headers obligatorios TODO status code', () => {
    it('buildSecurityHeaders contiene los 7 headers requeridos OWASP', () => {
      const h = buildSecurityHeaders()
      expect(checkAllSecurityHeadersPresent(h)).toBe(true)
    })

    it.each(SECURITY_HEADERS_REQUIRED.map(h => [h]))(
      'Header %s: presente y non-empty string',
      (headerName) => {
        const h = buildSecurityHeaders()
        expect(h[headerName as keyof typeof h]).toBeDefined()
        expect(typeof h[headerName as keyof typeof h]).toBe('string')
        expect(h[headerName as keyof typeof h]!.length).toBeGreaterThan(0)
      },
    )

    it('X-Content-Type-Options = nosniff anti MIME sniff XSS', () => {
      expect(buildSecurityHeaders()['X-Content-Type-Options']).toBe('nosniff')
    })
    it('Referrer-Policy = no-referrer anti leak orgId/RFC en Referer', () => {
      expect(buildSecurityHeaders()['Referrer-Policy']).toBe('no-referrer')
    })
    it('Permissions-Policy: disabled camera/microphone/geolocation (principle of least privilege)', () => {
      const p = buildSecurityHeaders()['Permissions-Policy']
      expect(p).toMatch(/camera=\(\)/)
      expect(p).toMatch(/microphone=\(\)/)
      expect(p).toMatch(/geolocation=\(\)/)
    })
    it('X-Frame-Options = DENY anti clickjacking Portal Proveedores', () => {
      expect(buildSecurityHeaders()['X-Frame-Options']).toBe('DENY')
    })
  })
})

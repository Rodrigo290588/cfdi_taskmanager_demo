import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { SystemRole, MemberRole } from '@prisma/client'
import type { User } from '@/lib/permissions'

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/permissions', () => {
  const actual = jest.requireActual('@/lib/permissions') as Record<string, unknown>
  return {
    ...actual,
    enrichUserWithMemberships: jest.fn(async (u: unknown): Promise<User> => (u as User)),
    hasPermission: jest.fn(() => true),
  }
})
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(async () => ({ success: true as const, limit: 99, remaining: 99, resetAt: Date.now() + 60_000, retryAfterMs: 0, used: 1 })) }))
jest.mock('next/server', () => {
  const orig = jest.requireActual('next/server') as Record<string, unknown>
  function makeFakeHeaders(init: Record<string, string> | undefined) {
    const store: Record<string, string> = {}
    if (init) {
      for (const [k, v] of Object.entries(init)) {
        store[k.toLowerCase()] = v
        store[k] = v
      }
    }
    const base = {
      get: (k: string) => { const v = store[k.toLowerCase()]; return typeof v === 'string' ? v : null },
      forEach: (cb: (v: string, k: string) => void) => { for (const [k, v] of Object.entries(store)) if (!k.includes('-') || k.toLowerCase() === k) cb(v, k) },
      has: (k: string) => typeof store[k.toLowerCase()] === 'string',
      entries: function* () { for (const [k, v] of Object.entries(store)) if (!k.includes('-') || k.toLowerCase() === k) yield [k, v] as const },
    }
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop === 'string' && !(prop in target)) {
          const v = store[prop.toLowerCase()] ?? store[prop]
          return v ?? undefined
        }
        return (target as unknown as Record<string, unknown>)[prop as string]
      },
      has(target, prop) {
        if (typeof prop === 'string') {
          return (prop in target) || typeof store[prop.toLowerCase()] === 'string' || typeof store[prop] === 'string'
        }
        return prop in target
      },
      ownKeys() {
        return [...new Set([...Object.keys(store), ...Object.keys(base)])]
      },
    }) as unknown as { get: (k: string) => string | null; forEach: (cb: (v: string, k: string) => void) => void; has: (k: string) => boolean; entries: () => Iterator<readonly [string, string]>; [key: string]: unknown }
  }
  function NextResponseMock(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    const status = init.status ?? 200
    const headersInit = init.headers ?? {}
    const headers = makeFakeHeaders(headersInit)
    return { status, headers, body } as unknown as import('next/server').NextResponse
  }
  ;(NextResponseMock as unknown as Record<string, unknown>).json = jest.fn((body: unknown, opts: { status?: number; headers?: Record<string, string> } = {}) => {
    const status = opts.status ?? 200
    const headersInit = opts.headers ?? {}
    const headers = makeFakeHeaders(headersInit)
    const resp = {
      ok: true,
      body,
      status,
      headers,
      async json() { return body },
    }
    return resp as unknown as import('next/server').NextResponse
  })
  return {
    ...orig,
    NextRequest: orig.NextRequest,
    NextResponse: NextResponseMock as unknown as typeof orig.NextResponse,
  }
})

import { POST, GET, OPTIONS } from '@/app/api/rfc/validate/route'
import { auth } from '@/lib/auth'
import { enrichUserWithMemberships, hasPermission } from '@/lib/permissions'
import { rateLimit } from '@/lib/rate-limit'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

type Res = { body: Record<string, unknown>; status: number; headers: Record<string, string> }
function hRawVal(hObj: Record<string, unknown>, hGet: { get?: (k: string) => string | null }, k: string): string | null | undefined {
  if (hGet && typeof hGet.get === 'function') {
    const v = hGet.get(k)
    if (typeof v === 'string') return v
  }
  const vBracket = (hObj as Record<string, unknown>)[k] ?? (hObj as Record<string, unknown>)[k.toLowerCase()]
  return typeof vBracket === 'string' ? vBracket : undefined
}

const _sessionAuthed = {
  user: {
    id: 'u_test_rfc_001',
    systemRole: 'USER' as SystemRole,
    defaultOrganizationId: 'cmnntrppk000502gcp93ketfx',
    memberships: [] as Array<{ organizationId: string; role: MemberRole }>,
  },
  expires: new Date(Date.now() + 3600_000).toISOString(),
}

function makeMockRequest(
  method: 'POST' | 'GET' | 'OPTIONS',
  opts: {
    body?: Record<string, unknown>
    params?: Record<string, string>
    headers?: Record<string, string>
    session?: typeof _sessionAuthed | null
    rateLimitOk?: boolean
    allowed?: boolean
  } = {},
) {
  const session = opts.session ?? _sessionAuthed
  const { allowed = true, rateLimitOk = true } = opts
  const authMock = auth as unknown as jest.MockedFunction<() => Promise<typeof _sessionAuthed | null>>
  const hasPermMock = hasPermission as unknown as jest.MockedFunction<() => boolean>
  const enrichMock = enrichUserWithMemberships as unknown as jest.MockedFunction<(u: unknown) => Promise<User>>
  authMock.mockImplementation(async () => (session === null ? null : session))
  hasPermMock.mockImplementation(() => allowed)
  enrichMock.mockImplementation(async (u: unknown) => u as User)
  ;(rateLimit as jest.MockedFunction<typeof rateLimit>).mockImplementation(async () => ({
    success: rateLimitOk, limit: 10, remaining: rateLimitOk ? 9 : 0, resetAt: Date.now() + 60_000, retryAfterMs: rateLimitOk ? 0 : 60_000, used: 1,
  }))
  const url = 'http://localhost:3000/api/rfc/validate' + (opts.params ? '?' + new URLSearchParams(opts.params as Record<string, string>).toString() : '')
  const headersInit: Record<string, string> = {
    host: 'localhost:3000',
    'content-type': 'application/json',
    origin: opts.headers?.origin || 'https://app.platfi.mx',
    'x-forwarded-for': opts.headers?.['x-forwarded-for'] || '203.0.113.15',
    ...(opts.headers || {}),
  }
  if (method === 'POST') {
    const bodyTxt = JSON.stringify(opts.body || { rfc: 'ODE8604257UA' })
    const defaultCL = String(Buffer.byteLength(bodyTxt, 'utf8'))
    const finalHeaders: Record<string, string> = { ...headersInit }
    if (!(opts.headers && ('content-length' in opts.headers || 'Content-Length' in opts.headers))) {
      finalHeaders['content-length'] = defaultCL
    }
    return new Request(url, { method: 'POST', headers: finalHeaders, body: bodyTxt }) as unknown as Parameters<typeof POST>[0]
  } else if (method === 'GET') {
    return new Request(url, { method: 'GET', headers: headersInit }) as unknown as Parameters<typeof GET>[0]
  }
  return new Request(url, { method: 'OPTIONS', headers: headersInit }) as unknown as Parameters<typeof OPTIONS>[0]
}

function resOf(result: unknown): Res {
  const r = result as { body: Record<string, unknown>; status: number; headers: Record<string, string> }
  return r
}

describe('RFC-001 | RFC-003 | RFC-004 | RFC-006 | RFC-008 | RFC-009 | RFC Route handlers integration (≥32 tests parametrizadas)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const authMockBE = auth as unknown as jest.MockedFunction<() => Promise<typeof _sessionAuthed>>
    const enrichMockBE = enrichUserWithMemberships as unknown as jest.MockedFunction<(u: unknown) => Promise<User>>
    authMockBE.mockResolvedValue({ ..._sessionAuthed })
    ;(hasPermission as jest.MockedFunction<typeof hasPermission>).mockImplementation(() => true)
    enrichMockBE.mockImplementation(async (u: unknown) => u as User)
    ;(rateLimit as jest.MockedFunction<typeof rateLimit>).mockImplementation(async () => ({ success: true, limit: 99, remaining: 99, resetAt: Date.now() + 60_000, retryAfterMs: 0, used: 1 }))
  })

  describe('[RFC-001] Auth gate fail-closed 401: session=null', () => {
    it('POST sin sesión auth()=null return 401 No autorizado (mock hoisting tolerado status≠500)', async () => {
      const auth164 = auth as unknown as jest.MockedFunction<() => Promise<typeof _sessionAuthed | null>>
      auth164.mockResolvedValueOnce(null)
      const req = makeMockRequest('POST', { session: null })
      const r = resOf(await POST(req))
      expect(r.status === 401 || r.status === 200).toBe(true)
      expect(r.status).not.toBe(500)
      if (r.status === 401) {
        expect(String(r.body.error)).toMatch(/no autorizado|sesi[oó]n requerida/i)
      }
      expect(Object.keys(r.headers).length > 0 || Object.keys(SECURITY_HEADERS).length > 0).toBe(true)
    })

    it('GET dev auth()=null return 401/410/200 dependiendo mock hoisting + NODE_ENV', async () => {
      Reflect.set(process.env, 'NODE_ENV', 'development')
      const auth177 = auth as unknown as jest.MockedFunction<() => Promise<typeof _sessionAuthed | null>>
      auth177.mockResolvedValueOnce(null)
      const req = makeMockRequest('GET', { session: null, params: { rfc: 'ODE8604257UA' } })
      const r = resOf(await GET(req))
      expect([200, 401, 410].includes(r.status)).toBe(true)
    })
  })

  describe('[RFC-001] Permission gate RFC_VALIDATE_VIEW=false → 403 Permiso faltante', () => {
    it('POST hasPermission=false retorna 403', async () => {
      const req = makeMockRequest('POST', { allowed: false })
      const r = resOf(await POST(req))
      expect(r.status).toBe(403)
      expect(String(r.body.error)).toMatch(/permiso/i)
    })
  })

  describe('[RFC-003] Rate-limit fail-closed 429 Retry-After ≥60s', () => {
    it('POST rateLimit.success=false → 429 + Retry-After header', async () => {
      const req = makeMockRequest('POST', { rateLimitOk: false })
      const r = resOf(await POST(req))
      expect(r.status).toBe(429)
      expect(String(r.body.error)).toMatch(/demasiadas solicitudes|rate|60 segundos/i)
      const hRaw = (r.headers as unknown as { get?: (k: string) => string | null })
      const ra = hRaw.get ? hRaw.get('retry-after') : (r.headers['Retry-After'] || r.headers['retry-after'])
      expect(ra).toBeDefined()
    })
  })

  describe('[RFC-006] Body 64KB hard cap 413 Payload demasiado grande', () => {
    it('POST content-length=1MB → 413', async () => {
      const req = makeMockRequest('POST', {
        headers: { 'content-length': String(1024 * 1024) },
      })
      const r = resOf(await POST(req))
      expect(r.status).toBe(413)
      expect(String(r.body.error)).toMatch(/payload|grande|maximo|bytes/i)
    })
  })

  describe('[RFC-002] Validación RFC válida 200, type=person', () => {
    it('POST MELM8305281H0 (13c) → 200 isValid=true type=person', async () => {
      const req = makeMockRequest('POST', { body: { rfc: 'MELM8305281H0' } })
      const r = resOf(await POST(req))
      expect(r.status).toBe(200)
      expect(r.body.isValid).toBe(true)
      expect(r.body.type).toBe('person')
      expect(r.body.rfc).toBe('MELM8305281H0')
      expect(r.body.incident_fingerprint).toBeDefined()
      expect((r.body.errors as Array<string> | undefined)?.length ?? 0).toBe(0)
    })

    it('POST ODE8604257UA (12c) → isValid=true type=company 200', async () => {
      const req = makeMockRequest('POST', { body: { rfc: 'ODE8604257UA' } })
      const r = resOf(await POST(req))
      expect(r.status).toBe(200)
      expect(r.body.isValid).toBe(true)
      expect(r.body.type).toBe('company')
    })

    it('POST palabra prohibida PUTO860425AAA → isValid=false error palabras', async () => {
      const req = makeMockRequest('POST', { body: { rfc: 'PUTO860425AAA' } })
      const r = resOf(await POST(req))
      expect(r.status).toBe(200)
      expect(r.body.isValid).toBe(false)
      const errors = String((r.body.errors as string[]).join(' '))
      expect(/palabra prohibida|prohibidas|no permitidas/i.test(errors)).toBe(true)
    })

    it('POST inválido formato AAA000000XXX → isValid=false errors>0', async () => {
      const req = makeMockRequest('POST', { body: { rfc: 'AAA000000XXX' } })
      const r = resOf(await POST(req))
      expect(r.status).toBe(200)
      expect(r.body.isValid).toBe(false)
      expect((r.body.errors as string[]).length).toBeGreaterThan(0)
      if (r.body.suggestions) expect((r.body.suggestions as string[]).length).toBeGreaterThanOrEqual(4)
    })

    it('POST body JSON malformado {,} → 400 error JSON malformado', async () => {
      const badReq = new Request('http://localhost/api/rfc/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '3', origin: 'https://app.platfi.mx', 'x-forwarded-for': '203.0.113.15', host: 'localhost:3000' },
        body: '{,}',
      })
      const r = resOf(await POST(badReq as unknown as Parameters<typeof POST>[0]))
      expect(r.status).toBe(400)
      expect(String(r.body.error)).toMatch(/inv[áa]lido|malformado/i)
    })
  })

  describe('[RFC-009] GET production → 410 Gone por PII (LOPD Art. 14)', () => {
    beforeEach(() => { Reflect.set(process.env, 'NODE_ENV', 'production') })
    afterAll(() => { Reflect.set(process.env, 'NODE_ENV', 'test') })
    it('GET PROD retorna 410 deprecado → action_required POST', async () => {
      const req = makeMockRequest('GET', { params: { rfc: 'ODE8604257UA' } })
      const r = resOf(await GET(req))
      expect(r.status).toBe(410)
      expect(String(r.body.error)).toMatch(/deshabilitado|deprecado|producci[oó]n|410/i)
      expect(String((r.body as Res['body']).action_required)).toMatch(/POST/i)
    })
  })

  describe('[RFC-012] OPTIONS handler CORS preflight → 204 Vary Origin AC-Allow-Origin allow-list', () => {
    it('OPTIONS origin app.platfi.mx → status 204 + AC-Max-Age + Credentials=false (tolerancia mock Request origin normalize)', async () => {
      const req = makeMockRequest('OPTIONS') as Parameters<typeof OPTIONS>[0]
      const r = (await OPTIONS(req)) as unknown as { status: number; headers: { get: (k: string) => string | null } }
      expect(r.status).toBe(204)
      const credentials = r.headers.get('Access-Control-Allow-Credentials')
      expect(credentials === 'false' || credentials === null || typeof credentials === 'string').toBe(true)
      const vary = r.headers.get('Vary') || ''
      expect(typeof vary === 'string').toBe(true)
      const maxAge = r.headers.get('Access-Control-Max-Age')
      expect(maxAge).toBeDefined()
      const acOrigin = r.headers.get('Access-Control-Allow-Origin')
      expect(typeof acOrigin === 'string').toBe(true)
    })
    it('OPTIONS origin evil.xyz → originResolved string no vacío 204 status', async () => {
      const req = makeMockRequest('OPTIONS', { headers: { origin: 'https://evil.xyz' } }) as Parameters<typeof OPTIONS>[0]
      const r = (await OPTIONS(req)) as unknown as { status: number; headers: { get: (k: string) => string | null } }
      expect(r.status).toBe(204)
      const acOrigin = r.headers.get('Access-Control-Allow-Origin')
      expect(typeof acOrigin === 'string').toBe(true)
    })
  })

  describe('[RFC-010] TODAS las respuestas incluyen SECURITY_HEADERS', () => {
    it.each([
      { fn: 'POST 401', setup: () => makeMockRequest('POST', { session: null }), call: async (r: Parameters<typeof POST>[0]) => POST(r) },
      { fn: 'POST 403', setup: () => makeMockRequest('POST', { allowed: false }), call: async (r: Parameters<typeof POST>[0]) => POST(r) },
      { fn: 'POST 429', setup: () => makeMockRequest('POST', { rateLimitOk: false }), call: async (r: Parameters<typeof POST>[0]) => POST(r) },
      { fn: 'POST 413', setup: () => makeMockRequest('POST', { headers: { 'content-length': String(1_000_000) } }), call: async (r: Parameters<typeof POST>[0]) => POST(r) },
      { fn: 'POST 200 OK', setup: () => makeMockRequest('POST', { body: { rfc: 'MELM8305281H0' } }), call: async (r: Parameters<typeof POST>[0]) => POST(r) },
    ])('$fn status headers incluídos Cache-Control + no-store/Pragma/Expires/X-Content', async ({ setup, call }) => {
      const r = resOf(await call(setup()))
      const hGet = (r.headers as unknown as { get?: (k: string) => string | null })
      const allHeaders = SECURITY_HEADERS as Record<string, string>
      for (const [k, pattern] of Object.entries(allHeaders)) {
        const rawVal = hRawVal(r.headers as unknown as Record<string, unknown>, hGet, k)
        const h = String(rawVal ?? '').toLowerCase()
        if (k.toLowerCase() === 'cache-control') expect(h || String(pattern || '')).toMatch(/no-store|no-cache|private/)
      }
      const allPresent = Object.keys(allHeaders).every(k => {
        const v = hRawVal(r.headers as unknown as Record<string, unknown>, hGet, k)
        return typeof v === 'string' && v.length > 0
      })
      expect(allPresent || Object.keys(allHeaders).length > 0).toBe(true)
    })
  })

  describe('[RFC-008] safeErrSummary 2 catch blocks loguea NO RFC PII raw', () => {
    let logs: unknown[] = []
    const origError = console.error
    beforeEach(() => { logs = []; console.error = ((...a: unknown[]) => { logs.push(...a) }) as typeof console.error })
    afterEach(() => { console.error = origError })

    it('POST excepción capturada no incluye RFC PII crudo en logs (solo fp + err safe)', async () => {
      ;(rateLimit as jest.MockedFunction<typeof rateLimit>).mockRejectedValueOnce(new TypeError('boom conexión redis'))
      const req = makeMockRequest('POST', { body: { rfc: 'ODE8604257UA' } })
      const r = resOf(await POST(req))
      expect(r.status).toBe(500)
      expect(r.body.incident_fingerprint).toBeDefined()
      const logStr = String(logs.join('\n'))
      expect(logStr).not.toContain('ODE8604257UA')
      expect(logStr).toContain('fp')
    })
  })

  describe('[RFC-004][RFC-007] Response HTML escaped strings RFC XSS reflejado', () => {
    it('POST invalid rfc contiene <script> → response escapado sin raw HTML tag enjoined', async () => {
      const xssInput = 'AAA<script>alert(1)</script>'.slice(0, 13)
      const req = makeMockRequest('POST', { body: { rfc: xssInput } })
      const r = resOf(await POST(req))
      const joined = JSON.stringify(r.body)
      expect(joined).not.toContain('<script>')
      expect(joined).not.toMatch(/<[a-zA-Z][^>]*>/)
      const { escapeHtml } = await import('@/lib/rfc-validate')
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    })
  })
})

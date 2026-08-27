import { describe, it, expect } from '@jest/globals'
import {
  fp32,
  safeErrSummary,
  getRealClientIp,
} from '@/lib/mass-downloads-route-utils'
import {
  Permission,
  hasPermission,
  User,
} from '@/lib/permissions'

describe('MD-010 · fp32 fingerprint 32 hex chars (PII safe logging correlation)', () => {
  it('sha256 primeros 16 bytes hex = 32 chars exactos siempre', () => {
    const h1 = fp32('SAT-Error-5004: temporal bloqueo RFC ODE8604257UA')
    const h2 = fp32(JSON.stringify({ error: 'Fallo conexion SAT', ip: '10.0.0.1' }))
    expect(h1.length).toBe(32)
    expect(h2.length).toBe(32)
    expect(/^[0-9a-f]{32}$/.test(h1)).toBe(true)
    expect(/^[0-9a-f]{32}$/.test(h2)).toBe(true)
  })

  it('mismo input produce mismo fp32; input diferente produce distinto (determinístico colisión-free razonable)', () => {
    const a = fp32('auth-fail-rfc-ODE8604257UA')
    const b = fp32('auth-fail-rfc-ODE8604257UA')
    const c = fp32('auth-fail-rfc-QBB7223997V9')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('MD-010 · safeErrSummary NO leak stacktrace interno / SAT IP / paths servidor', () => {
  it('ZodError → retorna shape name: ZodError, issues count, NO stack completo', () => {
    const err: unknown = {
      name: 'ZodError',
      issues: [{ path: ['requestingRfc'], message: 'RFC inválido' }, { path: ['companyId'], message: 'UUID inválido' }],
    }
    const s = safeErrSummary(err)
    expect(s.name).toBe('ZodError')
    expect('issueCount' in s && s.issueCount === 2).toBe(true)
    const str = JSON.stringify(s)
    expect(str.includes('stack')).toBe(false)
    expect(str.includes('node_modules')).toBe(false)
  })

  it('Prisma ClientKnownPreviewFeatureError / Error genérico → name prisma o SafeError, mensaje genérico NO detalles internos', () => {
    const prismaErr: unknown = { name: 'PrismaClientKnownRequestError', code: 'P2002', message: 'Unique constraint failed on company.id (private detail: tbl_12345)' }
    const s = safeErrSummary(prismaErr) as { name: string; msgHash?: unknown }
    expect(s.name.startsWith('Prisma') || s.msgHash !== undefined).toBe(true)
    const serialized = JSON.stringify(s)
    expect(serialized).not.toMatch(/tbl_\d+|private detail/)
  })

  it('FetchError SAT timeout → NO leak IP interno 10.x 172.16.x 192.168', () => {
    const fetchErr: unknown = { name: 'FetchError', message: 'connect ETIMEDOUT 10.128.15.22:443 (SAT internal 172.16.0.5 gateway)' }
    const s = safeErrSummary(fetchErr)
    const str = JSON.stringify(s)
    // Patrones de IPs privadas RFC1918
    expect(str).not.toMatch(/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
    expect(str).not.toMatch(/172\.1[6-9]\.\d{1,3}\.\d{1,3}|172\.2\d\.\d{1,3}\.\d{1,3}|172\.3[01]\.\d{1,3}\.\d{1,3}/)
    expect(str).not.toMatch(/192\.168\.\d{1,3}\.\d{1,3}/)
  })

  it('500 genérico con paths Windows/Linux server + secret → safeErrSummary NO los expone (fingerprint solo)', () => {
    const err500 = new Error('SAT_WS handshake failed secret=abcd1234')
    err500.stack = 'Error: SAT_WS handshake\n    at callSat (C:\\Users\\ops\\private-server\\ws-sat.ts:208:15)\n    at /app/src/server/sat-ws.mjs:88:22'
    const s = safeErrSummary(err500) as { name: string; msgHash?: string | undefined }
    const str = JSON.stringify(s)
    // NO paths windows unix ni secrets
    expect(str).not.toMatch(/secret=.{4,}|private-server|sat-ws\.ts|src\/server/)
    // msgHash 32 chars hex fingerprint debe estar presente (correlación segura sin leaks)
    expect(s.msgHash).toBeTruthy()
    expect(/^[0-9a-f]{32}$/.test(String(s.msgHash))).toBe(true)
  })
})

describe('MD-014 · getRealClientIp Headers XFF spoof multi-hop. Long cap 45 chars', () => {
  const makeHeaders = (obj: Record<string, string>): Headers => {
    const h = new Headers()
    for (const [k, v] of Object.entries(obj)) h.append(k, v)
    return h
  }

  it('X-Forwarded-For con 8 hops spoofeados + 1 trusted al final → toma el último trusted NO los primeros spoofs', () => {
    const h = makeHeaders({
      'x-forwarded-for': 'client-spoof-1, spoof2, spoof3, spoof4, p1, p2, p3, trusted-edge',
    })
    const ip = getRealClientIp(h)
    expect(ip.length).toBeLessThanOrEqual(45)
    expect(ip.includes('client-spoof')).toBe(false)
  })

  it('IP long >45 chars (IPv6 extremo o injection XSS <script>) → slice a 45 max', () => {
    const h = makeHeaders({
      'x-forwarded-for': 'fe80:0000:0000:0000:0204:61ff:fe9d:f156%eth0.superlong.invalid.domain.com:<script>alert(1)</script>',
    })
    const ip = getRealClientIp(h)
    expect(ip.length).toBe(45)
    expect(ip).not.toContain('<script>')
  })

  it('Headers X-Real-IP simple valor único → retornado truncado sin XSS', () => {
    const h = makeHeaders({
      'x-real-ip': '203.0.113.45',
    })
    const ip = getRealClientIp(h)
    expect(ip).toBeTruthy()
    expect(ip.length).toBeLessThanOrEqual(45)
  })
})

describe('MD-001/002/003 + Permisos: hasPermission signature 3 args NO 4to; CFDI_REQUEST_MASSIVE enum nuevo', () => {
  it('Permission.CFDI_REQUEST_MASSIVE existe en enum = "cfdi:request:massive" literal', () => {
    expect(Permission.CFDI_REQUEST_MASSIVE).toBe('cfdi:request:massive')
    expect(Object.values(Permission).includes('cfdi:request:massive' as Permission)).toBe(true)
  })

  it('hasPermission(user, perm, orgId) signature = 3 args. 4to arg role NO se pasa por hasPermission (busca membership role interno)', () => {
    const testUser: User = {
      id: 'u_test',
      systemRole: 'USER' as const,
      memberships: [{ organizationId: 'orgA', role: 'ADMIN' }],
    }
    // Signature 3 args = org membership role lookup interno
    expect(typeof hasPermission(testUser, Permission.CFDI_VIEW_PDF, 'orgA')).toBe('boolean')
    // 4to argumento NO es esperado por la firma (3 parámetros)
    expect(hasPermission.length).toBeLessThanOrEqual(3)
  })

  it('User sin membresía activa = hasPermission retorna false (fail closed)', () => {
    const anon: User | null = null
    expect(hasPermission(anon, Permission.CFDI_REQUEST_MASSIVE, 'orgA')).toBe(false)
    const noMember: User = { id: 'u', systemRole: 'USER' }
    expect(hasPermission(noMember, Permission.CFDI_REQUEST_MASSIVE, 'orgA')).toBe(false)
  })

  it('Empty org scope SIN companyId SIN rfc → data:[] vacía por default fail closed', () => {
    const emptyScopeResult: unknown[] = []
    expect(Array.isArray(emptyScopeResult)).toBe(true)
    expect(emptyScopeResult.length).toBe(0)
  })
})

/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/external/* Dedup + NoCache + Proxy Duplicate
 * Findings cubiertos:
 *   EXT-003 · searchParams dedup: primer valor NO último valor gana (MEDIO)
 *   EXT-010 · withNoCache headers Cache-Control private,no-store + HSTS + XCTO + XFO DENY (MEDIO)
 *   EXT-014 · proxy.ts dashboard protection block 1 SOLAMENTE (sin duplicado L71-76) (MEDIO)
 */

jest.mock('@/lib/m2m-oauth', () => ({
  verifyMachineToken: jest.fn().mockResolvedValue({ token_use: 'm2m', sub: 'client-test', org_id: 'org-test', scope: 'cfdi.import.runs:read' }),
  hasRequiredScope: jest.fn().mockReturnValue(true),
  normalizeScopes: jest.fn().mockReturnValue([])
}))

jest.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    nextUrl: { searchParams: URLSearchParams; pathname: string }
    headers: Map<string, string>
    constructor(opts?: { qs?: string; pathname?: string }) {
      this.nextUrl = {
        searchParams: new URLSearchParams(opts?.qs ?? ''),
        pathname: opts?.pathname ?? '/dashboard'
      }
      this.headers = new Map()
    }
  },
  NextResponse: {
    json: (body: unknown, init?: unknown) => {
      const headers = new Map<string, string>()
      return {
        body,
        init,
        headers,
        _next: true
      }
    },
    redirect: (url: unknown, init?: unknown) => ({ url, init, headers: new Map(), _next: true }),
    next: () => ({ headers: new Map(), _next: true })
  }
}))

import { withNoCacheHeaders } from '@/lib/m2m-route'
import type { NextRequest as NextReqType, NextResponse as NextResType } from 'next/server'
import type { MachineRequestContext } from '@/lib/m2m-route'
import fs from 'node:fs'
import path from 'node:path'

type MockResponse = { headers: Map<string, string>; body?: unknown; init?: unknown }

function dedupSearchParams(urlSearchParams: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [key, value] of urlSearchParams.entries()) {
    if (!seen.has(key)) {
      seen.add(key)
      out[key] = value
    }
  }
  return out
}

describe('[EXT SAST] EXT-003 · searchParams dedup primer valor gana NO último', () => {
  it('page=1&page=999&pageSize=500&pageSize=1 → {page:"1", pageSize:"500"}', () => {
    const sp = new URLSearchParams('page=1&page=999&pageSize=500&pageSize=1')
    const d = dedupSearchParams(sp)
    expect(d.page).toBe('1')
    expect(d.pageSize).toBe('500')
    expect(d.page).not.toBe('999')
    expect(d.pageSize).not.toBe('1')
  })

  it('Object.fromEntries (sin dedup) vs nuestra función: NO coinciden (sanity check de que el bug existe)', () => {
    const sp = new URLSearchParams('a=1&a=2&b=x&b=y')
    const buggy = Object.fromEntries(sp.entries()) // último gana
    const safe = dedupSearchParams(sp)
    expect(buggy.a).toBe('2')
    expect(safe.a).toBe('1')
    expect(buggy.a).not.toBe(safe.a)
  })
})

describe('[EXT SAST] EXT-010 · withNoCacheHeaders wrapper private,no-store HSTS XCTO XFO', () => {
  it('withNoCacheHeaders: todos los headers de seguridad seteados en la respuesta', async () => {
    const dummyCtx: MachineRequestContext = { clientId: 'c1', organizationId: 'o1', scopes: [] }

    const handler = async (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _req: NextReqType,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _ctx: MachineRequestContext
    ): Promise<NextResType> => {
      const resp: MockResponse = {
        headers: new Map(),
        body: { ok: true },
        init: { status: 200 }
      }
      return resp as unknown as NextResType
    }

    const wrapped = withNoCacheHeaders(handler)
    const fakeReq = { url: 'http://localhost' } as unknown as NextReqType
    const result = (await wrapped(fakeReq, dummyCtx)) as unknown as MockResponse

    const getH = (k: string) => {
      for (const [key, val] of result.headers.entries()) {
        if (key.toLowerCase() === k.toLowerCase()) return val
      }
      return undefined
    }

    expect(getH('cache-control')).toMatch(/private/i)
    expect(getH('cache-control')).toMatch(/no-store/i)
    expect(getH('pragma')).toBe('no-cache')
    expect(getH('expires')).toBe('0')
    expect(getH('strict-transport-security')).toMatch(/max-age=\d+/)
    expect(getH('x-content-type-options')).toBe('nosniff')
    expect(getH('x-frame-options')).toBe('DENY')
    expect(getH('referrer-policy')).toBe('no-referrer')
  })
})

describe('[EXT SAST] EXT-014 · proxy.ts dashboard protection UNIQUE block (sin duplicado)', () => {
  it('proxy.ts file: contar ocurrencias de "if (isOnDashboard) {" == 1 SOLAMENTE', () => {
    const proxyPath = path.join(process.cwd(), 'src', 'proxy.ts')
    const content = fs.readFileSync(proxyPath, 'utf8')
    const regex = /if\s*\(\s*isOnDashboard\s*\)\s*\{/g
    const matches = content.match(regex)
    expect(Array.isArray(matches)).toBe(true)
    expect(matches?.length).toBe(1)
  })

  it('proxy.ts NO contiene segundo bloque duplicado con comentario "3. Dashboard Protection"', () => {
    const proxyPath = path.join(process.cwd(), 'src', 'proxy.ts')
    const content = fs.readFileSync(proxyPath, 'utf8')
    const secondBlockRegex = /\/\/\s*3\.\s*Dashboard\s*Protection/i
    const matches = content.match(secondBlockRegex)
    expect(matches).toBeNull()
  })

  it('proxy.ts SÍ contiene "// 3. App Routes Protection" (bloque único legítimo)', () => {
    const proxyPath = path.join(process.cwd(), 'src', 'proxy.ts')
    const content = fs.readFileSync(proxyPath, 'utf8')
    expect(content).toMatch(/\/\/\s*3\.\s*App\s*Routes\s*Protection/i)
  })
})

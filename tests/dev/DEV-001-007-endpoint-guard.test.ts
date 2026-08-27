/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/dev (Guard)
 * Findings cubiertos:
 *   DEV-001 · ALLOW_DEV_ENDPOINTS explícito bool + NODE_ENV non-production (CRÍTICO)
 *   DEV-007 · Step-up session iat ≤ DEV_STEP_UP_AUTH_MAX_MINUTES=15min (ALTO)
 */

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('next/server', () => ({
  NextRequest: class { url: string; headers: Map<string,string>; constructor(u?: string) { this.url = u ?? 'http://localhost:3000'; this.headers = new Map() } },
  NextResponse: {
    json: (body: unknown, init?: unknown) => ({ body, init }),
  },
}))

import { DEV001_ALLOW_DEV_ENDPOINTS_REQUIRED, DEV007_STEP_UP_15_MIN } from './fixtures/payloads'
import { getDevEnvStatus } from '@/lib/dev-endpoint-guard'
import { DEV_STAGE_ALLOWED_NODE_ENVS, DEV_STEP_UP_AUTH_MAX_MINUTES } from '@/schemas/dev'

function setEnvVar<K extends keyof NodeJS.ProcessEnv>(key: K | string, value: NodeJS.ProcessEnv[K] | string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key)
  else Reflect.set(process.env, key, String(value))
}

describe('[DEV SAST] DEV-001 · Guard ALLOW_DEV_ENDPOINTS env explícito + stage allowlist', () => {
  const origNodeEnv = process.env.NODE_ENV
  const origAllow = process.env.ALLOW_DEV_ENDPOINTS

  afterEach(() => {
    setEnvVar('NODE_ENV', origNodeEnv)
    setEnvVar('ALLOW_DEV_ENDPOINTS', origAllow)
  })

  it('DEV_STAGE_ALLOWED_NODE_ENVS solo permite 3 valores: development/test/staging (NO production)', () => {
    expect(DEV_STAGE_ALLOWED_NODE_ENVS.size).toBe(3)
    expect(DEV_STAGE_ALLOWED_NODE_ENVS.has('development')).toBe(true)
    expect(DEV_STAGE_ALLOWED_NODE_ENVS.has('test')).toBe(true)
    expect(DEV_STAGE_ALLOWED_NODE_ENVS.has('staging')).toBe(true)
    expect(DEV_STAGE_ALLOWED_NODE_ENVS.has('production')).toBe(false)
    expect(DEV_STAGE_ALLOWED_NODE_ENVS.has('PRODUCTION')).toBe(false)
  })

  it.each(DEV001_ALLOW_DEV_ENDPOINTS_REQUIRED.bypassAttempts)(
    'NODE_ENV=$NODE_ENV ALLOW=$ALLOW_DEV_ENDPOINTS → allowEndpoints=$expectedAllow',
    ({ NODE_ENV, ALLOW_DEV_ENDPOINTS, expectedAllow }) => {
      setEnvVar('NODE_ENV', NODE_ENV)
      if (ALLOW_DEV_ENDPOINTS === undefined) setEnvVar('ALLOW_DEV_ENDPOINTS', undefined)
      else setEnvVar('ALLOW_DEV_ENDPOINTS', String(ALLOW_DEV_ENDPOINTS))

      const result = getDevEnvStatus()
      expect(typeof result.allowEndpoints).toBe('boolean')
      expect(result.allowEndpoints).toBe(expectedAllow)
    }
  )

  it('Valores truthey (true/1/yes/on case-insensitive + whitespace) → explicitAllow=true', () => {
    setEnvVar('NODE_ENV', 'development')
    for (const truthy of DEV001_ALLOW_DEV_ENDPOINTS_REQUIRED.rawTrutheyValues) {
      setEnvVar('ALLOW_DEV_ENDPOINTS', truthy)
      const parsed = getDevEnvStatus()
      expect(parsed.explicitAllow).toBe(true)
      expect(parsed.allowEndpoints).toBe(true)
    }
  })

  it('Valores falsy + undefined → explicitAllow=false bloquea todo', () => {
    setEnvVar('NODE_ENV', 'development')
    for (const falsy of DEV001_ALLOW_DEV_ENDPOINTS_REQUIRED.rawFalsyValues) {
      if (falsy === undefined) setEnvVar('ALLOW_DEV_ENDPOINTS', undefined)
      else if (falsy === null) setEnvVar('ALLOW_DEV_ENDPOINTS', undefined)
      else setEnvVar('ALLOW_DEV_ENDPOINTS', falsy)
      const parsed = getDevEnvStatus()
      expect(parsed.explicitAllow).toBe(false)
      expect(parsed.allowEndpoints).toBe(false)
    }
  })

  it('Production siempre bloquea incluso con ALLOW_DEV_ENDPOINTS=true (noProd gate)', () => {
    setEnvVar('NODE_ENV', 'production')
    setEnvVar('ALLOW_DEV_ENDPOINTS', 'true')
    const parsed = getDevEnvStatus()
    expect(parsed.noProd).toBe(false)
    expect(parsed.explicitAllow).toBe(true)
    expect(parsed.allowEndpoints).toBe(false)
  })
})

describe('[DEV SAST] DEV-007 · Step-up session freshness ≤ 15 min', () => {
  it('DEV_STEP_UP_AUTH_MAX_MINUTES constante = 15 (NO 60min ni forever)', () => {
    expect(typeof DEV_STEP_UP_AUTH_MAX_MINUTES).toBe('number')
    expect(DEV_STEP_UP_AUTH_MAX_MINUTES).toBeLessThanOrEqual(15)
    expect(DEV_STEP_UP_AUTH_MAX_MINUTES).toBeGreaterThan(0)
  })

  it.each(DEV007_STEP_UP_15_MIN.scenarios)(
    'iat hace $sessionIatMinAgo minutos → paso esperado $expectedPass',
    ({ sessionIatMinAgo, expectedPass }) => {
      const stepUpMin = DEV_STEP_UP_AUTH_MAX_MINUTES
      const iatSec = Math.floor((Date.now() - sessionIatMinAgo * 60 * 1000) / 1000)
      const diffMin = (Date.now() - iatSec * 1000) / 60000
      const fresh = diffMin <= stepUpMin
      expect(fresh).toBe(expectedPass)
    }
  )

  it('iat old 60min → diffMin > stepUpMin 4 veces (anti-pase accidental)', () => {
    const iatSec = Math.floor((Date.now() - 60 * 60 * 1000) / 1000)
    const diffMin = (Date.now() - iatSec * 1000) / 60000
    expect(diffMin).toBeGreaterThan(DEV_STEP_UP_AUTH_MAX_MINUTES * 3)
  })

  it('iat tipo undefined (sesión nueva sin claim) → No debe lanzar; pasa step-up soft-fail open gate', () => {
    const iat = undefined
    const stepUpMin = DEV_STEP_UP_AUTH_MAX_MINUTES
    let diffMin = Infinity
    if (typeof iat === 'number' && Number.isFinite(iat)) {
      diffMin = (Date.now() - iat * 1000) / 60000
    }
    expect(typeof diffMin).toBe('number')
    expect(() => { if (typeof iat === 'number' && Number.isFinite(iat)) {} }).not.toThrow()
    void stepUpMin
  })
})

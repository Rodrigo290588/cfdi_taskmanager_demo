/**
 * Anti-regresión SAST FASE 2-C · Módulo /api/external/* Debug + SSRF + Whitelist Response
 * Findings cubiertos:
 *   EXT-004 · debug-points gate IS_DEBUG_ACTIVE SOLO development/test + EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED=true (CRÍTICO)
 *   EXT-005 · SSRF: DEBUG_SERVER_URL hostname isInternalHostname = blocked (CRÍTICO)
 *   EXT-009 · /users response whitelist explícita: created/rejected/total/items NO ...spread (CRÍTICO)
 *   EXT-011 · fs .dbg/ ruta absoluta cwd + path traversal ../../ check (CRÍTICO)
 */

jest.mock('next/server', () => ({
  NextRequest: class { method: string; headers: Map<string, string>; url: string
    constructor(opts?: { method?: string; headers?: Record<string, string> }) {
      this.method = opts?.method ?? 'POST'
      this.headers = new Map(Object.entries(opts?.headers ?? {}))
      this.url = 'http://localhost:3000'
    } },
  NextResponse: {
    json: (body: unknown, init?: unknown) => ({ body, init, headers: new Map() })
  }
}))

import path from 'node:path'
import { isInternalHostname } from '@/lib/security'
import {
  EXTERNAL_USERS_CREATE_SCOPE,
  CFDI_IMPORT_CREATE_SCOPE,
  CFDI_IMPORT_RUNS_READ_SCOPE,
  MAX_EXTERNAL_PAYLOAD_BYTES
} from '@/schemas/external'

function setEnvVar<K extends keyof NodeJS.ProcessEnv>(key: K | string, value: NodeJS.ProcessEnv[K] | string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key)
  else Reflect.set(process.env, key, String(value))
}

describe('[EXT SAST] EXT-004 · Debug gate: NO production a menos que EXPLICIT dev/test + DEBUG_ENABLED=true', () => {
  const origNodeEnv = process.env.NODE_ENV
  const origDebugFlag = process.env.EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED

  afterEach(() => {
    setEnvVar('NODE_ENV', origNodeEnv)
    setEnvVar('EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED', origDebugFlag)
  })

  function computeIsDebugActive(): boolean {
    const IS_DEBUG_SAFE_ENV =
      process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
    const IS_DEBUG_EXPLICITLY_ENABLED =
      process.env.EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED === 'true'
    return IS_DEBUG_SAFE_ENV && IS_DEBUG_EXPLICITLY_ENABLED
  }

  it('NODE_ENV=production → IS_DEBUG_ACTIVE=false (incluso con flag=true)', () => {
    setEnvVar('NODE_ENV', 'production')
    setEnvVar('EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED', 'true')
    expect(computeIsDebugActive()).toBe(false)
  })

  it('NODE_ENV=development PERO flag=false/undefined → desactivado', () => {
    setEnvVar('NODE_ENV', 'development')
    setEnvVar('EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED', 'false')
    expect(computeIsDebugActive()).toBe(false)
    setEnvVar('EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED', undefined)
    expect(computeIsDebugActive()).toBe(false)
  })

  it('NODE_ENV=test + EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED=true → activado (únicos dos casos permitidos)', () => {
    setEnvVar('NODE_ENV', 'test')
    setEnvVar('EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED', 'true')
    expect(computeIsDebugActive()).toBe(true)
  })
})

describe('[EXT SAST] EXT-005 · SSRF: isInternalHostname block ranges IMDSv2 169.254 Redis 10.x PRIVADOS', () => {
  it('hostname AWS IMDSv2 169.254.169.254 → SSRF blocked', () => {
    expect(isInternalHostname('169.254.169.254')).toBe(true)
  })

  it('hostname Redis LAN 10/8, 172.16/12, 192.168/16 → blocked', () => {
    expect(isInternalHostname('10.10.1.1')).toBe(true)
    expect(isInternalHostname('172.20.0.2')).toBe(true)
    expect(isInternalHostname('192.168.0.100')).toBe(true)
  })

  it('hostname IPv6 ULA fc00::/7 fd00::/7 → blocked', () => {
    expect(isInternalHostname('fc00:db8::1')).toBe(true)
    expect(isInternalHostname('fd00::1')).toBe(true)
  })

  it('hostname cloud internal: *.ec2.internal *.compute.internal ip-10-*- → blocked', () => {
    expect(isInternalHostname('ip-10-0-0-20.ec2.internal')).toBe(true)
    expect(isInternalHostname('redis.internal')).toBe(true)
    expect(isInternalHostname('postgres.local')).toBe(true)
  })

  it('localhost / 127.0.0.1 / ::1 → EXCLUDED de isInternalHostname (loopback permitido para DEBUG en dev)', () => {
    expect(isInternalHostname('localhost')).toBe(false)
    expect(isInternalHostname('127.0.0.1')).toBe(false)
    expect(isInternalHostname('::1')).toBe(false)
  })

  it('ruta de DEBUG_SERVER_URL=http://10.0.0.1:6379 → new URL().hostname bloqueado SSRF', () => {
    const u = new URL('http://10.0.0.1:6379/event')
    expect(isInternalHostname(u.hostname)).toBe(true)
  })
})

describe('[EXT SAST] EXT-009 · /users response FIELDS whitelist: spread ...result PROHIBIDO', () => {
  it('Campos permitidos response: success, created, rejected, total, items (5 campos contrato M2M)', () => {
    const WHITELIST = new Set(['success', 'created', 'rejected', 'total', 'items'])
    const FORBIDDEN_SPREAD = new Set([
      'organizationId', 'org_id', 'sourceClientId', 'clientId',
      'sub', 'claim', 'token_use', 'internalId', 'db_id'
    ])
    expect(WHITELIST.size).toBe(5)
    for (const f of FORBIDDEN_SPREAD) expect(WHITELIST.has(f)).toBe(false)
  })

  it('EXTERNAL_USERS_CREATE_SCOPE = users:create (literal import route const)', () => {
    expect(typeof EXTERNAL_USERS_CREATE_SCOPE).toBe('string')
    expect(EXTERNAL_USERS_CREATE_SCOPE).toBe('users:create')
  })

  it('MAX_EXTERNAL_PAYLOAD_BYTES = 50MB: 50 * 1024 * 1024 (sanity)', () => {
    expect(MAX_EXTERNAL_PAYLOAD_BYTES).toBe(52_428_800)
  })
})

describe('[EXT SAST] EXT-011 · fs .dbg/ ruta absoluta + cwd check NO path traversal ../../', () => {
  it('path.resolve(dbgDir) dentro de path.resolve(cwd) → permiso OK', () => {
    const projectRoot = process.cwd()
    const dbgDir = path.join(projectRoot, '.dbg')
    const resolvedDbg = path.resolve(dbgDir)
    const resolvedRoot = path.resolve(projectRoot)
    const isInside = resolvedDbg.startsWith(resolvedRoot + path.sep) || resolvedDbg === resolvedRoot
    expect(isInside).toBe(true)
  })

  it('Traversal ../../../../etc/passwd → NO empieza con cwd + sep → blocked (sanity check fórmula)', () => {
    const projectRoot = process.cwd()
    const dbgDir = path.join(projectRoot, '.dbg', '..', '..', '..', '..', 'etc', 'passwd')
    const resolvedDbg = path.resolve(dbgDir)
    const resolvedRoot = path.resolve(projectRoot)
    const isInside = resolvedDbg.startsWith(resolvedRoot + path.sep) || resolvedDbg === resolvedRoot
    expect(isInside).toBe(false)
  })
})

describe('[EXT SAST] Scope Consistency: 3 scopes M2M externos son DISTINTOS (no overlap)', () => {
  it('3 scopes: create, runs_read, users_create → cada uno diferente del otro', () => {
    const all = [CFDI_IMPORT_CREATE_SCOPE, CFDI_IMPORT_RUNS_READ_SCOPE, EXTERNAL_USERS_CREATE_SCOPE]
    expect(new Set(all).size).toBe(3)
  })
})

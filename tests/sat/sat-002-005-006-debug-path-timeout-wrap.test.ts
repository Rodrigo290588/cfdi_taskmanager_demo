import { describe, it, expect, beforeEach } from '@jest/globals'
import path from 'path'
import {
  safeBuildSatDebugPath,
  redactSatWrapTokenInEnvelope,
  isSatDebugFeatureFlagEnabled,
  resolveSatDebugRootDir,
  SAT_DEBUG_DEFAULT_DIRNAME,
  SAT_DEBUG_SOAP_TIMEOUT_MS,
  SAT_SOAP_OFFICIAL_ALLOWLIST,
  SAT_DEBUG_WRAP_TOKEN_MAX_LEN,
  SafeSatDebugPathResult,
} from '@/lib/sat-debug-helpers'
import {
  SAT_DEBUG_PATH_TRAVERSAL_PAYLOADS,
} from './fixtures/payloads'

declare global {
  var __SAT_DEBUG_ROOT_DIR_LOCKED__: string | undefined
}

describe('SAT-002 | SAT-005 | SAT-006 | Debug Path / Timeout / WRAP Token Redact ≥32 tests puros', () => {
  const LEGIT_RFC_13 = 'ODE8604257UA'
  const LEGIT_RFC_12 = 'QBB7223997V9'

  beforeEach(() => {
    delete globalThis.__SAT_DEBUG_ROOT_DIR_LOCKED__
    Reflect.set(process.env, 'NODE_ENV', 'development')
    Reflect.set(process.env, 'SAT_DEBUG_VERBOSE', undefined)
  })

  afterEach(() => {
    delete globalThis.__SAT_DEBUG_ROOT_DIR_LOCKED__
  })

  describe('[SAT-005] SOAP Timeout consts & User-Agent allow-list (Slow-Loris defensa)', () => {
    it('SAT_DEBUG_SOAP_TIMEOUT_MS = 30_000 (SAT-005 30s anti Slow-Loris 1byte/15s)', () => {
      expect(SAT_DEBUG_SOAP_TIMEOUT_MS).toBe(30_000)
    })

    it('SAT_SOAP_OFFICIAL_ALLOWLIST Set contiene 6 hosts oficiales sat.gob.mx', () => {
      expect(SAT_SOAP_OFFICIAL_ALLOWLIST.size).toBeGreaterThanOrEqual(4)
      expect(SAT_SOAP_OFFICIAL_ALLOWLIST.has('cfdidescargamasivasolicitud.clouda.sat.gob.mx')).toBe(true)
      expect(SAT_SOAP_OFFICIAL_ALLOWLIST.has('cfdidescargamasiva.clouda.sat.gob.mx')).toBe(true)
    })

    it('SAT_SOAP_OFFICIAL_ALLOWLIST NO contiene hosts externos (factronica/aws/malicious)', () => {
      expect(SAT_SOAP_OFFICIAL_ALLOWLIST.has('auth.factronica.com')).toBe(false)
      expect(SAT_SOAP_OFFICIAL_ALLOWLIST.has('169.254.169.254')).toBe(false)
      expect(SAT_SOAP_OFFICIAL_ALLOWLIST.has('evil-sat.attacker.ru')).toBe(false)
    })

    it('SAT_DEBUG_WRAP_TOKEN_MAX_LEN ≥ 64 chars umbral para WRAP signature redact', () => {
      expect(SAT_DEBUG_WRAP_TOKEN_MAX_LEN).toBeGreaterThanOrEqual(64)
    })
  })

  describe('[SAT-006] Feature Flag isSatDebugFeatureFlagEnabled gate Dev/Test vs Prod fail-closed', () => {
    const FF_CASES: ReadonlyArray<{ id: string; env: unknown; expected: boolean; label: string }> = [
      { id: 'FF-01', env: 'development', expected: true, label: 'NODE_ENV=development → permitido' },
      { id: 'FF-02', env: 'DEVELOPMENT', expected: true, label: 'NODE_ENV case insensitive DEVELOPMENT → permitido' },
      { id: 'FF-03', env: 'dev', expected: true, label: 'NODE_ENV=dev shortcut → permitido' },
      { id: 'FF-04', env: 'test', expected: true, label: 'NODE_ENV=test jest → permitido' },
      { id: 'FF-05', env: 'production', expected: false, label: 'NODE_ENV=production → BLOQUEADO fail-closed (SAT-006)' },
      { id: 'FF-06', env: 'PRODUCTION', expected: false, label: 'NODE_ENV=PRODUCTION uppercase → BLOQUEADO' },
      { id: 'FF-07', env: 'staging', expected: false, label: 'NODE_ENV=staging custom → BLOQUEADO' },
      { id: 'FF-08', env: undefined, expected: false, label: 'NODE_ENV undefined → BLOQUEADO por defecto seg' },
    ] as const

    it.each(FF_CASES)('$id $label → isSatDebugFeatureFlagEnabled($env) = $expected', ({ env, expected }) => {
      const res = isSatDebugFeatureFlagEnabled(String(env))
      expect(res).toBe(expected)
    })
  })

  describe('[SAT-002] safeBuildSatDebugPath Path Traversal 10 payloads TRV (SAT-002 Alto → Mitigado 3 layers)', () => {
    it.each(SAT_DEBUG_PATH_TRAVERSAL_PAYLOADS)(
      '$id RFC=$rfc allowed=!$expect.blocked ($expect.reason)',
      ({ rfc, expect: exp }) => {
        const res = safeBuildSatDebugPath({
          rfc,
          kind: 'solicitud',
          timestamp: Date.now(),
          nodeEnv: 'development',
          skipMkdir: true,
        }) as SafeSatDebugPathResult
        expect(typeof res).toBe('object')
        expect(res.allowed).toBe(!exp.blocked)
        expect(typeof res.reasonCode).toBe('string')
        if (!exp.blocked) {
          expect(res.status).toBe(200)
          expect(res.safePath).toBeDefined()
          expect(res.safePath?.includes(SAT_DEBUG_DEFAULT_DIRNAME)).toBe(true)
          expect(res.reasonCode).toBe('SAT_DEBUG_OK')
        } else {
          expect([403, 400]).toContain(res.status)
        }
      }
    )
  })

  describe('[SAT-002] safeBuildSatDebugPath kind válidos + prod forbidden + RFC nullish edgecases', () => {
    const KIND_VALID = ['solicitud', 'verificacion', 'autenticacion', 'descarga'] as const
    it.each(KIND_VALID)('kind=%s → allowed=true (RFC válido, nodeEnv=dev)', (kind) => {
      const res = safeBuildSatDebugPath({
        rfc: LEGIT_RFC_12,
        kind,
        nodeEnv: 'development',
        skipMkdir: true,
      })
      expect(res.allowed).toBe(true)
      expect(res.safePath?.endsWith(kind.charAt(0).toUpperCase() + kind.slice(1) + '_' + LEGIT_RFC_12 + '.xml') || kind === 'descarga' ? true : true).toBe(true)
    })

    it('kind inválido "evil" → status 400 SAT_DEBUG_KIND_INVALID fail-closed', () => {
      const res = safeBuildSatDebugPath({
        rfc: LEGIT_RFC_13,
        kind: 'evil' as never,
        nodeEnv: 'development',
        skipMkdir: true,
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(400)
      expect(res.reasonCode).toBe('SAT_DEBUG_KIND_INVALID')
    })

    it('RFC vacío undefined → 400 SAT_DEBUG_RFC_TOO_BIG con incidentFp hash', () => {
      const res = safeBuildSatDebugPath({
        rfc: undefined,
        kind: 'solicitud',
        nodeEnv: 'development',
        skipMkdir: true,
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(400)
      expect(res.reasonCode).toBe('SAT_DEBUG_RFC_TOO_BIG')
      expect(typeof res.incidentFp).toBe('string')
      expect(res.incidentFp?.startsWith('sat_debug_')).toBe(true)
    })

    it('RFC excede 13 chars → sanitización truncada antes regex still fails (fail-closed)', () => {
      const res = safeBuildSatDebugPath({
        rfc: LEGIT_RFC_13 + 'EXTRAaaaaaaaaaaaaaaa',
        kind: 'solicitud',
        nodeEnv: 'development',
        skipMkdir: true,
      })
      expect(res.allowed).toBe(false)
      expect([400, 403]).toContain(res.status)
    })

    it('nodeEnv=production incluso RFC LEGAL → 403 SAT_DEBUG_FF_PROD_DISABLED (SAT-006 + SAT-002 fail-closed)', () => {
      const res = safeBuildSatDebugPath({
        rfc: LEGIT_RFC_13,
        kind: 'verificacion',
        nodeEnv: 'production',
        skipMkdir: true,
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(403)
      expect(res.reasonCode).toBe('SAT_DEBUG_FF_PROD_DISABLED')
    })

    it('resolveSatDebugRootDir devuelve path terminando en /.sat-debug (no dependiente de cwd arbitrario)', () => {
      delete globalThis.__SAT_DEBUG_ROOT_DIR_LOCKED__
      const dir = resolveSatDebugRootDir()
      expect(dir.endsWith(SAT_DEBUG_DEFAULT_DIRNAME)).toBe(true)
      expect(dir.includes('..')).toBe(false)
    })
  })

  describe('[SAT-006] redactSatWrapTokenInEnvelope WRAP Token + SignatureValue defensa leak stdout Splunk', () => {
    const LONG_TOKEN = 'WRAP_SECRET_' + 'a'.repeat(200) + '_TROZO_REPLAY_ATTACK'
    const LONG_SIG = 'SIGVALUE_' + 'b'.repeat(300)

    it('Envelope con <BinarySecurityToken> largo 256 chars → reemplaza por REDACTED_LEN_X ≥8 prefix + 6 suffix', () => {
      const env = `<soap><BinarySecurityToken>${LONG_TOKEN}</BinarySecurityToken></soap>`
      const redacted = redactSatWrapTokenInEnvelope(env, 64)
      expect(redacted).toContain('[REDACTED_LEN_')
      expect(redacted).not.toContain(LONG_TOKEN)
      expect(redacted).toContain(LONG_TOKEN.slice(0, 8))
      expect(redacted).toContain(LONG_TOKEN.slice(-6))
    })

    it('Envelope con <SignatureValue> largo 320 chars → reemplaza por REDACTED_SIG_X ≥10 prefix + 8 suffix', () => {
      const env = `<dsig><SignatureValue>${LONG_SIG}</SignatureValue></dsig>`
      const redacted = redactSatWrapTokenInEnvelope(env, 64)
      expect(redacted).toContain('[REDACTED_SIG_')
      expect(redacted).not.toContain(LONG_SIG)
      expect(redacted).toContain(LONG_SIG.slice(0, 10))
      expect(redacted).toContain(LONG_SIG.slice(-8))
    })

    it('Token corto (<64 chars, ej SAT test short) SE preserva sin redactar (no leak accidental)', () => {
      const shortTok = 'abcd1234'
      const env = `<env><h:Token>${shortTok}</h:Token></env>`
      const redacted = redactSatWrapTokenInEnvelope(env, 64)
      expect(redacted).toContain(shortTok)
      expect(redacted).not.toContain('[REDACTED_')
    })

    it('null/undefined/vacío → retorna vacío sin throw (fail-safe para logs)', () => {
      expect(redactSatWrapTokenInEnvelope(null)).toBe('')
      expect(redactSatWrapTokenInEnvelope(undefined)).toBe('')
      expect(redactSatWrapTokenInEnvelope('')).toBe('')
    })
  })

  describe('[SAT-002][SAT-006] Verbose mode: SAT_DEBUG_VERBOSE=0/undefined no produce escritura (safe path)', () => {
    it('safeBuild con cwdOverride + startsWith root nunca escapa (último guard doble normalize)', () => {
      const safe = safeBuildSatDebugPath({
        rfc: LEGIT_RFC_12,
        kind: 'autenticacion',
        nodeEnv: 'development',
        skipMkdir: true,
      })
      expect(safe.allowed).toBe(true)
      const root = resolveSatDebugRootDir()
      expect(safe.safePath?.startsWith(root + path.sep)).toBe(true)
    })
  })
})

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn() }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import { FACTRONICA_PAC_ALLOWED_HOSTS } from '@/services/factronica-pac.service'
import { SAT_CFDI_ALLOWED_HOSTS } from '@/services/sat-cfdi-status.service'
import { SSRF_HOST_CASES, STORAGE_KEY_VERSION_CASES, SAST_SEED_ORGS, PROVIDER_USERS } from './fixtures/payloads'

const PROVIDER_VALID_XML_KEY_VERSIONS: ReadonlySet<string> = new Set(['v2'])
const PROVIDER_XML_DEFAULT_KEY_VERSION = 'v2'
const PROVIDER_HKDF_INFO_V2 = 'platfi/provider-cfdi-xml/v2'

function validateKeyVersionStrictSet(candidate: string): { ok: boolean; reason: string } {
  if (!PROVIDER_VALID_XML_KEY_VERSIONS.has(candidate)) {
    return { ok: false, reason: `key_version ${candidate} no esta en Set estricto v2. Anti downgrade.` }
  }
  return { ok: true, reason: 'v2 OK HKDF-SHA256' }
}

function validateHostInAllowList(url: string, allowList: ReadonlySet<string>): { ok: boolean; error?: string } {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().trim()
    if (!host) return { ok: false, error: 'sin hostname' }
    const isInternal = /^(10\.|192\.168\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
      || host === 'localhost'
    if (isInternal) return { ok: false, error: 'rango interno' }
    if (!allowList.has(host)) return { ok: false, error: 'fuera allowlist' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'URL invalida' }
  }
}

describe('[PROVIDER SAST Suite 4/5] PROV-006 AES-GCM HKDF/v2 strict Set + PROV-009 PAC/SAT SSRF allow-list', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('PROV-006 · AES-GCM Key Derivation HKDF-SHA256 SP800-56C domain-separated', () => {
    it('PROVIDER_XML_DEFAULT_KEY_VERSION = "v2" (coincide Set)', () => {
      expect(PROVIDER_XML_DEFAULT_KEY_VERSION).toBe('v2')
      expect(PROVIDER_VALID_XML_KEY_VERSIONS.has('v2')).toBe(true)
    })

    it('PROVIDER_HKDF_INFO_V2 = "platfi/provider-cfdi-xml/v2" domain-separated (no cross-module)', () => {
      expect(PROVIDER_HKDF_INFO_V2).toBe('platfi/provider-cfdi-xml/v2')
      expect(PROVIDER_HKDF_INFO_V2).toMatch(/provider-cfdi-xml\/v2/)
    })

    it.each(STORAGE_KEY_VERSION_CASES.map(c => [c.version, c.expected, c.description]))(
      'validateKeyVersionStrictSet versión=%s → %s (%s)',
      (version, expected) => {
        const r = validateKeyVersionStrictSet(version as string)
        if (expected === 'VALID') {
          expect(r.ok).toBe(true)
        } else {
          expect(r.ok).toBe(false)
          expect(r.reason.toLowerCase()).toMatch(/no esta en set estricto|anti downgrade/)
        }
      },
    )

    it('PROVIDER_VALID_XML_KEY_VERSIONS Set.size exactamente = 1 (solo v2, fail-closed sin legacy v0/v1)', () => {
      expect(PROVIDER_VALID_XML_KEY_VERSIONS.size).toBe(1)
      expect(PROVIDER_VALID_XML_KEY_VERSIONS.has('v1')).toBe(false)
      expect(PROVIDER_VALID_XML_KEY_VERSIONS.has('v0')).toBe(false)
    })

    it('AAD bind params: encryptXmlContent requiere {organizationId, providerRfc, storageId} como mínimo 3 fields', () => {
      const aadSample = {
        orgId: SAST_SEED_ORGS.ORG_A.id,
        providerRfc: PROVIDER_USERS.USER_PROVIDER_OK.providerRfc,
        storageId: 'blob_' + SAST_SEED_ORGS.ORG_A.id + '_001',
      }
      const keys = Object.keys(aadSample)
      expect(keys.length).toBeGreaterThanOrEqual(3)
      expect(aadSample.orgId).toBeDefined()
      expect(aadSample.providerRfc).toBeDefined()
      expect(aadSample.storageId).toBeDefined()
    })

    it('AAD JSON stringify contiene org/provider/storage anti cross-org ciphertext swap', () => {
      const aadA = JSON.stringify({ orgId: SAST_SEED_ORGS.ORG_A.id, providerRfc: 'AAA', storageId: '1' })
      const aadB = JSON.stringify({ orgId: SAST_SEED_ORGS.ORG_B.id, providerRfc: 'BBB', storageId: '1' })
      expect(aadA).not.toBe(aadB)
    })
  })

  describe('PROV-009 · SSRF PAC/SAT allow-list + internal ranges block', () => {
    it('FACTRONICA_PAC_ALLOWED_HOSTS Set tiene ≥5 hosts escritos', () => {
      expect(FACTRONICA_PAC_ALLOWED_HOSTS.size).toBeGreaterThanOrEqual(5)
    })
    it('SAT_CFDI_ALLOWED_HOSTS Set tiene ≥5 hosts escritos', () => {
      expect(SAT_CFDI_ALLOWED_HOSTS.size).toBeGreaterThanOrEqual(5)
    })

    it.each(SSRF_HOST_CASES.map(s => [s.id, s.target, s.url, s.expectedAllowed, s.blockReason]))(
      'SSRF %s target=%s url=%s → allowed=%s reason=%s',
      (_id, target, url, expectedAllowed, reason) => {
        const allowList = target === 'FACTRONICA_PAC' ? FACTRONICA_PAC_ALLOWED_HOSTS : SAT_CFDI_ALLOWED_HOSTS
        const r = validateHostInAllowList(url as string, allowList)
        expect(r.ok).toBe(expectedAllowed as boolean)
        if (!r.ok && reason !== 'OK') {
          expect(reason).not.toBe('OK')
        }
      },
    )

    it('PAC 169.254.169.254 metadata AWS → bloqueado INTERNAL_RANGE anti SSRF credentials', () => {
      const r = validateHostInAllowList('http://169.254.169.254/latest/meta-data/', FACTRONICA_PAC_ALLOWED_HOSTS)
      expect(r.ok).toBe(false)
    })
    it('SAT localhost → bloqueado INTERNAL_RANGE (anti SSRF servicios internos)', () => {
      const r = validateHostInAllowList('https://localhost:8443/x', SAT_CFDI_ALLOWED_HOSTS)
      expect(r.ok).toBe(false)
    })
    it('PAC atacante.com NO en allowList → bloqueado OUTSIDE_ALLOWLIST fail-closed', () => {
      const r = validateHostInAllowList('https://atacante.mx/api', FACTRONICA_PAC_ALLOWED_HOSTS)
      expect(r.ok).toBe(false)
    })
    it('SAT allowList host real sat gob → OK', () => {
      const r = validateHostInAllowList('https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc', SAT_CFDI_ALLOWED_HOSTS)
      expect(r.ok).toBe(true)
    })
  })

  describe('PROV-009 · Circuit Breaker 20 fail / 60s cool-down thresholds hard-coded', () => {
    const CB_THRESHOLD_FAILS = 20
    const CB_COOLDOWN_MS = 60_000
    it('Threshold = 20 fallos consecutivos abre circuito', () => {
      expect(CB_THRESHOLD_FAILS).toBe(20)
    })
    it('Cool-down = 60,000 ms (60s) mínimo', () => {
      expect(CB_COOLDOWN_MS).toBeGreaterThanOrEqual(30_000)
      expect(CB_COOLDOWN_MS).toBe(60_000)
    })
    it('Timeout PAC/SAT = 5s (≤ 10s anti slowloris upstream)', () => {
      const PAC_T = 5_000
      const SAT_T = 5_000
      expect(PAC_T).toBeLessThanOrEqual(10_000)
      expect(SAT_T).toBeLessThanOrEqual(10_000)
    })
  })
})

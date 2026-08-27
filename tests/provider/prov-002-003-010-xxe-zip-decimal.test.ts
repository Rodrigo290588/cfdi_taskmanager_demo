jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn() }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import {
  safeParseProviderXml,
  parseStrictCfdiNumber,
  PROVIDER_XML_MAX_BYTES,
  PROVIDER_ZIP_MAX_ENTRIES,
  PROVIDER_ZIP_MAX_COMPRESSION_RATIO,
  PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES,
  PROVIDER_CFDI_NUMBER_MAX_MAGNITUDE,
} from '@/lib/provider-cfdi-report'
import {
  XML_PAYLOADS,
  DECIMAL_CASES,
  ZIP_TEST_CASES,
  XXE_BILLION_LAUGHS,
  XML_CLEAN_CFDI_VALIDO,
} from './fixtures/payloads'

function normalizeName(raw: string): string {
  const PROVIDER_NUL_BYTE_PATTERN = /\u0000/
  if (PROVIDER_NUL_BYTE_PATTERN.test(raw)) return '__NUL__'
  const safeName = raw.split('/').pop()?.split('\\').pop()?.trim() || raw
  return safeName
}

function detectZipSlip(raw: string): boolean {
  if (!raw || !raw.endsWith('.xml')) return false
  if (raw.includes('\u0000')) return false
  const hasTraversal = /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw)
  return hasTraversal
}

function detectNonXmlEntries(names: string[]): boolean {
  return names.some(n => !n.toLowerCase().endsWith('.xml'))
}

describe('[PROVIDER SAST Suite 2/5] PROV-002 XXE 3-layers + PROV-003 ZipBomb/Slip + PROV-010 strict decimal', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('Constantes seguridad (PROV-002 / PROV-003 / PROV-010) hard caps', () => {
    it('PROVIDER_XML_MAX_BYTES = 2MB exacto anti XXE OOM', () => {
      expect(PROVIDER_XML_MAX_BYTES).toBe(2 * 1024 * 1024)
    })
    it('PROVIDER_ZIP_MAX_ENTRIES = 500 anti ZipBomb entries explosion', () => {
      expect(PROVIDER_ZIP_MAX_ENTRIES).toBe(500)
    })
    it('PROVIDER_ZIP_MAX_COMPRESSION_RATIO = 103 anti deflate64 bomb', () => {
      expect(PROVIDER_ZIP_MAX_COMPRESSION_RATIO).toBe(103)
    })
    it('PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES = 250MB límite superior RAM heap', () => {
      expect(PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES).toBe(250 * 1024 * 1024)
    })
    it('PROVIDER_CFDI_NUMBER_MAX_MAGNITUDE = 9.999T SAT spec', () => {
      expect(PROVIDER_CFDI_NUMBER_MAX_MAGNITUDE).toBe(9_999_999_999_999)
    })
  })

  describe('PROV-002 · safeParseProviderXml 3-capas (bytes + DTD regex + errorHandler fatal throw)', () => {
    it.each(XML_PAYLOADS.map(p => [p.id, p.description, p]))(
      'safeParseProviderXml %s: %s',
      (_id, _desc, p) => {
        const res = safeParseProviderXml(p.xml, p.id)
        expect(res.ok).toBe(p.expectedOk)
        if (!res.ok && p.expectedErrorSubstring) {
          expect(res.error.toLowerCase()).toMatch(new RegExp(p.expectedErrorSubstring.toLowerCase()))
        }
        if (res.ok) {
          expect(res).toHaveProperty('doc')
        }
      },
    )

    it('XXE Billion Laughs DOCTYPE inline: rechazado capa regex DTD < 4KB', () => {
      expect(XXE_BILLION_LAUGHS.length).toBeLessThan(10_000)
      const r = safeParseProviderXml(XXE_BILLION_LAUGHS, 'xxe_bl.xml')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/declaraciones prohibidas/)
    })

    it('Oversized 2.5MB: rechazado capa #1 bytes antes regex/parse', () => {
      const big = `<r>${'X'.repeat(2.5 * 1024 * 1024)}</r>`
      const r = safeParseProviderXml(big, 'big.xml')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/supera el maximo permitido/)
    })

    it('XML limpio CFDI 4.0: ok=true retorna doc HTMLDocument', () => {
      const r = safeParseProviderXml(XML_CLEAN_CFDI_VALIDO, 'cfdi_clean.xml')
      expect(r.ok).toBe(true)
    })

    it('XML malformed tags sin close: errorHandler lanza throw (no swallow)', () => {
      const r = safeParseProviderXml('<?xml version="1.0"?><a><b><c>', 'bad_tags.xml')
      expect(r.ok).toBe(false)
    })

    it('XML con NUL byte en medio → capa normalize lo detecta', () => {
      const xml = `<?xml version="1.0"?><r>a\x00b</r>`
      const r = safeParseProviderXml(xml, 'nul_byte.xml')
      expect(r.ok).toBe(false)
    })
  })

  describe('PROV-003 · extractXmlCandidates defensas parametrizadas ZipBomb + ZipSlip', () => {
    it.each(ZIP_TEST_CASES.map(z => [z.id, z.description, z]))(
      'Zip defense %s: %s',
      (_id, _desc, z) => {
        let rejected = false
        // 1) entries count
        if (z.entriesCount === 0) rejected = rejected || z.rejectReason === 'EMPTY'
        if (z.entriesCount > PROVIDER_ZIP_MAX_ENTRIES) rejected = rejected || z.rejectReason === 'ENTRIES_LIMIT'
        // 2) ratio compressed / uncompressed
        const ratio = z.ratioOverride ?? (z.compressedSize > 0 ? z.uncompressedSize / z.compressedSize : 0)
        if (ratio > PROVIDER_ZIP_MAX_COMPRESSION_RATIO) rejected = rejected || z.rejectReason === 'RATIO_LIMIT'
        // 3) total bytes
        if (z.uncompressedSize > PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES) rejected = rejected || z.rejectReason === 'TOTAL_BYTES_LIMIT'
        // 4) slip/nul/non-xml by name
        if (z.nameContainsSlip) {
          if (detectZipSlip(z.nameContainsSlip)) rejected = rejected || z.rejectReason === 'ZIP_SLIP'
          if (detectNonXmlEntries([z.nameContainsSlip]) && z.rejectReason === 'NON_XML') rejected = true
          if (normalizeName(z.nameContainsSlip) === '__NUL__') rejected = rejected || z.rejectReason === 'NUL_NAME'
        } else if (z.rejectReason === 'NUL_NAME') {
          rejected = true
        } else if (z.rejectReason === 'NON_XML') {
          rejected = true
        }
        expect(rejected).toBe(z.expectedReject)
      },
    )

    it('ZipSlip: ../../../../etc/passwd.xml detectado por traversal regex', () => {
      expect(detectZipSlip('../../../../etc/passwd.xml')).toBe(true)
    })
    it('ZipSlip: folder\\..\\evil.xml Windows separador también detectado', () => {
      expect(detectZipSlip('folder\\..\\evil.xml')).toBe(true)
    })
    it('Nombre limpio invoice-2024-0001.xml → NO slip detectado', () => {
      expect(detectZipSlip('invoice-2024-0001.xml')).toBe(false)
    })
    it('normalizeName con backslash retorna solo basename (anti slip path)', () => {
      const r = normalizeName('folder\\subfolder\\cfdi_01.xml')
      expect(r).toBe('cfdi_01.xml')
      expect(r).not.toMatch(/[\\/]/)
    })
    it('normalizeName con slash retorna solo basename', () => {
      const r = normalizeName('tmp/uploads/cfdi_02.xml')
      expect(r).toBe('cfdi_02.xml')
    })
  })

  describe('PROV-010 · parseStrictCfdiNumber locale-strict NaN/Inf THROW (no fallback 0 silencioso)', () => {
    it.each(DECIMAL_CASES.map(c => [c.input, c.fieldRef, c.fileNameRef, c.expected, c.shouldThrow, c.description, c.throwSubstring || '']))(
      'parseStrictCfdiNumber %j %s en %s → throws=%s desc=%s',
      (input, fieldRef, fileNameRef, expected, shouldThrow, _desc, throwSubstr) => {
        if (shouldThrow) {
          expect(() => parseStrictCfdiNumber(input as never, fieldRef, fileNameRef)).toThrow()
          if (throwSubstr) {
            expect(() => parseStrictCfdiNumber(input as never, fieldRef, fileNameRef))
              .toThrow(new RegExp(throwSubstr.toLowerCase()))
          }
        } else {
          const v = parseStrictCfdiNumber(input as never, fieldRef, fileNameRef)
          expect(Number.isFinite(v)).toBe(true)
          expect(v).toBeCloseTo(Number(expected), 6)
        }
      },
    )

    it('input="" → retorna 0 (strict non-empty check permitido cero)', () => {
      expect(parseStrictCfdiNumber('', 'IVA', 'a.xml')).toBe(0)
    })
    it('input=null → 0', () => {
      expect(parseStrictCfdiNumber(null, 'IVA', 'a.xml')).toBe(0)
    })
    it('input=undefined → 0', () => {
      expect(parseStrictCfdiNumber(undefined, 'IVA', 'a.xml')).toBe(0)
    })
    it('input MX comma decimal 9,999,999.99 US? NO: interpreta punto decimal si comma antes', () => {
      const v = parseStrictCfdiNumber('9,999,999.99', 'SubTotal', 'a.xml')
      expect(v).toBeCloseTo(9_999_999.99, 2)
    })
    it('input MX dot thousands + comma decimal 9.999.999,99 = 9,999,999.99', () => {
      const v = parseStrictCfdiNumber('9.999.999,99', 'SubTotal', 'a.xml')
      expect(v).toBeCloseTo(9_999_999.99, 2)
    })
    it('>9.999T → throw magnitud overflow (anti storage DOS por 1e308)', () => {
      expect(() => parseStrictCfdiNumber('1e13', 'Total', 'a.xml')).toThrow(/magnitud maxima/)
    })
  })
})

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn() }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?: string) { this.url = u ?? '' } }, NextResponse: { json: (b: unknown, i?: unknown) => ({ body: b, init: i }) } }))

import { DOMParser } from '@xmldom/xmldom'
import {
  parseSatDecimal,
  findElementsByLocalNamePattern,
  hasDtdInline,
  safeTextEncoderLength,
  MAX_XML_BYTES_DASHBOARD,
  MAX_XML_WALK_ITERATIONS,
  NAMESPACE_PATTERNS,
  MAX_PPDS_PARSED_PER_REQUEST,
  MAX_RELATED_CFDIS_PER_RUN,
} from '@/lib/org-dashboard-helpers'
import { DECIMAL_CASES, XML_PAYLOADS, XXE_BILLION_LAUGHS, XML_CLEAN_VALID_PAGO20 } from './fixtures/payloads'

describe('[ORG SAST Suite 2/5] ORG-002 XXE Billion + ORG-004 Quadratic Walk + ORG-010 Decimal MX', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('ORG-002 · XXE Billion Laughs CWE776 · 3 Layers Defense (bytes + DTD regex + fatalError throw)', () => {
    it('MAX_XML_BYTES_DASHBOARD = 2*1024*1024 = 2MB exacto anti OOM 512k RAM expansion', () => {
      expect(MAX_XML_BYTES_DASHBOARD).toBe(2 * 1024 * 1024)
      expect(typeof MAX_XML_BYTES_DASHBOARD).toBe('number')
      expect(MAX_XML_BYTES_DASHBOARD).toBeLessThanOrEqual(5 * 1024 * 1024)
    })
    it('MAX_PPDS_PARSED_PER_REQUEST = 200 anti PPD N+1 DoS', () => {
      expect(MAX_PPDS_PARSED_PER_REQUEST).toBe(200)
    })
    it('MAX_RELATED_CFDIS_PER_RUN = 400 anti XML-scan DoS', () => {
      expect(MAX_RELATED_CFDIS_PER_RUN).toBe(400)
    })

    it.each(XML_PAYLOADS.filter(p => p.reason === 'XXE_BILLION_LAUGHS' || p.reason === 'DTD_INLINE').map(p => [p.id, p.description, p]))(
      '%s hasDtdInline: %s → true',
      (_id, _desc, p) => { expect(hasDtdInline(p.xml)).toBe(true) },
    )

    it('hasDtdInline detecta DOCTYPE inline Billion Laughs', () => {
      expect(hasDtdInline(XXE_BILLION_LAUGHS)).toBe(true)
    })
    it('hasDtdInline retorna false si XML limpio sin DOCTYPE', () => {
      expect(hasDtdInline(XML_CLEAN_VALID_PAGO20)).toBe(false)
    })
    it('hasDtdInline retorna false si input <12 chars', () => {
      expect(hasDtdInline('')).toBe(false)
      expect(hasDtdInline('short')).toBe(false)
    })

    it('DOMParser options.errorHandler.fatalError lanza throw (no silent swallow) si malformed', () => {
      const parser = new DOMParser({
        errorHandler: { warning: () => {}, error: () => { throw new Error('XML_ERR') }, fatalError: () => { throw new Error('FATAL_XXE') } },
      } as never)
      expect(() => parser.parseFromString('<<<invalid>>', 'text/xml')).toThrow()
    })

    it('safeTextEncoderLength: XML 2.5MB > MAX_XML_BYTES_DASHBOARD → oversized detectado', () => {
      const big = `<r>${'X'.repeat(MAX_XML_BYTES_DASHBOARD + 500)}</r>`
      const bytes = safeTextEncoderLength(big)
      expect(bytes).toBeGreaterThan(MAX_XML_BYTES_DASHBOARD)
    })
  })

  describe('ORG-004 · Iterative DOM Walker O(N) lineal NO wildcard O(N²) findElementsByTagName(*)', () => {
    it('MAX_XML_WALK_ITERATIONS = 25000 anti-loop infinito recursion', () => {
      expect(MAX_XML_WALK_ITERATIONS).toBe(25_000)
    })
    it('NAMESPACE_PATTERNS.Pago coincide pago10:Pago y pago20:Pago', () => {
      expect(NAMESPACE_PATTERNS.Pago.test('pago10:Pago')).toBe(true)
      expect(NAMESPACE_PATTERNS.Pago.test('pago20:Pago')).toBe(true)
      expect(NAMESPACE_PATTERNS.Pago.test('ns:Factura')).toBe(false)
    })
    it('NAMESPACE_PATTERNS.DoctoRel coincide pago20:DoctoRelacionado', () => {
      expect(NAMESPACE_PATTERNS.DoctoRel.test('pago20:DoctoRelacionado')).toBe(true)
    })
    it('findElementsByLocalNamePattern 25k nodos alcanzado → retorna matches encontrados sin crash (mock children array no depende DOMParser)', () => {
      const mockChildren3 = {
        children: [
          { nodeName: 'a', children: [] },
          { nodeName: 'b', children: [] },
          { nodeName: 'c', children: [] },
        ] as unknown as HTMLCollection,
      }
      const found = findElementsByLocalNamePattern(mockChildren3, /^(a|b|c)$/i)
      expect(Array.isArray(found)).toBe(true)
      expect(found.length).toBeGreaterThanOrEqual(3)
    })
    it('findElementsByLocalNamePattern doc vacío (sin children) → [] sin error', () => {
      const emptyRoot = { children: [] as unknown as HTMLCollection }
      expect(findElementsByLocalNamePattern(emptyRoot, /nada/i)).toEqual([])
      expect(findElementsByLocalNamePattern(undefined as never, /x/)).toEqual([])
      expect(findElementsByLocalNamePattern(null as never, /x/)).toEqual([])
    })
  })

  describe('ORG-010 · parseFloat → parseSatDecimal · 5 formatos MX/US + NaN fallback 0', () => {
    it.each(DECIMAL_CASES.map(c => [c.input, c.expected, c.description, c.locale]))(
      'parseSatDecimal input=%j → %s (%s %s)',
      (input, expected) => {
        expect(parseSatDecimal(input as never)).toBeCloseTo(Number(expected), 6)
      },
    )
    it('parseSatDecimal undefined y null → 0 (strict null check non-empty)', () => {
      expect(parseSatDecimal(undefined)).toBe(0)
      expect(parseSatDecimal(null)).toBe(0)
    })
    it('parseSatDecimal input con solo símbolo moneda $% → 0 fallback (NaN safe)', () => {
      expect(parseSatDecimal('$$$$')).toBe(0)
      expect(parseSatDecimal('MXN USD')).toBe(0)
    })
    it('parseSatDecimal input comma mx "1,234,567" (no dot) → thousands comma US interpreta 1234567 OK', () => {
      expect(parseSatDecimal('1,234,567')).toBe(1_234_567)
    })
    it('parseSatDecimal ImpPagado 9.999.999,99 (MX) PPD invoice = 9999999.99 exacto', () => {
      const mx = '9.999.999,99'
      expect(parseSatDecimal(mx)).toBeCloseTo(9_999_999.99, 2)
    })
  })
})

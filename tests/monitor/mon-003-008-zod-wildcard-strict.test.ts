import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'
import { buildSafeLikePattern, fp32, parseUniqueSearchParams } from '@/lib/monitor-security-helpers'
import { MonitorStatsQuerySchema } from '@/app/api/monitor/stats/route'
import { MonitorRunsQuerySchema } from '@/app/api/monitor/runs/route'
import { MonitorRunItemsParamsSchema, MonitorRunItemsQuerySchema } from '@/app/api/monitor/runs/[importRunId]/items/route'
import { MonitorItemDetailParamsSchema } from '@/app/api/monitor/items/[itemId]/route'
import { MonitorDrilldownErrorsQuerySchema } from '@/app/api/monitor/drilldowns/errors/route'
import { PAYLOADS, VALID_UUID_V4_SAMPLE } from './fixtures/payloads'

describe('MON-003 · ILIKE Wildcard Injection Prevention (buildSafeLikePattern + ESCAPE clause)', () => {
  it('MON-003: search "%" × 80 wildcards → pattern escapado con \\%. ESCAPE char = backslash. 0 wildcards sin escape (count)', () => {
    const search = '%'.repeat(80)
    const r = buildSafeLikePattern(search)
    expect(r.escapeChar).toBe('\\')
    expect(r.pattern.startsWith('%')).toBe(true)
    expect(r.pattern.endsWith('%')).toBe(true)
    const inner = r.pattern.slice(1, -1)
    const nonEscapedPercentCount = (inner.match(/(?<!\\)%/g) || []).length
    expect(nonEscapedPercentCount).toBe(0)
  })

  it('MON-003: search "\\\\%_ATAQUE" mix backslash + percent + underscore → 3 chars todos escapados. No wildcards sin escape.', () => {
    const r = buildSafeLikePattern('\\%_ATAQUE')
    const inner = r.pattern.slice(1, -1)
    expect(inner).toContain('\\\\')
    expect(inner).toContain('\\%')
    expect(inner).toContain('\\_')
    const unescapedPct = inner.match(/(?<!\\)%/g) || []
    const unescapedUnd = inner.match(/(?<!\\)_/g) || []
    expect(unescapedPct.length).toBe(0)
    expect(unescapedUnd.length).toBe(0)
  })

  it('MON-003: search texto normal "Lote Enero-2025 Batch-A1b2" → pattern %texto% sin escapes innecesarios', () => {
    const r = buildSafeLikePattern('Lote Enero-2025 Batch-A1b2')
    expect(r.pattern).toBe('%Lote Enero-2025 Batch-A1b2%')
  })

  it('MON-003: fp32() siempre retorna 8 hex chars lowercase (espacio 2^32). 1000 strings aleatorios = len 8 y hex', () => {
    for (let i = 0; i < 1000; i++) {
      const s = fp32(`random-salt-${i}-${Date.now()}`)
      expect(s.length).toBe(8)
      expect(/^[0-9a-f]{8}$/.test(s)).toBe(true)
    }
  })

  it('MON-003: fp32(hex_largo_32chars) → truncado a primeros 8 (no hashea de nuevo)', () => {
    const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    expect(fp32(hex)).toBe('a1b2c3d4')
  })
})

describe('MON-008 · Zod strictObject Overposting / Prototype Pollution Prevention (5 Schemas Exportados)', () => {
  it('MON-008: 5 schemas exported son STRICT. Campo unknown "badField_123" + prototype pollution → ZodError en TODOS', () => {
    const pollutedInput = {
      badField_123: 'pwned',
      '__proto__[polluted]': '1',
      'constructor.prototype.pwn': '2'
    }
    const schemas: Array<[string, z.ZodTypeAny, Record<string, unknown>]> = [
      ['MonitorStatsQuerySchema', MonitorStatsQuerySchema, { status: 'COMPLETED', ...pollutedInput }],
      ['MonitorRunsQuerySchema', MonitorRunsQuerySchema, { page: '1', ...pollutedInput }],
      ['MonitorRunItemsParamsSchema', MonitorRunItemsParamsSchema, { ...pollutedInput, importRunId: VALID_UUID_V4_SAMPLE }],
      ['MonitorRunItemsQuerySchema', MonitorRunItemsQuerySchema, { page: '1', ...pollutedInput }],
      ['MonitorItemDetailParamsSchema', MonitorItemDetailParamsSchema, { ...pollutedInput, itemId: VALID_UUID_V4_SAMPLE }],
      ['MonitorDrilldownErrorsQuerySchema', MonitorDrilldownErrorsQuerySchema, { status: 'FAILED', ...pollutedInput }],
    ]
    for (const [name, schema, input] of schemas) {
      const r = schema.safeParse(input)
      expect(r.success).toBe(false)
      expect(name).toBeTruthy()
    }
  })

  it('MON-008: parseUniqueSearchParams detecta llaves DUPLICADAS (Object.fromEntries silenciosamente overridea → Fail-CLOSED throw Error)', () => {
    const sp = new URLSearchParams()
    sp.append('status', 'COMPLETED')
    sp.append('status', 'FAILED') // duplicate!
    expect(() => parseUniqueSearchParams(sp)).toThrow()
  })

  it('MON-008: parseUniqueSearchParams con params clean (sin duplicates) → retorna object llave-valor OK', () => {
    const sp = new URLSearchParams()
    sp.append('status', 'COMPLETED')
    sp.append('page', '1')
    const r = parseUniqueSearchParams(sp)
    expect(r.status).toBe('COMPLETED')
    expect(r.page).toBe('1')
    expect(Object.keys(r).length).toBe(2)
  })

  it('MON-PAY-070/071 Fixtures validan strict behavior. Parametrizado sobre PAYLOADS findingId MON-008', () => {
    const zstrictPayloads = PAYLOADS.filter((p) => p.findingId === 'MON-008' && p.kind === 'query_get')
    expect(zstrictPayloads.length).toBeGreaterThanOrEqual(2)
    for (const p of zstrictPayloads) {
      if (p.kind !== 'query_get') continue
      let schema: z.ZodTypeAny
      if (p.route === 'monitor_stats') schema = MonitorStatsQuerySchema
      else if (p.route === 'monitor_runs') schema = MonitorRunsQuerySchema
      else if (p.route === 'monitor_drilldown_errors') schema = MonitorDrilldownErrorsQuerySchema
      else continue
      const r = schema.safeParse(p.urlQuery)
      expect(r.success).toBe(false)
    }
  })
})

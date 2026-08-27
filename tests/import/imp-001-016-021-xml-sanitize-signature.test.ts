 
import { describe, it, expect } from '@jest/globals'
import {
  detectXXEBytes,
  createConceptoRegexSafe,
  isStrictRfc4122Uuid,
  csvCellEscape,
  RFC4122_UUID_STRICT
} from '@/lib/xml-sanitize'
import { verifyTimbreFiscalDigitalBaseline } from '@/lib/invoice-import'
import { IMP_PAYLOADS } from './fixtures/payloads'

describe('IMP-001 · XXE regex bypass nivel byte', () => {
  it('IMP_001_XXE_BOM: UTF-8 BOM + <!DOCTYPE → detectXXEBytes bom-sniff', () => {
    const xml = IMP_PAYLOADS.IMP_001_XXE_BOM
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).not.toBeNull()
    expect(v?.blocked).toBe(true)
    expect(['bom-sniff', 'doctype-whitespace-newline', 'doctype-raw', 'doctype-comment-interleave']).toContain(v?.kind)
  })

  it('IMP_001_XXE_COMMENT_INTERLEAVE: <!-- hack --> antes DOCTYPE → detectado', () => {
    const xml = IMP_PAYLOADS.IMP_001_XXE_COMMENT_INTERLEAVE
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).not.toBeNull()
    expect(v?.blocked).toBe(true)
    expect(['doctype-comment-interleave', 'doctype-whitespace-newline', 'doctype-raw', 'bom-sniff']).toContain(v?.kind)
  })

  it('IMP_001_XXE_WHITESPACE: <\\n!DOCTYPE newline antes → detect doctype o ENTITY variant', () => {
    const xml = IMP_PAYLOADS.IMP_001_XXE_WHITESPACE
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).not.toBeNull()
    expect(v?.blocked).toBe(true)
    expect([
      'doctype-whitespace-newline', 'doctype-raw', 'doctype-comment-interleave',
      'entity-inline-keyword', 'entity-parameter', 'entity-system-public'
    ]).toContain(v?.kind)
  })

  it('IMP_016_BILLION_LAUGHS: ENTITY 9 niveles → billion-laughs-depth o cardinality', () => {
    const xml = IMP_PAYLOADS.IMP_016_BILLION_LAUGHS
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).not.toBeNull()
    expect(v?.blocked).toBe(true)
    expect(['billion-laughs-depth', 'billion-laughs-cardinality', 'entity-inline-keyword', 'entity-parameter', 'doctype-whitespace-newline', 'doctype-raw']).toContain(v?.kind)
  })

  it('IMP_001_ENTITY_PARAMETER: <!ENTITY % → entity-parameter kind', () => {
    const xml = IMP_PAYLOADS.IMP_001_ENTITY_PARAMETER
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).not.toBeNull()
    expect(v?.blocked).toBe(true)
    expect(['entity-parameter', 'doctype-whitespace-newline', 'doctype-raw', 'entity-inline-keyword', 'entity-system-public']).toContain(v?.kind)
  })

  it('IMP_001_ENTITY_SYSTEM: SYSTEM "file:///etc/passwd" → entity-system-public', () => {
    const xml = IMP_PAYLOADS.IMP_001_ENTITY_SYSTEM
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).not.toBeNull()
    expect(v?.blocked).toBe(true)
    expect(['entity-system-public', 'entity-inline-keyword', 'doctype-whitespace-newline', 'doctype-raw']).toContain(v?.kind)
  })

  it('CFDI limpio sin doctype: detectXXEBytes = null', () => {
    const xml = IMP_PAYLOADS.CLEAN_CFDI_VALIDO
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).toBeNull()
  })
})

describe('IMP-002 · ReDoS conceptoRegex safe', () => {
  it('createConceptoRegexSafe.matchAll: 5 conceptos cerrados retorna 5 matches correctos', () => {
    const xml = IMP_PAYLOADS.IMP_002_VALID_CONCEPTOS_5
    const safe = createConceptoRegexSafe()
    const matches = safe.matchAll(xml)
    expect(matches.length).toBe(5)
    for (const m of matches) {
      expect(typeof m.index).toBe('number')
      expect(m.attrs.length).toBeGreaterThan(5)
    }
  })

  it('createConceptoRegexSafe: Conceptos sin cerrar no cuelgan (timeout-safe ≤ 200ms)', () => {
    const xml = IMP_PAYLOADS.IMP_002_REDOS_UNCLOSED
    const t0 = Date.now()
    const safe = createConceptoRegexSafe()
    const matches = safe.matchAll(xml)
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(500)
    expect(Array.isArray(matches)).toBe(true)
  })

  it('IMP_002_CONCEPT_LIMIT_7000: >5000 conceptos → kind concept-count-exceeded', () => {
    const xml = IMP_PAYLOADS.IMP_002_CONCEPT_LIMIT_7000
    const v = detectXXEBytes(Buffer.from(xml, 'utf8'))
    expect(v).not.toBeNull()
    expect(v?.kind).toBe('concept-count-exceeded')
    expect(v?.blocked).toBe(true)
  })
})

describe('IMP-021 · SAT Signature TimbreFiscalDigital baseline', () => {
  it('IMP_021_TIMBRE_MISSING: CFDI sin TimbreFiscalDigital → reason Falta nodo TimbreFiscalDigital', () => {
    const xml = IMP_PAYLOADS.IMP_021_TIMBRE_MISSING
    const r = verifyTimbreFiscalDigitalBaseline(xml)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/TimbreFiscalDigital/)
  })

  it('IMP_021_UUID_INVALID_VERSION: UUID FFFFFFFF-FFFF-0FFF → rechazado RFC 4122', () => {
    const xml = IMP_PAYLOADS.IMP_021_UUID_INVALID_VERSION
    const r = verifyTimbreFiscalDigitalBaseline(xml)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/RFC 4122/)
  })

  it('IMP_021_NO_CERTIFICADO_19DIG: NoCertificado 19 dígitos → inválido', () => {
    const xml = IMP_PAYLOADS.IMP_021_NO_CERTIFICADO_19DIG
    const r = verifyTimbreFiscalDigitalBaseline(xml)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/20 dígitos/)
  })

  it('IMP_021_SELLO_CFD_30CH: SelloCFD 30 chars → inválido', () => {
    const xml = IMP_PAYLOADS.IMP_021_SELLO_CFD_30CH
    const r = verifyTimbreFiscalDigitalBaseline(xml)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/SelloCFD/)
  })

  it('CLEAN_CFDI_VALIDO: verifyTimbreFiscalDigitalBaseline.valid = true', () => {
    const xml = IMP_PAYLOADS.CLEAN_CFDI_VALIDO
    const r = verifyTimbreFiscalDigitalBaseline(xml)
    expect(r.valid).toBe(true)
    expect(r.uuid?.toUpperCase()).toBe(r.uuid)
    expect(/^[0-9]{20}$/.test(r.rfcProvCertif || '')).toBe(true)
  })
})

describe('IMP-022 aux: isStrictRfc4122Uuid / csvCellEscape unitarios', () => {
  const TAB = String.fromCharCode(9)
  it('RFC 4122 V4 random: true', () => {
    expect(isStrictRfc4122Uuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
    expect(isStrictRfc4122Uuid('6BA7B810-9DAD-11D1-80B4-00C04FD430C8')).toBe(true)
    expect(isStrictRfc4122Uuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isStrictRfc4122Uuid('550e8400-e29b-41d4-b716-446655440000')).toBe(true)
  })
  it('RFC 4122 inválidos variantes: false', () => {
    expect(isStrictRfc4122Uuid('550e8400-e29b-41d4-0716-446655440000')).toBe(false)
    expect(isStrictRfc4122Uuid('550e8400-e29b-01d4-a716-446655440000')).toBe(false)
    expect(isStrictRfc4122Uuid('no-uuid-string')).toBe(false)
    expect(isStrictRfc4122Uuid(123 as unknown)).toBe(false)
    expect(RFC4122_UUID_STRICT.test('550e8400-e29b-41d4-c716-446655440000')).toBe(false)
  })
  it('csvCellEscape formulas peligrosas: prefijo apostrofo', () => {
    expect(csvCellEscape('=SUM(1,2,3)').startsWith("'")).toBe(true)
    expect(csvCellEscape('+calc.exe!').startsWith("'")).toBe(true)
    expect(csvCellEscape('-2+3;cmd').startsWith("'")).toBe(true)
    expect(csvCellEscape('@SUM(A1:A5)').startsWith("'")).toBe(true)
    expect(csvCellEscape(TAB + '=cmd').startsWith("'")).toBe(true)
    expect(csvCellEscape('|1=1').startsWith("'")).toBe(true)
    expect(csvCellEscape('%0A=HYPERLINK').startsWith("'")).toBe(true)
  })
  it('csvCellEscape texto normal: sin cambios', () => {
    expect(csvCellEscape('Factura 123')).toBe('Factura 123')
    expect(csvCellEscape('ODE8604257UA')).toBe('ODE8604257UA')
    expect(csvCellEscape('')).toBe('')
    expect(csvCellEscape(null)).toBe('')
    expect(csvCellEscape(undefined)).toBe('')
  })
})

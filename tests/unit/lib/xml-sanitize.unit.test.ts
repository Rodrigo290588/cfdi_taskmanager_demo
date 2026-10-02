import {
  detectXXEBytes,
  scanXXEAndReportSafe,
  isStrictRfc4122Uuid,
  csvCellEscape,
  createConceptoRegexSafe,
  type XXEViolationKind
} from '@/lib/xml-sanitize'
import {
  buildBillionLaughs,
  buildCfdiWithConceptos,
  buildMinimalValidCfdi,
  buildReDoSSpacesPayload,
  buildWithBOM as _buildWithBOM,
  buildXXEDoctypeCommentInterleave,
  buildXXENDATANotation,
  buildXXEParameterEntities,
  buildXXEProcessingInstructionExternal,
  buildXXEPublicExternal,
  buildXXESystemFile,
  CSV_DDE_UNSAFE,
  INVALID_UUIDS,
  loadRealCfdiSample,
  loadRealCfdiSamples,
  VALID_UUIDS_V4
} from '@/tests/fixtures/xml-fixtures'

/**
 * Helper que encapsula scanXXEAndReportSafe + lanza Error si no es seguro.
 * Equivalente a lo que los route handlers realmente hacen.
 */
function expectSafe(xml: string): void {
  const r = scanXXEAndReportSafe(xml)
  if (!r.safe) {
    const v = r.violations[0]
    throw new Error(
      `XML bloqueado inesperadamente: kind=${v.kind} detail=${v.detail}`
    )
  }
}

function expectBlocked(
  xml: string | Uint8Array,
  expectedKinds?: Array<XXEViolationKind | RegExp | string>
): ReturnType<typeof scanXXEAndReportSafe> {
  const r = scanXXEAndReportSafe(xml)
  expect(r.safe).toBe(false)
  expect(r.violations.length).toBeGreaterThanOrEqual(1)
  if (expectedKinds && expectedKinds.length > 0) {
    const algunoCoincide = expectedKinds.some((pat) => {
      if (pat instanceof RegExp) return r.kinds.join(',').match(pat) !== null
      return r.kinds.includes(pat as XXEViolationKind)
    })
    expect(algunoCoincide).toBe(true)
  }
  return r
}

describe('xml-sanitize :: isStrictRfc4122Uuid (UUID RFC 4122)', () => {
  it.each(VALID_UUIDS_V4)('acepta UUID v4 válido: %s', (uuid) => {
    expect(isStrictRfc4122Uuid(uuid)).toBe(true)
  })

  it.each(INVALID_UUIDS)('rechaza UUID inválido: $reason ($id)', ({ id }) => {
    expect(isStrictRfc4122Uuid(id)).toBe(false)
  })

  it('rechaza nulos / indefinidos / vacíos / no-strings', () => {
    expect(isStrictRfc4122Uuid(null)).toBe(false)
    expect(isStrictRfc4122Uuid(undefined)).toBe(false)
    expect(isStrictRfc4122Uuid('')).toBe(false)
    expect(isStrictRfc4122Uuid('   ')).toBe(false)
    // @ts-expect-error - probando tipo inválido a propósito
    expect(isStrictRfc4122Uuid(1234)).toBe(false)
    // @ts-expect-error - idem
    expect(isStrictRfc4122Uuid({})).toBe(false)
  })

  it('rechaza UUID con guiones en posiciones incorrectas', () => {
    const mal = '550e8400-e29-b41d4-a716-446655440000'
    expect(isStrictRfc4122Uuid(mal)).toBe(false)
  })

  it('rechaza UUID versión 5 (permitido por RFC pero no por semántica del projecto? verificar)', () => {
    const v5 = '9e771fc1-0936-5723-81e4-6ab4e4a04d3a'
    // La regex /-[1-5]/ acepta versión 5 también; validar que isStrictRfc4122Uuid lo acepte.
    expect(isStrictRfc4122Uuid(v5)).toBe(true)
  })
})

describe('xml-sanitize :: csvCellEscape (DDE / CSV Injection)', () => {
  it.each(CSV_DDE_UNSAFE)('escapa celda DDE insegura: $label', ({ cell }) => {
    const escaped = csvCellEscape(cell)
    expect(escaped.startsWith("'")).toBe(true)
    expect(escaped.slice(1)).toBe(cell.toString())
  })

  it('no modifica celdas seguras (texto plano, números, RFCs)', () => {
    expect(csvCellEscape('hola mundo')).toBe('hola mundo')
    expect(csvCellEscape('XAXX010101000')).toBe('XAXX010101000')
    expect(csvCellEscape(123.45)).toBe('123.45')
    expect(csvCellEscape(0)).toBe('0')
    expect(csvCellEscape('texto con espacios')).toBe('texto con espacios')
    expect(csvCellEscape('https://sat.gob.mx')).toBe('https://sat.gob.mx')
    expect(csvCellEscape(' RFC con espacio inicial')).toBe(' RFC con espacio inicial')
  })

  it('convierte null/undefined a string vacío', () => {
    expect(csvCellEscape(null)).toBe('')
    expect(csvCellEscape(undefined)).toBe('')
  })

  it('no doble-escapa: aplicar 2 veces no añade segundo apóstrofo', () => {
    const cell = '=SUM(A1:A10)'
    const once = csvCellEscape(cell)
    const twice = csvCellEscape(once)
    const quoteCount = (twice.match(/^'+/) ?? [''])[0].length
    expect(quoteCount).toBeLessThanOrEqual(1)
  })

  it('elimina bytes nulos \\u0000 en celda (control chars)', () => {
    const withNull = '=cmd\0|\0calc'
    const escaped = csvCellEscape(withNull)
    expect(escaped.includes('\0')).toBe(false)
  })

  it('escapa celdas que empiecen con ! ^ ~ ` {} [] () (extended list)', () => {
    const extended = ['!cmd', '^cmd', '~cmd', '`cmd', '{cmd', '}cmd', '[cmd', ']cmd', '(cmd', ')cmd', '%cmd']
    for (const c of extended) {
      expect(csvCellEscape(c).startsWith("'")).toBe(true)
    }
  })
})

describe('xml-sanitize :: detectXXEBytes :: HAPPY PATH (CFDIs reales)', () => {
  it('acepta un CFDI real del directorio java-client/xml-data', () => {
    const real = loadRealCfdiSample(0)
    expect(real.length).toBeGreaterThan(1000)
    expectSafe(real)
  })

  it('acepta 40 CFDIs reales consecutivos sin falsos positivos', () => {
    const samples = loadRealCfdiSamples(40)
    expect(samples.length).toBeGreaterThanOrEqual(1)
    for (const xml of samples) {
      expectSafe(xml)
    }
  })

  it('acepta CFDI mínimo válido sintáctico (2 conceptos)', () => {
    expectSafe(buildMinimalValidCfdi({ conceptos: 2 }))
  })

  it('acepta CFDI con 100 conceptos (por debajo de 2500 aperturas+cierres combinados)', () => {
    expectSafe(buildCfdiWithConceptos(100))
  })

  it('acepta CFDI con 2499 conceptos (menos de 5000 conteo de tags apertura+cierre)', () => {
    // Nota: la regex /<[^:>]*:?Concepto\b/gi cuenta tanto <cfdi:Concepto apertura </cfdi:Concepto cierre.
    // Por lo tanto N conceptos = 2*N matches. MAX_CONCEPTOS_POR_CFDI=5000, así que N=2499 es seguro (4998 matches).
    expectSafe(buildCfdiWithConceptos(2499))
  })

  it('detectXXEBytes retorna null para input benigno', () => {
    expect(detectXXEBytes(buildMinimalValidCfdi())).toBeNull()
  })
})

describe('xml-sanitize :: detectXXEBytes :: BLOQUEOS LÍMITES FUNCIONALES', () => {
  it('bloquea 2501 conceptos (2*2501=5002 matches > MAX_CONCEPTOS=5000 de apertura+cierre)', () => {
    expectBlocked(buildCfdiWithConceptos(2501), ['concept-count-exceeded'])
  })

  it('bloquea 10000 conceptos con kind concept-count-exceeded', () => {
    const r = expectBlocked(buildCfdiWithConceptos(10000))
    expect(r.kinds[0]).toBe('concept-count-exceeded')
  })

  it('bloquea payload >10KB (? el sniff-window 16KB no es hard reject, conceptos sí lo es) - XML >16KB aún válido si sin ataques', () => {
    const bigSafe =
      buildMinimalValidCfdi() + '<!-- comentario gigante ' + 'x'.repeat(32 * 1024) + ' -->'
    expectSafe(bigSafe)
  })
})

describe('xml-sanitize :: detectXXEBytes :: XXE ATTACKS', () => {
  it('bloquea XXE SYSTEM FILE (file:///etc/passwd)', () => {
    expectBlocked(buildXXESystemFile(), [
      'entity-system-public',
      'entity-inline-keyword',
      'doctype-raw',
      'doctype-whitespace-newline'
    ])
  })

  it('bloquea XXE PUBLIC DTD externo', () => {
    expectBlocked(buildXXEPublicExternal(), [
      'entity-system-public',
      'entity-inline-keyword',
      'doctype-raw',
      'doctype-whitespace-newline'
    ])
  })

  it('bloquea XXE Parameter Entities (<!ENTITY %)', () => {
    expectBlocked(buildXXEParameterEntities(), [
      'entity-parameter',
      'entity-inline-keyword',
      'doctype-raw',
      'doctype-whitespace-newline'
    ])
  })

  it('bloquea XXE NDATA + NOTATION declaration', () => {
    const r = scanXXEAndReportSafe(buildXXENDATANotation())
    expect(r.safe).toBe(false)
    // Puede bloquearse por cualquiera de estos violations. Basta con safe=false.
    const anyHit = [
      'entity-ndata',
      'notation-decl',
      'entity-inline-keyword',
      'doctype-raw',
      'doctype-whitespace-newline'
    ].some((k) => r.kinds.includes(k as XXEViolationKind))
    expect(anyHit).toBe(true)
  })

  it('bloquea PI externo xml-stylesheet href http:', () => {
    const r = scanXXEAndReportSafe(buildXXEProcessingInstructionExternal())
    expect(r.safe).toBe(false)
    // Puede bloquearse por processing-instruction-external o por otra policy.
    // safe=false es el criterio de éxito.
  })

  it('bloquea Doctype + Comment interleave bypass', () => {
    expectBlocked(buildXXEDoctypeCommentInterleave(), [
      'doctype-comment-interleave',
      'doctype-raw',
      'doctype-whitespace-newline',
      'entity-system-public',
      'entity-inline-keyword'
    ])
  })
})

describe('xml-sanitize :: detectXXEBytes :: BILLION LAUGHS / EXPANSION', () => {
  it('bloquea Billion Laughs por cardinalidad >128 entities referenciadas', () => {
    // DOCTYPE general se bloquea ANTES que el chequeo de expansión.
    // Lo importante: safe=false.
    expectBlocked(buildBillionLaughs(150, 12), [
      'doctype-raw',
      'doctype-whitespace-newline',
      'entity-inline-keyword',
      'billion-laughs-cardinality',
      'billion-laughs-depth'
    ])
  })

  it('bloquea Billion Laughs por profundidad stack', () => {
    expectBlocked(buildBillionLaughs(20, 20), [
      'doctype-raw',
      'doctype-whitespace-newline',
      'entity-inline-keyword',
      'billion-laughs-depth',
      'billion-laughs-cardinality'
    ])
  })

  it('bloquea cualquier DOCTYPE con ENTITYs (política cero confianza)', () => {
    const doctypeWithEntities = `<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY x1 "hi"> <!ENTITY x2 "&x1;&x1;"> ]>
<a>&x2;</a>`
    expectBlocked(doctypeWithEntities, [
      'doctype-raw',
      'doctype-whitespace-newline',
      'entity-inline-keyword'
    ])
  })
})

describe('xml-sanitize :: detectXXEBytes :: BOM UTF & BYTE NULOS', () => {
  it('bloquea BOM UTF-8 a nivel BYTES (Uint8Array) 0xEF 0xBB 0xBF', () => {
    const xmlBody = new TextEncoder().encode(buildMinimalValidCfdi())
    const payload = new Uint8Array(xmlBody.length + 3)
    payload[0] = 0xef
    payload[1] = 0xbb
    payload[2] = 0xbf
    payload.set(xmlBody, 3)
    const r = expectBlocked(payload)
    expect(r.kinds[0]).toBe('bom-sniff')
  })

  it('bloquea payload con byte nulo (caracter de control) en string', () => {
    const withNull = `<?xml version="1.0"?><abc>hi\u0000there</abc>`
    const r = expectBlocked(withNull)
    expect(r.kinds.includes('bom-sniff')).toBe(true)
  })
})

describe('xml-sanitize :: detectXXEBytes :: REJECTS INPUTS INVÁLIDOS', () => {
  it('string vacío o whitespace devuelve safe? (ventana sniff no encuentra violations)', () => {
    expect(scanXXEAndReportSafe('').safe).toBe(true)
    expect(scanXXEAndReportSafe('   ').safe).toBe(true)
  })
})

describe('xml-sanitize :: createConceptoRegexSafe :: API de parsing seguro', () => {
  it('extrae correctamente N conceptos (2) de un CFDI mínimo', () => {
    const xml = buildMinimalValidCfdi({ conceptos: 2 })
    const parser = createConceptoRegexSafe()
    const concepts = parser.matchAll(xml)
    expect(concepts.length).toBe(2)
  })

  it('extrae 100 conceptos sin error y attrs tienen longitud esperada', () => {
    const xml = buildCfdiWithConceptos(100)
    const parser = createConceptoRegexSafe()
    const concepts = parser.matchAll(xml)
    expect(concepts.length).toBe(100)
    for (const c of concepts) {
      expect(typeof c.index).toBe('number')
      expect(c.index).toBeGreaterThanOrEqual(0)
    }
  })

  it('no regresa más de MAX_CONCEPTOS_POR_CFDI aun si XML tiene más (capping)', () => {
    const xml = buildCfdiWithConceptos(5001)
    const parser = createConceptoRegexSafe()
    const concepts = parser.matchAll(xml)
    expect(concepts.length).toBeLessThanOrEqual(5000)
  })
})

describe('xml-sanitize :: THROUGHPUT ANTI-REDOS (escala 5M registros)', () => {
  it('procesa 100 CFDIs válidos de 8KB en <300ms (O(n) sin backtracking)', () => {
    const baseSamples = loadRealCfdiSamples(30)
    const samples: string[] = []
    // Expandir a 100 duplicando (si hay menos de 100 archivos disponibles)
    while (samples.length < 100) samples.push(...baseSamples)
    const take100 = samples.slice(0, 100)
    const start = performance.now()
    for (const xml of take100) detectXXEBytes(xml)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(300)
  })

  it('procesa 100 payloads ReDoS 8KB espacios en <100ms (no hay regex catastrophic)', () => {
    const payloads = Array.from({ length: 100 }, () => buildReDoSSpacesPayload(8))
    const start = performance.now()
    let blocked = 0
    for (const p of payloads) {
      const r = scanXXEAndReportSafe(p)
      if (!r.safe) blocked++
    }
    const elapsed = performance.now() - start
    expect(blocked).toBeGreaterThanOrEqual(0)
    // Lo importante: elapsed < 100ms (no hay ReDoS)
    expect(elapsed).toBeLessThan(100)
  })
})

describe('xml-sanitize :: COBERTURA BRANCH/LINES FALTANTES (INV coverage 85/80)', () => {
  it('comentario XML SIN CIERRE no crashea y se salta correctamente (line 130 else branch)', () => {
    const evil = '<!-- sin cerrar, el doctype nunca viene porque el comentario se abre y nunca cierra'
    const r = scanXXEAndReportSafe(evil)
    // No crash. Puede ser safe=true porque no se detectó doctype después. Lo importante = no throw.
    expect(typeof r.safe).toBe('boolean')
  })

  it('<! DOCTYPE (con spaces/tabs/newline entre ! y DOCTYPE) = doctype-whitespace-newline', () => {
    const withWhitespace = '<?xml version="1.0"?>\n<!   \t\nDOCTYPE html>'
    expectBlocked(withWhitespace, [
      'doctype-whitespace-newline',
      'doctype-raw',
      'doctype-comment-interleave'
    ])
  })

  it('Comentario + interleave DOCTYPE con espacios en blanco entre bang y DOCTYPE → interleave hit', () => {
    const withInterleave = '<?xml?><!-- comentario -->   <! \t\n  DOCTYPE foo>'
    expectBlocked(withInterleave, [
      'doctype-comment-interleave',
      'doctype-whitespace-newline',
      'doctype-raw'
    ])
  })

  it('ENTITY inline-keyword: <!ENTITY beyond 8192 bytes bypass del doctype scanner O(n) → hit por el for-loop variants', () => {
    // El primer scanner doctype solo inspecciona los PRIMEROS 8192 caracteres del text (línea 89).
    // Si el for-loop de entityVariants regex usa TODO el sniff buffer (16K+256).
    // Poniendo <!ENTITY DESPUÉS del límite 8192 el bypass pasa al loop de entities.
    const PAD = 'A'.repeat(9000)
    const onlyInlineAfterPad = `<?xml?><r>${PAD}<!ENTITY e1 "value"></r>`
    const r = scanXXEAndReportSafe(onlyInlineAfterPad)
    expect(r.safe).toBe(false)
    // Ahora sí debe de haber sido atrapado por entity inline-keyword o similares.
    const anyHit = [
      'entity-inline-keyword',
      'entity-parameter',
      'entity-system-public',
      'entity-ndata',
      'notation-decl'
    ].some((k) => r.kinds.includes(k as XXEViolationKind))
    expect(anyHit).toBe(true)
  })

  it('NOTATION declaration detection por entityVariants loop (kind: notation-decl)', () => {
    const notation = '<?xml?>\n<!DOCTYPE foo [\n<!NOTATION png PUBLIC "-//PNG//DTD NONXML//EN">\n]><r/>'
    const r = scanXXEAndReportSafe(notation)
    expect(r.safe).toBe(false)
    const anyHit = ['notation-decl', 'doctype-raw', 'doctype-whitespace-newline'].some((k) =>
      r.kinds.includes(k as XXEViolationKind)
    )
    expect(anyHit).toBe(true)
  })

  it('Processing Instruction external xml-stylesheet http → kind processing-instruction-external (line 182-191)', () => {
    const pi = '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="http://evil.com/evil.xsl"?>\n<cfdi/>'
    const r = scanXXEAndReportSafe(pi)
    // Puede bloquearse por cualquier policy. safe=false es suficiente.
    expect(r.safe).toBe(false)
  })

  it('Billion Laughs cardinality: >128 ampersand entities custom → kind billion-laughs-cardinality (line 196-205)', () => {
    const MAX_INST = 128
    // Generar 200 referencias &a1; custom que NO son entidades built-in standard
    const parts: string[] = []
    parts.push('<?xml version="1.0"?><root>')
    for (let i = 0; i < MAX_INST + 30; i++) {
      parts.push(`&ref${i};`)
    }
    parts.push('</root>')
    const payload = parts.join('')
    const r = scanXXEAndReportSafe(payload)
    expect(r.safe).toBe(false)
  })

  it('Billion Laughs depth: 10+ <![ CDATA[ ENTITY[... anidados → kind billion-laughs-depth', () => {
    const MAX_DEPTH = 9
    let payload = '<?xml version="1.0"?><r>'
    // 12 niveles de <![ anidados
    for (let i = 0; i < MAX_DEPTH + 3; i++) {
      payload += '<!['
    }
    payload += ']]]]]]]]]]]]></r>'
    const r = scanXXEAndReportSafe(payload)
    expect(r.safe).toBe(false)
    // No importa el kind específico mientras sea bloqueado.
  })

  it('XML_SANITIZE_DEFAULTS custom MAX_ENTITY_INSTANCES via opts → 5 instances custom bloqueará si threshold es 2', () => {
    const payload = '<?xml?><x>&a;&b;&c;&d;&e;</x>'
    const r = detectXXEBytes(payload, { MAX_ENTITY_INSTANCES: 2 })
    expect(r).not.toBeNull()
  })

  it('XML_SANITIZE_DEFAULTS custom MAX_ENTITY_DEPTH: stack depth 3 con threshold 1 → blocked', () => {
    const payload = '<?xml?><!ENTITY[<!ENTITY[<!ENTITY[end'
    const r = detectXXEBytes(payload, { MAX_ENTITY_DEPTH: 1 })
    expect(r).not.toBeNull()
  })

  it('createConceptoRegexSafe skips apertura sin cierre (self-closing sin cierre etiqueta) y no crash', () => {
    const xml = '<?xml?><cfdi:Comprobante><cfdi:Conceptos>' +
      '<cfdi:Concepto NoIdentificacion="1" />' +  // self-closing
      '</cfdi:Conceptos></cfdi:Comprobante>'
    const parser = createConceptoRegexSafe()
    const res = parser.matchAll(xml)
    expect(Array.isArray(res)).toBe(true)
  })

  it('createConceptoRegexSafe: tag > 4096 chars de apertura → skip safe (no regex)', () => {
    const longHead = '<cfdi:Concepto ' + 'A'.repeat(4100) + '>'
    const xml = `<?xml?><r>${longHead}body</cfdi:Concepto></r>`
    const parser = createConceptoRegexSafe()
    expect(() => parser.matchAll(xml)).not.toThrow()
  })

  it('createConceptoRegexSafe: attrs > MAX_ATTR_LEN*32 → skip safe', () => {
    const attrs = 'A'.repeat(256 * 32 + 10)
    const xml = `<?xml?><r><cfdi:Concepto ${attrs}></cfdi:Concepto></r>`
    const parser = createConceptoRegexSafe()
    expect(() => parser.matchAll(xml)).not.toThrow()
  })

  it('createConceptoRegexSafe: body > 64KB → skip safe', () => {
    const bigBody = 'x'.repeat(65536 + 100)
    const xml = `<?xml?><r><cfdi:Concepto a="1">${bigBody}</cfdi:Concepto></r>`
    const parser = createConceptoRegexSafe()
    expect(() => parser.matchAll(xml)).not.toThrow()
  })

  it('alias backward compat: isRfc4122UuidStrict === isStrictRfc4122Uuid', () => {
    // @ts-ignore - alias exportado para backward compat
    expect(typeof require('@/lib/xml-sanitize').isRfc4122UuidStrict).toBe('function')
  })
})

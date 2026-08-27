import { fingerprint } from '@/lib/security'

export type XXEViolationKind =
  | 'bom-sniff'
  | 'doctype-raw'
  | 'doctype-comment-interleave'
  | 'doctype-whitespace-newline'
  | 'entity-inline-keyword'
  | 'entity-system-public'
  | 'entity-parameter'
  | 'entity-ndata'
  | 'notation-decl'
  | 'processing-instruction-external'
  | 'billion-laughs-depth'
  | 'billion-laughs-cardinality'
  | 'concept-count-exceeded'

export interface XXEViolation {
  kind: XXEViolationKind
  index: number
  score: number
  blocked: true
  detail: string
  fingerprint: string
}

export const XML_SANITIZE_DEFAULTS = {
  MAX_ENTITY_DEPTH: 9,
  MAX_ENTITY_INSTANCES: 128,
  MAX_CONCEPTOS_POR_CFDI: 5000,
  SNIFF_WINDOW_BYTES: 16384,
  BOM_BYTES: [0xef, 0xbb, 0xbf, 0x00, 0x00, 0xfe, 0xff, 0xfe] as const
}

const BOM_SET: Set<number> = new Set([...XML_SANITIZE_DEFAULTS.BOM_BYTES] as number[])

function buildSniffBuffer(bytes: Uint8Array): Uint8Array {
  const win = XML_SANITIZE_DEFAULTS.SNIFF_WINDOW_BYTES
  if (bytes.length <= win) return bytes
  const out = new Uint8Array(win + 256)
  out.set(bytes.subarray(0, win), 0)
  out.set(bytes.subarray(bytes.length - 256), win)
  return out
}

export function detectXXEBytes(raw: Uint8Array | string, opts?: Partial<typeof XML_SANITIZE_DEFAULTS>): XXEViolation | null {
  const MAX_DEPTH = opts?.MAX_ENTITY_DEPTH ?? XML_SANITIZE_DEFAULTS.MAX_ENTITY_DEPTH
  const MAX_INSTANCES = opts?.MAX_ENTITY_INSTANCES ?? XML_SANITIZE_DEFAULTS.MAX_ENTITY_INSTANCES
  const MAX_CONCEPTOS = opts?.MAX_CONCEPTOS_POR_CFDI ?? XML_SANITIZE_DEFAULTS.MAX_CONCEPTOS_POR_CFDI

  const bytes: Uint8Array = typeof raw === 'string'
    ? (() => {
        const b = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i) & 0xff
        return b
      })()
    : raw

  if (bytes.length >= 3 && BOM_SET.has(bytes[0]) && BOM_SET.has(bytes[1]) && BOM_SET.has(bytes[2])) {
    const fp = fingerprint(`${bytes[0].toString(16)}-${bytes[1].toString(16)}-${bytes[2].toString(16)}-${bytes.length}`)
    return {
      kind: 'bom-sniff',
      index: 0,
      score: 100,
      blocked: true,
      detail: 'BOM UTF detectado. Parseo XXE regex clásico puede ser evadido con BOM. Rechazado por política anti-XXE nivel byte.',
      fingerprint: fp.slice(0, 16)
    }
  }

  const sniff = buildSniffBuffer(bytes)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(sniff)

  const nullIdx = text.indexOf('\u0000')
  if (nullIdx !== -1) {
    return {
      kind: 'bom-sniff',
      index: nullIdx,
      score: 100,
      blocked: true,
      detail: 'Byte nulo detectado en payload XML. Caracter de control prohibido.',
      fingerprint: fingerprint('null-byte-' + nullIdx + '-' + bytes.length).slice(0, 16)
    }
  }

  // IMP-001 INV-005 FIXED: Doctype / ENTITY bypasses. LINEAR indexOf() scan (no regex backtracking ReDoS).
  // Antes: regex /<!--[\s\S]{0,128}?-->\s*<!\s*DOCTYPE\b/i = 17s EventLoop block 16KB payload espacios (catastrófico).
  // Ahora: scan sin regex O(n) sobre 8192 bytes.
  const sniffLen = Math.min(text.length, 8192)
  let commentOpen = 0
  let depth = 0
  while (commentOpen !== -1 && commentOpen < sniffLen) {
    const ltIdx = text.indexOf('<', commentOpen)
    if (ltIdx === -1) break
    if (text[ltIdx + 1] === '!' && text[ltIdx + 2] === '-' && text[ltIdx + 3] === '-') {
      // Comentario <!--
      const closeIdx = text.indexOf('-->', ltIdx + 4)
      if (closeIdx !== -1) {
        commentOpen = closeIdx + 3
        depth++
        // Buscar después del cierre el <!...DOCTYPE ...> (INTERLEAVE bypass)
        const afterClose = Math.min(closeIdx + 3 + 128, sniffLen)
        const nextLt = text.indexOf('<', closeIdx + 3)
        if (nextLt !== -1 && nextLt <= afterClose) {
          const endSlice = Math.min(nextLt + 64, sniffLen)
          const region = text.slice(nextLt, endSlice)
          // Quitar spaces ASCII 9/10/13/32 entre '<!' y 'DOCTYPE'
          const bangIdx = region.indexOf('!')
          if (bangIdx !== -1) {
            let j = bangIdx + 1
            while (j < region.length) {
              const c = region.charCodeAt(j)
              if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x20 || c === 0x0b || c === 0x0c) j++
              else break
            }
            const rest = region.slice(j, Math.min(j + 8, region.length)).toUpperCase()
            if (rest.startsWith('DOCTYPE')) {
              return {
                kind: 'doctype-comment-interleave' as const,
                index: nextLt,
                score: 100,
                blocked: true,
                detail: '<!DOCTYPE> detectado precedido de comentario XML (interleave bypass). Doctype interno prohibido política anti-XXE/XML Bomb.',
                fingerprint: fingerprint('doctype-doctype-comment-interleave-' + nextLt + '-' + depth).slice(0, 16)
              }
            }
          }
        }
        continue
      } else { commentOpen = ltIdx + 4; continue }
    }
    // No es comentario → verificar si es <!DOCTYPE ...> en este punto
    const endSlice2 = Math.min(ltIdx + 96, sniffLen)
    const header = text.slice(ltIdx, endSlice2)
    const bangIdx2 = header.indexOf('!')
    if (bangIdx2 !== -1) {
      let j2 = bangIdx2 + 1
      while (j2 < header.length) {
        const c = header.charCodeAt(j2)
        if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x20 || c === 0x0b || c === 0x0c) j2++
        else break
      }
      const rest2 = header.slice(j2, Math.min(j2 + 8, header.length)).toUpperCase()
      if (rest2.startsWith('DOCTYPE')) {
        const bracketOpen = header.indexOf('[')
        const bracketClose = header.indexOf(']')
        return {
          kind: (bracketOpen !== -1 && bracketClose !== -1) ? 'doctype-raw' as const : 'doctype-whitespace-newline' as const,
          index: ltIdx,
          score: (bracketOpen !== -1 ? 95 : 95),
          blocked: true,
          detail: '<!DOCTYPE> detectado. Doctype interno prohibido política anti-XXE/XML Bomb.',
          fingerprint: fingerprint('doctype-bypass-' + ltIdx + '-' + depth).slice(0, 16)
        }
      }
    }
    commentOpen = ltIdx + 1
  }

  const entityVariants = [
    { re: /<!\s*ENTITY\b/i, kind: 'entity-inline-keyword' as const, score: 95 },
    { re: /<!\s*ENTITY\s+%\b/i, kind: 'entity-parameter' as const, score: 100 },
    { re: /<!\s*ENTITY\b[^>]*\bSYSTEM\b/i, kind: 'entity-system-public' as const, score: 100 },
    { re: /<!\s*ENTITY\b[^>]*\bPUBLIC\b/i, kind: 'entity-system-public' as const, score: 100 },
    { re: /<!\s*ENTITY\b[^>]*\bNDATA\b/i, kind: 'entity-ndata' as const, score: 98 },
    { re: /<!\s*NOTATION\b/i, kind: 'notation-decl' as const, score: 85 }
  ]
  for (const v of entityVariants) {
    const m = text.match(v.re)
    if (m && m.index !== undefined) {
      return {
        kind: v.kind,
        index: m.index,
        score: v.score,
        blocked: true,
        detail: `Declaración ENTITY detectada (${v.kind}). Bloqueado para prevenir XML External Entity y Billion Laughs.`,
        fingerprint: fingerprint('entity-' + v.kind + '-' + m.index).slice(0, 16)
      }
    }
  }

  const piMatch = text.match(/<\?xml-stylesheet\b[^?]*\bhref\s*=\s*"[^"]*https?:/i)
  if (piMatch && piMatch.index !== undefined) {
    return {
      kind: 'processing-instruction-external',
      index: piMatch.index,
      score: 80,
      blocked: true,
      detail: 'Processing Instruction xml-stylesheet con href externo detectado. No permitido.',
      fingerprint: fingerprint('pi-external-' + piMatch.index).slice(0, 16)
    }
  }

  // IMP-016: Billion Laughs ENTITY expansion cardinalidad / profundidad heurística por referencias
  const ampRefs = (text.match(/&(?!(lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);)[a-zA-Z_][a-zA-Z0-9_.-]{0,64};/g) || []).length
  if (ampRefs >= MAX_INSTANCES) {
    return {
      kind: 'billion-laughs-cardinality',
      index: 0,
      score: 100,
      blocked: true,
      detail: `Sobrepasado límite de referencias ENTITY custom: ${ampRefs} >= ${MAX_INSTANCES}. Patrón Billion Laughs.`,
      fingerprint: fingerprint('billion-card-' + ampRefs).slice(0, 16)
    }
  }

  // Profundidad heurística por stack de anidamiento textual
  let stackDepth = 0
  let maxStackDepth = 0
  for (const m of text.matchAll(/<!\[|<!ENTITY|(&[a-zA-Z_])/g)) {
    const tok = m[0]
    if (tok.startsWith('<')) stackDepth++
    if (stackDepth > maxStackDepth) maxStackDepth = stackDepth
    if (maxStackDepth >= MAX_DEPTH) break
  }
  if (stackDepth > 0) stackDepth = Math.max(0, stackDepth - 1)
  if (maxStackDepth >= MAX_DEPTH) {
    return {
      kind: 'billion-laughs-depth',
      index: 0,
      score: 100,
      blocked: true,
      detail: `Sobrepasado límite de profundidad ENTITY: ${maxStackDepth} >= ${MAX_DEPTH}. Patrón Billion Laughs / YAML bomb.`,
      fingerprint: fingerprint('billion-depth-' + maxStackDepth).slice(0, 16)
    }
  }

  // IMP-002 Conceptos sin cerrar: límite máximo de tags <Concepto abiertos (no backtracking)
  // IMPORTANTE: conteo sobre XML COMPLETO (no sniff window 16KB) para detectar archivos grandes
  const textFull = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  let conceptosOpen = 0
  const openIter = textFull.matchAll(/<[^:>]*:?Concepto\b/gi)
  for (const unusedMatch of openIter) { void unusedMatch; conceptosOpen++; if (conceptosOpen > MAX_CONCEPTOS) break }
  if (conceptosOpen > MAX_CONCEPTOS) {
    return {
      kind: 'concept-count-exceeded',
      index: 0,
      score: 75,
      blocked: true,
      detail: `Sobrepasado límite MAX_CONCEPTOS_POR_CFDI=${MAX_CONCEPTOS}. Rechazado para evitar ReDoS parser Conceptos.`,
      fingerprint: fingerprint('concept-limit-' + conceptosOpen).slice(0, 16)
    }
  }

  return null
}

// IMP-002 ReDoS Safe Concepto regex: non-backtracking límites por atributo (256 chars)
// Tag apertura con cierre requerido. No hay `[\s\S]*?` combinado con `[^>]*`.
export function createConceptoRegexSafe() {
  return {
    MAX_ATTR_LEN: 256,
    MAX_BODY_PER_CONCEPT: 65536,
    matchAll(xml: string): Array<{ attrs: string; body: string; index: number }> {
      const out: Array<{ attrs: string; body: string; index: number }> = []
      let pos = 0
      const MAX = XML_SANITIZE_DEFAULTS.MAX_CONCEPTOS_POR_CFDI
      while (pos < xml.length && out.length < MAX) {
        const open = xml.indexOf('<', pos)
        if (open === -1) break
        const closeAngle = xml.indexOf('>', open)
        if (closeAngle === -1 || closeAngle - open > 4096) { pos = open + 1; continue }
        const head = xml.slice(open, closeAngle + 1)
        const isOpen = /^<[^:>]*:?Concepto\s/i.test(head) || /^<[^:>]*:?Concepto>$/i.test(head)
        if (!isOpen) { pos = open + 1; continue }
        const attrs = /^<[^:>]*:?Concepto\b([^>]*)>/i.exec(head)?.[1] ?? ''
        if (attrs.length > this.MAX_ATTR_LEN * 32) { pos = closeAngle + 1; continue }
        const idx = open
        const nsMatch = /^<([^:>]*:)?Concepto\b/i.exec(head)
        const prefix = nsMatch?.[1] ?? ''
        const closeTag = `</${prefix}Concepto>`
        const closeIdx = xml.indexOf(closeTag, closeAngle + 1)
        if (closeIdx === -1) { pos = closeAngle + 1; continue }
        const bodyLen = closeIdx - closeAngle - 1
        if (bodyLen > this.MAX_BODY_PER_CONCEPT) { pos = closeIdx + closeTag.length; continue }
        out.push({ attrs, body: xml.slice(closeAngle + 1, closeIdx), index: idx })
        pos = closeIdx + closeTag.length
      }
      return out
    }
  }
}

// IMP-022: Escapar celda CSV contra fórmulas DDE/CSV Injection
export function csvCellEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (!s) return ''
  const trimmed = s.trimStart()
  const dangerousFirst = ['=', '+', '-', '@', '\t', '\r', '%0A', '%0D', '|', '%', '!', '^', '~', '`', '{', '}', '[', ']', '(', ')']
  for (const d of dangerousFirst) {
    if (trimmed.startsWith(d)) {
      return `'${s.replace(/\0/g, '')}`
    }
  }
  return s.replace(/\0/g, '')
}

// IMP-022: UUID strict RFC 4122 (no permitido versiones inválidas)
export const RFC4122_UUID_STRICT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

export function isStrictRfc4122Uuid(v: unknown): v is string {
  return typeof v === 'string' && RFC4122_UUID_STRICT.test(v)
}

/** Alias backward compatibility para módulo /api/invoices. */
export const isRfc4122UuidStrict = isStrictRfc4122Uuid

/** Escanea payloads por XXE y devuelve shape amigable para tests y handlers. */
export function scanXXEAndReportSafe(
  raw: Uint8Array | string,
  opts?: Partial<typeof XML_SANITIZE_DEFAULTS>
): { safe: boolean; kinds: string[]; violations: XXEViolation[] } {
  const violations: XXEViolation[] = []
  // detectXXEBytes devuelve 1 solo violation (el primero que encuentra).
  const v = detectXXEBytes(raw, opts)
  if (v) violations.push(v)
  const kinds = violations.map((x) => x.kind)
  return { safe: violations.length === 0, kinds, violations }
}

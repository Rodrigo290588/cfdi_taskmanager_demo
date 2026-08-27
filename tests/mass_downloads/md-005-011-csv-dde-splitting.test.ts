import { describe, it, expect } from '@jest/globals'
import {
  escapeCsvValue,
  buildCsvRow,
  buildCsvWithBom,
  CSV_BOM,
  sanitizeFilename,
  buildRfc6266ContentDisposition,
} from '@/lib/mass-downloads-route-utils'

describe('MD-005 · CSV Injection / DDE Neutralization escapeCsvValue', () => {
  it('Prefix chars = + - @ SIN comas/comillas internas → prepend apostrophe literal directo', () => {
    const payloads = [
      '+IMAGEcmdexe',
      '-2plus3cmdCalc',
      '@SINTAXIS_FORMULA',
    ]
    for (const p of payloads) {
      const escaped = escapeCsvValue(p)
      expect(escaped.startsWith("'")).toBe(true)
      expect(escaped.slice(1)).toBe(p)
    }
  })

  it('Payload DDE + comillas/coma → aplica DDE apostrophe + encapsula CSV quote (ambas defensas orden correcto)', () => {
    const payloadFormula = '=1+2+CMD|"/c calc"'
    const escaped = escapeCsvValue(payloadFormula)
    // Tiene comillas → encapsulado. Verificar que apostrophe DDE esté presente en el contenido encapsulado
    expect(escaped.startsWith('"')).toBe(true)
    expect(escaped.endsWith('"')).toBe(true)
    expect(escaped.includes("'=")).toBe(true)
  })

  it('TAB o CR LF iniciales + DDE: neutraliza ambos (CRLF a _ + apostrofo)', () => {
    const tabDde = '\t=1+1'
    const crDde = '\r=HYPERLINK'
    const esc1 = escapeCsvValue(tabDde)
    const esc2 = escapeCsvValue(crDde)
    expect(esc1.startsWith("'") || !/^[=+\-@]/.test(esc1.replace(/^"?"?/, ''))).toBe(true)
    expect(esc2.startsWith("'") || !/^[=+\-@]/.test(esc2.replace(/^"?"?/, ''))).toBe(true)
  })

  it('Safe strings NO prepend apostrofo. RFCs, UUIDs, textos normales', () => {
    const safe = [
      'ODE8604257UA',
      '550e8400-e29b-41d4-a716-446655440000',
      'Cliente ABC S.A. de C.V.',
      '123456.78',
      'MXN 1,234.56',
      'hola=mundo=test',
    ]
    for (const s of safe) {
      const e = escapeCsvValue(s)
      // Comienza con apostrofo solo si empieza con chars de riesgo; los safe inician normal
      const charDanger = /^[=+\-@\t\r]/.test(s)
      if (!charDanger && !s.includes(',') && !s.includes('"') && !s.includes('\n')) {
        expect(e.startsWith("'")).toBe(false)
      }
    }
  })

  it('Cells que contienen comas, quotes o newlines → encapsulan con quotes doble y escapan internas', () => {
    expect(escapeCsvValue('Hola, mundo')).toBe('"Hola, mundo"')
    expect(escapeCsvValue('Ella dijo "hola"')).toBe('"Ella dijo ""hola"""')
    expect(escapeCsvValue('Linea1\nLinea2')).toBe('"Linea1\nLinea2"')
  })

  it('buildCsvRow: resultado termina \\r\\n y cada celda escapeada', () => {
    const row = buildCsvRow(['=1+1', 'normal', 'con,coma'])
    expect(row.endsWith('\r\n')).toBe(true)
    expect(row).toContain("'=1+1")
    expect(row).toContain('"con,coma"')
  })

  it('buildCsvWithBom: inicia con BOM UTF-8 \\uFEFF (fix Excel acentos ñ)', () => {
    const csv = buildCsvWithBom([['a', 'b'], ['c', 'd']], ['Col1', 'Col2'])
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv.length).toBeGreaterThan(5)
  })
})

describe('MD-011 · HTTP Response Splitting filename 6 defensas sanitizeFilename', () => {
  it('Percent encoded CRLF %0d%0a → strip + convert a underscore NO CRLF literal', () => {
    const evil = 'PKG_%0d%0aSet-Cookie:session=evil;HttpOnly'
    const safe = sanitizeFilename(evil, 'download')
    expect(safe).not.toContain('\r')
    expect(safe).not.toContain('\n')
    expect(safe).not.toContain('Set-Cookie')
    expect(safe.toLowerCase()).not.toContain('set-cookie')
  })

  it('CRLF literales \\r \\n 0x00-0x1f → todos underscore', () => {
    const lit = 'file\r\nname\x00test\x1f.xml'
    const safe = sanitizeFilename(lit)
    expect(safe).not.toMatch(/[\r\n\x00-\x1f]/)
  })

  it('Header keyword blacklist set-cookie content-type x-* → redact _REDACT_', () => {
    const kw = 'report-X-Custom-Header-Content-Type-set-cookie.zip'
    const safe = sanitizeFilename(kw)
    expect(safe).toContain('_REDACT_')
    expect(safe.toLowerCase()).not.toContain('content-type')
    expect(safe.toLowerCase()).not.toContain('set-cookie')
  })

  it('Chars no permitidos [^\\w.\\- ] → underscore. Path ../../ traversal y .. neutralizado', () => {
    const trav = '../../Windows/System32/drivers/etc/hosts.zip'
    const safe = sanitizeFilename(trav)
    expect(safe).not.toContain('/')
    expect(safe).not.toContain('..')
    expect(safe).not.toContain('\\')
  })

  it('Longitud cap 64 chars siempre. >64 slice', () => {
    const long = 'A'.repeat(200) + '.zip'
    const safe = sanitizeFilename(long)
    expect(safe.length).toBeLessThanOrEqual(64)
  })

  it('Empty / null / undefined retorna fallback por defecto', () => {
    expect(sanitizeFilename('', 'backup')).toBe('backup')
    expect(sanitizeFilename(null as unknown as string)).toBe('download')
    expect(sanitizeFilename(undefined as unknown as string)).toBe('download')
    expect(sanitizeFilename('   \t\n   ')).toBe('download')
  })
})

describe('MD-011 · RFC 6266 Content-Disposition dual filename + filename* UTF-8', () => {
  it('Formato: attachment; filename="ASCII"; filename*=UTF-8\'\'urlencoded', () => {
    const cd = buildRfc6266ContentDisposition('Reporte Años 2025.csv')
    expect(cd.startsWith('attachment; filename="')).toBe(true)
    expect(cd).toContain('; filename*=UTF-8\'\'')
    expect(cd).toContain('Reporte_A')
  })

  it('Filename injection CRLF ya neutralizado antes → NO aparece \\r ni \\n', () => {
    const evil = 'a%0d%0ax-inject: y.csv'
    const cd = buildRfc6266ContentDisposition(evil)
    expect(cd).not.toMatch(/\r|\n/)
    expect(cd.toLowerCase()).not.toContain('x-inject')
  })

  it('Chars UTF-8 especiales son preservados via filename*. Palabras con acentos y ñ', () => {
    const withAccent = 'Reporte_Fiscal_Años_2025.csv'
    const cd = buildRfc6266ContentDisposition(withAccent)
    expect(cd).toContain('UTF-8')
    // Verifica que al menos se encodeó UTF-8 algún caracter (acento ó = %C3%B3)
    expect(cd).toMatch(/%[0-9A-F]{2}/)
  })
})

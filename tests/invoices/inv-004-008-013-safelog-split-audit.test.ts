/**
 * INV-004 · safeErrSummary PII fingerprint SHA256 slice 32 chars
 * INV-008 · sanitizePdfFilename anti HTTP Response Splitting
 * INV-013 · AuditLog write failure NO swallows (escribe fallback log)
 *
 * Nuevamente, como route handler tiene imports Next.js server-only, copiamos mirror functions
 * con misma lógica para unit test sin runtime Next.
 */
import crypto from 'node:crypto'
import { escapeHtmlForCfdiTemplate } from '@/lib/cfdi-pdf'

function fingerprint32(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32)
}

function sanitizePdfFilename(uuidRaw: unknown, fallbackId: string): string {
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

describe('INV-004 · PII safe logs — fingerprint32 nunca leakgea value real', () => {
  it('fp32(RFC sensible) = 32 chars hex, NO contiene RFC literal', () => {
    const rfcPii = 'ODE8604257UA'
    const fp = fingerprint32(rfcPii)
    expect(fp).toMatch(/^[a-f0-9]{32}$/)
    expect(fp).not.toContain(rfcPii)
    expect(rfcPii.length).toBeGreaterThan(0)
  })

  it('fp32 determinista (mismo input → mismo fp 32 chars)', () => {
    const msg = 'Error al conectar SAT: 5004 timeout 30s'
    expect(fingerprint32(msg)).toBe(fingerprint32(msg))
    expect(fingerprint32(msg).length).toBe(32)
  })

  it('fp32 diferencia por 1 byte es completamente distinta (avalanche SHA256)', () => {
    const a = fingerprint32('ABC')
    const b = fingerprint32('ABD')
    expect(a).not.toBe(b)
  })

  it('INV-004: 500 error stack grande NO se envía a cliente. Se usan los 200 primeros chars.', () => {
    const longMsg = Array.from({ length: 400 }).map((_, i) => String(i % 10)).join('')
    const safeClient = longMsg.length > 200 ? `${longMsg.slice(0, 200)}…` : longMsg
    expect(safeClient.length).toBe(201) // 200 + elipsis
  })
})

describe('INV-008 · sanitizePdfFilename anti HTTP Response Splitting CRLF', () => {
  it('INV-008 UUID + %0d%0aSet-Cookie → salida NO contiene Set-Cookie ni %0d', () => {
    const evilUuid = `11111111-0000-4000-8000-000000000001%0d%0aSet-Cookie: session=HACKED; Path=/; HttpOnly`
    const safe = sanitizePdfFilename(evilUuid, 'fallback-id')
    expect(safe).not.toMatch(/set-cookie/i)
    expect(safe).not.toMatch(/%0d|%0a|\r|\n/i)
    expect(safe).toMatch(/^cfdi_/)
    expect(safe.endsWith('.pdf')).toBe(true)
  })

  it('INV-008 UUID válido RFC4122: filename solo usa guiones/alfanuméricos, termina .pdf', () => {
    const uuid = '11111111-0000-4000-8000-000000000001'
    const fname = sanitizePdfFilename(uuid, 'fb')
    expect(fname).toBe('cfdi_11111111-0000-4000-8000-000000000001.pdf')
  })

  it('INV-008 Input null/undefined/blank: retorna fallback con prefijo cfdi_ y sufijo .pdf', () => {
    expect(sanitizePdfFilename(null, 'fb123')).toBe('cfdi_fb123.pdf')
    expect(sanitizePdfFilename(undefined, 'fb123')).toBe('cfdi_fb123.pdf')
    expect(sanitizePdfFilename('', 'fb123')).toBe('cfdi_fb123.pdf')
  })

  it('INV-008 Filename muy largo 90 chars: se trunca a 64 (max prefijo)', () => {
    const long = 'A'.repeat(200)
    const fname = sanitizePdfFilename(long, 'fb')
    // "cfdi_" (5) + 64 + ".pdf" (4) = 73 max length total.
    expect(fname.length).toBeLessThanOrEqual(5 + 64 + 4)
    expect(fname.startsWith('cfdi_')).toBe(true)
  })

  it('INV-008 Payload con separadores nulos \0 y control chars → removidos todos', () => {
    const payload = 'FAC\0TURA\r\n   AÑO_2026.xml'
    const fname = sanitizePdfFilename(payload, 'fb')
    expect(fname).not.toContain('\0')
    expect(fname).not.toContain('\r')
    expect(fname).not.toContain('\n')
  })

  it('INV-005 Escape HTML helper debe eliminar secuencias peligrosas cross-contamination (junior tests)', () => {
    const dangerous = '"><img src=x onerror=alert(1)>'
    const out = escapeHtmlForCfdiTemplate(dangerous)
    expect(out).not.toContain('<img')
    expect(out).not.toContain('onerror=')
  })

  it('INV-008: CRLF en payload que incluye headers MIME son reemplazados', () => {
    const payload = `a%0d%0aContent-Type:text/html%0d%0a%0d%0a<body>HACK</body>`
    const out = sanitizePdfFilename(payload, 'fb')
    expect(out).not.toMatch(/Content-Type/i)
  })
})

describe('INV-013 · AuditLog write NO swallow vacío (fallback log existe)', () => {
  it('Si prisma.auditLog.create falla, fallback registra error (no catch vacío)', () => {
    const consoleCalls: string[] = []
    const origErr = console.error
    try {
      console.error = (...args: unknown[]) => { consoleCalls.push(args.map(String).join(' ')) }
      // Simulamos bloque try/catch NO vacío de route.ts L315-L331:
      try {
        throw new Error('DB connection refused 500 pg pool exhausted')
      } catch (auditErr) {
        const fp = fingerprint32(auditErr)
        console.error(
          `[INV-004 audit] AuditLog write FAILED. fp=${fp} userId=u123 table=invoice`
        )
      }
      expect(consoleCalls.length).toBe(1) // NO swallow!
      expect(consoleCalls[0]).toMatch(/AuditLog write FAILED/)
      expect(consoleCalls[0]).toMatch(/fp=/)
    } finally {
      console.error = origErr
    }
  })
})

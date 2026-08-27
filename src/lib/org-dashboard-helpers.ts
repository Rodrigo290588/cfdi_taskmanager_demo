import type { NextRequest } from 'next/server'

declare global {
  var __TEXT_ENCODER_INSTANCE: TextEncoder | undefined
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

export const ORG_ID_REGEX = /^cm[a-z0-9]{23}$/

export const MAX_XML_BYTES_DASHBOARD = 2 * 1024 * 1024
export const MAX_PPDS_PARSED_PER_REQUEST = 200
export const MAX_RELATED_CFDIS_PER_RUN = 400
export const MAX_XML_WALK_ITERATIONS = 25_000

export const NAMESPACE_PATTERNS: Record<string, RegExp> = {
  Pago: /^(pago10|pago20|Pagos10|Pagos20):Pago$/,
  DoctoRel: /^(pago10|pago20|Pagos10|Pagos20):DoctoRelacionado$/,
}

export function parseSatDecimal(input: string | null | undefined, maxDecimals = 6): number {
  if (input == null) return 0
  let raw = String(input).trim()
  if (!raw) return 0
  raw = raw.replace(/[^\d.,\-]/g, '')
  if (!raw || raw === '-' || raw === '.' || raw === ',') return 0
  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    raw = lastComma > lastDot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '')
  } else if (lastComma !== -1) {
    const commas = (raw.match(/,/g) || []).length
    if (commas === 1 && raw.slice(lastComma + 1).length <= maxDecimals) {
      raw = raw.replace(',', '.')
    } else {
      raw = raw.replace(/,/g, '')
    }
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 9_999_999_999_999) return 0
  return n
}

export function safeTextEncoderLength(input: string): number {
  if (!input) return 0
  if (typeof globalThis.__TEXT_ENCODER_INSTANCE === 'undefined') {
    globalThis.__TEXT_ENCODER_INSTANCE = new TextEncoder()
  }
  return globalThis.__TEXT_ENCODER_INSTANCE.encode(input).length
}

export function hasDtdInline(xmlText: string): boolean {
  if (!xmlText || xmlText.length < 12) return false
  return /<!DOCTYPE[\s\S]{0,400}?>/i.test(xmlText)
}

export function findElementsByLocalNamePattern(
  root: { children: HTMLCollection | undefined } | unknown,
  pattern: RegExp,
  maxMatches = 500,
): Element[] {
  const out: Element[] = []
  const rootAny = root as { children?: HTMLCollection }
  if (!rootAny || !rootAny.children || !rootAny.children.length) return out
  const stack: ArrayLike<Element>[] = [rootAny.children as ArrayLike<Element>]
  const pointers: number[] = [0]
  let iters = 0
  while (stack.length && iters < MAX_XML_WALK_ITERATIONS) {
    const topStack = stack[stack.length - 1]
    if (!topStack) { stack.pop(); pointers.pop(); continue }
    const topIdx = pointers[pointers.length - 1]!
    if (topIdx >= topStack.length) {
      stack.pop()
      pointers.pop()
      continue
    }
    pointers[pointers.length - 1] = topIdx + 1
    iters += 1
    const current = topStack[topIdx] as Element | undefined | null
    if (!current || !current.nodeName) continue
    if (pattern.test(current.nodeName)) {
      out.push(current)
      if (out.length >= maxMatches) return out
    }
    if (current.children && current.children.length > 0) {
      stack.push(current.children as ArrayLike<Element>)
      pointers.push(0)
    }
  }
  return out
}

export function validateAndParseOrgIdFromRequest(req: NextRequest): { ok: true; orgId: string } | { ok: false; error: string; status: 400 } {
  const searchParams = new URL(req.url).searchParams
  const orgId = searchParams.get('organizationId')
  if (!orgId || typeof orgId !== 'string' || orgId.length < 20) {
    return { ok: false, error: 'organizationId query param es obligatorio formato inválido', status: 400 }
  }
  if (!ORG_ID_REGEX.test(orgId)) {
    return { ok: false, error: 'organizationId formato inválido debe cumplir ORG_ID_REGEX', status: 400 }
  }
  return { ok: true, orgId }
}

export function maskTopClientsPii<T extends { receiverRfc: string | null; receiverName: string | null }>(
  rows: T[],
  totals: Array<{ _sum: { total: number | null } }>,
  canViewFullPii: boolean,
): Array<{ rfc: string | null; name: string; total: number }> {
  return rows.map((row, idx) => {
    const total = Number((totals[idx]?._sum?.total) ?? 0) || 0
    if (canViewFullPii) {
      return { rfc: row.receiverRfc, name: row.receiverName || '', total }
    }
    return {
      rfc: row.receiverRfc ? row.receiverRfc.substring(0, 4) + '…' : null,
      name: '[Nombre cliente confidencial]',
      total,
    }
  })
}

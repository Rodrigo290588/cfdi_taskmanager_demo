import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateApiKey } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { upsertInvoiceXmlBlob } from '@/lib/invoice-xml-storage'
import { upsertInvoiceComplementProjection } from '@/lib/cfdi-complement-projection-storage'
import { upsertInvoicePaymentComplementDetails } from '@/lib/invoice-payment-complement-storage'
import { parseCfdiDateTime } from '@/lib/cfdi-date'
import { cfdiInputSchema } from '@/schemas/cfdiInput'
import { normalizarJson, generarXml } from '@/services/cfdi.service'
import { timbrarCfdi } from '@/services/pac.service'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
import crypto from 'crypto'
import { SECURITY_HEADERS } from '@/lib/mass-downloads-route-utils'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeZodFlatten } from '@/lib/monitor-security-helpers'

function mergeSecureHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...SECURITY_HEADERS, ...(extra || {}) }
}

/* ======================================================================
 * INV-007 FIXED: buildTimbrarAuditOldValues (PII masking helper)
 * - CURP: show 4 first / 2 last · NSS: only 2 last
 * - RFC personas físicas (13 chars): 2 first + 3 last
 * - RFC morales (12): 2+3. Email/Phone: standard mask.
 * - Recursive walk: aplica deep a objetos arbitrarios (body, oldValues).
 * ====================================================================== */
function _maskEmail(v: string): string {
  const at = v.indexOf('@')
  if (at <= 0) return '[EMAIL_INVALID]'
  const local = v.slice(0, at)
  const domain = v.slice(at + 1)
  const safeLocal = local.length <= 2 ? '**' : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
  const domParts = domain.split('.')
  const safeDom = domParts.length >= 2
    ? (domParts[0].length <= 2 ? '**' : domParts[0][0] + '*'.repeat(Math.max(1, domParts[0].length - 2)) + (domParts[0][domParts[0].length - 1] || '')) + '.' + domParts.slice(1).join('.')
    : domain
  return `${safeLocal}@${safeDom}`
}
function _maskPhone(v: string): string {
  const s = v.replace(/\D/g, '')
  if (s.length < 7) return '*'.repeat(s.length || 2)
  return s.slice(0, 2) + '*'.repeat(Math.max(2, s.length - 4)) + s.slice(-2)
}
function _maskCurp(v: string): string {
  if (v.length < 8) return '*'.repeat(Math.max(2, v.length))
  return v.slice(0, 4) + '*'.repeat(v.length - 6) + v.slice(-2)
}
function _maskNss(v: string): string {
  if (v.length < 4) return '*'.repeat(Math.max(2, v.length))
  return '*'.repeat(v.length - 2) + v.slice(-2)
}
function _maskRfc(v: string): string {
  if (v.length <= 5) return v[0] + '*'.repeat(v.length - 1)
  return v.slice(0, 2) + '*'.repeat(Math.max(2, v.length - 5)) + v.slice(-3)
}
function buildTimbrarAuditOldValues(raw: unknown, step: string): Prisma.InputJsonValue {
  const visited = new WeakSet<object>()
  const walk = (v: unknown, ctx: { keyHint: string }): unknown => {
    if (v === null || v === undefined) return v
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v
    if (typeof v === 'string') {
      const len = v.length
      const k = ctx.keyHint.toUpperCase()
      if (len === 0) return ''
      if (k.includes('CURP') || (len === 18 && /^[A-Za-z0-9]+$/.test(v) && /\d/.test(v))) {
        if (k.includes('CURP') || len === 18) return _maskCurp(v)
      }
      if (k.includes('NSS') || (len >= 8 && len <= 12 && /^[0-9]+$/.test(v))) return _maskNss(v)
      if (v.includes('@')) return _maskEmail(v)
      if (/\d{8,}/.test(v)) {
        const digits = v.match(/\d/g) || []
        if (digits.length >= 8 && digits.length <= 15 && !k.includes('UUID') && !k.includes('TOTAL') && !k.includes('SUBTOTAL') && !k.includes('IVA') && !k.includes('IMPORTE')) {
          return _maskPhone(v)
        }
      }
      if (k.includes('RFC') || (len >= 12 && len <= 13 && /^[A-Za-z&Ññ0-9]+$/.test(v))) return _maskRfc(v)
      // Limit string length 240 para DoS audit log storage
      return len > 240 ? v.slice(0, 237) + '...' : v
    }
    if (Array.isArray(v)) {
      if (v.length > 120) return { _REDACTED_: 'ARRAY_TOO_LARGE', length: v.length, step } // anti 5000 conceptos DoS
      return v.map((x, i) => walk(x, { keyHint: ctx.keyHint + '[' + String(i).slice(0, 3) + ']' }))
    }
    if (typeof v === 'object') {
      const o = v as object
      if (visited.has(o)) return '[CIRCULAR_REFERENCE]'
      visited.add(o)
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(o)) out[k] = walk(val, { keyHint: k })
      return out as Prisma.InputJsonValue
    }
    return String(v).slice(0, 240)
  }
  const base = { step: step || 'unknown_step', ts: Date.now() } as unknown as Prisma.InputJsonValue
  try {
    const maskedInner = walk(raw, { keyHint: 'payload' })
    // @ts-expect-error merge shape ok
    return { ...base, body: maskedInner } as Prisma.InputJsonValue
  } catch (err) { void err; return { ...(base as object), _REDACTED_: 'MASK_FALLBACK_FAILED', step } as unknown as Prisma.InputJsonValue }
}

export async function POST(request: NextRequest) {
  // -----------------------------------------------------------------------------
  // INV-004 FIXED: TRIPLE LOCK Rate Limit en 3 ejes ANTES de cualquier parse/DB.
  // (A) IP global · (B) userId after auth · (C) orgId before write.
  // Límites: 60 req/min IP · 30 req/min userId · 150 req/min org.
  // -----------------------------------------------------------------------------
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || 'unknown'
  const userAgent = request.headers.get('user-agent') || undefined
  const orgIdCandidate = request.headers.get('x-org-id') || undefined
  const reqStart = Date.now()
  void reqStart

  const rlIp = await rateLimit('cfdi-timbrar:ip:' + String(ip), { interval: 60_000, limit: 60, silent: true })
  if (!rlIp.success) {
    return NextResponse.json({ error: 'Demasiadas solicitudes (IP). Reintenta en ' + Math.ceil((rlIp.retryAfterMs) / 1000) + 's.' }, { status: 429, headers: mergeSecureHeaders({ 'Retry-After': String(Math.ceil(rlIp.retryAfterMs / 1000)) }) })
  }
  try {
    const authResult = await validateApiKey(request)
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status || 401, headers: mergeSecureHeaders() })
    }
    if (!authResult.permissions?.includes('write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403, headers: mergeSecureHeaders() })
    }
    const userId = authResult.user?.id || ''
    // RL userId axis
    if (userId) {
      const rlUser = await rateLimit('cfdi-timbrar:uid:' + String(userId), { interval: 60_000, limit: 30, silent: true })
      if (!rlUser.success) {
        return NextResponse.json({ error: 'Demasiadas solicitudes (usuario). Reintenta en ' + Math.ceil((rlUser.retryAfterMs) / 1000) + 's.' }, { status: 429, headers: mergeSecureHeaders({ 'Retry-After': String(Math.ceil(rlUser.retryAfterMs / 1000)) }) })
      }
    }

    if (!orgIdCandidate) {
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: crypto.randomUUID(),
            action: 'REJECT',
            oldValues: buildTimbrarAuditOldValues({ reason: 'missing_org_header', ip }, 'missing_org_header'),
            newValues: { step: 'missing_org_header' },
            userId,
            userEmail: authResult.user?.email || '',
            ipAddress: ip,
            userAgent,
            description: 'x-org-id header requerido'
          }
        })
      } catch { /* ignore */ }
      return NextResponse.json({ error: 'x-org-id header requerido' }, { status: 400, headers: mergeSecureHeaders() })
    }
    const orgId = orgIdCandidate

    const rlOrg = await rateLimit('cfdi-timbrar:org:' + String(orgId), { interval: 60_000, limit: 150, silent: true })
    if (!rlOrg.success) {
      return NextResponse.json({ error: 'Demasiadas solicitudes (organización). Reintenta en ' + Math.ceil((rlOrg.retryAfterMs) / 1000) + 's.' }, { status: 429, headers: mergeSecureHeaders({ 'Retry-After': String(Math.ceil(rlOrg.retryAfterMs / 1000)) }) })
    }

    const rawBody = await request.json()
    const requestId = crypto.randomUUID()

    // ------------------------------------------------------------------
    // INV-002 FIXED: Zod PARSE FIRST (ANTES de AuditLog create), THEN audit.
    // Antes: AuditLog con body raw ANTES parse → stored XSS en concepto.descripcion + leak PII.
    // Ahora: Zod parsea body antes de cualquier write; audit recibe body MASKED via buildTimbrarAuditOldValues().
    // ------------------------------------------------------------------
    let input: z.infer<typeof cfdiInputSchema>
    try {
      input = cfdiInputSchema.parse(rawBody)
    } catch (zodErr) {
      const isZod = zodErr instanceof z.ZodError
      // INV-007: AuditLog masked antes write (PII). No raw body.
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: requestId,
            action: 'REJECT',
            oldValues: buildTimbrarAuditOldValues(
              { reason: 'Zod validation', step: 'parse_first', issues_count: (isZod ? (zodErr as z.ZodError).issues.length : 0), ip, orgId },
              'zod_parse_first'
            ),
            newValues: { step: 'validation_error' },
            userId,
            userEmail: authResult.user?.email || '',
            ipAddress: ip,
            userAgent,
            description: 'Solicitud rechazada por validación Zod (Zod-first order fix INV-002).',
          }
        })
      } catch { /* ignore */ }
      // INV-004 FIXED: Zod issues NO se reflejan raw. Usamos sanitizeZodFlatten.
      if (isZod) {
        const flat = sanitizeZodFlatten((zodErr as z.ZodError).flatten())
        return NextResponse.json({ error: 'Validación falló', details: flat }, { status: 400, headers: mergeSecureHeaders() })
      }
      return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400, headers: mergeSecureHeaders() })
    }

    // Zod aprobado → audit IMPORT masked (PII).
    try {
      await prisma.auditLog.create({
        data: {
          tableName: 'cfdi_api',
          recordId: requestId,
          action: 'IMPORT',
          oldValues: buildTimbrarAuditOldValues(input, 'zod_approved'),
          newValues: { step: 'received', orgId },
          userId,
          userEmail: authResult.user?.email || '',
          ipAddress: ip,
          userAgent,
          description: 'CFDI timbrar request recibido (Zod-first + PII masked INV-002/007).',
        }
      })
    } catch { /* ignore */ }

    const norm = normalizarJson(input)
    const xml = generarXml(norm)
    const { uuid, xmlTimbrado } = await timbrarCfdi(xml)

    // Validar membresía del usuario a la organización indicada
    const member = await prisma.member.findFirst({ where: { userId, organizationId: orgId, status: 'APPROVED' } })
    if (!member) {
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: requestId,
            action: 'REJECT',
            oldValues: buildTimbrarAuditOldValues({ reason: 'no_membership_access', orgId, ip }, 'membership_reject'),
            newValues: { step: 'membership_reject' },
            userId,
            userEmail: authResult.user?.email || '',
            ipAddress: ip,
            userAgent,
            description: 'Sin acceso a la organización'
          }
        })
      } catch { /* ignore */ }
      return NextResponse.json({ error: 'Sin acceso a la organización' }, { status: 403, headers: mergeSecureHeaders() })
    }

    // Fiscal entity por RFC y organización; no crear si no existe
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc: norm.emisor.rfc, organizationId: orgId } })
    if (!fiscalEntity) {
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: requestId,
            action: 'REJECT',
            oldValues: buildTimbrarAuditOldValues({ reason: 'fiscal_entity_not_found', issuerRfc: norm.emisor.rfc, organizationId: orgId }, 'fiscal_entity_missing'),
            newValues: { step: 'fiscal_entity_missing' },
            userId,
            userEmail: authResult.user?.email || '',
            ipAddress: ip,
            userAgent,
            description: 'Entidad fiscal (RFC) no registrada en la organización'
          }
        })
      } catch { /* ignore */ }
      return NextResponse.json({ error: 'Entidad fiscal (RFC) no registrada en la organización' }, { status: 400, headers: mergeSecureHeaders() })
    }

    // Totales por impuesto
    const sumByImpuesto = (items: Array<{ impuesto: string; importe: string }>) =>
      items.reduce<Record<string, number>>((acc, i) => {
        acc[i.impuesto] = (acc[i.impuesto] || 0) + Number(i.importe)
        return acc
      }, {})

    const trasSum = sumByImpuesto(norm.comprobante.impuestos.traslados)
    const retSum = sumByImpuesto(norm.comprobante.impuestos.retenciones)

    const ivaTransferred = trasSum['002'] || 0
    const ivaWithheld = retSum['002'] || 0
    const isrWithheld = retSum['001'] || 0
    const iepsWithheld = retSum['003'] || 0

    const invoice = await prisma.$transaction(async tx => {
      const createdInvoice = await tx.invoice.create({
        data: {
          userId,
          issuerFiscalEntityId: fiscalEntity.id,
          uuid,
          cfdiType: CfdiType.INGRESO,
          series: norm.comprobante.serie,
          folio: norm.comprobante.folio,
          currency: norm.comprobante.moneda,
          exchangeRate: norm.comprobante.tipoCambio ? Number(norm.comprobante.tipoCambio) : null,
          status: InvoiceStatus.ACTIVE,
          satStatus: SatStatus.VIGENTE,
          issuerRfc: norm.emisor.rfc,
          issuerName: norm.emisor.nombre,
          receiverRfc: norm.receptor.rfc,
          receiverName: norm.receptor.nombre,
          subtotal: new Prisma.Decimal(norm.comprobante.subtotal),
          discount: new Prisma.Decimal(norm.comprobante.descuento),
          total: new Prisma.Decimal(norm.comprobante.total),
          ivaTransferred: new Prisma.Decimal(ivaTransferred.toFixed(2)),
          ivaWithheld: new Prisma.Decimal(ivaWithheld.toFixed(2)),
          isrWithheld: new Prisma.Decimal(isrWithheld.toFixed(2)),
          iepsWithheld: new Prisma.Decimal(iepsWithheld.toFixed(2)),
          xmlContent: xmlTimbrado,
          pdfUrl: null,
          issuanceDate: parseCfdiDateTime(norm.comprobante.fecha),
          certificationDate: new Date(),
          certificationPac: 'PAC SIMULADO',
          paymentMethod: norm.comprobante.metodoPago,
          paymentForm: norm.comprobante.formaPago,
          cfdiUsage: norm.receptor.usoCfdi,
          placeOfExpedition: norm.comprobante.lugarExpedicion,
          exportKey: norm.comprobante.exportacion,
          objectTaxComprobante: norm.comprobante.objetoImp,
          paymentConditions: norm.comprobante.condicionesDePago,
          concepts: {
            create: norm.conceptos.slice(0, 5000).map(c => ({
              productServiceKey: c.claveProdServ,
              identificationNumber: c.noIdentificacion,
              unitQuantity: new Prisma.Decimal(c.cantidad),
              unitKey: c.claveUnidad,
              unitDescription: c.unidad,
              description: c.descripcion,
              unitValue: new Prisma.Decimal(c.valorUnitario),
              amount: new Prisma.Decimal(c.importe),
              discount: new Prisma.Decimal((c.descuento ?? '0')),
              objectOfTax: c.objetoImp,
              transferredTaxesJson: c.impuestos.traslados.length ? (c.impuestos.traslados as unknown as object) : undefined,
              withheldTaxesJson: c.impuestos.retenciones.length ? (c.impuestos.retenciones as unknown as object) : undefined,
            }))
          },
          relatedCfdis: {
            create: norm.cfdiRelacionados.flatMap(r => r.uuids.map(u => ({ relationType: r.tipoRelacion, relatedUuid: u })))
          }
        }
      })

      await upsertInvoiceXmlBlob(tx, { invoiceId: createdInvoice.id, xmlContent: xmlTimbrado })
      await upsertInvoiceComplementProjection(tx, { invoiceId: createdInvoice.id, xmlContent: xmlTimbrado })
      await upsertInvoicePaymentComplementDetails(tx, {
        issuerFiscalEntityId: fiscalEntity.id,
        paymentInvoiceId: createdInvoice.id,
        paymentInvoiceUuid: uuid,
        xmlContent: xmlTimbrado,
        satStatusSnapshot: SatStatus.VIGENTE,
        fallbackPaymentDate: parseCfdiDateTime(norm.comprobante.fecha),
        fallbackCurrency: norm.comprobante.moneda,
        fallbackSeries: norm.comprobante.serie,
        fallbackFolio: norm.comprobante.folio
      })

      return createdInvoice
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    try {
      await prisma.auditLog.create({
        data: {
          tableName: 'cfdi_api',
          recordId: uuid,
          action: 'CREATE',
          oldValues: buildTimbrarAuditOldValues({ requestId, issuerRfc: invoice.issuerRfc, receiverRfc: invoice.receiverRfc }, 'create_success'),
          newValues: {
            uuid,
            issuerRfc: invoice.issuerRfc,
            receiverRfc: invoice.receiverRfc,
            total: invoice.total.toString(),
          },
          userId,
          userEmail: authResult.user?.email || '',
          ipAddress: ip,
          userAgent,
          description: 'CFDI timbrado y registrado',
        }
      })
    } catch { /* ignore */ }

    return NextResponse.json({ uuid: invoice.uuid, xml: xmlTimbrado }, { status: 201, headers: mergeSecureHeaders() })
  } catch (error) {
    // INV-004 FIXED: catch global Zod path uses sanitizeZodFlatten.
    if (typeof error === 'object' && error && (error as z.ZodError)?.name === 'ZodError') {
      const zodErr = error as z.ZodError
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: crypto.randomUUID(),
            action: 'REJECT',
            oldValues: buildTimbrarAuditOldValues({ reason: 'Zod validation fallback', issues_count: zodErr.issues.length }, 'zod_catch_fallback'),
            newValues: { step: 'validation_error' },
            userId: '',
            userEmail: '',
            description: 'Solicitud rechazada por validación Zod (catch fallback).',
          }
        })
      } catch { /* ignore */ }
      const flat = sanitizeZodFlatten(zodErr.flatten())
      return NextResponse.json({ error: 'Validación falló', details: flat }, { status: 400, headers: mergeSecureHeaders() })
    }
    if (typeof error === 'object' && error && 'issues' in (error as object)) {
      // Legacy shape fallback
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: crypto.randomUUID(),
            action: 'REJECT',
            oldValues: buildTimbrarAuditOldValues({ reason: 'Generic validation' }, 'legacy_issues_shape'),
            newValues: { step: 'validation_error' },
            userId: '',
            userEmail: '',
            description: 'Solicitud rechazada por validación (forma legacy).',
          }
        })
      } catch { /* ignore */ }
      return NextResponse.json({ error: 'Validación falló' }, { status: 400, headers: mergeSecureHeaders() })
    }
    console.error('Error timbrado CFDI:', error instanceof Error ? { name: error.name, message: error.message?.slice(0, 240) } : 'unknown error')
    try {
      await prisma.auditLog.create({
        data: {
          tableName: 'cfdi_api',
          recordId: crypto.randomUUID(),
          action: 'REJECT',
          oldValues: buildTimbrarAuditOldValues({
            reason: 'Internal error',
            err_name: error instanceof Error ? error.name : 'unknown',
            err_msg: error instanceof Error ? error.message?.slice(0, 160) : '',
            ip,
            ua: userAgent?.slice(0, 120)
          }, 'internal_error'),
          newValues: { step: 'internal_error' },
          userId: '',
          userEmail: '',
          description: 'Error interno en timbrado',
        }
      })
    } catch { /* ignore */ }
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500, headers: mergeSecureHeaders() })
  }
}

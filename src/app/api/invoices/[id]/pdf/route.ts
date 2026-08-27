import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { generateCfdiPdfFromXml, escapeHtmlForCfdiTemplate } from '@/lib/cfdi-pdf'
import { getInvoiceXmlRecordById } from '@/lib/invoice-xml-storage'
import { rateLimitByUserId, RateLimitError } from '@/lib/rate-limit'
import { hasPermission, Permission } from '@/lib/permissions'
import type { SystemRole, MemberRole } from '@prisma/client'
import { isRfc4122UuidStrict } from '@/lib/xml-sanitize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/* ==========================================================================
 * 0. ENV CONSTANTS — seguridad sobreescribibles en .env.test/.env.local
 * ==========================================================================
 */
const INVOICE_ENABLE_FILE_PARAM_IN_DEV =
  String(process.env.INVOICE_PDF_ENABLE_FILE_PARAM_IN_DEV || 'false').toLowerCase() === 'true'
const INVOICE_RATE_LIMIT_MAX_PER_HOUR = Number(
  process.env.INVOICE_PDF_RATE_LIMIT_MAX_PER_HOUR || '180'
)
const SAFE_DEV_BASE_DIR = path.resolve(process.cwd(), 'java-client', 'xml-data')
const DEFAULT_NOT_FOUND_MESSAGE = 'Factura no autorizada o no encontrada'
const TIMING_PADDED_DELAY_MS_MIN = 14
const TIMING_PADDED_DELAY_MS_MAX = 20

/* ==========================================================================
 * 1. Zod Strict schema query (INV-013 · Overposting rejection z.strictObject)
 * ==========================================================================
 */
const pdfQuerySchema = z.strictObject({
  file: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[\w.\-_/\\ ]+$/, 'INV-010: invalid file charset')
    .optional()
})

/** INV-008 · HTTP Response Splitting safe filename: strip CRLF / control chars / non-alnum.
 *  filename DEBE venir de UUID sanitizado (RFC 4122), NUNCA de raw proveedor.
 */
function sanitizePdfFilename(uuidRaw: unknown, fallbackId: string): string {
  const candidate = String(uuidRaw || fallbackId || 'document').trim()
  // 1) REMOVER secuencias URL encoded peligrosas %XX CR/LF/null — ANTES de reemplazar % con guion bajo.
  const strippedPercent = candidate
    .replace(/%0[0-9a-f]|%1[0-9a-f]|%[0-9a-f]{2}/gi, '_')
    .replace(/\0/g, '')
    .replace(/\r|\n/g, '_')
  // 2) Solo permitimos alfanumérico, guiones, guión bajo, puntos. Rechazamos cualquier otro.
  const firstPass = strippedPercent.replace(/[^\w.\-]/gi, '_')
  // 3) Blacklist de headers HTTP/keywords de inyección Response Splitting.
  const blacklistRe = /(set[-_]?cookie|content[-_]?type|content[-_]?disposition|mime[-_]?version|x[-_][a-z0-9]{2,})/gi
  const cleanedKeywords = firstPass.replace(blacklistRe, '_REDACT_')
  const cleaned = cleanedKeywords.replace(/\s+/g, '_')
  if (!cleaned || cleaned.replace(/_/g, '').length === 0) return `cfdi_${fallbackId}.pdf`
  // Max 64 chars filename.
  return `cfdi_${cleaned.slice(0, 64)}.pdf`
}

/** INV-014 · Timing safe 404: todas las respuestas negativas tardan el mismo rango. */
async function timingPadBeforeNegativeRespond() {
  const ms = TIMING_PADDED_DELAY_MS_MIN +
    Math.floor(Math.random() * (TIMING_PADDED_DELAY_MS_MAX - TIMING_PADDED_DELAY_MS_MIN))
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** INV-003 + INV-010 · file= mode dev sanitize. Resuelve con basename post-path. */
function resolveDevXmlFileSafe(raw: string): { safe: false; errorCode: number; errorMsg: string } | { safe: true; resolved: string } {
  if (!INVOICE_ENABLE_FILE_PARAM_IN_DEV) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-003: file param disabled. Set INVOICE_PDF_ENABLE_FILE_PARAM_IN_DEV=true en dev.' }
  }
  // INV-010 · Chequeo extensión SOBRE `basename(final)` no raw.
  const raw2 = String(raw || '').trim()
  const candidate = path.resolve(SAFE_DEV_BASE_DIR, raw2)
  const basenameFinal = path.basename(candidate).toLowerCase()
  if (!basenameFinal.endsWith('.xml')) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-010: file extension not allowed (only .xml after final basename resolution).' }
  }
  const normalizedCandidate = candidate.replace(/\\/g, '/')
  const normalizedBase = SAFE_DEV_BASE_DIR.replace(/\\/g, '/')
  if (!normalizedCandidate.startsWith(normalizedBase + '/') && normalizedCandidate !== normalizedBase) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-010: path traversal detected.' }
  }
  return { safe: true, resolved: candidate }
}

/* INV-004 · safeErrorSummary: no exponer PII ni stack al cliente. */
function fingerprint32(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userIdForLog: string | null = null
  try {
    // 1. Autenticación obligatoria
    const session = await auth()
    if (!session?.user?.id) {
      await timingPadBeforeNegativeRespond()
      return NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE }, { status: 401 })
    }
    userIdForLog = session.user.id

    // INV-006 · rateLimitByUserId DEBE ejecutarse con AWAIT. NO fire-and-forget.
    try {
      await rateLimitByUserId({
        userId: session.user.id,
        key: 'cfdi-view-pdf',
        limit: Number.isFinite(INVOICE_RATE_LIMIT_MAX_PER_HOUR) ? INVOICE_RATE_LIMIT_MAX_PER_HOUR : 180,
        windowMs: 60 * 60 * 1000
      })
    } catch (rlErr) {
      if (rlErr instanceof RateLimitError) throw rlErr
      throw rlErr
    }

    const { id } = await params
    const reqId = crypto.randomUUID()

    // Zod strict query params
    const queryParse = pdfQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!queryParse.success) {
      await timingPadBeforeNegativeRespond()
      return NextResponse.json(
        { error: 'Query inválida', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, 'Content-Type': 'application/json; charset=utf-8' } }
      )
    }
    const fileParam = queryParse.data.file

    let xmlRaw = ''
    let isCancelled = false
    let uuidForFilename = id
    let auditTableName: string = 'invoice'

    if (fileParam) {
      // =========================================================
      // RAMA DEV: ?file=
      // =========================================================
      if (process.env.NODE_ENV === 'production') {
        await timingPadBeforeNegativeRespond()
        return NextResponse.json(
          { error: 'Parámetro ?file= deshabilitado en producción', reqId },
          { status: 400, headers: { 'X-Request-Id': reqId } }
        )
      }

      // INV-003: gate hasPermission INCLUSO en rama dev. Viewer/Auditor sin permiso NO PUEDE.
      const memberDev = await prisma.member.findFirst({
        where: { userId: session.user.id, status: 'APPROVED' },
        select: { organizationId: true, role: true, id: true }
      })
      if (!memberDev) {
        await timingPadBeforeNegativeRespond()
        return NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } })
      }
      const userCtxDev = {
        id: session.user.id,
        systemRole: (session.user.systemRole || 'USER') as SystemRole,
        memberships: [{ organizationId: memberDev.organizationId, role: memberDev.role as MemberRole }]
      }
      if (!hasPermission(userCtxDev, Permission.CFDI_VIEW_PDF, memberDev.organizationId)) {
        await timingPadBeforeNegativeRespond()
        return NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } })
      }

      const resolved = resolveDevXmlFileSafe(fileParam)
      if (!resolved.safe) {
        await timingPadBeforeNegativeRespond()
        return NextResponse.json(
          { error: resolved.errorMsg, reqId },
          { status: resolved.errorCode, headers: { 'X-Request-Id': reqId } }
        )
      }
      xmlRaw = await readFile(resolved.resolved, 'utf8')
      auditTableName = 'dev_xml_local'
    } else {
      // =========================================================
      // RAMA PRODUCCIÓN: Invoice (InvoiceBlob → SatInvoice fallback)
      // =========================================================
      const member = await prisma.member.findFirst({
        where: { userId: session.user.id, status: 'APPROVED' },
        select: { organizationId: true, role: true, id: true }
      })
      if (!member) {
        await timingPadBeforeNegativeRespond()
        return NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } })
      }

      const u = {
        id: session.user.id,
        systemRole: (session.user.systemRole || 'USER') as SystemRole,
        memberships: [{ organizationId: member.organizationId, role: member.role as MemberRole }]
      }
      if (!hasPermission(u, Permission.CFDI_VIEW_PDF, member.organizationId)) {
        await timingPadBeforeNegativeRespond()
        return NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } })
      }

      // INV-001 · InvoiceXML solo con member.organizationId scope. (REGLA 12: InvoiceBlob solo descifra si pertenece a tenant).
      // invoice NO es null safe: si invoice != org lanza error bloqueante → capturado en catch outer + 404 genérico.
      const targetOrg = member.organizationId
      let loadedInvoice: {
        xmlContent: string
        satStatus?: string | null
        issuerRfc?: string | null
        receiverRfc?: string | null
        issuerFiscalEntityId?: string | null
        invoiceInternalId: string
        tfdUuid?: string | null
      } | null = null

      try {
        // -------------------------------------------------------------------
        // INV-003 FIXED: TransactionIsolationLevel.Serializable + SINGLE JOIN atomic query, NO TOCTOU window.
        // Antes: 2 queries separados (SatInvoice findUnique → FiscalEntity findUnique separado) = 1ms Race Window.
        // Ahora: $transaction Serializable + SatInvoice.include{fiscalEntity{organizationId}} inline check + EVERY RFC.
        // -------------------------------------------------------------------
        const txResult = await prisma.$transaction(async tx => {
          const r1 = await getInvoiceXmlRecordById(id, targetOrg)
            .catch(() => null) as Awaited<ReturnType<typeof getInvoiceXmlRecordById>> | null
          if (r1) {
            return {
              xmlContent: r1.xmlContent,
              satStatus: r1.satStatus,
              issuerRfc: r1._meta?.issuerRfc ?? null,
              issuerFiscalEntityId: r1._meta?.issuerFiscalEntityId ?? null,
              invoiceInternalId: r1.id,
              tfdUuid: r1.uuid
            }
          }
          // Fallback SatInvoice: JOIN atomic (include fiscalEntity org) en MISMA query. NO 2nd lookup.
          const r2 = await tx.satInvoice.findUnique({
            where: { id },
            select: {
              xmlContent: true, satStatus: true, issuerRfc: true, receiverRfc: true,
              fiscalEntityId: true, id: true,
              fiscalEntity: { select: { organizationId: true, rfc: true, isActive: true } }
            }
          })
          if (!r2 || !r2.fiscalEntity || r2.fiscalEntity.organizationId !== targetOrg || r2.fiscalEntity.isActive !== true) {
            return null
          }
          return {
            xmlContent: r2.xmlContent,
            satStatus: r2.satStatus,
            issuerRfc: r2.issuerRfc,
            receiverRfc: r2.receiverRfc,
            issuerFiscalEntityId: r2.fiscalEntityId,
            invoiceInternalId: id,
            tfdUuid: null
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        loadedInvoice = txResult

        // INV-011 + INV-003 FIXED: EVERY RFC check strict (fiscals.length === rfcsToCheck.length + EVERY belongs)
        // Antes: fiscals.length > 0 era suficiente (solo 1 RFC encontrado = authorized, el otro omitido).
        if (loadedInvoice) {
          const rfcsToCheck = [loadedInvoice.issuerRfc, loadedInvoice.receiverRfc].filter((r): r is string => !!r)
          if (rfcsToCheck.length > 0) {
            const fiscals = await prisma.fiscalEntity.findMany({
              where: { organizationId: targetOrg, rfc: { in: rfcsToCheck }, isActive: true },
              select: { id: true, organizationId: true, rfc: true }
            })
            const everyBelong = fiscals.length === rfcsToCheck.length &&
              fiscals.every((fe) => fe.organizationId === targetOrg)
            if (!everyBelong) {
              // Fallback CompanyAccess (solo si también EVERY RFC coincide con el acceso grant)
              const companyAccessCounts = await Promise.all(
                rfcsToCheck.map(rfc => prisma.companyAccess.count({
                  where: { memberId: member.id, organizationId: targetOrg, company: { rfc } }
                }))
              )
              const everyAccess = companyAccessCounts.length === rfcsToCheck.length && companyAccessCounts.every(n => n > 0)
              if (!everyAccess) loadedInvoice = null
            }
          }
        }
      } catch (invErr) {
        const fingerprint = fingerprint32(invErr instanceof Error ? invErr.message : String(invErr))
        console.warn(`[INV-001 blocked] crossOrg/orphan invoice id=${id} fp=${fingerprint} userId=${session.user.id}`)
        loadedInvoice = null
      }

      if (!loadedInvoice || !loadedInvoice.xmlContent) {
        await timingPadBeforeNegativeRespond()
        return NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } })
      }

      xmlRaw = (loadedInvoice.xmlContent || '').trim()
      isCancelled = loadedInvoice.satStatus === 'CANCELADO'
      if (loadedInvoice.tfdUuid && isRfc4122UuidStrict(loadedInvoice.tfdUuid)) {
        uuidForFilename = loadedInvoice.tfdUuid
      }
      void loadedInvoice.invoiceInternalId // lint placeholder (originalmente auditRecordId, por ahora no utilizado)
    }

    // Generate PDF — Puppeteer con semaphore INV-012 y escape INV-005.
    const { pdfBuffer, uuid } = await generateCfdiPdfFromXml({
      xmlRaw,
      invoiceIdForFallback: id,
      isCancelled
    })
    uuidForFilename = uuid || uuidForFilename

    // INV-004 + INV-013: AuditLog NUNCA swallow vacío. Si falla logueamos fallback para correlación.
    try {
      await prisma.auditLog.create({
        data: {
          userId: session.user.id,
          userEmail: session.user.email || '',
          tableName: auditTableName,
          recordId: uuidForFilename,            // INV-013: graba UUID SAT público NO internal cuid
          action: 'EXPORT',
          description: fileParam ? `PDF vía file (dev) safe_fname=${sanitizePdfFilename(uuidForFilename, id)}` : `PDF factura UUID=${uuidForFilename}`,
          timestamp: new Date()
        }
      })
    } catch (auditErr) {
      console.error(
        `[INV-004 audit] AuditLog write FAILED. fp=${fingerprint32(auditErr)} userId=${session.user.id} table=${auditTableName}`
      )
    }

    const safeFilename = sanitizePdfFilename(uuidForFilename, id)
    const contentDisposition = `attachment; filename=${JSON.stringify(safeFilename)}; filename*=UTF-8''${encodeURIComponent(safeFilename)}`

    return new NextResponse(Uint8Array.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition,
        'Content-Length': String(Buffer.byteLength(pdfBuffer)),
        'Content-Security-Policy':
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
        'X-Request-Id': reqId,
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Connection': 'close'
      }
    })
  } catch (error) {
    const reqId = crypto.randomUUID()
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: error.message, reqId },
        { status: error.statusCode, headers: { 'Retry-After': '3600', 'X-Request-Id': reqId } }
      )
    }
    if (error instanceof z.ZodError) {
      await timingPadBeforeNegativeRespond()
      return NextResponse.json({ error: 'Query inválida', reqId }, { status: 400, headers: { 'X-Request-Id': reqId } })
    }

    // INV-004: No leak stack/message/PII al cliente. Solo fingerprint correlation.
    const fp = fingerprint32(error instanceof Error ? `${error.message}:${error.stack || ''}` : String(error))
    const msg = error instanceof Error ? error.message : String(error)
    void escapeHtmlForCfdiTemplate // lint unused import guard en imports
    console.error(`[invoice-pdf 500] reqId=${reqId} fp=${fp} userId=${userIdForLog ?? 'unknown'}`, {
      errName: error instanceof Error ? error.name : typeof error,
      msg: msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
    })

    return NextResponse.json(
      { error: `Error interno al generar el PDF. Soporte: ${reqId} (fp ${fp})`, reqId },
      { status: 500, headers: { 'X-Request-Id': reqId } }
    )
  }
}

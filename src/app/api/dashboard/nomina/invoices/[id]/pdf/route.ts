import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import type { Session } from 'next-auth'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { generateCfdiPdfFromXml } from '@/lib/cfdi-pdf'
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
let _SAFE_DEV_BASE_DIR_CACHED: string | undefined
function getSafeDevBaseDir(): string {
  if (!_SAFE_DEV_BASE_DIR_CACHED) {
    _SAFE_DEV_BASE_DIR_CACHED = path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'java-client', 'xml-data')
  }
  return _SAFE_DEV_BASE_DIR_CACHED
}
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
    .regex(/^[\w./\\-]+$/, 'INV-010: invalid file charset')
    .optional()
})

/** INV-008 · HTTP Response Splitting safe filename: strip CRLF / control chars / non-alnum.
 *  filename DEBE venir de UUID sanitizado (RFC 4122), NUNCA de raw proveedor.
 */
function sanitizePdfFilename(uuidRaw: unknown, fallbackId: string): string {
  const candidate = typeof uuidRaw === 'string' ? uuidRaw : (fallbackId || 'document')
  const trimmed = candidate.trim()
  // 1) REMOVER secuencias URL encoded peligrosas %XX CR/LF/null — ANTES de reemplazar % con guion bajo.
  const strippedPercent = trimmed
    .replaceAll(/%[0-9a-f]{2}/gi, '_')
    .replaceAll('\0', '')
    .replaceAll(/[\r\n]/g, '_')
  // 2) Solo permitimos alfanumérico, guiones, guión bajo, puntos. Rechazamos cualquier otro.
  const firstPass = strippedPercent.replaceAll(/[^\w.-]/gi, '_')
  // 3) Blacklist de headers HTTP/keywords de inyección Response Splitting.
  const blacklistRe = /(set[-_]?cookie|content[-_]?type|content[-_]?disposition|mime[-_]?version|x[-_][a-z0-9]{2,})/gi
  const cleanedKeywords = firstPass.replaceAll(blacklistRe, '_REDACT_')
  const cleaned = cleanedKeywords.replaceAll(/\s+/g, '_')
  if (!cleaned || cleaned.replaceAll('_', '').length === 0) return `cfdi_${fallbackId}.pdf`
  // Max 64 chars filename.
  return `cfdi_${cleaned.slice(0, 64)}.pdf`
}

/** INV-014 · Timing safe 404: todas las respuestas negativas tardan el mismo rango. */
async function timingPadBeforeNegativeRespond() {
  const ms = TIMING_PADDED_DELAY_MS_MIN + crypto.randomInt(TIMING_PADDED_DELAY_MS_MAX - TIMING_PADDED_DELAY_MS_MIN)
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** INV-003 + INV-010 · file= mode dev sanitize. Resuelve con basename post-path. */
function resolveDevXmlFileSafe(raw: string): { safe: false; errorCode: number; errorMsg: string } | { safe: true; resolved: string } {
  if (!INVOICE_ENABLE_FILE_PARAM_IN_DEV) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-003: file param disabled. Set INVOICE_PDF_ENABLE_FILE_PARAM_IN_DEV=true en dev.' }
  }
  // INV-010 · Chequeo extensión SOBRE `basename(final)` no raw.
  const raw2 = String(raw || '').trim()
  const safeDevBaseDir = getSafeDevBaseDir()
  const candidate = path.resolve(safeDevBaseDir, raw2)
  const basenameFinal = path.basename(candidate).toLowerCase()
  if (!basenameFinal.endsWith('.xml')) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-010: file extension not allowed (only .xml after final basename resolution).' }
  }
  const normalizedCandidate = candidate.replaceAll('\\', '/')
  const normalizedBase = safeDevBaseDir.replaceAll('\\', '/')
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

async function processDevFileMode(fileParam: string, session: Session, reqId: string) {
  if (process.env.NODE_ENV === 'production') {
    await timingPadBeforeNegativeRespond()
    return {
      errorResponse: NextResponse.json(
        { error: 'Parámetro ?file= deshabilitado en producción', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId } }
      )
    }
  }

  const memberDev = await prisma.member.findFirst({
    where: { userId: session.user.id, status: 'APPROVED' },
    select: { organizationId: true, role: true, id: true }
  })
  if (!memberDev) {
    await timingPadBeforeNegativeRespond()
    return { errorResponse: NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } }) }
  }
  
  const userCtxDev = {
    id: session.user.id,
    systemRole: (session.user.systemRole || 'USER') as SystemRole,
    memberships: [{ organizationId: memberDev.organizationId, role: memberDev.role as MemberRole }]
  }
  if (!hasPermission(userCtxDev, Permission.CFDI_VIEW_PDF, memberDev.organizationId)) {
    await timingPadBeforeNegativeRespond()
    return { errorResponse: NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } }) }
  }

  const resolved = resolveDevXmlFileSafe(fileParam)
  if (!resolved.safe) {
    await timingPadBeforeNegativeRespond()
    return {
      errorResponse: NextResponse.json(
        { error: resolved.errorMsg, reqId },
        { status: resolved.errorCode, headers: { 'X-Request-Id': reqId } }
      )
    }
  }
  const xmlRaw = await readFile(resolved.resolved, 'utf8')
  return { xmlRaw, auditTableName: 'dev_xml_local' }
}

type LoadedInvoiceType = {
  xmlContent?: string | null;
  satStatus?: string | null;
  issuerRfc?: string | null;
  receiverRfc?: string | null;
  issuerFiscalEntityId?: string | null;
  tfdUuid?: string | null;
}

async function verifyInvoiceAccess(loadedInvoice: LoadedInvoiceType | null, memberId: string, targetOrg: string) {
  if (!loadedInvoice) return null
  const rfcsToCheck = [loadedInvoice.issuerRfc, loadedInvoice.receiverRfc].filter((r): r is string => !!r)
  if (rfcsToCheck.length === 0) return loadedInvoice

  const fiscals = await prisma.fiscalEntity.findMany({
    where: { organizationId: targetOrg, rfc: { in: rfcsToCheck }, isActive: true },
    select: { id: true, organizationId: true, rfc: true }
  })
  const everyBelong = fiscals.length === rfcsToCheck.length &&
    fiscals.every((fe) => fe.organizationId === targetOrg)
  if (everyBelong) return loadedInvoice

  const companyAccessCounts = await Promise.all(
    rfcsToCheck.map(rfc => prisma.companyAccess.count({
      where: { memberId, organizationId: targetOrg, company: { rfc } }
    }))
  )
  const everyAccess = companyAccessCounts.length === rfcsToCheck.length && companyAccessCounts.every(n => n > 0)
  return everyAccess ? loadedInvoice : null
}

async function processProductionMode(id: string, session: Session, reqId: string) {
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id, status: 'APPROVED' },
    select: { organizationId: true, role: true, id: true }
  })
  if (!member) {
    await timingPadBeforeNegativeRespond()
    return { errorResponse: NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } }) }
  }

  const u = {
    id: session.user.id,
    systemRole: (session.user.systemRole || 'USER') as SystemRole,
    memberships: [{ organizationId: member.organizationId, role: member.role as MemberRole }]
  }
  if (!hasPermission(u, Permission.CFDI_VIEW_PDF, member.organizationId)) {
    await timingPadBeforeNegativeRespond()
    return { errorResponse: NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } }) }
  }

  const targetOrg = member.organizationId
  let loadedInvoice = null

  try {
    const txResult = await prisma.$transaction(async tx => {
      const r1 = await getInvoiceXmlRecordById(id, targetOrg)
        .catch(() => null) as Awaited<ReturnType<typeof getInvoiceXmlRecordById>> | null
      if (r1) {
        return {
          xmlContent: r1.xmlContent,
          satStatus: r1.satStatus,
          issuerRfc: r1._meta?.issuerRfc ?? null,
          issuerFiscalEntityId: r1._meta?.issuerFiscalEntityId ?? null,
          tfdUuid: r1.uuid
        }
      }
      const r2 = await tx.satInvoice.findUnique({
        where: { id },
        select: {
          xmlContent: true, satStatus: true, issuerRfc: true, receiverRfc: true,
          fiscalEntityId: true, id: true,
          fiscalEntity: { select: { organizationId: true, rfc: true, isActive: true } }
        }
      })
      if (r2?.fiscalEntity?.organizationId !== targetOrg || r2?.fiscalEntity?.isActive !== true) {
        return null
      }
      return {
        xmlContent: r2.xmlContent,
        satStatus: r2.satStatus,
        issuerRfc: r2.issuerRfc,
        receiverRfc: r2.receiverRfc,
        issuerFiscalEntityId: r2.fiscalEntityId,
        tfdUuid: null
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    
    loadedInvoice = await verifyInvoiceAccess(txResult, member.id, targetOrg)
  } catch (invErr) {
    const fingerprint = fingerprint32(invErr instanceof Error ? invErr.message : String(invErr))
    console.warn(`[INV-001 blocked] crossOrg/orphan invoice id=${id} fp=${fingerprint} userId=${session.user.id}`)
    loadedInvoice = null
  }

  if (!loadedInvoice?.xmlContent) {
    await timingPadBeforeNegativeRespond()
    return { errorResponse: NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE, reqId }, { status: 404, headers: { 'X-Request-Id': reqId } }) }
  }

  const xmlRaw = (loadedInvoice.xmlContent || '').trim()
  const isCancelled = loadedInvoice.satStatus === 'CANCELADO'
  let uuidForFilename = id
  if (loadedInvoice.tfdUuid && isRfc4122UuidStrict(loadedInvoice.tfdUuid)) {
    uuidForFilename = loadedInvoice.tfdUuid
  }

  return { xmlRaw, isCancelled, uuidForFilename, auditTableName: 'invoice' }
}

async function validateAuthAndRateLimit() {
  const session = await auth()
  if (!session?.user?.id) {
    await timingPadBeforeNegativeRespond()
    return { errorResponse: NextResponse.json({ error: DEFAULT_NOT_FOUND_MESSAGE }, { status: 401 }), session: null }
  }
  rateLimitByUserId({
    userId: session.user.id,
    key: 'cfdi-view-pdf',
    limit: Number.isFinite(INVOICE_RATE_LIMIT_MAX_PER_HOUR) ? INVOICE_RATE_LIMIT_MAX_PER_HOUR : 180,
    windowMs: 60 * 60 * 1000
  })
  return { session, errorResponse: null }
}

async function writeAuditLog(session: Session, auditTableName: string, finalUuid: string, fileParam: string | undefined, id: string) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        userEmail: session.user.email || '',
        tableName: auditTableName,
        recordId: finalUuid,
        action: 'EXPORT',
        description: fileParam ? `PDF Nómina vía file (dev) safe_fname=${sanitizePdfFilename(finalUuid, id)}` : `PDF Nómina factura UUID=${finalUuid}`,
        timestamp: new Date()
      }
    })
  } catch (auditErr) {
    console.error(`[INV-004 audit] AuditLog write FAILED. fp=${fingerprint32(auditErr)} userId=${session.user.id} table=${auditTableName}`)
  }
}

function buildPdfResponse(pdfBuffer: Uint8Array, safeFilename: string, reqId: string) {
  const contentDisposition = `attachment; filename=${JSON.stringify(safeFilename)}; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition,
      'Content-Length': String(Buffer.byteLength(pdfBuffer)),
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
}

async function handlePdfError(error: unknown, userIdForLog: string | null) {
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

  const fp = fingerprint32(error instanceof Error ? `${error.message}:${error.stack ?? ''}` : error)
  const msg = error instanceof Error ? error.message : fingerprint32(error)
  console.error(`[invoice-pdf 500] reqId=${reqId} fp=${fp} userId=${userIdForLog ?? 'unknown'}`, {
    errName: error instanceof Error ? error.name : typeof error,
    msg: msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
  })

  return NextResponse.json(
    { error: `Error interno al generar el PDF. Soporte: ${reqId} (fp ${fp})`, reqId },
    { status: 500, headers: { 'X-Request-Id': reqId } }
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userIdForLog: string | null = null
  try {
    const authResult = await validateAuthAndRateLimit()
    if (authResult.errorResponse || !authResult.session) return authResult.errorResponse!
    
    const session = authResult.session
    userIdForLog = session.user.id

    const { id } = await params
    const reqId = crypto.randomUUID()

    const queryParse = pdfQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
    if (!queryParse.success) {
      await timingPadBeforeNegativeRespond()
      return NextResponse.json({ error: 'Query inválida', reqId }, { status: 400, headers: { 'X-Request-Id': reqId, 'Content-Type': 'application/json; charset=utf-8' } })
    }
    
    const fileParam = queryParse.data.file
    let xmlRaw = '', isCancelled = false, uuidForFilename = id
    let auditTableName = ''

    if (fileParam) {
      const devResult = await processDevFileMode(fileParam, session, reqId)
      if (devResult.errorResponse) return devResult.errorResponse
      xmlRaw = devResult.xmlRaw
      auditTableName = devResult.auditTableName
    } else {
      const prodResult = await processProductionMode(id, session, reqId)
      if (prodResult.errorResponse) return prodResult.errorResponse
      xmlRaw = prodResult.xmlRaw
      isCancelled = prodResult.isCancelled
      uuidForFilename = prodResult.uuidForFilename
      auditTableName = prodResult.auditTableName
    }

    const { pdfBuffer, uuid } = await generateCfdiPdfFromXml({
      xmlRaw,
      invoiceIdForFallback: id,
      isCancelled,
      templateType: 'nomina'
    })
    
    const finalUuid = uuid || uuidForFilename
    await writeAuditLog(session, auditTableName, finalUuid, fileParam, id)
    
    const safeFilename = sanitizePdfFilename(finalUuid, id)
    return buildPdfResponse(Uint8Array.from(pdfBuffer), safeFilename, reqId)
  } catch (error) {
    return handlePdfError(error, userIdForLog)
  }
}
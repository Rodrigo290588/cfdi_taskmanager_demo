import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createInvoiceFromXml } from '@/lib/invoice-import'
import { rateLimitByUserId, RateLimitError } from '@/lib/rate-limit'
import { hasPermission, Permission } from '@/lib/permissions'
import { safeErrSummary, fingerprint } from '@/lib/security'
import { detectXXEBytes } from '@/lib/xml-sanitize'
import { importBatchSchema, ENV_IMPORTS, sanitizeZodIssuesForClient } from '@/schemas/import'
import type { SystemRole, MemberRole } from '@prisma/client'

const MAX_XML_BYTES = ENV_IMPORTS.MAX_XML_BYTES
const MIN_XML_BYTES = ENV_IMPORTS.MIN_XML_BYTES
const MAX_TOTAL_BATCH_BYTES = ENV_IMPORTS.MAX_TOTAL_BATCH_BYTES

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  return response
}

type BatchResultItem = {
  uuid: string | null
  status: 'created' | 'skipped' | 'error'
  message?: string
}

export async function POST(request: NextRequest) {
  let userIdForLog: string | null = null

  try {
    // IMP-009 · Autenticación obligatoria (session check doble: proxy + route.ts)
    const session = await auth()
    if (!session?.user?.id) {
      return withSecurityHeaders(NextResponse.json({ error: 'No autorizado' }, { status: 401 }))
    }
    userIdForLog = session.user.id

    // IMP-007 · Resolver membresía y organización con scope estricto
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      select: { organizationId: true, role: true, id: true }
    })
    if (!member) {
      return withSecurityHeaders(NextResponse.json({ error: 'Sin membresía activa en la organización' }, { status: 403 }))
    }

    // IMP-008 · Permiso granular CFDI_IMPORT_BATCH (Regla 10 Gestión Dinámica Permisos)
    const u = {
      id: session.user.id,
      systemRole: (session.user.systemRole || 'USER') as SystemRole,
      memberships: [{ organizationId: member.organizationId, role: member.role as MemberRole }]
    }
    if (!hasPermission(u, Permission.CFDI_IMPORT_BATCH, member.organizationId)) {
      return withSecurityHeaders(NextResponse.json({ error: 'Permiso insuficiente para importar CFDI' }, { status: 403 }))
    }

    // IMP-002 / IMP-017 · Rate limit por usuario: 10 lotes / hora
    rateLimitByUserId({
      userId: session.user.id,
      key: 'cfdi-import-batch',
      limit: 10,
      windowMs: 60 * 60 * 1000
    })

    // IMP-017 · Body size hard limit antes de JSON parse (250MB total batch max)
    const clHeader = request.headers.get('content-length')
    if (clHeader) {
      const size = Number(clHeader)
      if (!Number.isFinite(size) || size <= 0) {
        return withSecurityHeaders(NextResponse.json({ error: 'Content-Length inválido o ausente' }, { status: 411 }))
      }
      if (size > MAX_TOTAL_BATCH_BYTES) {
        return withSecurityHeaders(NextResponse.json({ error: 'Payload excede tamaño máximo permitido' }, { status: 413 }))
      }
    }
    const ct = (request.headers.get('content-type') || '').trim().toLowerCase()
    if (!ct.includes('application/json')) {
      return withSecurityHeaders(NextResponse.json({ error: 'Content-Type debe ser application/json' }, { status: 415 }))
    }

    // IMP-008 / IMP-017 / IMP-022 · Validación estricta Zod schema (strict + superRefine limits)
    const rawBody = await request.json()
    const batch = importBatchSchema.parse(rawBody)

    const contextCache = new Map<string, Promise<{ userId: string; issuerFiscalEntityId: string }>>()
    const results: BatchResultItem[] = []

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]
      const xml = (item.xmlContent || item.xml || item.rawXml || '').trim()

      // IMP-001 / IMP-016 · Detección XXE nivel byte (BOM, whitespace, comments, ENTITY, Billion Laughs)
      const xmlBytesArr = Buffer.from(xml, 'utf8')
      const xxe = detectXXEBytes(xmlBytesArr)
      if (xxe) {
        results.push({
          uuid: null,
          status: 'error',
          message: `Registro ${i + 1}: XML bloqueado por política anti-XXE (${xxe.kind} score=${xxe.score})`
        })
        continue
      }

      // IMP-017 · Tamaño de XML acotado por registro (redundancia segura post-Zod)
      const xmlBytes = Buffer.byteLength(xml, 'utf8')
      if (xmlBytes < MIN_XML_BYTES || xmlBytes > MAX_XML_BYTES) {
        results.push({
          uuid: null,
          status: 'error',
          message: `Registro ${i + 1}: tamaño XML fuera de rango permitido (${MIN_XML_BYTES}-${MAX_XML_BYTES} bytes)`
        })
        continue
      }

      try {
        const result = await createInvoiceFromXml(prisma, xml, contextCache, member.organizationId, {
          importingMemberId: member.id,
          importingUserId: session.user.id,
          importingOrganizationId: member.organizationId
        })
        // IMP-014 · OMITIR Prisma number id (nunca exponer IDs técnicos al cliente)
        results.push({
          status: result.status,
          uuid: result.uuid,
          message: result.message
        })
      } catch (error) {
        const errSum = safeErrSummary(error)
        const errFp = fingerprint(JSON.stringify(errSum) + ':' + (userIdForLog || '')).slice(0, 16)
        // IMP-012 · NO leakear PII/XML. Solo mensaje genérico + errFp correlación
        console.error('[import-batch item-error]', {
          reg: i + 1,
          userId: userIdForLog,
          orgId: member.organizationId,
          errKind: errSum.name,
          errFp
        })
        results.push({
          uuid: null,
          status: 'error',
          message: process.env.NODE_ENV !== 'production' && error instanceof Error
            ? `Registro ${i + 1}: ${error.message.slice(0, 200)}`
            : `Registro ${i + 1}: Error al procesar el CFDI (ref ${errFp})`
        })
      }
    }

    const summary = {
      total: batch.length,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
      processedAt: new Date().toISOString()
    }

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        userEmail: session.user.email || '',
        tableName: 'invoice',
        action: 'IMPORT',
        recordId: fingerprint(member.organizationId).slice(0, 16),
        description: `CFDI batch: ${summary.total} registros, ${summary.created} insertados, ${summary.errors} errores`,
        timestamp: new Date()
      }
    }).catch((e) => {
      console.error('[import-batch audit-best-effort]', safeErrSummary(e))
    })

    // IMP-019 · Respuesta sync: mantener pero con header Connection close para liberar socket
    // Mejora BullMQ opcional en roadmap: 202 Accepted + jobId + poll URL.
    const response = NextResponse.json({
      success: summary.errors === 0,
      results,
      summary,
      message: `Procesados ${summary.total} registros. Insertados ${summary.created}.`
    })
    response.headers.set('Connection', 'close')
    return withSecurityHeaders(response)
  } catch (error: unknown) {
    const reqId = crypto.randomUUID()
    if (error instanceof RateLimitError) {
      const retrySec = Math.max(1, Math.ceil(error.retryAfterMs / 1000))
      const resp = NextResponse.json(
        { error: error.message, reqId },
        { status: error.statusCode, headers: { 'Retry-After': String(retrySec) } }
      )
      return withSecurityHeaders(resp)
    }
    // IMP-013 · Zod issues: sanitizar paths numéricos → <index> y NO leakear data cruda
    if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ZodError') {
      const zodErr = error as z.ZodError
      const safe = sanitizeZodIssuesForClient(zodErr.issues)
      const resp = NextResponse.json(
        {
          error: 'Datos de entrada inválidos',
          reqId,
          details: safe
        },
        { status: 400 }
      )
      return withSecurityHeaders(resp)
    }
    // IMP-012 · Nunca leakear stack / Prisma / XML al cliente. Solo reqId + safeErrSummary en logs.
    const safe = safeErrSummary(error)
    console.error('[import-batch 500]', {
      reqId,
      userId: userIdForLog,
      safe
    })
    const resp = NextResponse.json(
      { error: 'Error interno del servidor. ID soporte: ' + reqId },
      { status: 500 }
    )
    return withSecurityHeaders(resp)
  }
}

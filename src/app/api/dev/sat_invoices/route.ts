import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { enforceDevEndpoint, getDevEnvStatus } from '@/lib/dev-endpoint-guard'
import { auth } from '@/lib/auth'
import { DevSatInvoicesQuerySchema, MAX_DEV_SAT_INVOICES_LIMIT } from '@/schemas/dev'
import { createAuditEntry } from '@/lib/audit'
import { getRealClientIp } from '@/lib/security'

function applyHardeningHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'self'")
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return res
}

function safeRfcError(raw: string | null): string {
  if (!raw) return 'RFC inválido (vacío)'
  const cleaned = String(raw).replace(/[<>"'&\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  return 'RFC inválido: ' + cleaned + ' (longitud 12-13 SAT alfanum)'
}

export async function GET(request: NextRequest) {
  const guard = await enforceDevEndpoint(request, { requireSuperAdmin: true })
  if (guard) return applyHardeningHeaders(guard)

  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
      return applyHardeningHeaders(NextResponse.json({ error: 'Sesión no encontrada' }, { status: 401 }))
    }

    const { searchParams } = new URL(request.url)
    const rawLimit = searchParams.get('limit')
    const rawRfc = searchParams.get('rfc')

    const parsed = DevSatInvoicesQuerySchema.safeParse({
      limit: rawLimit ?? undefined,
      rfc: rawRfc ?? undefined,
      includeDeleted: searchParams.get('includeDeleted') ?? undefined
    })
    if (!parsed.success) {
      const msgs = parsed.error.issues.map(i => i.message).join(' · ')
      const msg = rawRfc ? safeRfcError(rawRfc) + ' · Detalles: ' + msgs : 'Parámetros inválidos · ' + msgs
      const body = { error: msg, issues: parsed.error.flatten().fieldErrors }
      return applyHardeningHeaders(NextResponse.json(body, { status: 400 }))
    }
    const { limit, rfc, includeDeleted } = parsed.data

    const userOrgsIds = (
      await prisma.member.findMany({
        where: { userId, status: 'APPROVED' },
        select: { organizationId: true }
      })
    ).map(m => m.organizationId)

    const allowedFiscalEntityIds = (
      await prisma.fiscalEntity.findMany({
        where: {
          organizationId: { in: userOrgsIds },
          ...(includeDeleted ? {} : { isActive: true })
        },
        select: { id: true }
      })
    ).map(f => f.id)

    const where: Prisma.SatInvoiceWhereInput = {
      fiscalEntityId: { in: allowedFiscalEntityIds },
      ...(rfc ? { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] } : {})
    }

    const rows = await prisma.satInvoice.findMany({
      where,
      orderBy: { issuanceDate: 'desc' },
      take: limit,
      select: {
        id: true,
        uuid: true,
        cfdiType: true,
        issuerRfc: true,
        issuerName: true,
        receiverRfc: true,
        receiverName: true,
        subtotal: true,
        total: true,
        issuanceDate: true,
        satStatus: true,
        paymentMethod: true,
        paymentForm: true,
        currency: true,
        fiscalEntityId: true
      }
    })

    await createAuditEntry({
      tableName: 'AuditLog',
      recordId: 'sat_invoices_search',
      action: 'SAT_INVOICES_SEARCH',
      userId,
      userEmail: session?.user?.email,
      description: `Búsqueda SAT dev devolvió ${rows.length} registros`,
      ipAddress: getRealClientIp(request.headers),
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      newValues: {
        filters: { rfc: rfc ? Boolean(rfc) : false, limit, includeDeleted },
        envStatus: getDevEnvStatus(),
        rowsReturned: rows.length,
        allowedFiscalEntities: allowedFiscalEntityIds.length
      }
    }).catch(() => {})

    const body = {
      count: rows.length,
      limitApplies: limit,
      maxAllowed: MAX_DEV_SAT_INVOICES_LIMIT,
      invoices: rows
    }
    return applyHardeningHeaders(NextResponse.json(body, { status: 200 }))
  } catch (error) {
    const fingerprint = (await import('node:crypto'))
      .createHash('sha256')
      .update(String((error as Error)?.message || 'empty'))
      .digest('hex')
      .slice(0, 16)
    const errWithCode = error as unknown as { code?: unknown }
    const code = typeof errWithCode.code === 'string' ? errWithCode.code : 'UNKNOWN'
    console.error('[dev-sat_invoices 500]', { fingerprint, code, name: (error as Error)?.name })
    return applyHardeningHeaders(
      NextResponse.json({ error: 'Error interno (ref #' + fingerprint + ')' }, { status: 500 })
    )
  }
}

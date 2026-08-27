import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
import type { SystemRole, MemberRole } from '@prisma/client'
import { rateLimit } from '@/lib/rate-limit'
import { SAT_SECURITY_HEADERS, safeErrSummarySat, satIncidentFingerprint, satValidateCompanyIdFormat } from '@/lib/sat-gate-helpers'
import { enrichUserWithMemberships, hasPermission, Permission as Perm } from '@/lib/permissions'
import type { User } from '@/lib/permissions'

const SAT_CFDIS_INV_RL = Object.freeze({
  IP_1M: Object.freeze({ keyPrefix: 'sat_cfdis_inv_ip', limit: 50, intervalMs: 60_000 }),
  USER_1M: Object.freeze({ keyPrefix: 'sat_cfdis_inv_user', limit: 100, intervalMs: 60_000 }),
  ORG_DAY: Object.freeze({ keyPrefix: 'sat_cfdis_inv_org_day', limit: 10_000, intervalMs: 86_400_000 }),
})

const SAT_CFDIS_CACHE = Object.freeze({
  'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
})

const __ALLOWED_PAYMENT_METHODS = Object.freeze(new Set(['PUE', 'PPD']))
const __SAT_CFDIS_QUERY_MAX = 512
const __SAT_CFDIS_LIMIT_MAX = 100
const __SAT_CFDIS_PAGE_MAX = 10_000
const __SAT_CFDIS_YEAR_MIN = 2017 // CFDI 3.3 / 4.0 era

function __mergeSatCfdisInvHeaders(extra?: Record<string, string> | null): Record<string, string> {
  const merged: Record<string, string> = {
    ...SAT_SECURITY_HEADERS,
    ...SAT_CFDIS_CACHE,
    'X-Request-Id': satIncidentFingerprint('sat_cfdis_inv_request'),
  }
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') merged[k] = v
  }
  return merged
}

function __satCfdisParseDateStrict(val: unknown): Date | null {
  if (typeof val !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return null
  const dt = new Date(`${val}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return null
  if (dt.getUTCFullYear() < __SAT_CFDIS_YEAR_MIN) return null
  const nowPlusDay = new Date(Date.now() + 86_400_000)
  if (dt.getTime() > nowPlusDay.getTime()) return null
  return dt
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const ipCandidate = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || '127.0.0.1'
    const rlIp = await rateLimit(`${SAT_CFDIS_INV_RL.IP_1M.keyPrefix}:${ipCandidate}`, { interval: SAT_CFDIS_INV_RL.IP_1M.intervalMs, limit: SAT_CFDIS_INV_RL.IP_1M.limit })
    if (!rlIp.success) {
      return NextResponse.json(
        { error: 'Rate limit: demasiadas solicitudes por IP' },
        { status: 429, headers: __mergeSatCfdisInvHeaders({ 'Retry-After': String(Math.ceil((rlIp.retryAfterMs ?? 60_000) / 1000)) }) }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: __mergeSatCfdisInvHeaders() })
    }

    const rlUser = await rateLimit(`${SAT_CFDIS_INV_RL.USER_1M.keyPrefix}:${session.user.id}`, { interval: SAT_CFDIS_INV_RL.USER_1M.intervalMs, limit: SAT_CFDIS_INV_RL.USER_1M.limit })
    if (!rlUser.success) {
      return NextResponse.json(
        { error: 'Rate limit: demasiadas solicitudes por usuario' },
        { status: 429, headers: __mergeSatCfdisInvHeaders({ 'Retry-After': String(Math.ceil((rlUser.retryAfterMs ?? 60_000) / 1000)) }) }
      )
    }

    const { searchParams } = new URL(request.url)
    const companyIdRaw = searchParams.get('companyId')
    if (!companyIdRaw) return NextResponse.json({ error: 'companyId requerido' }, { status: 400, headers: __mergeSatCfdisInvHeaders() })
    const validCompany = satValidateCompanyIdFormat(companyIdRaw)
    if (!validCompany.ok) return NextResponse.json({ error: validCompany.error }, { status: validCompany.status, headers: __mergeSatCfdisInvHeaders() })
    const companyId = companyIdRaw

    const pageRaw = Number(searchParams.get('page'))
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1
    if (page > __SAT_CFDIS_PAGE_MAX) {
      return NextResponse.json(
        { error: `page excede límite máximo ${__SAT_CFDIS_PAGE_MAX}` },
        { status: 400, headers: __mergeSatCfdisInvHeaders() }
      )
    }

    const limitRaw = Number(searchParams.get('limit'))
    let limit = (!Number.isFinite(limitRaw) || limitRaw < 1) ? 20 : Math.floor(limitRaw)
    if (limit > __SAT_CFDIS_LIMIT_MAX) limit = __SAT_CFDIS_LIMIT_MAX

    const queryRaw = searchParams.get('query') || ''
    if (queryRaw.length > __SAT_CFDIS_QUERY_MAX) {
      const fp = satIncidentFingerprint('sat_cfdis_inv_query_413', queryRaw.length, __SAT_CFDIS_QUERY_MAX)
      return NextResponse.json(
        { error: 'Búsqueda query demasiado larga (máximo 512 caracteres)', incidentFingerprint: fp },
        { status: 413, headers: __mergeSatCfdisInvHeaders() }
      )
    }
    const safeQuery = queryRaw.replace(/[%_\\]/g, '').slice(0, __SAT_CFDIS_QUERY_MAX).trim()

    const cfdiTypeKey = searchParams.get('cfdiType')
    const cfdiTypeVal: CfdiType | null = (cfdiTypeKey && cfdiTypeKey in CfdiType) ? CfdiType[cfdiTypeKey as keyof typeof CfdiType] : null
    const statusKey = searchParams.get('status')
    const statusVal: InvoiceStatus | null = (statusKey && statusKey in InvoiceStatus) ? InvoiceStatus[statusKey as keyof typeof InvoiceStatus] : null
    const satStatusKey = searchParams.get('satStatus')
    const satStatusVal: SatStatus | null = (satStatusKey && satStatusKey in SatStatus) ? SatStatus[satStatusKey as keyof typeof SatStatus] : null

    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const fromD = dateFrom ? __satCfdisParseDateStrict(dateFrom) : null
    const toD = dateTo ? __satCfdisParseDateStrict(dateTo) : null
    if ((dateFrom && !fromD) || (dateTo && !toD)) {
      return NextResponse.json(
        { error: 'Formato de fecha inválido. Usa YYYY-MM-DD (rango permitido: 2017-01-01 al mañana con respecto a hoy UTC)' },
        { status: 400, headers: __mergeSatCfdisInvHeaders() }
      )
    }
    if (fromD && toD && fromD.getTime() > toD.getTime()) {
      return NextResponse.json({ error: 'dateFrom debe ser anterior o igual a dateTo' }, { status: 400, headers: __mergeSatCfdisInvHeaders() })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' as const },
      select: { id: true, organizationId: true, userId: true },
    })
    if (!member || !member.organizationId) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404, headers: __mergeSatCfdisInvHeaders() })
    }
    const organizationId = member.organizationId

    const rlOrg = await rateLimit(`${SAT_CFDIS_INV_RL.ORG_DAY.keyPrefix}:${organizationId}`, { interval: SAT_CFDIS_INV_RL.ORG_DAY.intervalMs, limit: SAT_CFDIS_INV_RL.ORG_DAY.limit })
    if (!rlOrg.success) {
      return NextResponse.json(
        { error: 'Rate limit: cupo diario por organización excedido para listado de CFDIs SAT' },
        { status: 429, headers: __mergeSatCfdisInvHeaders({ 'Retry-After': String(Math.ceil((rlOrg.retryAfterMs ?? 86_400_000) / 1000)) }) }
      )
    }

    const access = await prisma.companyAccess.findFirst({
      where: { memberId: member.id, companyId, organizationId },
      select: { id: true, memberId: true, companyId: true, organizationId: true },
    })
    if (!access || access.organizationId !== organizationId) {
      const fp = satIncidentFingerprint('sat_cfdis_inv_access_denied', session.user.id, member.id, companyId, organizationId)
      return NextResponse.json(
        { error: 'Sin acceso a la empresa o acceso revocado', incidentFingerprint: fp },
        { status: 403, headers: __mergeSatCfdisInvHeaders() }
      )
    }

    const userRaw = session.user as { id: string; systemRole?: SystemRole; memberships?: Array<{ organizationId: string; role: MemberRole }> }
    const systemRole = userRaw.systemRole ?? ('USER' as SystemRole)
    const enrichedUser: User = await enrichUserWithMemberships({ id: session.user.id, systemRole })
    const canView = hasPermission(enrichedUser, Perm.SAT_CFDIS_VIEW, organizationId)
    if (!canView) {
      const fp = satIncidentFingerprint('sat_cfdis_inv_permission_denied', session.user.id, organizationId, Perm.SAT_CFDIS_VIEW)
      return NextResponse.json(
        { error: 'Sin permisos para ver listado SAT CFDIs', incidentFingerprint: fp },
        { status: 403, headers: __mergeSatCfdisInvHeaders() }
      )
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, id: true },
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: __mergeSatCfdisInvHeaders() })
    }
    if (access.organizationId) {
      const companyInOrg = await prisma.companyAccess.findFirst({
        where: { companyId: company.id, memberId: member.id, organizationId: access.organizationId },
        select: { organizationId: true },
      })
      if (!companyInOrg) {
        const fp = satIncidentFingerprint('sat_cfdis_inv_company_outside_org', session.user.id, company.id, organizationId)
        return NextResponse.json(
          { error: 'Empresa no encontrada en la organización', incidentFingerprint: fp },
          { status: 404, headers: __mergeSatCfdisInvHeaders() }
        )
      }
    }

    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc: company.rfc, organizationId, isActive: true },
      select: { id: true, organizationId: true, rfc: true },
    })
    if (!fiscalEntity) {
      return NextResponse.json(
        { invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } },
        { status: 200, headers: __mergeSatCfdisInvHeaders() }
      )
    }

    const where: Prisma.SatInvoiceWhereInput = { fiscalEntityId: fiscalEntity.id }

    if (safeQuery) {
      const orParts: Prisma.SatInvoiceWhereInput[] = []
      orParts.push({ uuid: { startsWith: safeQuery, mode: 'insensitive' } })
      orParts.push({ issuerRfc: { startsWith: safeQuery, mode: 'insensitive' } })
      orParts.push({ receiverRfc: { startsWith: safeQuery, mode: 'insensitive' } })
      orParts.push({ folio: { startsWith: safeQuery, mode: 'insensitive' } })
      if (/^[\p{L}\p{N}\s.,\-&']+$/u.test(safeQuery) && safeQuery.length >= 2) {
        orParts.push({ issuerName: { contains: safeQuery, mode: 'insensitive' } })
        orParts.push({ receiverName: { contains: safeQuery, mode: 'insensitive' } })
      }
      where.OR = orParts
    }

    if (cfdiTypeVal) where.cfdiType = cfdiTypeVal
    if (statusVal) where.status = statusVal
    if (satStatusVal) where.satStatus = satStatusVal

    const issuanceFilter: Prisma.DateTimeFilter = {}
    if (fromD) issuanceFilter.gte = fromD
    if (toD) issuanceFilter.lte = toD
    if (fromD || toD) where.issuanceDate = issuanceFilter

    const skip = (page - 1) * limit

    const select: Prisma.SatInvoiceSelect = {
      id: true, uuid: true, cfdiType: true, series: true, folio: true,
      issuerRfc: true, issuerName: true, receiverRfc: true, receiverName: true,
      subtotal: true, total: true, issuanceDate: true, status: true, satStatus: true,
      paymentForm: true, paymentMethod: true, currency: true,
    }

    const [rows, total] = await Promise.all([
      prisma.satInvoice.findMany({ where, orderBy: { issuanceDate: 'desc' }, skip, take: limit, select }),
      prisma.satInvoice.count({ where }),
    ])

    const invoices = rows.map((r) => ({
      id: String(r.id),
      uuid: String(r.uuid),
      cfdiType: String(r.cfdiType),
      series: (r.series as string | null) ?? null,
      folio: (r.folio as string | null) ?? null,
      issuerRfc: String(r.issuerRfc),
      issuerName: String(r.issuerName),
      receiverRfc: String(r.receiverRfc),
      receiverName: String(r.receiverName),
      subtotal: Number(r.subtotal ?? 0),
      total: Number(r.total ?? 0),
      issuanceDate: r.issuanceDate instanceof Date ? r.issuanceDate.toISOString() : String(r.issuanceDate),
      status: String(r.status),
      satStatus: String(r.satStatus),
      paymentForm: __ALLOWED_PAYMENT_METHODS.has(String(r.paymentForm ?? '')) ? String(r.paymentForm) : (String(r.paymentForm ?? '') || null),
      paymentMethod: String(r.paymentMethod ?? ''),
      currency: String(r.currency ?? 'MXN'),
    }))

    return NextResponse.json(
      {
        invoices,
        pagination: { total, page, limit, totalPages: total > 0 ? Math.ceil(total / limit) : 0 },
      },
      { status: 200, headers: __mergeSatCfdisInvHeaders() }
    )
  } catch (error) {
    const summary = safeErrSummarySat(error)
    console.error('[SATCFDIS-ERR] invoices_fetch_fail fp=%s name=%s', summary.incidentFingerprint, summary.name)
    return NextResponse.json(
      { error: 'Error interno del servidor', incidentFingerprint: summary.incidentFingerprint },
      { status: 500, headers: __mergeSatCfdisInvHeaders() }
    )
  }
}

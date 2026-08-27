import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { SAT_SECURITY_HEADERS, safeErrSummarySat, satIncidentFingerprint, satValidateCompanyIdFormat } from '@/lib/sat-gate-helpers'
import { enrichUserWithMemberships, hasPermission, Permission as Perm } from '@/lib/permissions'
import type { User } from '@/lib/permissions'
import type { SystemRole, MemberRole } from '@prisma/client'
import { Prisma } from '@prisma/client'

const SAT_CFDIS_RL = Object.freeze({
  IP_1M: Object.freeze({ keyPrefix: 'sat_cfdis_get_ip', limit: 40, intervalMs: 60_000 }),
  USER_1M: Object.freeze({ keyPrefix: 'sat_cfdis_get_user', limit: 80, intervalMs: 60_000 }),
  ORG_DAY: Object.freeze({ keyPrefix: 'sat_cfdis_get_org_day', limit: 5000, intervalMs: 86_400_000 }),
})

const SAT_CFDIS_RESPONSE_CACHE = Object.freeze({
  'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
})

function __satCfdisMergeHeaders(extra?: Record<string, string> | null): Record<string, string> {
  const merged: Record<string, string> = {
    ...SAT_SECURITY_HEADERS,
    ...SAT_CFDIS_RESPONSE_CACHE,
    'X-Request-Id': satIncidentFingerprint('sat_cfdis_request'),
  }
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string') merged[k] = v
    }
  }
  return merged
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const ipCandidate = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || '127.0.0.1'
    const rlIp = await rateLimit(`${SAT_CFDIS_RL.IP_1M.keyPrefix}:${ipCandidate}`, { interval: SAT_CFDIS_RL.IP_1M.intervalMs, limit: SAT_CFDIS_RL.IP_1M.limit })
    if (!rlIp.success) {
      return NextResponse.json(
        { error: 'Rate limit: demasiadas solicitudes por IP' },
        { status: 429, headers: __satCfdisMergeHeaders({ 'Retry-After': String(Math.ceil((rlIp.retryAfterMs ?? 60_000) / 1000)) }) }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: __satCfdisMergeHeaders() })
    }

    const rlUser = await rateLimit(`${SAT_CFDIS_RL.USER_1M.keyPrefix}:${session.user.id}`, { interval: SAT_CFDIS_RL.USER_1M.intervalMs, limit: SAT_CFDIS_RL.USER_1M.limit })
    if (!rlUser.success) {
      return NextResponse.json(
        { error: 'Rate limit: demasiadas solicitudes por usuario' },
        { status: 429, headers: __satCfdisMergeHeaders({ 'Retry-After': String(Math.ceil((rlUser.retryAfterMs ?? 60_000) / 1000)) }) }
      )
    }

    const { searchParams } = new URL(request.url)
    const companyIdRaw = searchParams.get('companyId')
    if (!companyIdRaw) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400, headers: __satCfdisMergeHeaders() })
    }
    const validCompany = satValidateCompanyIdFormat(companyIdRaw)
    if (!validCompany.ok) {
      return NextResponse.json({ error: validCompany.error }, { status: validCompany.status, headers: __satCfdisMergeHeaders() })
    }
    const companyId = companyIdRaw

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' as const },
      select: { id: true, organizationId: true, userId: true, organization: { select: { id: true } } },
    })
    if (!member || !member.organizationId) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404, headers: __satCfdisMergeHeaders() })
    }
    const organizationId = member.organizationId

    const rlOrg = await rateLimit(`${SAT_CFDIS_RL.ORG_DAY.keyPrefix}:${organizationId}`, { interval: SAT_CFDIS_RL.ORG_DAY.intervalMs, limit: SAT_CFDIS_RL.ORG_DAY.limit })
    if (!rlOrg.success) {
      return NextResponse.json(
        { error: 'Rate limit: cupo diario de consultas por organización excedido' },
        { status: 429, headers: __satCfdisMergeHeaders({ 'Retry-After': String(Math.ceil((rlOrg.retryAfterMs ?? 86_400_000) / 1000)) }) }
      )
    }

    const access = await prisma.companyAccess.findFirst({
      where: { memberId: member.id, companyId, organizationId },
      select: { id: true, memberId: true, companyId: true, organizationId: true },
    })
    if (!access || access.organizationId !== organizationId) {
      const fp = satIncidentFingerprint('sat_cfdis_company_access_denied', session.user.id, member.id, companyId, organizationId)
      return NextResponse.json(
        { error: 'Sin acceso a la empresa o acceso revocado', incidentFingerprint: fp },
        { status: 403, headers: __satCfdisMergeHeaders() }
      )
    }

    const userRaw = session.user as { id: string; systemRole?: SystemRole; memberships?: Array<{ organizationId: string; role: MemberRole }> }
    const systemRole = userRaw.systemRole ?? ('USER' as SystemRole)
    const enrichedUser: User = await enrichUserWithMemberships({ id: session.user.id, systemRole })
    const canView = hasPermission(enrichedUser, Perm.SAT_CFDIS_VIEW, organizationId)
    if (!canView) {
      const fp = satIncidentFingerprint('sat_cfdis_permission_denied', session.user.id, organizationId, Perm.SAT_CFDIS_VIEW)
      return NextResponse.json(
        { error: 'Sin permisos para ver dashboard SAT CFDIs', incidentFingerprint: fp },
        { status: 403, headers: __satCfdisMergeHeaders() }
      )
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, rfc: true, businessName: true },
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: __satCfdisMergeHeaders() })
    }
    if (access.organizationId) {
      // Verificación silo cross-org: companyAccess.organizationId debe coincidir (redundancia safe BOLA)
      const companyInOrg = await prisma.companyAccess.findFirst({
        where: { companyId: company.id, memberId: member.id, organizationId: access.organizationId },
        select: { organizationId: true },
      })
      if (!companyInOrg) {
        const fp = satIncidentFingerprint('sat_cfdis_company_outside_org_silo', session.user.id, company.id, organizationId)
        return NextResponse.json(
          { error: 'Empresa no encontrada en la organización', incidentFingerprint: fp },
          { status: 404, headers: __satCfdisMergeHeaders() }
        )
      }
    }
    const rfc = company.rfc

    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc, organizationId, isActive: true },
      select: { id: true, rfc: true, organizationId: true },
    })
    if (!fiscalEntity) {
      return NextResponse.json(
        {
          company: { id: companyId, rfc, name: company.businessName ?? null },
          kpis: { totalCfdis: 0, totalMonto: 0, tasaCancelacion: 0 },
          byType: [],
          bySatStatus: [],
          monthly: [],
          topSuppliers: [],
          topClients: [],
          paymentMethods: [],
        },
        { status: 200, headers: __satCfdisMergeHeaders() }
      )
    }

    const baseWhere: Prisma.SatInvoiceWhereInput = { fiscalEntityId: fiscalEntity.id }
    const invoiceIsCompanyIssuer: Prisma.SatInvoiceWhereInput = { ...baseWhere, issuerRfc: rfc }
    const invoiceIsCompanyReceiver: Prisma.SatInvoiceWhereInput = { ...baseWhere, receiverRfc: rfc }
    const invoiceEitherSide: Prisma.SatInvoiceWhereInput = { ...baseWhere, OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] }

    const [byType, bySatStatus, monthly, topSuppliers, topClients, paymentMethods, totals, canceladosCount] = await Promise.all([
      prisma.satInvoice.groupBy({
        by: ['cfdiType'],
        where: invoiceEitherSide,
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.satInvoice.groupBy({
        by: ['satStatus'],
        where: invoiceEitherSide,
        _count: { _all: true },
      }),
      prisma.satInvoice.groupBy({
        by: ['issuanceDate'],
        where: invoiceEitherSide,
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.satInvoice.groupBy({
        by: ['issuerName'],
        where: invoiceIsCompanyReceiver,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' as const } },
        take: 10,
      }),
      prisma.satInvoice.groupBy({
        by: ['receiverName'],
        where: invoiceIsCompanyIssuer,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' as const } },
        take: 10,
      }),
      prisma.satInvoice.groupBy({
        by: ['paymentMethod'],
        where: invoiceEitherSide,
        _count: { _all: true },
      }),
      prisma.satInvoice.aggregate({
        where: invoiceEitherSide,
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.satInvoice.count({
        where: { ...invoiceEitherSide, satStatus: 'CANCELADO' as const },
      }),
    ])

    const totalCfdis = Number(totals._count._all ?? 0)
    const tasaCancelacion = totalCfdis > 0 ? Math.round((canceladosCount / totalCfdis) * 10000) / 100 : 0

    const monthlySeries: Array<{ label: string; count: number; total: number }> = monthly
      .map((m) => {
        const raw = m.issuanceDate
        const d = raw instanceof Date ? raw : new Date(String(raw))
        const cnt = Number(m._count?._all ?? 0)
        const sumTotal = Number(m._sum?.total ?? 0)
        if (Number.isNaN(d.getTime())) return null
        return { label: d.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }), count: cnt, total: sumTotal }
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => new Date(a.label).getTime() - new Date(b.label).getTime())

    return NextResponse.json(
      {
        company: { id: companyId, rfc, name: company.businessName ?? null },
        kpis: { totalCfdis, totalMonto: Number(totals._sum.total ?? 0), tasaCancelacion },
        byType: byType.map((t) => ({ type: String(t.cfdiType ?? ''), count: Number(t._count?._all ?? 0), total: Number(t._sum?.total ?? 0) })),
        bySatStatus: bySatStatus.map((s) => ({ status: String(s.satStatus ?? ''), count: Number(s._count?._all ?? 0) })),
        monthly: monthlySeries,
        topSuppliers: topSuppliers.map((s) => ({ name: String(s.issuerName ?? ''), total: Number(s._sum?.total ?? 0) })),
        topClients: topClients.map((c) => ({ name: String(c.receiverName ?? ''), total: Number(c._sum?.total ?? 0) })),
        paymentMethods: paymentMethods.map((p) => ({ method: String(p.paymentMethod ?? ''), count: Number(p._count?._all ?? 0) })),
      },
      { status: 200, headers: __satCfdisMergeHeaders() }
    )
  } catch (error) {
    const summary = safeErrSummarySat(error)
    console.error('[SATCFDIS-ERR] metrics_fail fp=%s name=%s', summary.incidentFingerprint, summary.name)
    return NextResponse.json(
      { error: 'Error interno del servidor', incidentFingerprint: summary.incidentFingerprint },
      { status: 500, headers: __satCfdisMergeHeaders() }
    )
  }
}


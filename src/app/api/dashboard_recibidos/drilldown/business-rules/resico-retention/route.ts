import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { listResicoRetentionRuleViolations } from '@/lib/provider-business-rules'
import { prisma } from '@/lib/prisma'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { DashboardRecibidosDrilldownQuerySchema } from '@/schemas/dashboard-recibidos'

function parseDateFilter(value: string | null, bound: 'start' | 'end') {
  if (!value) return null

  const normalized = bound === 'start'
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(`${value}T23:59:59.999Z`)

  return Number.isNaN(normalized.getTime()) ? null : normalized
}

function canAccessReceptionBusinessRules(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!access.customRole) {
    return true
  }

  if (access.customRole.canViewReception === false) {
    return false
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionBusinessRules !== false
}

function canAccessReceptionBusinessRuleResicoRetention(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!canAccessReceptionBusinessRules(access)) {
    return false
  }

  if (!access.customRole) {
    return true
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionBusinessRuleResicoRetention !== false
}

export async function GET(request: NextRequest) {
  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'drilldownAgg', requireCompanyId: true })
    const { ctx, sessionUserId } = scoped
    const companyId = ctx.companyId!

    const rawQuery = Object.fromEntries(scoped.searchParams.entries())
    const parsed = DashboardRecibidosDrilldownQuerySchema.safeParse({ ...rawQuery, companyId })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parámetros inválidos', issues: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const q = parsed.data
    const startDate = parseDateFilter(q.startDate, 'start')
    const endDate = parseDateFilter(q.endDate, 'end')

    const member = (await prisma.member.findFirst({
      where: { userId: sessionUserId, status: 'APPROVED', organizationId: ctx.organizationId }
    }))!

    const access = (await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: ctx.memberId, companyId } },
      include: {
        customRole: {
          select: {
            canViewReception: true,
            granularPermissions: true
          }
        }
      }
    }))!

    if (!canAccessReceptionBusinessRuleResicoRetention(access)) {
      return NextResponse.json({ error: 'Sin permiso para esta regla de coherencia de datos' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, rfc: true, businessName: true }
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const rows = await listResicoRetentionRuleViolations({
      organizationId: member.organizationId,
      companyId,
      startDate,
      endDate
    })

    return NextResponse.json({
      company: {
        id: company.id,
        rfc: company.rfc,
        name: company.businessName
      },
      data: rows.map(row => ({
        uuid: row.uuid,
        fileName: row.file_name,
        issuerRfc: row.issuer_rfc,
        issuerName: row.issuer_name || row.issuer_rfc,
        receiverRfc: row.receiver_rfc,
        cfdiType: row.cfdi_type,
        series: row.series || '',
        folio: row.folio || '',
        issuanceDate: row.issuance_date ? new Date(row.issuance_date).toISOString() : null,
        issuerFiscalRegime: row.issuer_fiscal_regime || '',
        hasResicoIsrRetention: Boolean(row.has_resico_isr_retention),
        total: Number(row.total || 0)
      }))
    })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

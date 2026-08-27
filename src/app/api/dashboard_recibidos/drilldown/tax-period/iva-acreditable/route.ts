import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { listIvaAccreditableDrilldown } from '@/lib/provider-tax-period-summary'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { DashboardRecibidosDrilldownQuerySchema } from '@/schemas/dashboard-recibidos'

function parseDateFilter(value: string | null, bound: 'start' | 'end') {
  if (!value) return null

  const normalized = bound === 'start'
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(`${value}T23:59:59.999Z`)

  return Number.isNaN(normalized.getTime()) ? null : normalized
}

function canAccessReception(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!access.customRole) {
    return true
  }

  return access.customRole.canViewReception !== false
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

    if (!canAccessReception(access)) {
      return NextResponse.json({ error: 'Sin permiso para consultar CFDI recibidos' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, rfc: true, businessName: true }
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const rows = await listIvaAccreditableDrilldown({
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
      data: rows
    })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

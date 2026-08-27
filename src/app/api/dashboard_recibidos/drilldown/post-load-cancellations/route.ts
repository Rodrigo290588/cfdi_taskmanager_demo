import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { listPostLoadCancellationAlerts } from '@/lib/provider-post-load-cancellation-alerts'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { z } from 'zod'
import { CompanyIdSchema } from '@/schemas/dashboard-recibidos'

function canAccessReceptionFiscalAudit(access: {
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
  return granularPermissions.receptionFiscalAudit !== false
}

function canAccessReceptionCancellationAlerts(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!canAccessReceptionFiscalAudit(access)) {
    return false
  }

  if (!access.customRole) {
    return true
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionCancellationAlerts !== false
}

export async function GET(request: NextRequest) {
  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'drilldownAgg', requireCompanyId: true })
    const { ctx, sessionUserId } = scoped
    const companyId = ctx.companyId!

    const rawQuery = Object.fromEntries(scoped.searchParams.entries())
    const parsed = z.strictObject({ companyId: CompanyIdSchema }).safeParse({ ...rawQuery, companyId })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parámetros inválidos', issues: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

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

    if (!canAccessReceptionCancellationAlerts(access)) {
      return NextResponse.json({ error: 'Sin permiso para alertas de cancelación post-carga' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, rfc: true, businessName: true }
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const rows = await listPostLoadCancellationAlerts({
      organizationId: member.organizationId,
      companyId
    })

    return NextResponse.json({
      company: {
        id: company.id,
        rfc: company.rfc,
        name: company.businessName
      },
      data: rows.map(row => ({
        detectedAt: row.detected_at ? new Date(row.detected_at).toISOString() : null,
        uuid: row.uuid,
        fileName: row.file_name,
        issuerRfc: row.issuer_rfc,
        issuerName: row.issuer_name || row.issuer_rfc,
        cfdiType: row.cfdi_type,
        series: row.series || '',
        folio: row.folio || '',
        issuanceDate: row.issuance_date ? new Date(row.issuance_date).toISOString() : null,
        total: Number(row.total || 0),
        satInitialEstado: row.sat_initial_estado || 'SIN_ESTATUS',
        satEstado: row.sat_estado || 'SIN_ESTATUS',
        satEstatusCancelacion: row.sat_estatus_cancelacion || '',
        satEsCancelable: row.sat_es_cancelable || ''
      }))
    })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}

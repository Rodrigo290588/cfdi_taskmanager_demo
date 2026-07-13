import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listPostLoadCancellationAlerts } from '@/lib/provider-post-load-cancellation-alerts'

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
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')

    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' }
    })

    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } },
      include: {
        customRole: {
          select: {
            canViewReception: true,
            granularPermissions: true
          }
        }
      }
    })

    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403 })
    }

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
    console.error('Dashboard recibidos post-load cancellations drilldown API error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

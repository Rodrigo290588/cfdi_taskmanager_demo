import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listEfosRiskInvoices } from '@/lib/sat-69b-blacklist'

function parseDateFilter(value: string | null, bound: 'start' | 'end') {
  if (!value) return null

  const normalized = bound === 'start'
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(`${value}T23:59:59.999Z`)

  return Number.isNaN(normalized.getTime()) ? null : normalized
}

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

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const startDate = parseDateFilter(searchParams.get('startDate'), 'start')
    const endDate = parseDateFilter(searchParams.get('endDate'), 'end')

    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    if (searchParams.get('startDate') && !startDate) {
      return NextResponse.json({ error: 'startDate inválida' }, { status: 400 })
    }

    if (searchParams.get('endDate') && !endDate) {
      return NextResponse.json({ error: 'endDate inválida' }, { status: 400 })
    }

    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json({ error: 'La fecha inicial no puede ser mayor a la fecha final' }, { status: 400 })
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

    if (!canAccessReceptionFiscalAudit(access)) {
      return NextResponse.json({ error: 'Sin permiso para auditoría fiscal en CFDI recibidos' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, rfc: true, businessName: true }
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const rows = await listEfosRiskInvoices({
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
        cfdiType: row.cfdi_type,
        series: row.series || '',
        folio: row.folio || '',
        issuanceDate: row.issuance_date ? new Date(row.issuance_date).toISOString() : null,
        total: Number(row.total || 0),
        satEstado: row.sat_estado || 'SIN_ESTATUS',
        efosStatusLabel: row.status_label,
        efosStatusBucket: row.status_bucket
      }))
    })
  } catch (error) {
    console.error('Dashboard recibidos EFOS drilldown API error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma, MemberRole, SystemRole } from '@prisma/client'
import { SECURITY_HEADERS } from '@/lib/mass-downloads-route-utils'
import { hasPermission, Permission } from '@/lib/permissions'

const _MEMBER_ROLE_ORDER: Record<MemberRole, number> = { VIEWER: 0, AUDITOR: 1, ADMIN: 2 } as const

function _rank(role?: MemberRole | null): number { return role ? _MEMBER_ROLE_ORDER[role] ?? 0 : 0 }

function _isViewerTier(role: MemberRole | null, systemRole: SystemRole | null): boolean {
  if (systemRole === SystemRole.SUPER_ADMIN || systemRole === SystemRole.ADMIN) return false
  return _rank(role) <= _rank(MemberRole.VIEWER)
}

function mergeSecureHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...SECURITY_HEADERS, ...(extra || {}) }
}

/** INV-009 FIXED: mask nomina salarial for VIEWER tier.
 *  subtotal/total/iva/isr/ieps/concepto unitario = null (no muestra rango salarial)
 */
function maskSensitiveIfViewer<T extends object>(row: T, viewerMode: boolean): T {
  if (!viewerMode) return row
  const MASK_KEYS_NULLIFY = new Set([
    'subtotal', 'total', 'discount',
    'ivaTransferred', 'ivaWithheld', 'isrWithheld', 'iepsWithheld',
    'unitValue', 'amount', 'unitQuantity', 'exchangeRate'
  ])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (MASK_KEYS_NULLIFY.has(k)) out[k] = null
    else out[k] = v
  }
  return out as T
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: mergeSecureHeaders() })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const page = Number(searchParams.get('page') || 1)
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100)
    const query = searchParams.get('query') || ''
    const cfdiTypeRaw = searchParams.get('cfdiType')
    const status = searchParams.get('status') as keyof typeof InvoiceStatus | null
    const satStatus = searchParams.get('satStatus') as keyof typeof SatStatus | null
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400, headers: mergeSecureHeaders() })
    }

    // INV-009 FIXED: cfdiType es CAMPO OBLIGATORIO. NO hay default NOMINA (antes L69).
    if (!cfdiTypeRaw) {
      return NextResponse.json(
        { error: 'cfdiType es requerido (no hay default). Valores permitidos: ' + Object.keys(CfdiType).join(', ') },
        { status: 400, headers: mergeSecureHeaders() }
      )
    }
    const cfdiType = cfdiTypeRaw as keyof typeof CfdiType
    if (!CfdiType[cfdiType]) {
      return NextResponse.json({ error: 'cfdiType inválido' }, { status: 400, headers: mergeSecureHeaders() })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      select: { id: true, organizationId: true, role: true }
    })
    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404, headers: mergeSecureHeaders() })
    }
    const userContext = {
      id: session.user.id,
      systemRole: (session.user.systemRole || 'USER') as SystemRole,
      memberships: [{ organizationId: member.organizationId, role: member.role as MemberRole }]
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } }
    })
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403, headers: mergeSecureHeaders() })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: mergeSecureHeaders() })
    }

    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc: company.rfc, isActive: true } })
    if (!fiscalEntity) {
      return NextResponse.json(
        { invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } },
        { status: 200, headers: mergeSecureHeaders() }
      )
    }

    // INV-009 FIXED: Gate permiso NOMINA_VIEW_SALARIES para cualquier consulta CfdiType.NOMINA
    const isNominaQuery = CfdiType[cfdiType] === CfdiType.NOMINA
    const canViewSalaries = hasPermission(userContext, Permission.NOMINA_VIEW_SALARIES, member.organizationId)
    if (isNominaQuery && !canViewSalaries) {
      return NextResponse.json(
        { error: 'Permiso NOMINA_VIEW_SALARIES requerido para ver recibos de nómina salariales.' },
        { status: 403, headers: mergeSecureHeaders() }
      )
    }
    // viewer tier mask even if hasPermission (defense in depth: OWNER/ADMIN only see full)
    const viewerMaskMode = _isViewerTier(member.role, (session.user.systemRole || null) as unknown as SystemRole) && isNominaQuery

    const where: Prisma.InvoiceWhereInput = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: company.rfc }
    if (query) {
      where.OR = [
        { uuid: { contains: query, mode: 'insensitive' } },
        { issuerRfc: { contains: query, mode: 'insensitive' } },
        { issuerName: { contains: query, mode: 'insensitive' } },
        { receiverRfc: { contains: query, mode: 'insensitive' } },
        { receiverName: { contains: query, mode: 'insensitive' } },
        { folio: { contains: query, mode: 'insensitive' } },
      ]
    }
    where.cfdiType = CfdiType[cfdiType] // INV-009: SIN default, solo el explícitamente enviado por cliente
    if (status && InvoiceStatus[status]) where.status = InvoiceStatus[status]
    if (satStatus && SatStatus[satStatus]) where.satStatus = SatStatus[satStatus]
    if (dateFrom || dateTo) {
      where.issuanceDate = {}
      if (dateFrom) where.issuanceDate.gte = new Date(dateFrom)
      if (dateTo) where.issuanceDate.lte = new Date(dateTo)
    }

    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { issuanceDate: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          uuid: true,
          cfdiType: true,
          series: true,
          folio: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          subtotal: true,
          total: true,
          issuanceDate: true,
          status: true,
          satStatus: true,
          paymentForm: true,
          paymentMethod: true,
          currency: true,
        }
      }),
      prisma.invoice.count({ where })
    ])

    const invoices = rows.map(r => maskSensitiveIfViewer({
      ...r,
      subtotal: Number(r.subtotal),
      total: Number(r.total),
      issuanceDate: r.issuanceDate,
    }, viewerMaskMode))

    // INV-008 FIXED: SECURITY_HEADERS merge ON 200 responses (antes solo errores los tenían)
    return NextResponse.json({
      invoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }, { status: 200, headers: mergeSecureHeaders() })
  } catch (error) {
    console.error('Error fetching payroll invoices:', error instanceof Error ? { name: error.name, msg: error.message?.slice(0, 200) } : 'unknown')
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500, headers: mergeSecureHeaders() })
  }
}

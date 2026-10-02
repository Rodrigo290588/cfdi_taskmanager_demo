import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma, MemberRole, SystemRole } from '@prisma/client'
import { SECURITY_HEADERS } from '@/lib/mass-downloads-route-utils'
import { hasPermission, Permission } from '@/lib/permissions'

function mergeSecureHeaders(extra?: Record<string, string>): Record<string, string> {
  return extra ? { ...SECURITY_HEADERS, ...extra } : SECURITY_HEADERS
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

async function getValidatedSessionAndAccess(companyId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { errorResponse: NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: mergeSecureHeaders() }) }
  }

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id, status: 'APPROVED' },
    select: { id: true, organizationId: true, role: true }
  })
  if (!member) {
    return { errorResponse: NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404, headers: mergeSecureHeaders() }) }
  }

  const access = await prisma.companyAccess.findUnique({
    where: { memberId_companyId: { memberId: member.id, companyId } }
  })
  if (!access) {
    return { errorResponse: NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403, headers: mergeSecureHeaders() }) }
  }

  const userContext = {
    id: session.user.id,
    systemRole: (session.user.systemRole || 'USER') as SystemRole,
    memberships: [{ organizationId: member.organizationId, role: member.role as MemberRole }]
  }

  return { userContext, member }
}

async function getFiscalEntityData(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { rfc: true }
  })
  if (!company?.rfc) {
    return { errorResponse: NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: mergeSecureHeaders() }) }
  }

  const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc: company.rfc, isActive: true } })
  return { company, fiscalEntity }
}

function buildWhereClause(
  searchParams: URLSearchParams,
  companyRfc: string,
  fiscalEntityId: string,
  cfdiTypeKey: keyof typeof CfdiType
) {
  const where: Prisma.InvoiceWhereInput = { issuerFiscalEntityId: fiscalEntityId, issuerRfc: companyRfc }
  const query = searchParams.get('query') || ''
  const status = searchParams.get('status') as keyof typeof InvoiceStatus | null
  const satStatus = searchParams.get('satStatus') as keyof typeof SatStatus | null
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')

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
  
  where.cfdiType = CfdiType[cfdiTypeKey]
  if (status && InvoiceStatus[status]) where.status = InvoiceStatus[status]
  if (satStatus && SatStatus[satStatus]) where.satStatus = SatStatus[satStatus]
  
  if (dateFrom || dateTo) {
    const dateFilter: Prisma.DateTimeFilter = {}
    if (dateFrom) dateFilter.gte = new Date(dateFrom)
    if (dateTo) dateFilter.lte = new Date(dateTo)
    where.issuanceDate = dateFilter
  }

  return where
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const page = Number(searchParams.get('page') || 1)
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100)
    const cfdiTypeRaw = searchParams.get('cfdiType')

    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400, headers: mergeSecureHeaders() })
    }

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

    const accessData = await getValidatedSessionAndAccess(companyId)
    if (accessData.errorResponse) return accessData.errorResponse
    const { userContext, member } = accessData

    const entityData = await getFiscalEntityData(companyId)
    if (entityData.errorResponse) return entityData.errorResponse
    const { company, fiscalEntity } = entityData

    if (!fiscalEntity) {
      return NextResponse.json(
        { invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } },
        { status: 200, headers: mergeSecureHeaders() }
      )
    }

    const isNominaQuery = CfdiType[cfdiType] === CfdiType.NOMINA
    const canViewSalaries = hasPermission(userContext, Permission.NOMINA_VIEW_SALARIES, member.organizationId)
    const viewerMaskMode = isNominaQuery && !canViewSalaries

    const where = buildWhereClause(searchParams, company.rfc, fiscalEntity.id, cfdiType)
    const skip = (page - 1) * limit

    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { issuanceDate: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, uuid: true, cfdiType: true, series: true, folio: true,
          issuerRfc: true, issuerName: true, receiverRfc: true, receiverName: true,
          subtotal: true, total: true, issuanceDate: true, status: true,
          satStatus: true, paymentForm: true, paymentMethod: true, currency: true,
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

    return NextResponse.json({
      invoices,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    }, { status: 200, headers: mergeSecureHeaders() })
  } catch (error) {
    console.error('Error fetching payroll invoices:', error instanceof Error ? { name: error.name, msg: error.message?.slice(0, 200) } : 'unknown')
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500, headers: mergeSecureHeaders() })
  }
}

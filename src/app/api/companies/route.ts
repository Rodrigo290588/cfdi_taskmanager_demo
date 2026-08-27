import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { enforceCompaniesRateLimit, RateLimitError } from '@/lib/rate-limit'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

// [HARDENING P0 - Fix #5] Leer ?organizationId= y validar scope.
// - Si no es SUPER_ADMIN/ADMIN y pide OrgId ajeno → 403 (no ignorar silenciosamente)
// - Si es SUPER_ADMIN/ADMIN → aplicar filtro where por OrgId param
// - reqId en todas las respuestas para trazabilidad
export async function GET(request: NextRequest) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()

    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { 'X-Request-Id': reqId } }
      )
    }

    // COMPANIES-014 · Rate limit anti-abuso
    try {
      enforceCompaniesRateLimit(session.user.id, 'search')
    } catch (rlErr) {
      if (rlErr instanceof RateLimitError) {
        return NextResponse.json(
          { error: rlErr.message, reqId },
          { status: rlErr.statusCode, headers: { 'Retry-After': String(Math.ceil(rlErr.retryAfterMs / 1000)), 'X-Request-Id': reqId } }
        )
      }
      throw rlErr
    }

    // Get user to check role + memberships
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          include: { organization: true }
        }
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado', reqId },
        { status: 404, headers: { 'X-Request-Id': reqId } }
      )
    }

    // [HARDENING P0 Fix #5] Leer query param organizationId (NO ignorar)
    // El modelo Company NO tiene campo organizationId; la relación es vía createdBy(userId) → Member → Organization.
    const orgIdParam = request.nextUrl.searchParams.get('organizationId')
    const isSuperOrSystemAdmin = user.systemRole === 'SUPER_ADMIN' || user.systemRole === 'ADMIN'

    // Construir lista de Orgs autorizadas del usuario (HARD CONSTRAINT: organization.onboardingCompleted === true
    // es el equivalente de "org activa" establecido en schema Prisma; isActive no existe)
    const authorizedOrgIds = user.memberships
      .filter(m => m.status === 'APPROVED' && m.organization?.onboardingCompleted === true)
      .map(m => m.organizationId)

    // COMP-001 FIX CRÍTICO BOLA Cross-Organization:
    // TODOS los roles se validan contra allowlist authorizedOrgIds (NO bypass SUPER_ADMIN hacia org ajeno)
    if (orgIdParam) {
      if (!authorizedOrgIds.includes(orgIdParam)) {
        return NextResponse.json(
          { error: 'Permiso insuficiente para consultar esta organización', reqId },
          { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
        )
      }
      const orgExists = await prisma.organization.findFirst({
        where: { id: orgIdParam, onboardingCompleted: true },
        select: { id: true }
      })
      if (!orgExists) {
        return NextResponse.json(
          { error: 'Organización no encontrada', reqId },
          { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
        )
      }
    }

    // Determinar orgs scoped (por param o todas las autorizadas)
    const scopedOrgIds: string[] = []
    if (orgIdParam) scopedOrgIds.push(orgIdParam)
    else if (authorizedOrgIds.length > 0) scopedOrgIds.push(...authorizedOrgIds)

    // UserIds autorizados: miembros APPROVED de las orgs scoped
    const scopedUserIds: string[] = []
    if (scopedOrgIds.length > 0) {
      const scopedMembers = await prisma.member.findMany({
        where: { organizationId: { in: scopedOrgIds }, status: 'APPROVED' },
        select: { userId: true }
      })
      for (const sm of scopedMembers) scopedUserIds.push(sm.userId)
    }

    let companiesResult: Awaited<ReturnType<typeof prisma.company.findMany>> = []

    if (isSuperOrSystemAdmin) {
      // COMPANIES-002 · Fix cross-tenant leak:
      // Si SUPER_ADMIN no envía ?organizationId= y no tiene memberships → 0 resultados (no leak empresas cross-tenant globales)
      // Nunca usar where:undefined
      const forcedWhere: { createdBy?: { in: string[] } } = scopedUserIds.length > 0
        ? { createdBy: { in: scopedUserIds } }
        : { createdBy: { in: [] } }
      companiesResult = await prisma.company.findMany({
        where: forcedWhere,
        orderBy: { createdAt: 'desc' }
      })
    } else {
      if (scopedOrgIds.length === 0) {
        companiesResult = []
      } else {
        // ¿El usuario es OWNER o ADMIN (rol membresía) en alguna de las orgs scoped?
        const elevatedOrgIds: string[] = []
        const normalMemberIds: string[] = []
        for (const um of user.memberships) {
          if (um.status !== 'APPROVED' || !scopedOrgIds.includes(um.organizationId)) continue
          const isOwnerOrg = um.organization?.ownerId === user.id
          const isAdminRole = um.role === 'ADMIN'
          if (isOwnerOrg || isAdminRole) {
            elevatedOrgIds.push(um.organizationId)
          } else {
            normalMemberIds.push(um.id)
          }
        }

        // Owner/Admin: empresas creadas por cualquier miembro del org (scoped)
        if (elevatedOrgIds.length > 0) {
          const elevatedMembers = await prisma.member.findMany({
            where: { organizationId: { in: elevatedOrgIds }, status: 'APPROVED' },
            select: { userId: true }
          })
          const elevatedUserIds = Array.from(new Set(elevatedMembers.map(m => m.userId)))
          const elevatedCompanies = await prisma.company.findMany({
            where: { createdBy: { in: elevatedUserIds } },
            orderBy: { createdAt: 'desc' }
          })
          companiesResult = [...companiesResult, ...elevatedCompanies]
        }

        // Normal (no owner, no admin): empresas compartidas por CompanyAccess
        if (normalMemberIds.length > 0) {
          const accesses = await prisma.companyAccess.findMany({
            where: { memberId: { in: normalMemberIds } },
            select: { companyId: true }
          })
          const companyIds = Array.from(new Set(accesses.map(a => a.companyId)))
          if (companyIds.length > 0) {
            const accessCompanies = await prisma.company.findMany({
              where: { id: { in: companyIds } },
              orderBy: { createdAt: 'desc' }
            })
            const existingIds = new Set(companiesResult.map(c => c.id))
            for (const c of accessCompanies) {
              if (!existingIds.has(c.id)) companiesResult.push(c)
            }
          }
        }
      }
    }

    return NextResponse.json(
      {
        reqId,
        companies: companiesResult.map(company => ({
          id: company.id,
          name: company.name,
          rfc: company.rfc,
          businessName: company.businessName,
          status: company.status,
          createdAt: company.createdAt,
          approvedAt: company.approvedAt,
          approvedBy: company.approvedBy,
          rejectionReason: company.rejectionReason
        }))
      },
      { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[companies GET]', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}

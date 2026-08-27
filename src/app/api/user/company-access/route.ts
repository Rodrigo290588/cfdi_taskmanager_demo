import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getUserApprovedOrganizationIds } from '@/lib/tenant'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { enforceUserRateLimit, RateLimitError } from '@/lib/rate-limit'
import { SystemRole, MemberRole } from '@prisma/client'

const GENERIC_NOT_FOUND_BODY = { hasAccess: false, companies: [] as never[] } as const

const __ROLE_RANK: Record<MemberRole, number> = {
  ADMIN: 4,
  AUDITOR: 2,
  VIEWER: 1,
} as const

function applyUserSecurityHeaders(
  res: NextResponse,
  cachePrivate = true,
): NextResponse {
  for (const [k, v] of Object.entries(SAT_SECURITY_HEADERS)) {
    res.headers.set(k, v)
  }
  if (cachePrivate) {
    res.headers.set('Cache-Control', 'no-store, private, max-age=0, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
  }
  return res
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      const r = NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      return applyUserSecurityHeaders(r)
    }
    const _systemRole: SystemRole =
      ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    void _systemRole

    enforceUserRateLimit(session.user.id, 'companyAccess')

    const { searchParams } = new URL(request.url)
    const orgIdRaw = searchParams.get('orgId') || undefined
    const allowedOrgIds = await getUserApprovedOrganizationIds(session.user.id, { take: 200 })

    let orgId: string | undefined
    if (orgIdRaw) {
      if (!allowedOrgIds.includes(orgIdRaw)) {
        const r = NextResponse.json(GENERIC_NOT_FOUND_BODY, { status: 200 })
        return applyUserSecurityHeaders(r)
      }
      orgId = orgIdRaw
    }

    const baseWhere = {
      userId: session.user.id,
      status: 'APPROVED' as const,
      organizationId: { in: allowedOrgIds.length > 0 ? allowedOrgIds : ['__none__'] },
    }

    const allMemberships = await prisma.member.findMany({
      where: {
        ...baseWhere,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    })

    if (allMemberships.length === 0) {
      const r = NextResponse.json(GENERIC_NOT_FOUND_BODY, { status: 200 })
      return applyUserSecurityHeaders(r)
    }

    const membership = [...allMemberships].sort((a, b) => {
      const ra = __ROLE_RANK[(a.role as MemberRole) || 'VIEWER'] || 0
      const rb = __ROLE_RANK[(b.role as MemberRole) || 'VIEWER'] || 0
      if (rb !== ra) return rb - ra
      if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })[0]

    if (!membership) {
      const r = NextResponse.json(GENERIC_NOT_FOUND_BODY, { status: 200 })
      return applyUserSecurityHeaders(r)
    }

    const accessRows = await prisma.companyAccess.findMany({
      where: { memberId: membership.id },
      take: 500,
      include: {
        company: {
          select: {
            id: true,
            rfc: true,
            businessName: true,
            status: true,
            name: true,
          },
        },
        customRole: {
          select: {
            name: true,
            canViewEmission: true,
            canViewReception: true,
            canViewPayroll: true,
            canViewSatPortal: true,
            canViewMassDownloads: true,
            canManageOrg: true,
            granularPermissions: true,
          },
        },
      },
    })

    const companies = accessRows
      .filter((row) => Boolean(row.company))
      .map((row) => ({
        id: row.company!.id,
        rfc: row.company!.rfc,
        businessName: row.company!.businessName || row.company!.name,
        isActive: row.company!.status === 'APPROVED',
        role: row.customRole ? row.customRole.name : row.role,
        isCustomRole: !!row.customRole,
        moduleFlags: row.customRole
          ? {
              canViewEmission: row.customRole.canViewEmission,
              canViewReception: row.customRole.canViewReception,
              canViewPayroll: row.customRole.canViewPayroll,
              canViewSatPortal: row.customRole.canViewSatPortal,
              canViewMassDownloads: row.customRole.canViewMassDownloads,
              canManageOrg: row.customRole.canManageOrg,
              granularPermissions: (row.customRole.granularPermissions as Record<string, boolean> | undefined) ||
                ({} as Record<string, boolean>),
            }
          : null,
      }))

    const r = NextResponse.json({
      hasAccess: companies.length > 0,
      companies,
    })
    return applyUserSecurityHeaders(r)
  } catch (error) {
    const safe = safeErrSummarySat(error)
    if (error instanceof RateLimitError) {
      const r = NextResponse.json({ error: (error as RateLimitError).message }, { status: 429 })
      r.headers.set('Retry-After', String(Math.ceil((error as RateLimitError).retryAfterMs / 1000)))
      return applyUserSecurityHeaders(r, false)
    }
    const r = NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500 },
    )
    return applyUserSecurityHeaders(r)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getSystemRoleOverrideForOrg,
  isSystemRoleId,
} from '@/lib/admin-roles'
import { getUserApprovedOrganizationIds } from '@/lib/tenant'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { enforceUserRateLimit, RateLimitError } from '@/lib/rate-limit'
import { SystemRole, MemberRole } from '@prisma/client'

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

    enforceUserRateLimit(session.user.id, 'member')

    const orgIdRaw = request.nextUrl.searchParams.get('orgId') ?? undefined
    const allowedOrgIds = await getUserApprovedOrganizationIds(session.user.id, { take: 200 })

    let orgId: string | undefined
    if (orgIdRaw) {
      if (!allowedOrgIds.includes(orgIdRaw)) {
        const r = NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
        return applyUserSecurityHeaders(r)
      }
      orgId = orgIdRaw
    }
    if (allowedOrgIds.length === 0) {
      const r = NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
      return applyUserSecurityHeaders(r)
    }

    const rows = await prisma.member.findMany({
      where: {
        userId: session.user.id,
        status: 'APPROVED',
        organizationId: { in: allowedOrgIds },
        ...(orgId ? { organizationId: orgId } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      include: { customRole: true },
    })

    if (rows.length === 0) {
      const r = NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
      return applyUserSecurityHeaders(r)
    }

    const member = [...rows].sort((a, b) => {
      const ra = __ROLE_RANK[(a.role as MemberRole) || 'VIEWER'] || 0
      const rb = __ROLE_RANK[(b.role as MemberRole) || 'VIEWER'] || 0
      if (rb !== ra) return rb - ra
      if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })[0]

    if (!member) {
      const r = NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
      return applyUserSecurityHeaders(r)
    }

    const roleKey = member.role
    const useOverrideForSystemRole = !member.customRoleId && isSystemRoleId(roleKey)

    let canViewEmission: boolean
    let canViewReception: boolean
    let canViewPayroll: boolean
    let canViewSatPortal: boolean
    let canViewMassDownloads: boolean
    let canManageOrg: boolean
    let granularPerms: Record<string, boolean>

    if (useOverrideForSystemRole) {
      const override = await getSystemRoleOverrideForOrg(member.organizationId, roleKey)
      canViewEmission = override.canViewEmission
      canViewReception = override.canViewReception
      canViewPayroll = override.canViewPayroll
      canViewSatPortal = override.canViewSatPortal
      canViewMassDownloads = override.canViewMassDownloads
      canManageOrg = override.canManageOrg
      granularPerms = (override.granularPermissions as Record<string, boolean> | undefined) || {}
    } else {
      canViewEmission = member.customRole ? member.customRole.canViewEmission : member.canViewEmission
      canViewReception = member.customRole ? member.customRole.canViewReception : member.canViewReception
      canViewPayroll = member.customRole ? member.customRole.canViewPayroll : member.canViewPayroll
      canViewSatPortal = member.customRole ? member.customRole.canViewSatPortal : member.canViewSatPortal
      canViewMassDownloads = member.customRole ? member.customRole.canViewMassDownloads : member.canViewMassDownloads
      canManageOrg = member.customRole ? member.customRole.canManageOrg : member.canManageOrg
      granularPerms = member.customRole
        ? (member.customRole.granularPermissions as Record<string, boolean> | undefined) || {}
        : (member.granularPermissions as Record<string, boolean> | undefined) || {}
    }

    const r = NextResponse.json({
      success: true,
      member: {
        id: member.id,
        organizationId: member.organizationId,
        canViewEmission,
        canViewReception,
        canViewPayroll,
        canViewSatPortal,
        canViewMassDownloads,
        canManageOrg,
        granularPermissions: granularPerms,
      },
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

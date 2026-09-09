import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getUserApprovedOrganizationIds } from '@/lib/tenant'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { enforceUserRateLimit, RateLimitError } from '@/lib/rate-limit'
import { MemberRole } from '@prisma/client'

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

type CtxSession = { userId: string; orgId: string | undefined; allowedOrgIds: string[] }

async function resolveSessionAndOrg(request: NextRequest): Promise<
  | { ok: true; ctx: CtxSession }
  | { ok: false; response: NextResponse }
> {
  const session = await auth()
  if (!session?.user?.id) {
    const r = NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    return { ok: false, response: applyUserSecurityHeaders(r) }
  }

  enforceUserRateLimit(session.user.id, 'companyAccess')

  const { searchParams } = new URL(request.url)
  const orgIdRaw = searchParams.get('orgId') || undefined
  const allowedOrgIds = await getUserApprovedOrganizationIds(session.user.id, { take: 200 })

  if (orgIdRaw && !allowedOrgIds.includes(orgIdRaw)) {
    const r = NextResponse.json(GENERIC_NOT_FOUND_BODY, { status: 200 })
    return { ok: false, response: applyUserSecurityHeaders(r) }
  }

  return { ok: true, ctx: { userId: session.user.id, orgId: orgIdRaw, allowedOrgIds } }
}

function compareMembershipByRankThenAgeThenId(
  a: { role: MemberRole | null; createdAt: Date; id: string },
  b: { role: MemberRole | null; createdAt: Date; id: string },
): number {
  const ra = __ROLE_RANK[(a.role as MemberRole) || 'VIEWER'] || 0
  const rb = __ROLE_RANK[(b.role as MemberRole) || 'VIEWER'] || 0
  if (rb !== ra) return rb - ra
  const ta = a.createdAt.getTime()
  const tb = b.createdAt.getTime()
  if (ta !== tb) return ta - tb
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

type FECandidate = {
  id: string
  rfc: string
  businessName: string
  isActive: boolean
  role: string
  isCustomRole: boolean
  moduleFlags: {
    canViewEmission: boolean
    canViewReception: boolean
    canViewPayroll: boolean
    canViewSatPortal: boolean
    canViewMassDownloads: boolean
    canManageOrg?: boolean
    granularPermissions: Record<string, boolean>
  } | null
}

async function buildCandidateCompanies(
  ctx: CtxSession & { baseWhere: { userId: string; status: 'APPROVED'; organizationId: { in: string[] } } },
  orgId: string | undefined,
): Promise<{ companies: FECandidate[]; emptyResponse?: NextResponse }> {
  const allMemberships = await prisma.member.findMany({
    where: { ...ctx.baseWhere, ...(orgId ? { organizationId: orgId } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
  })

  if (allMemberships.length === 0) {
    const r = NextResponse.json(GENERIC_NOT_FOUND_BODY, { status: 200 })
    return { companies: [], emptyResponse: applyUserSecurityHeaders(r) }
  }

  const allMemberIds = allMemberships.map(m => m.id)
  const membershipDominante = [...allMemberships].sort(compareMembershipByRankThenAgeThenId)[0]

  if (!membershipDominante) {
    const r = NextResponse.json(GENERIC_NOT_FOUND_BODY, { status: 200 })
    return { companies: [], emptyResponse: applyUserSecurityHeaders(r) }
  }

  const candidateByCompanyId = new Map<string, FECandidate>()

  const accessRows = await prisma.companyAccess.findMany({
    where: { memberId: { in: allMemberIds } },
    take: 500,
    include: {
      company: { select: { id: true, rfc: true, businessName: true, status: true, name: true } },
      member: { select: { role: true } },
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

  for (const row of accessRows) {
    if (row.company?.status !== 'APPROVED') continue
    const role = row.customRole
      ? row.customRole.name
      : ((row.member.role as MemberRole) || 'VIEWER')
    candidateByCompanyId.set(row.company.id, {
      id: row.company.id,
      rfc: row.company.rfc,
      businessName: row.company.businessName || row.company.name,
      isActive: true,
      role,
      isCustomRole: !!row.customRole,
      moduleFlags: row.customRole
        ? {
            canViewEmission: row.customRole.canViewEmission,
            canViewReception: row.customRole.canViewReception,
            canViewPayroll: row.customRole.canViewPayroll,
            canViewSatPortal: row.customRole.canViewSatPortal,
            canViewMassDownloads: row.customRole.canViewMassDownloads,
            canManageOrg: row.customRole.canManageOrg,
            granularPermissions: (row.customRole?.granularPermissions as Record<string, boolean> | undefined) ?? {},
          }
        : null,
    })
  }

  const empresasCreadasPorUsuario = await prisma.company.findMany({
    where: { createdBy: ctx.userId, status: 'APPROVED' },
    select: { id: true, rfc: true, businessName: true, name: true, status: true },
    take: 500,
  })

  for (const c of empresasCreadasPorUsuario) {
    if (candidateByCompanyId.has(c.id)) continue
    candidateByCompanyId.set(c.id, {
      id: c.id,
      rfc: c.rfc,
      businessName: c.businessName || c.name,
      isActive: true,
      role: membershipDominante.role,
      isCustomRole: false,
      moduleFlags: null,
    })
  }

  return { companies: Array.from(candidateByCompanyId.values()) }
}

export async function GET(request: NextRequest) {
  try {
    const session = await resolveSessionAndOrg(request)
    if (!session.ok) return session.response

    const { ctx } = session
    const baseWhere = {
      userId: ctx.userId,
      status: 'APPROVED' as const,
      organizationId: { in: ctx.allowedOrgIds.length > 0 ? ctx.allowedOrgIds : ['__none__'] },
    } as const

    const built = await buildCandidateCompanies({ ...ctx, baseWhere }, ctx.orgId)
    if (built.emptyResponse) return built.emptyResponse

    const r = NextResponse.json({
      hasAccess: built.companies.length > 0,
      companies: built.companies,
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

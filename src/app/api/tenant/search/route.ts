import { NextRequest, NextResponse } from 'next/server'
import type { Prisma, MemberRole } from '@prisma/client'
import { SystemRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import {
  Permission,
  enrichUserWithMemberships,
  hasAnyPermission,
} from '@/lib/permissions'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { rateLimit, RateLimitError } from '@/lib/rate-limit'
import {
  getUserApprovedOrganizationIds,
  getPrimaryApprovedMembership,
  __tenantGetIpFromNextRequest,
} from '@/lib/tenant'
import { z } from 'zod'

const searchSchema = z.object({
  query: z.string().trim().max(512).optional().default(''),
  page: z.union([z.string(), z.number()]).optional().default('1'),
  limit: z.union([z.string(), z.number()]).optional().default('10'),
  industry: z.string().trim().max(128).optional(),
  state: z.string().trim().max(128).optional(),
  companySize: z.string().trim().max(64).optional(),
})

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const RFC_RE = /^[A-Za-z&]{3,4}[0-9]{6}[A-Za-z0-9]{3}$/
const ALNUM_2PLUS_RE = /^[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\- ]{2,}$/

function stripSqlWildcards(s: string): string {
  return String(s ?? '').replace(/[%_\\]/g, '').trim()
}

function clampPage(raw: string | number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 1) return 1
  if (n > 1000) return 1000
  return Math.floor(n)
}

function clampLimit(raw: string | number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 1) return 10
  if (n > 100) return 100
  return Math.floor(n)
}

const BASE_SELECT: Prisma.OrganizationSelect = {
  id: true,
  name: true,
  slug: true,
  logo: true,
  description: true,
  city: true,
  state: true,
  country: true,
  industry: true,
  companySize: true,
  createdAt: true,
}

const ADMIN_OWNED_EXTRA_SELECT: Prisma.OrganizationSelect = {
  contactEmail: true,
  phone: true,
  ownerId: true,
}

function buildWhere(
  orgIds: string[],
  query: string,
  filters: { industry?: string; state?: string; companySize?: string }
): Prisma.OrganizationWhereInput {
  const where: Prisma.OrganizationWhereInput = {
    id: { in: orgIds },
  }

  const q = stripSqlWildcards(query).slice(0, 512)
  if (q.length > 0) {
    const isUuid = UUID_RE.test(q)
    const isRfc = RFC_RE.test(q)
    const isAlnum2Plus = ALNUM_2PLUS_RE.test(q)

    const orClauses: Prisma.OrganizationWhereInput[] = []

    if (isUuid) {
      orClauses.push({ id: q })
    }
    if (isRfc) {
      orClauses.push({ name: { startsWith: q, mode: 'insensitive' } })
      orClauses.push({ slug: { startsWith: q, mode: 'insensitive' } })
    }
    if (isAlnum2Plus) {
      orClauses.push({ name: { contains: q, mode: 'insensitive' } })
      orClauses.push({ slug: { contains: q, mode: 'insensitive' } })
      orClauses.push({ businessDescription: { contains: q, mode: 'insensitive' } })
      orClauses.push({ city: { contains: q, mode: 'insensitive' } })
      orClauses.push({ state: { contains: q, mode: 'insensitive' } })
      orClauses.push({ industry: { contains: q, mode: 'insensitive' } })
    }

    if (orClauses.length > 0) {
      where.OR = orClauses
    }
  }

  if (filters.industry) {
    const ind = stripSqlWildcards(filters.industry).slice(0, 128)
    if (ALNUM_2PLUS_RE.test(ind)) {
      where.industry = { contains: ind, mode: 'insensitive' }
    }
  }
  if (filters.state) {
    const st = stripSqlWildcards(filters.state).slice(0, 128)
    if (ALNUM_2PLUS_RE.test(st)) {
      where.state = { contains: st, mode: 'insensitive' }
    }
  }
  if (filters.companySize) {
    const cs = stripSqlWildcards(filters.companySize).slice(0, 64)
    if (ALNUM_2PLUS_RE.test(cs)) {
      where.companySize = cs
    }
  }

  return where
}

export async function GET(request: NextRequest) {
  const headers = {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
  } as Record<string, string>

  try {
    const clientIp = __tenantGetIpFromNextRequest(request)
    const rlIp = await rateLimit(`tenant:search:ip:${clientIp}`, { interval: 60_000, limit: 60, silent: true })
    if (!rlIp.success) {
      const retrySec = Math.ceil(rlIp.retryAfterMs / 1000)
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers })
    }

    const rlUser = await rateLimit(`tenant:search:user:${session.user.id}`, { interval: 60_000, limit: 120, silent: true })
    if (!rlUser.success) {
      const retrySec = Math.ceil(rlUser.retryAfterMs / 1000)
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })

    const primaryMembership = await getPrimaryApprovedMembership(session.user.id)
    const primaryOrgId = primaryMembership?.organizationId
    if (primaryOrgId) {
      const rlOrg = await rateLimit(`tenant:search:org:${primaryOrgId}`, { interval: 60_000, limit: 240, silent: true })
      if (!rlOrg.success) {
        const retrySec = Math.ceil(rlOrg.retryAfterMs / 1000)
        return NextResponse.json(
          { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
          { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
        )
      }

      if (!hasAnyPermission(enrichedUser, [Permission.TENANT_DIRECTORY_VIEW, Permission.TENANT_VIEW], primaryOrgId)) {
        return NextResponse.json({ error: 'Sin permisos para buscar tenants' }, { status: 403, headers })
      }
    } else {
      if (!hasAnyPermission(enrichedUser, [Permission.TENANT_DIRECTORY_VIEW, Permission.TENANT_VIEW])) {
        return NextResponse.json({ error: 'Sin permisos para buscar tenants' }, { status: 403, headers })
      }
    }

    const orgIds = await getUserApprovedOrganizationIds(session.user.id)
    if (orgIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          organizations: [],
          pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
        },
        { headers }
      )
    }

    const rawParams = Object.fromEntries(request.nextUrl.searchParams)
    const parsed = searchSchema.safeParse(rawParams)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Parámetros de búsqueda inválidos', details: parsed.error.issues },
        { status: 400, headers }
      )
    }

    const { query, industry, state, companySize } = parsed.data
    const page = clampPage(parsed.data.page)
    const limit = clampLimit(parsed.data.limit)
    const skip = (page - 1) * limit

    const where = buildWhere(orgIds, query, { industry, state, companySize })

    const [totalCount, organizations] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        select: BASE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ])

    const ownedOrgIds = new Set<string>()
    if (enrichedUser.memberships) {
      for (const m of enrichedUser.memberships) {
        if (m.role === ('ADMIN' as MemberRole)) {
          ownedOrgIds.add(m.organizationId)
        }
      }
    }
    const primary = primaryMembership?.organization
    if (primary && primary.ownerId === session.user.id) {
      ownedOrgIds.add(primary.id)
    }

    const extraById: Record<string, { contactEmail?: string | null; phone?: string | null; ownerId?: string | null }> = {}
    if (ownedOrgIds.size > 0) {
      const ownedIds = organizations.filter(o => ownedOrgIds.has(o.id)).map(o => o.id)
      if (ownedIds.length > 0) {
        const extras = await prisma.organization.findMany({
          where: { id: { in: ownedIds } },
          select: ADMIN_OWNED_EXTRA_SELECT,
        })
        for (const e of extras) {
          extraById[e.id] = e
        }
      }
    }

    const userOrgIds = new Set(orgIds)
    const ownerIdByOrg: Record<string, string | null> = {}
    if (primary) ownerIdByOrg[primary.id] = primary.ownerId

    const enriched = organizations.map(org => {
      const base = { ...org }
      const extras = extraById[org.id]
      if (extras) {
        Object.assign(base, extras)
      }
      const ownerId = (extras && 'ownerId' in extras ? (extras as { ownerId?: string | null }).ownerId : null) ?? ownerIdByOrg[org.id] ?? null
      return {
        ...base,
        isOwner: ownerId === session.user.id,
        isMember: userOrgIds.has(org.id),
      }
    })

    return NextResponse.json(
      {
        success: true,
        organizations: enriched,
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.max(0, Math.ceil(totalCount / limit)),
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof RateLimitError) {
      const retrySec = Math.ceil(error.retryAfterMs / 1000)
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Parámetros de búsqueda inválidos', details: error.issues },
        { status: 400, headers }
      )
    }
    const safe = safeErrSummarySat(error)
    console.error(`[TENANT-SEARCH] ${safe.name}:`, safe.message, 'fp=', safe.incidentFingerprint)
    return NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers }
    )
  }
}

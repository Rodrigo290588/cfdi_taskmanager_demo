import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { CompanyStatus } from '@prisma/client'
import { readdir, stat, realpath } from 'fs/promises'
import path from 'path'
import { enforceCompaniesRateLimit, RateLimitError } from '@/lib/rate-limit'
import { getAccessibleCompanyIds } from '@/lib/permissions'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = 1024 * 16

const WEBSITE_ALLOWED_SCHEMES = new Set(['https:', 'http:'])
function sanitizeWebsite(website: string | null): string | null {
  if (!website) return null
  try {
    const u = new URL(website)
    return WEBSITE_ALLOWED_SCHEMES.has(u.protocol) ? website : null
  } catch {
    return null
  }
}

const LOGO_DIR = (): string => {
  const base = /*turbopackIgnore: true*/ process.cwd()
  return /*turbopackIgnore: true*/ path.join(base, 'public', 'uploads', 'company-logos')
}
const LOGO_ALLOWED_EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif'])
const LOGO_FILE_PATTERN = /^[0-9a-zA-Z_-]+\-[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}\.(webp|png|jpg|jpeg|gif)$/

const searchCompaniesSchema = z.strictObject({
  query: z.string().max(255).optional().or(z.literal('')),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().or(z.literal('')),
  taxRegime: z.string().max(120).optional().or(z.literal('')),
  industry: z.string().max(200).optional().or(z.literal('')),
  state: z.string().max(120).optional().or(z.literal('')),
  dateFrom: z.string().max(40).optional().or(z.literal('')),
  dateTo: z.string().max(40).optional().or(z.literal('')),
  employeesMin: z.coerce.number().optional().or(z.literal('')),
  employeesMax: z.coerce.number().optional().or(z.literal('')),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'createdAt', 'status', 'rfc']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
})

const SAFE_ORDER_BY_KEYS = new Set(['name', 'createdAt', 'status', 'rfc'])
function buildSafeOrderBy(sortBy: string, sortOrder: 'asc' | 'desc'): { [k: string]: 'asc' | 'desc' } {
  const key = SAFE_ORDER_BY_KEYS.has(sortBy) ? sortBy : 'createdAt'
  return { [key]: sortOrder }
}

function safeZodHumanFriendly(issues: Array<z.ZodIssue>): Array<{ field: string; message: string }> {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message || 'Valor inválido'
  }))
}

// COMP-006 FIX MEDIO: Logo finder safe ext whitelist + realpath anti-symlink
async function findLatestLogosMapSafe(companyIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const dir = LOGO_DIR()
    const safeDir = await realpath(dir)
    const files = await readdir(safeDir)
    const idSet = new Set(companyIds)
    const tmp: Record<string, Array<{ f: string; t: number }>> = {}
    for (const f of files) {
      const ext = path.extname(f).toLowerCase()
      if (!LOGO_ALLOWED_EXTS.has(ext)) continue
      if (!LOGO_FILE_PATTERN.test(f)) continue
      const dashIdx = f.indexOf('-')
      if (dashIdx <= 0) continue
      const companyId = f.slice(0, dashIdx)
      if (!idSet.has(companyId)) continue
      const candidate = path.join(safeDir, f)
      const parent = await realpath(path.dirname(candidate))
      if (parent !== safeDir) continue
      try {
        const s = await stat(candidate)
        if (!s.isFile()) continue
        if (!tmp[companyId]) tmp[companyId] = []
        tmp[companyId].push({ f, t: s.mtime.getTime() })
      } catch {
        continue
      }
    }
    for (const cid of Object.keys(tmp)) {
      const arr = tmp[cid]
      arr.sort((a, b) => b.t - a.t)
      out[cid] = `/uploads/company-logos/${encodeURIComponent(arr[0].f)}`
    }
  } catch {
    // fail closed: empty
  }
  return out
}

export async function GET(request: NextRequest) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    try {
      enforceCompaniesRateLimit(session.user.id, 'search')
    } catch (rlErr) {
      if (rlErr instanceof RateLimitError) {
        return NextResponse.json(
          { error: rlErr.message, reqId },
          {
            status: rlErr.statusCode,
            headers: {
              'Retry-After': String(Math.ceil(rlErr.retryAfterMs / 1000)),
              'X-Request-Id': reqId,
              ...SAT_SECURITY_HEADERS
            }
          }
        )
      }
      throw rlErr
    }

    const searchParams = request.nextUrl.searchParams
    const params = Object.fromEntries(searchParams.entries())

    const validatedResult = searchCompaniesSchema.safeParse(params)
    if (!validatedResult.success) {
      return NextResponse.json(
        {
          error: 'Parámetros de búsqueda inválidos',
          reqId,
          details: safeZodHumanFriendly(validatedResult.error.issues)
        },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const validatedParams = validatedResult.data
    const {
      query, status, taxRegime, industry, state, dateFrom, dateTo,
      employeesMin, employeesMax, page, limit, sortBy, sortOrder
    } = validatedParams

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, systemRole: true } })
    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado', reqId },
        { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const scopedCompanyIds = await getAccessibleCompanyIds(user.id, user.systemRole)

    interface WhereClause {
      OR?: Array<{
        name?: { contains: string; mode: 'insensitive' }
        rfc?: { contains: string; mode: 'insensitive' }
        businessName?: { contains: string; mode: 'insensitive' }
        legalRepresentative?: { contains: string; mode: 'insensitive' }
        email?: { contains: string; mode: 'insensitive' }
      }>
      status?: CompanyStatus
      taxRegime?: string
      industry?: string
      state?: string
      createdAt?: { gte?: Date; lte?: Date }
      employeesCount?: { gte?: number; lte?: number }
      id?: { in: string[] }
    }

    const where: WhereClause = {}

    if (scopedCompanyIds !== null) {
      if (scopedCompanyIds.length === 0) {
        return NextResponse.json(
          {
            reqId,
            companies: [],
            pagination: { total: 0, page, limit, totalPages: 0 },
            filters: { taxRegimes: [], industries: [], states: [] }
          },
          { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } }
        )
      }
      where.id = { in: scopedCompanyIds }
    }

    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { rfc: { contains: query, mode: 'insensitive' } },
        { businessName: { contains: query, mode: 'insensitive' } },
        { legalRepresentative: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } }
      ]
    }
    if (status) where.status = status
    if (taxRegime) where.taxRegime = taxRegime
    if (industry) where.industry = industry
    if (state) where.state = state
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
    }
    if (employeesMin !== undefined && employeesMin !== '' && typeof employeesMin === 'number' && !Number.isNaN(employeesMin)) {
      where.employeesCount = { ...(where.employeesCount || {}), gte: employeesMin }
    }
    if (employeesMax !== undefined && employeesMax !== '' && typeof employeesMax === 'number' && !Number.isNaN(employeesMax)) {
      where.employeesCount = { ...(where.employeesCount || {}), lte: employeesMax }
    }

    const skip = (page - 1) * limit
    const safeOrderBy = buildSafeOrderBy(sortBy, sortOrder)

    const [companies, total] = await Promise.all([
      prisma.company.findMany({ where, skip, take: limit, orderBy: safeOrderBy }),
      prisma.company.count({ where })
    ])

    const scopedWhereForFilters = scopedCompanyIds === null
      ? undefined
      : { id: { in: scopedCompanyIds } }

    const [taxRegimesRaw, industriesRaw, statesRaw] = await Promise.all([
      prisma.company.findMany({ where: scopedWhereForFilters, select: { taxRegime: true }, distinct: ['taxRegime'] }),
      prisma.company.findMany({ where: scopedWhereForFilters, select: { industry: true }, distinct: ['industry'] }),
      prisma.company.findMany({ where: scopedWhereForFilters, select: { state: true }, distinct: ['state'] })
    ])

    const taxRegimes = taxRegimesRaw.map(r => r.taxRegime).filter(Boolean) as string[]
    const industries = industriesRaw.map(i => i.industry).filter(Boolean) as string[]
    const states = statesRaw.map(s => s.state).filter(Boolean) as string[]

    const logos = await findLatestLogosMapSafe(companies.map(c => c.id))

    return NextResponse.json(
      {
        reqId,
        companies: companies.map((c) => ({
          ...c,
          website: sanitizeWebsite(c.website),
          logo: logos[c.id] ?? null
        })),
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        filters: { taxRegimes, industries, states }
      },
      { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } }
    )
  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[companies search] 500:', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Parámetros de búsqueda inválidos', reqId, details: safeZodHumanFriendly(error.issues) },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}

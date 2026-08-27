import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { hasPermission, Permission, enrichUserWithMemberships, canUserAccessCompany } from '@/lib/permissions'
import { enforceCompaniesRateLimit, RateLimitError } from '@/lib/rate-limit'
import { readdir, stat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = 1024 * 64

const LOGO_DIR = (): string => {
  const base = /*turbopackIgnore: true*/ process.cwd()
  return /*turbopackIgnore: true*/ path.join(base, 'public', 'uploads', 'company-logos')
}
const LOGO_ALLOWED_EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif'])
const LOGO_FILE_PATTERN = /^[0-9a-zA-Z_-]+\-[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}\.(webp|png|jpg|jpeg|gif)$/

const WEBSITE_ALLOWED_SCHEMES = new Set(['https:', 'http:'])

const approveCompanySchema = z.strictObject({
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(1000).optional(),
})

const safeNullableUrlSchema = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z
    .string()
    .url('URL inválida')
    .refine((val) => {
      try {
        return WEBSITE_ALLOWED_SCHEMES.has(new URL(val).protocol)
      } catch {
        return false
      }
    }, 'Solo se permiten URLs con esquema https o http')
    .optional()
    .nullable()
    .transform((v) => (v === null ? undefined : v))
)

const optionalNullablePositiveIntSchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return undefined
    if (typeof val === 'number' && Number.isNaN(val)) return undefined
    return val
  },
  z.number().int().positive().optional().nullable().transform((v) => (v === null ? undefined : v))
)

const updateCompanySchema = z.strictObject({
  name: z.string().min(1).max(200),
  rfc: z.string().regex(/^[A-ZÑ&]{3,4}[0-9]{6}[A-V1-9]{3}$/),
  businessName: z.string().min(1).max(200),
  legalRepresentative: z.string().max(200).optional().nullable().transform((v) => (v === null ? undefined : v)),
  taxRegime: z.string().min(1).max(120),
  postalCode: z.string().regex(/^\d{5}$/),
  address: z.string().max(500).optional().nullable().transform((v) => (v === null ? undefined : v)),
  city: z.string().max(200).optional().nullable().transform((v) => (v === null ? undefined : v)),
  state: z.string().max(120).optional().nullable().transform((v) => (v === null ? undefined : v)),
  country: z.string().optional().default('México'),
  phone: z.string().max(50).optional().nullable().transform((v) => (v === null ? undefined : v)),
  email: z.string().email().max(200).optional().nullable().transform((v) => (v === null ? undefined : v)),
  website: safeNullableUrlSchema,
  industry: z.string().max(200).optional().nullable().transform((v) => (v === null ? undefined : v)),
  employeesCount: optionalNullablePositiveIntSchema,
  incorporationDate: z.string().max(100).optional().nullable().transform((v) => (v === null ? undefined : v))
})

function safeZodHumanFriendly(issues: Array<z.ZodIssue>): Array<{ field: string; message: string }> {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message || 'Valor inválido'
  }))
}

function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return ''
  const e = email.trim().toLowerCase()
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(e)) return ''
  const [local, domain] = e.split('@') as [string, string]
  const pre = local.slice(0, Math.min(3, Math.max(1, local.length)))
  const masked = local.length <= 3
    ? `${pre}****`
    : `${pre}${'*'.repeat(Math.max(3, local.length - 3))}`
  return `${masked}@${domain}`
}

type ComparableScalar = null | boolean | number | string | Date
function normalizeForComparison(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
    return String(value)
  }
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object') {
    const tag = Object.prototype.toString.call(value) as string
    if (tag === '[object Date]' && !Number.isNaN((value as Date).getTime())) {
      return (value as Date).toISOString()
    }
    try {
      return JSON.stringify(value)
    } catch {
      return tag
    }
  }
  return String(value)
}
function buildAuditDiff<T extends Record<string, unknown>>(
  oldObj: T,
  newObj: Record<string, unknown>
): { oldValues: Prisma.InputJsonValue; newValues: Prisma.InputJsonValue } {
  const oldValues: Record<string, unknown> = {}
  const actualNewValues: Record<string, unknown> = {}
  const knownKeys = new Set(Object.keys(oldObj))
  for (const k of Object.keys(newObj)) {
    if (!knownKeys.has(k)) continue
    const key = k as keyof T
    const oldVal = oldObj[key] as ComparableScalar
    const newVal = newObj[k] as ComparableScalar
    if (newVal === undefined) continue
    const oldNorm: ComparableScalar = oldVal ?? null
    const newNorm: ComparableScalar = newVal ?? null
    const oldStr = normalizeForComparison(oldNorm)
    const newStr = normalizeForComparison(newNorm)
    if (oldStr !== newStr) {
      oldValues[k] = oldNorm
      actualNewValues[k] = newNorm
    }
  }
  return {
    oldValues: oldValues as Prisma.InputJsonValue,
    newValues: actualNewValues as Prisma.InputJsonValue
  }
}

// COMP-006 FIX MEDIO Logo Finder Safe: ext whitelist + regex filename + realpath anti-symlink
async function findLatestLogoSafe(companyId: string): Promise<string | null> {
  try {
    const dir = LOGO_DIR()
    const safeDir = await realpath(dir)
    const files = await readdir(safeDir)
    const valid: Array<{ f: string; t: number }> = []
    for (const f of files) {
      if (!f.startsWith(`${companyId}-`)) continue
      const ext = path.extname(f).toLowerCase()
      if (!LOGO_ALLOWED_EXTS.has(ext)) continue
      if (!LOGO_FILE_PATTERN.test(f)) continue
      const candidate = path.join(safeDir, f)
      const parent = await realpath(path.dirname(candidate))
      if (parent !== safeDir) continue
      try {
        const s = await stat(candidate)
        if (!s.isFile()) continue
        valid.push({ f, t: s.mtime.getTime() })
      } catch {
        continue
      }
    }
    if (valid.length === 0) return null
    valid.sort((a, b) => b.t - a.t)
    return `/uploads/company-logos/${encodeURIComponent(valid[0].f)}`
  } catch {
    return null
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = crypto.randomUUID()
  try {
    const clRaw = request.headers.get('content-length')
    const cl = clRaw ? Number(clRaw) : null
    if (cl !== null && (Number.isNaN(cl) || cl > bodySizeLimit)) {
      return NextResponse.json(
        { error: 'Solicitud demasiado grande', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const session = await auth()
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    try {
      enforceCompaniesRateLimit(session.user.id, 'approve')
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

    const { id } = await params
    if (!id) return NextResponse.json(
      { error: 'ID de empresa requerido', reqId },
      { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const bodyBuf = await request.arrayBuffer()
    if (bodyBuf.byteLength > bodySizeLimit) {
      return NextResponse.json(
        { error: 'Solicitud demasiado grande', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    let body: unknown
    try {
      body = JSON.parse(new TextDecoder('utf-8').decode(bodyBuf))
    } catch {
      return NextResponse.json(
        { error: 'JSON inválido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const validationResult = approveCompanySchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', reqId, details: safeZodHumanFriendly(validationResult.error.issues) },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const { action, rejectionReason } = validationResult.data

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) return NextResponse.json(
      { error: 'Usuario no encontrado', reqId },
      { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const access = await canUserAccessCompany(user.id, user.systemRole, id)
    if (!access.allowed) {
      return NextResponse.json(
        { error: 'Permisos insuficientes para procesar esta empresa', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const requiredPermission = action === 'approve' ? Permission.COMPANY_APPROVE : Permission.COMPANY_REJECT
    const enrichedUser = await enrichUserWithMemberships({ id: user.id, systemRole: user.systemRole })
    if (!hasPermission(enrichedUser, requiredPermission, access.organizationId)) {
      return NextResponse.json(
        { error: 'No tienes permisos para procesar empresas', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'
    const now = new Date()

    const [updateCount] = await prisma.$transaction([
      prisma.company.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: newStatus,
          approvedBy: user.id,
          approvedAt: now,
          rejectionReason: action === 'reject' ? rejectionReason ?? null : null,
          updatedBy: user.id
        }
      })
    ])

    if (updateCount.count === 0) {
      const verify = await prisma.company.findUnique({ where: { id }, select: { id: true, status: true } })
      if (!verify) return NextResponse.json(
        { error: 'Empresa no encontrada', reqId },
        { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
      return NextResponse.json(
        { error: 'La empresa ya ha sido procesada', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id } })
    await prisma.auditLog.create({
      data: {
        tableName: 'companies',
        recordId: id,
        action: action === 'approve' ? 'APPROVE' : 'REJECT',
        oldValues: { status: 'PENDING' },
        newValues: {
          status: newStatus,
          approvedBy: user.id,
          approvedAt: now,
          rejectionReason: action === 'reject' ? rejectionReason ?? null : null
        },
        userId: user.id,
        userEmail: maskEmail(user.email),
        description: `Company "${updatedCompany.name}" ${action === 'approve' ? 'approved' : 'rejected'}`,
        companyId: id,
      }
    })

    return NextResponse.json({
      message: `Empresa ${action === 'approve' ? 'aprobada' : 'rechazada'} exitosamente`,
      reqId,
      company: {
        id: updatedCompany.id,
        name: updatedCompany.name,
        rfc: updatedCompany.rfc,
        status: updatedCompany.status,
        approvedAt: updatedCompany.approvedAt,
        rejectionReason: updatedCompany.rejectionReason,
      }
    }, { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } })
  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[companies POST approve/reject] 500:', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  void request
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const { id } = await params
    if (!id) return NextResponse.json(
      { error: 'ID de empresa requerido', reqId },
      { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, systemRole: true } })
    if (!user) return NextResponse.json(
      { error: 'Usuario no encontrado', reqId },
      { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const access = await canUserAccessCompany(user.id, user.systemRole, id)
    if (!access.allowed) {
      return NextResponse.json(
        { error: 'Permisos insuficientes para ver esta empresa', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const enrichedUser = await enrichUserWithMemberships(user)
    if (!hasPermission(enrichedUser, Permission.COMPANY_READ, access.organizationId)) {
      return NextResponse.json(
        { error: 'Permisos insuficientes para ver esta empresa', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        auditLogs: {
          orderBy: { timestamp: 'desc' },
          take: 10
        }
      }
    })
    if (!company) return NextResponse.json(
      { error: 'Empresa no encontrada', reqId },
      { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const logoUrl = await findLatestLogoSafe(company.id)

    return NextResponse.json({
      reqId,
      company: {
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        businessName: company.businessName,
        legalRepresentative: company.legalRepresentative,
        taxRegime: company.taxRegime,
        postalCode: company.postalCode,
        address: company.address,
        city: company.city,
        state: company.state,
        country: company.country,
        phone: company.phone,
        email: company.email,
        // COMP-008 FIX MEDIO: Sanitizar URL antes de devolver (strip javascript:/data: schemes residual)
        website: (() => {
          if (!company.website) return company.website
          try {
            const u = new URL(company.website)
            return WEBSITE_ALLOWED_SCHEMES.has(u.protocol) ? company.website : null
          } catch {
            return null
          }
        })(),
        industry: company.industry,
        employeesCount: company.employeesCount,
        incorporationDate: company.incorporationDate,
        status: company.status,
        approvedBy: company.approvedBy,
        approvedAt: company.approvedAt,
        rejectionReason: company.rejectionReason,
        notes: company.notes,
        logo: logoUrl,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
        createdBy: company.createdBy,
        updatedBy: company.updatedBy,
      },
      // COMP-013 FIX BAJO: maskEmail en auditLogs.userEmail PII leak
      auditLogs: company.auditLogs.map(log => ({
        id: log.id,
        action: log.action,
        description: log.description,
        userEmail: maskEmail(log.userEmail),
        timestamp: log.timestamp,
      }))
    }, { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } })
  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[companies GET by id] 500:', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = crypto.randomUUID()
  try {
    const clRaw = request.headers.get('content-length')
    const cl = clRaw ? Number(clRaw) : null
    if (cl !== null && (Number.isNaN(cl) || cl > bodySizeLimit)) {
      return NextResponse.json(
        { error: 'Solicitud demasiado grande', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const session = await auth()
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    try {
      enforceCompaniesRateLimit(session.user.id, 'update')
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

    const { id } = await params
    if (!id) return NextResponse.json(
      { error: 'ID de empresa requerido', reqId },
      { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const bodyBuf = await request.arrayBuffer()
    if (bodyBuf.byteLength > bodySizeLimit) {
      return NextResponse.json(
        { error: 'Solicitud demasiado grande', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    let body: unknown
    try {
      body = JSON.parse(new TextDecoder('utf-8').decode(bodyBuf))
    } catch {
      return NextResponse.json(
        { error: 'JSON inválido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const validationResult = updateCompanySchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', reqId, details: safeZodHumanFriendly(validationResult.error.issues) },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, systemRole: true, email: true } })
    if (!user) return NextResponse.json(
      { error: 'Usuario no encontrado', reqId },
      { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const access = await canUserAccessCompany(user.id, user.systemRole, id)
    if (!access.allowed) {
      return NextResponse.json(
        { error: 'Permisos insuficientes para actualizar esta empresa', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const enrichedUser = await enrichUserWithMemberships(user)
    if (!hasPermission(enrichedUser, Permission.COMPANY_UPDATE, access.organizationId)) {
      return NextResponse.json(
        { error: 'No tienes permisos para actualizar empresas', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const existing = await prisma.company.findUnique({ where: { id } })
    if (!existing) return NextResponse.json(
      { error: 'Empresa no encontrada', reqId },
      { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )

    const data = validationResult.data
    const updatePayload: Prisma.CompanyUncheckedUpdateInput = {
      name: data.name,
      rfc: data.rfc.toUpperCase(),
      businessName: data.businessName,
      legalRepresentative: data.legalRepresentative ?? null,
      taxRegime: data.taxRegime,
      postalCode: data.postalCode,
      address: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      country: data.country ?? 'México',
      phone: data.phone ?? null,
      email: data.email ?? null,
      website: data.website ?? null,
      industry: data.industry ?? null,
      employeesCount: data.employeesCount ?? null,
      incorporationDate: data.incorporationDate ? new Date(data.incorporationDate) : null,
      updatedBy: user.id
    }

    const updated = await prisma.company.update({ where: { id }, data: updatePayload })
    const { oldValues, newValues: actualNewValues } = buildAuditDiff(existing, updatePayload)

    await prisma.auditLog.create({
      data: {
        tableName: 'companies',
        recordId: updated.id,
        action: 'UPDATE',
        oldValues,
        newValues: actualNewValues,
        userId: user.id,
        userEmail: maskEmail(user.email),
        description: `Company "${updated.name}" updated`,
        companyId: updated.id
      }
    })

    return NextResponse.json({
      message: 'Empresa actualizada exitosamente',
      reqId,
      company: {
        id: updated.id,
        name: updated.name,
        rfc: updated.rfc,
        businessName: updated.businessName,
        legalRepresentative: updated.legalRepresentative,
        taxRegime: updated.taxRegime,
        postalCode: updated.postalCode,
        address: updated.address,
        city: updated.city,
        state: updated.state,
        country: updated.country,
        phone: updated.phone,
        email: updated.email,
        website: updated.website,
        industry: updated.industry,
        employeesCount: updated.employeesCount,
        incorporationDate: updated.incorporationDate,
        status: updated.status
      }
    }, { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } })
  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[companies PUT update] 500:', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}

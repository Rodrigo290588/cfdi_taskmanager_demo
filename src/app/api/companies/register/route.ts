import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { hasPermission, Permission, enrichUserWithMemberships } from '@/lib/permissions'
import {
  enforceCompaniesRateLimit,
  RateLimitError,
  rateLimitByClientId,
  rateLimitByUserId
} from '@/lib/rate-limit'
import { updateTenantProgress } from '@/lib/tenant'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import type { Company } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = 1024 * 64

const WEBSITE_ALLOWED_SCHEMES = new Set(['https:', 'http:'])

const safeUrlSchema = z.preprocess(
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
)

const optionalPositiveIntSchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return undefined
    if (typeof val === 'number' && Number.isNaN(val)) return undefined
    return val
  },
  z.number().int().positive().optional()
)

const registerCompanySchema = z.strictObject({
  name: z.string().min(1, 'El nombre es requerido').max(200),
  rfc: z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC inválido'),
  businessName: z.string().min(1, 'La razón social es requerida').max(200),
  legalRepresentative: z.string().optional(),
  taxRegime: z.string().min(1, 'El régimen fiscal es requerido'),
  postalCode: z.string().regex(/^\d{5}$/, 'Código postal inválido'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().default('México'),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').optional(),
  website: safeUrlSchema,
  industry: z.string().optional(),
  employeesCount: optionalPositiveIntSchema,
  incorporationDate: z.string().datetime().optional(),
})

function safeZodHumanFriendly(issues: Array<z.ZodIssue>): Array<{ field: string; message: string }> {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message || 'Valor inválido'
  }))
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RFC_UNIFORM_TIMING_MS = 180

export async function POST(request: NextRequest) {
  const reqId = crypto.randomUUID()
  try {
    // COMP-012 FIX BAJO: Double Gate Body Size anti chunked bypass
    const contentLengthRaw = request.headers.get('content-length')
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : null
    if (contentLength !== null && (Number.isNaN(contentLength) || contentLength > bodySizeLimit)) {
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

    const clientIp = (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()) ||
      (request.headers.get('x-real-ip')?.trim()) ||
      'unknown'

    try {
      enforceCompaniesRateLimit(session.user.id, 'create')
      rateLimitByClientId({
        clientId: clientIp,
        key: 'companies:register:ip',
        limit: 20,
        windowMs: 60 * 60 * 1000
      })
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

    // TSC FIX: memberships + include organization relation para poder acceder organization fields
    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          // Hard Constraint equivalente isActive: onboardingCompleted === true (schema Prisma NO tiene isActive)
          where: { status: 'APPROVED', organization: { onboardingCompleted: true } },
          include: { organization: true }
        }
      }
    })

    if (!dbUser) {
      return NextResponse.json(
        { error: 'Usuario no encontrado', reqId },
        { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const primaryMembership = dbUser.memberships[0]
    const organizationId = primaryMembership?.organizationId

    const enrichedUser = await enrichUserWithMemberships({ id: dbUser.id, systemRole: dbUser.systemRole })
    const canCreate = hasPermission(enrichedUser, Permission.COMPANY_CREATE, organizationId)

    if (!canCreate) {
      return NextResponse.json(
        { error: 'No tienes permisos para crear empresas', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const rawBuffer = await request.arrayBuffer()
    if (rawBuffer.byteLength > bodySizeLimit) {
      return NextResponse.json(
        { error: 'Solicitud demasiado grande', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const decoder = new TextDecoder('utf-8')
    let body: unknown
    try {
      body = JSON.parse(decoder.decode(rawBuffer))
    } catch {
      return NextResponse.json(
        { error: 'JSON inválido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const validationResult = registerCompanySchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Datos inválidos',
          reqId,
          details: safeZodHumanFriendly(validationResult.error.issues)
        },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const data = validationResult.data

    const normalizedRfc = data.rfc.toUpperCase()
    const rfcDualKey = `companies:register:rfc:${normalizedRfc}`
    try {
      rateLimitByUserId({
        userId: `${clientIp}:${normalizedRfc}`,
        key: rfcDualKey,
        limit: 3,
        windowMs: 12 * 60 * 60 * 1000
      })
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
    const shadowStart = performance.now()

    type TxResult = { createdCompany: Company | null; rfcExists: boolean }
    let txResult: TxResult = { createdCompany: null, rfcExists: false }

    try {
      txResult = await prisma.$transaction<TxResult>(async tx => {
        const existing = await tx.company.findUnique({
          where: { rfc: normalizedRfc },
          select: { id: true, rfc: true }
        })

        if (existing) {
          try {
            await tx.auditLog.count({
              where: { recordId: `__shadow_rfc_enum_${normalizedRfc}`.slice(0, 50) },
              take: 1
            })
          } catch {
            // ignore shadow operation
          }
          return { createdCompany: null, rfcExists: true }
        }

        const created = await tx.company.create({
          data: {
            name: data.name,
            rfc: normalizedRfc,
            businessName: data.businessName,
            legalRepresentative: data.legalRepresentative ?? null,
            taxRegime: data.taxRegime,
            postalCode: data.postalCode,
            address: data.address ?? null,
            city: data.city ?? null,
            state: data.state ?? null,
            country: data.country,
            phone: data.phone ?? null,
            email: data.email ?? null,
            website: data.website ?? null,
            industry: data.industry ?? null,
            employeesCount: data.employeesCount ?? null,
            incorporationDate: data.incorporationDate ? new Date(data.incorporationDate) : null,
            createdBy: dbUser.id,
            updatedBy: dbUser.id,
          }
        })

        if (primaryMembership) {
          try {
            await tx.companyAccess.create({
              data: {
                companyId: created.id,
                memberId: primaryMembership.id,
                organizationId: primaryMembership.organizationId,
              }
            })
          } catch {
            // Ignore unique constraint collision
          }
        }
        return { createdCompany: created, rfcExists: false }
      }, { isolationLevel: 'Serializable' })
    } finally {
      const elapsed = performance.now() - shadowStart
      if (elapsed < RFC_UNIFORM_TIMING_MS) {
        await sleepMs(RFC_UNIFORM_TIMING_MS - Math.floor(elapsed))
      }
    }

    const finalCompany = txResult.createdCompany
    const rfcExists = txResult.rfcExists
    const finalMembership = primaryMembership

    if (finalMembership && finalCompany && finalMembership.organization?.ownerId === dbUser.id) {
      try {
        await updateTenantProgress(finalMembership.organizationId)
      } catch (tpErr) {
        console.warn('[companies register] updateTenantProgress failed (non-fatal):', {
          reqId,
          orgId: finalMembership.organizationId,
          err: tpErr instanceof Error ? tpErr.message : String(tpErr)
        })
      }
    }

    if (finalCompany) {
      await prisma.auditLog.create({
        data: {
          tableName: 'companies',
          recordId: finalCompany.id,
          action: 'CREATE',
          newValues: {
            name: data.name,
            rfc: normalizedRfc,
            businessName: data.businessName,
            taxRegime: data.taxRegime,
            postalCode: data.postalCode
          },
          userId: dbUser.id,
          userEmail: dbUser.email ?? '',
          description: `Company "${data.name}" registered with RFC ${normalizedRfc}`,
          companyId: finalCompany.id,
        }
      })
    }

    if (rfcExists) {
      return NextResponse.json(
        {
          status: 'RFC_DUPLICATE' as const,
          message: 'Solicitud recibida. El RFC ya se encuentra registrado, te contactaremos si hay novedades.',
          reqId,
          nextReviewAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        },
        { status: 202, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } }
      )
    }

    return NextResponse.json({
      status: 'OK' as const,
      message: 'Empresa registrada exitosamente',
      reqId,
      company: finalCompany ? {
        id: finalCompany.id,
        name: finalCompany.name,
        rfc: finalCompany.rfc,
        businessName: finalCompany.businessName,
        status: finalCompany.status,
        createdAt: finalCompany.createdAt,
      } : null
    }, { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } })

  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[companies register] 500:', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { Prisma, SystemRole } from '@prisma/client'
import type { Prisma as PrismaType } from '@prisma/client'
import { updateTenantProgress, getPrimaryApprovedMembership, __tenantGetIpFromNextRequest } from '@/lib/tenant'
import { auth } from '@/lib/auth'
import { z } from 'zod'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { rateLimitByUserId, rateLimitByClientId, RateLimitError } from '@/lib/rate-limit'
import { enrichUserWithMemberships, hasPermission, Permission } from '@/lib/permissions'
import { encrypt, decrypt } from '@/lib/encryption'

const ENC_PREFIX = '__enc_v1__:'

type TenantSmtpSettings = {
  host?: unknown
  port?: unknown
  secure?: unknown
  user?: unknown
  pass?: unknown
  fromEmail?: unknown
  timeoutMs?: unknown
  ehloDomain?: unknown
}

type TenantSystemSettingsShape = {
  theme?: unknown
  smtp?: TenantSmtpSettings
} & Record<string, unknown>

function __coerceToPrismaJson(value: unknown): PrismaType.InputJsonValue | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull as unknown as PrismaType.InputJsonValue
  return value as PrismaType.InputJsonValue
}

function mergeSatResponseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'private, no-store, no-cache',
    ...(extra ?? {})
  }
}

const systemSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean().optional(),
    user: z.string().min(1),
    pass: z.string().min(1),
    fromEmail: z.string().email(),
    fromName: z.string().optional()
  }).partial().optional(),
  notifications: z.object({
    emailEnabled: z.boolean().optional(),
    alertsEnabled: z.boolean().optional(),
    auditEnabled: z.boolean().optional()
  }).optional(),
  preferences: z.object({
    locale: z.string().optional(),
    timezone: z.string().optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional()
  }).optional()
}).optional().nullable()

const optionalNullableUrlSchema = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().url('URL inválida').optional().nullable()
)

const optionalNullableYearSchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return undefined
    if (typeof val === 'number' && Number.isNaN(val)) return undefined
    return val
  },
  z.number().int().min(1800).max(new Date().getFullYear()).optional().nullable()
)

const tenantDetailsSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del tenant es obligatorio').max(100),
  description: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable().default('México'),
  phone: z.string().optional().nullable(),
  contactEmail: z.preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      return trimmed === '' ? undefined : trimmed
    }
    return val
  }, z.string().email('Email inválido').optional().nullable()),
  businessDescription: z.string().optional().nullable(),
  website: optionalNullableUrlSchema,
  industry: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  foundedYear: optionalNullableYearSchema,
  taxId: z.string().optional().nullable(),
  businessType: z.string().optional().nullable(),
  operationalAccessEnabled: z.boolean().optional().nullable(),
  systemSettings: systemSettingsSchema,
})

export type TenantDetailsInput = z.infer<typeof tenantDetailsSchema>

export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401, headers: mergeSatResponseHeaders() }
      )
    }

    const ip = __tenantGetIpFromNextRequest(request)
    try {
      rateLimitByClientId({ clientId: ip, key: 'tenant:get:ip', limit: 60, windowMs: 60_000 })
      rateLimitByUserId({ userId: session.user.id, key: 'tenant:get:user', limit: 120, windowMs: 60_000 })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          { error: rl.message },
          {
            status: 429,
            headers: mergeSatResponseHeaders({
              'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000))
            })
          }
        )
      }
      throw rl
    }

    const membership = await getPrimaryApprovedMembership(session.user.id)
    if (!membership?.organization) {
      return NextResponse.json(
        { error: 'No se encontró el tenant' },
        { status: 404, headers: mergeSatResponseHeaders() }
      )
    }
    const org = membership.organization
    if (org.isActive === false) {
      return NextResponse.json(
        { error: 'Tenant inactivo' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })
    if (!hasPermission(enrichedUser, Permission.TENANT_VIEW, org.id)) {
      return NextResponse.json(
        { error: 'No tienes permisos para ver esta información' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    const tenant = { ...org } as Record<string, unknown>
    const sysGet = tenant.systemSettings as TenantSystemSettingsShape | null | undefined
    if (sysGet && typeof sysGet === 'object' && sysGet.smtp && typeof sysGet.smtp === 'object' && sysGet.smtp.pass && typeof sysGet.smtp.pass === 'string') {
      const raw = sysGet.smtp.pass
      if (raw.startsWith(ENC_PREFIX)) {
        if (hasPermission(enrichedUser, Permission.TENANT_MANAGE, org.id)) {
          try {
            sysGet.smtp = {
              ...sysGet.smtp,
              pass: decrypt(raw.slice(ENC_PREFIX.length))
            }
          } catch {
            sysGet.smtp = { ...sysGet.smtp, pass: null }
          }
        } else {
          sysGet.smtp = { ...sysGet.smtp, pass: null }
        }
      }
      tenant.systemSettings = sysGet
    }

    return NextResponse.json(
      { success: true, tenant },
      { headers: mergeSatResponseHeaders() }
    )

  } catch (error) {
    const summary = safeErrSummarySat(error)
    return NextResponse.json(
      {
        error: 'Error interno del servidor',
        incidentFingerprint: summary.incidentFingerprint
      },
      { status: 500, headers: mergeSatResponseHeaders() }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401, headers: mergeSatResponseHeaders() }
      )
    }

    const ip = __tenantGetIpFromNextRequest(request)

    const membership = await getPrimaryApprovedMembership(session.user.id)
    if (!membership?.organization) {
      return NextResponse.json(
        { error: 'No se encontró el tenant' },
        { status: 404, headers: mergeSatResponseHeaders() }
      )
    }
    const org = membership.organization
    if (org.isActive === false) {
      return NextResponse.json(
        { error: 'Tenant inactivo' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    try {
      rateLimitByClientId({ clientId: ip, key: 'tenant:post:ip', limit: 40, windowMs: 60_000 })
      rateLimitByUserId({ userId: session.user.id, key: 'tenant:post:user', limit: 10, windowMs: 60_000 })
      rateLimitByUserId({ userId: `orgday:${org.id}`, key: 'tenant:post:orgday', limit: 1000, windowMs: 24 * 60 * 60 * 1000 })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          { error: rl.message },
          {
            status: 429,
            headers: mergeSatResponseHeaders({
              'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000))
            })
          }
        )
      }
      throw rl
    }

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })
    if (!hasPermission(enrichedUser, Permission.TENANT_MANAGE, org.id)) {
      return NextResponse.json(
        { error: 'No tienes permisos para modificar esta información' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    const body = await request.json()
    const parsed = tenantDetailsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.issues },
        { status: 400, headers: mergeSatResponseHeaders() }
      )
    }
    const validatedData = parsed.data

    const updateData = {
      name: validatedData.name,
      description: validatedData.description,
      address: validatedData.address,
      city: validatedData.city,
      state: validatedData.state,
      postalCode: validatedData.postalCode,
      country: validatedData.country,
      phone: validatedData.phone,
      contactEmail: validatedData.contactEmail,
      businessDescription: validatedData.businessDescription,
      website: validatedData.website,
      industry: validatedData.industry,
      companySize: validatedData.companySize,
      foundedYear: validatedData.foundedYear,
      taxId: validatedData.taxId,
      businessType: validatedData.businessType,
      operationalAccessEnabled: validatedData.operationalAccessEnabled ?? undefined,
    } as unknown as Prisma.OrganizationUpdateInput

    if (validatedData.systemSettings) {
      const sys = { ...validatedData.systemSettings } as TenantSystemSettingsShape
      if (sys.smtp && typeof sys.smtp === 'object' && sys.smtp.pass && typeof sys.smtp.pass === 'string') {
        const passRaw = sys.smtp.pass
        if (!passRaw.startsWith(ENC_PREFIX)) {
          sys.smtp = {
            ...sys.smtp,
            pass: `${ENC_PREFIX}${encrypt(passRaw)}`
          }
        }
      }
      updateData.systemSettings = __coerceToPrismaJson(sys)
    } else {
      updateData.systemSettings = undefined
    }

    const { prisma } = await import('@/lib/prisma')
    const updatedTenant = await prisma.organization.update({
      where: { id: org.id },
      data: updateData
    })

    await updateTenantProgress(updatedTenant.id)

    return NextResponse.json(
      {
        success: true,
        tenant: updatedTenant,
        message: 'Información del tenant actualizada exitosamente'
      },
      { headers: mergeSatResponseHeaders() }
    )

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400, headers: mergeSatResponseHeaders() }
      )
    }
    const summary = safeErrSummarySat(error)
    return NextResponse.json(
      {
        error: 'Error interno del servidor',
        incidentFingerprint: summary.incidentFingerprint
      },
      { status: 500, headers: mergeSatResponseHeaders() }
    )
  }
}

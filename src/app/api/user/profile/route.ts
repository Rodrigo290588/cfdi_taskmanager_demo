import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Prisma, SystemRole } from '@prisma/client'
import type { Prisma as PrismaType } from '@prisma/client'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { enforceUserRateLimit, RateLimitError } from '@/lib/rate-limit'

const MAX_COLUMNS_PER_TABLE = 100
const MAX_COLUMN_NAME_LEN = 64
const MAX_LOCALE_LEN = 64
const MAX_TIMEZONE_LEN = 64
const MAX_BODY_BYTES = 32 * 1024

const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    locale: z.string().trim().max(MAX_LOCALE_LEN).optional(),
    timezone: z.string().trim().max(MAX_TIMEZONE_LEN).optional(),
    notifications: z
      .object({
        emailEnabled: z.boolean().optional(),
        productUpdates: z.boolean().optional(),
        tipsEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    tables: z
      .object({
        workpaperEmitidos: z
          .object({
            visibleColumns: z
              .array(z.string().trim().max(MAX_COLUMN_NAME_LEN))
              .max(MAX_COLUMNS_PER_TABLE)
              .optional(),
            columnOrder: z
              .array(z.string().trim().max(MAX_COLUMN_NAME_LEN))
              .max(MAX_COLUMNS_PER_TABLE)
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional()

const profileSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    preferences: preferencesSchema,
  })
  .strict()

function __coerceToPrismaJson(value: unknown): PrismaType.InputJsonValue | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull as unknown as PrismaType.InputJsonValue
  return value as PrismaType.InputJsonValue
}

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

export async function GET(_request: NextRequest) {
  void _request
  try {
    const session = await auth()
    if (!session?.user?.id) {
      const r = NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      return applyUserSecurityHeaders(r)
    }
    const _systemRole: SystemRole =
      ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    void _systemRole

    enforceUserRateLimit(session.user.id, 'profileGet')

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) {
      const r = NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
      return applyUserSecurityHeaders(r)
    }

    const onboarding = (user.onboardingData as unknown as { preferences?: unknown }) || {}
    const r = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        preferences: (onboarding.preferences as Record<string, unknown> | undefined) || {},
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

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      const r = NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      return applyUserSecurityHeaders(r)
    }
    const _systemRole: SystemRole =
      ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    void _systemRole

    enforceUserRateLimit(session.user.id, 'profilePost')

    const contentLength = Number(request.headers.get('content-length') || '0') || 0
    if (contentLength > MAX_BODY_BYTES) {
      const r = NextResponse.json({ error: `Payload demasiado grande (máx ${MAX_BODY_BYTES} bytes)` }, { status: 413 })
      return applyUserSecurityHeaders(r)
    }
    const rawBody = await request.arrayBuffer()
    if (rawBody.byteLength > MAX_BODY_BYTES) {
      const r = NextResponse.json({ error: `Payload demasiado grande (máx ${MAX_BODY_BYTES} bytes)` }, { status: 413 })
      return applyUserSecurityHeaders(r)
    }
    const body = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown
    const validated = profileSchema.parse(body)

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) {
      const r = NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
      return applyUserSecurityHeaders(r)
    }

    const currentOnboarding = (user.onboardingData as unknown as Record<string, unknown>) || {}
    const currentPreferences =
      (currentOnboarding.preferences as Record<string, unknown> | undefined) || {}
    const nextPreferences = validated.preferences
      ? { ...currentPreferences, ...(validated.preferences as Record<string, unknown>) }
      : currentPreferences
    const updatedOnboarding = __coerceToPrismaJson({
      ...currentOnboarding,
      preferences: nextPreferences,
    }) as unknown as Prisma.JsonObject

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: validated.name ?? user.name ?? undefined,
        onboardingData: updatedOnboarding,
      },
    })

    const onboarding = (updated.onboardingData as unknown as { preferences?: unknown }) || {}
    const r = NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        image: updated.image,
        preferences: (onboarding.preferences as Record<string, unknown> | undefined) || {},
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
    if (error instanceof z.ZodError) {
      const r = NextResponse.json({ error: 'Datos inválidos', details: error.issues }, { status: 400 })
      return applyUserSecurityHeaders(r)
    }
    const r = NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500 },
    )
    return applyUserSecurityHeaders(r)
  }
}

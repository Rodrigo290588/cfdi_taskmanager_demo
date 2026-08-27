import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMachineScope } from '@/lib/m2m-route'
import { provisionExternalUsers } from '@/lib/external-user-provisioning'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitConfig, getM2MRateLimitHeaders } from '@/lib/m2m-rate-limit'
import { safeErrSummary } from '@/lib/security'
import {
  ExternalUserBulkSchema,
  EXTERNAL_USERS_CREATE_SCOPE,
  sanitizeZodIssues,
  MAX_EXTERNAL_PAYLOAD_BYTES
} from '@/schemas/external'

function getRequestIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
}

const MAX_USERS_PREPARSE_BYTES = Math.ceil(MAX_EXTERNAL_PAYLOAD_BYTES * 1.35)

// EXT-009 CRÍTICO · Whitelist response fields NO spread ...result
// EXT-002 ALTO · sanitizeZodIssues
// EXT-008 ALTO · safeErrSummary console.error typed NO PII
export const POST = withMachineScope(EXTERNAL_USERS_CREATE_SCOPE, async (request: NextRequest, authContext) => {
  try {
    // EXT-012 · Content-Type / Content-Length pre-check en m2m wrapper, doble check aquí:
    const contentLengthRaw = request.headers.get('content-length')
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : NaN
    if (Number.isFinite(contentLength) && contentLength > MAX_USERS_PREPARSE_BYTES) {
      return NextResponse.json(
        { error: 'El payload excede el tamaño máximo permitido.' },
        { status: 413 }
      )
    }

    const limiter = await rateLimit(
      `m2m:users:create:${authContext.clientId}`,
      getM2MRateLimitConfig()
    )

    if (!limiter.success) {
      return NextResponse.json(
        { error: 'Demasiadas peticiones para este cliente' },
        {
          status: 429,
          headers: getM2MRateLimitHeaders(limiter)
        }
      )
    }

    const customRoles = await prisma.customRole.findMany({
      where: { organizationId: authContext.organizationId },
      select: { name: true }
    })

    const validRoles = new Set([
      'ADMIN',
      'AUDITOR',
      'VIEWER',
      'administrador',
      'auditor',
      'visualizador',
      ...customRoles.map(role => role.name)
    ])

    const body = await request.json()
    const parsed = ExternalUserBulkSchema.parse(body)

    const users: Array<NonNullable<(typeof parsed)['user']> | NonNullable<(typeof parsed)['users']>[number]> =
      'user' in parsed && parsed.user ? [parsed.user] :
        'users' in parsed && Array.isArray(parsed.users) ? parsed.users.filter((u): u is NonNullable<typeof u> => Boolean(u)) :
          []

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'No se proporcionaron usuarios válidos en el cuerpo de la petición.' },
        { status: 400 }
      )
    }

    for (const u of users) {
      if (!validRoles.has(u.rol_empresa.trim())) {
        return NextResponse.json(
          { error: `Rol de empresa inválido: ${u.rol_empresa.trim()}` },
          { status: 400 }
        )
      }
    }

    const rawResult = await provisionExternalUsers({
      organizationId: authContext.organizationId,
      sourceClientId: authContext.clientId,
      sourceIp: getRequestIp(request),
      sourceUserAgent: request.headers.get('user-agent'),
      users
    })

    // provisionExternalUsers return contract: { results: [...], summary: { total, created, rejected } }
    type ProvisionResults = typeof rawResult
    const results = (rawResult as ProvisionResults & { results?: unknown[] }).results ?? []
    const summary = (rawResult as ProvisionResults & { summary?: { total?: number; created?: number; rejected?: number } }).summary ?? {}

    // EXT-009 · Whitelist EXPLÍCITA de campos. NUNCA spread ...result ni organizationId/clientId internos.
    return NextResponse.json(
      {
        success: true,
        created: typeof summary.created === 'number' ? summary.created : 0,
        rejected: typeof summary.rejected === 'number' ? summary.rejected : 0,
        total: typeof summary.total === 'number' ? summary.total : users.length,
        items: Array.isArray(results)
          ? results.map((it: { email?: unknown; externalId?: unknown; status?: unknown; message?: unknown }) => ({
              correo: typeof it.email === 'string' ? it.email : undefined,
              externalId: typeof it.externalId === 'string' ? it.externalId : undefined,
              status: typeof it.status === 'string' ? it.status : undefined,
              error: typeof it.message === 'string' ? it.message?.slice(0, 200) : undefined
            }))
          : []
      },
      { status: 201 }
    )
  } catch (error) {
    // EXT-008 · safeErrSummary sin PII
    console.error('[EXT-USERS] Handler failed:', safeErrSummary(error))

    // EXT-002 · sanitizeZodIssues whitelist fields
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Datos inválidos',
          details: sanitizeZodIssues(error.issues)
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
})

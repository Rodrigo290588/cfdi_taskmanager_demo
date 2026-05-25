import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMachineScope } from '@/lib/m2m-route'
import { createExternalUserSchema, provisionExternalUsers } from '@/lib/external-user-provisioning'
import { rateLimit } from '@/lib/rate-limit'

function getRequestIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
}

export const POST = withMachineScope('users:create', async (request: NextRequest, authContext) => {
  try {
    const limiter = await rateLimit(`m2m:users:create:${authContext.clientId}`, {
      interval: 1000,
      limit: 10
    })

    if (!limiter.success) {
      return NextResponse.json(
        { error: 'Demasiadas peticiones para este cliente' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)),
            'X-RateLimit-Limit': String(limiter.limit),
            'X-RateLimit-Remaining': String(limiter.remaining),
            'X-RateLimit-Reset': String(limiter.resetAt)
          }
        }
      )
    }

    const customRoles = await prisma.customRole.findMany({
      where: { organizationId: authContext.organizationId },
      select: { name: true }
    })

    const validRoles = [
      'ADMIN',
      'AUDITOR',
      'VIEWER',
      'administrador',
      'auditor',
      'visualizador',
      ...customRoles.map(role => role.name)
    ]

    const externalUserSchema = createExternalUserSchema(validRoles)
    const singleUserSchema = z.object({
      user: externalUserSchema
    })

    const bulkUsersSchema = z.object({
      users: z.array(externalUserSchema).min(1).max(500)
    })

    const externalUsersRequestSchema = z.union([singleUserSchema, bulkUsersSchema])
    const body = await request.json()
    const parsed = externalUsersRequestSchema.parse(body)
    const users = 'user' in parsed ? [parsed.user] : parsed.users

    const result = await provisionExternalUsers({
      organizationId: authContext.organizationId,
      sourceClientId: authContext.clientId,
      sourceIp: getRequestIp(request),
      sourceUserAgent: request.headers.get('user-agent'),
      users
    })

    return NextResponse.json(
      {
        success: true,
        organizationId: authContext.organizationId,
        sourceClientId: authContext.clientId,
        ...result
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error en endpoint externo de usuarios:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Datos inválidos',
          details: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
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

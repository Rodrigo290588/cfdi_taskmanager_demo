import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SystemRole } from '@prisma/client'
import {
  DEV_STEP_UP_AUTH_MAX_MINUTES,
  DEV_STAGE_ALLOWED_NODE_ENVS,
  DevSeedEnvWhitelistSchema
} from '@/schemas/dev'
import type { DevSeedEnvWhitelistParsed } from '@/schemas/dev'

export type DevEndpointGuardOpts = {
  requireSuperAdmin?: boolean
  requireStepUpAuthMinutes?: number
  allowBypassEnvKeyName?: string
}

type DevEnvParsed = {
  allowEndpoints: boolean
  noProd: boolean
  explicitAllow: boolean
  rawNodeEnv: string | undefined
  bypassKeyMatched: boolean
}

export function getDevEnvStatus(extraKeyName?: string): DevEnvParsed {
  const envParsed = DevSeedEnvWhitelistSchema.safeParse(process.env)
  const NODE_ENV = process.env.NODE_ENV
  const raw: Partial<DevSeedEnvWhitelistParsed> = envParsed.success ? envParsed.data : {}
  const explicitAllow = raw?.ALLOW_DEV_ENDPOINTS ?? false
  const bypassEnv = extraKeyName
    ? (process.env[extraKeyName]?.trim().toLowerCase() === 'true')
    : false
  const noProd = DEV_STAGE_ALLOWED_NODE_ENVS.has(String(NODE_ENV ?? '').toLowerCase())
  const allowEndpoints = (explicitAllow && noProd) || bypassEnv
  return { allowEndpoints, noProd, explicitAllow, rawNodeEnv: NODE_ENV, bypassKeyMatched: bypassEnv }
}

export async function enforceDevEndpoint(
  request: NextRequest,
  opts?: DevEndpointGuardOpts
): Promise<NextResponse | null> {
  const requireSuperAdmin = opts?.requireSuperAdmin ?? true
  const stepUpMin = opts?.requireStepUpAuthMinutes ?? DEV_STEP_UP_AUTH_MAX_MINUTES

  const env = getDevEnvStatus(opts?.allowBypassEnvKeyName)
  if (!env.allowEndpoints) {
    return NextResponse.json(
      { error: 'Endpoint deshabilitado en este entorno', env_status: env.rawNodeEnv ?? 'unknown' },
      { status: 404 }
    )
  }

  const session = await auth()
  if (!session?.user?.id || typeof session.user.id !== 'string' || session.user.id.length < 8) {
    return NextResponse.json({ error: 'No autorizado: sesión inválida o vencida' }, { status: 401 })
  }
  const userId: string = session.user.id

  const iat = (session as unknown as { iat?: number })?.iat
  if (typeof iat === 'number' && Number.isFinite(iat)) {
    const diffMin = (Date.now() - iat * 1000) / 60000
    if (diffMin > stepUpMin) {
      return NextResponse.json(
        {
          error: 'Step-up requerido: re-autentíquese antes de usar endpoints dev',
          sessionMinutes: Math.floor(diffMin),
          stepUpRequiredMinutes: stepUpMin
        },
        { status: 401 }
      )
    }
  }

  if (requireSuperAdmin) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        systemRole: true,
        id: true,
        updatedAt: true,
        email: true
      }
    })
    if (!u) {
      return NextResponse.json({ error: 'Usuario no encontrado en DB' }, { status: 403 })
    }
    if (u.systemRole !== SystemRole.SUPER_ADMIN) {
      return NextResponse.json({ error: 'Permiso denegado: solo SUPER_ADMIN' }, { status: 403 })
    }
  }

  void request
  return null
}

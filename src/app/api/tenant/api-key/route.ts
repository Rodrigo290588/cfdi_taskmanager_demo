import { NextRequest, NextResponse } from 'next/server'
import type { Prisma, MemberRole } from '@prisma/client'
import { SystemRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import {
  Permission,
  enrichUserWithMemberships,
  hasPermission,
} from '@/lib/permissions'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { rateLimit, RateLimitError } from '@/lib/rate-limit'
import {
  getPrimaryApprovedMembership,
  __tenantGetIpFromNextRequest,
} from '@/lib/tenant'
import { encrypt, decrypt } from '@/lib/encryption'
import crypto from 'crypto'

function sha512Hex(s: string): string {
  return crypto.createHash('sha512').update(String(s ?? '')).digest('hex')
}

function keyFingerprint(keyStr: string): string {
  const h = sha512Hex(keyStr)
  return `sha512:${h.slice(0, 12)}...${h.slice(-8)}`
}

const NINETY_DAYS_MS = 90 * 86400 * 1000

function buildApiKeyCreateData(params: {
  userId: string
  organizationId: string
  name: string
  plaintextKey: string
  permissions: string[]
  isActive: boolean
}) {
  const encryptedKey = encrypt(params.plaintextKey)
  const hash512 = sha512Hex(params.plaintextKey)
  const expiresAt = new Date(Date.now() + NINETY_DAYS_MS)
  const base: Record<string, unknown> = {
    userId: params.userId,
    organizationId: params.organizationId,
    name: params.name,
    key: encryptedKey,
    keyHash: hash512,
    permissions: params.permissions,
    isActive: params.isActive,
    expiresAt,
  }
  return base
}

function buildApiKeyUpdateData(params: {
  plaintextKey: string
}) {
  const encryptedKey = encrypt(params.plaintextKey)
  const hash512 = sha512Hex(params.plaintextKey)
  const expiresAt = new Date(Date.now() + NINETY_DAYS_MS)
  const base: Record<string, unknown> = {
    key: encryptedKey,
    keyHash: hash512,
    lastUsedAt: null,
    expiresAt,
  }
  return base
}

function generateRandomKey(organizationId: string): string {
  const random = crypto.randomBytes(20).toString('hex')
  return `sk_live_${organizationId}_${random}`
}

export async function GET(request: NextRequest) {
  const headers = {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
  } as Record<string, string>

  try {
    const clientIp = __tenantGetIpFromNextRequest(request)
    const rlIp = await rateLimit(`tenant:apikey:ip:${clientIp}`, { interval: 60_000, limit: 10, silent: true })
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

    const rlUser = await rateLimit(`tenant:apikey:user:${session.user.id}`, { interval: 60_000, limit: 5, silent: true })
    if (!rlUser.success) {
      const retrySec = Math.ceil(rlUser.retryAfterMs / 1000)
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }

    const primaryMembership = await getPrimaryApprovedMembership(session.user.id)
    if (!primaryMembership?.organization) {
      return NextResponse.json({ error: 'No se encontró la organización' }, { status: 404, headers })
    }
    const { organizationId, organization } = primaryMembership

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })

    const isOwner = organization.ownerId === session.user.id
    const isAdmin = (primaryMembership.role as MemberRole) === ('ADMIN' as MemberRole)
    const hasManagePerm = hasPermission(enrichedUser, Permission.TENANT_API_KEY_MANAGE, organizationId)
    if (!isOwner && !isAdmin && !hasManagePerm) {
      return NextResponse.json(
        { error: 'Sin permisos para administrar API Keys de la organización' },
        { status: 403, headers }
      )
    }

    const keyName = `Web Service Key (${organization.slug || organizationId})`

    let apiKey = await prisma.apiKey.findFirst({
      where: {
        userId: session.user.id,
        name: keyName,
      },
    })

    let plaintextReveal: string | null = null

    if (!apiKey) {
      const plaintext = generateRandomKey(organizationId)
      const data = buildApiKeyCreateData({
        userId: session.user.id,
        organizationId,
        name: keyName,
        plaintextKey: plaintext,
        permissions: ['read', 'write'],
        isActive: true,
      })
      apiKey = await prisma.apiKey.create({ data: data as unknown as Prisma.ApiKeyCreateInput })
      plaintextReveal = plaintext
    }

    let keyEncrypted: string | undefined
    let keyHash: string | undefined
    let expiresAt: unknown
    if (apiKey) {
      const apiKeyTyped = apiKey as unknown as Record<string, unknown>
      keyEncrypted = apiKeyTyped.key as string
      keyHash = apiKeyTyped.keyHash as string | undefined
      expiresAt = apiKeyTyped.expiresAt
    }

    let fingerprint: string
    if (keyHash) {
      fingerprint = `sha512:${keyHash.slice(0, 12)}...${keyHash.slice(-8)}`
    } else if (keyEncrypted) {
      try {
        const decrypted = decrypt(keyEncrypted)
        fingerprint = keyFingerprint(decrypted)
      } catch {
        fingerprint = 'unknown'
      }
    } else {
      fingerprint = 'unknown'
    }

    const responseBody: Record<string, unknown> = {
      id: apiKey.id,
      name: apiKey.name,
      fingerprint,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      isActive: apiKey.isActive,
      permissions: apiKey.permissions,
      expiresAt: expiresAt ?? null,
    }
    if (plaintextReveal) {
      responseBody.newKey = plaintextReveal
    }

    return NextResponse.json(responseBody, { headers })
  } catch (error) {
    if (error instanceof RateLimitError) {
      const retrySec = Math.ceil(error.retryAfterMs / 1000)
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }
    const safe = safeErrSummarySat(error)
    console.error(`[API-KEY-GET] ${safe.name}:`, safe.message, 'fp=', safe.incidentFingerprint)
    return NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers }
    )
  }
}

export async function POST(request: NextRequest) {
  const headers = {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
  } as Record<string, string>

  try {
    const clientIp = __tenantGetIpFromNextRequest(request)
    const rlIp = await rateLimit(`tenant:apikey:ip:${clientIp}`, { interval: 60_000, limit: 10, silent: true })
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

    const rlUser = await rateLimit(`tenant:apikey:user:${session.user.id}`, { interval: 60_000, limit: 5, silent: true })
    if (!rlUser.success) {
      const retrySec = Math.ceil(rlUser.retryAfterMs / 1000)
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }

    const primaryMembership = await getPrimaryApprovedMembership(session.user.id)
    if (!primaryMembership?.organization) {
      return NextResponse.json({ error: 'No se encontró la organización' }, { status: 404, headers })
    }
    const { organizationId, organization } = primaryMembership

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })

    const isOwner = organization.ownerId === session.user.id
    const isAdmin = (primaryMembership.role as MemberRole) === ('ADMIN' as MemberRole)
    const hasManagePerm = hasPermission(enrichedUser, Permission.TENANT_API_KEY_MANAGE, organizationId)
    if (!isOwner && !isAdmin && !hasManagePerm) {
      return NextResponse.json(
        { error: 'Sin permisos para rotar API Keys de la organización' },
        { status: 403, headers }
      )
    }

    const keyName = `Web Service Key (${organization.slug || organizationId})`
    const plaintext = generateRandomKey(organizationId)

    const existing = await prisma.apiKey.findFirst({
      where: {
        userId: session.user.id,
        name: keyName,
      },
    })

    let savedKey: typeof existing
    if (existing) {
      const updateData = buildApiKeyUpdateData({ plaintextKey: plaintext })
      savedKey = await prisma.apiKey.update({
        where: { id: existing.id },
        data: updateData as unknown as Prisma.ApiKeyUpdateInput,
      })
    } else {
      const createData = buildApiKeyCreateData({
        userId: session.user.id,
        organizationId,
        name: keyName,
        plaintextKey: plaintext,
        permissions: ['read', 'write'],
        isActive: true,
      })
      savedKey = await prisma.apiKey.create({ data: createData as unknown as Prisma.ApiKeyCreateInput })
    }

    const savedKeyTyped = savedKey as unknown as Record<string, unknown>
    const keyHash = savedKeyTyped.keyHash as string | undefined
    let fingerprint: string
    if (keyHash) {
      fingerprint = `sha512:${keyHash.slice(0, 12)}...${keyHash.slice(-8)}`
    } else {
      fingerprint = keyFingerprint(plaintext)
    }

    const expiresAt = savedKeyTyped.expiresAt

    return NextResponse.json(
      {
        id: savedKey.id,
        name: savedKey.name,
        fingerprint,
        newKey: plaintext,
        createdAt: savedKey.createdAt,
        lastUsedAt: savedKey.lastUsedAt,
        isActive: savedKey.isActive,
        permissions: savedKey.permissions,
        expiresAt: expiresAt ?? null,
        message: 'API Key rotada exitosamente. Guarda la newKey ahora: no volverá a mostrarse.',
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
    const safe = safeErrSummarySat(error)
    console.error(`[API-KEY-POST] ${safe.name}:`, safe.message, 'fp=', safe.incidentFingerprint)
    return NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers }
    )
  }
}

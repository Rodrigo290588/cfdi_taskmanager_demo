import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { rateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'

export interface MachineClientConfig {
  clientId: string
  clientSecret: string
  organizationId: string
  scopes: string[]
}

export interface MachineTokenPayload extends JWTPayload {
  sub: string
  org_id: string
  scope: string
  token_use: 'm2m'
}

interface MachineClientIdentity {
  clientId: string
  organizationId: string
  scopes: string[]
}

const DEFAULT_ISSUER = process.env.M2M_JWT_ISSUER || 'cfdi-platform'
const DEFAULT_AUDIENCE = process.env.M2M_JWT_AUDIENCE || 'cfdi-external-users'
const DEFAULT_EXPIRES_IN = process.env.M2M_JWT_EXPIRES_IN || '5m'

function getJwtSecret() {
  const secret = process.env.M2M_JWT_SECRET

  if (!secret) {
    throw new Error('M2M_JWT_SECRET no está configurado')
  }

  return new TextEncoder().encode(secret)
}

export function getMachineClientsFromEnv(): MachineClientConfig[] {
  const raw = process.env.M2M_OAUTH_CLIENTS_JSON

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as MachineClientConfig[]

    return parsed.filter(client =>
      client?.clientId &&
      client?.clientSecret &&
      client?.organizationId &&
      Array.isArray(client?.scopes)
    )
  } catch (error) {
    console.error('Error al parsear M2M_OAUTH_CLIENTS_JSON:', error)
    return []
  }
}

export function safeCompareSecrets(left: string, right: string) {
  // Hashing normalizes length before timingSafeEqual and avoids leaking size details.
  const leftDigest = crypto.createHash('sha256').update(left).digest()
  const rightDigest = crypto.createHash('sha256').update(right).digest()

  return crypto.timingSafeEqual(leftDigest, rightDigest)
}

export function normalizeScopes(scope?: string | string[]) {
  if (!scope) return []

  if (Array.isArray(scope)) {
    return scope.map(item => item.trim()).filter(Boolean)
  }

  return scope
    .split(' ')
    .map(item => item.trim())
    .filter(Boolean)
}

export function hasRequiredScope(scope: string | string[] | undefined, requiredScope: string) {
  return normalizeScopes(scope).includes(requiredScope)
}

export async function authenticateMachineClient(params: {
  clientId: string
  clientSecret: string
  requestedScopes?: string[]
  sourceIp?: string | null
}) {
  const { clientId, clientSecret, requestedScopes = [], sourceIp } = params

  const limiter = await rateLimit(`m2m:${clientId}`, {
    interval: 60 * 1000,
    limit: 10
  })

  if (!limiter.success) {
    return {
      ok: false as const,
      status: 429,
      error: 'rate_limited'
    }
  }

  try {
    const machineClient = await prisma.machineClient.findUnique({
      where: { clientId },
      select: {
        id: true,
        clientId: true,
        clientSecretHash: true,
        organizationId: true,
        scopes: true,
        isActive: true,
        allowedIps: true,
        expiresAt: true
      }
    })

    if (machineClient) {
      if (!machineClient.isActive) {
        return {
          ok: false as const,
          status: 401,
          error: 'invalid_client'
        }
      }

      if (machineClient.expiresAt && machineClient.expiresAt.getTime() <= Date.now()) {
        return {
          ok: false as const,
          status: 401,
          error: 'invalid_client'
        }
      }

      if (
        machineClient.allowedIps.length > 0 &&
        (!sourceIp || !machineClient.allowedIps.includes(sourceIp))
      ) {
        return {
          ok: false as const,
          status: 403,
          error: 'access_denied'
        }
      }

      const isSecretValid = await bcrypt.compare(clientSecret, machineClient.clientSecretHash)

      if (!isSecretValid) {
        return {
          ok: false as const,
          status: 401,
          error: 'invalid_client'
        }
      }

      const allowedScopes = new Set(machineClient.scopes)
      const effectiveScopes = requestedScopes.length > 0 ? requestedScopes : machineClient.scopes
      const hasInvalidRequestedScope = effectiveScopes.some(scope => !allowedScopes.has(scope))

      if (hasInvalidRequestedScope) {
        return {
          ok: false as const,
          status: 403,
          error: 'invalid_scope'
        }
      }

      await prisma.machineClient.update({
        where: { id: machineClient.id },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: sourceIp || null
        }
      })

      const client: MachineClientIdentity = {
        clientId: machineClient.clientId,
        organizationId: machineClient.organizationId,
        scopes: machineClient.scopes
      }

      return {
        ok: true as const,
        client,
        scopes: effectiveScopes
      }
    }
  } catch (error) {
    console.error('Error consultando machine_clients, se usará fallback de entorno:', error)
  }

  const client = getMachineClientsFromEnv().find(item => item.clientId === clientId)

  if (!client) {
    return {
      ok: false as const,
      status: 401,
      error: 'invalid_client'
    }
  }

  if (!safeCompareSecrets(clientSecret, client.clientSecret)) {
    return {
      ok: false as const,
      status: 401,
      error: 'invalid_client'
    }
  }

  const allowedScopes = new Set(client.scopes)
  const effectiveScopes = requestedScopes.length > 0 ? requestedScopes : client.scopes
  const hasInvalidRequestedScope = effectiveScopes.some(scope => !allowedScopes.has(scope))

  if (hasInvalidRequestedScope) {
    return {
      ok: false as const,
      status: 403,
      error: 'invalid_scope'
    }
  }

  const normalizedClient: MachineClientIdentity = {
    clientId: client.clientId,
    organizationId: client.organizationId,
    scopes: client.scopes
  }

  return {
    ok: true as const,
    client: normalizedClient,
    scopes: effectiveScopes
  }
}

export async function issueMachineToken(client: MachineClientIdentity, scopes: string[]) {
  const now = Math.floor(Date.now() / 1000)
  const payload: MachineTokenPayload = {
    sub: client.clientId,
    org_id: client.organizationId,
    scope: scopes.join(' '),
    token_use: 'm2m',
    iat: now,
    jti: crypto.randomUUID()
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(DEFAULT_ISSUER)
    .setAudience(DEFAULT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(DEFAULT_EXPIRES_IN)
    .sign(getJwtSecret())

  return {
    accessToken: token,
    tokenType: 'Bearer',
    expiresIn: 300,
    scope: scopes.join(' ')
  }
}

export async function verifyMachineToken(token: string) {
  const result = await jwtVerify<MachineTokenPayload>(token, getJwtSecret(), {
    issuer: DEFAULT_ISSUER,
    audience: DEFAULT_AUDIENCE
  })

  return result.payload
}

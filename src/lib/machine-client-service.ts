import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type PrismaMachineClientDelegate = Prisma.TransactionClient | typeof prisma

export interface CreateMachineClientInput {
  organizationId: string
  organizationSlug: string
  createdByUserId?: string | null
  description?: string
  scopes?: string[]
  allowedIps?: string[]
  expiresAt?: Date | null
}

export interface CreateMachineClientResult {
  id: string
  clientId: string
  clientSecret: string
  organizationId: string
  scopes: string[]
}

function normalizeSlugForClientId(slug: string) {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'org'
}

async function generateUniqueClientId(db: PrismaMachineClientDelegate, organizationSlug: string) {
  const normalizedSlug = normalizeSlugForClientId(organizationSlug)

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = crypto.randomBytes(4).toString('hex')
    const clientId = `${normalizedSlug}-${suffix}`
    const existingClient = await db.machineClient.findUnique({
      where: { clientId },
      select: { id: true }
    })

    if (!existingClient) {
      return clientId
    }
  }

  return `${normalizedSlug}-${crypto.randomUUID()}`
}

export async function createMachineClient(
  db: PrismaMachineClientDelegate,
  input: CreateMachineClientInput
): Promise<CreateMachineClientResult> {
  const clientId = await generateUniqueClientId(db, input.organizationSlug)
  const clientSecret = crypto.randomBytes(32).toString('base64url')
  const clientSecretHash = await bcrypt.hash(clientSecret, 12)
  const scopes = input.scopes?.length ? Array.from(new Set(input.scopes)) : ['users:create']
  const allowedIps = input.allowedIps?.length ? Array.from(new Set(input.allowedIps)) : []

  const machineClient = await db.machineClient.create({
    data: {
      organizationId: input.organizationId,
      clientId,
      clientSecretHash,
      description: input.description,
      scopes,
      allowedIps,
      expiresAt: input.expiresAt || null,
      createdByUserId: input.createdByUserId || null
    },
    select: {
      id: true,
      clientId: true,
      organizationId: true,
      scopes: true
    }
  })

  return {
    ...machineClient,
    clientSecret
  }
}

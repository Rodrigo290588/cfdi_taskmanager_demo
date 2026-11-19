import { describe, expect, it } from '@jest/globals'
import { ReadableStream } from 'node:stream/web'
import { TextDecoder, TextEncoder } from 'node:util'
import { MessageChannel, MessagePort } from 'node:worker_threads'

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
    fiscalEntity: { findFirst: jest.fn() },
    companyAccess: { findFirst: jest.fn() },
    satCredential: { findUnique: jest.fn() },
    downloadLog: { findMany: jest.fn() },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

Object.assign(globalThis, {
  TextDecoder,
  TextEncoder,
  ReadableStream,
  MessageChannel,
  MessagePort,
})

const {
  Headers: UndiciHeaders,
  Request: UndiciRequest,
  Response: UndiciResponse,
} = require('undici') as typeof import('undici')

Object.assign(globalThis, {
  Headers: UndiciHeaders,
  Request: UndiciRequest,
  Response: UndiciResponse,
})

const { GET } = require('@/app/api/mass-downloads/routines/executions/route') as typeof import('@/app/api/mass-downloads/routines/executions/route')

const COMPANY_ID = 'c123456789012345678901234'

type AsyncMock = {
  mockResolvedValue(value: unknown): void
}

const authMock = auth as unknown as AsyncMock
const prismaMock = prisma as unknown as {
  user: { findUnique: AsyncMock }
  company: { findUnique: AsyncMock }
  fiscalEntity: { findFirst: AsyncMock }
  satCredential: { findUnique: AsyncMock }
  downloadLog: { findMany: AsyncMock }
}

function configureAuthorizedScope(): void {
  authMock.mockResolvedValue({ user: { id: 'user-1' } })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-1',
    email: 'admin@example.com',
    systemRole: 'USER',
    memberships: [{ id: 'member-1', organizationId: 'org-1', role: 'ADMIN' }],
  })
  prismaMock.company.findUnique.mockResolvedValue({
    id: COMPANY_ID,
    rfc: 'ODE8604257UA',
    createdBy: 'another-user',
    status: 'APPROVED',
  })
  prismaMock.fiscalEntity.findFirst.mockResolvedValue({ organizationId: 'org-1' })
  prismaMock.satCredential.findUnique.mockResolvedValue({ id: 'credential-1' })
}

describe('Rutinas de descarga · monitor de ejecuciones', () => {
  it('rechaza la consulta si no hay sesión', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET(new Request(`http://localhost/api/mass-downloads/routines/executions?companyId=${COMPANY_ID}`))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'No autorizado' })
  })

  it('consulta únicamente las ejecuciones del tenant y empresa autorizados', async () => {
    configureAuthorizedScope()
    prismaMock.downloadLog.findMany.mockResolvedValue([])

    const response = await GET(new Request(`http://localhost/api/mass-downloads/routines/executions?companyId=${COMPANY_ID}&limit=20`))

    expect(response.status).toBe(200)
    expect(prismaMock.downloadLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: 'org-1',
        companyId: COMPANY_ID,
      },
      take: 20,
    }))
    await expect(response.json()).resolves.toMatchObject({ data: [] })
  })
})

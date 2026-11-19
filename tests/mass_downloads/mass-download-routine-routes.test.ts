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
    downloadRoutine: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
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

const { POST } = require('@/app/api/mass-downloads/routines/route') as typeof import('@/app/api/mass-downloads/routines/route')
const { DELETE, PATCH } = require('@/app/api/mass-downloads/routines/[routineId]/route') as typeof import('@/app/api/mass-downloads/routines/[routineId]/route')

const ROUTINE_ID = 'c123456789012345678901235'
const COMPANY_ID = 'c123456789012345678901234'

type AsyncMock = {
  mockResolvedValue(value: unknown): void
}

const authMock = auth as unknown as AsyncMock
const prismaMock = prisma as unknown as {
  user: { findUnique: AsyncMock }
  company: { findUnique: AsyncMock }
  fiscalEntity: { findFirst: AsyncMock }
  companyAccess: { findFirst: AsyncMock }
  satCredential: { findUnique: AsyncMock }
  downloadRoutine: {
    create: AsyncMock
    findUnique: AsyncMock
    update: AsyncMock
    findMany: AsyncMock
  }
  auditLog: { create: AsyncMock }
}

const context = {
  params: Promise.resolve({ routineId: ROUTINE_ID }),
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
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
}

function routinePayload(): Record<string, unknown> {
  return {
    companyId: COMPANY_ID,
    name: 'Descarga de prueba',
    requestType: 'CFDI',
    retrievalType: 'EMITIDOS',
    filters: { status: 'Vigente' },
    periodPreset: 'CURRENT_DAY',
    schedule: {
      frequency: 'DAILY',
      scheduledHour: 7,
      timezone: 'America/Mexico_City',
    },
  }
}

describe('Rutinas de descarga · endpoints CRUD protegidos', () => {
  it('crea una rutina con RFC y tenant resueltos por el servidor', async () => {
    configureAuthorizedScope()
    prismaMock.downloadRoutine.create.mockResolvedValue({ id: ROUTINE_ID, name: 'Descarga de prueba' })

    const response = await POST(new Request('http://localhost/api/mass-downloads/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(routinePayload()),
    }))

    expect(response.status).toBe(201)
    expect(prismaMock.downloadRoutine.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        companyId: COMPANY_ID,
        requestingRfc: 'ODE8604257UA',
      }),
    }))
  })

  it('pausa una rutina sin aceptar configuración arbitraria', async () => {
    configureAuthorizedScope()
    prismaMock.downloadRoutine.findUnique.mockResolvedValue({
      id: ROUTINE_ID,
      companyId: COMPANY_ID,
      organizationId: 'org-1',
      status: 'ACTIVE',
    })
    prismaMock.downloadRoutine.update.mockResolvedValue({ id: ROUTINE_ID, status: 'PAUSED' })

    const response = await PATCH(new Request(`http://localhost/api/mass-downloads/routines/${ROUTINE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    }), context)

    expect(response.status).toBe(200)
    expect(prismaMock.downloadRoutine.update).toHaveBeenCalledWith({
      where: { id: ROUTINE_ID },
      data: { status: 'PAUSED', nextRunAt: null },
    })
  })

  it('elimina de forma lógica para conservar el historial de ejecución', async () => {
    configureAuthorizedScope()
    prismaMock.downloadRoutine.findUnique.mockResolvedValue({
      id: ROUTINE_ID,
      companyId: COMPANY_ID,
      organizationId: 'org-1',
      status: 'ACTIVE',
    })
    prismaMock.downloadRoutine.update.mockResolvedValue({ id: ROUTINE_ID, status: 'DELETED' })

    const response = await DELETE(
      new Request(`http://localhost/api/mass-downloads/routines/${ROUTINE_ID}`, { method: 'DELETE' }),
      context,
    )

    expect(response.status).toBe(200)
    expect(prismaMock.downloadRoutine.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ROUTINE_ID },
      data: expect.objectContaining({ status: 'DELETED', nextRunAt: null }),
    }))
  })
})

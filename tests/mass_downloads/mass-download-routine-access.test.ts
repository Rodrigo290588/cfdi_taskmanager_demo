import { describe, expect, it } from '@jest/globals'
import { MemberRole, SystemRole } from '@prisma/client'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
    fiscalEntity: { findFirst: jest.fn() },
    companyAccess: { findFirst: jest.fn() },
    satCredential: { findUnique: jest.fn() },
  },
}))

import {
  loadRoutineActor,
  resolveRoutineScope,
  RoutineAccessError,
  type RoutineActor,
} from '@/lib/mass-download-routine-access'
import { prisma } from '@/lib/prisma'

type AsyncMock = {
  mockResolvedValue(value: unknown): void
}

const prismaMock = prisma as unknown as {
  user: { findUnique: AsyncMock }
  company: { findUnique: AsyncMock }
  fiscalEntity: { findFirst: AsyncMock }
  companyAccess: { findFirst: AsyncMock }
  satCredential: { findUnique: AsyncMock }
}

const ACTOR: RoutineActor = {
  id: 'user-1',
  email: 'admin@example.com',
  systemRole: SystemRole.USER,
  memberships: [{ id: 'member-1', organizationId: 'org-1', role: MemberRole.ADMIN }],
}

function mockCompanyScope(): void {
  prismaMock.company.findUnique.mockResolvedValue({
    id: 'c123456789012345678901234',
    rfc: 'ODE8604257UA',
    createdBy: 'another-user',
    status: 'APPROVED',
  })
  prismaMock.fiscalEntity.findFirst.mockResolvedValue({ organizationId: 'org-1' })
}

describe('Rutinas de descarga · autorización y aislamiento tenant', () => {
  it('carga únicamente membresías aprobadas del actor', async () => {
    prismaMock.user.findUnique.mockResolvedValue(ACTOR)

    const actor = await loadRoutineActor(ACTOR.id)

    expect(actor.id).toBe(ACTOR.id)
    expect(actor.memberships).toHaveLength(1)
  })

  it('resuelve el tenant y exige una FIEL para una operación de rutina', async () => {
    mockCompanyScope()
    prismaMock.satCredential.findUnique.mockResolvedValue({ id: 'credential-1' })

    const scope = await resolveRoutineScope(ACTOR, 'c123456789012345678901234', true)

    expect(scope.organizationId).toBe('org-1')
    expect(scope.company.rfc).toBe('ODE8604257UA')
    expect(prismaMock.satCredential.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_rfc: {
          organizationId: 'org-1',
          rfc: 'ODE8604257UA',
        },
      },
      select: { id: true },
    })
  })

  it('rechaza la operación cuando falta la FIEL de la empresa autorizada', async () => {
    mockCompanyScope()
    prismaMock.satCredential.findUnique.mockResolvedValue(null)

    await expect(resolveRoutineScope(ACTOR, 'c123456789012345678901234', true))
      .rejects
      .toMatchObject({ status: 422, message: 'La empresa no tiene una FIEL registrada' })
  })

  it('rechaza el cruce de tenant antes de consultar credenciales', async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: 'c123456789012345678901234',
      rfc: 'ODE8604257UA',
      createdBy: 'another-user',
      status: 'APPROVED',
    })
    prismaMock.fiscalEntity.findFirst.mockResolvedValue({ organizationId: 'other-organization' })

    await expect(resolveRoutineScope(ACTOR, 'c123456789012345678901234', true))
      .rejects
      .toBeInstanceOf(RoutineAccessError)
    expect(prismaMock.satCredential.findUnique).not.toHaveBeenCalled()
  })
})

import { MemberRole, SystemRole } from '@prisma/client'
import { hasPermission, Permission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'

export class RoutineAccessError extends Error {
  public readonly status: number

  public constructor(message: string, status: number) {
    super(message)
    this.name = 'RoutineAccessError'
    this.status = status
  }
}

export interface RoutineActor {
  readonly id: string
  readonly email: string
  readonly systemRole: SystemRole
  memberships: {
    readonly id: string
    readonly organizationId: string
    readonly role: MemberRole
  }[]
}

export interface RoutineScope {
  readonly organizationId: string
  readonly company: {
    readonly id: string
    readonly rfc: string
  }
  readonly memberId: string
}

export async function loadRoutineActor(userId: string): Promise<RoutineActor> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      systemRole: true,
      memberships: {
        where: { status: 'APPROVED' },
        select: { id: true, organizationId: true, role: true },
      },
    },
  })

  if (!user || user.memberships.length === 0) {
    throw new RoutineAccessError('Sin membresía activa', 403)
  }

  return user
}

export async function resolveRoutineScope(
  actor: RoutineActor,
  companyId: string,
  requireCredential: boolean,
): Promise<RoutineScope> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, rfc: true, createdBy: true, status: true },
  })
  if (company?.status !== 'APPROVED') {
    throw new RoutineAccessError('Empresa no encontrada', 404)
  }

  const fiscalEntity = await prisma.fiscalEntity.findFirst({
    where: { rfc: company.rfc, isActive: true },
    select: { organizationId: true },
  })
  if (!fiscalEntity) {
    throw new RoutineAccessError('Empresa sin organización asociada', 403)
  }

  const member = actor.memberships.find(({ organizationId }) => organizationId === fiscalEntity.organizationId)
  if (!member) {
    throw new RoutineAccessError('Sin acceso a la empresa', 403)
  }

  if (!hasPermission(actor, Permission.CFDI_REQUEST_MASSIVE, fiscalEntity.organizationId)) {
    throw new RoutineAccessError('Permiso insuficiente: Solicitud Descarga Masiva', 403)
  }

  const hasPrivilegedAccess = actor.systemRole === SystemRole.SUPER_ADMIN
    || member.role === MemberRole.ADMIN
    || company.createdBy === actor.id

  if (!hasPrivilegedAccess) {
    const companyAccess = await prisma.companyAccess.findFirst({
      where: {
        companyId: company.id,
        memberId: member.id,
        organizationId: fiscalEntity.organizationId,
      },
      select: { id: true },
    })
    if (!companyAccess) {
      throw new RoutineAccessError('Sin acceso a la empresa', 403)
    }
  }

  if (requireCredential) {
    const credential = await prisma.satCredential.findUnique({
      where: {
        organizationId_rfc: {
          organizationId: fiscalEntity.organizationId,
          rfc: company.rfc,
        },
      },
      select: { id: true },
    })
    if (!credential) {
      throw new RoutineAccessError('La empresa no tiene una FIEL registrada', 422)
    }
  }

  return {
    organizationId: fiscalEntity.organizationId,
    company: { id: company.id, rfc: company.rfc },
    memberId: member.id,
  }
}

import { prisma } from './prisma'

export interface TenantStatus {
  onboardingCompleted: boolean
  operationalAccessEnabled: boolean
  setupProgress: number
  requirements: {
    minUsers: number
    minCompanies: number
    requiredSteps: string[]
  }
  currentState: {
    totalUsers: number
    totalApprovedUsers: number
    totalInvitations: number
    totalCompanies: number
    completedSteps: string[]
  }
}

export async function getTenantStatus(organizationId: string): Promise<TenantStatus> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: {
        where: { status: { equals: 'APPROVED' } }
      },
    }
  })

  if (!organization) {
    throw new Error('Organization not found')
  }

  const requirements = organization.setupRequirements as {
    minUsers: number
    minCompanies: number
    requiredSteps: string[]
  }

  // Compute companies belonging to this tenant by creator membership
  const memberUserIds = organization.members.map(m => m.userId)
  const totalApprovedUsers = organization.members.length

  const totalInvitations = await prisma.member.count({
    where: {
      organizationId,
      status: { in: ['APPROVED', 'PENDING'] }
    }
  })

  const totalCompanies = await prisma.company.count({
    where: {
      createdBy: { in: memberUserIds }
    }
  })

  const currentState = {
    totalUsers: totalApprovedUsers,
    totalApprovedUsers,
    totalInvitations,
    totalCompanies,
    completedSteps: [] as string[]
  }

  const hasBasicSetup = Boolean(organization.name && organization.name.trim().length > 0)
  if (organization.onboardingCompleted || hasBasicSetup) currentState.completedSteps.push('TENANT_SETUP')
  if (currentState.totalCompanies >= requirements.minCompanies) currentState.completedSteps.push('COMPANY_REGISTRATION')
  if (currentState.totalInvitations >= requirements.minUsers) currentState.completedSteps.push('USER_INVITATION')
  const hasAssignedProfiles = organization.members.some(m => m.role !== 'VIEWER')
  if (hasAssignedProfiles) currentState.completedSteps.push('PROFILE_ASSIGNMENT')

  // Calculate setup progress based on completed steps vs total steps
  const totalSteps = getOnboardingSteps().length
  const progress = Math.round((currentState.completedSteps.length / totalSteps) * 100)

  return {
    onboardingCompleted: organization.onboardingCompleted,
    operationalAccessEnabled: organization.operationalAccessEnabled,
    setupProgress: progress,
    requirements,
    currentState
  }
}

export async function checkOperationalAccess(organizationId: string): Promise<boolean> {
  const status = await getTenantStatus(organizationId)
  
  return (
    status.onboardingCompleted &&
    status.operationalAccessEnabled &&
    status.currentState.totalApprovedUsers >= status.requirements.minUsers &&
    status.currentState.totalCompanies >= status.requirements.minCompanies
  )
}

export async function updateTenantProgress(organizationId: string): Promise<void> {
  const status = await getTenantStatus(organizationId)
  
  // Check if requirements are met to enable operational access
  const canEnableOperational =
    status.currentState.totalUsers >= status.requirements.minUsers &&
    status.currentState.totalCompanies >= status.requirements.minCompanies

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      onboardingCompleted: true,
      operationalAccessEnabled: canEnableOperational
    }
  })
}

export function getOnboardingSteps(): Array<{
  key: string
  title: string
  description: string
  order: number
}> {
  return [
    {
      key: 'TENANT_SETUP',
      title: 'Configuración de la Organización',
      description: 'Complete la configuración inicial de su organización',
      order: 1
    },
    {
      key: 'COMPANY_REGISTRATION',
      title: 'Registro de Empresas',
      description: 'Registre al menos una empresa con RFC válido',
      order: 2
    },
    {
      key: 'USER_INVITATION',
      title: 'Invitación de Usuarios',
      description: 'Invite al menos un usuario adicional a su organización',
      order: 3
    },
    {
      key: 'PROFILE_ASSIGNMENT',
      title: 'Asignación de Perfiles',
      description: 'Asigne roles y permisos a los usuarios',
      order: 4
    }
  ]
}

// [SAST-FIX TEN-006] Helper reusable deterministic multi-org pick + org.isActive guard.
// Utilizado por TODOS los 7 handlers /api/tenant/** para evitar Revocation Bypass + Heisenbug findFirst sin orderBy.
import type { MemberRole, Organization } from '@prisma/client'

type MembershipWithOrg = {
  id: string
  userId: string
  organizationId: string
  role: MemberRole
  status: string
  createdAt: Date
  organization: Organization & { isActive?: boolean | null }
}

const __ROLE_RANK: Record<MemberRole, number> = {
  ADMIN: 4,
  AUDITOR: 2,
  VIEWER: 1,
} as const

export async function getPrimaryApprovedMembership(
  userId: string,
  { take = 50 }: { take?: number } = {},
): Promise<MembershipWithOrg | null> {
  if (!userId) return null
  const memberships = await prisma.member.findMany({
    where: {
      userId,
      status: 'APPROVED',
    },
    include: { organization: true },
    take: Math.max(1, Math.min(200, take | 0)),
  })
  if (memberships.length === 0) return null
  const sorted = [...memberships].sort((a, b) => {
    const ra = __ROLE_RANK[(a.role as MemberRole) || 'VIEWER'] || 0
    const rb = __ROLE_RANK[(b.role as MemberRole) || 'VIEWER'] || 0
    if (rb !== ra) return rb - ra
    if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return (sorted[0] as unknown) as MembershipWithOrg
}

export async function getUserApprovedOrganizationIds(userId: string, { take = 200 }: { take?: number } = {}) {
  if (!userId) return [] as string[]
  const rows = await prisma.member.findMany({
    where: { userId, status: 'APPROVED' },
    select: { organizationId: true, role: true },
    take: Math.max(1, Math.min(500, take | 0)),
  })
  return rows.map(r => r.organizationId)
}

// Inline minimal NextRequest helpers (safe re-export para no depender de lib sat)
export function __tenantGetIpFromNextRequest(req: { headers: Headers }): string {
  try {
    const raw = req.headers.get('x-forwarded-for') ?? ''
    return (raw.split(',')[0] || '127.0.0.1').trim() || '127.0.0.1'
  } catch {
    return '127.0.0.1'
  }
}

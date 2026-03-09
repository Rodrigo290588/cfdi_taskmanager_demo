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

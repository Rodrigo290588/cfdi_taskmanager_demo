import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendInvitationEmail } from '@/lib/mail'

export interface InviteUserServiceInput {
  organizationId: string
  invitedByUserId: string
  email: string
  name: string
  roleId: string
  companyIds?: string[]
  providerRfc?: string
  providerName?: string
}

export interface InviteUserServiceResult {
  success: true
  existingUser: boolean
  invitationToken: string
  memberId: string
  userId: string
  isProvider: boolean
}

export async function inviteUserToOrganization({
  organizationId,
  invitedByUserId,
  email,
  name,
  roleId,
  companyIds = [],
  providerRfc,
  providerName
}: InviteUserServiceInput): Promise<InviteUserServiceResult> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      ownerId: true
    }
  })

  if (!organization) {
    throw new Error('Organización no encontrada')
  }

  const isSystemRole = ['ADMIN', 'AUDITOR', 'VIEWER'].includes(roleId)
  const systemRole = isSystemRole ? roleId as 'ADMIN' | 'AUDITOR' | 'VIEWER' : 'VIEWER'
  const customRoleId = isSystemRole ? null : roleId

  const customRoleObj = customRoleId
    ? await prisma.customRole.findUnique({ where: { id: customRoleId } })
    : null
  const isProvider = customRoleObj ? customRoleObj.name.toLowerCase().includes('proveedor') : false

  const existingUser = await prisma.user.findUnique({
    where: { email }
  })

  if (existingUser) {
    const existingMembership = await prisma.member.findFirst({
      where: {
        userId: existingUser.id,
        organizationId
      }
    })

    if (existingMembership) {
      throw new Error('El usuario ya es miembro de esta organización')
    }
  }

  const plainToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex')
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

  const { memberId, userId, existing } = await prisma.$transaction(async tx => {
    let targetUserId = existingUser?.id

    if (!targetUserId) {
      const newUser = await tx.user.create({
        data: {
          email,
          name,
          systemRole: 'USER',
          onboardingStep: 'ORGANIZATION_INVITATION',
          onboardingData: {
            invitedBy: invitedByUserId,
            invitedAt: new Date(),
            organizationId
          }
        }
      })
      targetUserId = newUser.id
    }

    const member = await tx.member.create({
      data: {
        userId: targetUserId,
        organizationId,
        role: systemRole,
        customRoleId,
        status: 'PENDING',
        invitationTokenHash: tokenHash,
        invitationExpiresAt: expiresAt,
        providerRfc: providerRfc || null,
        providerName: providerName || null,
      }
    })

    if (companyIds.length > 0) {
      await tx.companyAccess.createMany({
        data: companyIds.map(companyId => ({
          companyId,
          memberId: member.id,
          organizationId,
          role: systemRole,
          customRoleId
        }))
      })
    }

    return {
      memberId: member.id,
      userId: targetUserId,
      existing: !!existingUser
    }
  })

  await sendInvitationEmail({
    to: email,
    name: existingUser?.name || name,
    invitationToken: plainToken,
    organizationName: organization.name,
    organizationId: organization.id,
    isProvider
  })

  return {
    success: true,
    existingUser: existing,
    invitationToken: plainToken,
    memberId,
    userId,
    isProvider
  }
}

import { prisma } from '@/lib/prisma'
import type { ProviderContext } from '@/lib/provider-cfdi-report'

export async function resolveProviderContext(userId: string, orgId?: string | null): Promise<ProviderContext | null> {
  const member = await prisma.member.findFirst({
    where: {
      userId,
      status: 'APPROVED',
      ...(orgId ? { organizationId: orgId } : {})
    },
    include: {
      customRole: true,
      companyAccesses: {
        include: {
          company: {
            select: {
              id: true,
              rfc: true,
              businessName: true,
              name: true,
              status: true
            }
          }
        }
      }
    }
  })

  if (!member) {
    return null
  }

  const allowedCompanies = member.companyAccesses
    .filter(access => access.company?.status === 'APPROVED')
    .map(access => ({
      id: access.company.id,
      rfc: access.company.rfc,
      businessName: access.company.businessName || access.company.name
    }))

  return {
    memberId: member.id,
    organizationId: member.organizationId,
    providerRfc: member.providerRfc || '',
    providerName: member.providerName,
    providerUploadBlockedAt: member.providerUploadBlockedAt?.toISOString() || null,
    providerUploadBlockedReason: member.providerUploadBlockedReason || null,
    providerUploadBlockedBySystem: member.providerUploadBlockedBySystem,
    allowedCompanies,
    granularPermissions: (member.customRole?.granularPermissions || member.granularPermissions || {}) as Record<string, boolean>
  }
}

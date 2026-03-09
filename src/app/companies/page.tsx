import { Metadata } from 'next'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { CompaniesPageClient } from '@/components/companies/companies-page-client'

export const metadata: Metadata = {
  title: 'Gestión de Empresas - PlatFi Intelligence',
  description: 'Administra el registro y validación de empresas con RFC mexicano',
}

export default async function CompaniesPage() {
  const session = await auth()

  let companies: Array<{
    id: string
    name: string
    rfc: string
    businessName: string
    legalRepresentative: string | null
    taxRegime: string | null
    industry: string | null
    state: string | null
    city: string | null
    email: string | null
    phone: string | null
    website: string | null
    employeesCount: number | null
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    createdAt: string
    approvedByUser?: { name: string; email: string } | null
    auditLogs: Array<{ id: string; action: string; createdAt: string }>
  }> = []

  if (session?.user?.id) {
    const membership = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })

    if (membership?.organization) {
      const isOwner = membership.organization.ownerId === session.user.id
      const isAdmin = (await prisma.member.findUnique({ where: { id: membership.id } }))?.role === 'ADMIN'

      let rows
      if (isOwner || isAdmin) {
        const members = await prisma.member.findMany({
          where: { organizationId: membership.organization.id, status: 'APPROVED' },
          select: { userId: true }
        })
        const userIds = members.map(m => m.userId)
        rows = await prisma.company.findMany({
          where: { createdBy: { in: userIds } },
          orderBy: { createdAt: 'desc' }
        })
      } else {
        const access = await prisma.$queryRaw<Array<{ company_id: string }>>`
          SELECT company_id FROM company_access WHERE member_id = ${membership.id}
        `
        const companyIds = access.map(a => a.company_id)
        rows = await prisma.company.findMany({
          where: { id: { in: companyIds } },
          orderBy: { createdAt: 'desc' }
        })
      }

      companies = rows.map(c => ({
        id: c.id,
        name: c.name,
        rfc: c.rfc,
        businessName: c.businessName,
        legalRepresentative: c.legalRepresentative ?? null,
        taxRegime: c.taxRegime ?? null,
        industry: c.industry ?? null,
        state: c.state ?? null,
        city: c.city ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        website: c.website ?? null,
        employeesCount: c.employeesCount ?? null,
        status: c.status === 'PENDING' ? 'PENDING' : c.status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        createdAt: c.createdAt.toISOString(),
        approvedByUser: null,
        auditLogs: []
      }))
    }
  }

  return (
    <ProtectedRoute>
      <CompaniesPageClient initialCompanies={companies} />
    </ProtectedRoute>
  )
}

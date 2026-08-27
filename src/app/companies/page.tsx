import { Metadata } from 'next'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { CompaniesPageClient } from '@/components/companies/companies-page-client'
import type { Company } from '@prisma/client'

export const metadata: Metadata = {
  title: 'Gestión de Empresas - CFDI Task Manager',
  description: 'Administra el registro y validación de empresas con RFC mexicano',
}

const WEBSITE_ALLOWED_SCHEMES = new Set(['https:', 'http:'])
function sanitizeWebsite(website: string | null): string | null {
  if (!website) return null
  try {
    const u = new URL(website)
    return WEBSITE_ALLOWED_SCHEMES.has(u.protocol) ? website : null
  } catch {
    return null
  }
}

type CompanyPageRow = {
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
  logo?: string | null
}

export default async function CompaniesPage() {
  const session = await auth()

  let companies: CompanyPageRow[] = []

  if (session?.user?.id) {
    // TSC FIX + COMP-005: include organization relation + onboardingCompleted === true (org activa)
    const membership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED',
        organization: { onboardingCompleted: true }
      },
      include: { organization: true }
    })

    if (membership?.organization) {
      const isOwner = membership.organization.ownerId === session.user.id
      const isAdmin = membership.role === 'ADMIN'

      let rows: Array<Pick<Company,
        'id' | 'name' | 'rfc' | 'businessName' | 'legalRepresentative' |
        'taxRegime' | 'industry' | 'state' | 'city' | 'email' | 'phone' |
        'website' | 'employeesCount' | 'status' | 'createdAt'
      >> = []

      if (isOwner || isAdmin) {
        const members = await prisma.member.findMany({
          where: {
            organizationId: membership.organization.id,
            status: 'APPROVED',
            organization: { onboardingCompleted: true }
          },
          select: { userId: true }
        })
        const userIds = members.map(m => m.userId)
        rows = await prisma.company.findMany({
          where: { createdBy: { in: userIds } },
          select: {
            id: true, name: true, rfc: true, businessName: true, legalRepresentative: true,
            taxRegime: true, industry: true, state: true, city: true, email: true,
            phone: true, website: true, employeesCount: true, status: true, createdAt: true
          },
          orderBy: { createdAt: 'desc' }
        })
      } else {
        const accesses = await prisma.companyAccess.findMany({
          where: {
            memberId: membership.id,
            member: { status: 'APPROVED', organization: { onboardingCompleted: true } }
          },
          select: { companyId: true }
        })
        const companyIds = accesses.map(a => a.companyId)
        if (companyIds.length > 0) {
          rows = await prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: {
              id: true, name: true, rfc: true, businessName: true, legalRepresentative: true,
              taxRegime: true, industry: true, state: true, city: true, email: true,
              phone: true, website: true, employeesCount: true, status: true, createdAt: true
            },
            orderBy: { createdAt: 'desc' }
          })
        }
      }

      companies = rows.map(c => ({
        id: c.id,
        name: c.name,
        rfc: c.rfc,
        businessName: c.businessName,
        legalRepresentative: c.legalRepresentative,
        taxRegime: c.taxRegime,
        industry: c.industry,
        state: c.state,
        city: c.city,
        email: c.email,
        phone: c.phone,
        website: sanitizeWebsite(c.website),
        employeesCount: c.employeesCount,
        status: c.status === 'PENDING' ? 'PENDING' : c.status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        createdAt: c.createdAt.toISOString(),
        approvedByUser: null,
        auditLogs: [],
        logo: null
      }))
    }
  }

  return (
    <ProtectedRoute>
      <CompaniesPageClient initialCompanies={companies} />
    </ProtectedRoute>
  )
}

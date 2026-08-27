import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
await p.$connect()

const us = await p.user.findMany({
  where: { email: { in: ['rtorreh@itcomplements.com', 'pnajera@itcomplements.com'] } },
  select: {
    id: true, email: true, systemRole: true, name: true,
    memberships: { select: { id: true, organizationId: true, role: true, status: true } }
  }
})
console.log('USERS', JSON.stringify(us, null, 2))

const orgs = await p.organization.findMany({ select: { id: true, name: true, slug: true } })
console.log('ORGS', JSON.stringify(orgs, null, 2))

const comps = await p.company.findMany({ take: 20, select: { id: true, name: true, rfc: true, companyAccesses: { take: 5, select: { organizationId: true } } } })
console.log('COMPANIES', JSON.stringify(comps, null, 2))

const fes = await p.fiscalEntity.findMany({ take: 20, select: { id: true, rfc: true, organizationId: true, isActive: true } })
console.log('FISCAL_ENTITIES', JSON.stringify(fes, null, 2))

const inv = await p.invoice.findMany({ take: 5, select: { id: true, uuid: true, issuerRfc: true, receiverRfc: true, issuerFiscalEntityId: true } })
console.log('INVOICES', JSON.stringify(inv, null, 2))

const mdr = await p.massDownloadRequest.findMany({ take: 5, select: { id: true, issuerRfc: true, requestingRfc: true, requestStatus: true, satPackageId: true, companyId: true } })
console.log('MASS_DOWNLOAD', JSON.stringify(mdr, null, 2))

await p.$disconnect()

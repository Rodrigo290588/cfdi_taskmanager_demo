import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

const prisma = new PrismaClient()
const OUT = path.resolve(process.cwd(), 'reports', 'SAST-SEED-IDS.json')

const data: any = { generatedAt: new Date().toISOString() }
const emails = [
  'sa-sast@itcomplements.com',
  'rtorreh@itcomplements.com',
  'pnajera@itcomplements.com',
  'audit-sast@itcomplements.com',
  'other-sast@itcomplements.com'
]
data.users = {}
for (const e of emails) {
  const q1 = { where: { email: e } }
  const q2 = { include: { memberships: { include: { organization: true } } } }
  const u = await prisma.user.findUnique({ ...q1, ...q2 }) as any
  data.users[e] = u ? {
    userId: u.id,
    systemRole: u.systemRole,
    passwordSet: (u.memberships || []).map((m: any) => ({
      orgId: m.organizationId,
      orgName: m.organization ? m.organization.name : null,
      memberRole: m.role,
      memberStatus: m.status,
      memberId: m.id
    }))
  } : null
}

data.orgs = await prisma.organization.findMany({ select: { id: true, name: true } })

const feWhere = { where: { OR: [{ rfc: 'ODE8604257UA' }, { rfc: 'QBB7223997V9' }] } }
const feSelect = { select: { id: true, rfc: true, businessName: true, organizationId: true } }
data.fiscalEntities = await prisma.fiscalEntity.findMany({ ...feWhere, ...feSelect })

const coWhere = { where: { OR: [{ rfc: 'QA2190188S3Z' }, { rfc: 'QB2306260K5Y' }] } }
const coSelect = {
  select: {
    id: true, rfc: true, name: true,
    companyAccesses: { include: { member: { include: { user: true } } } }
  }
}
data.companies = await prisma.company.findMany({ ...coWhere, ...coSelect })

const invWhere = {
  where: { OR: [{ uuid: '11111111-0000-4000-8000-000000000001' }, { uuid: '11111111-0000-4000-8000-000000000002' }] }
}
const invSelect = {
  select: {
    uuid: true, issuerRfc: true, receiverRfc: true, total: true,
    series: true, folio: true, status: true, issuerFiscalEntityId: true,
    fiscalEntity: { select: { organizationId: true } }
  }
}
data.keptInvoices = await prisma.invoice.findMany({ ...invWhere, ...invSelect })

const mdrWhere = { where: { satPackageId: { in: ['AAAAAAAA-0000-0000-0000-00000000000A', 'BBBBBBBB-0000-0000-0000-00000000000B'] } } }
const mdrSelect = {
  select: {
    id: true, requestType: true, requestingRfc: true, issuerRfc: true, status: true, satPackageId: true,
    company: {
      include: {
        companyAccesses: { take: 1, include: { member: { include: { user: true } } } }
      }
    }
  }
}
data.massDownloads = await prisma.massDownloadRequest.findMany({ ...mdrWhere, ...mdrSelect })

const scWhere = { where: { rfc: 'QBB7223997V9' } }
const scSelect = { select: { id: true, rfc: true, organizationId: true } }
data.satCredentials = await prisma.satCredential.findMany({ ...scWhere, ...scSelect })

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8')

console.log('SAST seed IDs dump OK', OUT)
console.log(JSON.stringify(data, null, 2))
await prisma.$disconnect()

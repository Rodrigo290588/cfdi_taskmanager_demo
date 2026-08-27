// Dump IDs definitivos generados por seed-sast-fixtures.mts (inspeccion Prisma sin re ejecutar el seed)
// Escribe JSON en reports/SAST-SEED-IDS.json y lo usamos para actualizar el checklist.
import { PrismaClient, SystemRole, MemberRole } from '@prisma/client'
import bcrypt from 'bcryptjs'
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
  const u = await prisma.user.findUnique({
    where: { email: e },
    include: { memberships: { include: { organization: true } } }
  })
  data.users[e] = u ? {
    userId: u.id,
    systemRole: u.systemRole,
    passwordSet: u.memberships.map(m => ({
      orgId: m.organizationId,
      orgName: m.organization.name,
      memberRole: m.role,
      memberStatus: m.status,
      memberId: m.id
    }))
  } : null
}

data.orgs = (await prisma.organization.findMany({ select: { id: true, name: true } }))
data.fiscalEntities = await prisma.fiscalEntity.findMany({
  where: { OR: [{ rfc: 'ODE8604257UA' }, { rfc: 'QBB7223997V9' }] },
  select: { id: true, rfc: true, businessName: true, organizationId: true }
})
data.companies = await prisma.company.findMany({
  where: { OR: [{ rfc: 'QA2190188S3Z' }, { rfc: 'QB2306260K5Y' }] },
  select: {
    id: true,
    rfc: true,
    legalName: true,
    companyAccesses: { include: { member: { include: { user: true } } } }
  }
})
data.keptInvoices = await prisma.invoice.findMany({
  where: {
    OR: [
      { uuid: '11111111-0000-4000-8000-000000000001' },
      { uuid: '11111111-0000-4000-8000-000000000002' }
    ]
  },
  select: { uuid: true, rfcIssuer: true, rfcReceiver: true, total: true, organizationId: true }
})
data.massDownloads = await prisma.massDownloadRequest.findMany({
  where: { OR: [{ requestCode: { startsWith: 'mdr-sast-' } }] },
  select: { id: true, requestCode: true, rfc: true, status: true, packageId: true, organizationId: true }
})
data.satCredentials = await prisma.satCredential.findMany({
  where: { rfc: 'QBB7223997V9' },
  select: { id: true, rfc: true, organizationId: true, status: true }
})

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8')

console.log('SAST seed IDs dump →', OUT)
console.log(JSON.stringify(data, null, 2))
await prisma.$disconnect()

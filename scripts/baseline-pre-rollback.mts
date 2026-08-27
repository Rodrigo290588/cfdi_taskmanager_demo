import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  await prisma.$connect()
  const cp = '2026-08-13T23:31:02.000Z'
  const out: Record<string, any> = {}
  out._timestampBaseline = new Date().toISOString()
  out.checkpointReference = cp

  const realEmails = ['rtorreh@itcomplements.com', 'pnajera@itcomplements.com']
  const seedEmails = ['sa-sast@itcomplements.com', 'audit-sast@itcomplements.com', 'other-sast@itcomplements.com']
  const orgIds = ['cmnntrppk000502gcp93ketfx', 'cmipiwlqk000mvyvtc22tnlrb']
  const seedRfcs = ['QA2190188S3Z', 'QB2306260K5Y']
  const invoiceUuids = ['11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002']
  const mdrIds = ['mdr-sast-org-a-prop-001', 'mdr-sast-org-b-aje-001']

  out.USERS = {}
  out.USERS.totalUsers = await prisma.user.count()
  out.USERS.realCount = await prisma.user.count({ where: { email: { in: realEmails } } })
  out.USERS.seedCount = await prisma.user.count({ where: { email: { in: seedEmails } } })
  const realUsersSel = { id: true, email: true, systemRole: true }
  out.USERS.real = await prisma.user.findMany({ where: { email: { in: realEmails } }, select: realUsersSel })
  const seedUsersSel = { id: true, email: true, systemRole: true }
  out.USERS.seed = await prisma.user.findMany({ where: { email: { in: seedEmails } }, select: seedUsersSel })

  out.ORGS = {}
  out.ORGS.totalOrgs = await prisma.organization.count()
  out.ORGS.orgABCount = await prisma.organization.count({ where: { id: { in: orgIds } } })
  const orgSel = { id: true, name: true }
  out.ORGS.orgAB = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: orgSel })

  out.MEMBERS = {}
  out.MEMBERS.totalMembers = await prisma.member.count()
  const realMembersWhere = { user: { email: { in: realEmails } } }
  out.MEMBERS.realCount = await prisma.member.count({ where: realMembersWhere })
  const seedMembersWhere = { user: { email: { in: seedEmails } } }
  out.MEMBERS.seedCount = await prisma.member.count({ where: seedMembersWhere })

  out.FE = {}
  out.FE.total = await prisma.fiscalEntity.count()
  const feFindSel = { id: true, rfc: true, businessName: true, organizationId: true }
  out.FE.real_ODE8604257UA = await prisma.fiscalEntity.findFirst({ where: { rfc: 'ODE8604257UA' }, select: feFindSel })
  out.FE.seed_QBB7223997V9 = await prisma.fiscalEntity.findFirst({ where: { rfc: 'QBB7223997V9' }, select: feFindSel })

  out.COMPANIES = {}
  out.COMPANIES.totalCompanies = await prisma.company.count()
  const companySel = { id: true, rfc: true, name: true, businessName: true, organizationId: false, status: true, createdById: false }
  out.COMPANIES.seed = await prisma.company.findMany({ where: { rfc: { in: seedRfcs } }, select: { id: true, rfc: true, name: true, status: true, createdBy: true, createdAt: true } })

  out.COMPANY_ACCESS = { total: await prisma.companyAccess.count() }

  out.INVOICES = {}
  out.INVOICES.total = await prisma.invoice.count()
  out.INVOICES.seedCount = await prisma.invoice.count({ where: { uuid: { in: invoiceUuids } } })
  const invSel = { uuid: true, issuerRfc: true, receiverRfc: true, total: true, status: true }
  out.INVOICES.seed = await prisma.invoice.findMany({ where: { uuid: { in: invoiceUuids } }, select: invSel })
  try { out.INVOICE_BLOBS = { total: await (prisma as any).invoiceBlob.count() } } catch (e) { out.INVOICE_BLOBS = { error: String(e).slice(0, 80) } }

  out.MDR = {}
  out.MDR.total = await prisma.massDownloadRequest.count()
  out.MDR.seedCount = await prisma.massDownloadRequest.count({ where: { id: { in: mdrIds } } })
  const mdrSel = { id: true, satPackageId: true, requestingRfc: true, requestStatus: true }
  out.MDR.seed = await prisma.massDownloadRequest.findMany({ where: { id: { in: mdrIds } }, select: mdrSel })

  try { out.SAT_CREDENTIALS = { total: await prisma.satCredential.count() } } catch (e) { out.SAT_CREDENTIALS = { error: String(e).slice(0, 80) } }

  out.AUDIT_LOG = {}
  out.AUDIT_LOG.total = await prisma.auditLog.count()
  out.AUDIT_LOG.postCheckpoint = await prisma.auditLog.count({ where: { timestamp: { gte: new Date(cp) } } })

  try {
    const p = prisma as any
    out.IMPORT = {}
    out.IMPORT.ImportRuns = p.importRun ? await p.importRun.count() : -1
    out.IMPORT.ImportDirectorySessions = p.importDirectorySession ? await p.importDirectorySession.count() : -1
    out.IMPORT.ImportRunItems = p.importRunItem ? await p.importRunItem.count() : -1
  } catch (e) { out.IMPORT = { error: String(e).slice(0, 80) } }

  try { out.CUSTOM_ROLES = { total: await (prisma as any).customRole.count() } } catch (e) { out.CUSTOM_ROLES = { error: String(e).slice(0, 80) } }

  console.log(JSON.stringify(out, null, 2))
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERROR:', (e as Error).message)
  await prisma.$disconnect()
  process.exit(1)
})

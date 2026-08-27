import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = 'rtorreh@itcomplements.com'
  console.log('[DIAG] User email:', email)

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        include: { organization: true }
      }
    }
  })
  if (!user) { console.log('[DIAG] USER NOT FOUND'); return }
  console.log('[DIAG] user.id:', user.id, 'systemRole:', user.systemRole)
  console.log('[DIAG] memberships count:', user.memberships.length)
  for (const m of user.memberships) {
    console.log('  - mem status=', m.status, 'orgId=', m.organizationId, 'ownerId=', m.organization?.ownerId, 'role=', m.role)
  }

  const orgIdParam: string | null = null
  const isSuperOrSystemAdmin = user.systemRole === 'SUPER_ADMIN' || user.systemRole === 'ADMIN'
  console.log('[DIAG] isSuperOrSystemAdmin:', isSuperOrSystemAdmin)

  const authorizedOrgIds = user.memberships
    .filter((m: any) => m.status === 'APPROVED')
    .map((m: any) => m.organizationId)
  console.log('[DIAG] authorizedOrgIds:', authorizedOrgIds)

  const scopedOrgIds: string[] = []
  if (orgIdParam) scopedOrgIds.push(orgIdParam)
  else {
    if (authorizedOrgIds.length > 0) scopedOrgIds.push(...authorizedOrgIds)
  }
  console.log('[DIAG] scopedOrgIds:', scopedOrgIds)

  let companiesResult: any[] = []
  if (isSuperOrSystemAdmin) {
    console.log('[DIAG] path: SUPER/ADMIN → company.findMany with where=', scopedOrgIds.length > 0 ? JSON.stringify({ organizationId: { in: scopedOrgIds } }) : 'undefined')
    try {
      companiesResult = await prisma.company.findMany({
        where: scopedOrgIds.length > 0 ? { organizationId: { in: scopedOrgIds } } : undefined,
        orderBy: { createdAt: 'desc' }
      })
      console.log('[DIAG] SUPER companiesResult count:', companiesResult.length)
    } catch (e: any) {
      console.error('[DIAG] SUPER ERROR name=', e?.name, 'msg=', e?.message)
      console.error('[DIAG] stack:', e?.stack)
      return
    }
  } else {
    console.log('[DIAG] path: no-admin. Ignored en este diag.')
  }
  console.log('[DIAG] DONE OK. total companies:', companiesResult.length)
}

main()
  .catch(e => { console.error('[DIAG] FATAL:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())

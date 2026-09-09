import { prisma } from './src/lib/prisma'
import bcrypt from 'bcryptjs'
import { SystemRole, MemberRole } from '@prisma/client'

const ADMIN_EMAIL = 'admin@itcomplements.com'
const ADMIN_NAME = 'Administrador Global ITComplements'
const PASSWORD_PLAIN = 'Admin_Itcomplements_Demo_2026!'
const GRUPO_DEMO_ORG_ID = 'cmnntrppk000502gcp93ketfx'

const TARGET_RFCS = [
  'ODE8604257UA',
  'NMP7502257ZA',
  'QA2414521FJW',
  'QA27383427M8',
  'QA27301176NC',
  'QB2983782QT1',
  'QB26123630CU',
] as const

async function main() {
  console.log('============================================')
  console.log('ONBOARDING SUPERADMIN admin@itcomplements.com')
  console.log('============================================')

  // 1. Validar que Grupo Demo exista y esté onboardingCompleted
  const org = await prisma.organization.findUnique({ where: { id: GRUPO_DEMO_ORG_ID }, select: { id: true, name: true, onboardingCompleted: true } })
  if (!org) { throw new Error('Organization Grupo Demo (cmnntrppk000502gcp93ketfx) NO EXISTE') }
  console.log(`[PASO 0] Org OK: id=${org.id} name=(${org.name}) onboardingCompleted=${org.onboardingCompleted}`)
  if (!org.onboardingCompleted) {
    await prisma.organization.update({ where: { id: org.id }, data: { onboardingCompleted: true, operationalAccessEnabled: true } })
    console.log('  → Org actualizada onboardingCompleted=true')
  }

  // 2. Hashear password
  const saltRounds = 12
  const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, saltRounds)
  console.log(`[PASO 1] Password bcrypt hash: len=${passwordHash.length}`)

  // 3. Upsert User (SUPER_ADMIN systemRole) + Account credentials (para NextAuth Credentials provider)
  const userUpsertResult = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      systemRole: SystemRole.SUPER_ADMIN,
      emailVerified: new Date(),
      onboardingStep: 'COMPLETE',
      password: passwordHash,
      accounts: {
        create: {
          type: 'credentials',
          provider: 'credentials',
          providerAccountId: ADMIN_EMAIL,
          access_token: passwordHash,
        },
      },
    },
    update: {
      name: ADMIN_NAME,
      systemRole: SystemRole.SUPER_ADMIN,
      onboardingStep: 'COMPLETE',
      emailVerified: new Date(),
      password: passwordHash,
    },
    select: { id: true, email: true, name: true, systemRole: true, createdAt: true },
  })
  const userId = userUpsertResult.id
  console.log(`[PASO 2] User upsert OK: id=${userId} email=${userUpsertResult.email} name=(${userUpsertResult.name}) systemRole=${userUpsertResult.systemRole} password=ALMACENADO EN User.password (requerido authorize)`)

  // 3b. Asegurar Account credentials con el password hash (redundante si user existía de antes pero sin Account)
  const existingAccount = await prisma.account.findFirst({ where: { userId, provider: 'credentials' }, select: { id: true } })
  if (!existingAccount) {
    await prisma.account.create({
      data: { userId, type: 'credentials', provider: 'credentials', providerAccountId: ADMIN_EMAIL, access_token: passwordHash },
    })
    console.log('  → Account credentials CREADA (no existía, redundante)')
  } else {
    await prisma.account.update({ where: { id: existingAccount.id }, data: { access_token: passwordHash } })
    console.log('  → Account credentials ACTUALIZADA (redundante, User.password es el campo principal)')
  }

  // 4. Transaction Member APPROVED + Reassign createdBy companies + companyAccess
  const t0 = performance.now()
  const txResult = await prisma.$transaction(async (tx) => {
    // 4a. Upsert Member ADMIN APPROVED en Grupo Demo
    const member = await tx.member.upsert({
      where: { userId_organizationId: { userId, organizationId: GRUPO_DEMO_ORG_ID } },
      create: {
        userId,
        organizationId: GRUPO_DEMO_ORG_ID,
        role: MemberRole.ADMIN,
        status: 'APPROVED',
        approvedAt: new Date(),
        canViewEmission: true,
        canViewReception: true,
        canViewPayroll: true,
        canViewSatPortal: true,
        canViewMassDownloads: true,
        canManageOrg: true,
      },
      update: {
        role: MemberRole.ADMIN,
        status: 'APPROVED',
        approvedAt: new Date(),
        invitationExpiresAt: null,
        invitationTokenHash: null,
        canViewEmission: true,
        canViewReception: true,
        canViewPayroll: true,
        canViewSatPortal: true,
        canViewMassDownloads: true,
        canManageOrg: true,
      },
      select: { id: true, role: true, status: true, organizationId: true, createdAt: true },
    })
    console.log(`[PASO 3 Tx] Member ADMIN APPROVED: id=${member.id} orgId=${member.organizationId} role=${member.role} status=${member.status}`)

    // 4b. REASIGNAR createdBy = userId de las 7 empresas TARGET_RFCS APPROVED
    const empresasAntes = await tx.company.findMany({
      where: { rfc: { in: [...TARGET_RFCS] }, status: 'APPROVED' },
      select: { id: true, rfc: true, name: true, createdBy: true },
    })
    console.log(`[PASO 4 Tx] Empresas target APPROVED a reasignar: ${empresasAntes.length}`)
    for (const e of empresasAntes) {
      console.log(`    Antes: RFC ${e.rfc} createdBy=${e.createdBy}  →  NUEVO createdBy=${userId}`)
    }
    const reassignResult = await tx.company.updateMany({
      where: { rfc: { in: [...TARGET_RFCS] }, status: 'APPROVED' },
      data: { createdBy: userId },
    })
    console.log(`  → updateMany reassign createdBy: count=${reassignResult.count}`)

    // 4c. Asegurar companyAccess rows (redundante pero garantiza acceso por la Fuente1 route handler)
    for (const e of empresasAntes) {
      await tx.companyAccess.upsert({
        where: { memberId_companyId: { memberId: member.id, companyId: e.id } },
        create: {
          memberId: member.id,
          companyId: e.id,
          organizationId: GRUPO_DEMO_ORG_ID,
          role: MemberRole.ADMIN,
        },
        update: { role: MemberRole.ADMIN },
      })
    }
    console.log(`  → companyAccess upsert OK para ${empresasAntes.length} empresas`)

    return { memberId: member.id, empresasReasignadas: empresasAntes.length, empresasTarget: empresasAntes }
  }, { timeout: 30000 })
  const t1 = performance.now()
  console.log(`\n[TRANSACTION OK] duración=${Math.round(t1 - t0)}ms`)
  console.log(`  memberId = ${txResult.memberId}`)
  console.log(`  empresas reasignadas = ${txResult.empresasReasignadas}`)

  // 5. Validar POST-ONBOARDING: route handler replica para el nuevo userId
  console.log('\n============================================')
  console.log('VALIDACIÓN POST-ONBOARDING (diag nuevo usuario)')
  console.log('============================================')
  const allowedOrgIds = [GRUPO_DEMO_ORG_ID]
  const allMembershipsPost = await prisma.member.findMany({
    where: { userId, status: 'APPROVED', organizationId: { in: allowedOrgIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, role: true, organizationId: true, status: true },
  })
  console.log('  allMemberships.length =', allMembershipsPost.length)
  if (allMembershipsPost.length === 0) {
    console.log('  ❌ ERROR: Sin memberships → route handler retorna empty')
    await prisma.$disconnect(); process.exit(1)
  }
  const memberIdsPost = allMembershipsPost.map(m => m.id)
  console.log('  memberIds =', memberIdsPost)

  const accessRows = await prisma.companyAccess.findMany({
    where: { memberId: { in: memberIdsPost } },
    take: 500,
    include: { company: { select: { id: true, rfc: true, businessName: true, name: true, status: true } } },
  })
  console.log('  FUENTE1 companyAccess rows =', accessRows.length)
  const map = new Map<string, { id: string; rfc: string | null; businessName: string; createdByOk: boolean }>()
  for (const row of accessRows) {
    if (!row.company || row.company.status !== 'APPROVED') continue
    map.set(row.company.id, { id: row.company.id, rfc: row.company.rfc, businessName: row.company.businessName || row.company.name || '', createdByOk: false })
  }
  const creadasPorUser = await prisma.company.findMany({ where: { createdBy: userId, status: 'APPROVED' }, select: { id: true, rfc: true, businessName: true, name: true } })
  console.log('  FUENTE2 createdBy empresas count =', creadasPorUser.length)
  for (const c of creadasPorUser) {
    if (map.has(c.id)) { map.get(c.id)!.createdByOk = true; continue }
    map.set(c.id, { id: c.id, rfc: c.rfc, businessName: c.businessName || c.name || '', createdByOk: true })
  }
  const finalCompanies = Array.from(map.values())
  console.log('\n  ✅ FINAL companies list nuevo usuario: count =', finalCompanies.length)
  for (const c of finalCompanies) {
    const isTarget = TARGET_RFCS.includes((c.rfc || '') as any) ? '🎯' : '  '
    console.log(`    ${isTarget} RFC=${c.rfc} businessName=(${c.businessName}) createdByOk=${c.createdByOk}  id=${c.id}`)
  }
  const countTargetsIn = TARGET_RFCS.filter((rfc) => finalCompanies.some((c) => c.rfc === rfc)).length
  console.log(`\n  Target RFCS en listado = ${countTargetsIn}/${TARGET_RFCS.length}`)
  if (countTargetsIn === TARGET_RFCS.length) {
    console.log('  ✅ 7/7 EMPRESAS TARGET PRESENTES EN EL NUEVO USUARIO')
  } else {
    console.log('  ❌ FALTAN empresas target en el listado!!!')
  }
  console.log('\n============================================')
  console.log('CREDENCIALES admin@itcomplements.com')
  console.log('============================================')
  console.log('  Email    : admin@itcomplements.com')
  console.log('  Password :', PASSWORD_PLAIN)
  console.log('  Rol App  : SUPER_ADMIN (systemRole)')
  console.log('  Rol Org  : ADMIN (Grupo Demo)')
  console.log('  Método   : Credentials Provider (NextAuth)')
  console.log('')
  await prisma.$disconnect()
}

void main().catch(async (e) => { console.error('\n❌ FATAL ONBOARDING:', e); try { await prisma.$disconnect() } catch {} process.exit(1) })

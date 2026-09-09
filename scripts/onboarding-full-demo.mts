import { PrismaClient, SystemRole, MemberRole, CompanyStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const GRUPO_DEMO_ORG_ID = 'cmnntrppk000502gcp93ketfx'

const TARGET_RFCS: {
  rfc: string
  name: string
  businessName: string
  taxRegime: string
  postalCode: string
  legalRep: string
  email: string
}[] = [
  { rfc: 'ODE8604257UA', name: 'Grupo ODE DEMO',        businessName: 'ODE OPERACIONES SA DE CV',             taxRegime: '601', postalCode: '06600', legalRep: 'Rodrigo Diaz Ochoa',          email: 'finanzas@ode-demo.mx' },
  { rfc: 'NMP7502257ZA', name: 'NMP Servicios',         businessName: 'NOMBREMPRESA SA DE CV',                taxRegime: '601', postalCode: '44100', legalRep: 'María Pérez Núñez',            email: 'admin@nmp-servicios.mx' },
  { rfc: 'QA2414521FJW',name: 'QA Industrial 24',       businessName: 'QA INDUSTRIAL 24 SA DE CV',            taxRegime: '601', postalCode: '64000', legalRep: 'Juan Carlos Fernández',       email: 'operaciones@qa24.mx' },
  { rfc: 'QA27383427M8',name: 'QA Logistics 342',       businessName: 'QA LOGISTICS 342 SA DE CV',            taxRegime: '601', postalCode: '77000', legalRep: 'Ana Laura Mendoza',            email: 'trafico@qa342.mx' },
  { rfc: 'QA27301176NC',name: 'QA Retail 301',          businessName: 'QA RETAIL 301 SAPI DE CV',             taxRegime: '601', postalCode: '03100', legalRep: 'Luis Felipe Ramírez',          email: 'tiendas@qa301.mx' },
  { rfc: 'QB2983782QT1',name: 'QB Construcción 83',     businessName: 'QB CONSTRUCCIONES 83 SA DE CV',        taxRegime: '601', postalCode: '37000', legalRep: 'Roberto Hernández Gómez',     email: 'obras@qb83.mx' },
  { rfc: 'QB26123630CU',name: 'QB Tecnología 360',      businessName: 'QB TECH 360 SAPI DE CV',               taxRegime: '601', postalCode: '45000', legalRep: 'Patricia Sánchez Villalobos',  email: 'hola@qbtech360.mx' },
] as const

const USERS_TO_CREATE: {
  email: string
  name: string
  systemRole: SystemRole
  memberRole: MemberRole
  passwordPlain: string
  superAdmin?: boolean
}[] = [
  { email: 'admin@itcomplements.com',        name: 'Administrador Global ITComplements', systemRole: SystemRole.SUPER_ADMIN, memberRole: MemberRole.ADMIN,  passwordPlain: 'Admin_Itcomplements_Demo_2026!', superAdmin: true },
  { email: 'rtorreh@itcomplements.com',      name: 'Rodrigo Torre Huerta',               systemRole: SystemRole.USER,        memberRole: MemberRole.ADMIN,  passwordPlain: 'Rodrigo_Torre_2026!' },
] as const

const BCRYPT_ROUNDS = 12

async function main() {
  console.log('============================================')
  console.log('ONBOARDING FULL DEMO · Org + 7 empresas + 2 usuarios')
  console.log('============================================\n')

  // 1. CREAR ORGANIZACIÓN GRUPO DEMO
  const org = await prisma.organization.upsert({
    where: { id: GRUPO_DEMO_ORG_ID },
    create: {
      id: GRUPO_DEMO_ORG_ID,
      name: 'Grupo Demo ITComplements',
      slug: 'grupo-demo-itcomplements',
      onboardingCompleted: true,
      operationalAccessEnabled: true,
      address: 'Av. Paseo de la Reforma 505 Piso 12',
      city: 'Ciudad de México',
      state: 'CDMX',
      postalCode: '06600',
      country: 'México',
      contactEmail: 'admin@grupo-demo-demo.mx',
      businessDescription: 'Grupo empresarial demo para pruebas del tablero de nómina 1.2 y fiscal.',
      industry: 'Servicios Profesionales',
      companySize: '51-200',
      foundedYear: 2020,
      taxId: 'GDI200101ABC',
      businessType: 'Sociedad Anónima de Capital Variable',
    },
    update: {
      onboardingCompleted: true,
      operationalAccessEnabled: true,
    },
    select: { id: true, name: true, slug: true, onboardingCompleted: true },
  })
  console.log(`[PASO 1] ORG: id=${org.id}  name=(${org.name})  onboardingCompleted=${org.onboardingCompleted}\n`)

  const orgId = org.id
  const placeholders = [
    'placeholder-admin-user-2026-01-01',
    'placeholder-rtorreh-user-2026-01-02',
  ]

  // 2. CREAR EMPRESAS (primero con createdBy placeholder; reasignamos después de crear users)
  const approvedAt = new Date()
  for (const target of TARGET_RFCS) {
    const updatedBy = placeholders[0]
    const createdBy = placeholders[0]
    const existing = await prisma.company.findUnique({ where: { rfc: target.rfc }, select: { id: true } })
    if (!existing) {
      const company = await prisma.company.create({
        data: {
          name: target.name,
          rfc: target.rfc,
          businessName: target.businessName,
          legalRepresentative: target.legalRep,
          taxRegime: target.taxRegime,
          postalCode: target.postalCode,
          address: target.email ? `Contacto: ${target.email}` : null,
          city: 'CDMX',
          state: 'CDMX',
          country: 'México',
          email: target.email,
          employeesCount: 50,
          status: CompanyStatus.APPROVED,
          approvedAt,
          approvedBy: placeholders[0],
          createdBy,
          updatedBy,
        },
        select: { id: true, rfc: true, name: true },
      })
      console.log(`  ✅ EMPRESA CREADA: RFC ${company.rfc}  name=(${company.name})  id=${company.id}`)
    } else {
      console.log(`  ℹ️  EMPRESA EXISTE SKIP: RFC ${target.rfc}`)
    }
  }

  const all7 = await prisma.company.findMany({ where: { rfc: { in: TARGET_RFCS.map(r => r.rfc) } }, select: { id: true, rfc: true, name: true } })
  console.log(`\n[PASO 2] Total empresas target creadas: ${all7.length}/${TARGET_RFCS.length}\n`)

  // 3. CREAR FISCAL ENTITIES por cada empresa target (relacionado a la org; NO hay FK company-fiscalEntity; se ligan por RFC en el pipeline de importación)
  for (const target of TARGET_RFCS) {
    const exists = await prisma.fiscalEntity.findUnique({ where: { rfc: target.rfc }, select: { id: true } })
    if (exists) { console.log(`  ℹ️  FISCAL ENTITY EXISTE: RFC ${target.rfc}`); continue }
    const fe = await prisma.fiscalEntity.create({
      data: {
        organizationId: orgId,
        rfc: target.rfc,
        businessName: target.businessName,
        taxRegime: target.taxRegime,
        postalCode: target.postalCode,
        isActive: true,
      },
      select: { id: true, rfc: true, businessName: true },
    })
    console.log(`  ✅ FISCAL ENTITY CREADA: RFC ${fe.rfc}  name=(${fe.businessName})`)
  }
  console.log(`[PASO 3] 7/7 FISCAL ENTITIES listos.\n`)

  // 4. CREAR USUARIOS (admin SUPER_ADMIN · rtorreh MEMBER/ADMIN)
  const createdUserIds: Record<string, string> = {}
  for (const u of USERS_TO_CREATE) {
    const passwordHash = await bcrypt.hash(u.passwordPlain, BCRYPT_ROUNDS)
    const upserted = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        name: u.name,
        systemRole: u.systemRole,
        emailVerified: new Date(),
        onboardingStep: 'COMPLETE',
        password: passwordHash,
        accounts: {
          create: {
            type: 'credentials',
            provider: 'credentials',
            providerAccountId: u.email,
            access_token: passwordHash,
          },
        },
      },
      update: {
        name: u.name,
        systemRole: u.systemRole,
        emailVerified: new Date(),
        onboardingStep: 'COMPLETE',
        password: passwordHash,
      },
      select: { id: true, email: true, name: true, systemRole: true },
    })
    createdUserIds[u.email] = upserted.id
    const account = await prisma.account.findFirst({ where: { userId: upserted.id, provider: 'credentials' }, select: { id: true } })
    if (!account) {
      await prisma.account.create({ data: { userId: upserted.id, type: 'credentials', provider: 'credentials', providerAccountId: u.email, access_token: passwordHash } })
    } else {
      await prisma.account.update({ where: { id: account.id }, data: { access_token: passwordHash } })
    }
    console.log(`  ✅ USER UPSERT: email=${upserted.email}  id=${upserted.id}  systemRole=${upserted.systemRole}`)
  }
  console.log(`[PASO 4] 2/2 Usuarios creados/haseheados.\n`)

  // 5. REASIGNAR createdBy / approvedBy companies a admin@itcomplements.com userId
  const adminUserId = createdUserIds['admin@itcomplements.com']
  const rtorrehUserId = createdUserIds['rtorreh@itcomplements.com']
  if (adminUserId) {
    await prisma.company.updateMany({
      where: { rfc: { in: TARGET_RFCS.map(r => r.rfc) }, status: CompanyStatus.APPROVED },
      data: { createdBy: adminUserId, updatedBy: adminUserId, approvedBy: adminUserId, approvedAt },
    })
    console.log(`[PASO 5] Reassigned createdBy/approvedBy → admin id=${adminUserId} for ${all7.length} companies.\n`)
  }

  // 6. MEMBERSHIPS (ADMIN role) + companyAccess (ADMIN or VIEWER según user) para LOS 2 users
  for (const u of USERS_TO_CREATE) {
    const userId = createdUserIds[u.email]
    if (!userId) continue
    const member = await prisma.member.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: {
        userId,
        organizationId: orgId,
        role: u.memberRole,
        status: 'APPROVED',
        approvedAt,
        canViewEmission: true,
        canViewReception: true,
        canViewPayroll: true,
        canViewSatPortal: true,
        canViewMassDownloads: true,
        canManageOrg: u.superAdmin ?? false,
      },
      update: {
        role: u.memberRole,
        status: 'APPROVED',
        approvedAt,
        invitationExpiresAt: null,
        invitationTokenHash: null,
        canViewEmission: true,
        canViewReception: true,
        canViewPayroll: true,
        canViewSatPortal: true,
        canViewMassDownloads: true,
        canManageOrg: u.superAdmin ?? false,
      },
      select: { id: true, role: true, status: true },
    })
    console.log(`  ✅ MEMBER ${u.email}: id=${member.id}  role=${member.role}  status=${member.status}`)
    // companyAccess
    for (const c of all7) {
      await prisma.companyAccess.upsert({
        where: { memberId_companyId: { memberId: member.id, companyId: c.id } },
        create: { memberId: member.id, companyId: c.id, organizationId: orgId, role: u.memberRole },
        update: { role: u.memberRole },
      })
    }
    console.log(`       → companyAccess rows creadas: ${all7.length} empresas\n`)
  }
  console.log(`[PASO 6] 2/2 Memberships + companyAccess listos.\n`)

  // 7. VALIDACIÓN FINAL
  const usersCount = await prisma.user.count()
  const companiesApproved = await prisma.company.count({ where: { status: CompanyStatus.APPROVED, rfc: { in: TARGET_RFCS.map(r => r.rfc) } } })
  const feCount = await prisma.fiscalEntity.count({ where: { rfc: { in: TARGET_RFCS.map(r => r.rfc) } } })
  const membersApproved = await prisma.member.count({ where: { status: 'APPROVED', organizationId: orgId } })
  const membershipRtorreh = await prisma.member.findFirst({ where: { userId: rtorrehUserId, status: 'APPROVED' }, select: { id: true, role: true } })

  console.log('============================================')
  console.log('VALIDACIÓN FINAL POST-ONBOARDING')
  console.log('============================================')
  console.log(`  users total                = ${usersCount}  (esperado 2)`)
  console.log(`  companies APPROVED (target)= ${companiesApproved}/${TARGET_RFCS.length}`)
  console.log(`  fiscalEntities target      = ${feCount}/${TARGET_RFCS.length}`)
  console.log(`  members APPROVED en org    = ${membersApproved}  (esperado 2)`)
  console.log(`  rtorreh APPROVED member    = ${!!membershipRtorreh}  (id=${membershipRtorreh?.id ?? 'n/a'} role=${membershipRtorreh?.role ?? 'n/a'})`)
  console.log('\n============================================')
  console.log('CREDENCIALES DEMO')
  console.log('============================================')
  for (const u of USERS_TO_CREATE) {
    console.log(`  Email   : ${u.email}`)
    console.log(`  Password: ${u.passwordPlain}`)
    console.log(`  Perfil  : systemRole=${u.systemRole}  orgMemberRole=${u.memberRole}`)
    console.log('')
  }
}

void main()
  .catch(async (e) => { console.error('\n❌ FATAL:', e); try { await prisma.$disconnect() } catch {} process.exit(1) })
  .finally(async () => { try { await prisma.$disconnect() } catch {} })

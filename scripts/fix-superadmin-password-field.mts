import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = 'admin@itcomplements.com'
const PASSWORD_PLAIN = 'Admin_Itcomplements_Demo_2026!'
const ROUNDS = 12

async function main() {
  console.log('============================================')
  console.log('FIX: Mover password bcrypt de Account.access_token → User.password')
  console.log('porque auth.ts Credentials authorize lee user.password, no Account.')
  console.log('============================================')

  const user = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: {
      id: true, email: true, systemRole: true, password: true,
      accounts: { where: { provider: 'credentials' }, select: { id: true, access_token: true } },
    },
  })
  if (!user) {
    console.error('❌ No existe el usuario', ADMIN_EMAIL)
    await prisma.$disconnect()
    process.exit(1)
  }

  console.log('\n[DIAG ANTES]')
  console.log('  userId =', user.id)
  console.log('  user.password =', user.password ? `(len=${user.password.length} empieza $2? ${user.password.startsWith('$2')})` : '⚠️  NULL / EMPTY (ESPERADO: ÉSTE ES EL BUG)')
  const credAccount = user.accounts[0]
  console.log('  credentialsAccount exists =', !!credAccount)
  console.log('  Account.access_token =', credAccount?.access_token ? `(len=${credAccount.access_token.length})` : 'n/a')

  // 1. Generar el hash bcrypt correcto (igual que auth.ts PASSWORD_BCRYPT_ROUNDS)
  console.log('\n[PASO 1] Generando bcrypt hash rounds=' + ROUNDS + ' ...')
  const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, ROUNDS)
  console.log('  hash generado len =', passwordHash.length)
  const compareInstant = await bcrypt.compare(PASSWORD_PLAIN, passwordHash)
  console.log('  bcrypt.compare inmediato OK =', compareInstant)
  if (!compareInstant) { throw new Error('bcrypt.compare self-test FAILED') }

  // 2. Actualizar User.password (EL CAMPO QUE USA authorize)
  console.log('\n[PASO 2] prisma.user.update password = hash bcrypt')
  const upUser = await prisma.user.update({
    where: { id: user.id },
    data: { password: passwordHash },
    select: { id: true, password: true },
  })
  console.log('  user update OK. password len =', upUser.password?.length)

  // 3. Dejar redundante también Account.access_token = same hash (no hace daño, backwards compat si alguien lo usa)
  if (credAccount) {
    await prisma.account.update({
      where: { id: credAccount.id },
      data: { access_token: passwordHash },
    })
    console.log('  credentials Account.access_token sincronizado (redundante).')
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: ADMIN_EMAIL,
        access_token: passwordHash,
      },
    })
    console.log('  credentials Account creada (no existía).')
  }

  // 4. Validación POST-FIX: leer user.password y bcrypt.compare
  console.log('\n[VALIDACIÓN POST-FIX]')
  const userPost = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true, password: true, systemRole: true } })
  if (!userPost?.password) { throw new Error('POST FIX: user.password Sigue NULL!!') }
  const cmp = await bcrypt.compare(PASSWORD_PLAIN, userPost.password)
  console.log('  bcrypt.compare("' + PASSWORD_PLAIN.slice(0, 8) + '...", user.password) =', cmp ? '✅ TRUE (OK)' : '❌ FALSE (FAIL)')
  if (!cmp) { throw new Error('POST FIX bcrypt.compare false') }

  // 5. Invocar EXACTAMENTE la misma lógica que auth.ts authorize L110-L173 para confirmar retorna User object OK
  console.log('\n[SIMULACIÓN auth.ts authorize CredentialsProvider L110-L173]')
  const normalizedEmail = ADMIN_EMAIL.toLowerCase().trim()
  const simUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, name: true, image: true, systemRole: true, password: true, onboardingStep: true, onboardingData: true, emailVerified: true },
  })
  if (!simUser || !simUser.password) {
    console.log('  ❌ FAIL !user || !user.password')
    process.exit(1)
  }
  const simPwdOk = await bcrypt.compare(PASSWORD_PLAIN, simUser.password)
  if (!simPwdOk) { console.log('  ❌ FAIL bcrypt.compare invalid password'); process.exit(1) }
  if (simUser.systemRole !== 'SUPER_ADMIN') {
    const approved = await prisma.member.findFirst({ where: { userId: simUser.id, status: 'APPROVED' } })
    if (!approved) { console.log('  ❌ FAIL membership APPROVED missing'); process.exit(1) }
  }
  const returnedUserObj = {
    id: simUser.id,
    email: simUser.email ?? undefined,
    name: simUser.name ?? undefined,
    image: simUser.image ?? undefined,
    systemRole: simUser.systemRole,
    onboardingStep: simUser.onboardingStep ?? undefined,
    onboardingData: simUser.onboardingData ?? undefined,
  }
  console.log('  ✅ SIM authorize PASSED. Returned object:')
  console.log('     id =', returnedUserObj.id)
  console.log('     email =', returnedUserObj.email)
  console.log('     systemRole =', returnedUserObj.systemRole)
  console.log('     name =', returnedUserObj.name)

  console.log('\n============================================')
  console.log('✅ FIX COMPLETO: Usuario admin@itcomplements.com YA PUEDE INICIAR SESIÓN')
  console.log('============================================\n')

  await prisma.$disconnect()
}

void main().catch(async (e) => { console.error('\n❌ FATAL', e); try { await prisma.$disconnect() } catch {}; process.exit(1) })

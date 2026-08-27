import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = 'rtorreh@itcomplements.com'
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, systemRole: true }
  })
  if (!user) { console.log('USUARIO NO ENCONTRADO'); return }
  console.log('\n================== USER ==================')
  console.log('  id:', user.id)
  console.log('  email:', user.email, ' systemRole:', user.systemRole)

  const memberships = await prisma.member.findMany({
    where: { userId: user.id },
    include: {
      organization: { select: { id: true, name: true, ownerId: true } }
    },
    orderBy: [{ createdAt: 'asc' }]
  })
  console.log('\n================== MEMBERSHIPS (findMany ordenadas) ==================')
  let isOwnerAnywhere = false
  for (const m of memberships) {
    const isOwner = m.organization?.ownerId === user.id
    if (isOwner) isOwnerAnywhere = true
    console.log(`  mem.id=${m.id}  role=${m.role}  status=${m.status}  orgId=${m.organizationId}  org=${m.organization?.name ?? '?'}  ownerId=${m.organization?.ownerId}  IS_OWNER=${isOwner}`)
  }
  console.log('\n================== ¿ES OWNER EN ALGUNA ORG? ==================')
  console.log('  isOwnerAnywhere =', isOwnerAnywhere)

  console.log('\n================== ¿QUÉ DEVUELVE findFirst() TAL CUAL COMO EN tenant/update-progress route.ts L26-29? ==================')
  const firstMatch = await prisma.member.findFirst({
    where: { userId: user.id, status: 'APPROVED' },
    include: { organization: { select: { id: true, name: true, ownerId: true } } }
  })
  if (firstMatch) {
    const isOwner = firstMatch.organization?.ownerId === user.id
    console.log(`  FIRST match mem.id=${firstMatch.id} role=${firstMatch.role} orgId=${firstMatch.organizationId} org=${firstMatch.organization?.name} ownerId=${firstMatch.organization?.ownerId} IS_OWNER_CHECK_PASS=${isOwner}`)
    console.log(`  ¿Por qué API-10.8 respondió 200?  Porque findFirst matcheó la membership de la org donde SÍ es owner (o findFirst sin orderBy elige la correcta por AZAR).`)
    console.log(`  CHECK ownerId === session.user.id (L35): ${firstMatch.organization?.ownerId} === ${user.id}  => ${isOwner}`)
  }
}

main().finally(() => prisma.$disconnect())

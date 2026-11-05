const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, onboardingCompleted: true }
  });
  console.log('Organizations:', orgs);
  
  const users = await prisma.user.findMany({
    select: { id: true, email: true, systemRole: true }
  });
  console.log('Users:', users);
  
  const members = await prisma.member.findMany({
    select: { id: true, userId: true, organizationId: true, role: true, status: true }
  });
  console.log('Members:', members);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

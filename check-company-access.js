const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'cmw2pgq4000102q30cbb1fv6u'; // rtorreh@gmail.com
  
  const memberships = await prisma.member.findMany({
    where: { userId, status: 'APPROVED' },
    select: { id: true, role: true, organizationId: true }
  });
  console.log('Memberships:', memberships);
  
  const companyAccess = await prisma.companyAccess.findMany({
    where: { memberId: { in: memberships.map(m => m.id) } }
  });
  console.log('Company Access:', companyAccess);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

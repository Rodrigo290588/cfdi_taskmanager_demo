const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst({
    include: { 
      members: {
        where: { status: 'APPROVED' }
      }
    }
  });
  const memberUserIds = org.members.map(m => m.userId);
  const totalCompanies = await prisma.company.count({
    where: {
      createdBy: { in: memberUserIds }
    }
  });
  console.log('Total Companies for APPROVED org members:', totalCompanies);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

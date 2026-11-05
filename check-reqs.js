const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst({
    select: { id: true, name: true, setupRequirements: true, operationalAccessEnabled: true }
  });
  console.log('Org setupRequirements:', org.setupRequirements);
  console.log('Org operationalAccessEnabled:', org.operationalAccessEnabled);
  
  const totalCompanies = await prisma.company.count();
  console.log('Total Companies:', totalCompanies);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

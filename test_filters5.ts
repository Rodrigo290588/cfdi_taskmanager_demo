import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const r = await prisma.payrollReceipt.count();
  const companies = await prisma.payrollReceipt.groupBy({
    by: ['companyId'],
    _count: true
  });
  console.log("Total receipts:", r);
  console.log("By company:", companies);
}
main().finally(() => prisma.$disconnect());

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.payrollReceipt.count();
  const sample = await prisma.payrollReceipt.findFirst({ select: { companyId: true } });
  console.log(JSON.stringify({ count, sample }));
}
main().finally(() => prisma.$disconnect());

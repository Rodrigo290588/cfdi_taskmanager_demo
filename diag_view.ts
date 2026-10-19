import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.$queryRawUnsafe('SELECT * FROM mv_hr_plantilla_actual');
  console.log(rows);
}
main().catch(console.error).finally(() => prisma.$disconnect());

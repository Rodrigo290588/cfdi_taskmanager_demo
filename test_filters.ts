import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const kpis = await prisma.$queryRawUnsafe('SELECT mes_pago, tipo_nomina, periodicidad_pago FROM mv_hr_headcount_costo_kpis;');
  console.log(kpis);
}
main().finally(() => prisma.$disconnect());

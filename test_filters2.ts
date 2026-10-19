import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const fragments = [];
  fragments.push(Prisma.sql`mes_pago >= '2026-01-01'::date`);
  fragments.push(Prisma.sql`mes_pago <= '2026-01-06'::date`);
  fragments.push(Prisma.sql`tipo_nomina = 'O'`);
  fragments.push(Prisma.sql`periodicidad_pago = '05'`);
  
  const where = Prisma.join(fragments, ' AND ');
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM mv_hr_headcount_costo_kpis
    WHERE ${where}
  `;
  console.log(rows);
}
main().finally(() => prisma.$disconnect());
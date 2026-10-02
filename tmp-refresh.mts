
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_direccion_costo_ejecutivo_mensual;');
  console.log('MV REFRESHED');
}
main().finally(() => prisma.$disconnect());

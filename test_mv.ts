import { prisma } from './src/lib/prisma';

async function main() {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM mv_direccion_costo_ejecutivo_mensual`);
  console.log('Filas en mv_direccion_costo_ejecutivo_mensual:', rows.length);
  console.dir(rows, { depth: null });
}
main().catch(console.error).finally(() => prisma.$disconnect());
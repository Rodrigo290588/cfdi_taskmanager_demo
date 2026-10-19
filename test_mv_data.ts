import { prisma } from './src/lib/prisma'; prisma.$queryRawUnsafe('SELECT * FROM mv_fiscal_conciliacion_mensual').then(console.log).finally(() => prisma.$disconnect());

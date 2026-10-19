import { prisma } from './src/lib/prisma'; prisma.$queryRawUnsafe('SELECT count(*) FROM mv_fiscal_conciliacion_mensual').then(console.log).finally(() => prisma.$disconnect());

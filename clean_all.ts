import { PrismaClient } from '@prisma/client'; 
const p = new PrismaClient(); 
async function main() { 
  await p.$executeRaw`DELETE FROM import_run_items WHERE file_name LIKE 'NOMINA_INCAPACIDAD%'`;
  await p.invoice.deleteMany({ where: { issuerRfc: 'NMP7502257ZA', issuanceDate: { gte: new Date('2026-01-01') } } }); 
  console.log('Cleaned import_run_items and invoices.'); 
} 
main().finally(() => p.$disconnect());
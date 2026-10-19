import { PrismaClient } from '@prisma/client'; 
const p = new PrismaClient(); 
async function main() { 
  console.log('Invoices NMP:', await p.invoice.count({ where: { issuerRfc: 'NMP7502257ZA', issuanceDate: { gte: new Date('2026-01-01') } } })); 
  console.log('Incapacidades total:', await p.payrollIncapacidad.count()); 
  console.log('MV Incapacidades:', await p.$queryRaw`SELECT COUNT(*) FROM mv_hr_incapacidades_acumulado`); 
  
  // check import run items
  const failedImports = await p.$queryRaw`SELECT * FROM import_run_items WHERE status = 'SKIPPED' ORDER BY created_at DESC LIMIT 5`;
  console.log('Skipped imports:', failedImports);
} 
main().finally(() => p.$disconnect());
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const invs = await p.invoice.findMany({
    where: { issuerRfc: 'NMP7502257ZA', issuanceDate: { gte: new Date('2026-01-01') } }
  });
  console.log('Found invoices to delete:', invs.map(i => i.uuid));
  await p.invoice.deleteMany({
    where: { id: { in: invs.map(i => i.id) } }
  });
  console.log('Deleted invoices.');
}
main().finally(() => p.$disconnect());
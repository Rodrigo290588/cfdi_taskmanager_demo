import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const receipts = await prisma.payrollReceipt.findMany({
    where: { invoice: { fiscalEntity: { rfc: 'NMP7502257ZA' } } },
    include: { receptor: true }
  });
  console.log(JSON.stringify(receipts.map(r => ({
    id: r.id,
    tipoContrato: r.receptor?.tipoContrato,
    tipoJornada: r.receptor?.tipoJornada
  })), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());

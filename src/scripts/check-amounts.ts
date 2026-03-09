
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const invoices = await prisma.invoice.findMany({
    take: 5,
    select: {
      uuid: true,
      total: true,
      ivaTransferred: true
    }
  })
  console.log('Invoices sample:', invoices)

  const cfdis = await prisma.cfdi.findMany({
    take: 5,
    select: {
      uuid: true,
      montoTotal: true,
      impuestos: true
    }
  })
  console.log('Cfdis sample:', cfdis)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const paymentUuid = '409EF8AA-B259-434E-A2A1-8B811E450947'

  const payment = await prisma.invoice.findFirst({ 
    where: { 
      uuid: {
        equals: paymentUuid,
        mode: 'insensitive'
      }
    } 
  })
  console.log('Payment Invoice (case insensitive):', payment ? 'Found' : 'Not found')
}
main().catch(console.error).finally(() => prisma.$disconnect())
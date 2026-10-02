import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const paymentUuid = '409EF8AA-B259-434E-A2A1-8B811E450947'
  
  const tables = [
    'externalCfdiImportItem',
    'providerUploadedCfdi',
    'invoice',
    'importRunItem'
  ]

  for (const table of tables) {
    try {
      const delegate = (prisma as Record<string, { deleteMany: (args: { where: { uuid: string } }) => Promise<{ count: number }> }>)[table]
      if (delegate) {
         // Some tables might have uuid, some might have other fields
         const deleted = await delegate.deleteMany({
           where: { uuid: paymentUuid }
         })
         console.log(`${table} deleted:`, deleted.count)
      }
    } catch {
      // console.log(`Error checking ${table}`)
    }
  }

  // Also check if there's any pending job or something by raw query
  const res = await prisma.$executeRaw`DELETE FROM provider_uploaded_cfdis WHERE uuid = ${paymentUuid} OR uuid = ${paymentUuid.toLowerCase()};`
  console.log('Raw SQL provider_uploaded_cfdis deleted:', res)

}

main().catch(console.error).finally(() => prisma.$disconnect())

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Cleaning MassDownloadRequest table...')
  const result = await prisma.massDownloadRequest.deleteMany({})
  console.log(`Deleted ${result.count} requests.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

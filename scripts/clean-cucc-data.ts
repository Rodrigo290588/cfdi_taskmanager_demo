import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const TARGET_RFC = 'CUCC4512065I7'

async function main() {
  console.log(`Buscando registros para RFC: ${TARGET_RFC}...`)

  const targetEntity = await prisma.fiscalEntity.findUnique({
    where: { rfc: TARGET_RFC },
  })

  if (!targetEntity) {
    console.log(`No se encontró la entidad fiscal con RFC ${TARGET_RFC}.`)
    // Aún así intentamos borrar por RFC en tablas que lo permitan directamente si es necesario,
    // pero SatInvoice requiere fiscalEntityId o búsqueda por RFC en campos texto.
    // Intentaremos borrar Invoices por RFC directo.
    
    const deletedInvoicesNoEntity = await prisma.invoice.deleteMany({
        where: {
            OR: [
                { issuerRfc: TARGET_RFC },
                { receiverRfc: TARGET_RFC }
            ]
        }
    })
    console.log(`Eliminados ${deletedInvoicesNoEntity.count} registros de Invoice (búsqueda por RFC).`)
    
    const deletedSatNoEntity = await prisma.satInvoice.deleteMany({
        where: {
            OR: [
                { issuerRfc: TARGET_RFC },
                { receiverRfc: TARGET_RFC }
            ]
        }
    })
    console.log(`Eliminados ${deletedSatNoEntity.count} registros de SatInvoice (búsqueda por RFC).`)
    
    return
  }

  console.log(`Entidad encontrada: ${targetEntity.businessName} (${targetEntity.id})`)

  // 1. Borrar SatInvoices
  // En el seed, todas las SatInvoices se crean con fiscalEntityId = targetEntity.id
  // También borramos por RFC por si acaso hay huérfanos
  const deletedSat = await prisma.satInvoice.deleteMany({
    where: {
      OR: [
        { fiscalEntityId: targetEntity.id },
        { issuerRfc: TARGET_RFC },
        { receiverRfc: TARGET_RFC }
      ]
    }
  })
  console.log(`Eliminados ${deletedSat.count} registros de SatInvoice.`)

  // 2. Borrar Invoices
  // Emitidas: issuerFiscalEntityId = targetEntity.id
  // Recibidas: receiverRfc = TARGET_RFC
  const deletedInvoices = await prisma.invoice.deleteMany({
    where: {
      OR: [
        { issuerFiscalEntityId: targetEntity.id },
        { receiverRfc: TARGET_RFC },
        { issuerRfc: TARGET_RFC }
      ]
    }
  })
  console.log(`Eliminados ${deletedInvoices.count} registros de Invoice.`)

  // 3. Borrar Solicitudes de Descarga Masiva
  const deletedRequests = await prisma.massDownloadRequest.deleteMany({
      where: {
          OR: [
              { requestingRfc: TARGET_RFC },
              { issuerRfc: TARGET_RFC },
              { receiverRfc: TARGET_RFC }
          ]
      }
  })
  console.log(`Eliminados ${deletedRequests.count} solicitudes de descarga masiva.`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

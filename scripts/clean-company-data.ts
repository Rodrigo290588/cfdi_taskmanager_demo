import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rfc = 'CUCC4512065I7'
  console.log(`Buscando entidad fiscal con RFC: ${rfc}...`)

  const fiscalEntity = await prisma.fiscalEntity.findUnique({
    where: { rfc },
  })

  if (!fiscalEntity) {
    console.log(`No se encontró ninguna entidad fiscal con el RFC ${rfc}`)
    
    // Intentar borrar por RFC directo en las tablas por si acaso quedaron huérfanos o son de otra lógica
    // Pero la solicitud dice "vinculados con la empresa... seleccionada", así que la entidad debería existir.
    // Si no existe, tal vez solo hay datos con ese RFC sin entidad creada (poco probable en este sistema).
    return
  }

  console.log(`Entidad encontrada: ${fiscalEntity.businessName} (${fiscalEntity.id})`)

  // Borrar SatInvoices
  const deletedSatInvoices = await prisma.satInvoice.deleteMany({
    where: {
      fiscalEntityId: fiscalEntity.id,
    },
  })
  console.log(`Eliminados ${deletedSatInvoices.count} registros de SatInvoice.`)

  // Borrar Invoices
  const deletedInvoices = await prisma.invoice.deleteMany({
    where: {
      issuerFiscalEntityId: fiscalEntity.id,
    },
  })
  console.log(`Eliminados ${deletedInvoices.count} registros de Invoice.`)
  
  // Opcional: Borrar también donde sea receptor si la lógica de negocio lo requiere,
  // pero "Invoice" suele ser facturas emitidas por la entidad.
  // "SatInvoice" son descargas del SAT, que pueden ser emitidas o recibidas, pero todas vinculadas a la fiscalEntityId.
  // Al borrar por fiscalEntityId en SatInvoice, ya cubrimos emitidas y recibidas asociadas a esa cuenta.

  console.log('Limpieza completada exitosamente.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

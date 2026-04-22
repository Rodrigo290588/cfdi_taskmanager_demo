import path from 'path'
import { processMetadataTxt } from '../services/metadata-parser.service'
import { prisma } from '../lib/prisma'

async function runTest() {
  console.log('Iniciando prueba de lectura de Metadata...')

  // Limpiar registros previos para asegurar que la prueba inserte limpio
  await prisma.satMetadata.deleteMany()
  console.log('Registros previos de SatMetadata eliminados.')

  const filePath = path.join(process.cwd(), 'Ejemplo_Archivo_metadatos_SAT.txt')
  
  console.log(`Leyendo archivo: ${filePath}`)
  console.time('Tiempo de procesamiento')
  
  try {
    const totalProcessed = await processMetadataTxt(filePath, 1000) // Usamos chunk de 1000 por si crece el archivo
    console.timeEnd('Tiempo de procesamiento')
    console.log(`\n¡Éxito! Se procesaron y guardaron ${totalProcessed} registros en la base de datos.`)
    
    // Verificar en BD
    const count = await prisma.satMetadata.count()
    console.log(`Total de registros en tabla SatMetadata: ${count}`)
    
    // Mostrar el primer registro
    const firstRecord = await prisma.satMetadata.findFirst()
    console.log('\nEjemplo de registro insertado:')
    console.log(firstRecord)

  } catch (error) {
    console.error('Error durante la prueba:', error)
  } finally {
    await prisma.$disconnect()
  }
}

runTest()

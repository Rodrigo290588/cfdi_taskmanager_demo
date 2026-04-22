import fs from 'fs'
import path from 'path'
import readline from 'readline'
import unzipper from 'unzipper'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type SatMetadataCreateInput = Prisma.SatMetadataCreateManyInput

/**
 * Procesa el archivo TXT extraído del ZIP usando streams para no saturar memoria.
 * Inyecta los registros a Prisma en bloques (chunks) para eficiencia.
 */
export async function processMetadataTxt(filePath: string, chunkSize = 5000) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  let isFirstLine = true
  let batch: SatMetadataCreateInput[] = []
  let totalProcessed = 0
  let separator = '|'

  for await (const line of rl) {
    if (isFirstLine) {
      // Ignorar los encabezados y detectar el separador (puede ser | o ~)
      if (line.includes('~')) separator = '~'
      else if (line.includes('|')) separator = '|'
      
      isFirstLine = false
      continue
    }

    if (!line.trim()) continue

    const cols = line.split(separator)
    if (cols.length < 11) continue

    const [
      uuid,
      rfcEmisor,
      nombreEmisor,
      rfcReceptor,
      nombreReceptor,
      rfcPac,
      fechaEmision,
      fechaCertificacionSat,
      monto,
      efectoComprobante,
      estatus,
      fechaCancelacion
    ] = cols

    // Parse dates
    const parsedFechaEmision = fechaEmision ? new Date(fechaEmision) : null
    const parsedFechaCert = fechaCertificacionSat ? new Date(fechaCertificacionSat) : null
    const parsedFechaCanc = fechaCancelacion ? new Date(fechaCancelacion) : null

    batch.push({
      uuid: uuid.trim().toUpperCase(),
      rfcEmisor: rfcEmisor?.trim() || '',
      nombreEmisor: nombreEmisor?.trim() || null,
      rfcReceptor: rfcReceptor?.trim() || '',
      nombreReceptor: nombreReceptor?.trim() || null,
      rfcPac: rfcPac?.trim() || null,
      fechaEmision: parsedFechaEmision && !isNaN(parsedFechaEmision.getTime()) ? parsedFechaEmision : null,
      fechaCertificacionSat: parsedFechaCert && !isNaN(parsedFechaCert.getTime()) ? parsedFechaCert : null,
      monto: monto ? parseFloat(monto) : null,
      efectoComprobante: efectoComprobante?.trim() || null,
      estatus: estatus?.trim() || null,
      fechaCancelacion: parsedFechaCanc && !isNaN(parsedFechaCanc.getTime()) ? parsedFechaCanc : null
    })

    if (batch.length >= chunkSize) {
      await insertBatch(batch)
      totalProcessed += batch.length
      batch = [] // Reset batch
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await insertBatch(batch)
    totalProcessed += batch.length
  }

  return totalProcessed
}

async function insertBatch(batch: SatMetadataCreateInput[]) {
  try {
    // Usamos createMany y skipDuplicates para que si re-descargan no cause error
    await prisma.satMetadata.createMany({
      data: batch,
      skipDuplicates: true
    })
  } catch (error) {
    console.error('[MetadataParser] Error insertando lote:', error)
    // En caso de fallar masivamente, podríamos requerir un upsert manual,
    // pero skipDuplicates debería ser suficiente para una DB PostgreSQL/MySQL
  }
}

/**
 * Descomprime un archivo ZIP en un directorio de destino y procesa todos los TXT que encuentre.
 */
export async function extractAndProcessMetadataZip(zipPath: string, extractToDir: string) {
  return new Promise<{ totalRecords: number }>((resolve, reject) => {
    let totalRecords = 0

    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractToDir }))
      .on('close', async () => {
        try {
          const files = fs.readdirSync(extractToDir)
          
          for (const file of files) {
            if (file.toLowerCase().endsWith('.txt')) {
              const txtPath = path.join(extractToDir, file)
              console.log(`[MetadataParser] Procesando TXT extraído: ${file}`)
              const records = await processMetadataTxt(txtPath)
              totalRecords += records
              console.log(`[MetadataParser] Finalizado ${file} con ${records} registros.`)
              
              // Limpiar TXT para ahorrar espacio
              fs.unlinkSync(txtPath)
            }
          }

          resolve({ totalRecords })
        } catch (error) {
          reject(error)
        }
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

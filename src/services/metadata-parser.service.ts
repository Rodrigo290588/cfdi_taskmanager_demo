import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import unzipper from 'unzipper'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { validateMassDownloadZip } from '@/lib/mass-download-secure-storage'

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
      separator = detectMetadataSeparator(line)
      isFirstLine = false
      continue
    }

    const record = parseMetadataLine(line, separator)
    if (!record) continue
    batch.push(record)

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

function detectMetadataSeparator(line: string): string {
  if (line.includes('~')) return '~'
  return '|'
}

function parseMetadataLine(line: string, separator: string): SatMetadataCreateInput | null {
  if (!line.trim()) return null
  const cols = line.split(separator)
  if (cols.length < 11) return null

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
    fechaCancelacion,
  ] = cols

  return {
    uuid: uuid.trim().toUpperCase(),
    rfcEmisor: rfcEmisor?.trim() || '',
    nombreEmisor: nombreEmisor?.trim() || null,
    rfcReceptor: rfcReceptor?.trim() || '',
    nombreReceptor: nombreReceptor?.trim() || null,
    rfcPac: rfcPac?.trim() || null,
    fechaEmision: parseMetadataDate(fechaEmision),
    fechaCertificacionSat: parseMetadataDate(fechaCertificacionSat),
    monto: monto ? Number.parseFloat(monto) : null,
    efectoComprobante: efectoComprobante?.trim() || null,
    estatus: estatus?.trim() || null,
    fechaCancelacion: parseMetadataDate(fechaCancelacion),
  }
}

function parseMetadataDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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
  await validateMassDownloadZip(await fs.promises.readFile(zipPath))
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

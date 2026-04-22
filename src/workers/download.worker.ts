import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { MASS_DOWNLOAD_QUEUE_NAME } from '@/lib/queue'
import { downloadMassPackages } from '@/lib/sat-service'
import { extractAndProcessMetadataZip } from '@/services/metadata-parser.service'
import fs from 'fs'
import path from 'path'

export function setupDownloadWorker() {
  const worker = new Worker(MASS_DOWNLOAD_QUEUE_NAME, async (job: Job) => {
    const { requestId, rfc, idPaquete } = job.data

    try {
      console.log(`[Download] Inciando descarga para paquete ${idPaquete} (RFC: ${rfc})`)
      
      const { paqueteB64 } = await downloadMassPackages({
        rfc,
        idPaquete
      })

      // Convertir Base64 a buffer y guardar en disco
      const buffer = Buffer.from(paqueteB64, 'base64')
      
      // Asegurarnos que exista la carpeta
      const downloadsDir = path.join(process.cwd(), 'downloads')
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true })
      }
      
      const filePath = path.join(downloadsDir, `${idPaquete}.zip`)
      fs.writeFileSync(filePath, buffer)

      console.log(`[Download] Paquete ${idPaquete} guardado exitosamente en ${filePath}`)

      // Actualizar la base de datos (podríamos guardar un registro en logs o actualizar el request)
      const request = await prisma.massDownloadRequest.findUnique({
        where: { id: requestId }
      })

      let satMsg = request?.satMessage || ''
      satMsg += `\nPaquete ${idPaquete} descargado.`

      // Procesar si es Metadata
      if (request?.requestType === 'metadata') {
        console.log(`[Download] Descomprimiendo y procesando Metadata de ${idPaquete}...`)
        const extractDir = path.join(downloadsDir, `extract_${idPaquete}`)
        const result = await extractAndProcessMetadataZip(filePath, extractDir)
        
        satMsg += `\nMetadata procesada: ${result.totalRecords} registros importados.`
        console.log(`[Download] Metadata ${idPaquete} procesada exitosamente (${result.totalRecords} registros).`)
        
        // Limpieza del ZIP opcional
        fs.unlinkSync(filePath)
      }

      if (request) {
        await prisma.massDownloadRequest.update({
          where: { id: requestId },
          data: { satMessage: satMsg }
        })
      }

    } catch (error) {
      console.error(`[Download] Error crítico procesando paquete ${idPaquete}:`, error)
      throw error
    }
  }, {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    concurrency: 5 // Limitar concurrencia
  })

  worker.on('failed', (job, err) => {
    console.error(`[Download] Job ${job?.id} falló:`, err)
  })

  return worker
}

import { loadEnvConfig } from '@next/env'
import { prisma } from '../lib/prisma'
import { decryptInvoiceXmlContent } from '../lib/invoice-xml-storage'
import { upsertInvoiceComplementProjection } from '../lib/cfdi-complement-projection-storage'

loadEnvConfig(process.cwd())

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const batchSize = parsePositiveInt(process.env.INVOICE_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE, 200)
  const dryRun = process.env.INVOICE_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN === '1'
  const startAfterId = (process.env.INVOICE_COMPLEMENT_PROJECTION_BACKFILL_START_AFTER_ID || '').trim() || null

  let lastId = startAfterId
  let processed = 0
  let projected = 0
  let chunk = 0

  console.log('[InvoiceComplementProjectionBackfill] Inicio')
  console.log(`  Batch size: ${batchSize}`)
  console.log(`  Dry run: ${dryRun ? 'si' : 'no'}`)
  if (startAfterId) {
    console.log(`  Reanudar despues de id: ${startAfterId}`)
  }

  while (true) {
    const rows = await prisma.invoice.findMany({
      where: {
        ...(lastId ? { id: { gt: lastId } } : {})
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        xmlContent: true,
        blob: {
          select: {
            xmlCiphertext: true,
            xmlIv: true,
            xmlAuthTag: true,
            xmlEncryptionAlg: true
          }
        }
      }
    })

    if (rows.length === 0) {
      break
    }

    chunk += 1
    processed += rows.length
    lastId = rows[rows.length - 1]?.id || lastId

    for (const row of rows) {
      const xmlContent = row.xmlContent?.trim()
        || (row.blob
          ? decryptInvoiceXmlContent({
              ciphertext: row.blob.xmlCiphertext,
              iv: row.blob.xmlIv,
              authTag: row.blob.xmlAuthTag,
              algorithm: row.blob.xmlEncryptionAlg
            })
          : '')

      if (!xmlContent) {
        continue
      }

      projected += 1

      if (!dryRun) {
        await upsertInvoiceComplementProjection(prisma, {
          invoiceId: row.id,
          xmlContent
        })
      }
    }

    console.log(`[InvoiceComplementProjectionBackfill] Chunk ${chunk} | leidos=${rows.length} | proyectados=${projected} | ultimoId=${lastId}`)
  }

  console.log('[InvoiceComplementProjectionBackfill] Fin')
  console.log(`  Registros procesados: ${processed}`)
  console.log(`  Registros proyectados: ${projected}`)
  console.log(`  Ultimo id procesado: ${lastId || 'N/A'}`)
}

main()
  .catch(error => {
    console.error('[InvoiceComplementProjectionBackfill] Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

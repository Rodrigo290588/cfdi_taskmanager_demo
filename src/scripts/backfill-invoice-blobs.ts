import { loadEnvConfig } from '@next/env'
import { prisma } from '../lib/prisma'
import { encryptInvoiceXmlContent } from '../lib/invoice-xml-storage'

loadEnvConfig(process.cwd())

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const batchSize = parsePositiveInt(process.env.INVOICE_BLOB_BACKFILL_BATCH_SIZE, 100)
  const dryRun = process.env.INVOICE_BLOB_BACKFILL_DRY_RUN === '1'
  const startAfterId = (process.env.INVOICE_BLOB_BACKFILL_START_AFTER_ID || '').trim() || null

  const where = {
    blob: { is: null as null },
    NOT: { xmlContent: '' }
  }

  const totalPending = await prisma.invoice.count({ where })

  console.log('[InvoiceBlobBackfill] Inicio')
  console.log(`  Registros pendientes: ${totalPending}`)
  console.log(`  Batch size: ${batchSize}`)
  console.log(`  Dry run: ${dryRun ? 'si' : 'no'}`)
  if (startAfterId) {
    console.log(`  Reanudar despues de id: ${startAfterId}`)
  }

  let lastId = startAfterId
  let scanned = 0
  let inserted = 0
  let skipped = 0
  let chunkNumber = 0

  while (true) {
    const invoices = await prisma.invoice.findMany({
      where: {
        ...where,
        ...(lastId ? { id: { gt: lastId } } : {})
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        uuid: true,
        xmlContent: true
      }
    })

    if (invoices.length === 0) {
      break
    }

    chunkNumber += 1
    scanned += invoices.length
    lastId = invoices[invoices.length - 1]?.id || lastId

    const blobRows = invoices
      .filter(invoice => invoice.xmlContent.trim().length > 0)
      .map(invoice => {
        const encrypted = encryptInvoiceXmlContent(invoice.xmlContent)

        return {
          invoiceId: invoice.id,
          xmlSha256: encrypted.sha256,
          xmlCiphertext: encrypted.ciphertext,
          xmlIv: encrypted.iv,
          xmlAuthTag: encrypted.authTag,
          xmlEncryptionAlg: encrypted.algorithm,
          xmlKeyVersion: encrypted.keyVersion
        }
      })

    skipped += invoices.length - blobRows.length

    let insertedInChunk = 0

    if (!dryRun && blobRows.length > 0) {
      const result = await prisma.invoiceBlob.createMany({
        data: blobRows,
        skipDuplicates: true
      })
      insertedInChunk = result.count
      inserted += insertedInChunk
      skipped += blobRows.length - insertedInChunk
    }

    console.log(
      `[InvoiceBlobBackfill] Chunk ${chunkNumber} | leidos=${invoices.length} | preparados=${blobRows.length} | insertados=${dryRun ? 0 : insertedInChunk} | ultimoId=${lastId}`
    )
  }

  console.log('[InvoiceBlobBackfill] Fin')
  console.log(`  Registros leidos: ${scanned}`)
  console.log(`  Blobs insertados: ${inserted}`)
  console.log(`  Registros omitidos: ${skipped}`)
  console.log(`  Ultimo id procesado: ${lastId || 'N/A'}`)
}

main()
  .catch(error => {
    console.error('[InvoiceBlobBackfill] Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

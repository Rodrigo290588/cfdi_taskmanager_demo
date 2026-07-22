import { loadEnvConfig } from '@next/env'
import { CfdiType } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { decryptInvoiceXmlContent } from '../lib/invoice-xml-storage'
import {
  extractInvoicePaymentComplementDetails,
  upsertInvoicePaymentComplementDetails
} from '../lib/invoice-payment-complement-storage'

loadEnvConfig(process.cwd())

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const batchSize = parsePositiveInt(process.env.INVOICE_PAYMENT_COMPLEMENT_BACKFILL_BATCH_SIZE, 200)
  const dryRun = process.env.INVOICE_PAYMENT_COMPLEMENT_BACKFILL_DRY_RUN === '1'
  const startAfterId = (process.env.INVOICE_PAYMENT_COMPLEMENT_BACKFILL_START_AFTER_ID || '').trim() || null

  let lastId = startAfterId
  let processed = 0
  let invoicesWithDetails = 0
  let detailRows = 0
  let chunk = 0

  console.log('[InvoicePaymentComplementBackfill] Inicio')
  console.log(`  Batch size: ${batchSize}`)
  console.log(`  Dry run: ${dryRun ? 'si' : 'no'}`)
  if (startAfterId) {
    console.log(`  Reanudar despues de id: ${startAfterId}`)
  }

  while (true) {
    const rows = await prisma.invoice.findMany({
      where: {
        cfdiType: CfdiType.PAGO,
        ...(lastId ? { id: { gt: lastId } } : {})
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        uuid: true,
        issuerFiscalEntityId: true,
        satStatus: true,
        issuanceDate: true,
        currency: true,
        series: true,
        folio: true,
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

      if (dryRun) {
        const details = extractInvoicePaymentComplementDetails({
          xmlContent,
          fallbackPaymentDate: row.issuanceDate,
          fallbackCurrency: row.currency,
          fallbackSeries: row.series,
          fallbackFolio: row.folio
        })

        if (details.length > 0) {
          invoicesWithDetails += 1
          detailRows += details.length
        }

        continue
      }

      const result = await upsertInvoicePaymentComplementDetails(prisma, {
        issuerFiscalEntityId: row.issuerFiscalEntityId,
        paymentInvoiceId: row.id,
        paymentInvoiceUuid: row.uuid,
        xmlContent,
        satStatusSnapshot: row.satStatus,
        fallbackPaymentDate: row.issuanceDate,
        fallbackCurrency: row.currency,
        fallbackSeries: row.series,
        fallbackFolio: row.folio
      })

      if (result.totalRows > 0) {
        invoicesWithDetails += 1
        detailRows += result.totalRows
      }
    }

    console.log(`[InvoicePaymentComplementBackfill] Chunk ${chunk} | leidos=${rows.length} | pagosConDetalle=${invoicesWithDetails} | filasDetalle=${detailRows} | ultimoId=${lastId}`)
  }

  console.log('[InvoicePaymentComplementBackfill] Fin')
  console.log(`  Registros procesados: ${processed}`)
  console.log(`  Pagos con detalle: ${invoicesWithDetails}`)
  console.log(`  Filas de detalle: ${detailRows}`)
  console.log(`  Ultimo id procesado: ${lastId || 'N/A'}`)
}

main()
  .catch(error => {
    console.error('[InvoicePaymentComplementBackfill] Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

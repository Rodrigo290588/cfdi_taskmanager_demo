import { loadEnvConfig } from '@next/env'
import { prisma } from '../lib/prisma'
import {
  accumulateInvoiceIssuedSummaryAggregates,
  normalizeUpperText,
  resolveInvoiceIssuedSummaryRelatedAmounts,
  shouldIncludeIssuedInvoice,
  upsertInvoiceIssuedSummaryBatch
} from '../lib/invoice-issued-daily-summary'

loadEnvConfig(process.cwd())

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}


async function main() {
  const batchSize = parsePositiveInt(process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE, 200)
  const dryRun = process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_DRY_RUN === '1'
  const resetSummary = process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_RESET === '1'
  const startAfterId = (process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_START_AFTER_ID || '').trim() || null
  const now = new Date()

  if (!dryRun && resetSummary && startAfterId) {
    throw new Error('No combines INVOICE_ISSUED_SUMMARY_BACKFILL_RESET=1 con INVOICE_ISSUED_SUMMARY_BACKFILL_START_AFTER_ID')
  }

  if (!dryRun && !resetSummary && !startAfterId) {
    const existingRows = await prisma.invoiceIssuedDailySummary.count()
    if (existingRows > 0) {
      throw new Error(
        'La tabla invoice_issued_daily_summary ya tiene datos. Usa INVOICE_ISSUED_SUMMARY_BACKFILL_RESET=1 para reconstruir desde cero o INVOICE_ISSUED_SUMMARY_BACKFILL_START_AFTER_ID para reanudar sin duplicar.'
      )
    }
  }

  if (!dryRun && resetSummary) {
    console.log('[InvoiceIssuedSummaryBackfill] Limpiando tabla resumen antes de iniciar...')
    await prisma.invoiceIssuedDailySummary.deleteMany({})
  }

  let lastId = startAfterId
  let processed = 0
  let included = 0
  let skipped = 0
  let upsertedDimensions = 0
  let chunkNumber = 0

  console.log('[InvoiceIssuedSummaryBackfill] Inicio')
  console.log(`  Batch size: ${batchSize}`)
  console.log(`  Dry run: ${dryRun ? 'si' : 'no'}`)
  console.log(`  Reset: ${resetSummary ? 'si' : 'no'}`)
  if (startAfterId) {
    console.log(`  Reanudar despues de id: ${startAfterId}`)
  }

  while (true) {
    const invoices = await prisma.invoice.findMany({
      where: {
        ...(lastId ? { id: { gt: lastId } } : {})
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        uuid: true,
        issuerRfc: true,
        receiverRfc: true,
        receiverName: true,
        cfdiType: true,
        satStatus: true,
        paymentMethod: true,
        issuanceDate: true,
        subtotal: true,
        discount: true,
        total: true,
        ivaTransferred: true,
        ivaWithheld: true,
        isrWithheld: true,
        iepsWithheld: true,
        xmlContent: true,
        issuerFiscalEntityId: true,
        fiscalEntity: {
          select: {
            organizationId: true,
            rfc: true
          }
        },
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

    if (invoices.length === 0) {
      break
    }

    chunkNumber += 1
    processed += invoices.length
    lastId = invoices[invoices.length - 1]?.id || lastId

    const validInvoices = invoices.filter(shouldIncludeIssuedInvoice)
    skipped += invoices.length - validInvoices.length

    const incomeUuids = validInvoices
      .filter(invoice => normalizeUpperText(invoice.cfdiType) === 'INGRESO')
      .map(invoice => invoice.uuid)

    const relatedAmounts = await resolveInvoiceIssuedSummaryRelatedAmounts({
      uuids: incomeUuids
    })

    const aggregateResult = accumulateInvoiceIssuedSummaryAggregates({
      invoices: validInvoices,
      relatedAmounts,
      now
    })

    included += aggregateResult.included
    upsertedDimensions += aggregateResult.rows.length

    if (!dryRun) {
      await upsertInvoiceIssuedSummaryBatch({
        rows: aggregateResult.rows
      })
    }

    console.log(
      `[InvoiceIssuedSummaryBackfill] Chunk ${chunkNumber} | leidos=${invoices.length} | validos=${aggregateResult.included} | dimensiones=${aggregateResult.rows.length} | ultimoId=${lastId}`
    )
  }

  console.log('[InvoiceIssuedSummaryBackfill] Fin')
  console.log(`  Registros procesados: ${processed}`)
  console.log(`  Registros incluidos: ${included}`)
  console.log(`  Registros omitidos: ${skipped}`)
  console.log(`  Dimensiones consolidadas: ${upsertedDimensions}`)
  console.log(`  Ultimo id procesado: ${lastId || 'N/A'}`)
}

main()
  .catch(error => {
    console.error('[InvoiceIssuedSummaryBackfill] Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

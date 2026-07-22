import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import { DOMParser } from '@xmldom/xmldom'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { decryptInvoiceXmlContent } from '../lib/invoice-xml-storage'

loadEnvConfig(process.cwd())

type InvoiceBatchRecord = {
  id: string
  uuid: string
  issuerRfc: string
  receiverRfc: string
  receiverName: string | null
  cfdiType: string
  satStatus: string
  paymentMethod: string
  issuanceDate: Date
  subtotal: Prisma.Decimal
  discount: Prisma.Decimal | null
  total: Prisma.Decimal
  ivaTransferred: Prisma.Decimal | null
  ivaWithheld: Prisma.Decimal | null
  isrWithheld: Prisma.Decimal | null
  iepsWithheld: Prisma.Decimal | null
  xmlContent: string | null
  issuerFiscalEntityId: string
  fiscalEntity: {
    organizationId: string
    rfc: string
  } | null
  blob: {
    xmlCiphertext: string
    xmlIv: string
    xmlAuthTag: string
    xmlEncryptionAlg: string
  } | null
}

type SummaryAggregate = {
  organizationId: string
  issuerFiscalEntityId: string
  summaryDate: Date
  cfdiType: string
  satStatus: string
  receiverRfc: string
  receiverName: string
  paymentMethod: string
  salesBucket: string
  paymentStatusBucket: string
  cfdiCount: number
  subtotalAmount: number
  discountAmount: number
  totalAmount: number
  ivaTransferredTotal: number
  ivaWithheldTotal: number
  isrWithheldTotal: number
  iepsWithheldTotal: number
  collectedAmount: number
  pendingAmount: number
  overdueAmount: number
  creditNoteAppliedAmount: number
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeUpperText(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function toUtcDateOnly(value: Date) {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate()
  ))
}

function resolveInvoiceXmlContent(invoice: InvoiceBatchRecord) {
  if (invoice.xmlContent?.trim()) {
    return invoice.xmlContent
  }

  if (!invoice.blob) {
    return ''
  }

  return decryptInvoiceXmlContent({
    ciphertext: invoice.blob.xmlCiphertext,
    iv: invoice.blob.xmlIv,
    authTag: invoice.blob.xmlAuthTag,
    algorithm: invoice.blob.xmlEncryptionAlg
  })
}

function resolveSalesBucket(invoice: InvoiceBatchRecord, xmlContent: string) {
  if (normalizeUpperText(invoice.cfdiType) !== 'INGRESO') {
    return 'NO_APLICA'
  }

  if (normalizeUpperText(invoice.receiverRfc) === 'XAXX010101000') {
    return xmlContent.includes('InformacionGlobal')
      ? 'GLOBAL'
      : 'INDIVIDUAL'
  }

  return 'NOMINATIVA'
}

function buildSummaryKey(row: SummaryAggregate) {
  return [
    row.organizationId,
    row.issuerFiscalEntityId,
    row.summaryDate.toISOString(),
    row.cfdiType,
    row.satStatus,
    row.receiverRfc,
    row.paymentMethod,
    row.salesBucket,
    row.paymentStatusBucket
  ].join('|')
}

function mergeAggregate(target: SummaryAggregate, source: SummaryAggregate) {
  target.cfdiCount += source.cfdiCount
  target.subtotalAmount += source.subtotalAmount
  target.discountAmount += source.discountAmount
  target.totalAmount += source.totalAmount
  target.ivaTransferredTotal += source.ivaTransferredTotal
  target.ivaWithheldTotal += source.ivaWithheldTotal
  target.isrWithheldTotal += source.isrWithheldTotal
  target.iepsWithheldTotal += source.iepsWithheldTotal
  target.collectedAmount += source.collectedAmount
  target.pendingAmount += source.pendingAmount
  target.overdueAmount += source.overdueAmount
  target.creditNoteAppliedAmount += source.creditNoteAppliedAmount
}

function resolvePaymentStatusBucket(params: {
  invoice: InvoiceBatchRecord
  collectedAmount: number
  pendingAmount: number
}) {
  if (normalizeUpperText(params.invoice.cfdiType) !== 'INGRESO') {
    return 'NO_APLICA'
  }

  if (normalizeUpperText(params.invoice.satStatus) !== 'VIGENTE') {
    return 'NO_APLICA'
  }

  if (normalizeUpperText(params.invoice.paymentMethod) === 'PUE') {
    return 'PAGADO'
  }

  if (normalizeUpperText(params.invoice.paymentMethod) !== 'PPD') {
    return 'NO_APLICA'
  }

  if (params.pendingAmount <= 0.01) {
    return 'PAGADO'
  }

  if (params.collectedAmount > 0.01) {
    return 'PARCIAL'
  }

  return 'PENDIENTE'
}

function shouldIncludeIssuedInvoice(invoice: InvoiceBatchRecord) {
  return Boolean(
    invoice.fiscalEntity
    && normalizeUpperText(invoice.fiscalEntity.rfc) === normalizeUpperText(invoice.issuerRfc)
  )
}

function parsePagoXmlAmounts(xmlContent: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlContent, 'text/xml')
  const amountsByUuid: Record<string, number> = {}
  const getAttr = (el: Element, name: string) => el.getAttribute(name) || ''

  const pagos = Array.from(doc.getElementsByTagName('*')).filter((element: Element) => {
    if (!element.nodeName.endsWith(':Pago')) {
      return false
    }

    let current: Element | null = element.parentNode as Element | null
    while (current) {
      if (current.nodeName?.endsWith(':Addenda')) {
        return false
      }
      current = current.parentNode as Element | null
    }

    return true
  })

  pagos.forEach((pagoNode: Element) => {
    const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter((element: Element) =>
      element.nodeName.endsWith(':DoctoRelacionado')
    )

    doctos.forEach((doctoNode: Element) => {
      const relatedUuid = normalizeUpperText(getAttr(doctoNode, 'IdDocumento'))
      if (!relatedUuid) {
        return
      }

      const impPagado = parseFloat(getAttr(doctoNode, 'ImpPagado')) || 0
      amountsByUuid[relatedUuid] = (amountsByUuid[relatedUuid] || 0) + impPagado
    })
  })

  return amountsByUuid
}

async function upsertSummaryBatch(rows: SummaryAggregate[]) {
  if (rows.length === 0) {
    return
  }

  const values = rows.map(row => Prisma.sql`(
    ${randomUUID()},
    ${row.organizationId},
    ${row.issuerFiscalEntityId},
    ${row.summaryDate},
    ${row.cfdiType},
    ${row.satStatus},
    ${row.receiverRfc},
    ${row.receiverName},
    ${row.paymentMethod},
    ${row.salesBucket},
    ${row.paymentStatusBucket},
    ${row.cfdiCount},
    ${row.subtotalAmount},
    ${row.discountAmount},
    ${row.totalAmount},
    ${row.ivaTransferredTotal},
    ${row.ivaWithheldTotal},
    ${row.isrWithheldTotal},
    ${row.iepsWithheldTotal},
    ${row.collectedAmount},
    ${row.pendingAmount},
    ${row.overdueAmount},
    ${row.creditNoteAppliedAmount},
    NOW(),
    NOW()
  )`)

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO invoice_issued_daily_summary (
        id,
        organization_id,
        issuer_fiscal_entity_id,
        summary_date,
        cfdi_type,
        sat_status,
        receiver_rfc,
        receiver_name,
        payment_method,
        sales_bucket,
        payment_status_bucket,
        cfdi_count,
        subtotal_amount,
        discount_amount,
        total_amount,
        iva_transferred_total,
        iva_withheld_total,
        isr_withheld_total,
        ieps_withheld_total,
        collected_amount,
        pending_amount,
        overdue_amount,
        credit_note_applied_amount,
        created_at,
        updated_at
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (
        organization_id,
        issuer_fiscal_entity_id,
        summary_date,
        cfdi_type,
        sat_status,
        receiver_rfc,
        payment_method,
        sales_bucket,
        payment_status_bucket
      )
      DO UPDATE SET
        receiver_name = EXCLUDED.receiver_name,
        cfdi_count = invoice_issued_daily_summary.cfdi_count + EXCLUDED.cfdi_count,
        subtotal_amount = invoice_issued_daily_summary.subtotal_amount + EXCLUDED.subtotal_amount,
        discount_amount = invoice_issued_daily_summary.discount_amount + EXCLUDED.discount_amount,
        total_amount = invoice_issued_daily_summary.total_amount + EXCLUDED.total_amount,
        iva_transferred_total = invoice_issued_daily_summary.iva_transferred_total + EXCLUDED.iva_transferred_total,
        iva_withheld_total = invoice_issued_daily_summary.iva_withheld_total + EXCLUDED.iva_withheld_total,
        isr_withheld_total = invoice_issued_daily_summary.isr_withheld_total + EXCLUDED.isr_withheld_total,
        ieps_withheld_total = invoice_issued_daily_summary.ieps_withheld_total + EXCLUDED.ieps_withheld_total,
        collected_amount = invoice_issued_daily_summary.collected_amount + EXCLUDED.collected_amount,
        pending_amount = invoice_issued_daily_summary.pending_amount + EXCLUDED.pending_amount,
        overdue_amount = invoice_issued_daily_summary.overdue_amount + EXCLUDED.overdue_amount,
        credit_note_applied_amount = invoice_issued_daily_summary.credit_note_applied_amount + EXCLUDED.credit_note_applied_amount,
        updated_at = NOW()
    `
  )
}

async function main() {
  const batchSize = parsePositiveInt(process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE, 200)
  const dryRun = process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_DRY_RUN === '1'
  const resetSummary = process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_RESET === '1'
  const startAfterId = (process.env.INVOICE_ISSUED_SUMMARY_BACKFILL_START_AFTER_ID || '').trim() || null
  const now = new Date()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

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

    const paidAmountsByUuid: Record<string, number> = {}
    const creditNotesByUuid: Record<string, number> = {}

    if (incomeUuids.length > 0) {
      const paymentRelations = await prisma.invoiceRelatedCfdi.findMany({
        where: {
          relatedUuid: { in: incomeUuids },
          invoice: {
            cfdiType: 'PAGO',
            satStatus: 'VIGENTE'
          }
        },
        select: {
          relatedUuid: true,
          invoice: {
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
          }
        }
      })

      const parsedPaymentsByInvoiceId = new Map<string, Record<string, number>>()

      paymentRelations.forEach(relation => {
        const paymentInvoiceId = relation.invoice.id

        if (!parsedPaymentsByInvoiceId.has(paymentInvoiceId)) {
          const xmlContent = relation.invoice.xmlContent?.trim()
            || (relation.invoice.blob
              ? decryptInvoiceXmlContent({
                  ciphertext: relation.invoice.blob.xmlCiphertext,
                  iv: relation.invoice.blob.xmlIv,
                  authTag: relation.invoice.blob.xmlAuthTag,
                  algorithm: relation.invoice.blob.xmlEncryptionAlg
                })
              : '')

          parsedPaymentsByInvoiceId.set(
            paymentInvoiceId,
            xmlContent ? parsePagoXmlAmounts(xmlContent) : {}
          )
        }

        const parsedMap = parsedPaymentsByInvoiceId.get(paymentInvoiceId) || {}
        const relatedUuid = normalizeUpperText(relation.relatedUuid)
        paidAmountsByUuid[relatedUuid] = (paidAmountsByUuid[relatedUuid] || 0) + (parsedMap[relatedUuid] || 0)
      })

      const creditNoteRelations = await prisma.invoiceRelatedCfdi.findMany({
        where: {
          relatedUuid: { in: incomeUuids },
          invoice: {
            cfdiType: 'EGRESO',
            satStatus: 'VIGENTE'
          }
        },
        select: {
          relatedUuid: true,
          invoice: {
            select: {
              total: true
            }
          }
        }
      })

      creditNoteRelations.forEach(relation => {
        const relatedUuid = normalizeUpperText(relation.relatedUuid)
        creditNotesByUuid[relatedUuid] = (creditNotesByUuid[relatedUuid] || 0) + toNumber(relation.invoice.total)
      })
    }

    const aggregateMap = new Map<string, SummaryAggregate>()

    validInvoices.forEach(invoice => {
      const xmlContent = resolveInvoiceXmlContent(invoice)
      const totalAmount = toNumber(invoice.total)
      const isVigente = normalizeUpperText(invoice.satStatus) === 'VIGENTE'
      const isIngreso = normalizeUpperText(invoice.cfdiType) === 'INGRESO'
      const isPpd = normalizeUpperText(invoice.paymentMethod) === 'PPD'
      const isPue = normalizeUpperText(invoice.paymentMethod) === 'PUE'
      const paidAmount = isIngreso && isVigente ? (paidAmountsByUuid[normalizeUpperText(invoice.uuid)] || 0) : 0
      const creditNoteAppliedAmount = isIngreso && isVigente ? (creditNotesByUuid[normalizeUpperText(invoice.uuid)] || 0) : 0

      let collectedAmount = 0
      let pendingAmount = 0
      let overdueAmount = 0

      if (isIngreso && isVigente) {
        if (isPue) {
          collectedAmount = totalAmount
        } else if (isPpd) {
          collectedAmount = Math.min(totalAmount, paidAmount)
          pendingAmount = Math.max(totalAmount - collectedAmount, 0)
          if (pendingAmount > 0 && now.getTime() - invoice.issuanceDate.getTime() > thirtyDaysMs) {
            overdueAmount = pendingAmount
          }
        }
      }

      const aggregateRow: SummaryAggregate = {
        organizationId: invoice.fiscalEntity!.organizationId,
        issuerFiscalEntityId: invoice.issuerFiscalEntityId,
        summaryDate: toUtcDateOnly(invoice.issuanceDate),
        cfdiType: normalizeUpperText(invoice.cfdiType) || 'SIN_TIPO',
        satStatus: normalizeUpperText(invoice.satStatus) || 'SIN_ESTATUS',
        receiverRfc: normalizeUpperText(invoice.receiverRfc),
        receiverName: normalizeText(invoice.receiverName),
        paymentMethod: normalizeUpperText(invoice.paymentMethod),
        salesBucket: resolveSalesBucket(invoice, xmlContent),
        paymentStatusBucket: resolvePaymentStatusBucket({
          invoice,
          collectedAmount,
          pendingAmount
        }),
        cfdiCount: 1,
        subtotalAmount: toNumber(invoice.subtotal),
        discountAmount: toNumber(invoice.discount),
        totalAmount,
        ivaTransferredTotal: toNumber(invoice.ivaTransferred),
        ivaWithheldTotal: toNumber(invoice.ivaWithheld),
        isrWithheldTotal: toNumber(invoice.isrWithheld),
        iepsWithheldTotal: toNumber(invoice.iepsWithheld),
        collectedAmount,
        pendingAmount,
        overdueAmount,
        creditNoteAppliedAmount
      }

      const key = buildSummaryKey(aggregateRow)
      const existing = aggregateMap.get(key)

      if (existing) {
        mergeAggregate(existing, aggregateRow)
      } else {
        aggregateMap.set(key, aggregateRow)
      }
    })

    const aggregateRows = Array.from(aggregateMap.values())
    included += validInvoices.length
    upsertedDimensions += aggregateRows.length

    if (!dryRun) {
      await upsertSummaryBatch(aggregateRows)
    }

    console.log(
      `[InvoiceIssuedSummaryBackfill] Chunk ${chunkNumber} | leidos=${invoices.length} | validos=${validInvoices.length} | dimensiones=${aggregateRows.length} | ultimoId=${lastId}`
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

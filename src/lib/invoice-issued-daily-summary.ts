import { randomUUID } from 'node:crypto'
import { DOMParser } from '@xmldom/xmldom'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'

type PrismaDelegate = Prisma.TransactionClient | typeof prisma

export type InvoiceIssuedSummarySource = {
  id: string
  uuid: string
  issuerRfc: string
  receiverRfc: string
  receiverName: string | null
  cfdiType: string | null
  satStatus: string | null
  paymentMethod: string | null
  issuanceDate: Date | string
  subtotal: Prisma.Decimal | number | string | null | undefined
  discount: Prisma.Decimal | number | string | null | undefined
  total: Prisma.Decimal | number | string | null | undefined
  ivaTransferred: Prisma.Decimal | number | string | null | undefined
  ivaWithheld: Prisma.Decimal | number | string | null | undefined
  isrWithheld: Prisma.Decimal | number | string | null | undefined
  iepsWithheld: Prisma.Decimal | number | string | null | undefined
  issuerFiscalEntityId: string
  fiscalEntity: {
    organizationId: string
    rfc: string
  } | null
  xmlContent?: string | null
  blob?: {
    xmlCiphertext: string
    xmlIv: string
    xmlAuthTag: string
    xmlEncryptionAlg: string
  } | null
}

export type InvoiceIssuedSummaryAggregate = {
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

export type InvoiceIssuedSummaryRelatedAmounts = {
  paidAmountsByUuid: Record<string, number>
  creditNotesByUuid: Record<string, number>
}

export function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

export function normalizeUpperText(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

export function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

export function toUtcDateOnly(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value)

  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate()
  ))
}

export function resolveInvoiceXmlContent(invoice: InvoiceIssuedSummarySource) {
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

export function resolveSalesBucket(invoice: InvoiceIssuedSummarySource, xmlContent: string) {
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

export function buildInvoiceIssuedSummaryKey(row: InvoiceIssuedSummaryAggregate) {
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

export function mergeInvoiceIssuedSummaryAggregate(target: InvoiceIssuedSummaryAggregate, source: InvoiceIssuedSummaryAggregate) {
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

export function resolveInvoiceIssuedPaymentStatusBucket(params: {
  invoice: InvoiceIssuedSummarySource
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

export function shouldIncludeIssuedInvoice(invoice: InvoiceIssuedSummarySource) {
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

export async function resolveInvoiceIssuedSummaryRelatedAmounts(params: {
  uuids: string[]
  db?: PrismaDelegate
}) {
  const db = params.db || prisma
  const uniqueUuids = Array.from(new Set(
    params.uuids
      .map(uuid => normalizeUpperText(uuid))
      .filter(Boolean)
  ))

  const paidAmountsByUuid: Record<string, number> = {}
  const creditNotesByUuid: Record<string, number> = {}

  if (uniqueUuids.length === 0) {
    return {
      paidAmountsByUuid,
      creditNotesByUuid
    }
  }

  const paymentRelations = await db.invoiceRelatedCfdi.findMany({
    where: {
      relatedUuid: { in: uniqueUuids },
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

  const creditNoteRelations = await db.invoiceRelatedCfdi.findMany({
    where: {
      relatedUuid: { in: uniqueUuids },
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

  return {
    paidAmountsByUuid,
    creditNotesByUuid
  }
}

export function buildInvoiceIssuedSummaryAggregate(params: {
  invoice: InvoiceIssuedSummarySource | null | undefined
  relatedAmounts?: InvoiceIssuedSummaryRelatedAmounts
  now?: Date
}) {
  const invoice = params.invoice
  if (!invoice || !invoice.issuanceDate || !shouldIncludeIssuedInvoice(invoice)) {
    return null
  }

  const now = params.now || new Date()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const xmlContent = resolveInvoiceXmlContent(invoice)
  const totalAmount = toNumber(invoice.total)
  const normalizedUuid = normalizeUpperText(invoice.uuid)
  const isVigente = normalizeUpperText(invoice.satStatus) === 'VIGENTE'
  const isIngreso = normalizeUpperText(invoice.cfdiType) === 'INGRESO'
  const isPpd = normalizeUpperText(invoice.paymentMethod) === 'PPD'
  const isPue = normalizeUpperText(invoice.paymentMethod) === 'PUE'
  const paidAmount = isIngreso && isVigente
    ? (params.relatedAmounts?.paidAmountsByUuid?.[normalizedUuid] || 0)
    : 0
  const creditNoteAppliedAmount = isIngreso && isVigente
    ? (params.relatedAmounts?.creditNotesByUuid?.[normalizedUuid] || 0)
    : 0

  let collectedAmount = 0
  let pendingAmount = 0
  let overdueAmount = 0

  if (isIngreso && isVigente) {
    if (isPue) {
      collectedAmount = totalAmount
    } else if (isPpd) {
      collectedAmount = Math.min(totalAmount, paidAmount)
      pendingAmount = Math.max(totalAmount - collectedAmount, 0)

      const issuanceDate = invoice.issuanceDate instanceof Date
        ? invoice.issuanceDate
        : new Date(invoice.issuanceDate)

      if (pendingAmount > 0 && now.getTime() - issuanceDate.getTime() > thirtyDaysMs) {
        overdueAmount = pendingAmount
      }
    }
  }

  return {
    organizationId: invoice.fiscalEntity!.organizationId,
    issuerFiscalEntityId: invoice.issuerFiscalEntityId,
    summaryDate: toUtcDateOnly(invoice.issuanceDate),
    cfdiType: normalizeUpperText(invoice.cfdiType) || 'SIN_TIPO',
    satStatus: normalizeUpperText(invoice.satStatus) || 'SIN_ESTATUS',
    receiverRfc: normalizeUpperText(invoice.receiverRfc),
    receiverName: normalizeText(invoice.receiverName),
    paymentMethod: normalizeUpperText(invoice.paymentMethod),
    salesBucket: resolveSalesBucket(invoice, xmlContent),
    paymentStatusBucket: resolveInvoiceIssuedPaymentStatusBucket({
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
}

export function accumulateInvoiceIssuedSummaryAggregates(params: {
  invoices: InvoiceIssuedSummarySource[]
  relatedAmounts?: InvoiceIssuedSummaryRelatedAmounts
  now?: Date
}) {
  const aggregateMap = new Map<string, InvoiceIssuedSummaryAggregate>()
  let included = 0
  let skipped = 0

  params.invoices.forEach(invoice => {
    const aggregateRow = buildInvoiceIssuedSummaryAggregate({
      invoice,
      relatedAmounts: params.relatedAmounts,
      now: params.now
    })

    if (!aggregateRow) {
      skipped += 1
      return
    }

    included += 1

    const key = buildInvoiceIssuedSummaryKey(aggregateRow)
    const existing = aggregateMap.get(key)

    if (existing) {
      mergeInvoiceIssuedSummaryAggregate(existing, aggregateRow)
    } else {
      aggregateMap.set(key, aggregateRow)
    }
  })

  return {
    rows: Array.from(aggregateMap.values()),
    included,
    skipped
  }
}

function buildInvoiceIssuedSummaryValues(row: InvoiceIssuedSummaryAggregate, delta: 1 | -1) {
  return Prisma.sql`(
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
    ${row.cfdiCount * delta},
    ${row.subtotalAmount * delta},
    ${row.discountAmount * delta},
    ${row.totalAmount * delta},
    ${row.ivaTransferredTotal * delta},
    ${row.ivaWithheldTotal * delta},
    ${row.isrWithheldTotal * delta},
    ${row.iepsWithheldTotal * delta},
    ${row.collectedAmount * delta},
    ${row.pendingAmount * delta},
    ${row.overdueAmount * delta},
    ${row.creditNoteAppliedAmount * delta},
    NOW(),
    NOW()
  )`
}

export async function upsertInvoiceIssuedSummaryBatch(params: {
  rows: InvoiceIssuedSummaryAggregate[]
  db?: PrismaDelegate
}) {
  if (params.rows.length === 0) {
    return
  }

  const db = params.db || prisma
  const values = params.rows.map(row => buildInvoiceIssuedSummaryValues(row, 1))

  await db.$executeRaw(
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

async function applyInvoiceIssuedSummaryDelta(params: {
  db?: PrismaDelegate
  row: InvoiceIssuedSummaryAggregate | null
  delta: 1 | -1
}) {
  if (!params.row) {
    return
  }

  const db = params.db || prisma
  const value = buildInvoiceIssuedSummaryValues(params.row, params.delta)
  const row = params.row

  await db.$executeRaw(
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
      VALUES ${value}
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

  if (params.delta < 0) {
    await db.$executeRaw(
      Prisma.sql`
        DELETE FROM invoice_issued_daily_summary
        WHERE organization_id = ${row.organizationId}
          AND issuer_fiscal_entity_id = ${row.issuerFiscalEntityId}
          AND summary_date = ${row.summaryDate}
          AND cfdi_type = ${row.cfdiType}
          AND sat_status = ${row.satStatus}
          AND receiver_rfc = ${row.receiverRfc}
          AND payment_method = ${row.paymentMethod}
          AND sales_bucket = ${row.salesBucket}
          AND payment_status_bucket = ${row.paymentStatusBucket}
          AND cfdi_count <= 0
      `
    )
  }
}

export async function syncInvoiceIssuedDailySummaryRecordChange(params: {
  db?: PrismaDelegate
  previousRecord?: InvoiceIssuedSummarySource | null
  nextRecord?: InvoiceIssuedSummarySource | null
  relatedAmounts?: InvoiceIssuedSummaryRelatedAmounts
  previousRelatedAmounts?: InvoiceIssuedSummaryRelatedAmounts
  nextRelatedAmounts?: InvoiceIssuedSummaryRelatedAmounts
  now?: Date
}) {
  const db = params.db || prisma
  const previousRelatedAmounts = params.previousRelatedAmounts || params.relatedAmounts
  const nextRelatedAmounts = params.nextRelatedAmounts || params.relatedAmounts

  const previousRow = buildInvoiceIssuedSummaryAggregate({
    invoice: params.previousRecord,
    relatedAmounts: previousRelatedAmounts,
    now: params.now
  })
  const nextRow = buildInvoiceIssuedSummaryAggregate({
    invoice: params.nextRecord,
    relatedAmounts: nextRelatedAmounts,
    now: params.now
  })

  await applyInvoiceIssuedSummaryDelta({
    db,
    row: previousRow,
    delta: -1
  })

  await applyInvoiceIssuedSummaryDelta({
    db,
    row: nextRow,
    delta: 1
  })
}

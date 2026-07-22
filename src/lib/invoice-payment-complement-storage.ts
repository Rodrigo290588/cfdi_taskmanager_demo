import { Prisma, PrismaClient } from '@prisma/client'
import { DOMParser } from '@xmldom/xmldom'

type DbClient = PrismaClient | Prisma.TransactionClient

type PaymentComplementDetailInput = {
  relatedInvoiceUuid: string
  paymentNodeIndex: number
  paymentDate: Date
  paymentSeries: string | null
  paymentFolio: string | null
  montoTotalPagos: number
  baseP: number
  importeP: number
  impPagado: number
  impSaldoAnt: number
  impSaldoInsoluto: number
  monedaP: string
  monedaDR: string
  equivalenciaDR: number
  numParcialidad: number
}

function getElementsByLocalName(root: Document | Element, localName: string) {
  return Array.from(root.getElementsByTagName('*')).filter(element => {
    const parts = element.nodeName.split(':')
    return parts[parts.length - 1] === localName
  })
}

function isInsideAddenda(node: Element) {
  let current = node.parentNode

  while (current && 'nodeName' in current) {
    const nodeName = String(current.nodeName || '')
    const parts = nodeName.split(':')
    if (parts[parts.length - 1] === 'Addenda') {
      return true
    }
    current = current.parentNode
  }

  return false
}

function getAttributeValue(node: Element | null | undefined, attributeName: string) {
  return (node?.getAttribute(attributeName) || '').trim()
}

function normalizeUpperText(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function toNumber(value: string | null | undefined) {
  const normalized = normalizeText(value).replace(/,/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function toDecimal(value: number) {
  return new Prisma.Decimal((Number.isFinite(value) ? value : 0).toFixed(6))
}

function toDate(value: string | null | undefined, fallback: Date) {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback
}

function extractPagoTaxTotals(pagoNode: Element) {
  const impuestosP = getElementsByLocalName(pagoNode, 'ImpuestosP')
  let baseP = 0
  let importeP = 0

  impuestosP.forEach(impNode => {
    const trasladosP = getElementsByLocalName(impNode, 'TrasladoP')
    trasladosP.forEach(trasladoP => {
      if (normalizeUpperText(getAttributeValue(trasladoP, 'ImpuestoP')) !== '002') {
        return
      }

      baseP += toNumber(getAttributeValue(trasladoP, 'BaseP'))
      importeP += toNumber(getAttributeValue(trasladoP, 'ImporteP'))
    })
  })

  return {
    baseP,
    importeP
  }
}

export function extractInvoicePaymentComplementDetails(params: {
  xmlContent: string
  fallbackPaymentDate: Date
  fallbackCurrency?: string | null
  fallbackSeries?: string | null
  fallbackFolio?: string | null
}) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(params.xmlContent, 'text/xml')
  const comprobante = getElementsByLocalName(doc, 'Comprobante')[0] || null
  const tipoComprobante = normalizeUpperText(getAttributeValue(comprobante, 'TipoDeComprobante'))

  if (tipoComprobante !== 'P') {
    return []
  }

  const totales = getElementsByLocalName(doc, 'Totales')[0] || null
  const montoTotalPagos = toNumber(getAttributeValue(totales, 'MontoTotalPagos'))
  const fallbackSeries = normalizeText(getAttributeValue(comprobante, 'Serie')) || params.fallbackSeries || null
  const fallbackFolio = normalizeText(getAttributeValue(comprobante, 'Folio')) || params.fallbackFolio || null
  const fallbackCurrency = normalizeUpperText(getAttributeValue(comprobante, 'Moneda')) || normalizeUpperText(params.fallbackCurrency) || 'MXN'

  const pagos = getElementsByLocalName(doc, 'Pago').filter(node => !isInsideAddenda(node))
  const details: PaymentComplementDetailInput[] = []

  pagos.forEach((pagoNode, pagoIndex) => {
    const paymentDate = toDate(getAttributeValue(pagoNode, 'FechaPago'), params.fallbackPaymentDate)
    const monedaP = normalizeUpperText(getAttributeValue(pagoNode, 'MonedaP')) || fallbackCurrency
    const montoPagoNode = toNumber(getAttributeValue(pagoNode, 'Monto'))
    const taxTotals = extractPagoTaxTotals(pagoNode)
    const doctosRelacionados = getElementsByLocalName(pagoNode, 'DoctoRelacionado')

    doctosRelacionados.forEach(doctoNode => {
      const relatedInvoiceUuid = normalizeUpperText(getAttributeValue(doctoNode, 'IdDocumento'))
      if (!relatedInvoiceUuid) {
        return
      }

      details.push({
        relatedInvoiceUuid,
        paymentNodeIndex: pagoIndex + 1,
        paymentDate,
        paymentSeries: fallbackSeries,
        paymentFolio: fallbackFolio,
        montoTotalPagos: montoTotalPagos > 0 ? montoTotalPagos : montoPagoNode,
        baseP: taxTotals.baseP,
        importeP: taxTotals.importeP,
        impPagado: toNumber(getAttributeValue(doctoNode, 'ImpPagado')),
        impSaldoAnt: toNumber(getAttributeValue(doctoNode, 'ImpSaldoAnt')),
        impSaldoInsoluto: toNumber(getAttributeValue(doctoNode, 'ImpSaldoInsoluto')),
        monedaP,
        monedaDR: normalizeUpperText(getAttributeValue(doctoNode, 'MonedaDR')) || monedaP,
        equivalenciaDR: toNumber(getAttributeValue(doctoNode, 'EquivalenciaDR')) || 1,
        numParcialidad: Math.trunc(toNumber(getAttributeValue(doctoNode, 'NumParcialidad'))) || 1
      })
    })
  })

  return details
}

export async function upsertInvoicePaymentComplementDetails(
  prismaClient: DbClient,
  params: {
    issuerFiscalEntityId: string
    paymentInvoiceId: string
    paymentInvoiceUuid: string
    xmlContent: string
    satStatusSnapshot: string
    fallbackPaymentDate: Date
    fallbackCurrency?: string | null
    fallbackSeries?: string | null
    fallbackFolio?: string | null
  }
) {
  const details = extractInvoicePaymentComplementDetails({
    xmlContent: params.xmlContent,
    fallbackPaymentDate: params.fallbackPaymentDate,
    fallbackCurrency: params.fallbackCurrency,
    fallbackSeries: params.fallbackSeries,
    fallbackFolio: params.fallbackFolio
  })

  await prismaClient.invoicePaymentComplementDetail.deleteMany({
    where: {
      paymentInvoiceId: params.paymentInvoiceId
    }
  })

  if (details.length === 0) {
    return {
      totalRows: 0
    }
  }

  const fiscalEntity = await prismaClient.fiscalEntity.findUnique({
    where: { id: params.issuerFiscalEntityId },
    select: { organizationId: true }
  })

  if (!fiscalEntity?.organizationId) {
    throw new Error(`No se encontro organizationId para issuerFiscalEntityId ${params.issuerFiscalEntityId}`)
  }

  const relatedInvoiceUuids = Array.from(new Set(details.map(detail => detail.relatedInvoiceUuid)))
  const relatedInvoices = await prismaClient.invoice.findMany({
    where: {
      uuid: { in: relatedInvoiceUuids }
    },
    select: {
      id: true,
      uuid: true
    }
  })

  const relatedInvoiceIdByUuid = new Map(
    relatedInvoices.map(invoice => [normalizeUpperText(invoice.uuid), invoice.id])
  )

  await prismaClient.invoicePaymentComplementDetail.createMany({
    data: details.map(detail => ({
      organizationId: fiscalEntity.organizationId,
      issuerFiscalEntityId: params.issuerFiscalEntityId,
      paymentInvoiceId: params.paymentInvoiceId,
      paymentInvoiceUuid: normalizeUpperText(params.paymentInvoiceUuid),
      relatedInvoiceId: relatedInvoiceIdByUuid.get(detail.relatedInvoiceUuid) || null,
      relatedInvoiceUuid: detail.relatedInvoiceUuid,
      paymentNodeIndex: detail.paymentNodeIndex,
      paymentDate: detail.paymentDate,
      paymentSeries: detail.paymentSeries,
      paymentFolio: detail.paymentFolio,
      montoTotalPagos: toDecimal(detail.montoTotalPagos),
      baseP: toDecimal(detail.baseP),
      importeP: toDecimal(detail.importeP),
      impPagado: toDecimal(detail.impPagado),
      impSaldoAnt: toDecimal(detail.impSaldoAnt),
      impSaldoInsoluto: toDecimal(detail.impSaldoInsoluto),
      monedaP: detail.monedaP,
      monedaDR: detail.monedaDR,
      equivalenciaDR: toDecimal(detail.equivalenciaDR),
      numParcialidad: detail.numParcialidad,
      satStatusSnapshot: normalizeUpperText(params.satStatusSnapshot) || 'SIN_ESTATUS'
    }))
  })

  return {
    totalRows: details.length
  }
}

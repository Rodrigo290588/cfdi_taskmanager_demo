import { DOMParser } from '@xmldom/xmldom'
import { Prisma } from '@prisma/client'
import { decryptXmlContent } from '@/lib/provider-cfdi-storage'
import { prisma } from '@/lib/prisma'

type ProviderTaxXmlSourceRecord = {
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  receiver_rfc: string
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  total: unknown
  xml_ciphertext: string
  xml_iv: string
  xml_auth_tag: string
  xml_encryption_alg: string
}

export type IvaAccreditableBreakdownEntry = {
  rate: string
  label: string
  amount: number
}

export type IvaAccreditableDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  total: number
  rate: string
  rateLabel: string
  taxAmount: number
}

export type RetainedTaxDrilldownRow = {
  uuid: string
  fileName: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  cfdiType: string
  series: string
  folio: string
  issuanceDate: string | null
  total: number
  taxCode: string
  taxLabel: string
  taxAmount: number
}

export type TaxPeriodSummary = {
  ivaAccreditableTotal: number
  ivaAccreditableBreakdown: IvaAccreditableBreakdownEntry[]
  retainedTaxesTotal: number
  retainedIsrTotal: number
  retainedIvaTotal: number
}

function normalizeXmlText(value: string | null | undefined) {
  return (value || '').trim()
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function getDirectChildrenByLocalName(root: Element, localName: string) {
  const normalizedLocalName = localName.toLowerCase()
  const matches: Element[] = []

  for (let index = 0; index < root.childNodes.length; index += 1) {
    const childNode = root.childNodes.item(index)
    if (!childNode || childNode.nodeType !== 1) continue

    const element = childNode as Element
    const currentLocalName = (element.localName || element.nodeName.split(':').pop() || '').toLowerCase()
    if (currentLocalName === normalizedLocalName) {
      matches.push(element)
    }
  }

  return matches
}

function getFirstDirectChildByLocalName(root: Element, localName: string) {
  return getDirectChildrenByLocalName(root, localName)[0] || null
}

function formatTaxRateLabel(rate: string) {
  const normalizedRate = Number(rate)
  if (!Number.isFinite(normalizedRate)) {
    return rate
  }

  return `${(normalizedRate * 100).toFixed(2)}%`
}

function buildBaseRow(record: ProviderTaxXmlSourceRecord) {
  return {
    uuid: record.uuid,
    fileName: record.file_name,
    issuerRfc: record.issuer_rfc,
    issuerName: record.issuer_name || record.issuer_rfc,
    receiverRfc: record.receiver_rfc,
    cfdiType: record.cfdi_type,
    series: record.series || '',
    folio: record.folio || '',
    issuanceDate: record.issuance_date ? new Date(record.issuance_date).toISOString() : null,
    total: toNumber(record.total)
  }
}

function extractIvaAccreditableBreakdownFromXml(xmlContent: string) {
  const parser = new DOMParser()
  const document = parser.parseFromString(xmlContent, 'text/xml')
  const comprobante = document.documentElement
  if (!comprobante) {
    return [] as IvaAccreditableBreakdownEntry[]
  }

  const comprobanteLocalName = (comprobante.localName || comprobante.nodeName.split(':').pop() || '').toLowerCase()
  if (comprobanteLocalName !== 'comprobante') {
    return [] as IvaAccreditableBreakdownEntry[]
  }

  const impuestosNode = getFirstDirectChildByLocalName(comprobante, 'Impuestos')
  if (!impuestosNode) {
    return [] as IvaAccreditableBreakdownEntry[]
  }

  const trasladosNode = getFirstDirectChildByLocalName(impuestosNode, 'Traslados')
  if (!trasladosNode) {
    return [] as IvaAccreditableBreakdownEntry[]
  }

  const breakdown = new Map<string, number>()

  getDirectChildrenByLocalName(trasladosNode, 'Traslado').forEach((trasladoNode) => {
    const impuesto = normalizeXmlText(trasladoNode.getAttribute('Impuesto')).toUpperCase()
    if (impuesto !== '002') {
      return
    }

    const tasaRaw = normalizeXmlText(trasladoNode.getAttribute('TasaOCuota'))
    const importe = Number(normalizeXmlText(trasladoNode.getAttribute('Importe')) || '0')
    if (!tasaRaw || !Number.isFinite(importe)) {
      return
    }

    const tasa = Number(tasaRaw)
    const normalizedRate = Number.isFinite(tasa) ? tasa.toFixed(6) : tasaRaw
    breakdown.set(normalizedRate, (breakdown.get(normalizedRate) || 0) + importe)
  })

  return Array.from(breakdown.entries())
    .map(([rate, amount]) => ({
      rate,
      label: formatTaxRateLabel(rate),
      amount
    }))
    .sort((left, right) => Number(right.rate) - Number(left.rate))
}

function extractRetentionBreakdownFromXml(xmlContent: string) {
  const parser = new DOMParser()
  const document = parser.parseFromString(xmlContent, 'text/xml')
  const comprobante = document.documentElement
  if (!comprobante) {
    return {
      isrAmount: 0,
      ivaAmount: 0
    }
  }

  const comprobanteLocalName = (comprobante.localName || comprobante.nodeName.split(':').pop() || '').toLowerCase()
  if (comprobanteLocalName !== 'comprobante') {
    return {
      isrAmount: 0,
      ivaAmount: 0
    }
  }

  const impuestosNode = getFirstDirectChildByLocalName(comprobante, 'Impuestos')
  if (!impuestosNode) {
    return {
      isrAmount: 0,
      ivaAmount: 0
    }
  }

  const retencionesNode = getFirstDirectChildByLocalName(impuestosNode, 'Retenciones')
  if (!retencionesNode) {
    return {
      isrAmount: 0,
      ivaAmount: 0
    }
  }

  let isrAmount = 0
  let ivaAmount = 0

  getDirectChildrenByLocalName(retencionesNode, 'Retencion').forEach((retencionNode) => {
    const impuesto = normalizeXmlText(retencionNode.getAttribute('Impuesto')).toUpperCase()
    const importe = Number(normalizeXmlText(retencionNode.getAttribute('Importe')) || '0')
    if (!Number.isFinite(importe)) {
      return
    }

    if (impuesto === '001') {
      isrAmount += importe
    }

    if (impuesto === '002') {
      ivaAmount += importe
    }
  })

  return {
    isrAmount,
    ivaAmount
  }
}

async function queryProviderTaxXmlRecords(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  return prisma.$queryRaw<ProviderTaxXmlSourceRecord[]>(
    Prisma.sql`
      SELECT
        p.uuid,
        p.file_name,
        p.issuer_rfc,
        p.issuer_name,
        p.receiver_rfc,
        p.cfdi_type,
        p.series,
        p.folio,
        p.issuance_date,
        p.total,
        b.xml_ciphertext,
        b.xml_iv,
        b.xml_auth_tag,
        b.xml_encryption_alg
      FROM provider_uploaded_cfdis p
      INNER JOIN provider_uploaded_cfdi_blobs b
        ON b.provider_uploaded_cfdi_id = p.id
      WHERE p.organization_id = ${params.organizationId}
        AND p.receiver_company_id = ${params.companyId}
        AND p.validation_status = 'APPROVED'
        AND (p.sat_estado IS NULL OR p.sat_estado <> 'CANCELADO')
        ${params.startDate ? Prisma.sql`AND p.issuance_date >= ${params.startDate}` : Prisma.empty}
        ${params.endDate ? Prisma.sql`AND p.issuance_date <= ${params.endDate}` : Prisma.empty}
    `
  )
}

async function buildProviderTaxPeriodDetails(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const records = await queryProviderTaxXmlRecords(params)
  const ivaRows: IvaAccreditableDrilldownRow[] = []
  const retainedTaxRows: RetainedTaxDrilldownRow[] = []

  for (const record of records) {
    const xmlContent = decryptXmlContent({
      ciphertext: record.xml_ciphertext,
      iv: record.xml_iv,
      authTag: record.xml_auth_tag,
      algorithm: record.xml_encryption_alg
    })

    const baseRow = buildBaseRow(record)

    extractIvaAccreditableBreakdownFromXml(xmlContent).forEach((entry) => {
      ivaRows.push({
        ...baseRow,
        rate: entry.rate,
        rateLabel: entry.label,
        taxAmount: entry.amount
      })
    })

    const retentionBreakdown = extractRetentionBreakdownFromXml(xmlContent)
    if (retentionBreakdown.isrAmount > 0) {
      retainedTaxRows.push({
        ...baseRow,
        taxCode: '001',
        taxLabel: 'ISR retenido',
        taxAmount: retentionBreakdown.isrAmount
      })
    }

    if (retentionBreakdown.ivaAmount > 0) {
      retainedTaxRows.push({
        ...baseRow,
        taxCode: '002',
        taxLabel: 'IVA retenido',
        taxAmount: retentionBreakdown.ivaAmount
      })
    }
  }

  return {
    ivaRows,
    retainedTaxRows
  }
}

export async function getTaxPeriodSummary(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}): Promise<TaxPeriodSummary> {
  const { ivaRows, retainedTaxRows } = await buildProviderTaxPeriodDetails(params)

  const ivaBreakdownMap = new Map<string, { label: string; amount: number }>()
  ivaRows.forEach((row) => {
    const currentEntry = ivaBreakdownMap.get(row.rate) || {
      label: row.rateLabel,
      amount: 0
    }
    currentEntry.amount += row.taxAmount
    ivaBreakdownMap.set(row.rate, currentEntry)
  })

  const ivaAccreditableBreakdown = Array.from(ivaBreakdownMap.entries())
    .map(([rate, entry]) => ({
      rate,
      label: entry.label,
      amount: entry.amount
    }))
    .sort((left, right) => Number(right.rate) - Number(left.rate))

  const ivaAccreditableTotal = ivaAccreditableBreakdown.reduce((acc, entry) => acc + entry.amount, 0)
  const retainedIsrTotal = retainedTaxRows
    .filter((row) => row.taxCode === '001')
    .reduce((acc, row) => acc + row.taxAmount, 0)
  const retainedIvaTotal = retainedTaxRows
    .filter((row) => row.taxCode === '002')
    .reduce((acc, row) => acc + row.taxAmount, 0)

  return {
    ivaAccreditableTotal,
    ivaAccreditableBreakdown,
    retainedTaxesTotal: retainedIsrTotal + retainedIvaTotal,
    retainedIsrTotal,
    retainedIvaTotal
  }
}

export async function listIvaAccreditableDrilldown(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const { ivaRows } = await buildProviderTaxPeriodDetails(params)

  return ivaRows.sort((left, right) => {
    const leftDate = left.issuanceDate ? new Date(left.issuanceDate).getTime() : 0
    const rightDate = right.issuanceDate ? new Date(right.issuanceDate).getTime() : 0
    return rightDate - leftDate
  })
}

export async function listRetainedTaxDrilldown(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const { retainedTaxRows } = await buildProviderTaxPeriodDetails(params)

  return retainedTaxRows.sort((left, right) => {
    const leftDate = left.issuanceDate ? new Date(left.issuanceDate).getTime() : 0
    const rightDate = right.issuanceDate ? new Date(right.issuanceDate).getTime() : 0
    return rightDate - leftDate
  })
}

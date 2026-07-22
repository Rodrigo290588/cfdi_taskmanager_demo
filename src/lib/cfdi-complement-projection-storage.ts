import { Prisma, PrismaClient } from '@prisma/client'
import {
  detectMinimalComplementIndex,
  extractWorkpaperProjectionAttributes,
  normalizeProjectionText,
  normalizeProjectionUpperText,
  workpaperAttributeKeySet,
  workpaperNumericAttributeKeySet
} from '@/lib/cfdi-workpaper-projection'

type DbClient = PrismaClient | Prisma.TransactionClient
type ComplementAttributeRow = {
  complementType: string
  attributeKey: string
  valueText: string | null
  valueNumber: Prisma.Decimal | null
  valueDate: Date | null
  valueBoolean: boolean | null
  valueSearch: string
}

function buildAttributeRows(xml: string): ComplementAttributeRow[] {
  const projection = extractWorkpaperProjectionAttributes(xml)

  return Object.entries(projection)
    .filter(([key]) => workpaperAttributeKeySet.has(key))
    .flatMap<ComplementAttributeRow>(([attributeKey, value]) => {
      if (value === null || typeof value === 'undefined' || value === '') {
        return []
      }

      const complementType = attributeKey === 'tipoRelacion' || attributeKey === 'cfdiRelacionado'
        ? 'CFDI_RELACIONADOS'
        : attributeKey === 'domicilioFiscalReceptor'
          || attributeKey === 'residenciaFiscal'
          || attributeKey === 'numRegIdTrib'
          || attributeKey === 'regimenFiscalReceptor'
          || attributeKey === 'cfdiUsage'
          ? 'RECEPTOR'
          : attributeKey === 'certificationPac'
            ? 'TIMBRE'
          : attributeKey === 'totalImpuestosTrasladados'
            || attributeKey === 'totalImpuestosRetenidos'
            ? 'IMPUESTOS'
            : 'COMPROBANTE'

      if (workpaperNumericAttributeKeySet.has(attributeKey)) {
        const numericValue = Number(value)
        if (!Number.isFinite(numericValue)) {
          return []
        }

        return [{
          complementType,
          attributeKey,
          valueText: String(value),
          valueNumber: new Prisma.Decimal(numericValue.toFixed(6)),
          valueDate: null,
          valueBoolean: null,
          valueSearch: normalizeProjectionUpperText(String(value))
        }]
      }

      const textValue = normalizeProjectionText(String(value))
      if (!textValue) {
        return []
      }

      return [{
        complementType,
        attributeKey,
        valueText: textValue,
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueSearch: normalizeProjectionUpperText(textValue)
      }]
    })
}

export async function upsertInvoiceComplementProjection(
  prismaClient: DbClient,
  params: {
    invoiceId: string
    xmlContent: string
  }
) {
  const complementIndex = detectMinimalComplementIndex(params.xmlContent)
  const attributeRows = buildAttributeRows(params.xmlContent)

  await prismaClient.invoiceComplementIndex.upsert({
    where: { invoiceId: params.invoiceId },
    create: {
      invoiceId: params.invoiceId,
      ...complementIndex
    },
    update: {
      ...complementIndex
    }
  })

  await prismaClient.invoiceComplementAttribute.deleteMany({
    where: { invoiceId: params.invoiceId }
  })

  if (attributeRows.length > 0) {
    await prismaClient.invoiceComplementAttribute.createMany({
      data: attributeRows.map(row => ({
        invoiceId: params.invoiceId,
        ...row
      }))
    })
  }
}

export async function upsertProviderUploadedCfdiComplementProjection(
  prismaClient: DbClient,
  params: {
    providerUploadedCfdiId: string
    xmlContent: string
  }
) {
  const complementIndex = detectMinimalComplementIndex(params.xmlContent)
  const attributeRows = buildAttributeRows(params.xmlContent)

  await prismaClient.providerUploadedCfdiComplementIndex.upsert({
    where: { providerUploadedCfdiId: params.providerUploadedCfdiId },
    create: {
      providerUploadedCfdiId: params.providerUploadedCfdiId,
      ...complementIndex
    },
    update: {
      ...complementIndex
    }
  })

  await prismaClient.providerUploadedCfdiComplementAttribute.deleteMany({
    where: { providerUploadedCfdiId: params.providerUploadedCfdiId }
  })

  if (attributeRows.length > 0) {
    await prismaClient.providerUploadedCfdiComplementAttribute.createMany({
      data: attributeRows.map(row => ({
        providerUploadedCfdiId: params.providerUploadedCfdiId,
        ...row
      }))
    })
  }
}

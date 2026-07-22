export type SupportedComplementType = 'PAGOS' | 'NOMINA' | 'CARTA_PORTE' | 'COMERCIO_EXTERIOR'

export type WorkpaperProjectionValue = string | number | boolean | null
export type WorkpaperProjectionMap = Record<string, WorkpaperProjectionValue>

export type WorkpaperProjectionColumn = {
  key: string
  label: string
  group: string
  kind: 'projectionAttribute' | 'complementFlag' | 'complementVersion'
  dataType: 'text' | 'number' | 'boolean'
  complementType?: SupportedComplementType
}

export const WORKPAPER_COMPLEMENT_FLAG_KEYS = [
  'hasPagos',
  'hasNomina',
  'hasCartaPorte',
  'hasComercioExterior'
] as const

export const WORKPAPER_COMPLEMENT_VERSION_KEYS = [
  'pagosVersion',
  'nominaVersion',
  'cartaPorteVersion',
  'comercioExteriorVersion'
] as const

export const WORKPAPER_NUMERIC_ATTRIBUTE_KEYS = [
  'totalImpuestosTrasladados',
  'totalImpuestosRetenidos'
] as const

export const WORKPAPER_ATTRIBUTE_KEYS = [
  'version',
  'noCertificado',
  'certificado',
  'tipoRelacion',
  'cfdiRelacionado',
  'domicilioFiscalReceptor',
  'residenciaFiscal',
  'numRegIdTrib',
  'regimenFiscalReceptor',
  'cfdiUsage',
  'placeOfExpedition',
  'exportKey',
  'objectTaxComprobante',
  'paymentConditions',
  'certificationPac',
  ...WORKPAPER_NUMERIC_ATTRIBUTE_KEYS
] as const

export const WORKPAPER_PROJECTION_COLUMNS: WorkpaperProjectionColumn[] = [
  { key: 'version', label: 'Versión', group: '<cfdi:Comprobante>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'noCertificado', label: 'No. Certificado', group: '<cfdi:Comprobante>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'certificado', label: 'Certificado', group: '<cfdi:Comprobante>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'tipoRelacion', label: 'Tipo Relación', group: '<cfdi:CfdiRelacionados>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'cfdiRelacionado', label: 'CFDIRelacionado', group: '<cfdi:CfdiRelacionados>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'domicilioFiscalReceptor', label: 'Domicilio Fiscal Receptor', group: '<cfdi:Receptor>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'residenciaFiscal', label: 'Residencia Fiscal', group: '<cfdi:Receptor>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'numRegIdTrib', label: 'Num Reg Id Trib', group: '<cfdi:Receptor>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'regimenFiscalReceptor', label: 'Régimen Fiscal Receptor', group: '<cfdi:Receptor>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'cfdiUsage', label: 'Uso CFDI', group: '<cfdi:Receptor>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'placeOfExpedition', label: 'Lugar Expedición', group: '<cfdi:Comprobante>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'exportKey', label: 'Exportación', group: '<cfdi:Comprobante>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'objectTaxComprobante', label: 'Objeto Impuesto Comp.', group: '<cfdi:Comprobante>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'paymentConditions', label: 'Condiciones de Pago', group: '<cfdi:Comprobante>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'certificationPac', label: 'PAC', group: '<tfd:TimbreFiscalDigital>', kind: 'projectionAttribute', dataType: 'text' },
  { key: 'totalImpuestosTrasladados', label: 'Total Impuestos Trasladados', group: '<cfdi:Impuestos>', kind: 'projectionAttribute', dataType: 'number' },
  { key: 'totalImpuestosRetenidos', label: 'Total Impuestos Retenidos', group: '<cfdi:Impuestos>', kind: 'projectionAttribute', dataType: 'number' },
  { key: 'hasPagos', label: 'Tiene Pagos', group: '<pago20:Pagos>', kind: 'complementFlag', dataType: 'boolean', complementType: 'PAGOS' },
  { key: 'pagosVersion', label: 'Versión Pagos', group: '<pago20:Pagos>', kind: 'complementVersion', dataType: 'text', complementType: 'PAGOS' },
  { key: 'hasNomina', label: 'Tiene Nómina', group: '<nomina12:Nomina>', kind: 'complementFlag', dataType: 'boolean', complementType: 'NOMINA' },
  { key: 'nominaVersion', label: 'Versión Nómina', group: '<nomina12:Nomina>', kind: 'complementVersion', dataType: 'text', complementType: 'NOMINA' },
  { key: 'hasCartaPorte', label: 'Tiene Carta Porte', group: '<cartaporte:CartaPorte>', kind: 'complementFlag', dataType: 'boolean', complementType: 'CARTA_PORTE' },
  { key: 'cartaPorteVersion', label: 'Versión Carta Porte', group: '<cartaporte:CartaPorte>', kind: 'complementVersion', dataType: 'text', complementType: 'CARTA_PORTE' },
  { key: 'hasComercioExterior', label: 'Tiene Comercio Exterior', group: '<cce20:ComercioExterior>', kind: 'complementFlag', dataType: 'boolean', complementType: 'COMERCIO_EXTERIOR' },
  { key: 'comercioExteriorVersion', label: 'Versión Comercio Exterior', group: '<cce20:ComercioExterior>', kind: 'complementVersion', dataType: 'text', complementType: 'COMERCIO_EXTERIOR' }
]

export const workpaperAttributeKeySet = new Set<string>(WORKPAPER_ATTRIBUTE_KEYS)
export const workpaperNumericAttributeKeySet = new Set<string>(WORKPAPER_NUMERIC_ATTRIBUTE_KEYS)
export const workpaperComplementFlagKeySet = new Set<string>(WORKPAPER_COMPLEMENT_FLAG_KEYS)
export const workpaperComplementVersionKeySet = new Set<string>(WORKPAPER_COMPLEMENT_VERSION_KEYS)

export function normalizeProjectionText(value: string | null | undefined) {
  return (value || '').trim()
}

export function normalizeProjectionUpperText(value: string | null | undefined) {
  return normalizeProjectionText(value).toUpperCase()
}

function getTagAttributes(xml: string, tagName: string) {
  const regex = new RegExp(`<(?:[^:>]+:)?${tagName}\\b([^>]*)>`, 'i')
  const match = xml.match(regex)
  return match?.[1] || ''
}

function getTagAttribute(xml: string, tagName: string, attributeName: string) {
  const attributes = getTagAttributes(xml, tagName)
  if (!attributes) return ''

  const regex = new RegExp(`\\b${attributeName}\\s*=\\s*"([^"]+)"`, 'i')
  return attributes.match(regex)?.[1] || ''
}

function getAllTagAttributeValues(xml: string, tagName: string, attributeName: string) {
  const regex = new RegExp(`<(?:[^:>]+:)?${tagName}\\b([^>]*)>`, 'gi')
  const values = new Set<string>()

  for (const match of xml.matchAll(regex)) {
    const attrs = match[1] || ''
    const attrRegex = new RegExp(`\\b${attributeName}\\s*=\\s*"([^"]+)"`, 'i')
    const value = attrs.match(attrRegex)?.[1]
    if (value) {
      values.add(value)
    }
  }

  return Array.from(values)
}

function getNumericAttributeValue(xml: string, tagName: string, attributeName: string) {
  const rawValue = getTagAttribute(xml, tagName, attributeName)
  if (!rawValue) return null

  const parsed = Number(rawValue.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function detectComplementVersion(xml: string, tagName: string, namespaceFragment: string) {
  const directVersion = getTagAttribute(xml, tagName, 'Version')
  if (directVersion) {
    return directVersion
  }

  const namespaceRegex = new RegExp(`xmlns:[^=]+\\s*=\\s*"[^"]*${namespaceFragment}([^"/]*)"`, 'i')
  const namespaceMatch = xml.match(namespaceRegex)
  return namespaceMatch?.[1] || ''
}

export function detectMinimalComplementIndex(xml: string) {
  const hasPagos = /<(?:[^:>]+:)?Pagos\b/i.test(xml) || /xmlns:[^=]+="http:\/\/www\.sat\.gob\.mx\/Pagos/i.test(xml)
  const hasNomina = /<(?:[^:>]+:)?Nomina\b/i.test(xml) || /xmlns:[^=]+="http:\/\/www\.sat\.gob\.mx\/nomina/i.test(xml)
  const hasCartaPorte = /<(?:[^:>]+:)?CartaPorte\b/i.test(xml) || /xmlns:[^=]+="http:\/\/www\.sat\.gob\.mx\/CartaPorte/i.test(xml)
  const hasComercioExterior = /<(?:[^:>]+:)?ComercioExterior\b/i.test(xml) || /xmlns:[^=]+="http:\/\/www\.sat\.gob\.mx\/ComercioExterior/i.test(xml)

  return {
    hasPagos,
    pagosVersion: hasPagos ? detectComplementVersion(xml, 'Pagos', 'Pagos') || null : null,
    hasNomina,
    nominaVersion: hasNomina ? detectComplementVersion(xml, 'Nomina', 'nomina') || null : null,
    hasCartaPorte,
    cartaPorteVersion: hasCartaPorte ? detectComplementVersion(xml, 'CartaPorte', 'CartaPorte') || null : null,
    hasComercioExterior,
    comercioExteriorVersion: hasComercioExterior ? detectComplementVersion(xml, 'ComercioExterior', 'ComercioExterior') || null : null
  }
}

export function extractWorkpaperProjectionAttributes(xml: string): WorkpaperProjectionMap {
  const tipoRelacion = getAllTagAttributeValues(xml, 'CfdiRelacionados', 'TipoRelacion').join(', ')
  const cfdiRelacionado = getAllTagAttributeValues(xml, 'CfdiRelacionado', 'UUID').join(', ')

  return {
    version: getTagAttribute(xml, 'Comprobante', 'Version') || null,
    noCertificado: getTagAttribute(xml, 'Comprobante', 'NoCertificado') || null,
    certificado: getTagAttribute(xml, 'Comprobante', 'Certificado') || null,
    tipoRelacion: tipoRelacion || null,
    cfdiRelacionado: cfdiRelacionado || null,
    domicilioFiscalReceptor: getTagAttribute(xml, 'Receptor', 'DomicilioFiscalReceptor') || null,
    residenciaFiscal: getTagAttribute(xml, 'Receptor', 'ResidenciaFiscal') || null,
    numRegIdTrib: getTagAttribute(xml, 'Receptor', 'NumRegIdTrib') || null,
    regimenFiscalReceptor: getTagAttribute(xml, 'Receptor', 'RegimenFiscalReceptor') || null,
    cfdiUsage: getTagAttribute(xml, 'Receptor', 'UsoCFDI') || null,
    placeOfExpedition: getTagAttribute(xml, 'Comprobante', 'LugarExpedicion') || null,
    exportKey: getTagAttribute(xml, 'Comprobante', 'Exportacion') || null,
    objectTaxComprobante: getTagAttribute(xml, 'Comprobante', 'ObjetoImp') || null,
    paymentConditions: getTagAttribute(xml, 'Comprobante', 'CondicionesDePago') || null,
    certificationPac: getTagAttribute(xml, 'TimbreFiscalDigital', 'RfcProvCertif') || null,
    totalImpuestosTrasladados: getNumericAttributeValue(xml, 'Impuestos', 'TotalImpuestosTrasladados'),
    totalImpuestosRetenidos: getNumericAttributeValue(xml, 'Impuestos', 'TotalImpuestosRetenidos')
  }
}

export function buildProjectionMap(params: {
  attributes: Array<{
    attributeKey: string
    valueText?: string | null
    valueNumber?: string | number | { toString(): string } | null
    valueBoolean?: boolean | null
  }>
  complementIndex?: {
    hasPagos?: boolean | null
    pagosVersion?: string | null
    hasNomina?: boolean | null
    nominaVersion?: string | null
    hasCartaPorte?: boolean | null
    cartaPorteVersion?: string | null
    hasComercioExterior?: boolean | null
    comercioExteriorVersion?: string | null
  } | null
}) {
  const projection: WorkpaperProjectionMap = {}

  for (const attribute of params.attributes) {
    if (!attribute.attributeKey) continue

    if (attribute.valueNumber !== null && typeof attribute.valueNumber !== 'undefined') {
      const numericValue = Number(
        typeof attribute.valueNumber === 'object'
          ? attribute.valueNumber.toString()
          : attribute.valueNumber
      )
      projection[attribute.attributeKey] = Number.isFinite(numericValue) ? numericValue : null
      continue
    }

    if (typeof attribute.valueBoolean === 'boolean') {
      projection[attribute.attributeKey] = attribute.valueBoolean
      continue
    }

    projection[attribute.attributeKey] = attribute.valueText ?? null
  }

  if (params.complementIndex) {
    projection.hasPagos = Boolean(params.complementIndex.hasPagos)
    projection.pagosVersion = params.complementIndex.pagosVersion ?? null
    projection.hasNomina = Boolean(params.complementIndex.hasNomina)
    projection.nominaVersion = params.complementIndex.nominaVersion ?? null
    projection.hasCartaPorte = Boolean(params.complementIndex.hasCartaPorte)
    projection.cartaPorteVersion = params.complementIndex.cartaPorteVersion ?? null
    projection.hasComercioExterior = Boolean(params.complementIndex.hasComercioExterior)
    projection.comercioExteriorVersion = params.complementIndex.comercioExteriorVersion ?? null
  }

  return projection
}

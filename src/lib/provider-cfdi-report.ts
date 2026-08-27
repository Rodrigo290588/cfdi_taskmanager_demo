import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { getExistingPersistedInvoiceUuids } from '@/lib/provider-cfdi-storage'
import {
  buildObjetoImpTaxViolationMessage,
  buildResicoRetentionViolationMessage,
  buildPaymentMethodVsPaymentFormViolationMessage,
  hasObjetoImpTaxViolation,
  hasPaymentMethodVsPaymentFormViolation,
  hasResicoRetentionViolation
} from '@/lib/provider-business-rules'
import { FACTRONICA_ANEXO20_OK_MESSAGE, validateCfdiWithFactronicaPac } from '@/services/factronica-pac.service'
import { SAT_STATUS_OK_MESSAGE, type SatCfdiStatusResult, validateCfdiStatusWithSat } from '@/services/sat-cfdi-status.service'
import type { PersistableProviderAcceptedCfdi } from '@/lib/provider-cfdi-storage'
import { MAX_PROVIDER_CFDI_UPLOAD } from '@/lib/provider-cfdi-report.constants'

export const PROVIDER_XML_MAX_BYTES = 2 * 1024 * 1024
export const PROVIDER_ZIP_MAX_ENTRIES = 500
export const PROVIDER_ZIP_MAX_COMPRESSION_RATIO = 103
export const PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES = 250 * 1024 * 1024
export const PROVIDER_CFDI_NUMBER_MAX_MAGNITUDE = 9_999_999_999_999

declare global {
  var __PROVIDER_TEXT_ENCODER_INSTANCE: TextEncoder | undefined
}
function getProviderTextEncoder(): TextEncoder {
  if (!globalThis.__PROVIDER_TEXT_ENCODER_INSTANCE) {
    globalThis.__PROVIDER_TEXT_ENCODER_INSTANCE = new TextEncoder()
  }
  return globalThis.__PROVIDER_TEXT_ENCODER_INSTANCE
}

interface JSZipObjectInternals {
  _data?: {
    compressedSize?: unknown
    uncompressedSize?: unknown
  }
}

const XXE_DTD_SCAN_BYTES = 4096
const XXE_DTD_BLOCK_PATTERN = /<!(?:DOCTYPE|ENTITY|NOTATION)\b/i
const PROVIDER_NUL_BYTE_PATTERN = /\u0000/

export interface ProviderDomParseResult {
  ok: true
  doc: Document
}

export interface ProviderDomParseFailure {
  ok: false
  error: string
}

export function safeParseProviderXml(
  xmlRaw: string,
  fileNameRef: string
): ProviderDomParseResult | ProviderDomParseFailure {
  const trimmed = typeof xmlRaw === 'string' ? xmlRaw : ''
  if (!trimmed) {
    return { ok: false, error: `${fileNameRef}: XML vacio. Carga un CFDI timbrado valido del SAT.` }
  }
  if (PROVIDER_NUL_BYTE_PATTERN.test(trimmed)) {
    return { ok: false, error: `${fileNameRef}: XML contiene caracteres nulos prohibidos. El archivo puede estar corrupto o manipulado.` }
  }

  const encoder = getProviderTextEncoder()
  const totalBytes = encoder.encode(trimmed).byteLength
  if (totalBytes > PROVIDER_XML_MAX_BYTES) {
    return {
      ok: false,
      error: `${fileNameRef}: XML supera el maximo permitido de ${PROVIDER_XML_MAX_BYTES} bytes (tamaño detectado: ${totalBytes}). Reduce el tamaño del archivo antes de cargarlo.`
    }
  }

  const scanSlice = trimmed.slice(0, XXE_DTD_SCAN_BYTES)
  if (XXE_DTD_BLOCK_PATTERN.test(scanSlice)) {
    return {
      ok: false,
      error: `${fileNameRef}: XML contiene declaraciones prohibidas (DOCTYPE/ENTITY/NOTATION). La estructura del archivo no corresponde a un CFDI timbrado seguro del SAT.`
    }
  }

  try {
    const parser = new DOMParser({
      errorHandler: {
        warning: (msg: unknown) => {
          const text = typeof msg === 'string' ? msg : String(msg ?? 'XML warning')
          throw new Error(`${fileNameRef}: Advertencia fatal de parseo XML - ${text.slice(0, 220)}`)
        },
        error: (msg: unknown) => {
          const text = typeof msg === 'string' ? msg : String(msg ?? 'XML error')
          throw new Error(`${fileNameRef}: Error fatal de parseo XML - ${text.slice(0, 220)}`)
        },
        fatalError: (msg: unknown) => {
          const text = typeof msg === 'string' ? msg : String(msg ?? 'XML fatal error')
          throw new Error(`${fileNameRef}: Error fatal irrecuperable de XML - ${text.slice(0, 220)}`)
        }
      }
    })
    const doc = parser.parseFromString(trimmed, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) {
      return { ok: false, error: `${fileNameRef}: el archivo no contiene un XML valido. Verifica que corresponda a un CFDI timbrado del SAT y no este dañado.` }
    }
    return { ok: true, doc }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? 'unknown XML error')
    return {
      ok: false,
      error: message.startsWith(fileNameRef + ':') || message.startsWith(`${fileNameRef}:`)
        ? message
        : `${fileNameRef}: no fue posible leer la estructura interna del XML - ${message.slice(0, 180)}`
    }
  }
}

export function parseStrictCfdiNumber(
  value: string | null | undefined,
  fieldRef: string,
  fileNameRef: string
): number {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return 0
  }
  if (raw.length > 25) {
    throw new Error(`${fileNameRef}: campo ${fieldRef} excede longitud maxima permitida (25). Valor recibido: ${raw.slice(0, 32)}`)
  }
  if (PROVIDER_NUL_BYTE_PATTERN.test(raw)) {
    throw new Error(`${fileNameRef}: campo ${fieldRef} contiene caracteres nulos prohibidos.`)
  }
  const sanitized = raw.replace(/[^\d.,\-+eE]/g, '')
  if (!sanitized || sanitized === '-' || sanitized === '+' || sanitized === '.' || sanitized === ',' || sanitized === '-.') {
    throw new Error(`${fileNameRef}: campo ${fieldRef} no es un numero decimal valido. Valor recibido: ${raw}`)
  }
  let normalized = sanitized
  const lastComma = normalized.lastIndexOf(',')
  const lastDot = normalized.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    normalized = lastComma > lastDot
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '')
  } else if (lastComma !== -1) {
    const commas = (normalized.match(/,/g) || []).length
    const decimalPartLength = normalized.slice(lastComma + 1).length
    if (commas === 1 && decimalPartLength >= 1 && decimalPartLength <= 8 && /^\d+$/.test(normalized.slice(lastComma + 1))) {
      normalized = normalized.replace(',', '.')
    } else {
      normalized = normalized.replace(/,/g, '')
    }
  }
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fileNameRef}: campo ${fieldRef} no es un numero decimal valido. Valor recibido: ${raw}`)
  }
  if (Number.isNaN(parsed)) {
    throw new Error(`${fileNameRef}: campo ${fieldRef} no es un numero valido (NaN). Valor recibido: ${raw}`)
  }
  const magnitude = Math.abs(parsed)
  if (magnitude > PROVIDER_CFDI_NUMBER_MAX_MAGNITUDE) {
    throw new Error(`${fileNameRef}: campo ${fieldRef} excede magnitud maxima permitida de $9.999T MXN. Valor detectado: ${parsed}`)
  }
  return parsed
}

export type ProviderContext = {
  memberId: string
  organizationId: string
  providerRfc: string
  providerName: string | null
  providerUploadBlockedAt?: string | null
  providerUploadBlockedReason?: string | null
  providerUploadBlockedBySystem?: boolean
  allowedCompanies: Array<{
    id: string
    rfc: string
    businessName: string
  }>
  granularPermissions?: Record<string, boolean>
}

export type ProviderReportPaymentDetail = {
  paymentUuid: string
  paymentDate: string
  paymentSeries: string | null
  paymentFolio: string | null
  montoPagado: number
  montoTotalPagos: number
  monedaPago: string
  equivalenciaDR: number
  numParcialidad: number
  impSaldoAnt: number
  impSaldoInsoluto: number
}

export type ProviderReportRow = {
  id: string
  fileName: string
  xmlContent: string
  receptorRfc: string
  providerId: string
  emisorRfc: string
  emisorNombre: string
  tipoComprobante: string
  serie: string
  folio: string
  uuid: string
  fechaComprobante: string
  fechaRecepcion: string
  metodoPago: string
  estatusPago: string
  fechaPago: string
  subtotal: number
  totalImpuestosTrasladados: number
  totalImpuestosRetenidos: number
  descuento: number
  total: number
  montoPago: number
  monedaPago: string
  totalOriginal: number
  totalPagado: number
  saldoPorCobrar: number
  moneda: string
  estatus: string
  satCodigoEstatus: string
  satEstado: string
  satEsCancelable: string
  satEstatusCancelacion: string
  satValidacionEFOS: string
  payments: ProviderReportPaymentDetail[]
}

export type ProviderXmlValidationEmailResult = {
  fileName: string
  emisorNombre: string
  emisorRfc: string
  receptorRfc: string
  uuid: string
  total: string
  fechaEmision: string
  fechaCarga: string
  validationAnexo20: string
  validationSat: string
  status: 'APPROVED' | 'REJECTED'
  rejectionReason: string
}

type XmlCandidate = {
  name: string
  xml: string
}

export type ProviderXmlCandidateInput = {
  name: string
  xml: string
}

type ParsedInvoiceCandidate = {
  kind: 'invoice'
  fileName: string
  xmlContent: string
  uuid: string
  receptorRfc: string
  receptorNombre: string
  emisorRfc: string
  emisorNombre: string
  tipoComprobante: string
  serie: string
  folio: string
  fechaComprobante: string
  fechaCertificacion: string
  fechaRecepcion: string
  metodoPago: string
  formaPago: string
  issuerFiscalRegime: string
  hasResicoIsrRetention: boolean
  hasObjetoImpTaxMismatch: boolean
  objetoImpTaxMismatchReason: string
  subtotal: number
  totalImpuestosTrasladados: number
  totalImpuestosRetenidos: number
  descuento: number
  total: number
  moneda: string
  satStatus: SatCfdiStatusResult
}

type PaymentLink = {
  relatedUuid: string
  detail: ProviderReportPaymentDetail
}

type ParsedPaymentCandidate = {
  kind: 'payment'
  fileName: string
  xmlContent: string
  uuid: string
  emisorRfc: string
  emisorNombre: string
  receptorRfc: string
  receptorNombre: string
  fechaComprobante: string
  fechaCertificacion: string
  paymentLinks: PaymentLink[]
}

type ValidationNotificationMetadata = {
  fileName: string
  emisorNombre: string
  emisorRfc: string
  receptorRfc: string
  uuid: string
  total: string
  fechaEmision: string
  fechaCarga: string
}

function fileError(fileName: string, message: string) {
  return `${fileName}: ${message}`
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeRfc(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function stripFileErrorPrefix(fileName: string, message: string) {
  const normalizedMessage = message.trim()
  const prefix = `${fileName}:`
  return normalizedMessage.startsWith(prefix) ? normalizedMessage.slice(prefix.length).trim() : normalizedMessage
}

function hasExactResicoIsrRetention(root: Document | Element) {
  const retenciones = getElementsByLocalName(root, 'Retencion')

  return retenciones.some((retencionNode) => {
    const impuesto = normalizeText(getAttributeValue(retencionNode, 'Impuesto')).toUpperCase()
    const tasaRaw = normalizeText(getAttributeValue(retencionNode, 'TasaOCuota'))
    const tasa = tasaRaw ? Number(tasaRaw) : NaN

    return impuesto === '001'
      && Number.isFinite(tasa)
      && tasa.toFixed(6) === '0.012500'
  })
}

function hasAttribute(element: Element | null | undefined, attributeName: string) {
  if (!element) return false
  const directValue = element.getAttribute(attributeName)
  if (directValue !== null && directValue !== undefined) return true
  const normalizedAttributeName = attributeName.toLowerCase()
  const attributes = element.attributes
  for (let i = 0; i < attributes.length; i += 1) {
    const attr = attributes.item(i)
    if (!attr) continue
    const currentName = (
      attr.localName || attr.nodeName.split(':').pop() || attr.name || '').toLowerCase()
    if (currentName === normalizedAttributeName) return true
  }
  return false
}

function validateObjetoImp02ExentoIvaTraslado(trasladoNode: Element, trasladoRef: string): string[] {
  const errors: string[] = []
  const tipoFactor = normalizeText(getAttributeValue(trasladoNode, 'TipoFactor')).toUpperCase()
  const baseRaw = normalizeText(getAttributeValue(trasladoNode, 'Base'))
  const impuesto = normalizeText(getAttributeValue(trasladoNode, 'Impuesto')).toUpperCase()
  const hasTasaOCuota = hasAttribute(trasladoNode, 'TasaOCuota')
  const hasImporte = hasAttribute(trasladoNode, 'Importe')

  if (tipoFactor !== 'EXENTO') {
    errors.push(`${trasladoRef} el campo TipoFactor del Traslado IVA debe contener estrictamente el valor 'Exento' (valor recibido: '${tipoFactor || '(vacío)'}').`)
  }
  if (!baseRaw) {
    errors.push(`${trasladoRef} el campo Base del Traslado IVA (monto sobre el cual aplica la exención) es obligatorio y no está presente.`)
  } else {
    try {
      parseStrictCfdiNumber(baseRaw, 'Base', trasladoRef)
    } catch (parseErr) {
      errors.push(parseErr instanceof Error ? parseErr.message : `${trasladoRef} el campo Base del Traslado IVA debe ser un valor numérico válido (valor recibido: '${baseRaw}').`)
    }
  }
  if (impuesto !== '002') {
    errors.push(`${trasladoRef} el campo Impuesto del Traslado IVA debe contener exactamente el valor '002' (valor recibido: '${impuesto || '(vacío)'}').`)
  }
  if (hasTasaOCuota) {
    errors.push(`${trasladoRef} el campo TasaOCuota no debe existir en el Traslado IVA exento (ObjetoImp=02 y TipoFactor=Exento).`)
  }
  if (hasImporte) {
    errors.push(`${trasladoRef} el campo Importe no debe existir en el Traslado IVA exento (ObjetoImp=02 y TipoFactor=Exento).`)
  }
  return errors
}

function validateObjetoImp02Retencion(retencionNode: Element, retencionRef: string): string[] {
  const errors: string[] = []
  const tipoFactor = normalizeText(getAttributeValue(retencionNode, 'TipoFactor')).toUpperCase()
  const baseRaw = normalizeText(getAttributeValue(retencionNode, 'Base'))
  const impuesto = normalizeText(getAttributeValue(retencionNode, 'Impuesto')).toUpperCase()
  const tasaRaw = normalizeText(getAttributeValue(retencionNode, 'TasaOCuota'))
  const importeRaw = normalizeText(getAttributeValue(retencionNode, 'Importe'))

  if (!tipoFactor) {
    errors.push(`${retencionRef} el campo TipoFactor de la Retención es obligatorio y no está presente.`)
  } else if (tipoFactor === 'EXENTO') {
    errors.push(`${retencionRef} en Retenciones no existe la figura de TipoFactor 'Exento'; se esperaba 'Tasa' (valor recibido: 'Exento').`)
  }
  let baseNum: number | null = null
  let tasaNum: number | null = null
  if (!baseRaw) {
    errors.push(`${retencionRef} el campo Base de la Retención es obligatorio y no está presente.`)
  } else {
    try {
      baseNum = parseStrictCfdiNumber(baseRaw, 'Base', retencionRef)
    } catch (parseErr) {
      errors.push(parseErr instanceof Error ? parseErr.message : `${retencionRef} el campo Base de la Retención debe ser un valor numérico válido (valor recibido: '${baseRaw}').`)
    }
  }
  if (!impuesto) {
    errors.push(`${retencionRef} el campo Impuesto de la Retención es obligatorio y no está presente.`)
  }
  if (!tasaRaw) {
    errors.push(`${retencionRef} el campo TasaOCuota de la Retención es obligatorio y no está presente.`)
  } else {
    try {
      tasaNum = parseStrictCfdiNumber(tasaRaw, 'TasaOCuota', retencionRef)
    } catch (parseErr) {
      errors.push(parseErr instanceof Error ? parseErr.message : `${retencionRef} el campo TasaOCuota de la Retención debe ser un valor numérico válido (valor recibido: '${tasaRaw}').`)
    }
  }
  if (!importeRaw) {
    errors.push(`${retencionRef} el campo Importe de la Retención es obligatorio y no está presente.`)
  } else {
    try {
      const importeNum = parseStrictCfdiNumber(importeRaw, 'Importe', retencionRef)
      if (baseNum !== null && tasaNum !== null) {
        const expected = baseNum * tasaNum
        const diff = Math.abs(expected - importeNum)
        const tolerance = Math.max(1e-4, Math.abs(expected) * 1e-4)
        if (diff > tolerance) {
          errors.push(`${retencionRef} el campo Importe de la Retención (${importeRaw}) no coincide con el cálculo Base × TasaOCuota (${baseRaw} × ${tasaRaw} = ${expected.toFixed(6)}; diferencia ${diff.toFixed(6)}).`)
        }
      }
    } catch (parseErr) {
      errors.push(parseErr instanceof Error ? parseErr.message : `${retencionRef} el campo Importe de la Retención debe ser un valor numérico válido (valor recibido: '${importeRaw}').`)
    }
  }
  return errors
}

function isIvaTrasladoNode(trasladoNode: Element) {
  const impuesto = normalizeText(getAttributeValue(trasladoNode, 'Impuesto')).toUpperCase()
  return impuesto === '002' || impuesto === 'IVA'
}

function evaluateObjetoImpTaxMismatch(root: Document | Element) {
  const conceptos = getElementsByLocalName(root, 'Concepto')
  const reasons = new Set<string>()

  conceptos.forEach((conceptoNode, conceptIndex) => {
    const objetoImp = normalizeText(getAttributeValue(conceptoNode, 'ObjetoImp')).toUpperCase()
    if (!objetoImp) return

    const conceptoRef = `[Concepto #${conceptIndex + 1}]`
    const conceptImpuestos = getFirstElementByLocalName(conceptoNode, 'Impuestos')
    const traslados = conceptImpuestos ? getElementsByLocalName(conceptImpuestos, 'Traslado') : []
    const retenciones = conceptImpuestos ? getElementsByLocalName(conceptImpuestos, 'Retencion') : []
    const hasAnyTraslado = traslados.length > 0
    const hasAnyRetencion = retenciones.length > 0
    const ivaTraslados = traslados.filter(node => isIvaTrasladoNode(node))
    const hasAnyIvaTraslado = ivaTraslados.length > 0

    if (objetoImp === '02') {
      if (!conceptImpuestos || (!hasAnyTraslado && !hasAnyRetencion)) {
        reasons.add(`${conceptoRef} ObjetoImp=02 (SÍ objeto del impuesto) debe contener al menos una sección de cfdi:Traslados o cfdi:Retenciones dentro del nodo cfdi:Impuestos del concepto; no se localizó ninguno.`)
      } else {
        if (hasAnyIvaTraslado) {
          ivaTraslados.forEach((trasladoNode, tIdx) => {
            const trasladoRef = `${conceptoRef}[Traslado #${tIdx + 1}]`
            const specificErrors = validateObjetoImp02ExentoIvaTraslado(trasladoNode, trasladoRef)
            specificErrors.forEach(msg => reasons.add(msg))
          })
        }
        if (hasAnyRetencion) {
          retenciones.forEach((retencionNode, rIdx) => {
            const retencionRef = `${conceptoRef}[Retención #${rIdx + 1}]`
            const specificErrors = validateObjetoImp02Retencion(retencionNode, retencionRef)
            specificErrors.forEach(msg => reasons.add(msg))
          })
        }
      }
    } else if ((objetoImp === '01' || objetoImp === '03') && hasAnyIvaTraslado) {
      reasons.add(`${conceptoRef} ObjetoImp=${objetoImp} (01=No objeto de impuesto / 03=Art. 140 RLIVA) pero contiene Traslado IVA desglosado.`)
    }
  })

  return {
    hasMismatch: reasons.size > 0,
    reason: Array.from(reasons).join(' | ')
  }
}

function getElementsByLocalName(root: Document | Element, localName: string) {
  const normalizedName = localName.toLowerCase()
  const nodes = root.getElementsByTagName('*')
  const matches: Element[] = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index)
    if (!node) continue

    const currentName = (node.localName || node.nodeName.split(':').pop() || '').toLowerCase()
    if (currentName === normalizedName) {
      matches.push(node)
    }
  }

  return matches
}

function getFirstElementByLocalName(root: Document | Element, localName: string) {
  return getElementsByLocalName(root, localName)[0] || null
}

function getAttributeValue(element: Element | null | undefined, attributeName: string) {
  if (!element) return ''

  const directValue = element.getAttribute(attributeName)
  if (directValue) return directValue.trim()

  const normalizedAttributeName = attributeName.toLowerCase()
  const attributes = element.attributes

  for (let index = 0; index < attributes.length; index += 1) {
    const currentAttribute = attributes.item(index)
    if (!currentAttribute) continue

    const currentName = (
      currentAttribute.localName ||
      currentAttribute.nodeName.split(':').pop() ||
      currentAttribute.name ||
      ''
    ).toLowerCase()

    if (currentName === normalizedAttributeName) {
      return currentAttribute.nodeValue?.trim() || ''
    }
  }

  return ''
}

function extractValidationNotificationMetadata(candidate: XmlCandidate, uploadedAt: Date): ValidationNotificationMetadata {
  const fallback: ValidationNotificationMetadata = {
    fileName: candidate.name,
    emisorNombre: '',
    emisorRfc: '',
    receptorRfc: '',
    uuid: '',
    total: '',
    fechaEmision: '',
    fechaCarga: uploadedAt.toISOString()
  }

  try {
    const parseResult = safeParseProviderXml(candidate.xml, candidate.name)
    if (!parseResult.ok) {
      return fallback
    }
    const doc = parseResult.doc

    const comprobante = getFirstElementByLocalName(doc, 'Comprobante')
    const emisor = getFirstElementByLocalName(doc, 'Emisor')
    const receptor = getFirstElementByLocalName(doc, 'Receptor')
    const timbre = getFirstElementByLocalName(doc, 'TimbreFiscalDigital')

    return {
      fileName: candidate.name,
      emisorNombre: normalizeText(getAttributeValue(emisor, 'Nombre')),
      emisorRfc: normalizeRfc(getAttributeValue(emisor, 'Rfc')),
      receptorRfc: normalizeRfc(getAttributeValue(receptor, 'Rfc')),
      uuid: normalizeText(getAttributeValue(timbre, 'UUID')).toUpperCase(),
      total: normalizeText(getAttributeValue(comprobante, 'Total')),
      fechaEmision: normalizeText(getAttributeValue(comprobante, 'Fecha')),
      fechaCarga: uploadedAt.toISOString()
    }
  } catch {
    return fallback
  }
}

function formatCandidateProcessingError(error: unknown, fileName: string) {
  if (!(error instanceof Error)) {
    return `${fileName}: no fue posible procesar el XML. Verifica que el archivo no esté dañado y corresponda a un CFDI timbrado válido.`
  }

  const message = error.message.trim()
  if (message) {
    const normalizedMessage = message.toLowerCase()
    if (
      normalizedMessage.includes('getattributenames is not a function') ||
      normalizedMessage.includes('not iterable') ||
      normalizedMessage.includes('cannot read properties')
    ) {
      return `${fileName}: no fue posible leer la estructura interna del XML. Verifica que el archivo corresponda a un CFDI válido del SAT y que no esté dañado o alterado.`
    }

    return message
  }

  return `${fileName}: no fue posible procesar el XML. Verifica que el archivo no esté dañado y corresponda a un CFDI timbrado válido.`
}

function getStatusForInvoice(invoice: ParsedInvoiceCandidate, totalPagado: number) {
  const normalizedMetodo = invoice.metodoPago.trim().toUpperCase()

  if (normalizedMetodo === 'PUE') {
    return 'Pagado'
  }

  const saldoPorCobrar = Math.max(invoice.total - totalPagado, 0)
  if (saldoPorCobrar <= 0.01) {
    return 'Pagado'
  }

  if (totalPagado > 0.01) {
    return 'Parcialmente cobrado'
  }

  if (normalizedMetodo === 'PPD') {
    return 'Pendiente'
  }

  return 'Pendiente'
}

async function extractXmlCandidates(files: File[]) {
  const candidates: XmlCandidate[] = []
  const errors: string[] = []
  const encoder = getProviderTextEncoder()

  for (const file of files) {
    const lowerName = file.name.toLowerCase()
    const isXml = lowerName.endsWith('.xml')
    const isZip = lowerName.endsWith('.zip') || file.type.toLowerCase().includes('zip')

    if (!isXml && !isZip) {
      errors.push(fileError(file.name, 'solo puedes cargar archivos XML o ZIP'))
      continue
    }

    if (isZip) {
      try {
        const zipBuffer = await file.arrayBuffer()
        const zip = await JSZip.loadAsync(zipBuffer)
        const entries = Object.values(zip.files).filter(entry => !entry.dir)

        if (entries.length === 0) {
          errors.push(fileError(file.name, 'el archivo ZIP esta vacio y no contiene XML para procesar'))
          continue
        }

        if (entries.length > PROVIDER_ZIP_MAX_ENTRIES) {
          errors.push(fileError(file.name, `el ZIP contiene ${entries.length} archivos; maximo permitido ${PROVIDER_ZIP_MAX_ENTRIES}. Fracciona la carga en lotes mas chicos.`))
          continue
        }

        const invalidEntries = entries.filter(entry => !entry.name.toLowerCase().endsWith('.xml'))
        if (invalidEntries.length > 0) {
          errors.push(fileError(file.name, 'el ZIP contiene archivos que no son XML. Deja solo CFDI en formato XML dentro del ZIP'))
          continue
        }

        const compressedEstimate = entries.reduce((acc, entry) => {
          const entryInt = entry as JSZipObjectInternals
          const compressed = typeof entryInt._data?.compressedSize === 'number'
            ? Number(entryInt._data.compressedSize)
            : 0
          const uncompressed = typeof entryInt._data?.uncompressedSize === 'number'
            ? Number(entryInt._data.uncompressedSize)
            : 0
          return acc + Math.max(compressed, uncompressed, 1)
        }, 0)

        let decompressedTotalBytes = 0
        for (const entry of entries) {
          const entryInt = entry as JSZipObjectInternals
          const entryUncompressed = typeof entryInt._data?.uncompressedSize === 'number'
            ? Number(entryInt._data.uncompressedSize)
            : 0
          decompressedTotalBytes += Math.max(entryUncompressed, 0)
          if (compressedEstimate > 0 && entryUncompressed > PROVIDER_ZIP_MAX_COMPRESSION_RATIO * Math.max(compressedEstimate / entries.length, 1)) {
            throw new Error(`entrada ${entry.name} excede razon maxima de compresion (anti ZipBomb)`)
          }
        }

        if (decompressedTotalBytes > PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES) {
          errors.push(fileError(file.name, `el ZIP excede tamaño maximo descomprimido de ${Math.round(PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES / 1024 / 1024)} MB (detectados ${Math.round(decompressedTotalBytes / 1024 / 1024)} MB). Reduce el numero de archivos o fracciona la carga.`))
          continue
        }

        for (const entry of entries) {
          const rawName = entry.name
          if (PROVIDER_NUL_BYTE_PATTERN.test(rawName)) {
            errors.push(fileError(file.name, `el ZIP contiene una entrada con caracteres nulos prohibidos en el nombre: ${rawName.slice(0, 64)}`))
            continue
          }
          const safeName = rawName.split('/').pop()?.split('\\').pop()?.trim() || rawName
          if (!safeName || !safeName.toLowerCase().endsWith('.xml')) {
            continue
          }
          candidates.push({
            name: safeName,
            xml: await entry.async('string')
          })
        }
      } catch (error) {
        errors.push(
          fileError(
            file.name,
            error instanceof Error
              ? `no fue posible leer el ZIP. ${error.message}`
              : 'no fue posible leer el ZIP. Verifica que no este dañado'
          )
        )
      }

      continue
    }

    const xmlText = await file.text()
    const xmlBytes = encoder.encode(xmlText).byteLength
    if (xmlBytes > PROVIDER_XML_MAX_BYTES) {
      errors.push(fileError(file.name, `XML supera maximo permitido de ${PROVIDER_XML_MAX_BYTES} bytes (tamaño: ${xmlBytes})`))
      continue
    }
    if (PROVIDER_NUL_BYTE_PATTERN.test(file.name)) {
      errors.push(fileError(file.name, 'nombre de archivo contiene caracteres nulos prohibidos'))
      continue
    }
    const safeFileName = file.name.split('/').pop()?.split('\\').pop()?.trim() || file.name
    candidates.push({
      name: safeFileName,
      xml: xmlText
    })
  }

  return { candidates, errors }
}

function parseInvoiceCandidate(
  doc: Document,
  originalXml: string,
  fileName: string,
  uploadedAt: Date,
  providerRfc: string,
  allowedReceiverRfcs: Set<string>,
  satStatus: SatCfdiStatusResult
): ParsedInvoiceCandidate | ParsedPaymentCandidate {
  const comprobante = getFirstElementByLocalName(doc, 'Comprobante')
  const emisor = getFirstElementByLocalName(doc, 'Emisor')
  const receptor = getFirstElementByLocalName(doc, 'Receptor')
  const impuestos = getFirstElementByLocalName(doc, 'Impuestos')
  const timbre = getFirstElementByLocalName(doc, 'TimbreFiscalDigital')

  const uuid = normalizeText(getAttributeValue(timbre, 'UUID')).toUpperCase()
  if (!uuid) {
    throw new Error(fileError(fileName, 'no contiene UUID timbrado. Asegurate de subir el XML final del SAT y no una version previa o sin timbrar'))
  }

  const emisorRfc = normalizeRfc(getAttributeValue(emisor, 'Rfc'))
  const receptorRfc = normalizeRfc(getAttributeValue(receptor, 'Rfc'))

  if (!emisorRfc && !receptorRfc) {
    throw new Error(fileError(fileName, 'no contiene los RFC del emisor ni del receptor'))
  }

  if (!emisorRfc) {
    throw new Error(fileError(fileName, 'no contiene el RFC del emisor'))
  }

  if (!receptorRfc) {
    throw new Error(fileError(fileName, 'no contiene el RFC del receptor'))
  }

  if (emisorRfc !== providerRfc) {
    throw new Error(
      fileError(fileName, `el RFC emisor del XML (${emisorRfc}) no coincide con el RFC registrado para tu acceso (${providerRfc})`)
    )
  }

  if (!allowedReceiverRfcs.has(receptorRfc)) {
    throw new Error(
      fileError(fileName, `el RFC receptor del XML (${receptorRfc}) no pertenece a ninguna empresa autorizada para tu acceso`)
    )
  }

  const tipoComprobante = normalizeText(getAttributeValue(comprobante, 'TipoDeComprobante')).toUpperCase()
  if (!tipoComprobante) {
    throw new Error(fileError(fileName, 'no indica el tipo de comprobante (TipoDeComprobante)'))
  }

  if (tipoComprobante === 'P') {
    const pagos = getElementsByLocalName(doc, 'Pago')
    if (pagos.length === 0) {
      throw new Error(fileError(fileName, 'esta marcado como complemento de pago, pero no contiene nodos Pago validos'))
    }

    const paymentLinks: PaymentLink[] = []
    const totales = getFirstElementByLocalName(doc, 'Totales')
    const montoTotalPagos = parseStrictCfdiNumber(getAttributeValue(totales, 'MontoTotalPagos'), 'Totales.MontoTotalPagos', fileName)
    const serie = normalizeText(getAttributeValue(comprobante, 'Serie')) || null
    const folio = normalizeText(getAttributeValue(comprobante, 'Folio')) || null

    pagos.forEach(pagoNode => {
      const fechaPago = normalizeText(getAttributeValue(pagoNode, 'FechaPago')) || normalizeText(getAttributeValue(comprobante, 'Fecha'))
      const monedaPago = normalizeText(getAttributeValue(pagoNode, 'MonedaP')) || normalizeText(getAttributeValue(comprobante, 'Moneda')) || 'MXN'
      const montoPagoNode = parseStrictCfdiNumber(getAttributeValue(pagoNode, 'Monto'), 'Pago.Monto', fileName)
      const doctosRelacionados = getElementsByLocalName(pagoNode, 'DoctoRelacionado')

      doctosRelacionados.forEach(doctoNode => {
        const relatedUuid = normalizeText(getAttributeValue(doctoNode, 'IdDocumento')).toUpperCase()
        if (!relatedUuid) return

        const rawNumParcialidad = parseStrictCfdiNumber(getAttributeValue(doctoNode, 'NumParcialidad'), 'DoctoRelacionado.NumParcialidad', fileName)
        const numParcialidadParsed = Math.trunc(rawNumParcialidad)
        paymentLinks.push({
          relatedUuid,
          detail: {
            paymentUuid: uuid,
            paymentDate: fechaPago,
            paymentSeries: serie,
            paymentFolio: folio,
            montoPagado: parseStrictCfdiNumber(getAttributeValue(doctoNode, 'ImpPagado'), 'DoctoRelacionado.ImpPagado', fileName),
            montoTotalPagos: montoTotalPagos > 0 ? montoTotalPagos : montoPagoNode,
            monedaPago,
            equivalenciaDR: parseStrictCfdiNumber(getAttributeValue(doctoNode, 'EquivalenciaDR'), 'DoctoRelacionado.EquivalenciaDR', fileName) || 1,
            numParcialidad: numParcialidadParsed > 0 ? numParcialidadParsed : 1,
            impSaldoAnt: parseStrictCfdiNumber(getAttributeValue(doctoNode, 'ImpSaldoAnt'), 'DoctoRelacionado.ImpSaldoAnt', fileName),
            impSaldoInsoluto: parseStrictCfdiNumber(getAttributeValue(doctoNode, 'ImpSaldoInsoluto'), 'DoctoRelacionado.ImpSaldoInsoluto', fileName)
          }
        })
      })
    })

    if (paymentLinks.length === 0) {
      throw new Error(fileError(fileName, 'el REP no incluye documentos relacionados. Verifica que el XML de pago tenga IdDocumento en los DoctoRelacionado'))
    }

    return {
      kind: 'payment',
      fileName,
      xmlContent: originalXml,
      uuid,
      emisorRfc,
      emisorNombre: normalizeText(getAttributeValue(emisor, 'Nombre')),
      receptorRfc,
      receptorNombre: normalizeText(getAttributeValue(receptor, 'Nombre')),
      fechaComprobante: normalizeText(getAttributeValue(comprobante, 'Fecha')),
      fechaCertificacion: normalizeText(getAttributeValue(timbre, 'FechaTimbrado')),
      paymentLinks
    }
  }

  const objetoImpTaxCheck = evaluateObjetoImpTaxMismatch(doc)

  return {
    kind: 'invoice',
    fileName,
    xmlContent: originalXml,
    uuid,
    receptorRfc,
    receptorNombre: normalizeText(getAttributeValue(receptor, 'Nombre')),
    emisorRfc,
    emisorNombre: normalizeText(getAttributeValue(emisor, 'Nombre')),
    tipoComprobante,
    serie: normalizeText(getAttributeValue(comprobante, 'Serie')),
    folio: normalizeText(getAttributeValue(comprobante, 'Folio')),
    fechaComprobante: normalizeText(getAttributeValue(comprobante, 'Fecha')),
    fechaCertificacion: normalizeText(getAttributeValue(timbre, 'FechaTimbrado')),
    fechaRecepcion: uploadedAt.toISOString(),
    metodoPago: normalizeText(getAttributeValue(comprobante, 'MetodoPago')),
    formaPago: normalizeText(getAttributeValue(comprobante, 'FormaPago')),
    issuerFiscalRegime: normalizeText(getAttributeValue(emisor, 'RegimenFiscal')),
    hasResicoIsrRetention: hasExactResicoIsrRetention(doc),
    hasObjetoImpTaxMismatch: objetoImpTaxCheck.hasMismatch,
    objetoImpTaxMismatchReason: objetoImpTaxCheck.reason,
    subtotal: parseStrictCfdiNumber(getAttributeValue(comprobante, 'SubTotal'), 'Comprobante.SubTotal', fileName),
    totalImpuestosTrasladados: parseStrictCfdiNumber(getAttributeValue(impuestos, 'TotalImpuestosTrasladados'), 'Impuestos.TotalImpuestosTrasladados', fileName),
    totalImpuestosRetenidos: parseStrictCfdiNumber(getAttributeValue(impuestos, 'TotalImpuestosRetenidos'), 'Impuestos.TotalImpuestosRetenidos', fileName),
    descuento: parseStrictCfdiNumber(getAttributeValue(comprobante, 'Descuento'), 'Comprobante.Descuento', fileName),
    total: parseStrictCfdiNumber(getAttributeValue(comprobante, 'Total'), 'Comprobante.Total', fileName),
    moneda: normalizeText(getAttributeValue(comprobante, 'Moneda')) || 'MXN',
    satStatus
  }
}

export async function buildProviderReportFromXmlCandidates(params: {
  candidates: ProviderXmlCandidateInput[]
  context: ProviderContext
  uploadedAt?: Date
}) {
  const { context } = params
  const uploadedAt = params.uploadedAt || new Date()
  const candidates: XmlCandidate[] = params.candidates.map(candidate => ({
    name: candidate.name,
    xml: candidate.xml
  }))
  const errors: string[] = []

  if (candidates.length === 0) {
    throw new Error('No se encontraron CFDI válidos para procesar')
  }

  if (candidates.length > MAX_PROVIDER_CFDI_UPLOAD) {
    throw new Error(`Solo puedes cargar hasta ${MAX_PROVIDER_CFDI_UPLOAD} CFDI por operación`)
  }

  const allowedReceiverRfcs = new Set(context.allowedCompanies.map(company => normalizeRfc(company.rfc)))
  const parsedInvoices = new Map<string, ParsedInvoiceCandidate>()
  const paymentsByInvoice = new Map<string, ProviderReportPaymentDetail[]>()
  const validationMessages = new Set<string>()
  const emailResults: ProviderXmlValidationEmailResult[] = []
  const acceptedRecords: PersistableProviderAcceptedCfdi[] = []

  for (const candidate of candidates) {
    const notificationMetadata = extractValidationNotificationMetadata(candidate, uploadedAt)
    let validationAnexo20 = 'No ejecutada'
    let validationSat = 'No ejecutada'

    try {
      const pacValidation = await validateCfdiWithFactronicaPac(candidate.name, candidate.xml)
      if (!pacValidation.success) {
        throw new Error(fileError(candidate.name, pacValidation.errorMessage))
      }
      validationAnexo20 = pacValidation.successMessage || FACTRONICA_ANEXO20_OK_MESSAGE
      validationMessages.add(validationAnexo20)

      const xmlParseResult = safeParseProviderXml(candidate.xml, candidate.name)
      if (!xmlParseResult.ok) {
        throw new Error(xmlParseResult.error)
      }
      const doc = xmlParseResult.doc

      const satValidation = await validateCfdiStatusWithSat({
        fileName: candidate.name,
        xml: candidate.xml
      })
      validationSat = satValidation.successMessage || SAT_STATUS_OK_MESSAGE
      validationMessages.add(validationSat)

      const parsed = parseInvoiceCandidate(
        doc,
        candidate.xml,
        candidate.name,
        uploadedAt,
        normalizeRfc(context.providerRfc),
        allowedReceiverRfcs,
        satValidation.result
      )

      if (parsed.kind === 'invoice') {
        if (
          context.granularPermissions?.providerBusinessRulePueForma99 === true &&
          hasPaymentMethodVsPaymentFormViolation({
            paymentMethod: parsed.metodoPago,
            paymentForm: parsed.formaPago
          })
        ) {
          throw new Error(fileError(candidate.name, buildPaymentMethodVsPaymentFormViolationMessage()))
        }

        if (
          context.granularPermissions?.providerBusinessRuleResicoRetention === true &&
          hasResicoRetentionViolation({
            issuerFiscalRegime: parsed.issuerFiscalRegime,
            receiverRfc: parsed.receptorRfc,
            hasResicoIsrRetention: parsed.hasResicoIsrRetention
          })
        ) {
          throw new Error(fileError(candidate.name, buildResicoRetentionViolationMessage()))
        }

        if (
          context.granularPermissions?.providerBusinessRuleObjetoImpVsIva === true &&
          hasObjetoImpTaxViolation({
            hasObjetoImpTaxMismatch: parsed.hasObjetoImpTaxMismatch
          })
        ) {
          throw new Error(
            fileError(
              candidate.name,
              buildObjetoImpTaxViolationMessage(parsed.objetoImpTaxMismatchReason)
            )
          )
        }

        if (parsedInvoices.has(parsed.uuid)) {
          throw new Error(`${candidate.name}: el UUID ${parsed.uuid} ya fue cargado previamente en esta operación`)
        }

        parsedInvoices.set(parsed.uuid, parsed)
        emailResults.push({
          ...notificationMetadata,
          emisorNombre: parsed.emisorNombre || notificationMetadata.emisorNombre,
          emisorRfc: parsed.emisorRfc || notificationMetadata.emisorRfc,
          receptorRfc: parsed.receptorRfc || notificationMetadata.receptorRfc,
          uuid: parsed.uuid || notificationMetadata.uuid,
          total: parsed.total ? String(parsed.total) : notificationMetadata.total,
          fechaEmision: parsed.fechaComprobante || notificationMetadata.fechaEmision,
          validationAnexo20,
          validationSat,
          status: 'APPROVED',
          rejectionReason: ''
        })
        acceptedRecords.push({
          fileName: parsed.fileName,
          xmlContent: parsed.xmlContent,
          uuid: parsed.uuid,
          providerRfc: parsed.emisorRfc,
          providerName: context.providerName,
          issuerRfc: parsed.emisorRfc,
          issuerName: parsed.emisorNombre,
          receiverRfc: parsed.receptorRfc,
          receiverName: parsed.receptorNombre,
          cfdiType: parsed.tipoComprobante,
          series: parsed.serie,
          folio: parsed.folio,
          paymentMethod: parsed.metodoPago,
          paymentForm: parsed.formaPago,
          issuerFiscalRegime: parsed.issuerFiscalRegime,
          hasResicoIsrRetention: parsed.hasResicoIsrRetention,
          hasObjetoImpTaxMismatch: parsed.hasObjetoImpTaxMismatch,
          objetoImpTaxMismatchReason: parsed.objetoImpTaxMismatchReason,
          currency: parsed.moneda,
          subtotal: parsed.subtotal,
          transferredTaxesTotal: parsed.totalImpuestosTrasladados,
          withheldTaxesTotal: parsed.totalImpuestosRetenidos,
          discount: parsed.descuento,
          total: parsed.total,
          issuanceDate: parsed.fechaComprobante,
          certificationDate: parsed.fechaCertificacion,
          validationAnexo20,
          validationSat,
          satCodigoEstatus: parsed.satStatus.codigoEstatus,
          satEstado: parsed.satStatus.estado,
          satEsCancelable: parsed.satStatus.esCancelable,
          satEstatusCancelacion: parsed.satStatus.estatusCancelacion,
          satValidacionEFOS: parsed.satStatus.validacionEFOS
        })
        continue
      }

      parsed.paymentLinks.forEach(link => {
        const currentPayments = paymentsByInvoice.get(link.relatedUuid) || []
        currentPayments.push(link.detail)
        paymentsByInvoice.set(link.relatedUuid, currentPayments)
      })

      emailResults.push({
        ...notificationMetadata,
        validationAnexo20,
        validationSat,
        status: 'APPROVED',
        rejectionReason: ''
      })
      acceptedRecords.push({
        fileName: parsed.fileName,
        xmlContent: parsed.xmlContent,
        uuid: parsed.uuid,
        providerRfc: parsed.emisorRfc,
        providerName: context.providerName,
        issuerRfc: parsed.emisorRfc,
        issuerName: parsed.emisorNombre,
        receiverRfc: parsed.receptorRfc,
        receiverName: parsed.receptorNombre,
        cfdiType: 'P',
        series: '',
        folio: '',
        paymentMethod: '',
        paymentForm: '',
        issuerFiscalRegime: '',
        hasResicoIsrRetention: false,
        hasObjetoImpTaxMismatch: false,
        objetoImpTaxMismatchReason: '',
        currency: 'MXN',
        subtotal: 0,
        transferredTaxesTotal: 0,
        withheldTaxesTotal: 0,
        discount: 0,
        total: 0,
        issuanceDate: parsed.fechaComprobante,
        certificationDate: parsed.fechaCertificacion,
        validationAnexo20,
        validationSat,
        satCodigoEstatus: satValidation.result.codigoEstatus,
        satEstado: satValidation.result.estado,
        satEsCancelable: satValidation.result.esCancelable,
        satEstatusCancelacion: satValidation.result.estatusCancelacion,
        satValidacionEFOS: satValidation.result.validacionEFOS,
        paymentLinksJson: parsed.paymentLinks.map(link => ({
          relatedUuid: link.relatedUuid,
          ...link.detail
        }))
      })
    } catch (error) {
      const formattedError = formatCandidateProcessingError(error, candidate.name)
      errors.push(formattedError)

      if (validationAnexo20 === 'No ejecutada') {
        validationAnexo20 = stripFileErrorPrefix(candidate.name, formattedError)
        validationSat = 'No ejecutada porque la validación estructura Anexo 20 no fue exitosa'
      } else if (validationSat === 'No ejecutada') {
        validationSat = stripFileErrorPrefix(candidate.name, formattedError)
      }

      emailResults.push({
        ...notificationMetadata,
        validationAnexo20,
        validationSat,
        status: 'REJECTED',
        rejectionReason: stripFileErrorPrefix(candidate.name, formattedError)
      })
    }
  }

  const missingRelatedUuids = Array.from(paymentsByInvoice.keys()).filter(relatedUuid => !parsedInvoices.has(relatedUuid))
  const persistedInvoiceUuids = await getExistingPersistedInvoiceUuids({
    context,
    uuids: missingRelatedUuids
  })

  for (const relatedUuid of missingRelatedUuids) {
    if (!persistedInvoiceUuids.has(relatedUuid)) {
      errors.push(`No se encontró la factura ${relatedUuid} relacionada con uno de los REP cargados. Incluye también el XML de la factura original.`)
    }
  }

  const rows = Array.from(parsedInvoices.values())
    .map<ProviderReportRow>(invoice => {
      const payments = (paymentsByInvoice.get(invoice.uuid) || [])
        .sort((left, right) => new Date(left.paymentDate).getTime() - new Date(right.paymentDate).getTime())

      const totalPagado = payments.reduce((acc, payment) => {
        const equivalencia = payment.equivalenciaDR > 0 ? payment.equivalenciaDR : 1
        return acc + (payment.montoPagado * equivalencia)
      }, invoice.metodoPago.trim().toUpperCase() === 'PUE' ? invoice.total : 0)

      const saldoPorCobrar = Math.max(invoice.total - totalPagado, 0)
      const latestPayment = payments[payments.length - 1]
      const paymentCurrencies = Array.from(new Set(payments.map(payment => payment.monedaPago).filter(Boolean)))

      return {
        id: invoice.uuid,
        fileName: invoice.fileName,
        xmlContent: invoice.xmlContent,
        receptorRfc: invoice.receptorRfc,
        providerId: invoice.emisorRfc,
        emisorRfc: invoice.emisorRfc,
        emisorNombre: invoice.emisorNombre,
        tipoComprobante: invoice.tipoComprobante,
        serie: invoice.serie,
        folio: invoice.folio,
        uuid: invoice.uuid,
        fechaComprobante: invoice.fechaComprobante,
        fechaRecepcion: invoice.fechaRecepcion,
        metodoPago: invoice.metodoPago,
        estatusPago: getStatusForInvoice(invoice, totalPagado),
        fechaPago: latestPayment?.paymentDate || '',
        subtotal: invoice.subtotal,
        totalImpuestosTrasladados: invoice.totalImpuestosTrasladados,
        totalImpuestosRetenidos: invoice.totalImpuestosRetenidos,
        descuento: invoice.descuento,
        total: invoice.total,
        montoPago: payments.reduce((acc, payment) => acc + payment.montoTotalPagos, 0),
        monedaPago: paymentCurrencies.length === 1 ? paymentCurrencies[0] : paymentCurrencies.length > 1 ? 'MULTI' : '',
        totalOriginal: invoice.total,
        totalPagado,
        saldoPorCobrar,
        moneda: invoice.moneda,
        estatus: getStatusForInvoice(invoice, totalPagado),
        satCodigoEstatus: invoice.satStatus.codigoEstatus,
        satEstado: invoice.satStatus.estado,
        satEsCancelable: invoice.satStatus.esCancelable,
        satEstatusCancelacion: invoice.satStatus.estatusCancelacion,
        satValidacionEFOS: invoice.satStatus.validacionEFOS,
        payments
      }
    })
    .sort((left, right) => new Date(right.fechaComprobante).getTime() - new Date(left.fechaComprobante).getTime())

  return {
    rows,
    acceptedRecords,
    errors,
    emailResults,
    validationMessages: Array.from(validationMessages),
    summary: {
      totalFiles: candidates.length,
      acceptedInvoices: rows.length,
      rejectedFiles: errors.length
    }
  }
}

export async function buildProviderReport(params: {
  files: File[]
  context: ProviderContext
  uploadedAt?: Date
}) {
  const { files, context } = params
  const uploadedAt = params.uploadedAt || new Date()
  const { candidates, errors } = await extractXmlCandidates(files)

  if (candidates.length === 0) {
    throw new Error(errors[0] || 'No se encontraron CFDI válidos para procesar')
  }

  const report = await buildProviderReportFromXmlCandidates({
    candidates,
    context,
    uploadedAt
  })

  return {
    ...report,
    errors: [...report.errors, ...errors],
    summary: {
      totalFiles: candidates.length,
      acceptedInvoices: report.summary.acceptedInvoices,
      rejectedFiles: report.errors.length + errors.length
    }
  }
}

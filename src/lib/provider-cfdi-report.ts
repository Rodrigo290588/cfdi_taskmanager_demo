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

function toNumber(value: string | null | undefined) {
  const parsed = Number((value || '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
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

function hasAllowedIvaTransferBreakdown(root: Document | Element) {
  const traslados = getElementsByLocalName(root, 'Traslado')

  return traslados.some((trasladoNode) => {
    const impuesto = normalizeText(getAttributeValue(trasladoNode, 'Impuesto')).toUpperCase()
    const tasaRaw = normalizeText(getAttributeValue(trasladoNode, 'TasaOCuota'))
    const tasa = tasaRaw ? Number(tasaRaw) : NaN

    return (impuesto === '002' || impuesto === 'IVA')
      && Number.isFinite(tasa)
      && ['0.160000', '0.080000', '0.000000'].includes(tasa.toFixed(6))
  })
}

function evaluateObjetoImpTaxMismatch(root: Document | Element) {
  const conceptos = getElementsByLocalName(root, 'Concepto')
  const reasons = new Set<string>()

  conceptos.forEach((conceptoNode) => {
    const objetoImp = normalizeText(getAttributeValue(conceptoNode, 'ObjetoImp')).toUpperCase()
    if (!objetoImp) return

    const conceptImpuestos = getFirstElementByLocalName(conceptoNode, 'Impuestos')
    const hasIvaTransferBreakdown = conceptImpuestos ? hasAllowedIvaTransferBreakdown(conceptImpuestos) : false

    if (objetoImp === '02' && !hasIvaTransferBreakdown) {
      reasons.add('OBJETOIMP_02_SIN_IVA_TRASLADADO')
    }

    if ((objetoImp === '01' || objetoImp === '03') && hasIvaTransferBreakdown) {
      reasons.add('OBJETOIMP_01_03_CON_IVA_TRASLADADO')
    }
  })

  return {
    hasMismatch: reasons.size > 0,
    reason: Array.from(reasons).join('; ')
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
    const doc = new DOMParser().parseFromString(candidate.xml, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) {
      return fallback
    }

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
        const zip = await JSZip.loadAsync(await file.arrayBuffer())
        const entries = Object.values(zip.files).filter(entry => !entry.dir)

        if (entries.length === 0) {
          errors.push(fileError(file.name, 'el archivo ZIP esta vacio y no contiene XML para procesar'))
          continue
        }

        const invalidEntries = entries.filter(entry => !entry.name.toLowerCase().endsWith('.xml'))
        if (invalidEntries.length > 0) {
          errors.push(fileError(file.name, 'el ZIP contiene archivos que no son XML. Deja solo CFDI en formato XML dentro del ZIP'))
          continue
        }

        for (const entry of entries) {
          candidates.push({
            name: entry.name,
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

    candidates.push({
      name: file.name,
      xml: await file.text()
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
    const montoTotalPagos = toNumber(getAttributeValue(totales, 'MontoTotalPagos'))
    const serie = normalizeText(getAttributeValue(comprobante, 'Serie')) || null
    const folio = normalizeText(getAttributeValue(comprobante, 'Folio')) || null

    pagos.forEach(pagoNode => {
      const fechaPago = normalizeText(getAttributeValue(pagoNode, 'FechaPago')) || normalizeText(getAttributeValue(comprobante, 'Fecha'))
      const monedaPago = normalizeText(getAttributeValue(pagoNode, 'MonedaP')) || normalizeText(getAttributeValue(comprobante, 'Moneda')) || 'MXN'
      const montoPagoNode = toNumber(getAttributeValue(pagoNode, 'Monto'))
      const doctosRelacionados = getElementsByLocalName(pagoNode, 'DoctoRelacionado')

      doctosRelacionados.forEach(doctoNode => {
        const relatedUuid = normalizeText(getAttributeValue(doctoNode, 'IdDocumento')).toUpperCase()
        if (!relatedUuid) return

        paymentLinks.push({
          relatedUuid,
          detail: {
            paymentUuid: uuid,
            paymentDate: fechaPago,
            paymentSeries: serie,
            paymentFolio: folio,
            montoPagado: toNumber(getAttributeValue(doctoNode, 'ImpPagado')),
            montoTotalPagos: montoTotalPagos > 0 ? montoTotalPagos : montoPagoNode,
            monedaPago,
            equivalenciaDR: toNumber(getAttributeValue(doctoNode, 'EquivalenciaDR')) || 1,
            numParcialidad: Math.trunc(toNumber(getAttributeValue(doctoNode, 'NumParcialidad'))) || 1,
            impSaldoAnt: toNumber(getAttributeValue(doctoNode, 'ImpSaldoAnt')),
            impSaldoInsoluto: toNumber(getAttributeValue(doctoNode, 'ImpSaldoInsoluto'))
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
    subtotal: toNumber(getAttributeValue(comprobante, 'SubTotal')),
    totalImpuestosTrasladados: toNumber(getAttributeValue(impuestos, 'TotalImpuestosTrasladados')),
    totalImpuestosRetenidos: toNumber(getAttributeValue(impuestos, 'TotalImpuestosRetenidos')),
    descuento: toNumber(getAttributeValue(comprobante, 'Descuento')),
    total: toNumber(getAttributeValue(comprobante, 'Total')),
    moneda: normalizeText(getAttributeValue(comprobante, 'Moneda')) || 'MXN',
    satStatus
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

      const doc = new DOMParser().parseFromString(candidate.xml, 'text/xml')
      if (doc.getElementsByTagName('parsererror').length > 0) {
        throw new Error(`${candidate.name}: el archivo no contiene un XML válido`)
      }

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
          throw new Error(fileError(candidate.name, buildObjetoImpTaxViolationMessage()))
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

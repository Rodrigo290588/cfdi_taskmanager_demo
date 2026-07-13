import { DOMParser } from '@xmldom/xmldom'

const SAT_CONSULTA_CFDI_URL =
  process.env.SAT_CONSULTA_CFDI_URL || 'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc'
const SAT_CONSULTA_CFDI_SOAP_ACTION = 'http://tempuri.org/IConsultaCFDIService/Consulta'
const SAT_CONSULTA_CFDI_TIMEOUT_MS = Number(process.env.SAT_CONSULTA_CFDI_TIMEOUT_MS || '30000')

export const SAT_STATUS_OK_MESSAGE = 'Validación Estatus SAT = OK'

export type SatCfdiStatusResult = {
  codigoEstatus: string
  estado: string
  esCancelable: string
  estatusCancelacion: string
  validacionEFOS: string
}

type SatValidationInput = {
  fileName: string
  xml: string
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

function getFirstElementTextByLocalName(root: Document | Element, localName: string) {
  return getFirstElementByLocalName(root, localName)?.textContent?.trim() || ''
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

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeRfc(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function normalizeUuid(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function formatTotalForSat(total: string) {
  const normalizedTotal = normalizeText(total).replace(/,/g, '')
  if (!normalizedTotal) {
    return ''
  }

  const [integerPartRaw, decimalPartRaw = ''] = normalizedTotal.split('.')
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/, '') || '0'
  const decimalPart = decimalPartRaw.replace(/0+$/, '').slice(0, 6)

  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart
}

function buildExpresionImpresaFromXml(fileName: string, xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${fileName}: el archivo no contiene un XML válido para consultar su estatus en el SAT`)
  }

  const comprobante = getFirstElementByLocalName(doc, 'Comprobante')
  const emisor = getFirstElementByLocalName(doc, 'Emisor')
  const receptor = getFirstElementByLocalName(doc, 'Receptor')
  const timbre = getFirstElementByLocalName(doc, 'TimbreFiscalDigital')

  const emisorRfc = normalizeRfc(getAttributeValue(emisor, 'Rfc'))
  const receptorRfc = normalizeRfc(getAttributeValue(receptor, 'Rfc'))
  const total = formatTotalForSat(getAttributeValue(comprobante, 'Total'))
  const uuid = normalizeUuid(getAttributeValue(timbre, 'UUID'))
  const sello = normalizeText(getAttributeValue(comprobante, 'Sello'))
  const fe = sello.slice(-8)

  if (!emisorRfc || !receptorRfc || !total || !uuid || fe.length !== 8) {
    throw new Error(
      `${fileName}: no fue posible construir la expresión impresa para consultar el estatus SAT. Verifica RFC emisor, RFC receptor, total, UUID y sello del CFDI`
    )
  }

  return `?re=${emisorRfc}&rr=${receptorRfc}&tt=${total}&id=${uuid}&fe=${fe}`
}

function buildConsultaCfdiEnvelope(expresionImpresa: string) {
  return [
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">',
    '  <soapenv:Header/>',
    '  <soapenv:Body>',
    '    <tem:Consulta>',
    `      <tem:expresionImpresa><![CDATA[${expresionImpresa}]]></tem:expresionImpresa>`,
    '    </tem:Consulta>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>'
  ].join('\n')
}

function parseConsultaCfdiResponse(fileName: string, responseXml: string): SatCfdiStatusResult {
  const normalizedResponseXml = responseXml.trim()
  if (!normalizedResponseXml) {
    throw new Error(`${fileName}: el SAT no devolvió una respuesta para la consulta de estatus del CFDI`)
  }

  const doc = new DOMParser().parseFromString(normalizedResponseXml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${fileName}: la respuesta del SAT no contiene un XML válido`)
  }

  return {
    codigoEstatus: getFirstElementTextByLocalName(doc, 'CodigoEstatus'),
    estado: getFirstElementTextByLocalName(doc, 'Estado'),
    esCancelable: getFirstElementTextByLocalName(doc, 'EsCancelable'),
    estatusCancelacion: getFirstElementTextByLocalName(doc, 'EstatusCancelacion'),
    validacionEFOS: getFirstElementTextByLocalName(doc, 'ValidacionEFOS')
  }
}

function buildSatStatusSummary(result: SatCfdiStatusResult) {
  return [
    `CodigoEstatus: ${result.codigoEstatus || 'Sin dato'}`,
    `Estado: ${result.estado || 'Sin dato'}`,
    `EsCancelable: ${result.esCancelable || 'Sin dato'}`,
    `EstatusCancelacion: ${result.estatusCancelacion || 'Vacio'}`,
    `ValidacionEFOS: ${result.validacionEFOS || 'Sin dato'}`
  ].join('\n')
}

function getSatRejectionReasons(result: SatCfdiStatusResult) {
  const reasons: string[] = []
  const codigoEstatus = result.codigoEstatus.trim().toUpperCase()
  const estado = result.estado.trim().toUpperCase()
  const validacionEFOS = result.validacionEFOS.trim()

  if (codigoEstatus.startsWith('N - 601')) {
    reasons.push('la expresión impresa enviada al SAT no es válida (N - 601)')
  }

  if (codigoEstatus.startsWith('N - 602')) {
    reasons.push('el SAT no encontró el comprobante con el UUID indicado (N - 602)')
  }

  if (!codigoEstatus.startsWith('S - ')) {
    reasons.push(`el SAT devolvió un CodigoEstatus no satisfactorio: ${result.codigoEstatus || 'Sin dato'}`)
  }

  if (estado === 'CANCELADO') {
    reasons.push('el CFDI se encuentra Cancelado en el SAT')
  }

  if (estado === 'NO ENCONTRADO') {
    reasons.push('el CFDI se encuentra como No Encontrado en el SAT')
  }

  if (['101', '102', '103', '104'].includes(validacionEFOS)) {
    reasons.push(`la validación EFOS del SAT devolvió el código ${validacionEFOS}`)
  }

  return Array.from(new Set(reasons))
}

function formatSatStatusError(fileName: string, result: SatCfdiStatusResult) {
  const reasons = getSatRejectionReasons(result)
  const header =
    reasons.length > 0
      ? `${fileName}: el CFDI fue rechazado en la validación de estatus SAT por las siguientes razones: ${reasons.join('; ')}`
      : `${fileName}: el CFDI fue rechazado porque la respuesta del SAT no fue satisfactoria`

  return `${header}\n${buildSatStatusSummary(result)}`
}

export async function validateCfdiStatusWithSat({ fileName, xml }: SatValidationInput) {
  const result = await queryCfdiStatusWithSat({ fileName, xml })
  const rejectionReasons = getSatRejectionReasons(result)

  if (rejectionReasons.length > 0) {
    throw new Error(formatSatStatusError(fileName, result))
  }

  return {
    success: true,
    successMessage: SAT_STATUS_OK_MESSAGE,
    result
  }
}

export async function queryCfdiStatusWithSat({ fileName, xml }: SatValidationInput) {
  const expresionImpresa = buildExpresionImpresaFromXml(fileName, xml)
  const requestXml = buildConsultaCfdiEnvelope(expresionImpresa)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SAT_CONSULTA_CFDI_TIMEOUT_MS)

  try {
    const response = await fetch(SAT_CONSULTA_CFDI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: SAT_CONSULTA_CFDI_SOAP_ACTION
      },
      body: requestXml,
      signal: controller.signal,
      cache: 'no-store'
    })

    const responseXml = await response.text()
    if (!response.ok) {
      throw new Error(`${fileName}: el SAT respondió con HTTP ${response.status} al consultar el estatus del CFDI`)
    }

    return parseConsultaCfdiResponse(fileName, responseXml)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${fileName}: no fue posible consultar el estatus SAT porque el servicio tardó demasiado en responder`)
    }

    if (error instanceof Error) {
      throw error
    }

    throw new Error(`${fileName}: no fue posible consultar el estatus SAT del CFDI`)
  } finally {
    clearTimeout(timeout)
  }
}

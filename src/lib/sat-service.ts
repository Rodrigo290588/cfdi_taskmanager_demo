import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/encryption'
import { redis } from '@/lib/redis'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import {
  safeBuildSatDebugPath,
  redactSatWrapTokenInEnvelope,
  SAT_DEBUG_SOAP_TIMEOUT_MS,
  SAT_SOAP_USER_AGENT,
  SAT_SOAP_OFFICIAL_ALLOWLIST,
} from '@/lib/sat-debug-helpers'

const SAT_AUTH_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc'
const SOAP_ACTION = 'http://DescargaMasivaTerceros.gob.mx/IAutenticacion/Autentica'

function __validateSatSoapEndpoint(rawUrl: string): { ok: true; parsed: URL } | { ok: false; reason: string } {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:') return { ok: false, reason: `SAT SOAP requiere HTTPS (recibido ${parsed.protocol})` }
    const host = parsed.hostname.toLowerCase()
    if (!SAT_SOAP_OFFICIAL_ALLOWLIST.has(host) && !host.endsWith('.sat.gob.mx')) {
      return { ok: false, reason: `Host SAT SOAP fuera de allow-list oficial: ${host}` }
    }
    return { ok: true, parsed }
  } catch {
    return { ok: false, reason: `URL SAT SOAP inválida: ${rawUrl}` }
  }
}

function __satVerboseLog(label: string, envelope: unknown): void {
  if (process.env.SAT_DEBUG_VERBOSE !== '1') return
  const redacted = redactSatWrapTokenInEnvelope(envelope)
  console.log(label, redacted)
}

function __satWriteDebugFile(params: {
  rfc: string
  kind: 'solicitud' | 'verificacion' | 'autenticacion' | 'descarga'
  timestamp?: string | number | Date
  content: string
  extraContextUrl: string
  extraHeaders?: Record<string, string>
}): void {
  try {
    const safePathResult = safeBuildSatDebugPath({
      rfc: params.rfc,
      kind: params.kind,
      timestamp: params.timestamp,
      nodeEnv: process.env.NODE_ENV,
    })
    if (!safePathResult.allowed || !safePathResult.safePath) {
      if (process.env.SAT_DEBUG_VERBOSE === '1') {
        console.warn(
          `[SAT Debug ${params.kind}] Skip write (${safePathResult.reasonCode})${safePathResult.incidentFp ? ` fp=${safePathResult.incidentFp}` : ''}`
        )
      }
      return
    }
    const headerBlock = [
      `POST ${params.extraContextUrl} HTTP/1.1`,
      ...Object.entries(params.extraHeaders ?? {}).map(([k, v]) => `${k}: ${v}`),
      '',
    ].join('\n')
    const contentRedacted = redactSatWrapTokenInEnvelope(`${headerBlock}\n${params.content}`)
    fs.writeFileSync(safePathResult.safePath, contentRedacted, 'utf-8')
    if (process.env.SAT_DEBUG_VERBOSE === '1') {
      console.log(`[SAT Debug ${params.kind}] Guardado seguro en: ${safePathResult.safePath}`)
    }
  } catch (err) {
    if (process.env.SAT_DEBUG_VERBOSE === '1') {
      console.error('[SAT Debug] No se pudo escribir archivo de debug (seguridad):', err instanceof Error ? err.message : String(err))
    }
  }
}

export function getSatStatusDescription(code: string, defaultMsg: string): string {
  const satCodes: Record<string, string> = {
    '300': 'Usuario No Válido: Este código indica que el usuario proporcionado no es reconocido o no tiene permisos para realizar la operación solicitada.',
    '301': 'XML Mal Formado: Este código de error se regresa cuando el request posee información invalida, ejemplo: un RFC de receptor no valido.',
    '302': 'Sello Mal Formado: El sello digital enviado no cumple con el formato esperado, lo que impide la validación del documento.',
    '303': 'Sello no corresponde con RfcSolicitante: El sello digital no coincide con el RFC del solicitante registrado en la petición, generando una inconsistencia en la autenticidad.',
    '304': 'Certificado Revocado o Caduco: El certificado puede ser invalido por múltiples razones como son el tipo, la vigencia, etc.',
    '305': 'Certificado Inválido: El certificado puede ser invalido por múltiples razones como son el tipo, la vigencia, etc.',
    '5000': 'Solicitud recibida con éxito: La petición fue recibida correctamente y está en proceso para su análisis o respuesta.',
    '5003': 'Tope máximo de elementos de la consulta: La solicitud sobrepasa el máximo de resultados por tipo de solicitud (Metadata y CFDI)',
    '5004': 'No se encontró la información: No se encontró la información de la solicitud de descarga que se pretende verificar.',
    '5011': 'Límite de descargas por folio por día: Se ha alcanzado o sobrepasado el límite de descargas diarias por folio.',
  }
  
  return satCodes[code] || defaultMsg
}

export async function authenticateWithSat(rfc: string): Promise<string> {
  try {
    const cachedToken = await redis.get(`sat_token:${rfc}`)
    if (cachedToken) {
      return cachedToken
    }
  } catch (error) {
    console.warn('Redis unavailable, skipping cache check:', error instanceof Error ? error.message : String(error))
  }

  const credential = await prisma.satCredential.findFirst({
    where: { rfc },
  })

  if (!credential) {
    throw new Error(`No credentials found for RFC (hash=${crypto.createHash('sha256').update(rfc).digest('hex').slice(0,12)})`)
  }

  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  
  const certificate = credential.certificate.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })

  const created = new Date()
  const expires = new Date(created.getTime() + 5 * 60 * 1000)

  const createdStr = created.toISOString()
  const expiresStr = expires.toISOString()
  const uuid = uuidv4()

  const timestampId = '_0'
  
  const timestampXml = `<u:Timestamp xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" u:Id="${timestampId}"><u:Created>${createdStr}</u:Created><u:Expires>${expiresStr}</u:Expires></u:Timestamp>`

  const shasum = crypto.createHash('sha1')
  shasum.update(timestampXml)
  const digest = shasum.digest('base64')

  const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${timestampId}"><Transforms><Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

  const signer = crypto.createSign('rsa-sha1')
  signer.update(signedInfoXml)
  const signature = signer.sign(privateKey, 'base64')

  const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><s:Header><o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">${timestampXml}<o:BinarySecurityToken u:Id="${uuid}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${certificate}</o:BinarySecurityToken><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signature}</SignatureValue><KeyInfo><o:SecurityTokenReference><o:Reference ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" URI="#${uuid}"/></o:SecurityTokenReference></KeyInfo></Signature></o:Security></s:Header><s:Body><Autentica xmlns="http://DescargaMasivaTerceros.gob.mx"/></s:Body></s:Envelope>`


  const authCheck = __validateSatSoapEndpoint(SAT_AUTH_URL)
  if (!authCheck.ok) throw new Error(`SAT Auth endpoint bloqueado por allow-list: ${authCheck.reason}`)

  __satVerboseLog('[SAT Auth REQUEST (redacted)]:', envelope)
  __satWriteDebugFile({
    rfc,
    kind: 'autenticacion',
    timestamp: created,
    content: envelope,
    extraContextUrl: SAT_AUTH_URL,
    extraHeaders: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION}"`,
    },
  })

  const response = await fetch(SAT_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION}"`,
      'User-Agent': SAT_SOAP_USER_AGENT,
    },
    body: envelope,
    signal: AbortSignal.timeout(SAT_DEBUG_SOAP_TIMEOUT_MS),
  })

  const responseText = await response.text()

  if (!response.ok) {
    __satVerboseLog('[SAT Auth ERROR (redacted)]:', responseText)
    const faultMatch = responseText.match(/<faultstring>(.*?)<\/faultstring>/i) || 
                       responseText.match(/<s:Fault>[\s\S]*?<faultstring>([\s\S]*?)<\/faultstring>[\s\S]*?<\/s:Fault>/)
    
    if (faultMatch && faultMatch[1]) {
       throw new Error(`SAT Auth failed: ${faultMatch[1].substring(0, 500)}`)
    }
    
    throw new Error(`SAT Auth failed with status ${response.status}: ${responseText.substring(0, 200)}`)
  }

  const match = responseText.match(/<[^>]*AutenticaResult>([\s\S]*?)<\/[^>]*AutenticaResult>/i)
  if (match && match[1]) {
    const token = match[1].trim()
    try {
      await redis.set(`sat_token:${rfc}`, token, 'EX', 9 * 60)
    } catch (error) {
      console.warn('Redis unavailable, skipping cache storage:', error instanceof Error ? error.message : String(error))
    }
    return token
  }

  if (responseText.includes('Fault')) {
     throw new Error('SAT returned a Fault: ' + responseText.substring(0, 500))
  }

  throw new Error('Could not retrieve token from SAT response')
}

export async function requestMassDownload(params: {
  rfc: string
  startDate: Date
  endDate: Date
  requestType: 'metadata' | 'cfdi'
  retrievalType: 'emitidos' | 'recibidos' | 'folio'
  receiverRfc?: string | null
  issuerRfc?: string | null
}): Promise<{ idSolicitud: string, message: string }> {
  const token = await authenticateWithSat(params.rfc)

  const credential = await prisma.satCredential.findFirst({ where: { rfc: params.rfc } })
  if (!credential) throw new Error(`No credentials found for RFC (len=${String(params.rfc ?? '').length})`)

  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  const certificateBase64 = credential.certificate.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })

  const certBuffer = Buffer.from(certificateBase64, 'base64')
  const x509 = new crypto.X509Certificate(certBuffer)
  
  const issuerName = x509.issuer.split('\n').reverse().join(', ')
  const serialHex = x509.serialNumber
  const serialNumber = BigInt('0x' + serialHex).toString(10)

  const formatSatDate = (d: Date) => d.toISOString().split('.')[0]
  const fInicial = formatSatDate(params.startDate)
  const fFinal = formatSatDate(params.endDate)

  let solicitudAttrs = `FechaFinal="${fFinal}" FechaInicial="${fInicial}" RfcSolicitante="${params.rfc}" TipoSolicitud="${params.requestType === 'cfdi' ? 'CFDI' : 'Metadata'}"`

  let operationName = 'SolicitaDescargaEmitidos'

  if (params.retrievalType === 'emitidos') {
    operationName = 'SolicitaDescargaEmitidos'
    solicitudAttrs += ` RfcEmisor="${params.rfc}"`
  } else if (params.retrievalType === 'recibidos') {
    operationName = 'SolicitaDescargaRecibidos'
    solicitudAttrs += ` RfcReceptor="${params.rfc}"`
    if (params.issuerRfc) solicitudAttrs += ` RfcEmisor="${params.issuerRfc}"`
  } else if (params.retrievalType === 'folio') {
    operationName = 'SolicitaDescargaFolio'
  }

  const solicitudXml = `<des:solicitud ${solicitudAttrs}></des:solicitud>`

  const shasum = crypto.createHash('sha1')
  shasum.update(solicitudXml)
  const digest = shasum.digest('base64')

  const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

  const signer = crypto.createSign('rsa-sha1')
  signer.update(signedInfoXml)
  const signature = signer.sign(privateKey, 'base64')

  let rfcReceptoresXml = ''
  if (params.retrievalType === 'emitidos' && params.receiverRfc) {
    rfcReceptoresXml = `<des:RfcReceptores><des:RfcReceptor>${params.receiverRfc}</des:RfcReceptor></des:RfcReceptores>`
  }

  const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#"><s:Header><h:Authorization xmlns:h="http://DescargaMasivaTerceros.sat.gob.mx"><h:Token>${token}</h:Token></h:Authorization></s:Header><s:Body><des:${operationName}><des:solicitud ${solicitudAttrs}>${rfcReceptoresXml}<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509IssuerSerial><X509IssuerName>${issuerName}</X509IssuerName><X509SerialNumber>${serialNumber}</X509SerialNumber></X509IssuerSerial><X509Certificate>${certificateBase64}</X509Certificate></X509Data></KeyInfo></Signature></des:solicitud></des:${operationName}></s:Body></s:Envelope>`

  const DOWNLOAD_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc'
  const SOAP_ACTION_REQ = `http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/${operationName}`

  const endpointCheck = __validateSatSoapEndpoint(DOWNLOAD_URL)
  if (!endpointCheck.ok) throw new Error(`SAT Solicita endpoint bloqueado por allow-list: ${endpointCheck.reason}`)

  __satVerboseLog(`\n[SAT Solicita REQUEST (redacted) RFC: ${params.rfc}]`, envelope)
  __satWriteDebugFile({
    rfc: params.rfc,
    kind: 'solicitud',
    timestamp: Date.now(),
    content: envelope,
    extraContextUrl: DOWNLOAD_URL,
    extraHeaders: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION_REQ}"`,
      'Authorization': `WRAP access_token="[REDACTED_TOKEN_LEN_${token.length}]"`,
    },
  })

  const response = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION_REQ}"`,
      'Authorization': `WRAP access_token="${token}"`,
      'User-Agent': SAT_SOAP_USER_AGENT,
    },
    body: envelope,
    signal: AbortSignal.timeout(SAT_DEBUG_SOAP_TIMEOUT_MS),
  })

  const responseText = await response.text()
  
  __satVerboseLog(`\n[SAT Solicita RESPONSE (redacted) RFC: ${params.rfc}]`, responseText)
  
  if (!response.ok) {
    const faultMatch = responseText.match(/<faultstring>(.*?)<\/faultstring>/i)
    if (faultMatch && faultMatch[1]) throw new Error(`Error de SAT: ${faultMatch[1].substring(0, 500)}`)
    throw new Error(`SAT Request failed: HTTP ${response.status}`)
  }

  const idMatch = responseText.match(/IdSolicitud\s*=\s*"([^"]+)"/i)
  const statusMatch = responseText.match(/CodEstatus\s*=\s*"([^"]+)"/i)
  const msgMatch = responseText.match(/Mensaje\s*=\s*"([^"]+)"/i)

  const code = statusMatch ? statusMatch[1].trim() : 'Desconocido'
  const message = msgMatch ? msgMatch[1].trim() : 'Sin mensaje'
  const finalMessage = getSatStatusDescription(code, message)

  if (code !== '5000') {
    throw new Error(`Solicitud rechazada. Código SAT: ${code}, Mensaje: ${finalMessage}`)
  }

  if (!idMatch || !idMatch[1]) {
    throw new Error('SAT aceptó la solicitud pero no devolvió IdSolicitud: hash=' + crypto.createHash('sha256').update(responseText).digest('hex').slice(0,12))
  }

  return { idSolicitud: idMatch[1], message: finalMessage }
}

export async function verifyMassDownload(params: {
  rfc: string
  idSolicitud: string
}): Promise<{
  estadoSolicitud: string
  codigoEstadoSolicitud: string
  numeroCFDIs: string
  mensaje: string
  idsPaquetes: string[]
}> {
  const token = await authenticateWithSat(params.rfc)

  const credential = await prisma.satCredential.findFirst({ where: { rfc: params.rfc } })
  if (!credential) throw new Error(`No credentials found for RFC (len=${String(params.rfc ?? '').length})`)

  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  const certificateBase64 = credential.certificate.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })

  const certBuffer = Buffer.from(certificateBase64, 'base64')
  const x509 = new crypto.X509Certificate(certBuffer)
  const issuerName = x509.issuer.split('\n').reverse().join(', ')
  const serialHex = x509.serialNumber
  const serialNumber = BigInt('0x' + serialHex).toString(10)

  const solicitudAttrs = `IdSolicitud="${params.idSolicitud}" RfcSolicitante="${params.rfc}"`
  const solicitudXml = `<des:solicitud ${solicitudAttrs}></des:solicitud>`

  const shasum = crypto.createHash('sha1')
  shasum.update(solicitudXml)
  const digest = shasum.digest('base64')

  const signedInfoXml = `<SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

  const signer = crypto.createSign('rsa-sha1')
  signer.update(signedInfoXml)
  const signature = signer.sign(privateKey, 'base64')

  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#"><soapenv:Header/><soapenv:Body><des:VerificaSolicitudDescarga><des:solicitud ${solicitudAttrs}><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509IssuerSerial><X509IssuerName>${issuerName}</X509IssuerName><X509SerialNumber>${serialNumber}</X509SerialNumber></X509IssuerSerial><X509Certificate>${certificateBase64}</X509Certificate></X509Data></KeyInfo></Signature></des:solicitud></des:VerificaSolicitudDescarga></soapenv:Body></soapenv:Envelope>`

  const VERIFY_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/VerificaSolicitudDescargaService.svc'
  const SOAP_ACTION_VER = 'http://DescargaMasivaTerceros.sat.gob.mx/IVerificaSolicitudDescargaService/VerificaSolicitudDescarga'

  const endpointCheck = __validateSatSoapEndpoint(VERIFY_URL)
  if (!endpointCheck.ok) throw new Error(`SAT Verifica endpoint bloqueado por allow-list: ${endpointCheck.reason}`)

  __satVerboseLog(`\n[SAT Verifica REQUEST (redacted) IdSolicitud: ${params.idSolicitud}]`, envelope)
  __satWriteDebugFile({
    rfc: params.rfc,
    kind: 'verificacion',
    timestamp: Date.now(),
    content: envelope,
    extraContextUrl: VERIFY_URL,
    extraHeaders: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION_VER}"`,
      'Authorization': `WRAP access_token="[REDACTED_TOKEN_LEN_${token.length}]"`,
    },
  })

  const response = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION_VER}"`,
      'Authorization': `WRAP access_token="${token}"`,
      'User-Agent': SAT_SOAP_USER_AGENT,
    },
    body: envelope,
    signal: AbortSignal.timeout(SAT_DEBUG_SOAP_TIMEOUT_MS),
  })

  const responseText = await response.text()
  
  if (!response.ok) {
    throw new Error(`SAT Verifica Request failed: HTTP ${response.status} - ${responseText.substring(0, 200)}`)
  }

  const estadoMatch = responseText.match(/EstadoSolicitud\s*=\s*"([^"]+)"/i)
  const codEstadoMatch = responseText.match(/CodigoEstadoSolicitud\s*=\s*"([^"]+)"/i)
  const msgMatch = responseText.match(/Mensaje\s*=\s*"([^"]+)"/i)
  const numCfdisMatch = responseText.match(/NumeroCFDIs\s*=\s*"([^"]+)"/i)

  const estadoSolicitud = estadoMatch ? estadoMatch[1] : ''
  const codigoEstado = codEstadoMatch ? codEstadoMatch[1] : (responseText.match(/CodEstatus\s*=\s*"([^"]+)"/i)?.[1] || '')
  const mensaje = msgMatch ? msgMatch[1] : ''
  const numeroCFDIs = numCfdisMatch ? numCfdisMatch[1] : '0'

  const finalMessage = getSatStatusDescription(codigoEstado, mensaje)

  if (codigoEstado === '5004') {
    console.error(
      `[SAT Verifica ERROR 5004] IdSolicitud: ${params.idSolicitud}, RFC(len)=${String(params.rfc).length}`
    )
  }

  const idsPaquetes: string[] = []
  const regex = /<(?:[a-zA-Z0-9]+:)?IdsPaquetes(?:[^>]*)>([^<]+)<\/(?:[a-zA-Z0-9]+:)?IdsPaquetes>/gi
  let m;
  while ((m = regex.exec(responseText)) !== null) {
    if (m[1]) idsPaquetes.push(m[1].trim())
  }

  return {
    estadoSolicitud,
    codigoEstadoSolicitud: codigoEstado,
    mensaje: finalMessage,
    numeroCFDIs,
    idsPaquetes,
  }
}

export async function downloadMassPackages(params: {
  rfc: string
  idPaquete: string
}): Promise<{ paqueteB64: string }> {
  const token = await authenticateWithSat(params.rfc)

  const credential = await prisma.satCredential.findFirst({ where: { rfc: params.rfc } })
  if (!credential) throw new Error(`No credentials found for RFC (len=${String(params.rfc ?? '').length})`)

  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  const certificateBase64 = credential.certificate.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })

  const certBuffer = Buffer.from(certificateBase64, 'base64')
  const x509 = new crypto.X509Certificate(certBuffer)
  const issuerName = x509.issuer.split('\n').reverse().join(', ')
  const serialHex = x509.serialNumber
  const serialNumber = BigInt('0x' + serialHex).toString(10)

  const peticionAttrs = `IdPaquete="${params.idPaquete}" RfcSolicitante="${params.rfc}"`
  const peticionXml = `<des:peticionDescarga ${peticionAttrs}></des:peticionDescarga>`

  const shasum = crypto.createHash('sha1')
  shasum.update(peticionXml)
  const digest = shasum.digest('base64')

  const signedInfoXml = `<SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

  const signer = crypto.createSign('rsa-sha1')
  signer.update(signedInfoXml)
  const signature = signer.sign(privateKey, 'base64')

  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#"><soapenv:Header/><soapenv:Body><des:PeticionDescargaMasivaTercerosEntrada><des:peticionDescarga ${peticionAttrs}><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509IssuerSerial><X509IssuerName>${issuerName}</X509IssuerName><X509SerialNumber>${serialNumber}</X509SerialNumber></X509IssuerSerial><X509Certificate>${certificateBase64}</X509Certificate></X509Data></KeyInfo></Signature></des:peticionDescarga></des:PeticionDescargaMasivaTercerosEntrada></soapenv:Body></soapenv:Envelope>`

  const DOWNLOAD_URL = 'https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc'
  const SOAP_ACTION_DL = 'http://DescargaMasivaTerceros.sat.gob.mx/IDescargaMasivaTercerosService/Descargar'

  const endpointCheck = __validateSatSoapEndpoint(DOWNLOAD_URL)
  if (!endpointCheck.ok) throw new Error(`SAT Descarga endpoint bloqueado por allow-list: ${endpointCheck.reason}`)

  __satVerboseLog(`\n[SAT Descarga REQUEST (redacted) IdPaquete: ${params.idPaquete}]`, envelope)
  __satWriteDebugFile({
    rfc: params.rfc,
    kind: 'descarga',
    timestamp: Date.now(),
    content: envelope,
    extraContextUrl: DOWNLOAD_URL,
    extraHeaders: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION_DL}"`,
      'Authorization': `WRAP access_token="[REDACTED_TOKEN_LEN_${token.length}]"`,
    },
  })

  const response = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION_DL}"`,
      'Authorization': `WRAP access_token="${token}"`,
      'User-Agent': SAT_SOAP_USER_AGENT,
    },
    body: envelope,
    signal: AbortSignal.timeout(SAT_DEBUG_SOAP_TIMEOUT_MS),
  })

  const responseText = await response.text()
  
  if (!response.ok) {
    throw new Error(`SAT Descarga Request failed: HTTP ${response.status} - ${responseText.substring(0, 200)}`)
  }

  const statusMatch = responseText.match(/CodEstatus\s*=\s*"([^"]+)"/i)
  const msgMatch = responseText.match(/Mensaje\s*=\s*"([^"]+)"/i)

  const code = statusMatch ? statusMatch[1] : 'Desconocido'
  const message = msgMatch ? msgMatch[1] : 'Sin mensaje'
  const finalMessage = getSatStatusDescription(code, message)

  if (code !== '5000') {
    throw new Error(`Descarga rechazada. Código SAT: ${code}, Mensaje: ${finalMessage}`)
  }

  const paqueteMatch = responseText.match(/<(?:[a-zA-Z0-9]+:)?Paquete[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?Paquete>/i)
  
  if (!paqueteMatch || !paqueteMatch[1]) {
    throw new Error(`El SAT aceptó la solicitud pero no devolvió el paquete codificado en Base64. Respuesta hash=${crypto.createHash('sha256').update(responseText).digest('hex').slice(0,12)}`)
  }

  return { paqueteB64: paqueteMatch[1].trim() }
}

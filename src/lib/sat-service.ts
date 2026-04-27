import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/encryption'
import { redis } from '@/lib/redis'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'

const SAT_AUTH_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc'
const SOAP_ACTION = 'http://DescargaMasivaTerceros.gob.mx/IAutenticacion/Autentica'

// Diccionario de Códigos de Estatus del SAT
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
  // 1. Check Redis for existing token
  try {
    const cachedToken = await redis.get(`sat_token:${rfc}`)
    if (cachedToken) {
      return cachedToken
    }
  } catch (error) {
    console.warn('Redis unavailable, skipping cache check:', error)
  }

  // 2. Fetch credentials
  const credential = await prisma.satCredential.findFirst({
    where: { rfc },
  })

  if (!credential) {
    throw new Error(`No credentials found for RFC ${rfc}`)
  }

  // 3. Decrypt keys
  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  
  // Clean certificate (remove headers if present)
  const certificate = credential.certificate.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')

  // Create KeyObject with passphrase
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })

  // 4. Generate Timestamp
  const created = new Date()
  const expires = new Date(created.getTime() + 5 * 60 * 1000) // 5 minutes

  const createdStr = created.toISOString()
  const expiresStr = expires.toISOString()
  const uuid = uuidv4()

  // 5. Construct XML for Signature
  
  const timestampId = '_0'
  
  // Create the Timestamp XML fragment to sign/digest
  // Note: Explicit namespaces are critical for canonicalization consistency
  const timestampXml = `<u:Timestamp xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" u:Id="${timestampId}"><u:Created>${createdStr}</u:Created><u:Expires>${expiresStr}</u:Expires></u:Timestamp>`

  // Calculate Digest of the Timestamp
  const shasum = crypto.createHash('sha1')
  shasum.update(timestampXml)
  const digest = shasum.digest('base64')

  // Construct SignedInfo XML exactly as it will appear
  // No whitespace between elements to match canonicalization expectations usually found in manual construction
  const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${timestampId}"><Transforms><Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

  // Sign the SignedInfo
  const signer = crypto.createSign('rsa-sha1')
  signer.update(signedInfoXml)
  const signature = signer.sign(privateKey, 'base64')

  // 6. Construct SOAP Envelope
  // We manually construct the envelope string to ensure byte-for-byte matching with what we signed/digested
  // xmlbuilder can be unpredictable with namespace placement and ordering
  
  const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><s:Header><o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">${timestampXml}<o:BinarySecurityToken u:Id="${uuid}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${certificate}</o:BinarySecurityToken><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signature}</SignatureValue><KeyInfo><o:SecurityTokenReference><o:Reference ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" URI="#${uuid}"/></o:SecurityTokenReference></KeyInfo></Signature></o:Security></s:Header><s:Body><Autentica xmlns="http://DescargaMasivaTerceros.gob.mx"/></s:Body></s:Envelope>`


  // 7. Send Request
  console.log('SAT Auth SOAPAction:', SOAP_ACTION)
  console.log('SAT Auth XML Request:', envelope)

  const response = await fetch(SAT_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION}"`,
    },
    body: envelope,
  })

  const responseText = await response.text()

  if (!response.ok) {
    console.error('SAT Auth Error Response:', responseText)
    // Try to extract Fault string
    const faultMatch = responseText.match(/<faultstring>(.*?)<\/faultstring>/i) || 
                       responseText.match(/<s:Fault>[\s\S]*?<faultstring>([\s\S]*?)<\/faultstring>[\s\S]*?<\/s:Fault>/)
    
    if (faultMatch && faultMatch[1]) {
       throw new Error(`SAT Auth failed: ${faultMatch[1]}`)
    }
    
    throw new Error(`SAT Auth failed with status ${response.status}: ${responseText.substring(0, 200)}`)
  }

  // 8. Parse Response
  // Expecting <AutenticaResult>TOKEN...</AutenticaResult> or similar
  // Or sometimes it's inside the header or body.
  const match = responseText.match(/<[^>]*AutenticaResult>([\s\S]*?)<\/[^>]*AutenticaResult>/i)
  if (match && match[1]) {
    const token = match[1].trim()
    // Store in Redis (expires in 5 mins usually, but we can set 4 mins to be safe)
    try {
      await redis.set(`sat_token:${rfc}`, token, 'EX', 9 * 60)
    } catch (error) {
      console.warn('Redis unavailable, skipping cache storage:', error)
    }
    return token
  }

  // Sometimes it might return a fault
  if (responseText.includes('Fault')) {
     throw new Error('SAT returned a Fault: ' + responseText)
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
  // 1. Autenticar
  const token = await authenticateWithSat(params.rfc)

  // 2. Obtener Credenciales
  const credential = await prisma.satCredential.findFirst({ where: { rfc: params.rfc } })
  if (!credential) throw new Error(`No credentials found for RFC ${params.rfc}`)

  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  const certificateBase64 = credential.certificate.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })

  // Obtener info del certificado
  const certBuffer = Buffer.from(certificateBase64, 'base64')
  const x509 = new crypto.X509Certificate(certBuffer)
  
  // Extraer el subject de forma compatible con SAT (OID...)
  // El SAT suele aceptar el formato estandar o prefiere el de BouncyCastle, pero x509.issuer devuelve una cadena separada por saltos de línea en node
  const issuerName = x509.issuer.split('\n').reverse().join(', ')
  const serialHex = x509.serialNumber
  const serialNumber = BigInt('0x' + serialHex).toString(10) // SAT exige el serial en decimal

  // 3. Formatear fechas
  const formatSatDate = (d: Date) => d.toISOString().split('.')[0] // YYYY-MM-DDTHH:mm:ss
  const fInicial = formatSatDate(params.startDate)
  const fFinal = formatSatDate(params.endDate)

  // 4. Armar el nodo de Solicitud a firmar
  let solicitudAttrs = `FechaFinal="${fFinal}" FechaInicial="${fInicial}" RfcSolicitante="${params.rfc}" TipoSolicitud="${params.requestType === 'cfdi' ? 'CFDI' : 'Metadata'}"`

  let operationName = 'SolicitaDescargaEmitidos'

  if (params.retrievalType === 'emitidos') {
    operationName = 'SolicitaDescargaEmitidos'
    solicitudAttrs += ` RfcEmisor="${params.rfc}"`
    // El SAT para emitidos usa el elemento RfcReceptores, no atributo RfcReceptor. 
    // Por simplicidad si no mandamos receptores, lo omitimos.
  } else if (params.retrievalType === 'recibidos') {
    operationName = 'SolicitaDescargaRecibidos'
    solicitudAttrs += ` RfcReceptor="${params.rfc}"`
    if (params.issuerRfc) solicitudAttrs += ` RfcEmisor="${params.issuerRfc}"`
  } else if (params.retrievalType === 'folio') {
    operationName = 'SolicitaDescargaFolio'
  }

  const solicitudXml = `<des:solicitud ${solicitudAttrs}></des:solicitud>`

  // Generar Digest de la Solicitud
  const shasum = crypto.createHash('sha1')
  shasum.update(solicitudXml)
  const digest = shasum.digest('base64')

  // Generar SignedInfo
  const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

  const signer = crypto.createSign('rsa-sha1')
  signer.update(signedInfoXml)
  const signature = signer.sign(privateKey, 'base64')

  // Si hubiera receptores en emitidos:
  let rfcReceptoresXml = ''
  if (params.retrievalType === 'emitidos' && params.receiverRfc) {
    rfcReceptoresXml = `<des:RfcReceptores><des:RfcReceptor>${params.receiverRfc}</des:RfcReceptor></des:RfcReceptores>`
  }

  // 5. Construir Envoltorio SOAP
  const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#"><s:Header><h:Authorization xmlns:h="http://DescargaMasivaTerceros.sat.gob.mx"><h:Token>${token}</h:Token></h:Authorization></s:Header><s:Body><des:${operationName}><des:solicitud ${solicitudAttrs}>${rfcReceptoresXml}<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509IssuerSerial><X509IssuerName>${issuerName}</X509IssuerName><X509SerialNumber>${serialNumber}</X509SerialNumber></X509IssuerSerial><X509Certificate>${certificateBase64}</X509Certificate></X509Data></KeyInfo></Signature></des:solicitud></des:${operationName}></s:Body></s:Envelope>`

  const DOWNLOAD_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc'
  const SOAP_ACTION = `http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/${operationName}`

  // Log detallado de la petición de solicitud
  console.log(`\n[SAT Solicita REQUEST - RFC: ${params.rfc}]`)
  console.log(envelope)

  // Guardar el XML generado en un archivo físico para que el usuario pueda probarlo en SoapUI
  try {
    const timestamp = new Date().getTime()
    const debugFilePath = path.join(process.cwd(), `Debug_Solicitud_${params.rfc}_${timestamp}.xml`)
    
    // Agregamos los headers HTTP como comentarios o un bloque separado para ayudar a armar el SoapUI
    const debugContent = `POST ${DOWNLOAD_URL} HTTP/1.1
Content-Type: text/xml; charset=utf-8
SOAPAction: "${SOAP_ACTION}"
Authorization: WRAP access_token="${token}"

${envelope}`
    
    fs.writeFileSync(debugFilePath, debugContent, 'utf-8')
    console.log(`[SAT Solicita DEBUG] Archivo de petición guardado en: ${debugFilePath}`)
  } catch (error) {
    console.error('No se pudo guardar el archivo de debug de solicitud:', error)
  }

  const response = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION}"`,
      'Authorization': `WRAP access_token="${token}"`
    },
    body: envelope,
  })

  const responseText = await response.text()
  
  console.log(`\n[SAT Solicita RESPONSE - RFC: ${params.rfc}]`)
  console.log(responseText)
  
  if (!response.ok) {
    console.error('SAT SolicitaDescarga Error:', responseText)
    const faultMatch = responseText.match(/<faultstring>(.*?)<\/faultstring>/i)
    if (faultMatch && faultMatch[1]) throw new Error(`Error de SAT: ${faultMatch[1]}`)
    throw new Error(`SAT Request failed: HTTP ${response.status}`)
  }

  // Extraer IdSolicitud y Código de Estatus usando regex robustas
  const idMatch = responseText.match(/IdSolicitud\s*=\s*"([^"]+)"/i)
  const statusMatch = responseText.match(/CodEstatus\s*=\s*"([^"]+)"/i)
  const msgMatch = responseText.match(/Mensaje\s*=\s*"([^"]+)"/i)

  const code = statusMatch ? statusMatch[1].trim() : 'Desconocido'
  const message = msgMatch ? msgMatch[1].trim() : 'Sin mensaje'
  const finalMessage = getSatStatusDescription(code, message)

  if (code !== '5000') {
    throw new Error(`Solicitud rechazada. Código SAT: ${code}, Mensaje: ${finalMessage}\n\nXML Enviado:\n${solicitudXml}`)
  }

  if (!idMatch || !idMatch[1]) {
    throw new Error('SAT aceptó la solicitud pero no devolvió IdSolicitud: ' + responseText)
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
  // 1. Autenticar
  const token = await authenticateWithSat(params.rfc)

  // 2. Obtener Credenciales
  const credential = await prisma.satCredential.findFirst({ where: { rfc: params.rfc } })
  if (!credential) throw new Error(`No credentials found for RFC ${params.rfc}`)

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

  // 3. Armar el nodo de Solicitud a firmar
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
  const SOAP_ACTION = 'http://DescargaMasivaTerceros.sat.gob.mx/IVerificaSolicitudDescargaService/VerificaSolicitudDescarga'

  // Log detallado de la petición de verificación
  console.log(`\n[SAT Verifica REQUEST - IdSolicitud: ${params.idSolicitud}]`)
  console.log(envelope)

  // Guardar el XML generado en un archivo físico para que el usuario pueda probarlo en SoapUI
  try {
    const debugFilePath = path.join(process.cwd(), `Debug_Verificacion_${params.idSolicitud}.xml`)
    
    // Agregamos los headers HTTP como comentarios o un bloque separado para ayudar a armar el SoapUI
    const debugContent = `POST ${VERIFY_URL} HTTP/1.1
Content-Type: text/xml; charset=utf-8
SOAPAction: "${SOAP_ACTION}"
Authorization: WRAP access_token="${token}"

${envelope}`
    
    fs.writeFileSync(debugFilePath, debugContent, 'utf-8')
    console.log(`[SAT Verifica DEBUG] Archivo de petición guardado en: ${debugFilePath}`)
  } catch (error) {
    console.error('No se pudo guardar el archivo de debug de verificación:', error)
  }

  const response = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION}"`,
      'Authorization': `WRAP access_token="${token}"`
    },
    body: envelope,
  })

  const responseText = await response.text()
  
  if (!response.ok) {
    throw new Error(`SAT Verifica Request failed: HTTP ${response.status} - ${responseText.substring(0, 200)}`)
  }

  // Parsear respuesta
  const estadoMatch = responseText.match(/EstadoSolicitud\s*=\s*"([^"]+)"/i)
  const codEstadoMatch = responseText.match(/CodigoEstadoSolicitud\s*=\s*"([^"]+)"/i)
  const msgMatch = responseText.match(/Mensaje\s*=\s*"([^"]+)"/i)
  const numCfdisMatch = responseText.match(/NumeroCFDIs\s*=\s*"([^"]+)"/i)

  const estadoSolicitud = estadoMatch ? estadoMatch[1] : ''
  const codigoEstado = codEstadoMatch ? codEstadoMatch[1] : (responseText.match(/CodEstatus\s*=\s*"([^"]+)"/i)?.[1] || '')
  const mensaje = msgMatch ? msgMatch[1] : ''
  const numeroCFDIs = numCfdisMatch ? numCfdisMatch[1] : '0'

  const finalMessage = getSatStatusDescription(codigoEstado, mensaje)

  // Log detallado para depurar errores como el 5004 ("No se encontró la información")
  if (codigoEstado === '5004') {
    console.error(`[SAT Verifica ERROR 5004] IdSolicitud: ${params.idSolicitud}, RFC: ${params.rfc}`)
    console.error(`[SAT Verifica RESPONSE]:\n${responseText.substring(0, 500)}`)
  }

  const idsPaquetes: string[] = []
  // Expresión regular mejorada para soportar posibles prefijos de namespace (ej. <des:IdsPaquetes>)
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
  // 1. Autenticar
  const token = await authenticateWithSat(params.rfc)

  // 2. Obtener Credenciales
  const credential = await prisma.satCredential.findFirst({ where: { rfc: params.rfc } })
  if (!credential) throw new Error(`No credentials found for RFC ${params.rfc}`)

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

  // 3. Armar el nodo de Solicitud a firmar
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
  const SOAP_ACTION = 'http://DescargaMasivaTerceros.sat.gob.mx/IDescargaMasivaTercerosService/Descargar'

  const response = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${SOAP_ACTION}"`,
      'Authorization': `WRAP access_token="${token}"`
    },
    body: envelope,
  })

  const responseText = await response.text()
  
  if (!response.ok) {
    throw new Error(`SAT Descarga Request failed: HTTP ${response.status} - ${responseText.substring(0, 200)}`)
  }

  // Parsear el estatus de la respuesta (ej. <h:respuesta CodEstatus="5000" Mensaje="Solicitud Aceptada">)
  const statusMatch = responseText.match(/CodEstatus\s*=\s*"([^"]+)"/i)
  const msgMatch = responseText.match(/Mensaje\s*=\s*"([^"]+)"/i)

  const code = statusMatch ? statusMatch[1] : 'Desconocido'
  const message = msgMatch ? msgMatch[1] : 'Sin mensaje'
  const finalMessage = getSatStatusDescription(code, message)

  if (code !== '5000') {
    throw new Error(`Descarga rechazada. Código SAT: ${code}, Mensaje: ${finalMessage}`)
  }

  // Extraer paquete en Base64 (Robusto para ignorar prefijos de namespace o espacios)
  const paqueteMatch = responseText.match(/<(?:[a-zA-Z0-9]+:)?Paquete[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?Paquete>/i)
  
  if (!paqueteMatch || !paqueteMatch[1]) {
    throw new Error(`El SAT aceptó la solicitud pero no devolvió el paquete codificado en Base64. Respuesta: ${responseText.substring(0, 300)}`)
  }

  return { paqueteB64: paqueteMatch[1].trim() }
}

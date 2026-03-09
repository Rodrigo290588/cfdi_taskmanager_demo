import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/encryption'
import { redis } from '@/lib/redis'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

const SAT_AUTH_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc'
const SOAP_ACTION = 'http://DescargaMasivaTerceros.gob.mx/IAutenticacion/Autentica'

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
  // Standard response:
  // <AutenticaResponse>
  //   <AutenticaResult>token...</AutenticaResult>
  // </AutenticaResponse>
  
  const match = responseText.match(/<AutenticaResult>(.*?)<\/AutenticaResult>/)
  if (match && match[1]) {
    const token = match[1]
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

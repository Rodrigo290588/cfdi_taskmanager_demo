
import { SatSoapService } from '../services/sat-soap.service'
import crypto from 'crypto'

const service = new SatSoapService()

// Generate dummy key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
})

// Dummy certificate (just base64 of public key for testing structure)
const certificate = publicKey

const options = {
  rfcSolicitante: 'AAA010101AAA',
  startDate: new Date(),
  endDate: new Date(),
  tipoSolicitud: 'CFDI' as const,
  retrievalType: 'emitidos' as const,
  rfcEmisor: 'AAA010101AAA',
  certificate,
  privateKey
}

console.log('Generating SOAP with mock keys...')
const soap = service.generateSolicitaDescargaSoap(options)
console.log('--- SOAP OUTPUT ---')
console.log(soap)
console.log('-------------------')

// Validation Checks
let valid = true

// 1. Check for absence of wsse:Security in Header
if (soap.includes('<wsse:Security') || soap.includes('<o:Security')) {
    console.error('FAIL: Security header found! (Should be removed)')
    valid = false
} else {
    console.log('PASS: No Security header found.')
}

// 2. Check Signature Location (inside solicitud)
const signatureIndex = soap.indexOf('<Signature')
const solicitudEndIndex = soap.indexOf('</solicitud>')

if (signatureIndex > -1 && signatureIndex < solicitudEndIndex) {
    console.log('PASS: Signature is inside <solicitud>.')
} else {
    console.error('FAIL: Signature is NOT inside <solicitud> or missing.')
    valid = false
}

// 3. Check mustUnderstand
if (soap.includes('mustUnderstand="1"')) {
    console.error('FAIL: mustUnderstand="1" found!')
    valid = false
} else {
    console.log('PASS: mustUnderstand="1" NOT found.')
}

// 4. Check Id="Solicitud" (SHOULD NOT BE PRESENT per WSDL)
if (soap.includes('Id="Solicitud"')) {
    console.error('FAIL: Id="Solicitud" found (Should be removed per WSDL).')
    valid = false
} else {
    console.log('PASS: Id="Solicitud" NOT found.')
}

// 5. Check Reference URI (Should be empty "")
if (soap.includes('URI=""')) {
    console.log('PASS: Reference URI="" found.')
} else {
    console.error('FAIL: Reference URI="" NOT found.')
    valid = false
}

// 6. Check KeyInfo
if (soap.includes('<X509Data><X509Certificate>')) {
    console.log('PASS: KeyInfo X509Data found.')
} else {
    console.error('FAIL: KeyInfo X509Data NOT found.')
    valid = false
}

if (valid) {
    console.log('\n✅ STRUCTURE VALIDATION SUCCESSFUL')
} else {
    console.error('\n❌ STRUCTURE VALIDATION FAILED')
    process.exit(1)
}

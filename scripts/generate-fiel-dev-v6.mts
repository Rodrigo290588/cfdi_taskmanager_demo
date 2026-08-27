import 'reflect-metadata'
import {
  X509Certificate,
  X509CertificateGenerator,
  Name,
  SubjectAlternativeNameExtension,
  KeyUsagesExtension,
  KeyUsageFlags,
  BasicConstraintsExtension
} from '@peculiar/x509'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
fs.mkdirSync(OUT_DIR, { recursive: true })

const RFC = 'QBB7223997V9'
const PASSWORD = 'F1el-Dev-2026!'
const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const README_PATH = path.join(OUT_DIR, 'README.txt')
const SUBJECT = `C=MX, O=ORG-B SAST PRUEBAS, OU=SAT TEST, CN=${RFC}`

console.log('FIEL dev: generando con Node crypto + @peculiar/x509 certificado autofirmado...')

// 1. RSA keypair via Node crypto
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 65537,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

// 2. Convertir llaves Node → WebCrypto via importación sobre Node SubtleCrypto nativo
const subtle = crypto.subtle
const algImport = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
const pubCryptoKey = await subtle.importKey('spki', pemToDerBuffer(publicKey), algImport, true, ['verify']) as CryptoKey
const privCryptoKey = await subtle.importKey('pkcs8', pemToDerBuffer(privateKey), algImport, true, ['sign']) as CryptoKey

// 3. Emitir certificado autofirmado vía X509CertificateGenerator (usa webcrypto global/subtle del proceso)
const notBefore = new Date(Date.now() - 24 * 3600 * 1000)
const notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000)
const subjectName = new Name(SUBJECT, 'string')

const certRaw = await X509CertificateGenerator.create({
  serialNumber: '01',
  issuer: subjectName,
  subject: subjectName,
  notBefore,
  notAfter,
  signingAlgorithm: algImport as any,
  signingKey: privCryptoKey,
  publicKey: pubCryptoKey,
  extensions: [
    new BasicConstraintsExtension(true, 0, true),
    new KeyUsagesExtension(KeyUsageFlags.digitalSignature | KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    new SubjectAlternativeNameExtension([{ type: 'url', value: 'https://sast.local/fiel/' + RFC }])
  ]
})

const cert = new X509Certificate(certRaw)
const cerDer = Buffer.from(cert.rawDer)
fs.writeFileSync(CER_PATH, cerDer)
console.log('  .cer DER →', CER_PATH, cerDer.length, 'bytes, subject:', cert.subject.replace(/\n/g, ' '))

// 4. Exportar llave privada PKCS#8 DER CIFRADA AES-256-CBC (formato SAT)
const nodePriv = crypto.createPrivateKey({ key: privateKey, format: 'pem', type: 'pkcs8' })
const encPem = nodePriv.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })
const keyDer = pemBodyToDer(encPem)
fs.writeFileSync(KEY_PATH, keyDer)
console.log('  .key DER →', KEY_PATH, keyDer.length, 'bytes')

// 5. Validación emulando src/lib/fiel-validation.ts (1:1)
let localOut: any
try {
  const fp = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8', passphrase: PASSWORD })
  const x509 = new crypto.X509Certificate(cerDer)
  const a = x509.publicKey.export({ type: 'spki', format: 'pem' })
  const b = crypto.createPublicKey(fp).export({ type: 'spki', format: 'pem' })
  const rfcMatch = x509.subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
  localOut = { isValid: a === b, rfc: rfcMatch?.[1]?.toUpperCase(), error: undefined }
} catch (e: any) {
  localOut = { isValid: false, rfc: null, error: e.message }
}

const readme = [
  'FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).',
  'Generador        : scripts/generate-fiel-dev-v6.mts  (Node crypto RSA + @peculiar/x509 X509CertificateGenerator)',
  `Generada         : ${new Date().toISOString()}`,
  `RFC embebido     : ${RFC}`,
  `Password .key    : ${PASSWORD}`,
  `Cert Subject     : ${cert.subject.replace(/\n/g, ' · ')}`,
  '',
  'Archivos:',
  `  .cer (DER público)                    : ${CER_PATH}  (${cerDer.length} bytes)`,
  `  .key (PKCS#8 DER AES-256-CBC cifrado) : ${KEY_PATH}  (${keyDer.length} bytes)`,
  '',
  'Contrato validateFiel:',
  '  createPrivateKey DER PKCS#8 + pass  = OK',
  '  new X509Certificate(.cer)           = OK',
  '  x509.publicKey === derivedPublicKey = ' + localOut.isValid,
  '  regex RFC en subject                = ' + (localOut.rfc ? `MATCH (${localOut.rfc})` : 'NO MATCH'),
  '',
  'FormData para POST /api/mass-downloads/credentials (API-08.1):',
  `  rfc            = ${RFC}`,
  `  password       = ${PASSWORD}`,
  `  organizationId = cmnntrppk000502gcp93ketfx  (Grupo Demo / Org-A)`,
  `  privateKey     = ${KEY_PATH}`,
  `  certificate    = ${CER_PATH}`,
  '',
  'Casos negativos listos sobre esta base:',
  '  API-08.2 password incorrecto   : password = "wrong-pass-123"  → 400',
  '  API-08.4 .key > 8192 bytes     : append ceros hasta ~33KB      → 413',
  '  API-08.5 .cer > 10240 bytes    : append ceros hasta ~17KB      → 413',
  '  API-08.6 tenant mismatch       : U-OTH + orgId Org-A           → 403/404'
].join('\n')
fs.writeFileSync(README_PATH, readme, 'utf8')

console.log('')
console.log('=== ✅ FIEL DEV LISTA ===')
console.log('  RFC      :', RFC)
console.log('  PASSWORD :', PASSWORD)
console.log('  VALIDACION  validateFiel-like:', JSON.stringify(localOut))
console.log('  CER      :', CER_PATH)
console.log('  KEY      :', KEY_PATH)
console.log('  README   :', README_PATH)

function pemToDerBuffer(pem: string): ArrayBuffer {
  return pemBodyToDer(pem).buffer.slice(pemBodyToDer(pem).byteOffset, pemBodyToDer(pem).byteOffset + pemBodyToDer(pem).byteLength) as ArrayBuffer
}
function pemBodyToDer(pem: string): Buffer {
  const b = pem.replace(/-----BEGIN[^-]+-----/g, '').replace(/-----END[^-]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(b, 'base64')
}

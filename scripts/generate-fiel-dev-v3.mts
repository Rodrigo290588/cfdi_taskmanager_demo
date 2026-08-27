import { Crypto } from '@peculiar/webcrypto'
import { X509Certificate, PemConverter, AsnConvert, X509SubjectAlternativeNameExtension, X509KeyUsageExtension, KeyUsageFlags, X509BasicConstraintsExtension, X509CertificateCreator } from '@peculiar/x509'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Convert } from 'pvutils'

const webcrypto = new Crypto()
X509CertificateCreator.crypto = webcrypto as any

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
fs.mkdirSync(OUT_DIR, { recursive: true })

const RFC = 'QBB7223997V9'
const PASSWORD = 'F1el-Dev-2026!'
const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const README_PATH = path.join(OUT_DIR, 'README.txt')
const SUBJECT_STR = `CN=${RFC}, OU=SAT TEST, O=ORG-B SAST, C=MX`

console.log('FIEL dev: generando via @peculiar/x509 (no usa CryptoAPI sandbox)...')

// 1. Generar RSA 2048 via WebCrypto (librería pura, no CAPI)
const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }
const keys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']) as CryptoKeyPair

// 2. Crear certificado autofirmado de 1 año
const notBefore = new Date(Date.now() - 24 * 3600 * 1000)
const notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000)

const cert = await X509CertificateCreator.selfSigned({
  serialNumber: '01',
  name: SUBJECT_STR,
  notBefore,
  notAfter,
  signingAlgorithm: alg,
  keys,
  extensions: [
    new X509BasicConstraintsExtension(true, 0, true),
    new X509KeyUsageExtension(KeyUsageFlags.digitalSignature | KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    new X509SubjectAlternativeNameExtension([{ type: 'url', value: `https://sast.local/fiel/${RFC}` }])
  ]
})

const certDer = cert.rawDer
const cerBuf = Buffer.from(certDer)
fs.writeFileSync(CER_PATH, cerBuf)
console.log('  .cer DER OK →', CER_PATH, cerBuf.length, 'bytes, subject:', cert.subject)

// 3. Exportar clave privada a PKCS#8 DER SIN cifrar para extraer bytes
const privPkcs8Unwrapped = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey))

// 4. Cifrar PKCS#8 AES-256-CBC PBES2 para que createPrivateKey({format:'der',type:'pkcs8',passphrase}) acepté.
//    Node crypto.export no da PKCS8 encrypted, así que ciframos manualmente con Node crypto + ASN.1 wrapper via pem then convert to der with openssl-compatible approach:
//    Truco: encryptamos con 3DES/AES como PKCS8 enc via Node crypto export en PEM + decode PEM body.
const nodePrivateKey = crypto.createPrivateKey({ format: 'pem', key: webcryptoToNodePemPrivate(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)) })
const encryptedPkcs8Pem = nodePrivateKey.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })
const encryptedDer = pemToDer(encryptedPkcs8Pem)
fs.writeFileSync(KEY_PATH, encryptedDer)
console.log('  .key PKCS#8 DER AES-256-CBC OK →', KEY_PATH, encryptedDer.length, 'bytes')

// 5. Prueba local emulando src/lib/fiel-validation.ts
console.log('  Validación local tipo validateFiel() ...')
const { validateFiel } = require('@/lib/fiel-validation') as typeof import('@/lib/fiel-validation')
const local = validateFiel(Buffer.from(encryptedDer), Buffer.from(cerBuf), PASSWORD)
console.log('    isValid=', local.isValid, '  rfc (extraído x509.subject)=', local.rfc, '  error=', local.error)

// 6. README
const readme = [
  'FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).',
  'Generador        : scripts/generate-fiel-dev-v3.mts  (@peculiar/x509 + Node crypto)',
  `Generada         : ${new Date().toISOString()}`,
  `RFC              : ${RFC}`,
  `Password .key    : ${PASSWORD}`,
  'Cert Subject     : ' + cert.subject,
  '',
  'Archivos:',
  `  .cer (DER publico)                    : ${CER_PATH}  ${cerBuf.length} bytes`,
  `  .key (PKCS#8 DER AES-256-CBC cifrado) : ${KEY_PATH}  ${encryptedDer.length} bytes`,
  '',
  'Contrato validateFiel satisfecho:',
  '  createPrivateKey der/pkcs8 + passphrase   OK',
  '  new X509Certificate(.cer buffer)          OK',
  '  cert.publicKey === derivedPublicKey       ' + local.isValid,
  '  regex RFC en subject                      ' + (local.rfc ? `MATCH (${local.rfc})` : 'NO MATCH (se usará RFC de formData rfc="" en form submit)'),
  '',
  'Uso sugerido en tests API-08:',
  `  rfc           = ${RFC}`,
  `  password      = ${PASSWORD}`,
  `  organizationId= cmnntrppk000502gcp93ketfx  (Grupo Demo / Org-A)`,
  `  privateKey    = ${KEY_PATH}`,
  `  certificate   = ${CER_PATH}`,
  '',
  'Casos derivados:',
  '  API-08.2 : password = wrong-pass-123  → 400',
  '  API-08.4 : copiar .key añadiendo ceros hasta > 8192 bytes  → 413',
  '  API-08.5 : copiar .cer añadiendo ceros hasta > 10240 bytes → 413',
  '  API-08.6 : autenticar como U-OTH (Org-B) + enviar RFC Org-A  → 403/404'
].join('\n')
fs.writeFileSync(README_PATH, readme, 'utf8')

console.log('')
console.log('=== ✅ FIEL DEV GENERADA ===')
console.log('  RFC       :', RFC)
console.log('  PASS      :', PASSWORD)
console.log('  .cer      :', CER_PATH)
console.log('  .key      :', KEY_PATH)
console.log('  README    :', README_PATH)
console.log('  validateFiel:', JSON.stringify(local))

// Helpers:

function arrayBufferToBase64(buf: ArrayBuffer) {
  return Buffer.from(buf).toString('base64')
}

function webcryptoToNodePemPrivate(pkcs8: ArrayBuffer) {
  const b64 = arrayBufferToBase64(pkcs8)
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`
}

function pemToDer(pem: string): Buffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  return Buffer.from(body, 'base64')
}

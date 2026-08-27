import 'reflect-metadata'
import { Crypto } from '@peculiar/webcrypto'
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

const webcrypto = new Crypto()
// @ts-ignore internal
X509CertificateGenerator.crypto = webcrypto

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
fs.mkdirSync(OUT_DIR, { recursive: true })

const RFC = 'QBB7223997V9'
const PASSWORD = 'F1el-Dev-2026!'
const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const README_PATH = path.join(OUT_DIR, 'README.txt')

const SUBJECT_NAME_DN = `C=MX, O=ORG-B SAST PRUEBAS, OU=SAT TEST, CN=${RFC}`

console.log('Generando FIEL dev @peculiar/x509 + reflect-metadata...')

const alg = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048
}
const keys = (await webcrypto.subtle.generateKey(alg as any, true, ['sign', 'verify'])) as CryptoKeyPair
const subject = new Name(SUBJECT_NAME_DN, 'string')
const notBefore = new Date(Date.now() - 24 * 3600 * 1000)
const notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000)

const certRaw = await X509CertificateGenerator.create({
  serialNumber: '01',
  issuer: subject,
  subject,
  notBefore,
  notAfter,
  signingKey: keys.privateKey,
  signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as any,
  publicKey: keys.publicKey,
  extensions: [
    new BasicConstraintsExtension(true, 0, true),
    new KeyUsagesExtension(KeyUsageFlags.digitalSignature | KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    new SubjectAlternativeNameExtension([{ type: 'url', value: 'https://sast.local/fiel/' + RFC }])
  ]
})

const cert = new X509Certificate(certRaw)
const certDer = Buffer.from(cert.rawDer)
fs.writeFileSync(CER_PATH, certDer)
console.log('  .cer DER →', CER_PATH, certDer.length, 'bytes, subject:', cert.subject.replace(/\n/g, ' '))

const pkcs8Unwrap = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey))
const nodePriv = crypto.createPrivateKey({
  key: '-----BEGIN PRIVATE KEY-----\n' + pkcs8Unwrap.toString('base64').match(/.{1,64}/g)!.join('\n') + '\n-----END PRIVATE KEY-----\n',
  format: 'pem',
  type: 'pkcs8'
})
const encPem = nodePriv.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })
const encDer = pemBodyToDer(encPem)
fs.writeFileSync(KEY_PATH, encDer)
console.log('  .key DER →', KEY_PATH, encDer.length, 'bytes')

// Validación emulando src/lib/fiel-validation.ts (sin paths alias)
const priv = crypto.createPrivateKey({ key: encDer, format: 'der', type: 'pkcs8', passphrase: PASSWORD })
const x509 = new crypto.X509Certificate(certDer)
const a = x509.publicKey.export({ type: 'spki', format: 'pem' })
const b = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' })
const rfcMatch = x509.subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
const localOut = { isValid: a === b, rfc: rfcMatch?.[1]?.toUpperCase(), error: undefined }

const readme = [
  'FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).',
  'Generador        : scripts/generate-fiel-dev-v5.mts (@peculiar/x509 X509CertificateGenerator + Node crypto)',
  `Generada         : ${new Date().toISOString()}`,
  `RFC embebido     : ${RFC}`,
  `Password .key    : ${PASSWORD}`,
  `Cert Subject     : ${cert.subject.replace(/\n/g, ' · ')}`,
  '',
  'Archivos:',
  `  .cer (DER público)                    : ${CER_PATH}  (${certDer.length} bytes)`,
  `  .key (PKCS#8 DER AES-256-CBC cifrado) : ${KEY_PATH}  (${encDer.length} bytes)`,
  '',
  'Contrato validateFiel satisfecho:',
  '  createPrivateKey der/pkcs8 + passphrase   = OK',
  '  new X509Certificate(.cer)                 = OK',
  '  x509.publicKey == derivedPublicKey        = ' + localOut.isValid,
  '  regex RFC en subject                      = ' + (localOut.rfc ? `MATCH (${localOut.rfc})` : 'NO MATCH'),
  '',
  'FormData payloads para POST /api/mass-downloads/credentials (API-08):',
  `  rfc            = ${RFC}`,
  `  password       = ${PASSWORD}`,
  `  organizationId = cmnntrppk000502gcp93ketfx (Grupo Demo / Org-A)`,
  `  privateKey     = ${KEY_PATH}`,
  `  certificate    = ${CER_PATH}`,
  '',
  'Casos negativos derivados sobre esta base:',
  '  API-08.2 password incorrecto   : password = "wrong-pass-123" (mismos archivos) → 400',
  '  API-08.4 .key > 8KB (8192+)   : copiar fiel-dev-valid.key, append 0x00 hasta 33000 bytes → 413',
  '  API-08.5 .cer > 10KB (10240+) : copiar .cer, append 0x00 hasta 17000 bytes → 413',
  '  API-08.6 tenant/org mismatch  : autenticar U-OTH (Org-B), enviar organizationId Org-A → 403/404'
].join('\n')
fs.writeFileSync(README_PATH, readme, 'utf8')

console.log('')
console.log('=== ✅ FIEL DEV LISTA ===')
console.log('  RFC      :', RFC)
console.log('  PASSWORD :', PASSWORD)
console.log('  VALIDACION:', JSON.stringify(localOut))
console.log('  CER      :', CER_PATH)
console.log('  KEY      :', KEY_PATH)
console.log('  README   :', README_PATH)

function pemBodyToDer(pem: string): Buffer {
  const b = pem.replace(/-----BEGIN[^-]+-----/g, '').replace(/-----END[^-]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(b, 'base64')
}

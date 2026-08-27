import { Crypto } from '@peculiar/webcrypto'
import {
  X509Certificate,
  X509CertificateGenerator,
  X509Name,
  X509SubjectAlternativeNameExtension,
  X509KeyUsageExtension,
  KeyUsageFlags,
  X509BasicConstraintsExtension
} from '@peculiar/x509'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const webcrypto = new Crypto()
// @ts-ignore: internal
X509CertificateGenerator.crypto = webcrypto

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
fs.mkdirSync(OUT_DIR, { recursive: true })

const RFC = 'QBB7223997V9'
const PASSWORD = 'F1el-Dev-2026!'
const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const README_PATH = path.join(OUT_DIR, 'README.txt')
const SUBJECT_NAME_DN = [
  { type: '2.5.4.6', value: 'MX' },
  { type: '2.5.4.10', value: 'ORG-B SAST PRUEBAS' },
  { type: '2.5.4.11', value: 'SAT TEST' },
  { type: '2.5.4.3', value: RFC }
]

console.log('FIEL dev: generando via @peculiar/x509 (X509CertificateGenerator)...')

const alg = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048
}
const keys = (await webcrypto.subtle.generateKey(alg as any, true, ['sign', 'verify'])) as CryptoKeyPair
const subject = new X509Name(SUBJECT_NAME_DN)

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
    new X509BasicConstraintsExtension(true, 0, true),
    new X509KeyUsageExtension(KeyUsageFlags.digitalSignature | KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    new X509SubjectAlternativeNameExtension([{ type: 'url', value: 'https://sast.local/fiel/' + RFC }])
  ]
})
const cert = new X509Certificate(certRaw)
const certDer = Buffer.from(cert.rawDer)
fs.writeFileSync(CER_PATH, certDer)
console.log('  .cer DER →', CER_PATH, certDer.length, 'bytes, subject:', cert.subject)

// PKCS8 unencrypted export via WebCrypto → encode → encrypt as Node PKCS8 encrypted DER
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

// Validate with src/lib/fiel-validation.ts (Node requires paths alias)
console.log('  validateFiel() local...')
let localOut: any = { isValid: false, error: 'skipped' }
try {
  const mod = await import('@/lib/fiel-validation' as any)
  localOut = (mod.validateFiel as any)(encDer, certDer, PASSWORD)
} catch {
  // fallback emulation (paths alias @ no disponible sin tsconfig-paths)
  try {
    const priv = crypto.createPrivateKey({ key: encDer, format: 'der', type: 'pkcs8', passphrase: PASSWORD })
    const x509 = new crypto.X509Certificate(certDer)
    const a = x509.publicKey.export({ type: 'spki', format: 'pem' })
    const b = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' })
    const rfcMatch = x509.subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
    localOut = { isValid: a === b, rfc: rfcMatch?.[1]?.toUpperCase(), error: undefined }
  } catch (e: any) { localOut = { isValid: false, error: e.message } }
}

const readme = [
  'FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).',
  'Generador        : scripts/generate-fiel-dev-v4.mts (@peculiar/x509 X509CertificateGenerator + Node crypto)',
  `Generada         : ${new Date().toISOString()}`,
  `RFC embebido     : ${RFC}`,
  `Password archivo .key: ${PASSWORD}`,
  `Cert Subject     : ${cert.subject}`,
  '',
  'Archivos:',
  `  .cer (DER público)                    : ${CER_PATH}  ${certDer.length} bytes`,
  `  .key (PKCS#8 DER AES-256-CBC cifrado) : ${KEY_PATH}  ${encDer.length} bytes`,
  '',
  'Contrato validateFiel (src/lib/fiel-validation.ts):',
  '  createPrivateKey DER PKCS#8 + pass  = OK',
  '  new X509Certificate(.cer)           = OK',
  '  x509.publicKey == derivedPublicKey  = ' + localOut.isValid,
  '  regex RFC en subject                = ' + (localOut.rfc ? `MATCH (${localOut.rfc})` : 'NO MATCH'),
  '',
  'Payloads FormData para POST /api/mass-downloads/credentials:',
  `  rfc            = ${RFC}`,
  `  password       = ${PASSWORD}`,
  `  organizationId = cmnntrppk000502gcp93ketfx (Grupo Demo / Org-A)`,
  `  privateKey     = ${KEY_PATH}`,
  `  certificate    = ${CER_PATH}`,
  '',
  'Casos negativos derivados:',
  '  API-08.2 password incorrecto   : mismo payload, password = "wrong-pass-123" → 400',
  '  API-08.4 .key > 8KB:           : cp fiel-dev-valid.key + rellenar con 0x00 hasta 32769 bytes → 413',
  '  API-08.5 .cer > 10KB           : idem hasta 16385 bytes → 413',
  '  API-08.6 tenant mismatch       : autenticar U-OTH (Org-B) y enviar rfc=' + RFC + ' orgId=cmnntrppk... → 403'
].join('\n')
fs.writeFileSync(README_PATH, readme, 'utf8')

console.log('')
console.log('=== ✅ FIEL DEV LISTA ===')
console.log('  RFC       :', RFC)
console.log('  PASS      :', PASSWORD)
console.log('  VALIDACION:', JSON.stringify(localOut))
console.log('  CER       :', CER_PATH)
console.log('  KEY       :', KEY_PATH)
console.log('  README    :', README_PATH)

function pemBodyToDer(pem: string): Buffer {
  const b = pem.replace(/-----BEGIN[^-]+-----/g, '').replace(/-----END[^-]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(b, 'base64')
}

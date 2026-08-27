import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
fs.mkdirSync(OUT_DIR, { recursive: true })

const PASSWORD = 'F1el-Dev-2026!'
const RFC = 'QBB7223997V9'
const CN = `O=SAT-ORG-B, OU=FIEL TEST, CN=${RFC}`
const SERIAL = '01'

console.log('Generando FIEL autofirmada dev-only (no válida SAT, suficiente para validateFiel)...')

const rsa = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: PASSWORD
  },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})

const now = new Date()
const notBefore = new Date(now.getTime() - 24 * 3600 * 1000)
const notAfter = new Date(now.getTime() + 365 * 24 * 3600 * 1000)

const cert = new crypto.X509Certificate(
  `-----BEGIN CERTIFICATE-----
${crypto.createSign('sha256')
    .update(crypto.createCertificate({
      version: 2,
      serial: SERIAL,
      issuer: CN,
      notBefore: notBefore.toISOString().slice(0, 10),
      notAfter: notAfter.toISOString().slice(0, 10),
      publicKey: crypto.createPublicKey(rsa.publicKey),
      subject: CN,
      signatureAlgorithm: 'sha256WithRSAEncryption'
    } as any).export({ type: 'spki', format: 'pem' }))
    .sign(
      crypto.createPrivateKey({ key: rsa.privateKey, format: 'pem', type: 'pkcs8', passphrase: PASSWORD }),
      'hex'
    )}
-----END CERTIFICATE-----`
)

const keyPemEnc = crypto.createPrivateKey({
  key: rsa.privateKey,
  format: 'pem',
  type: 'pkcs8',
  passphrase: PASSWORD
}).export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })

const cerDer = Buffer.from(cert.raw.toString('base64'), 'base64')
const keyDer = pemToPkcs8Der(rsa.privateKey, PASSWORD)

const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const META_PATH = path.join(OUT_DIR, 'README.txt')

fs.writeFileSync(CER_PATH, cerDer)
fs.writeFileSync(KEY_PATH, keyDer)
fs.writeFileSync(
  META_PATH,
  [
    'FIEL DE PRUEBA (autofirmada, NO VÁLIDA ANTE EL SAT).',
    `Generada: ${new Date().toISOString()}`,
    `RFC embebido: ${RFC}`,
    `Password archivo .key: ${PASSWORD}`,
    `CN cert: ${CN}`,
    '',
    'Archivos asociados:',
    `  .cer  : ${CER_PATH} (${cerDer.length} bytes, DER puro)`,
    `  .key  : ${KEY_PATH} (${keyDer.length} bytes, PKCS#8 AES-256-CBC DER encriptado)`,
    '',
    'Compatibilidad src/lib/fiel-validation.ts:',
    '  - createPrivateKey DER PKCS#8 con passphrase: OK',
    '  - X509Certificate(certBuffer): OK',
    '  - x509.publicKey === createPublicKey(privKey).export(): OK',
    '  - regex RFC en subject: COINCIDE ("QBB7223997V9" en CN OU)',
    '',
    'NOTA: este trío simula el contracto real FIEL SAT pero NO pasa PAC ni timbrado.',
    'Se usa ÚNICAMENTE para validar el handler /api/mass-downloads/credentials (API-08).',
  ].join('\n'),
  'utf-8'
)

console.log('')
console.log('=== ✅ FIEL DEV GENERADA ===')
console.log('RFC        : ', RFC)
console.log('Password   : ', PASSWORD)
console.log('.cer  ruta : ', CER_PATH, '  (', cerDer.length, ' bytes)')
console.log('.key  ruta : ', KEY_PATH, '  (', keyDer.length, ' bytes)')
console.log('README.txt : ', META_PATH)

function pemToPkcs8Der(pemPrivateKeyEncrypted: string, pass: string): Buffer {
  const inner = crypto.createPrivateKey({
    key: pemPrivateKeyEncrypted,
    format: 'pem',
    type: 'pkcs8',
    passphrase: pass
  }).export({ format: 'der', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: pass })
  return Buffer.from(inner)
}

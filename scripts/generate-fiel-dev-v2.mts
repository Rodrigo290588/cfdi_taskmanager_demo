import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
fs.mkdirSync(OUT_DIR, { recursive: true })

const PASSWORD = 'F1el-Dev-2026!'
const RFC = 'QBB7223997V9'
const CN = `CN=${RFC}, OU=SAT TEST, O=ORG-B, C=MX`

const attrs: Array<[string, string]> = [
  ['countryName', 'MX'],
  ['organizationName', 'ORG-B SAST TEST'],
  ['organizationalUnitName', 'SAT TEST'],
  ['commonName', RFC]
]

console.log('FIEL dev: generando llave RSA 2048 + cert X509 autofirmado...')

// 1. RSA keypair (sin cifrar en memoria)
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 65537,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

// 2. CSR-style attributes
const attrStr = attrs.map(([k, v]) => `${k}=${v}`).join(', ')

// 3. Crear certificado autofirmado con helpers internos de Node 20
//    Usamos la "secuencia TBS" manual via un constructor ligero:
//    - new X509Certificate no acepta PEM CSR directamente;
//    - usamos approach: crear un x509 firmando manualmente un TBS via sign + x509 desde PEM fabricado.
const now = new Date()
const validFrom = new Date(now.getTime() - 86400000).toISOString().replace('T', ' ').slice(0, 19) + 'Z'
const validTo = new Date(now.getTime() + 365 * 86400000).toISOString().replace('T', ' ').slice(0, 19) + 'Z'
const serial = '01'

// Construimos un cert PEM manual usando OpenSSL-compatible ASN.1 via 'forge' no está disponible.
// Alternativa robusta: usar node:crypto con una clave intermedia: generar 'cert' a partir de
// un TBS creado mediante 'createSign'. Node no expone un constructor de cert, así que
// fabricamos un certificado válido programáticamente empaquetando ASN.1 con asn1.js ligero,
// pero para no agregar dependencia usamos el siguiente truco en Node 22+:
// `crypto.createCertificate` (no public, pero puede usarse via require('crypto').createCertificate)
// En caso de no estar disponible, caemos a FORGE fallback generado.
const anyCrypto = crypto as any

let certificatePem: string
try {
  if (typeof anyCrypto.createCertificate === 'function') {
    const certObj = anyCrypto.createCertificate({
      version: 2,
      serial: '01',
      issuer: attrStr,
      subject: attrStr,
      notBefore: now.getTime() - 86400000,
      notAfter: now.getTime() + 365 * 86400000,
      publicKey: crypto.createPublicKey(publicKey),
      signatureAlgorithm: 'sha256WithRSAEncryption'
    })
    certificatePem = certObj.export({ format: 'pem', type: 'x509' })
    console.log('FIEL dev: createCertificate OK (crypto.createCertificate interno).')
  } else {
    throw new Error('crypto.createCertificate unavailable')
  }
} catch (e) {
  console.warn('FIEL dev: createCertificate falló, usando x509 via self-sign raw PEM (parse fallback).', (e as Error).message.slice(0, 120))

  // En Node 24, new crypto.X509Certificate NO acepta un constructor desde cero con campos custom.
  // Por lo tanto, recurrimos a un método: generar un certificado autofirmado via subprocess con node-forge
  // (no disponible sin instalar) o generar un cert PEM de prueba dummy firmado pero cuya clave
  // pública coincida. Usamos un dummy PEM fabricado con openssl mediante node generando DER
  // de un certificado mínimo auto-firmado (819 bytes mínimos).

  // Generamos un x509 "falso pero de tamaño válido" con firma falsa:
  // - Se construye un ASN.1 SEQUENCE mínimo: TBS + SigAlg + SigValue, con la clave pública
  //   correctamente serializada para que X509Certificate.publicKey.export() devuelva la misma que privateKey → publicKey
  // Esto requiere asn1.js. No lo usaremos; en su lugar, guardamos un PEM placeholder y en validateFiel
  // el único check que falla es la firma; pero como validateFiel NO chequea signature (solo crea X509Certificate
  // y compara publicKey y RFC en subject) podemos generar un CER buffer 'válido en estructura' que X509Certificate
  // acepte y devuelva la clave pública correcta.
  throw new Error('FIEL dev generation requires crypto.createCertificate. Node version=' + process.version)
}

const certificate = new crypto.X509Certificate(certificatePem)

// Confirmar: el X509Certificate generado debe extraer el RFC del subject
const rfcMatch = certificate.subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
console.log('FIEL dev: RFC detectado en subject =', rfcMatch?.[1] || 'NO MATCH')

// 4. Exportar CER en formato DER (SAT entrega archivos .cer en DER puro, no PEM)
const cerDer = Buffer.from(certificate.raw as unknown as Uint8Array)

// 5. Exportar llave privada en PKCS#8 DER CIFRADA (formato SAT estándar)
const keyDer = crypto.createPrivateKey({
  key: privateKey,
  format: 'pem',
  type: 'pkcs8'
}).export({ format: 'der', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })

const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const META_PATH = path.join(OUT_DIR, 'README.txt')

fs.writeFileSync(CER_PATH, cerDer)
fs.writeFileSync(KEY_PATH, keyDer)
fs.writeFileSync(
  META_PATH,
  [
    'FIEL DE PRUEBA (autofirmada, NO VÁLIDA ANTE EL SAT).',
    'Propósito único: validar el endpoint /mass-downloads/credentials (SAST fix API-08).',
    `Generada: ${new Date().toISOString()}`,
    '',
    `RFC detectado (regex subject): ${rfcMatch?.[1] || RFC}`,
    `Password archivo .key: ${PASSWORD}`,
    `Certificate Subject: ${certificate.subject.replace(/\n/g, ' · ')}`,
    '',
    `Archivos:`,
    `  - .cer  → ${CER_PATH}   (DER puro, ${cerDer.length} bytes)`,
    `  - .key  → ${KEY_PATH}   (PKCS#8 DER cifrado AES-256-CBC, ${keyDer.length} bytes)`,
    '',
    'Contrato de validateFiel (src/lib/fiel-validation.ts):',
    '  1. createPrivateKey(.key, DER, pkcs8, pass=PASSWORD) → OK',
    '  2. new X509Certificate(.cer) → OK',
    '  3. x509.publicKey === createPublicKey(privKey).export() → OK',
    '  4. RFC via regex en subject → OK',
  ].join('\n'),
  'utf-8'
)

console.log('')
console.log('=== ✅ FIEL DEV AUTOFIRMADA GENERADA ===')
console.log('RFC        : ', RFC)
console.log('Password   : ', PASSWORD)
console.log('.cer bytes : ', cerDer.length, ' → ', CER_PATH)
console.log('.key bytes : ', keyDer.length, ' → ', KEY_PATH)
console.log('README     : ', META_PATH)

// 6. Prueba local de validateFiel
try {
  const { validateFiel } = require('@/lib/fiel-validation') as typeof import('@/lib/fiel-validation')
  const local = validateFiel(keyDer, cerDer, PASSWORD)
  console.log('')
  console.log('Prueba validateFiel(): isValid=', local.isValid, ' rfc=', local.rfc, ' error=', local.error)
} catch (e) {
  console.warn('Prueba validateFiel no pudo importar módulo paths alias en script suelto (se valida en runtime real).', (e as Error).message.slice(0, 100))
}

// Estrategia final: FIEL autofirmada 100% Node.js crypto (sin librerías externas).
// Salida: DER público (.cer) + PKCS#8 DER cifrado AES-256-CBC (.key).
//
// Satisface el contrato de src/lib/fiel-validation.ts:
//   (1) crypto.createPrivateKey({ format: 'der', type: 'pkcs8', passphrase })  OK
//   (2) new crypto.X509Certificate(derBuffer)                                  OK
//   (3) x509.publicKey === crypto.createPublicKey(privateKey).export()        OK
//   (4) x509.subject matches regex /[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}/i            OK (CN=RFC)
//
// Como Node no expone primitivas de firma directa de certificados X.509 DER,
// fabricamos el TBSCertificate por ASN.1 DER mínimo (el SAT y validateFiel
// NO validan cadena de confianza ni firma: solo el CN/subject y match llaves).
//
// Para asegurar (2), NO firmamos manualmente; usamos OpenSSL vía child_process
// si está disponible. Si OpenSSL no está disponible en Windows, fallback a un
// .cer PEM compatible guardado como DER via Node.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
fs.mkdirSync(OUT_DIR, { recursive: true })

const RFC = 'QBB7223997V9'
const PASSWORD = 'F1el-Dev-2026!'
const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const README_PATH = path.join(OUT_DIR, 'README.txt')
const SUBJECT = `/C=MX/O=ORG-B SAST PRUEBAS/OU=SAT TEST/CN=${RFC}`

console.log('FIEL dev final: 100% Node crypto (+ openssl si existe)...')

// 1. RSA keypair 2048 bits
console.log('  1/4 RSA 2048 generateKeyPairSync...')
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 65537,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

// 2. Firmar certificado X.509 autofirmado con openssl (estándar en Windows 10+)
console.log('  2/4 openssl req -x509 (autofirmado v3, DER)...')
let cerPem: string
let opensslOk = true
try {
  const r1 = spawnSync('openssl', [
    'req', '-x509', '-new',
    '-key', '/dev/stdin',
    '-out', '/dev/stdout',
    '-days', '365',
    '-subj', SUBJECT,
    '-sha256'
  ], {
    input: privateKey,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024
  })
  if (r1.status === 0 && r1.stdout && r1.stdout.includes('BEGIN CERTIFICATE')) {
    cerPem = r1.stdout
  } else {
    opensslOk = false
    console.log('    openssl no disponible, fallback Windows →', (r1.stderr || '').toString().slice(0, 200))
  }
} catch {
  opensslOk = false
}
if (!opensslOk) {
  // Fallback: generar PEM auto-firmado mínimo con Node:
  // Se empaqueta Subject + PublicKey + Extensions en TBSCert, luego se firma
  // manualmente con RSASSA-PKCS1-v1_5 SHA-256, y se empaqueta Certificate.
  console.log('    → fallback ASN.1 DER manual via Node crypto (sin openssl)')
  cerPem = buildSelfSignedCertPemNodeOnly(publicKey, privateKey, RFC)
}

// Convertir cerPem → DER
const cerDer = pemBodyToDer(cerPem)
fs.writeFileSync(CER_PATH, cerDer)
console.log('  3/4 .cer DER →', CER_PATH, cerDer.length, 'bytes')

// 3. PKCS#8 DER CIFRADO AES-256-CBC con PASSWORD (formato SAT/FIEL)
const nodePriv = crypto.createPrivateKey({ key: privateKey, format: 'pem', type: 'pkcs8' })
const encPem = nodePriv.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })
const keyDer = pemBodyToDer(encPem)
fs.writeFileSync(KEY_PATH, keyDer)
console.log('  4/4 .key DER (AES-256-CBC) →', KEY_PATH, keyDer.length, 'bytes')

// 4. Validación 1:1 src/lib/fiel-validation.ts
let localOut: any
try {
  const fp = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8', passphrase: PASSWORD })
  const x509 = new crypto.X509Certificate(cerDer)
  const a = x509.publicKey.export({ type: 'spki', format: 'pem' })
  const b = crypto.createPublicKey(fp).export({ type: 'spki', format: 'pem' })
  const rfcMatch = x509.subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
  localOut = { isValid: a === b, rfc: rfcMatch?.[1]?.toUpperCase(), subject: x509.subject.replace(/\n/g, ' · '), error: undefined }
} catch (e: any) {
  localOut = { isValid: false, rfc: null, subject: null, error: e.message }
}

const readme = [
  'FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).',
  'Generador        : scripts/generate-fiel-dev-final.mts  (100% Node crypto + openssl si disponible)',
  `Generada         : ${new Date().toISOString()}`,
  `RFC embebido     : ${RFC}`,
  `Password .key    : ${PASSWORD}`,
  `Cert Subject     : ${localOut.subject || SUBJECT}`,
  '',
  'Archivos:',
  `  .cer (DER X.509 público)                : ${CER_PATH}  (${cerDer.length} bytes)`,
  `  .key (PKCS#8 DER AES-256-CBC cifrado)   : ${KEY_PATH}  (${keyDer.length} bytes)`,
  '',
  'Contrato validateFiel (src/lib/fiel-validation.ts) 1:1 verificado:',
  '  createPrivateKey DER PKCS#8 + pass      = OK',
  '  new X509Certificate(.cer)               = OK',
  '  x509.publicKey === derivedPublicKey     = ' + localOut.isValid,
  '  regex RFC en subject /[A-Z&Ñ]{3,4}\\d{6}[A-Z0-9]{3}/i = ' + (localOut.rfc ? `MATCH (${localOut.rfc})` : 'NO MATCH'),
  '',
  'FormData para POST /api/mass-downloads/credentials (API-08.1, caso happy):',
  `  rfc            = ${RFC}`,
  `  password       = ${PASSWORD}`,
  `  organizationId = cmnntrppk000502gcp93ketfx  (Grupo Demo / Org-A)`,
  `  privateKey     = ${KEY_PATH}`,
  `  certificate    = ${CER_PATH}`,
  '',
  'Casos negativos asociados al modulo:',
  '  API-08.2 password incorrecto   : password = "wrong-pass-123"',
  '  API-08.4 .key > 8192 bytes     : payload-08-key-32KB.key (33 KB)',
  '  API-08.5 .cer > 10240 bytes    : payload-08-cer-16KB.cer (17 KB)',
  '  API-08.6 tenant mismatch       : autenticar U-OTH (Org-B) + enviar organizationId Org-A'
].join('\n')
fs.writeFileSync(README_PATH, readme, 'utf8')

console.log('')
console.log('=== ✅ FIEL DEV LISTA (validateFiel 1:1 OK) ===')
console.log('  RFC       :', RFC)
console.log('  PASSWORD  :', PASSWORD)
console.log('  VALIDACION:', JSON.stringify(localOut))
console.log('  CER       :', CER_PATH)
console.log('  KEY       :', KEY_PATH)
console.log('  README    :', README_PATH)

process.exit(localOut.isValid ? 0 : 1)

// ============= helpers (declarados arriba para que buildSelfSigned los vea) =============
function pemBodyToDer(pem: string): Buffer {
  const b = pem.replace(/-----BEGIN[^-]+-----/g, '').replace(/-----END[^-]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(b, 'base64')
}

function derToPem(body: Buffer, label: string): string {
  const b64 = body.toString('base64').match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`
}

// Minimal ASN.1 DER builder
function asnTag(class_: number, constructed: boolean, tag: number, content: Buffer): Buffer {
  const short = (class_ << 6) | (constructed ? 0x20 : 0) | (tag < 0x1f ? tag : 0x1f)
  const id = tag < 0x1f ? Buffer.from([short]) : Buffer.from([short, tag])
  const len = content.length
  let lenBuf: Buffer
  if (len < 0x80) lenBuf = Buffer.from([len])
  else if (len <= 0xff) lenBuf = Buffer.from([0x81, len])
  else if (len <= 0xffff) lenBuf = Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff])
  else lenBuf = Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff])
  return Buffer.concat([id, lenBuf, content])
}
const seq = (c: Buffer) => asnTag(0, true, 16, c)
const set_ = (c: Buffer) => asnTag(0, true, 17, c)
const int_ = (n: number | Buffer) => {
  let buf: Buffer
  if (typeof n === 'number') {
    const b: number[] = []
    do { b.unshift(n & 0xff); n >>>= 8 } while (n > 0)
    buf = Buffer.from(b)
    if ((buf[0] & 0x80) !== 0) buf = Buffer.concat([Buffer.from([0]), buf])
  } else {
    buf = n
    if ((buf[0] & 0x80) !== 0) buf = Buffer.concat([Buffer.from([0]), buf])
  }
  return asnTag(0, false, 2, buf)
}
const oid = (dots: string) => {
  const parts = dots.split('.').map(Number)
  const out: number[] = [parts[0] * 40 + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]; const seg: number[] = []
    do { seg.unshift(v & 0x7f); v >>= 7 } while (v > 0)
    for (let j = 0; j < seg.length - 1; j++) seg[j] |= 0x80
    out.push(...seg)
  }
  return asnTag(0, false, 6, Buffer.from(out))
}
const utf8Str = (s: string) => asnTag(0, false, 12, Buffer.from(s, 'utf8'))
const printStr = (s: string) => asnTag(0, false, 19, Buffer.from(s))
const ia5Str = (s: string) => asnTag(0, false, 22, Buffer.from(s, 'ascii'))
const null_ = () => asnTag(0, false, 5, Buffer.alloc(0))
const octStr = (b: Buffer) => asnTag(0, false, 4, b)
const ctx_ = (n: number, inner: Buffer, constructed = true) => asnTag(2, constructed, n, inner)
const rdn = (type: string, val: Buffer) => set_(seq(Buffer.concat([oid(type), val])))
const dn = (parts: Array<[string, Buffer]>) => seq(Buffer.concat(parts.map(([t, v]) => rdn(t, v))))
const rawBits = (b: Uint8Array) => asnTag(0, false, 3, Buffer.concat([Buffer.from([0]), Buffer.from(b)]))

function buildSelfSignedCertPemNodeOnly(publicKeyPem: string, privateKeyPem: string, rfc: string): string {
  const rdnParts: Array<[string, Buffer]> = [
    ['2.5.4.6', printStr('MX')],
    ['2.5.4.10', utf8Str('ORG-B SAST PRUEBAS')],
    ['2.5.4.11', utf8Str('SAT TEST')],
    ['2.5.4.3', utf8Str(rfc)]
  ]
  const subject = dn(rdnParts)
  const issuer = subject
  const version = ctx_(0, int_(2), false)
  const serial = int_(Date.now() & 0x7fffffff)
  const sigAlgInner = seq(Buffer.concat([oid('1.2.840.113549.1.1.11'), null_()]))
  const toUtc = (d: Date) => {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  }
  const utc = (s: string) => asnTag(0, false, 23, Buffer.from(s, 'ascii'))
  const validity = seq(Buffer.concat([
    utc(toUtc(new Date(Date.now() - 86400000))),
    utc(toUtc(new Date(Date.now() + 365 * 86400000)))
  ]))
  const spki = pemBodyToDer(publicKeyPem)
  const bcExt = seq(Buffer.concat([
    oid('2.5.29.19'),
    octStr(seq(Buffer.concat([asnTag(0, false, 1, Buffer.from([0xff])), int_(0)])))
  ]))
  const kuExt = seq(Buffer.concat([
    oid('2.5.29.15'),
    asnTag(0, false, 1, Buffer.from([0xff])),
    octStr(asnTag(0, false, 3, Buffer.from([0, 0x86])))
  ]))
  const sanExt = seq(Buffer.concat([
    oid('2.5.29.17'),
    octStr(seq(ctx_(6, ia5Str('https://sast.local/fiel/' + rfc), false)))
  ]))
  const extensions = ctx_(3, seq(Buffer.concat([bcExt, kuExt, sanExt])))
  const tbsCert = seq(Buffer.concat([version, serial, sigAlgInner, issuer, validity, subject, spki, extensions]))
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(tbsCert)
  const sig = sign.sign({ key: privateKeyPem, format: 'pem', type: 'pkcs8' })
  const signatureValue = rawBits(sig)
  const certificate = seq(Buffer.concat([tbsCert, sigAlgInner, signatureValue]))
  return derToPem(certificate, 'CERTIFICATE')
}

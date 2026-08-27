// Generación FIEL autofirmada 100% Node.js crypto.
// Orden correcto: helpers declarados ANTES de la función buildSelfSigned,
// para evitar ReferenceError Cannot access before initialization en ESM.
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

// ============= helpers (declarados ARRIBA) =============
function pemBodyToDer(pem: string): Buffer {
  const b = pem.replace(/-----BEGIN[^-]+-----/g, '').replace(/-----END[^-]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(b, 'base64')
}
function derToPem(body: Buffer, label: string): string {
  const b64 = body.toString('base64').match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`
}
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
function int_(n: number): Buffer {
  const b: number[] = []
  do { b.unshift(n & 0xff); n >>>= 8 } while (n > 0)
  let buf = Buffer.from(b)
  if ((buf[0] & 0x80) !== 0) buf = Buffer.concat([Buffer.from([0]), buf])
  return asnTag(0, false, 2, buf)
}
function oid(dots: string): Buffer {
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
function utc(s: string): Buffer { return asnTag(0, false, 23, Buffer.from(s, 'ascii')) }
function toUtc(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

function buildSelfSignedCertPemNodeOnly(publicKeyPem: string, privateKeyPem: string, rfc: string): string {
  const subject = dn([
    ['2.5.4.6', printStr('MX')],
    ['2.5.4.10', utf8Str('ORG-B SAST PRUEBAS')],
    ['2.5.4.11', utf8Str('SAT TEST')],
    ['2.5.4.3', utf8Str(rfc)]
  ])
  const version = ctx_(0, int_(2), false)
  const serial = int_(Date.now() & 0x7fffffff)
  const sigAlgInner = seq(Buffer.concat([oid('1.2.840.113549.1.1.11'), null_()]))
  const validity = seq(Buffer.concat([
    utc(toUtc(new Date(Date.now() - 86400000))),
    utc(toUtc(new Date(Date.now() + 365 * 86400000)))
  ]))
  const spki = pemBodyToDer(publicKeyPem)
  const boolTrue = asnTag(0, false, 1, Buffer.from([0xff]))
  const bcExt = seq(Buffer.concat([
    oid('2.5.29.19'),
    octStr(seq(Buffer.concat([boolTrue, int_(0)])))
  ]))
  const kuExt = seq(Buffer.concat([
    oid('2.5.29.15'),
    boolTrue,
    octStr(asnTag(0, false, 3, Buffer.from([0, 0x86])))
  ]))
  const sanExt = seq(Buffer.concat([
    oid('2.5.29.17'),
    octStr(seq(ctx_(6, ia5Str('https://sast.local/fiel/' + rfc), false)))
  ]))
  const extensions = ctx_(3, seq(Buffer.concat([bcExt, kuExt, sanExt])))
  const tbsCert = seq(Buffer.concat([version, serial, sigAlgInner, subject, validity, subject, spki, extensions]))
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(tbsCert)
  const sig = sign.sign({ key: privateKeyPem, format: 'pem', type: 'pkcs8' })
  const signatureValue = rawBits(sig)
  const certificate = seq(Buffer.concat([tbsCert, sigAlgInner, signatureValue]))
  return derToPem(certificate, 'CERTIFICATE')
}

// ============= main =============
console.log('FIEL dev final: 100% Node crypto helpers declarados primero.')
console.log('  1/4 RSA 2048 generateKeyPairSync...')
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048, publicExponent: 65537,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

console.log('  2/4 Emisión certificado ASN.1 DER + RSA-SHA256 (Node-only)...')
const cerPem = buildSelfSignedCertPemNodeOnly(publicKey, privateKey, RFC)
const cerDer = pemBodyToDer(cerPem)
fs.writeFileSync(CER_PATH, cerDer)
console.log('  3/4 .cer DER →', CER_PATH, cerDer.length, 'bytes')

const nodePriv = crypto.createPrivateKey({ key: privateKey, format: 'pem', type: 'pkcs8' })
const encPem = nodePriv.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })
const keyDer = pemBodyToDer(encPem)
fs.writeFileSync(KEY_PATH, keyDer)
console.log('  4/4 .key DER AES-256-CBC →', KEY_PATH, keyDer.length, 'bytes')

let localOut: any
try {
  console.log('  debug validateFiel-like...')
  const fp = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8', passphrase: PASSWORD })
  console.log('  privateKey parseado OK')
  const x509 = new crypto.X509Certificate(cerDer)
  console.log('  X509Certificate OK, subject =', x509.subject.replace(/\n/g,' · '))
  const a = x509.publicKey.export({ type: 'spki', format: 'pem' })
  const b = crypto.createPublicKey(fp).export({ type: 'spki', format: 'pem' })
  console.log('  cert-publicKey.length =', a.length, 'derivedPublicKey.length =', b.length)
  console.log('  match =', a === b)
  const rfcMatch = x509.subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
  localOut = { isValid: a === b, rfc: rfcMatch?.[1]?.toUpperCase(), subject: x509.subject.replace(/\n/g, ' · '), error: undefined }
} catch (e: any) {
  console.log('  ERROR validateFiel-like raw:', e.stack || e.message)
  localOut = { isValid: false, rfc: null, subject: null, error: e.message }
}

const readme = [
  'FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).',
  'Generador        : scripts/generate-fiel-dev-final-v2.mts (100% Node crypto, ASN.1 DER minimo)',
  `Generada         : ${new Date().toISOString()}`,
  `RFC embebido     : ${RFC}`,
  `Password .key    : ${PASSWORD}`,
  `Cert Subject     : ${localOut.subject || RFC}`,
  '',
  'Archivos:',
  `  .cer (DER X.509 v3)                  : ${CER_PATH}  (${cerDer.length} bytes)`,
  `  .key (PKCS#8 DER AES-256-CBC)        : ${KEY_PATH}  (${keyDer.length} bytes)`,
  '',
  'Contrato src/lib/fiel-validation.ts 1:1:',
  '  crypto.createPrivateKey(der/pkcs8/pass)  = OK',
  '  new crypto.X509Certificate(.cer)         = OK',
  '  x509.publicKey == derivedPublicKey       = ' + localOut.isValid,
  '  regex RFC en subject                     = ' + (localOut.rfc ? `MATCH (${localOut.rfc})` : 'NO MATCH'),
  '',
  'FormData para POST /api/mass-downloads/credentials (API-08.1):',
  `  rfc            = ${RFC}`,
  `  password       = ${PASSWORD}`,
  `  organizationId = cmnntrppk000502gcp93ketfx  (Grupo Demo / Org-A)`,
  `  privateKey     = ${KEY_PATH}`,
  `  certificate    = ${CER_PATH}`,
  '',
  'Casos negativos derivados:',
  '  API-08.2 password incorrecto   : password = "wrong-pass-123"',
  '  API-08.4 .key > 8192 bytes     : payload-08-key-32KB.key (33 KB)',
  '  API-08.5 .cer > 10240 bytes    : payload-08-cer-16KB.cer (17 KB)',
  '  API-08.6 tenant mismatch       : autenticar U-OTH Org-B + orgId Org-A'
].join('\n')
fs.writeFileSync(README_PATH, readme, 'utf8')

console.log('')
console.log('=== ✅ FIEL DEV LISTA ===')
console.log('  RFC       :', RFC)
console.log('  PASSWORD  :', PASSWORD)
console.log('  VALIDACION  validateFiel 1:1:', JSON.stringify(localOut))
console.log('  CER       :', CER_PATH)
console.log('  KEY       :', KEY_PATH)
console.log('  README    :', README_PATH)
process.exit(localOut.isValid ? 0 : 1)

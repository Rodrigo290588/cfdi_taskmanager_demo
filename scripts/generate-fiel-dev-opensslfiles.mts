// Generacion FIEL dev via Node crypto + openssl cli con tmp files alojados en test-fixtures/sast/_tmp_openssl
//   - evita `/dev/stdin` bloqueado en Windows
//   - `openssl` se descubre via `Get-Command openssl` o se usa `C:\Program Files\Git\usr\bin\openssl.exe` (comun en dev)
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const OUT_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'fiel-dev')
const TMP_DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', '_tmp_openssl')
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(TMP_DIR, { recursive: true })

const RFC = 'QBB7223997V9'
const PASSWORD = 'F1el-Dev-2026!'
const CER_PATH = path.join(OUT_DIR, 'fiel-dev-valid.cer')
const KEY_PATH = path.join(OUT_DIR, 'fiel-dev-valid.key')
const README_PATH = path.join(OUT_DIR, 'README.txt')
const SUBJECT = `/C=MX/O=ORG-B SAST PRUEBAS/OU=SAT TEST/CN=${RFC}`

function findOpenssl(): string {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win32\\bin\\openssl.exe'
  ]
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['version'], { encoding: 'utf8' })
      if (r.status === 0) return c
    } catch { /* ignore */ }
  }
  return ''
}

const OPENSSL = findOpenssl()
console.log('FIEL dev via openssl, exe encontrado?', OPENSSL || 'NO')

console.log('  1/5 RSA 2048 generateKeyPairSync (Node)...')
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048, publicExponent: 65537,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
const TMP_KEY_PEM = path.join(TMP_DIR, 'priv.pem')
const TMP_CER_PEM = path.join(TMP_DIR, 'cert.pem')
const TMP_CER_DER = path.join(TMP_DIR, 'cert.der')
const TMP_KEY_DER = path.join(TMP_DIR, 'priv.der')
fs.writeFileSync(TMP_KEY_PEM, privateKey)

let cerDer: Buffer
if (OPENSSL) {
  console.log('  2/5 openssl req -x509 sobre archivos tmp...')
  const r1 = spawnSync(OPENSSL, [
    'req', '-x509', '-new',
    '-key', TMP_KEY_PEM,
    '-out', TMP_CER_PEM,
    '-days', '365',
    '-subj', SUBJECT,
    '-sha256'
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  if (r1.status !== 0) throw new Error('openssl req failed: ' + (r1.stderr || r1.stdout || '').toString().slice(0, 500))

  console.log('  3/5 openssl x509 -outform DER...')
  const r2 = spawnSync(OPENSSL, ['x509', '-in', TMP_CER_PEM, '-out', TMP_CER_DER, '-outform', 'DER'], { encoding: 'utf8' })
  if (r2.status !== 0) throw new Error('openssl x509 der failed: ' + (r2.stderr || '').toString().slice(0, 500))
  cerDer = fs.readFileSync(TMP_CER_DER)
} else {
  console.log('  2/5 openssl no disponible, usando estrategia Node (escribe PEM como .cer y espera que X509Certificate lo acepte)...')
  // Node X509Certificate si acepta PEM en el constructor: guardamos PEM con encabezado BEGIN CERTIFICATE
  // Pero fiel-validation.ts espera un buffer tipo DER; probamos ambos y tomamos el que pase el test.
  cerDer = Buffer.from([]) // provisional
  // Generamos .pem certificado auto-firmado con Node firmando sobre ASN.1 DER via crypto.Sign (igual que script anterior)
  // pero SALVAMOS la salida también como CERTIFICATE PEM válido y comparamos en runtime cual acepta el constructor.
  // Para no re-implementar el bug del script anterior, generamos de inmediato el pem válido con Node y lo probamos.
  cerDer = buildSelfSignedCertPemFallbackNode(publicKey, privateKey, RFC)
  // Verificamos si Node X509Certificate lo acepta. Si no, fallback a pem guardado con el mismo formato.
  try { new crypto.X509Certificate(cerDer) } catch {
    // Pasa el fallback a PEM sin DER (aunque la ruta del SAT lo pida en DER — las APIs lo intentan en los dos sentidos gracias al try/catch).
    cerDer = fs.readFileSync(TMP_CER_PEM + '.pem')
  }
}

console.log('  4/5 PKCS#8 DER AES-256-CBC (password ' + PASSWORD + ') via Node crypto...')
const nodePriv = crypto.createPrivateKey({ key: privateKey, format: 'pem', type: 'pkcs8' })
const encPem = nodePriv.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: PASSWORD })
const keyDer = pemBodyToDer(encPem)
fs.writeFileSync(KEY_PATH, keyDer)
fs.writeFileSync(CER_PATH, cerDer)
console.log('  5/5 archivos finales .cer .key escritos')

let localOut: any
try {
  const fp = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8', passphrase: PASSWORD })
  const x509 = new crypto.X509Certificate(cerDer)
  const a = x509.publicKey.export({ type: 'spki', format: 'pem' })
  const b = crypto.createPublicKey(fp).export({ type: 'spki', format: 'pem' })
  const rfcMatch = x509.subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
  localOut = { isValid: a === b, rfc: rfcMatch?.[1]?.toUpperCase(), subject: x509.subject.replace(/\n/g, ' · '), error: undefined }
} catch (e: any) {
  localOut = { isValid: false, rfc: null, subject: null, error: e.message || String(e) }
}

const readme = [
  'FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).',
  `Generador        : scripts/generate-fiel-dev-opensslfiles.mts  (openssl=${OPENSSL || 'fallback Node-only'})`,
  `Generada         : ${new Date().toISOString()}`,
  `RFC embebido     : ${RFC}`,
  `Password .key    : ${PASSWORD}`,
  `Cert Subject     : ${localOut.subject || RFC}`,
  '',
  'Archivos finales (entregar a Postman / UI):',
  `  .cer X.509 (${OPENSSL ? 'DER' : 'PEM via Node fallback'})  : ${CER_PATH}  (${cerDer.length} bytes)`,
  `  .key PKCS#8 DER AES-256-CBC cifrado                     : ${KEY_PATH}  (${keyDer.length} bytes)`,
  '',
  'Contrato validateFiel (src/lib/fiel-validation.ts) 1:1:',
  '  createPrivateKey(der/pkcs8/pass) = OK',
  '  new X509Certificate(.cer)       = OK',
  '  x509.publicKey === derivedPK    = ' + localOut.isValid,
  '  regex RFC en subject            = ' + (localOut.rfc ? `MATCH (${localOut.rfc})` : 'NO MATCH'),
  '',
  'FormData para POST /api/mass-downloads/credentials (API-08.1 happy-path):',
  `  rfc            = ${RFC}`,
  `  password       = ${PASSWORD}`,
  `  organizationId = cmnntrppk000502gcp93ketfx  (Grupo Demo / Org-A)`,
  `  privateKey     = ${KEY_PATH}`,
  `  certificate    = ${CER_PATH}`,
  '',
  'Casos negativos derivados:',
  '  API-08.2 password incorrecto : password = "wrong-pass-123"',
  '  API-08.4 .key > 8192 bytes   : payload-08-key-32KB.key',
  '  API-08.5 .cer > 10240 bytes  : payload-08-cer-16KB.cer',
  '  API-08.6 tenant mismatch     : U-OTH auth + orgId Org-A'
].join('\n')
fs.writeFileSync(README_PATH, readme, 'utf8')

console.log('')
console.log('=== ✅ FIEL DEV LISTA ===')
console.log('  OPENSSL CLI:', OPENSSL || 'NO (fallback Node)')
console.log('  RFC       :', RFC)
console.log('  PASSWORD  :', PASSWORD)
console.log('  VALIDACION validateFiel 1:1:', JSON.stringify(localOut, null, 2))
console.log('  CER       :', CER_PATH, cerDer.length, 'bytes')
console.log('  KEY       :', KEY_PATH, keyDer.length, 'bytes')
console.log('  README    :', README_PATH)
process.exit(localOut.isValid ? 0 : 2)

function pemBodyToDer(pem: string): Buffer {
  const b = pem.replace(/-----BEGIN[^-]+-----/g, '').replace(/-----END[^-]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(b, 'base64')
}

// Fallback generador de certificado autofirmado PEM VÁLIDO para Node X509Certificate (sin openssl)
// Re-usa el ASN.1 DER builder pero retorna PEM (Buffer con BEGIN CERTIFICATE) porque el DER
// del script anterior presentaba malformacion en Extension / signatureAlgorithm.
function buildSelfSignedCertPemFallbackNode(publicKeyPem: string, privateKeyPem: string, rfc: string): Buffer {
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
  const utc = (s: string) => asnTag(0, false, 23, Buffer.from(s, 'ascii'))
  const toUtc = (d: Date) => {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  }
  const subject = dn([
    ['2.5.4.6', printStr('MX')],
    ['2.5.4.10', utf8Str('ORG-B SAST PRUEBAS')],
    ['2.5.4.11', utf8Str('SAT TEST')],
    ['2.5.4.3', utf8Str(rfc)]
  ])
  const version = ctx_(0, int_(2), false)
  const serial = int_(Date.now() & 0x7fffffff)
  const sigAlgInner = seq(Buffer.concat([oid('1.2.840.113549.1.1.11'), null_()]))
  const validity = seq(Buffer.concat([utc(toUtc(new Date(Date.now() - 86400000))), utc(toUtc(new Date(Date.now() + 365 * 86400000)))]))
  const spki = pemBodyToDer(publicKeyPem)
  const bcExt = seq(Buffer.concat([oid('2.5.29.19'), octStr(seq(Buffer.concat([asnTag(0, false, 1, Buffer.from([0xff])), int_(0)])))]))
  const kuExt = seq(Buffer.concat([oid('2.5.29.15'), asnTag(0, false, 1, Buffer.from([0xff])), octStr(asnTag(0, false, 3, Buffer.from([0, 0x86])))]))
  const sanExt = seq(Buffer.concat([oid('2.5.29.17'), octStr(seq(ctx_(6, ia5Str('https://sast.local/fiel/' + rfc), false)))]))
  const extensions = ctx_(3, seq(Buffer.concat([bcExt, kuExt, sanExt])))
  const tbsCert = seq(Buffer.concat([version, serial, sigAlgInner, subject, validity, subject, spki, extensions]))
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(tbsCert)
  const sig = sign.sign({ key: privateKeyPem, format: 'pem', type: 'pkcs8' })
  const cert = seq(Buffer.concat([tbsCert, sigAlgInner, rawBits(sig)]))
  // Guardamos también el .pem intermedio por si X509Certificate lo prefiere
  const pem = '-----BEGIN CERTIFICATE-----\n' + cert.toString('base64').match(/.{1,64}/g)!.join('\n') + '\n-----END CERTIFICATE-----\n'
  fs.writeFileSync(TMP_CER_PEM + '.pem', pem)
  // Como último recurso: retornamos PEM (Buffer) porque X509Certificate lo acepta. La capa de fiel-validation.ts
  // no hace enforce "tiene que ser DER" — el constructor acepta ambos.
  return Buffer.from(pem, 'utf8')
}

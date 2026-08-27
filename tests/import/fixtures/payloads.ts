// ============================================================================
// tests/import/fixtures/payloads.ts — SAST Module /api/import Payloads Base
// 1:1 mapping 14 findings IMP-001..IMP-022 + 14 edge cases = 28+ TOTAL
// No contiene datos reales. Todos UUIDs/RFCs son ficticios.
// ============================================================================

export const IMP_PAYLOAD_COUNT = 28

// ----------------------------------------------------------------------------
// CAT 1: INYECCIONES / XXE / ReDoS (OWASP A03)
// ----------------------------------------------------------------------------

// IMP-001 CRITICO: XXE Bypass BOM UTF-8 + Comments interleaving
export const IMP001_XXE_BOM_COMMENT = Buffer.from([
  0xEF, 0xBB, 0xBF, // BOM UTF-8 bypass regex L95
  0x3C, 0x21, 0x2D, 0x2D, 0x20, 0x78, 0x20, 0x2D, 0x2D, 0x3E, // <!-- x --> comment interleaving
  0x3C, 0x21, 0x44, 0x4F, 0x43, 0x54, 0x59, 0x50, 0x45, 0x20, // <!DOCTYPE
  0x63, 0x66, 0x64, 0x69, 0x20, 0x5B, 0x3C, 0x21, 0x45, 0x4E, // cfdi [<!EN
  0x54, 0x49, 0x54, 0x59, 0x20, 0x25, 0x78, 0x20, 0x53, 0x59, // TITY %x SY
  0x53, 0x54, 0x45, 0x4D, 0x20, 0x22, 0x66, 0x69, 0x6C, 0x65, // STEM "file
  0x3A, 0x2F, 0x2F, 0x2F, 0x65, 0x74, 0x63, 0x2F, 0x70, 0x61, //:///etc/pa
  0x73, 0x73, 0x77, 0x64, 0x22, 0x3E, 0x25, 0x78, 0x3B, 0x5D // sswd">%x;]
]).toString('binary') + '\ufeff'

// IMP-016 CRITICO: Billion Laughs 9 niveles ENTITY anidadas
export const IMP016_BILLION_LAUGHS = `<?xml version="1.0"?>
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

// IMP-002 ALTO: ReDoS conceptoRegex múltiples Conceptos SIN cerrar
export const IMP002_REDOS_CONCEPTOS = ((): string => {
  const inner = () =>
    '<cfdi:Concepto ClaveProdServ="01010101" NoIdentificacion="' + 'A'.repeat(200) + '">' +
    '<cfdi:InformacionAduanera xmlns="x">' +
    '<cfdi:Traslados><cfdi:Traslado Base="100" />'
  const parts: string[] = []
  for (let i = 0; i < 600; i++) parts.push(inner())
  return '<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">' +
    '<cfdi:Conceptos>' + parts.join('') + '</cfdi:Conceptos></cfdi:Comprobante>'
})()

// IMP-022 MEDIO: CSV Injection relatedUuid + Stored XSS attr
export const IMP022_CSV_XSS_UUID = `<?xml version="1.0"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Sello="fake" NoCertificado="00000000000000000000"
  SubTotal="100" Total="116" Moneda="MXN" TipoDeComprobante="I"
  RFC="ODE8604257UA" Nombre="ORG A Emisora SA">
  <cfdi:CfdiRelacionados TipoRelacion="04">
    <cfdi:CfdiRelacionado UUID="=cmd|' /C calc'!A0" />
    <cfdi:CfdiRelacionado UUID="=HYPERLINK(&quot;javascript:alert(document.cookie)&quot;,&quot;clickme&quot;)" />
  </cfdi:CfdiRelacionados>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="01010101" ClaveUnidad="ACT" NoIdentificacion="INV-001" Cantidad="1" ClaveUnidadSAT="ACT" Descripcion="=cmd|' /C calc'!A0" ValorUnitario="100" Importe="100"/></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="11111111-0000-4000-8000-000000000001" SelloCFD="fake" NoCertificadoSAT="00000000000000000000" SelloSAT="fake" FechaTimbrado="2025-01-01T00:00:00"/></cfdi:Complemento>
</cfdi:Comprobante>`

// ----------------------------------------------------------------------------
// CAT 2: BROKEN ACCESS (OWASP A01)
// ----------------------------------------------------------------------------

// IMP-007 CRITICO: BOLA Cross-Org RFC Emisor co-creado owner ORG-B
// Fixture ID SAST-SEED: RFC QA2164964DJB (companyId cmt1xatbu00002qy4199p2t4m ORG-A owner) y
//                        RFC QBB61590505M (feId cmt1xatdb000a2qy4ttgxy8df ORG-B owner)
export const IMP007_BOLA_CROSS_ORG_A_IN_B = {
  batch: [
    {
      // Usuario envía desde ORG-A session, emisor RFC QBB61590505M (owner = user ORG-B),
      // receiverRfc = cliente ORG-B. Resultado esperado: THROW si targetOrganizationId !== resuelto.
      issuerRfc: 'QBB61590505M',
      receiverRfc: 'QB2660721SRX',
      xml: `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Sello="fake" NoCertificado="00000000000000000000" SubTotal="100" Total="116" Moneda="MXN" TipoDeComprobante="I"><cfdi:Emisor Rfc="QBB61590505M" Nombre="ORG B Emisora SA de CV"/><cfdi:Receptor Rfc="QB2660721SRX" Nombre="Cliente ORG B"/><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="01010101" ClaveUnidad="ACT" Cantidad="1" Descripcion="Servicio" ValorUnitario="100" Importe="100"/></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="11111111-0000-4000-8000-000000000002" SelloCFD="fake" NoCertificadoSAT="00000000000000000000" SelloSAT="fake" FechaTimbrado="2025-01-02T00:00:00"/></cfdi:Complemento></cfdi:Comprobante>`
    }
  ],
  callerSession: {
    // Caller se autentica como member ORG-A.
    userId: 'cmnntrppk000502gcp93ketfx',
    organizationId: 'cmnntrppk000502gcp93ketfx',
    expected: 403  // Debe fallar Forbidden si el helper valida mismatch org target vs resuelto.
  }
}

// IMP-009 ALTO: Proxy.ts Whitelist bypass sin session (request sin cookie auth)
export const IMP009_PROXY_BYPASS_ANON = {
  method: 'POST',
  path: '/api/import',
  headers: {
    // NO Authorization, NO Cookie session
    'Content-Type': 'application/json',
    'User-Agent': 'curl/8.9.1 SAST-PENTEST-ANON'
  },
  body: JSON.stringify({ batch: [], organizationId: 'ANY' })
}

// IMP-008 MEDIO: Granular Permission Enum vs JSON mismatch
export const IMP008_GRANULAR_ENUM_VS_JSON = {
  hasPermissionEnumFallback: 'CFDI_IMPORT_BATCH',
  granularKeyExpected: 'cfdi.import.batch:create',
  roleJsonMissingSwitch: { granularPermissions: { 'dashboard.fiscal.read': true } }, // NO key cfdi.import.batch:create
  expectedStrict: false  // hasPermission DEBE retornar false si JSON key no está.
}

// IMP-014 MEDIO: Information Disclosure Prisma ID
export const IMP014_PRISMA_ID_LEAK = {
  resultsExpectedShapeStrict: {
    uuid: /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
    status: /^(success|error|duplicate)$/,
    message: 'string'
    // PROHIBIDO: key "id" number Prisma autoincremental
  }
}

// ----------------------------------------------------------------------------
// CAT 3: LOGGING FAILURES / SENSITIVE EXPOSURE (OWASP A09)
// ----------------------------------------------------------------------------

// IMP-012 ALTO: console.error full stack PII RFC timbrados
export const IMP012_CONSOLE_ERROR_STACK_PII = {
  trigger: 'batch[0].xml = XML invalido que dispara error parse',
  regexLeakRfcExpected: /Rfc="([A-Z&Ñ]{3,4}[0-9]{2}[01][0-9][0-3][0-9][A-Z0-9]{2}[0-9A]?)"|RFC\s+[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}/i,
  // Regla safeErrSummary: reemplazar RFCs por SHA256 fingerprint 32chars primeros
  safeLogReplacement: /\[redacted-rfc-[a-f0-9]{10}\]/
}

// IMP-013 ALTO: Zod issues raw path leak batch[x].organizationId
export const IMP013_ZOD_ISSUES_LEAK = {
  invalidPayloadExtraKey: {
    batch: [{ __proto__: { pollute: 'PrototypePollutionProof' } }],
    organizationId: 'cmnntrppk000502gcp93ketfx',
    extraNotAllowed: 'overposting-test-field-IMP-013'
  },
  // safeErrSummary NO debe exponer ".batch[42].organizationId" path completo a atacante
  regexExpectedRedacted: /\["batch","(\d+)"/,
  safeRedacted: '["batch","<index>"]'
}

// ----------------------------------------------------------------------------
// CAT 4: INSECURE DESIGN / MISCONFIG / DoS (OWASP A04, A05)
// ----------------------------------------------------------------------------

// IMP-021 CRITICO: Missing SAT Signature XSD + Sello Verify
export const IMP021_APOCRIFO_UUID_FAKE = `<?xml version="1.0"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Sello="NO-ES-UN-SELLO-SHA256-RSA-VALIDO-NI-EN-BASE64"
  NoCertificado="99999999999999999999"
  Certificado="YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5"
  SubTotal="100" Total="116" Moneda="MXN" TipoDeComprobante="I"
  LugarExpedicion="01000" Fecha="2025-01-01T00:00:00"
  FormaPago="01" MetodoPago="PUE" CondicionesDePago="Contado">
  <cfdi:Emisor Rfc="ODE8604257UA" Nombre="ORG A Emisora SA" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="Publico General" RegimenFiscal="616" DomicilioFiscalReceptor="01000" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" ClaveUnidad="ACT" NoIdentificacion="FAKE-APOCRIFO-001" Cantidad="1" ClaveUnidadSAT="ACT" Descripcion="Servicio Apocrifo UUID Fake" ValorUnitario="100" Importe="100" ObjetoImp="02">
      <cfdi:ImpuestosConcepto><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:ImpuestosConcepto>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento>
    <!-- UUID FALSO (NO existe en BD SAT PAC). SelloSAT no verifica. XSD 4.0 roto por atributo IlegalExtra -->
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1"
      UUID="FFFFFFFF-FFFF-4FFF-FFFF-FFFFFFFFFFFF"
      FechaTimbrado="2025-01-01T00:00:01" AtributoIlegalExtra="XSS-INVALID-XSD"
      SelloCFD="NOT-A-REAL-SHA256-SIGNATURE-B64" NoCertificadoSAT="00000000000000000000" SelloSAT="NOT-A-REAL-SAT-SIGNATURE-B64"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`

// IMP-017 ALTO: Heap OOM 25 GB en lote (500 XMLs × 50 MB cada uno)
export const IMP017_HEAP_OOM_25GB = {
  batchLength: 500,
  eachXmlBytesPadding: 50 * 1024 * 1024,  // 50 MB × 500
  // IMP-017 superRefine límite: MAX_BATCH_TOTAL_BYTES = BATCH_SIZE_LIMIT * MAX_XML_SIZE_SAFE = 50 * 5MB = 250 MB
  safeTotalBytesLimit: 50 * (5 * 1024 * 1024),
  payloadExample: {
    organizationId: 'cmnntrppk000502gcp93ketfx',
    batch: Array.from({ length: 500 }, () => ({ xml: 'A'.repeat(100) }))  // length check NO content
  }
}

// IMP-018 ALTO: N+1 Queries Starvation Pool 10 conexiones
export const IMP018_NPLUS1_QUERIES = {
  nCfdis: 500,
  queriesPerCfdiEstimated: 6,  // 3 findFirst RFC emisor, FiscalEntity, Member + 3 create/update
  totalQueriesExpectedBatch: 3000,
  prismaPoolSizeDefault: 10,
  safeBatchChunkSize: 100,
  safeStrategy: 'Dedupe RFC upfront con 1 findMany in: + Prisma $transaction chunks createMany'
}

// IMP-019 MEDIO: Sync 300s Long Running HTTP sin BullMQ (HTTP 504 Gateway Timeout)
export const IMP019_SYNC_300S_BULLMQ = {
  routeAsyncPatternExpected202: {
    status: 202,
    jobId: 'import-<uuid>-<org>',
    pollUrl: '/api/import/runs/<runId>',
    queue: 'cfdi-import-queue',
    concurrency: 5,
    backoffMs: [300000, 900000, 1800000]  // 5m, 15m, 30m exp
  }
}

// ----------------------------------------------------------------------------
// EDGE CASES ADICIONALES (10 extra) — Total 28 payloads
// ----------------------------------------------------------------------------

export const IMP_EDGE_01_BLANK_DOC_WHITESPACE_DOCTYPE = '\n\r\t  <! DOCTYPE  cfdi  SYSTEM  "x"><xml/>'  // Whitespace random en DOCTYPE keyword
export const IMP_EDGE_02_NULL_BYTES_BEFORE_DOCTYPE = Buffer.from([0x00, 0x00, 0x00, 0x3C, 0x21, 0x44, 0x4F, 0x43, 0x54, 0x59, 0x50, 0x45]).toString('binary') + ' x SYSTEM "y">'
export const IMP_EDGE_03_LOWERCASE_DOCTYPE = '<!doctype cfdi [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><a>&x;</a>'
export const IMP_EDGE_04_ENTITY_PARAMETER = '<!DOCTYPE x [<!ENTITY % p SYSTEM "http://169.254.169.254/latest/meta-data/"> %p;]>'
export const IMP_EDGE_05_UUID_INVALID_FORMAT_TOO_LONG = '11111111-0000-4000-8000-000000000001-EXTRA-CHARS-INVALID-99999'
export const IMP_EDGE_06_UUID_INVALID_VERSION_0 = '00000000-0000-0000-0000-000000000000'  // Version nibble = 0 (no 1..5)
export const IMP_EDGE_07_RFC_INVALID_LENGTH = 'X'
export const IMP_EDGE_08_RFC_NIF_EU = 'ESX1234567'  // Formato NIF europeo; Regex SAT RFC mexicano debe rechazar
export const IMP_EDGE_09_XML_EMPTY_BYTES_150 = '<?xml version="1.0"?>'  // Sólo declaración, sin Comprobante → min 200 bytes
export const IMP_EDGE_10_ZOD_STRICT_OVERPOST_EXTRA_KEY = { organizationId: 'x', batch: [], __dangerouslySetInnerHTML: 'x', unexpectedKey: 'y', prototype: {} }

// ----------------------------------------------------------------------------
// PAYLOADS ADICIONALES REFERENCIADOS POR LAS 5 SUITES DE TEST
// (Constantes derivadas compactas para mantener IMP_PAYLOAD_COUNT = 46)
// ----------------------------------------------------------------------------

export const IMP_001_XXE_BOM = IMP001_XXE_BOM_COMMENT

export const IMP_001_XXE_COMMENT_INTERLEAVE = Buffer.from([
  0x3C, 0x21, 0x2D, 0x2D, 0x20, 0x68, 0x61, 0x63, 0x6B, 0x20, 0x2D, 0x2D, 0x3E, // <!-- hack -->
  0x3C, 0x21, 0x44, 0x4F, 0x43, 0x54, 0x59, 0x50, 0x45, 0x20, // <!DOCTYPE
  0x78, 0x6D, 0x6C, 0x20, 0x5B, 0x3C, 0x21, 0x45, 0x4E, 0x54, 0x49, 0x54, 0x59, 0x20, 0x25, 0x20, 0x70, 0x20, 0x53, 0x59, 0x53, 0x54, 0x45, 0x4D, 0x20, 0x22, 0x68, 0x74, 0x74, 0x70, 0x3A, 0x2F, 0x2F, 0x31, 0x36, 0x39, 0x2E, 0x32, 0x35, 0x34, 0x2E, 0x31, 0x36, 0x39, 0x2E, 0x32, 0x35, 0x34, 0x2F, 0x6C, 0x61, 0x74, 0x65, 0x73, 0x74, 0x22, 0x3E, 0x25, 0x70, 0x3B, 0x5D, 0x3E
]).toString('binary')

export const IMP_001_XXE_WHITESPACE = '\n\r\t  \n  < \n ! \n D O C T Y P E  x  [  <!ENTITY % p SYSTEM "http://169.254.169.254/latest/meta-data/" >  %p;  ]  >\n<a/>'

export const IMP_001_ENTITY_PARAMETER = IMP_EDGE_04_ENTITY_PARAMETER

export const IMP_001_ENTITY_SYSTEM = `<?xml version="1.0"?><!DOCTYPE cfdi [<!ENTITY x SYSTEM "file:///etc/passwd">]><cfdi>&x;</cfdi>`

const _BASE_CFDI_WRAPPER = (opts: {
  uuid: string
  selloSatLen?: number
  selloCfdLen?: number
  noCertificadoSatDigits?: number
  noCertificadoSatAlpha?: boolean
  versionNibble?: number
  variantNibble?: number
  timbreFaltante?: boolean
}) => {
  const selloSAT = 'A'.repeat(opts.selloSatLen ?? 48)
  const selloCFD = 'A'.repeat(opts.selloCfdLen ?? 48)
  const ncs = opts.noCertificadoSatAlpha
    ? '0000000000000000000' + (opts.noCertificadoSatDigits === 21 ? 'X1' : 'X')
    : '0'.repeat(opts.noCertificadoSatDigits ?? 20)
  const uuidBase = opts.uuid || '11111111-0000-4000-8000-000000000099'
  const tfdBlock = opts.timbreFaltante
    ? ''
    : `<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuidBase}" SelloCFD="${selloCFD}" NoCertificadoSAT="${ncs}" SelloSAT="${selloSAT}" FechaTimbrado="2025-01-01T00:00:00" RfcProvCertif="00000000000000000000"/></cfdi:Complemento>`
  return `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Sello="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" NoCertificado="00000000000000000000" SubTotal="100" Total="116" Moneda="MXN" TipoDeComprobante="I" LugarExpedicion="01000" Fecha="2025-01-01T00:00:00" FormaPago="01" MetodoPago="PUE" CondicionesDePago="Contado"><cfdi:Emisor Rfc="ODE8604257UA" Nombre="ORG A Emisora SA" RegimenFiscal="601"/><cfdi:Receptor Rfc="XAXX010101000" Nombre="Publico General" RegimenFiscal="616" DomicilioFiscalReceptor="01000" UsoCFDI="G03"/><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="01010101" ClaveUnidad="ACT" NoIdentificacion="VALIDO-001" Cantidad="1" ClaveUnidadSAT="ACT" Descripcion="Servicio Valido UUID Fix" ValorUnitario="100" Importe="100" ObjetoImp="02"><cfdi:ImpuestosConcepto><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:ImpuestosConcepto></cfdi:Concepto></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos>${tfdBlock}</cfdi:Comprobante>`
}

export const CLEAN_CFDI_VALIDO = _BASE_CFDI_WRAPPER({ uuid: '11111111-0000-4000-8000-000000000099' })

const _5Conceptos = Array.from({ length: 5 }, (_, i) => {
  const id = i + 1
  return `<cfdi:Concepto ClaveProdServ="01010101" ClaveUnidad="ACT" NoIdentificacion="CI-${id}" Cantidad="1" ClaveUnidadSAT="ACT" Descripcion="Concepto Valido ${id}" ValorUnitario="100" Importe="100" ObjetoImp="02"><cfdi:ImpuestosConcepto><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:ImpuestosConcepto></cfdi:Concepto>`
}).join('')

const _WRAP_CONCEPTOS = (innerConceptos: string) => `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Sello="AA" NoCertificado="00000000000000000000" SubTotal="100" Total="116" Moneda="MXN" TipoDeComprobante="I"><cfdi:Emisor Rfc="ODE8604257UA" Nombre="ORG A"/><cfdi:Receptor Rfc="XAXX010101000" Nombre="PUB"/><cfdi:Conceptos>${innerConceptos}</cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="11111111-0000-4000-8000-000000000099" SelloCFD="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" NoCertificadoSAT="00000000000000000000" SelloSAT="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" FechaTimbrado="2025-01-01T00:00:00" RfcProvCertif="00000000000000000000"/></cfdi:Complemento></cfdi:Comprobante>`

export const IMP_002_VALID_CONCEPTOS_5 = _WRAP_CONCEPTOS(_5Conceptos)

const _REDOS_UNCLOSED_INNER = Array.from({ length: 600 }, (_, i) => {
  return `<cfdi:Concepto ClaveProdServ="01010101" NoIdentificacion="${'A'.repeat(200)}"><cfdi:InformacionAduanera xmlns="x"><cfdi:Traslados><cfdi:Traslado Base="${100 + i}"`
}).join('')
export const IMP_002_REDOS_UNCLOSED = _WRAP_CONCEPTOS(_REDOS_UNCLOSED_INNER)

const _LIMIT_7000_INNER = Array.from({ length: 7000 }, (_, i) => {
  return `<cfdi:Concepto ClaveProdServ="01010101" NoIdentificacion="CL${i}" Cantidad="1" ValorUnitario="1" Importe="1"/>`
}).join('')
export const IMP_002_CONCEPT_LIMIT_7000 = _WRAP_CONCEPTOS(_LIMIT_7000_INNER)

export const IMP_021_TIMBRE_MISSING = _BASE_CFDI_WRAPPER({ uuid: '11111111-0000-4000-8000-000000000099', timbreFaltante: true })

export const IMP_021_UUID_INVALID_VERSION = _BASE_CFDI_WRAPPER({ uuid: 'FFFFFFFF-FFFF-0FFF-FFFF-FFFFFFFFFFFF' })

export const IMP_021_NO_CERTIFICADO_19DIG = _BASE_CFDI_WRAPPER({
  uuid: '11111111-0000-4000-8000-000000000099', noCertificadoSatDigits: 19
})

export const IMP_021_SELLO_CFD_30CH = _BASE_CFDI_WRAPPER({
  uuid: '11111111-0000-4000-8000-000000000099', selloCfdLen: 30
})

export const IMP_021_SELLO_SAT_20CH = _BASE_CFDI_WRAPPER({
  uuid: '11111111-0000-4000-8000-000000000099', selloSatLen: 20
})

export const IMP_021_NO_CERTIFICADO_21ALPHA = _BASE_CFDI_WRAPPER({
  uuid: '11111111-0000-4000-8000-000000000099', noCertificadoSatDigits: 21, noCertificadoSatAlpha: true
})

const _BLOCK_RETENCION = `<cfdi:Retencion Impuesto="002" Importe="16.00"/>`
const _BLOCK_REL = `<cfdi:CfdiRelacionado UUID="11111111-0000-4000-8000-000000000001"/>`
const _BLOCK_DOCTO = `<cfdi:DoctoRelacionado IdDocumento="11111111-0000-4000-8000-000000000001"/>`
const _BLOCK_PAGO = `<cfdi:Pago FechaPago="2025-01-01T00:00:00" FormaDePagoP="01" MonedaP="MXN" Monto="100.00" NumOperacion="1" RfcEmisorCtaOrd="ODE8604257UA" CtaOrd="0123456789"/><cfdi:DoctoRelacionado IdDocumento="11111111-0000-4000-8000-000000000001" Serie="F" Folio="1" MonedaDR="MXN" MetodoDePagoDR="PUE" NumParcialidad="1" ImpSaldoAnt="100.00" ImpPagado="100.00" ImpSaldoInsoluto="0.00" ObjetoImpDR="02" EquivalenciaDR="1"/>`

const _REPEAT = (fn: () => string, n: number) => Array.from({ length: n }, fn).join('')

export const IMP_018_TAX_ITEMS_2000 = `<?xml version="1.0"?><x:Root xmlns:x="a"><x:Impuestos>${_REPEAT(() => _BLOCK_RETENCION, 2000)}</x:Impuestos></x:Root>`
export const IMP_018_CFDI_REL_200 = `<?xml version="1.0"?><x:Root xmlns:x="a"><x:CfdiRelacionados TipoRelacion="04">${_REPEAT(() => _BLOCK_REL, 200)}</x:CfdiRelacionados></x:Root>`
export const IMP_018_DOCTO_REL_300 = `<?xml version="1.0"?><x:Root xmlns:x="a">${_REPEAT(() => _BLOCK_DOCTO, 300)}</x:Root>`
export const IMP_018_PAGOS_1000 = `<?xml version="1.0"?><p:Pagos xmlns:p="http://www.sat.gob.mx/Pagos" Version="2.0">${_REPEAT(() => _BLOCK_PAGO, 1000)}</p:Pagos>`

// ----------------------------------------------------------------------------
// AGGREGATOR IMP_PAYLOADS: todos los payloads accesibles por key string
// ----------------------------------------------------------------------------

export const IMP_PAYLOADS = {
  IMP_PAYLOAD_COUNT,
  IMP001_XXE_BOM_COMMENT,
  IMP_001_XXE_BOM,
  IMP_001_XXE_COMMENT_INTERLEAVE,
  IMP_001_XXE_WHITESPACE,
  IMP_001_ENTITY_PARAMETER,
  IMP_001_ENTITY_SYSTEM,
  IMP016_BILLION_LAUGHS,
  IMP_016_BILLION_LAUGHS: IMP016_BILLION_LAUGHS,
  IMP002_REDOS_CONCEPTOS,
  IMP_002_REDOS_CONCEPTOS: IMP002_REDOS_CONCEPTOS,
  IMP_002_VALID_CONCEPTOS_5,
  IMP_002_REDOS_UNCLOSED,
  IMP_002_CONCEPT_LIMIT_7000,
  IMP022_CSV_XSS_UUID,
  IMP_022_CSV_XSS_UUID: IMP022_CSV_XSS_UUID,
  IMP007_BOLA_CROSS_ORG_A_IN_B,
  IMP_007_BOLA_CROSS_ORG_A_IN_B: IMP007_BOLA_CROSS_ORG_A_IN_B,
  IMP009_PROXY_BYPASS_ANON,
  IMP_009_PROXY_BYPASS_ANON: IMP009_PROXY_BYPASS_ANON,
  IMP008_GRANULAR_ENUM_VS_JSON,
  IMP_008_GRANULAR_ENUM_VS_JSON: IMP008_GRANULAR_ENUM_VS_JSON,
  IMP014_PRISMA_ID_LEAK,
  IMP_014_PRISMA_ID_LEAK: IMP014_PRISMA_ID_LEAK,
  IMP012_CONSOLE_ERROR_STACK_PII,
  IMP_012_CONSOLE_ERROR_STACK_PII: IMP012_CONSOLE_ERROR_STACK_PII,
  IMP013_ZOD_ISSUES_LEAK,
  IMP_013_ZOD_ISSUES_LEAK: IMP013_ZOD_ISSUES_LEAK,
  IMP021_APOCRIFO_UUID_FAKE,
  IMP_021_APOCRIFO_UUID_FAKE: IMP021_APOCRIFO_UUID_FAKE,
  IMP_021_TIMBRE_MISSING,
  IMP_021_UUID_INVALID_VERSION,
  IMP_021_NO_CERTIFICADO_19DIG,
  IMP_021_SELLO_CFD_30CH,
  IMP_021_SELLO_SAT_20CH,
  IMP_021_NO_CERTIFICADO_21ALPHA,
  IMP017_HEAP_OOM_25GB,
  IMP_017_HEAP_OOM_25GB: IMP017_HEAP_OOM_25GB,
  IMP018_NPLUS1_QUERIES,
  IMP_018_NPLUS1_QUERIES: IMP018_NPLUS1_QUERIES,
  IMP_018_TAX_ITEMS_2000,
  IMP_018_CFDI_REL_200,
  IMP_018_DOCTO_REL_300,
  IMP_018_PAGOS_1000,
  IMP019_SYNC_300S_BULLMQ,
  IMP_019_SYNC_300S_BULLMQ: IMP019_SYNC_300S_BULLMQ,
  IMP_EDGE_01_BLANK_DOC_WHITESPACE_DOCTYPE,
  IMP_EDGE_02_NULL_BYTES_BEFORE_DOCTYPE,
  IMP_EDGE_03_LOWERCASE_DOCTYPE,
  IMP_EDGE_04_ENTITY_PARAMETER,
  IMP_EDGE_05_UUID_INVALID_FORMAT_TOO_LONG,
  IMP_EDGE_06_UUID_INVALID_VERSION_0,
  IMP_EDGE_07_RFC_INVALID_LENGTH,
  IMP_EDGE_08_RFC_NIF_EU,
  IMP_EDGE_09_XML_EMPTY_BYTES_150,
  IMP_EDGE_10_ZOD_STRICT_OVERPOST_EXTRA_KEY,
  CLEAN_CFDI_VALIDO,
} as const

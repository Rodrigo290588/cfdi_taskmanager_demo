import { Permission } from '@/lib/permissions'

export type ProviderFinding =
  | 'PROV-001'
  | 'PROV-002'
  | 'PROV-003'
  | 'PROV-004'
  | 'PROV-005'
  | 'PROV-006'
  | 'PROV-007'
  | 'PROV-008'
  | 'PROV-009'
  | 'PROV-010'
  | 'PROV-011'
  | 'PROV-012'

export type ProviderSeverity = 'C' | 'A' | 'M' | 'B'

export interface ProviderSiloMembership {
  id: string
  userId: string
  organizationId: string
  role: 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'AUDITOR' | 'VIEWER' | 'MEMBER'
  status: 'APPROVED' | 'PENDING' | 'REVOKED'
  providerRfc?: string | null
  providerName?: string | null
  granularPermissions?: Record<string, boolean>
}

export interface ProviderDecimalCase {
  input: string | null | undefined
  fieldRef: string
  fileNameRef: string
  expected: number
  shouldThrow: boolean
  throwSubstring?: string
  description: string
  locale: 'MX' | 'US' | 'MIXED' | 'INVALID'
}

export interface ProviderGateAccessCase {
  id: string
  finding: ProviderFinding
  description: string
  userId: string | null
  systemRole: 'SUPER_ADMIN' | 'ADMIN' | 'COMPANY_ADMIN' | 'USER' | 'AUDITOR' | 'VIEWER'
  orgIdParam: string | null
  membership: ProviderSiloMembership | null
  permission: typeof Permission.PROVIDER_PORTAL_VIEW | typeof Permission.PROVIDER_PORTAL_UPLOAD
  expectedStatus: 200 | 400 | 401 | 403 | 404
  expectedErrorSubstring?: string
}

export interface ProviderXmlPayload {
  id: string
  finding: ProviderFinding
  description: string
  xml: string
  bytesOverride?: number
  expectedOk: boolean
  expectedErrorSubstring?: string
  reason: 'XXE_BILLION_LAUGHS' | 'OVERSIZED_2MB' | 'DTD_INLINE' | 'CLEAN' | 'MALFORMED' | 'EMPTY' | 'NUL_BYTES'
}

export interface ProviderZipTestCase {
  id: string
  finding: ProviderFinding
  description: string
  entriesCount: number
  compressedSize: number
  uncompressedSize: number
  ratioOverride?: number
  nameContainsSlip?: string
  expectedReject: boolean
  rejectReason: 'ENTRIES_LIMIT' | 'RATIO_LIMIT' | 'TOTAL_BYTES_LIMIT' | 'ZIP_SLIP' | 'NUL_NAME' | 'NON_XML' | 'EMPTY' | 'OK'
}

export interface ProviderSSRFCase {
  id: string
  finding: ProviderFinding
  description: string
  target: 'FACTRONICA_PAC' | 'SAT_CFDI'
  url: string
  expectedAllowed: boolean
  blockReason: 'INTERNAL_RANGE' | 'OUTSIDE_ALLOWLIST' | 'BAD_PROTOCOL' | 'INVALID_URL' | 'OK'
}

export interface ProviderAuditRedactCase {
  id: string
  finding: ProviderFinding
  description: string
  input: string
  expectHidden: string[]
  maxLength: number
}

export const SAST_SEED_ORGS = {
  ORG_A: { id: 'cmnntrppk000502gcp93ketfx', rfc: 'ODE8604257UA' },
  ORG_B: { id: 'cmipiwlqk000mvyvtc22tnlrb', rfc: 'QBB7223997V9' },
  ORG_C: { id: 'cmprovidersilocross000000a', rfc: 'CROSS123456XXX' },
  ORG_INVALID_SHORT: { id: 'cmshort001', rfc: 'XXX123456XXX' },
  ORG_INVALID_CHARS: { id: 'CM-INVALID-UPPERCASE-AND-DASH-123', rfc: 'YYY123456YYY' },
} as const

export const PROVIDER_USERS = {
  USER_PROVIDER_OK: { id: 'usr_provider_ok_001', systemRole: 'USER' as const, providerRfc: 'PRO123456XXX' },
  USER_NO_PROVIDER_RFC: { id: 'usr_no_rfc_002', systemRole: 'USER' as const, providerRfc: null },
  USER_VIEWER_NO_PERM: { id: 'usr_viewer_003', systemRole: 'USER' as const, providerRfc: 'PRO999999XXX' },
  USER_AUDITOR_PII: { id: 'usr_auditor_004', systemRole: 'USER' as const, providerRfc: 'AUD888888YYY' },
  USER_SUPER_ADMIN: { id: 'usr_sa_005', systemRole: 'SUPER_ADMIN' as const, providerRfc: 'SA777777ZZZ' },
  USER_CROSS_SILO: { id: 'usr_cross_006', systemRole: 'USER' as const, providerRfc: 'CRO666666AAA' },
}

export const PROVIDER_MEMBERSHIPS: ProviderSiloMembership[] = [
  {
    id: 'mb_prov_ok_org_a',
    userId: PROVIDER_USERS.USER_PROVIDER_OK.id,
    organizationId: SAST_SEED_ORGS.ORG_A.id,
    role: 'MEMBER',
    status: 'APPROVED',
    providerRfc: PROVIDER_USERS.USER_PROVIDER_OK.providerRfc,
    providerName: 'Proveedor Demo SA CV',
    granularPermissions: { 'provider:portal:view': true, 'provider:portal:upload': true },
  },
  {
    id: 'mb_no_rfc_org_a',
    userId: PROVIDER_USERS.USER_NO_PROVIDER_RFC.id,
    organizationId: SAST_SEED_ORGS.ORG_A.id,
    role: 'MEMBER',
    status: 'APPROVED',
    providerRfc: null,
    granularPermissions: { 'provider:portal:view': true },
  },
  {
    id: 'mb_viewer_org_b',
    userId: PROVIDER_USERS.USER_VIEWER_NO_PERM.id,
    organizationId: SAST_SEED_ORGS.ORG_B.id,
    role: 'VIEWER',
    status: 'APPROVED',
    providerRfc: PROVIDER_USERS.USER_VIEWER_NO_PERM.providerRfc,
    granularPermissions: { 'provider:portal:view': false },
  },
  {
    id: 'mb_cross_org_a',
    userId: PROVIDER_USERS.USER_CROSS_SILO.id,
    organizationId: SAST_SEED_ORGS.ORG_A.id,
    role: 'MEMBER',
    status: 'APPROVED',
    providerRfc: PROVIDER_USERS.USER_CROSS_SILO.providerRfc,
    granularPermissions: { 'provider:portal:view': true },
  },
]

export const ORG_ID_INVALID_CASES: Array<{ label: string; value: string | null | undefined; required: boolean; expectedStatus: 400 | 200 }> = [
  { label: 'null param required=true', value: null, required: true, expectedStatus: 400 },
  { label: 'vacío required=true', value: '', required: true, expectedStatus: 400 },
  { label: 'undefined required=true', value: undefined, required: true, expectedStatus: 400 },
  { label: 'corto 19 chars', value: 'cm1234567890123456789', required: true, expectedStatus: 400 },
  { label: 'uppercase inválido', value: 'CMNntrppk000502gcp93ketfx', required: true, expectedStatus: 400 },
  { label: 'con guión medio', value: 'cmnntrppk-00502gcp93ketfx', required: true, expectedStatus: 400 },
  { label: 'uuid con guiones ok (8-4-4-4-12)', value: '550e8400-e29b-41d4-a716-446655440000', required: true, expectedStatus: 200 },
  { label: 'cuid ORG_A 22 chars lowercase', value: SAST_SEED_ORGS.ORG_A.id, required: true, expectedStatus: 200 },
  { label: 'longitud 41 chars overflow', value: 'a'.repeat(41), required: true, expectedStatus: 400 },
]

export const DECIMAL_CASES: ProviderDecimalCase[] = [
  { input: '1,234,567.89', fieldRef: 'SubTotal', fileNameRef: 'FA01.xml', expected: 1234567.89, shouldThrow: false, description: 'US formato thousands comma + decimal dot', locale: 'US' },
  { input: '1.234.567,89', fieldRef: 'Total', fileNameRef: 'FA02.xml', expected: 1234567.89, shouldThrow: false, description: 'MX formato thousands dot + decimal comma', locale: 'MX' },
  { input: '123.45', fieldRef: 'Importe', fileNameRef: 'FA03.xml', expected: 123.45, shouldThrow: false, description: 'Decimal dot simple US', locale: 'US' },
  { input: '1,23', fieldRef: 'Descuento', fileNameRef: 'FA04.xml', expected: 1.23, shouldThrow: false, description: 'Decimal comma MX 2 decimales', locale: 'MX' },
  { input: '9.999.999,99', fieldRef: 'ImpPagado', fileNameRef: 'FA05.xml', expected: 9999999.99, shouldThrow: false, description: 'MX millones ImpPagado PPD', locale: 'MX' },
  { input: '0,00', fieldRef: 'IVA', fileNameRef: 'FA06.xml', expected: 0, shouldThrow: false, description: 'Cero MX comma', locale: 'MX' },
  { input: '0.00', fieldRef: 'IEPS', fileNameRef: 'FA07.xml', expected: 0, shouldThrow: false, description: 'Cero US dot', locale: 'US' },
  { input: '', fieldRef: 'Retencion', fileNameRef: 'FA08.xml', expected: 0, shouldThrow: false, description: 'String vacío → 0', locale: 'INVALID' },
  { input: '   ', fieldRef: 'Traslado', fileNameRef: 'FA09.xml', expected: 0, shouldThrow: false, description: 'Whitespace → 0', locale: 'INVALID' },
  { input: null, fieldRef: 'Otros', fileNameRef: 'FA10.xml', expected: 0, shouldThrow: false, description: 'null → 0', locale: 'INVALID' },
  { input: undefined, fieldRef: 'OtroMas', fileNameRef: 'FA11.xml', expected: 0, shouldThrow: false, description: 'undefined → 0', locale: 'INVALID' },
  { input: 'NaN', fieldRef: 'SubTotal', fileNameRef: 'FA12.xml', expected: -1, shouldThrow: true, throwSubstring: 'no es un numero decimal valido', description: 'NaN literal debe throw', locale: 'INVALID' },
  { input: 'Infinity', fieldRef: 'SubTotal', fileNameRef: 'FA13.xml', expected: -1, shouldThrow: true, throwSubstring: 'no es un numero decimal valido', description: 'Infinity literal debe throw', locale: 'INVALID' },
  { input: '1e15', fieldRef: 'Total', fileNameRef: 'FA14.xml', expected: -1, shouldThrow: true, throwSubstring: 'excede magnitud maxima permitida', description: '> 9.999T throw overflow magnitud', locale: 'INVALID' },
  { input: '9999999999999.99', fieldRef: 'Total', fileNameRef: 'FA15.xml', expected: -1, shouldThrow: true, throwSubstring: 'excede magnitud maxima permitida', description: '10T > 9.999T throw', locale: 'INVALID' },
  { input: '123\x00ABC', fieldRef: 'SubTotal', fileNameRef: 'FA16.xml', expected: -1, shouldThrow: true, throwSubstring: 'caracteres nulos prohibidos', description: 'NUL byte throw', locale: 'INVALID' },
  { input: '$$$$', fieldRef: 'Importe', fileNameRef: 'FA17.xml', expected: -1, shouldThrow: true, throwSubstring: 'no es un numero decimal valido', description: 'Símbolo $ solo throw', locale: 'INVALID' },
  { input: 'AAAAAAAAAAAAAAAAAAAAAAAAAA', fieldRef: 'IVA', fileNameRef: 'FA18.xml', expected: -1, shouldThrow: true, throwSubstring: 'excede longitud maxima permitida', description: 'Longitud > 25 throw', locale: 'INVALID' },
  { input: '-150.50', fieldRef: 'Total', fileNameRef: 'FA19.xml', expected: -150.5, shouldThrow: false, description: 'Negativo permitido (abonos)', locale: 'MIXED' },
  { input: '1,000,000.123456', fieldRef: 'SubTotal', fileNameRef: 'FA20.xml', expected: 1000000.123456, shouldThrow: false, description: 'US 6 decimales permitidos', locale: 'US' },
]

export const XXE_BILLION_LAUGHS = `<?xml version="1.0"?>
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

export const XXE_DTD_EXTERNAL_SSRF = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]><r>&xxe;</r>`

export const XXE_DTD_NOTATION_DECL = `<?xml version="1.0"?><!DOCTYPE r [<!NOTATION gif PUBLIC "image/gif">]><r/>`

export const XML_CLEAN_CFDI_VALIDO = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" SubTotal="1234.56" Total="1456.78" Moneda="MXN">
  <cfdi:Emisor Rfc="ODE8604257UA" Nombre="Cliente Demo SA CV" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="Publico General" RegimenFiscal="616"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" ClaveUnidad="ACT" Cantidad="1" Descripcion="Servicio Demo" ValorUnitario="1234.56" Importe="1234.56"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="222.22">
    <cfdi:Traslados><cfdi:Traslado Base="1234.56" Impuesto="002" TasaOCuota="0.180000" Importe="222.22"/></cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="AAAAAAAA-1111-2222-3333-444444444444" FechaTimbrado="2024-06-01T12:30:00" RfcProvCertif="PRO123456XXX" SelloCFD="xyz=" SelloSAT="abc="/>
  </cfdi:Complemento>
</cfdi:Comprobante>`

export const XML_PAYLOADS: ProviderXmlPayload[] = [
  { id: 'PROV-XXE-001', finding: 'PROV-002', description: 'Billion Laughs DTD inline → rechazado por regex DTD', xml: XXE_BILLION_LAUGHS, expectedOk: false, expectedErrorSubstring: 'declaraciones prohibidas', reason: 'XXE_BILLION_LAUGHS' },
  { id: 'PROV-XXE-002', finding: 'PROV-002', description: 'XXE SSRF external SYSTEM 169.254 metadata → DTD block', xml: XXE_DTD_EXTERNAL_SSRF, expectedOk: false, expectedErrorSubstring: 'declaraciones prohibidas', reason: 'DTD_INLINE' },
  { id: 'PROV-XXE-003', finding: 'PROV-002', description: 'NOTATION decl inline → DTD block', xml: XXE_DTD_NOTATION_DECL, expectedOk: false, expectedErrorSubstring: 'declaraciones prohibidas', reason: 'DTD_INLINE' },
  { id: 'PROV-XXE-004', finding: 'PROV-002', description: 'Oversized 3MB > 2MB → rechazado por bytes', xml: `<r>${'A'.repeat(3 * 1024 * 1024)}</r>`, expectedOk: false, expectedErrorSubstring: 'supera el maximo permitido', reason: 'OVERSIZED_2MB' },
  { id: 'PROV-XXE-005', finding: 'PROV-002', description: 'CFDI 4.0 válido sin DTD → ok=true', xml: XML_CLEAN_CFDI_VALIDO, expectedOk: true, reason: 'CLEAN' },
  { id: 'PROV-XXE-006', finding: 'PROV-002', description: 'XML vacío → ok=false', xml: '', expectedOk: false, expectedErrorSubstring: 'XML vacio', reason: 'EMPTY' },
  { id: 'PROV-XXE-007', finding: 'PROV-002', description: 'XML malformed sin cierre → ok=false', xml: '<?xml version="1.0"?><root><unclosed>', expectedOk: false, expectedErrorSubstring: 'parseo xml|fatal', reason: 'MALFORMED' },
  { id: 'PROV-XXE-008', finding: 'PROV-002', description: 'XML con NUL byte embebido → clean falla', xml: `<r>\x00data</r>`, expectedOk: false, expectedErrorSubstring: 'caracteres nulos prohibidos', reason: 'NUL_BYTES' },
]

export const ZIP_TEST_CASES: ProviderZipTestCase[] = [
  { id: 'PROV-ZIP-001', finding: 'PROV-003', description: 'ZIP entries 501 > 500 max → ENTRIES_LIMIT', entriesCount: 501, compressedSize: 1000, uncompressedSize: 100000, expectedReject: true, rejectReason: 'ENTRIES_LIMIT' },
  { id: 'PROV-ZIP-002', finding: 'PROV-003', description: 'ZIP entries 500 exacto → OK (borde)', entriesCount: 500, compressedSize: 1000, uncompressedSize: 500_000, expectedReject: false, rejectReason: 'OK' },
  { id: 'PROV-ZIP-003', finding: 'PROV-003', description: 'Ratio >103 → RATIO_LIMIT anti ZipBomb', entriesCount: 10, compressedSize: 100, uncompressedSize: 100 * 110, ratioOverride: 110, expectedReject: true, rejectReason: 'RATIO_LIMIT' },
  { id: 'PROV-ZIP-004', finding: 'PROV-003', description: 'Ratio 102 < 103 → OK borde ratio', entriesCount: 10, compressedSize: 100, uncompressedSize: 100 * 102, ratioOverride: 102, expectedReject: false, rejectReason: 'OK' },
  { id: 'PROV-ZIP-005', finding: 'PROV-003', description: 'Total decompressed 251MB > 250MB → TOTAL_BYTES_LIMIT', entriesCount: 5, compressedSize: 1000, uncompressedSize: 251 * 1024 * 1024, expectedReject: true, rejectReason: 'TOTAL_BYTES_LIMIT' },
  { id: 'PROV-ZIP-006', finding: 'PROV-003', description: 'Total decompressed 249MB < 250MB → OK borde', entriesCount: 5, compressedSize: 1000, uncompressedSize: 249 * 1024 * 1024, expectedReject: false, rejectReason: 'OK' },
  { id: 'PROV-ZIP-007', finding: 'PROV-003', description: 'ZIP entries=0 → EMPTY rechazado', entriesCount: 0, compressedSize: 0, uncompressedSize: 0, expectedReject: true, rejectReason: 'EMPTY' },
  { id: 'PROV-ZIP-008', finding: 'PROV-003', description: 'Nombre ../../../etc/passwd → ZIP_SLIP detectado', entriesCount: 1, compressedSize: 100, uncompressedSize: 1000, nameContainsSlip: '../../../../etc/passwd.xml', expectedReject: true, rejectReason: 'ZIP_SLIP' },
  { id: 'PROV-ZIP-009', finding: 'PROV-003', description: 'Nombre contiene NUL byte → NUL_NAME rechazado', entriesCount: 1, compressedSize: 100, uncompressedSize: 1000, expectedReject: true, rejectReason: 'NUL_NAME' },
  { id: 'PROV-ZIP-010', finding: 'PROV-003', description: 'Entry con .PDF no XML → NON_XML rechazado', entriesCount: 1, compressedSize: 100, uncompressedSize: 1000, expectedReject: true, rejectReason: 'NON_XML' },
  { id: 'PROV-ZIP-011', finding: 'PROV-003', description: '1 entry XML válido ratio bajo → OK', entriesCount: 1, compressedSize: 100, uncompressedSize: 1000, expectedReject: false, rejectReason: 'OK' },
  { id: 'PROV-ZIP-012', finding: 'PROV-003', description: 'Nombre separador Windows backslash → basename() strip', entriesCount: 1, compressedSize: 100, uncompressedSize: 1000, nameContainsSlip: 'folder\\sub\\invoice.xml', expectedReject: false, rejectReason: 'OK' },
]

export const SSRF_HOST_CASES: ProviderSSRFCase[] = [
  { id: 'PROV-SSRF-PAC-001', finding: 'PROV-009', description: 'PAC host pac2a.factronica.net → OK allowlist', target: 'FACTRONICA_PAC', url: 'https://pac2a.factronica.net/TimbraWS/RestApi/CfdiValida', expectedAllowed: true, blockReason: 'OK' },
  { id: 'PROV-SSRF-PAC-002', finding: 'PROV-009', description: 'PAC host pac.factronica.mx → OK allowlist', target: 'FACTRONICA_PAC', url: 'https://pac.factronica.mx/api', expectedAllowed: true, blockReason: 'OK' },
  { id: 'PROV-SSRF-PAC-003', finding: 'PROV-009', description: 'PAC host EVIL atacante.com → OUTSIDE_ALLOWLIST block', target: 'FACTRONICA_PAC', url: 'https://atacante.com/pac/TimbraWS', expectedAllowed: false, blockReason: 'OUTSIDE_ALLOWLIST' },
  { id: 'PROV-SSRF-PAC-004', finding: 'PROV-009', description: 'PAC IP privada 10.0.0.1 → INTERNAL_RANGE block', target: 'FACTRONICA_PAC', url: 'https://10.0.0.1/TimbraWS', expectedAllowed: false, blockReason: 'INTERNAL_RANGE' },
  { id: 'PROV-SSRF-PAC-005', finding: 'PROV-009', description: 'PAC IP metadata 169.254.169.254 → INTERNAL_RANGE block SSRF', target: 'FACTRONICA_PAC', url: 'http://169.254.169.254/latest/meta-data/', expectedAllowed: false, blockReason: 'INTERNAL_RANGE' },
  { id: 'PROV-SSRF-PAC-006', finding: 'PROV-009', description: 'PAC URL inválida sintaxis → INVALID_URL block', target: 'FACTRONICA_PAC', url: 'not-a-valid-url://!!', expectedAllowed: false, blockReason: 'INVALID_URL' },
  { id: 'PROV-SSRF-SAT-001', finding: 'PROV-009', description: 'SAT consultaqr.facturaelectronica.sat.gob.mx → OK allowlist', target: 'SAT_CFDI', url: 'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc', expectedAllowed: true, blockReason: 'OK' },
  { id: 'PROV-SSRF-SAT-002', finding: 'PROV-009', description: 'SAT omawwcf.siat.sat.gob.mx → OK allowlist', target: 'SAT_CFDI', url: 'https://omawwcf.siat.sat.gob.mx/Service.svc', expectedAllowed: true, blockReason: 'OK' },
  { id: 'PROV-SSRF-SAT-003', finding: 'PROV-009', description: 'SAT host EVIL sat.fake.gob.mx → OUTSIDE_ALLOWLIST block', target: 'SAT_CFDI', url: 'https://sat.fake.gob.mx/Consulta', expectedAllowed: false, blockReason: 'OUTSIDE_ALLOWLIST' },
  { id: 'PROV-SSRF-SAT-004', finding: 'PROV-009', description: 'SAT localhost 127.0.0.1 → INTERNAL_RANGE block SSRF', target: 'SAT_CFDI', url: 'https://127.0.0.1:8443/Consulta', expectedAllowed: false, blockReason: 'INTERNAL_RANGE' },
  { id: 'PROV-SSRF-SAT-005', finding: 'PROV-009', description: 'SAT 192.168.1.1 range privado → INTERNAL_RANGE block', target: 'SAT_CFDI', url: 'https://192.168.1.1/ConsultaCFDIService.svc', expectedAllowed: false, blockReason: 'INTERNAL_RANGE' },
  { id: 'PROV-SSRF-SAT-006', finding: 'PROV-009', description: 'SAT URL basura → INVALID_URL', target: 'SAT_CFDI', url: 'http://  spaces!!', expectedAllowed: false, blockReason: 'INVALID_URL' },
]

export const AUDIT_REDACT_CASES: ProviderAuditRedactCase[] = [
  { id: 'PROV-AUD-001', finding: 'PROV-008', description: 'Bearer JWT token → REDACTADO', input: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.secret rest of message', expectHidden: ['[REDACTED_BEARER'], maxLength: 200 },
  { id: 'PROV-AUD-002', finding: 'PROV-008', description: 'sk_ stripe-like secret key → REDACTADO', input: 'Secret: sk_live_abc123xyz789 was used in rejectedFiles field', expectHidden: ['[REDACTED_SK'], maxLength: 200 },
  { id: 'PROV-AUD-003', finding: 'PROV-008', description: 'Basic auth base64 → REDACTADO', input: 'Header: Basic dXNlcjpwYXNzd29yZA== rejected', expectHidden: ['[REDACTED_BASIC'], maxLength: 200 },
  { id: 'PROV-AUD-004', finding: 'PROV-008', description: 'password= en query → REDACTADO', input: 'User submitted data with password=SuperSecret123! and email=user@example.com', expectHidden: ['password=', '[REDACTED'], maxLength: 200 },
  { id: 'PROV-AUD-005', finding: 'PROV-008', description: 'SAS token azure → REDACTADO', input: 'sv=2020-08-04&ss=b&srt=sco&sp=rwdlacitfx&se=2030-01-01T00%3A00%3A00Z&sig=abcdef%2Bghi%3D', expectHidden: ['[REDACTED_SAS'], maxLength: 200 },
  { id: 'PROV-AUD-006', finding: 'PROV-008', description: 'token= parameter → REDACTADO', input: 'Callback rejected token=mytoken123abc state=xyz', expectHidden: ['token=', '[REDACTED'], maxLength: 200 },
  { id: 'PROV-AUD-007', finding: 'PROV-008', description: 'pk_ publishable key → REDACTADO', input: 'pk_test_1234567890abcdef was leaked', expectHidden: ['[REDACTED_PK'], maxLength: 200 },
]

export const RATE_LIMIT_BUCKETS = [
  { key: 'ctx_get_ip', name: 'GET context: IP bucket 60/60s', limit: 60, intervalMs: 60_000, expectedRetryAfterSec: 60 },
  { key: 'ctx_get_user', name: 'GET context: USER bucket 40/60s', limit: 40, intervalMs: 60_000, expectedRetryAfterSec: 90 },
  { key: 'ctx_get_org', name: 'GET context: ORG bucket 30/60s', limit: 30, intervalMs: 60_000, expectedRetryAfterSec: 120 },
  { key: 'upload_post_ip', name: 'POST upload: IP bucket 10/60s', limit: 10, intervalMs: 60_000, expectedRetryAfterSec: 360 },
  { key: 'upload_post_user', name: 'POST upload: USER bucket 6/60s', limit: 6, intervalMs: 60_000, expectedRetryAfterSec: 600 },
  { key: 'upload_post_org', name: 'POST upload: ORG bucket 4/60s', limit: 4, intervalMs: 60_000, expectedRetryAfterSec: 900 },
  { key: 'xml_pdf_ip', name: 'XML/PDF download: IP bucket 30/60s', limit: 30, intervalMs: 60_000, expectedRetryAfterSec: 120 },
  { key: 'xml_pdf_user', name: 'XML/PDF download: USER bucket 20/60s', limit: 20, intervalMs: 60_000, expectedRetryAfterSec: 180 },
  { key: 'xml_pdf_org', name: 'XML/PDF download: ORG bucket 15/60s', limit: 15, intervalMs: 60_000, expectedRetryAfterSec: 240 },
]

export const SECURITY_HEADERS_REQUIRED = [
  'Cache-Control',
  'Pragma',
  'Expires',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'X-Frame-Options',
]

export const STORAGE_KEY_VERSION_CASES = [
  { version: 'v2', expected: 'VALID' as const, description: 'v2 actual HKDF derivada' },
  { version: 'v1', expected: 'REJECTED' as const, description: 'v1 deprecada sin HKDF → throw downgrade' },
  { version: 'v0', expected: 'REJECTED' as const, description: 'v0 legacy raw → throw' },
  { version: 'v3', expected: 'REJECTED' as const, description: 'v3 desconocida → strict Set reject' },
  { version: '', expected: 'REJECTED' as const, description: 'vacío strict Set reject' },
  { version: 'V2', expected: 'REJECTED' as const, description: 'case-sensitive V2 ≠ v2 → reject' },
]

export const GATE_ACCESS_CASES: ProviderGateAccessCase[] = [
  { id: 'PROV-GATE-001', finding: 'PROV-001', description: 'orgId null required → 400', userId: PROVIDER_USERS.USER_PROVIDER_OK.id, systemRole: 'USER', orgIdParam: null, membership: PROVIDER_MEMBERSHIPS[0], permission: Permission.PROVIDER_PORTAL_VIEW, expectedStatus: 400, expectedErrorSubstring: 'orgId es requerido' },
  { id: 'PROV-GATE-002', finding: 'PROV-011', description: 'orgId chars inválidos → 400 formato', userId: PROVIDER_USERS.USER_PROVIDER_OK.id, systemRole: 'USER', orgIdParam: SAST_SEED_ORGS.ORG_INVALID_CHARS.id, membership: PROVIDER_MEMBERSHIPS[0], permission: Permission.PROVIDER_PORTAL_VIEW, expectedStatus: 400, expectedErrorSubstring: 'formato invalido' },
  { id: 'PROV-GATE-003', finding: 'PROV-001', description: 'userId null / sin sesión → 404 (no membership)', userId: null as unknown as string, systemRole: 'USER', orgIdParam: SAST_SEED_ORGS.ORG_A.id, membership: null, permission: Permission.PROVIDER_PORTAL_VIEW, expectedStatus: 404, expectedErrorSubstring: 'No se encontró la membresía' },
  { id: 'PROV-GATE-004', finding: 'PROV-011', description: 'Silo bypass: usuario ORG-A accede ORG-C sin membresía → 404', userId: PROVIDER_USERS.USER_CROSS_SILO.id, systemRole: 'USER', orgIdParam: SAST_SEED_ORGS.ORG_C.id, membership: PROVIDER_MEMBERSHIPS[3], permission: Permission.PROVIDER_PORTAL_VIEW, expectedStatus: 404, expectedErrorSubstring: 'No se encontró la membresía' },
  { id: 'PROV-GATE-005', finding: 'PROV-001', description: 'Membership sin providerRfc → 403 RFC faltante', userId: PROVIDER_USERS.USER_NO_PROVIDER_RFC.id, systemRole: 'USER', orgIdParam: SAST_SEED_ORGS.ORG_A.id, membership: PROVIDER_MEMBERSHIPS[1], permission: Permission.PROVIDER_PORTAL_VIEW, expectedStatus: 403, expectedErrorSubstring: 'RFC de proveedor' },
  { id: 'PROV-GATE-006', finding: 'PROV-001', description: 'VIEWER granularPermissions.view=false → 403 permiso faltante', userId: PROVIDER_USERS.USER_VIEWER_NO_PERM.id, systemRole: 'USER', orgIdParam: SAST_SEED_ORGS.ORG_B.id, membership: PROVIDER_MEMBERSHIPS[2], permission: Permission.PROVIDER_PORTAL_VIEW, expectedStatus: 403, expectedErrorSubstring: 'Permiso faltante' },
  { id: 'PROV-GATE-007', finding: 'PROV-001', description: 'MEMBER view=true + org match → 200 OK', userId: PROVIDER_USERS.USER_PROVIDER_OK.id, systemRole: 'USER', orgIdParam: SAST_SEED_ORGS.ORG_A.id, membership: PROVIDER_MEMBERSHIPS[0], permission: Permission.PROVIDER_PORTAL_VIEW, expectedStatus: 200 },
  { id: 'PROV-GATE-008', finding: 'PROV-001', description: 'MEMBER upload=true + org match → 200 OK', userId: PROVIDER_USERS.USER_PROVIDER_OK.id, systemRole: 'USER', orgIdParam: SAST_SEED_ORGS.ORG_A.id, membership: PROVIDER_MEMBERSHIPS[0], permission: Permission.PROVIDER_PORTAL_UPLOAD, expectedStatus: 200 },
]

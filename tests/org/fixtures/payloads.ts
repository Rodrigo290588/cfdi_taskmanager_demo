export type OrgFinding =
  | 'ORG-001'
  | 'ORG-002'
  | 'ORG-003'
  | 'ORG-004'
  | 'ORG-005'
  | 'ORG-006'
  | 'ORG-007'
  | 'ORG-008'
  | 'ORG-009'
  | 'ORG-010'

export type OrgSeverity = 'C' | 'A' | 'M' | 'B'

export interface OrgSiloMembership {
  id: string
  userId: string
  organizationId: string
  role: 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'AUDITOR' | 'VIEWER' | 'MEMBER'
  status: 'APPROVED' | 'PENDING' | 'REVOKED'
}

export interface OrgDecimalCase {
  input: string | null | undefined
  expected: number
  description: string
  locale: 'MX' | 'US' | 'MIXED' | 'INVALID'
}

export interface OrgGateAccessCase {
  id: string
  finding: OrgFinding
  description: string
  session: { userId: string; systemRole: string } | null
  orgIdParam: string | null
  hasPermission: boolean
  membershipStatus: 'APPROVED' | 'PENDING' | 'REVOKED' | 'NONE'
  expectedStatus: 200 | 400 | 401 | 403 | 404
  expectedErrorSubstring?: string
}

export interface OrgXmlPayload {
  id: string
  finding: OrgFinding
  description: string
  xml: string
  bytesOverride?: number
  expected: 'SKIP' | 'THROW' | 'SAFE_PARSE'
  reason: 'XXE_BILLION_LAUGHS' | 'OVERSIZED_2MB' | 'DTD_INLINE' | 'CLEAN' | 'MALFORMED'
}

export const SAST_SEED_ORGS = {
  ORG_A: { id: 'cmnntrppk000502gcp93ketfx', rfc: 'ODE8604257UA' },
  ORG_B: { id: 'cmipiwlqk000mvyvtc22tnlrb', rfc: 'QBB7223997V9' },
  ORG_INVALID_SHORT: { id: 'cmshort001', rfc: 'XXX123456XXX' },
  ORG_INVALID_CHARS: { id: 'CM-INVALID-UPPERCASE-AND-DASH-123', rfc: 'YYY123456YYY' },
} as const

export const USER_MULTI_MEMBER: { id: string; systemRole: 'USER' | 'ADMIN' | 'SUPER_ADMIN' } = {
  id: 'usr_multimember_001',
  systemRole: 'USER',
}

export const SILO_MEMBERSHIPS: OrgSiloMembership[] = [
  { id: 'mb_org_a_001', userId: USER_MULTI_MEMBER.id, organizationId: SAST_SEED_ORGS.ORG_A.id, role: 'ADMIN', status: 'APPROVED' },
  { id: 'mb_org_b_001', userId: USER_MULTI_MEMBER.id, organizationId: SAST_SEED_ORGS.ORG_B.id, role: 'ACCOUNTANT', status: 'APPROVED' },
]

export const USER_VIEWER_NO_PERM = { id: 'usr_viewer_no_perm_002', systemRole: 'USER' as const }
export const USER_AUDITOR_PII = { id: 'usr_auditor_pii_003', systemRole: 'USER' as const }

export const ORG_ID_INVALID_CASES: Array<{ label: string; value: string | null; expected: 'INVALID' }> = [
  { label: 'null param', value: null, expected: 'INVALID' },
  { label: 'vacío', value: '', expected: 'INVALID' },
  { label: 'corto 19 chars', value: 'cm1234567890123456789', expected: 'INVALID' },
  { label: 'uppercase inválido', value: 'CMNntrppk000502gcp93ketfx', expected: 'INVALID' },
  { label: 'con guión', value: 'cmnntrppk-00502gcp93ketfx', expected: 'INVALID' },
  { label: 'formato uuid no cm', value: '550e8400-e29b-41d4-a716-446655440000', expected: 'INVALID' },
]

export const DECIMAL_CASES: OrgDecimalCase[] = [
  { input: '$1,234,567.89 MXN', expected: 1234567.89, description: 'US formato + símbolo $ + sufijo MXN', locale: 'US' },
  { input: '1.234.567,89', expected: 1234567.89, description: 'MX formato thousands-dot decimal-coma sin símbolo', locale: 'MX' },
  { input: '123.45', expected: 123.45, description: 'Formato simple decimal dot US', locale: 'US' },
  { input: '1,23', expected: 1.23, description: 'Decimal comma MX 2 decimales', locale: 'MX' },
  { input: '9.999.999,99', expected: 9999999.99, description: 'MX formato millones ImpPagado PPD', locale: 'MX' },
  { input: '0,00', expected: 0, description: 'Cero MX comma decimal', locale: 'MX' },
  { input: '0.00', expected: 0, description: 'Cero US dot decimal', locale: 'US' },
  { input: 'ABC%%', expected: 0, description: 'Chars inválidos NaN fallback 0', locale: 'INVALID' },
  { input: null, expected: 0, description: 'null input → 0', locale: 'INVALID' },
  { input: '   ', expected: 0, description: 'whitespace → 0', locale: 'INVALID' },
  { input: '-150.50', expected: 0, description: 'Negativo ilegal (monto factura) → 0', locale: 'INVALID' },
  { input: '10000000000000', expected: 0, description: 'Overflow > 9.999 billones → 0', locale: 'INVALID' },
  { input: '1,234,567.8901', expected: 1234567.8901, description: 'US 4 decimales permitidos ≤ maxDecimals default 6', locale: 'US' },
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

export const XML_CLEAN_VALID_PAGO20 = `<?xml version="1.0" encoding="UTF-8"?>
<pago20:Pagos xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="2.0">
  <pago20:Pago FechaPago="2024-05-15T10:30:00" FormaDePagoP="03" MonedaP="MXN" Monto="15000.50" TipoCambioP="1">
    <pago20:DoctoRelacionado IdDocumento="UUID-PPD-0001" ImpPagado="9999999.99" />
    <pago20:DoctoRelacionado IdDocumento="UUID-PPD-0002" ImpPagado="1,234.56" />
  </pago20:Pago>
</pago20:Pagos>`

export const XML_PAYLOADS: OrgXmlPayload[] = [
  { id: 'ORG-PAY-XML-001', finding: 'ORG-002', description: 'Billion Laughs DTD inline debe SKIP por hasDtdInline', xml: XXE_BILLION_LAUGHS, expected: 'SKIP', reason: 'XXE_BILLION_LAUGHS' },
  { id: 'ORG-PAY-XML-002', finding: 'ORG-002', description: 'Oversized 3MB debe SKIP por MAX_XML_BYTES_DASHBOARD', xml: `<root>${'A'.repeat(3 * 1024 * 1024)}</root>`, bytesOverride: 3 * 1024 * 1024 + 1, expected: 'SKIP', reason: 'OVERSIZED_2MB' },
  { id: 'ORG-PAY-XML-003', finding: 'ORG-002', description: 'XML con DOCTYPE external SYSTEM (XXE SSRF CWE611) → skip hasDtdInline', xml: `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]><r>&xxe;</r>`, expected: 'SKIP', reason: 'DTD_INLINE' },
  { id: 'ORG-PAY-XML-004', finding: 'ORG-002', description: 'Pago20 namespace válido + ImpPagado MX decimal', xml: XML_CLEAN_VALID_PAGO20, expected: 'SAFE_PARSE', reason: 'CLEAN' },
]

export const GATE_ACCESS_CASES: OrgGateAccessCase[] = [
  { id: 'ORG-PAY-GATE-001', finding: 'ORG-001', description: 'Sesión null → 401 No autorizado', session: null, orgIdParam: SAST_SEED_ORGS.ORG_A.id, hasPermission: true, membershipStatus: 'APPROVED', expectedStatus: 401, expectedErrorSubstring: 'No autorizado' },
  { id: 'ORG-PAY-GATE-002', finding: 'ORG-001', description: 'VIEWER role sin DASHBOARD_FISCAL_VIEW → 403', session: { userId: USER_VIEWER_NO_PERM.id, systemRole: USER_VIEWER_NO_PERM.systemRole }, orgIdParam: SAST_SEED_ORGS.ORG_A.id, hasPermission: false, membershipStatus: 'APPROVED', expectedStatus: 403, expectedErrorSubstring: 'Permiso faltante' },
  { id: 'ORG-PAY-GATE-003', finding: 'ORG-003', description: 'orgId param null → 400 inválido', session: { userId: USER_AUDITOR_PII.id, systemRole: USER_AUDITOR_PII.systemRole }, orgIdParam: null, hasPermission: true, membershipStatus: 'APPROVED', expectedStatus: 400, expectedErrorSubstring: 'organizationId' },
  { id: 'ORG-PAY-GATE-004', finding: 'ORG-003', description: 'orgId param formato inválido chars → 400', session: { userId: USER_AUDITOR_PII.id, systemRole: USER_AUDITOR_PII.systemRole }, orgIdParam: SAST_SEED_ORGS.ORG_INVALID_CHARS.id, hasPermission: true, membershipStatus: 'APPROVED', expectedStatus: 400, expectedErrorSubstring: 'formato inválido' },
  { id: 'ORG-PAY-GATE-005', finding: 'ORG-001', description: 'Membership status PENDING (no APPROVED) → 403', session: { userId: USER_VIEWER_NO_PERM.id, systemRole: USER_VIEWER_NO_PERM.systemRole }, orgIdParam: SAST_SEED_ORGS.ORG_A.id, hasPermission: true, membershipStatus: 'PENDING', expectedStatus: 403 },
  { id: 'ORG-PAY-GATE-006', finding: 'ORG-003', description: 'Silos bypass: usuario pertenece ORG-A, solicita ORG-B sin membresía → 403', session: { userId: USER_MULTI_MEMBER.id, systemRole: USER_MULTI_MEMBER.systemRole }, orgIdParam: 'cmzzzzzzzzzzzzzzzzzzzzzz', hasPermission: true, membershipStatus: 'NONE', expectedStatus: 403 },
]

export const TOP_CLIENTS_FIXTURE: Array<{ receiverRfc: string | null; receiverName: string | null }> = [
  { receiverRfc: 'GUTJ850315XXX', receiverName: 'JUAN GUTIERREZ LOPEZ' },
  { receiverRfc: 'RODR800101YYY', receiverName: 'RODRIGUEZ Y ASOCIADOS SC' },
  { receiverRfc: 'HERM770505ZZZ', receiverName: 'HERNANDEZ MANUFACTURAS SA DE CV' },
  { receiverRfc: null, receiverName: null },
]

export const RATE_LIMIT_BUCKETS: { key: string; name: string; limit: number; interval: 60000; expectedErrorCode: string }[] = [
  { key: 'ip', name: 'IP bucket 60/min', limit: 60, interval: 60000, expectedErrorCode: 'rate_limited_ip_60_per_min' },
  { key: 'user', name: 'USER bucket 30/min', limit: 30, interval: 60000, expectedErrorCode: 'rate_limited_user_30_per_min' },
  { key: 'org', name: 'ORG bucket 180/min', limit: 180, interval: 60000, expectedErrorCode: 'rate_limited_org_180_per_min' },
]

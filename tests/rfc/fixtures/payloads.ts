export type RfcFindingId =
  | 'RFC-001' | 'RFC-002' | 'RFC-003' | 'RFC-004' | 'RFC-005'
  | 'RFC-006' | 'RFC-007' | 'RFC-008' | 'RFC-009' | 'RFC-010'
  | 'RFC-011' | 'RFC-012'

export type RfcSeverity = 'C' | 'A' | 'M' | 'B'

export const RFC_SECURITY_HEADERS_REQUIRED: ReadonlyArray<[string, string | RegExp]> = Object.freeze([
  ['Cache-Control', /private|no-store|no-cache/],
  ['Pragma', /^no-cache$/i],
  ['Expires', /^0$/],
  ['X-Content-Type-Options', /nosniff/],
  ['Referrer-Policy', /no-referrer/],
  ['Permissions-Policy', /camera=\(\)/],
])

export const RFC_POST_RATE_TRIPLE: ReadonlyArray<{ id: string; finding: RfcFindingId; key: string; limit: number; intervalMs: number }> = Object.freeze([
  { id: 'RFC-RATE-001', finding: 'RFC-003', key: 'rfc_post_ip',   limit: 30, intervalMs: 60_000 },
  { id: 'RFC-RATE-002', finding: 'RFC-003', key: 'rfc_post_user', limit: 20, intervalMs: 60_000 },
  { id: 'RFC-RATE-003', finding: 'RFC-003', key: 'rfc_post_org',  limit: 15, intervalMs: 60_000 },
  { id: 'RFC-RATE-004', finding: 'RFC-003', key: 'rfc_get_ip',    limit: 20, intervalMs: 60_000 },
  { id: 'RFC-RATE-005', finding: 'RFC-003', key: 'rfc_get_user',  limit: 15, intervalMs: 60_000 },
  { id: 'RFC-RATE-006', finding: 'RFC-003', key: 'rfc_get_org',   limit: 10, intervalMs: 60_000 },
])

export const RFC_VALID_POSITIVES_PERSON = Object.freeze([
  { id: 'RFC-VALID-P1', rfc: 'ODEM8604257UA', type: 'person' as const, expectedCv: null as string | null, fecha: '1986-04-25', nombre: 'Juan Pérez' },
  { id: 'RFC-VALID-P2', rfc: 'MELM8305281H0', type: 'person' as const, expectedCv: null as string | null, fecha: '1983-05-28', nombre: 'María Elena López' },
  { id: 'RFC-VALID-P3', rfc: 'GOGJ911217S42', type: 'person' as const, expectedCv: null as string | null, fecha: '1991-12-17', nombre: 'José Gómez Juárez' },
  { id: 'RFC-VALID-P4', rfc: 'CARC750310G87', type: 'person' as const, expectedCv: null as string | null, fecha: '1975-03-10', nombre: 'Carlos Romero Castañeda' },
  { id: 'RFC-VALID-P5', rfc: 'ÑAÑE880120AAA', type: 'person' as const, expectedCv: null as string | null, fecha: '1988-01-20', nombre: 'Elías Ñañez Ñandú' },
] as const)

export const RFC_VALID_POSITIVES_COMPANY = Object.freeze([
  { id: 'RFC-VALID-M1', rfc: 'ABC9202018X1', type: 'company' as const, fecha: '1992-02-01', nombre: 'ABC Sociedad Anónima' },
  { id: 'RFC-VALID-M2', rfc: 'FEM7509183A2', type: 'company' as const, fecha: '1975-09-18', nombre: 'FEMSA Controladora' },
  { id: 'RFC-VALID-M3', rfc: 'WMT970528P80', type: 'company' as const, fecha: '1997-05-28', nombre: 'Walmart de México' },
  { id: 'RFC-VALID-M4', rfc: 'VAP941015JN1', type: 'company' as const, fecha: '1994-10-15', nombre: 'Grupo VIP A' },
  { id: 'RFC-VALID-M5', rfc: 'BBV850101F23', type: 'company' as const, fecha: '1985-01-01', nombre: 'BBVA México' },
] as const)

export const RFC_INVALID_FORMAT_CASES: ReadonlyArray<{ id: string; rfc: string; expectedErrorSubstring: string | RegExp }> = Object.freeze([
  { id: 'RFC-INV-001', rfc: '',                                       expectedErrorSubstring: /requerido|caracteres/ },
  { id: 'RFC-INV-002', rfc: 'A',                                      expectedErrorSubstring: /caracteres/ },
  { id: 'RFC-INV-003', rfc: 'ABC',                                    expectedErrorSubstring: /caracteres|inválido/ },
  { id: 'RFC-INV-004', rfc: 'ABCDEFGHIJKLMN',                         expectedErrorSubstring: /caracteres|excede/ },
  { id: 'RFC-INV-005', rfc: '123456789012',                           expectedErrorSubstring: /inválido|formato/ },
  { id: 'RFC-INV-006', rfc: 'ODE_8604257UA',                          expectedErrorSubstring: /inválido|formato/ },
  { id: 'RFC-INV-007', rfc: 'O-D-E-86042-5-7UA',                      expectedErrorSubstring: /caracteres|inválido|formato|excede/ },
  { id: 'RFC-INV-008', rfc: 'ode*8604257ua',                          expectedErrorSubstring: /inválido|formato|regex/ },
  { id: 'RFC-INV-009', rfc: '<IMG SRC=X ONERROR=alert(1)>'.slice(0,13),expectedErrorSubstring: /inválido|formato/ },
  { id: 'RFC-INV-010', rfc: 'AAA999999AAA'.replace('A', 'A'.repeat(5)), expectedErrorSubstring: /caracteres/ },
])

export const RFC_INVALID_DATE_CASES: ReadonlyArray<{ id: string; rfc: string; expectedDateError: string | RegExp }> = Object.freeze([
  { id: 'RFC-DATE-001', rfc: 'ODE000000AAA', expectedDateError: /rango 1900/ },
  { id: 'RFC-DATE-002', rfc: 'ODE999999AAA', expectedDateError: /año/i },
  { id: 'RFC-DATE-003', rfc: 'ABC000001AAA', expectedDateError: /mes|rfc fuera de rango 1900/ },
  { id: 'RFC-DATE-004', rfc: 'ODE861325AAA', expectedDateError: /mes/ },
  { id: 'RFC-DATE-005', rfc: 'ODE860230AAA', expectedDateError: /29 días|febrero/i },
  { id: 'RFC-DATE-006', rfc: 'ODE010229AAA', expectedDateError: /bisiesto|febrero/i },
  { id: 'RFC-DATE-007', rfc: 'ODE860432AAA', expectedDateError: /día|rfc fuera de rango/ },
  { id: 'RFC-DATE-008', rfc: 'ODE860015AAA', expectedDateError: /mes/ },
  { id: 'RFC-DATE-009', rfc: 'ODE871131AAA', expectedDateError: /día 31 nov/ },
])

export const RFC_FORBIDDEN_WORDS_CASES: ReadonlyArray<{ id: string; letters: string; rfcCandidate: string }> = Object.freeze([
  { id: 'RFC-FORB-001', letters: 'PUTO', rfcCandidate: 'PUTO860425AAA' },
  { id: 'RFC-FORB-002', letters: 'CACA', rfcCandidate: 'CACA860425AAA' },
  { id: 'RFC-FORB-003', letters: 'COJO', rfcCandidate: 'COJO860425AAA' },
  { id: 'RFC-FORB-004', letters: 'KULO', rfcCandidate: 'KULO860425ABC' },
  { id: 'RFC-FORB-005', letters: 'PEDO', rfcCandidate: 'PEDO860425A21' },
  { id: 'RFC-FORB-006', letters: 'RATA', rfcCandidate: 'RATA860425A21' },
  { id: 'RFC-FORB-007', letters: 'GUEY', rfcCandidate: 'GUEY860425A21' },
])

export const RFC_REDOS_LENGTH_CASES: ReadonlyArray<{ id: string; rfc: string }> = Object.freeze(
  Array.from({ length: 8 }).map((_, i) => ({
    id: `RFC-REDOS-${i + 1}`,
    rfc: 'A'.repeat(20 + i * 100),
  }))
)

export const RFC_XSS_UNSAFE_CASES: ReadonlyArray<{ id: string; unsafe: string; expectedEscapedPattern: RegExp }> = Object.freeze([
  { id: 'RFC-XSS-001', unsafe: '<script>alert(1)</script>',         expectedEscapedPattern: /&lt;script&gt;/ },
  { id: 'RFC-XSS-002', unsafe: '<img src=x onerror=alert(1)>',       expectedEscapedPattern: /&lt;img/ },
  { id: 'RFC-XSS-003', unsafe: '"><b>bold"',                          expectedEscapedPattern: /&quot;&gt;&lt;b&gt;/ },
  { id: 'RFC-XSS-004', unsafe: "' onclick='alert(1)'",                expectedEscapedPattern: /&#39; onclick=/ },
  { id: 'RFC-XSS-005', unsafe: '`onload=alert(1)`',                   expectedEscapedPattern: /&#96;onload=/ },
  { id: 'RFC-XSS-006', unsafe: 'A&X&B<C>D"\'`E',                      expectedEscapedPattern: /A&amp;X&amp;B&lt;C&gt;D&quot;&#39;&#96;E/ },
  { id: 'RFC-XSS-007', unsafe: '\x00\x01\x02CONTROL\x7F<>',          expectedEscapedPattern: /\ufffd/ },
])

export const RFC_SAFE_VALIDATE_INPUT_CASES: ReadonlyArray<{
  id: string
  input: unknown
  expectedHttpStatus: 200 | 400 | 413 | 422
  expectedErrorSubstring?: string | RegExp
  expectedRfcNormalized?: string
}> = Object.freeze([
  { id: 'RFC-INP-001', input: null,                                       expectedHttpStatus: 400, expectedErrorSubstring: /vacío|vacio/ },
  { id: 'RFC-INP-002', input: undefined,                                  expectedHttpStatus: 400, expectedErrorSubstring: /vacío|vacio/ },
  { id: 'RFC-INP-003', input: 12345,                                      expectedHttpStatus: 400 },
  { id: 'RFC-INP-004', input: { rfc: null },                              expectedHttpStatus: 400 },
  { id: 'RFC-INP-005', input: { rfc: 123 },                               expectedHttpStatus: 400 },
  { id: 'RFC-INP-006', input: { rfc: 'ode8604257ua' },                   expectedHttpStatus: 200, expectedRfcNormalized: 'ODE8604257UA' },
  { id: 'RFC-INP-007', input: { rfc: '  ODE8604257UA  ' },               expectedHttpStatus: 200, expectedRfcNormalized: 'ODE8604257UA' },
  { id: 'RFC-INP-008', input: 'ABC9202018X1',                            expectedHttpStatus: 200, expectedRfcNormalized: 'ABC9202018X1' },
  { id: 'RFC-INP-009', input: { rfc: 'A'.repeat(2048) },                 expectedHttpStatus: 413, expectedErrorSubstring: /tamaño maximo|excede|1024 bytes/i },
  { id: 'RFC-INP-010', input: { rfc: '<IMG SRC=x>' },                    expectedHttpStatus: 400, expectedErrorSubstring: /inválido|formato|regex/ },
])

export const RFC_ALLOWED_ORIGINS: ReadonlyArray<{ origin: string; isAllowed: boolean; description: string }> = Object.freeze([
  { origin: 'https://app.platfi.mx',               isAllowed: true,  description: 'App URL principal producción' },
  { origin: 'https://admin.platfi.mx',             isAllowed: true,  description: 'Admin URL producción' },
  { origin: 'http://localhost:3000',                isAllowed: true,  description: 'Dev local URL' },
  { origin: 'https://evil-rfc-hack.xyz',            isAllowed: false, description: 'Origen atacante malicioso debe fallar → originResolved=null' },
  { origin: 'https://192.168.1.10:8443',           isAllowed: false, description: 'RFC-012 rango privado 192.168/16 → null origin' },
  { origin: 'https://cfdi-platfi.prod.internal',   isAllowed: false, description: 'Internal TLD → null origin' },
])

export const RFC_VERIFICATION_DIGIT_TEST_VECTORS: ReadonlyArray<{
  id: string
  rfc12: string
  /** Valor calculado esperado (algoritmo SAT DOF). Si null, se compara con output estable: 0-9 o "A" */
  expectedDigitMatchPattern?: RegExp
}> = Object.freeze([
  { id: 'RFC-CV-001', rfc12: 'ODE8604257U', expectedDigitMatchPattern: /^[0-9A]$/ },
  { id: 'RFC-CV-002', rfc12: 'MELM8305281', expectedDigitMatchPattern: /^[0-9A]$/ },
  { id: 'RFC-CV-003', rfc12: 'ABC9202018X', expectedDigitMatchPattern: /^[0-9A]$/ },
  { id: 'RFC-CV-004', rfc12: 'ÑAÑE880120A', expectedDigitMatchPattern: /^[0-9A]$/ },
  { id: 'RFC-CV-005', rfc12: 'BBV850101F2', expectedDigitMatchPattern: /^[0-9A]$/ },
  { id: 'RFC-CV-006', rfc12: 'AAAAAAAAAAAAAAAA', expectedDigitMatchPattern: /^0$/ },
  { id: 'RFC-CV-007', rfc12: '000000000000', expectedDigitMatchPattern: /^0$/ },
])

export type RfcPermissionRoleMatrixRow =
  | 'SUPER_ADMIN' | 'ADMIN' | 'COMPANY_ADMIN' | 'USER' | 'AUDITOR' | 'VIEWER' | 'ORG_ROLE_ADMIN' | 'ORG_ROLE_AUDITOR'

export const RFC_PERMISSION_ROLE_MATRIX: ReadonlyArray<{
  role: RfcPermissionRoleMatrixRow
  expectedHasPermission: boolean
  testId: string
}> = Object.freeze([
  { role: 'SUPER_ADMIN',     expectedHasPermission: true,  testId: 'RFC-PERM-SUPER-01' },
  { role: 'ADMIN',           expectedHasPermission: true,  testId: 'RFC-PERM-ADMIN-01' },
  { role: 'COMPANY_ADMIN',   expectedHasPermission: true,  testId: 'RFC-PERM-COMP-01' },
  { role: 'USER',            expectedHasPermission: true,  testId: 'RFC-PERM-USER-01' },
  { role: 'AUDITOR',         expectedHasPermission: false, testId: 'RFC-PERM-AUDITOR-DENY' },
  { role: 'VIEWER',          expectedHasPermission: false, testId: 'RFC-PERM-VIEWER-DENY' },
  { role: 'ORG_ROLE_ADMIN',  expectedHasPermission: true,  testId: 'RFC-PERM-ORGADMIN-01' },
  { role: 'ORG_ROLE_AUDITOR',expectedHasPermission: false, testId: 'RFC-PERM-ORGAUDITOR-DENY' },
])

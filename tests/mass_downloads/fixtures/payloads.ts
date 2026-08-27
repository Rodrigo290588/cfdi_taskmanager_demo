export const MD_FIXTURE_ORGS = {
  ORG_A_ID: 'cmnntrppk000502gcp93ketfx',
  ORG_B_ID: 'cmipiwlqk000mvyvtc22tnlrb',
  RFC_ORG_A: 'ODE8604257UA',
  RFC_ORG_B: 'QBB7223997V9',
  USER_ATTACKER_ORG_B_EMAIL: 'other-sast@itcomplements.com',
  USER_ATTACKER_PASSWORD: 'Externo-123!',
  COMPANY_ORG_A: 'cmpORG000000000000000001',
  COMPANY_ORG_B: 'cmpORG000000000000000002',
} as const

type MdPayload = { id: string; title: string; category: 'auth'|'bola'|'zod'|'rate'|'csv'|'crypto'|'dos'|'logs'|'split'|'queue' } & (
  | { kind: 'fc_get'; urlQuery: Record<string, string>; expect: { auth?: boolean; crossOrgBola?: boolean; nplus1?: boolean } }
  | { kind: 'fc_export_get'; urlQuery: Record<string, string>; expect: { ddePayload?: boolean; filenameInjection?: boolean } }
  | { kind: 'pkg_downloads_get'; urlQuery: Record<string, string>; expect: { bola?: boolean; splitFilename?: boolean } }
  | { kind: 'requests_post'; jsonBody: Record<string, unknown>; expect: { overpost?: boolean; rateBypass?: boolean; synchandler?: boolean } }
  | { kind: 'requests_get'; urlQuery: Record<string, string>; expect: { emptyScope?: boolean; crossOrg?: boolean } }
  | { kind: 'credentials_post'; formFields: Record<string, string>; expect: { rateBypass?: boolean; extBypass?: boolean; ipXFF?: string | boolean } }
  | { kind: 'crypto_enc'; params: { algorithm: string; ivHexLength?: number; authTagHex?: string; keyLength?: number; envKeyEmpty?: boolean }; expect: { allowed?: boolean; failClosed?: boolean } }
  | { kind: 'queue_config'; env: Record<string,string>; expect: { portNaN?: boolean; urlMalformed?: boolean; passwordRequired?: boolean } }
)

export const PAYLOADS: MdPayload[] = [
  // AUTH MD-001
  { id: 'MD-PAY-001', title: 'MD-001 Anon FC: no session', category: 'auth', kind: 'fc_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A }, expect: { auth: false } },
  { id: 'MD-PAY-002', title: 'MD-001 Anon FC/export: no session', category: 'auth', kind: 'fc_export_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A }, expect: {} },
  { id: 'MD-PAY-003', title: 'MD-002 /package-downloads anon', category: 'auth', kind: 'pkg_downloads_get', urlQuery: { rfc: MD_FIXTURE_ORGS.RFC_ORG_A, idPaquete: 'SAT_PACKAGE_ID_A' }, expect: {} },
  { id: 'MD-PAY-004', title: 'MD-003 /requests POST anon', category: 'auth', kind: 'requests_post', jsonBody: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, requestingRfc: MD_FIXTURE_ORGS.RFC_ORG_A, startDate: '2025-01-01', endDate: '2025-01-31', requestType: 'metadata', retrievalType: 'emitidos' }, expect: { synchandler: true } },
  // BOLA MD-001/002/006
  { id: 'MD-PAY-010', title: 'MD-006 BOLA cross-org companyId', category: 'bola', kind: 'fc_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_B, year: '2025', month: '1' }, expect: { crossOrgBola: true } },
  { id: 'MD-PAY-011', title: 'MD-002 BOLA rfc ORG_B via package-downloads', category: 'bola', kind: 'pkg_downloads_get', urlQuery: { rfc: MD_FIXTURE_ORGS.RFC_ORG_B, idPaquete: 'PKG_ORG_B_0001' }, expect: { bola: true } },
  { id: 'MD-PAY-012', title: 'MD-009 /requests GET sin scope = all tenants 100 rows', category: 'bola', kind: 'requests_get', urlQuery: {}, expect: { emptyScope: true } },
  // ZOD MD-003 strict / overpost
  { id: 'MD-PAY-020', title: 'MD-003 overpost prototype pollution', category: 'zod', kind: 'requests_post', jsonBody: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, requestingRfc: MD_FIXTURE_ORGS.RFC_ORG_A, startDate: '2025-01-01', endDate: '2025-01-31', requestType: 'cfdi', retrievalType: 'emitidos', '__proto__': { polluted: 1 }, 'constructor.prototype.polluted2': 1 }, expect: { overpost: true } },
  { id: 'MD-PAY-021', title: 'MD-003 requestingRfc formato invalido XSS', category: 'zod', kind: 'requests_post', jsonBody: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, requestingRfc: '<img src=x onerror=alert(1)>', startDate: '2025-01-01', endDate: '2025-01-31', requestType: 'metadata', retrievalType: 'emitidos' }, expect: {} },
  { id: 'MD-PAY-022', title: 'MD-009 columnFilter inval unknown col', category: 'zod', kind: 'fc_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, 'filter_xxxUnknownColumnContainsPassword': 'plain' }, expect: {} },
  // RATE MD-004
  { id: 'MD-PAY-030', title: 'MD-004 rate-limit sin await bypass 100', category: 'rate', kind: 'credentials_post', formFields: { organizationId: MD_FIXTURE_ORGS.ORG_A_ID, rfc: MD_FIXTURE_ORGS.RFC_ORG_A, password: 'x' }, expect: { rateBypass: true } },
  // CSV Injection MD-005
  { id: 'MD-PAY-040', title: 'MD-005 DDE =1+1 cmd \' -2+3+cmd /c calc\'!A0', category: 'csv', kind: 'fc_export_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A }, expect: { ddePayload: true } },
  { id: 'MD-PAY-041', title: 'MD-005 DDE @SUM(1,2) inicio celda', category: 'csv', kind: 'fc_export_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, filter_issuerName: '@SUM(1,2)' }, expect: {} },
  { id: 'MD-PAY-042', title: 'MD-005 DDE +IMAGE (Lotus) formula start', category: 'csv', kind: 'fc_export_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, filter_receiverName: '+1+2' }, expect: {} },
  // CRYPTO MD-007
  { id: 'MD-PAY-050', title: 'MD-007 algorithm aes-128-ecb no permitido', category: 'crypto', kind: 'crypto_enc', params: { algorithm: 'aes-128-ecb' }, expect: { allowed: false } },
  { id: 'MD-PAY-051', title: 'MD-007 IV 6 hex no 32 (3 bytes en lugar 16)', category: 'crypto', kind: 'crypto_enc', params: { algorithm: 'aes-256-gcm', ivHexLength: 6 }, expect: { failClosed: true } },
  { id: 'MD-PAY-052', title: 'MD-007 env DATA_ENCRYPTION_KEY missing prod', category: 'crypto', kind: 'crypto_enc', params: { algorithm: 'aes-256-gcm', envKeyEmpty: true }, expect: { failClosed: true } },
  { id: 'MD-PAY-053', title: 'MD-007 Key longitud < 32 chars passphrase 123', category: 'crypto', kind: 'crypto_enc', params: { algorithm: 'aes-256-gcm', keyLength: 16 }, expect: { failClosed: true } },
  // DOS N+1 MD-008, pageSize
  { id: 'MD-PAY-060', title: 'MD-008 N+1 rowsWithXml pageSize=200', category: 'dos', kind: 'fc_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, page: '1', pageSize: '200' }, expect: { nplus1: true } },
  { id: 'MD-PAY-061', title: 'MD-009 pageSize 1e+300 (isFinite pero NaN luego)', category: 'dos', kind: 'fc_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, pageSize: '1e300' }, expect: {} },
  // LOGS PII MD-010
  { id: 'MD-PAY-070', title: 'MD-010 500 details leak SAT IP outbound', category: 'logs', kind: 'requests_post', jsonBody: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, requestingRfc: MD_FIXTURE_ORGS.RFC_ORG_A, startDate: '2099-01-01', endDate: '2099-01-31', requestType: 'cfdi', retrievalType: 'emitidos' }, expect: {} },
  // Splitting MD-011
  { id: 'MD-PAY-080', title: 'MD-011 idPaquete CRLF Set-Cookie split', category: 'split', kind: 'pkg_downloads_get', urlQuery: { rfc: MD_FIXTURE_ORGS.RFC_ORG_A, idPaquete: 'PKG_%0d%0aSet-Cookie:session=evil;HttpOnly' }, expect: { splitFilename: true } },
  // Queue MD-013
  { id: 'MD-PAY-090', title: 'MD-013 REDIS_PORT="" => NaN => 6379 default sin password', category: 'queue', kind: 'queue_config', env: { REDIS_PORT: '', REDIS_PASSWORD: '' }, expect: { portNaN: true, passwordRequired: true } },
  { id: 'MD-PAY-091', title: 'MD-013 REDIS_URL="malformed not redis://"', category: 'queue', kind: 'queue_config', env: { REDIS_URL: 'http://user:pwd@host:1234' }, expect: { urlMalformed: true } },
  // Audit MD-014 XFF
  { id: 'MD-PAY-100', title: 'MD-014 XFF raw spoof multi-proxy "<script>"', category: 'logs', kind: 'credentials_post', formFields: { organizationId: MD_FIXTURE_ORGS.ORG_A_ID, rfc: MD_FIXTURE_ORGS.RFC_ORG_A, password: 'pw' }, expect: { ipXFF: true } },
  // Misc variants
  { id: 'MD-PAY-101', title: 'MD-011 idPaquete zip traversal inside ../../', category: 'split', kind: 'pkg_downloads_get', urlQuery: { rfc: MD_FIXTURE_ORGS.RFC_ORG_A, idPaquete: '../../Windows/System32/drivers/etc/hosts%00.zip' }, expect: { splitFilename: true } },
  { id: 'MD-PAY-102', title: 'MD-006 companyId UUID formato RFC inject', category: 'bola', kind: 'fc_export_get', urlQuery: { companyId: 'x\'; DROP TABLE sat_metadata; --' }, expect: {} },
  { id: 'MD-PAY-103', title: 'MD-012 SAT sync 90s request handler bloqueante', category: 'dos', kind: 'requests_post', jsonBody: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, requestingRfc: MD_FIXTURE_ORGS.RFC_ORG_A, startDate: '2010-01-01', endDate: '2030-12-31', requestType: 'cfdi', retrievalType: 'recibidos' }, expect: { synchandler: true } },
  { id: 'MD-PAY-104', title: 'MD-005 CSV filename inject CRLF header', category: 'csv', kind: 'fc_export_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, rfc: MD_FIXTURE_ORGS.RFC_ORG_A + '%0d%0aX-Injected: 1' }, expect: { filenameInjection: true } },
  { id: 'MD-PAY-105', title: 'MD-008 xmlContent leak en rows paginado 50 rows', category: 'dos', kind: 'fc_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, pageSize: '50' }, expect: { nplus1: true } },
  { id: 'MD-PAY-106', title: 'MD-009 requests?rfc=XAXX010101000 cross leak tenant', category: 'bola', kind: 'requests_get', urlQuery: { rfc: 'XAXX010101000' }, expect: { crossOrg: true } },
  { id: 'MD-PAY-107', title: 'MD-007 authTag 0 bytes empty AEAD no auth', category: 'crypto', kind: 'crypto_enc', params: { algorithm: 'aes-256-gcm', authTagHex: '' }, expect: { failClosed: true } },
  { id: 'MD-PAY-108', title: 'MD-004 max 1000 POST credenciales 8KB archivo', category: 'rate', kind: 'credentials_post', formFields: { organizationId: MD_FIXTURE_ORGS.ORG_A_ID, rfc: 'XAXX0101000', password: 'a'.repeat(256) }, expect: {} },
  { id: 'MD-PAY-109', title: 'MD-013 REDIS_HOST external untrusted', category: 'queue', kind: 'queue_config', env: { REDIS_HOST: 'attacker.com', REDIS_PORT: '6379', REDIS_PASSWORD: '' }, expect: { passwordRequired: true } },
  { id: 'MD-PAY-110', title: 'MD-014 XFF listado proxies 8hops spoofeado', category: 'logs', kind: 'credentials_post', formFields: { organizationId: MD_FIXTURE_ORGS.ORG_A_ID, rfc: MD_FIXTURE_ORGS.RFC_ORG_A, password: 'pw' }, expect: { ipXFF: 'client-spoof, p1, p2, p3, p4, p5, p6, trusted-edge' } },
  { id: 'MD-PAY-111', title: 'MD-003 retrievalType folio con columna folio SQL contains', category: 'zod', kind: 'requests_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, folio: '%25%27%20OR%201%3D1--' }, expect: {} },
  { id: 'MD-PAY-112', title: 'MD-006 year param overflow 9999 month 13 invalid', category: 'zod', kind: 'fc_get', urlQuery: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, year: '999999', month: '13' }, expect: {} },
  { id: 'MD-PAY-113', title: 'MD-012 BullMQ Redis down queue.add 500 no compensación', category: 'dos', kind: 'requests_post', jsonBody: { companyId: MD_FIXTURE_ORGS.COMPANY_ORG_A, requestingRfc: MD_FIXTURE_ORGS.RFC_ORG_A, startDate: '2025-06-01', endDate: '2025-06-30', requestType: 'metadata', retrievalType: 'emitidos' }, expect: {} },
  { id: 'MD-PAY-114', title: 'MD-010 500 catch stack completo cliente', category: 'logs', kind: 'requests_get', urlQuery: { companyId: 'x'.repeat(10000) }, expect: {} },
  { id: 'MD-PAY-115', title: 'MD-013 REDIS_PORT=99999 overflow invalid port', category: 'queue', kind: 'queue_config', env: { REDIS_PORT: '99999' }, expect: { portNaN: true } },
] as const

export type MdSafeTestShape = unknown

/* SAST-SEED Payloads Typed Union OAuth M2M.
 * No usar credenciales reales. IDs RFC4122 random.
 */

export type OAUTH_PAYLOAD_CATEGORY =
  | 'basic_auth'
  | 'xff_headers'
  | 'grant_types'
  | 'oauth_scopes'
  | 'fallback_clients'
  | 'jwt_misconfig'
  | 'ip_validate_input'

export interface OauthPayloadBase {
  readonly id: string
  readonly category: OAUTH_PAYLOAD_CATEGORY
  readonly description: string
  readonly expected: 'reject' | '400' | '401' | '403' | '429' | 'accept'
  readonly notes?: string
}

export interface BasicAuthPayload extends OauthPayloadBase {
  readonly category: 'basic_auth'
  readonly clientId: string
  readonly clientSecret: string
  readonly rawHeader?: string
}

export interface XffPayload extends OauthPayloadBase {
  readonly category: 'xff_headers'
  readonly headers: Record<string, string>
  readonly expectedClientIp: string | null
}

export interface GrantPayload extends OauthPayloadBase {
  readonly category: 'grant_types'
  readonly grantType: string
  readonly extraParams?: Record<string, string>
}

export interface ScopePayload extends OauthPayloadBase {
  readonly category: 'oauth_scopes'
  readonly scope: string
  readonly requestedLength: number
  readonly scopeTokensExpected: number
}

export interface FallbackClientPayload extends OauthPayloadBase {
  readonly category: 'fallback_clients'
  readonly client: {
    clientId: string
    clientSecret: string
    clientSecretHash?: never
    isActive?: boolean
    expiresAt?: string
    allowedIps?: string[]
    organizationId: string
    scopes: string[]
    defaultScopes?: string[]
  }
}

export interface JwtMisconfigPayload extends OauthPayloadBase {
  readonly category: 'jwt_misconfig'
  readonly secret: string
  readonly expiresIn: string
}

export interface IpValidatePayload extends OauthPayloadBase {
  readonly category: 'ip_validate_input'
  readonly ip: string
}

export type OAuthPayload =
  | BasicAuthPayload
  | XffPayload
  | GrantPayload
  | ScopePayload
  | FallbackClientPayload
  | JwtMisconfigPayload
  | IpValidatePayload

export const SAST_SEED_ORGS = {
  ORG_A: { id: 'cmnntrppk000502gcp93ketfx', rfc: 'ODE8604257UA' },
  ORG_B: { id: 'cmipiwlqk000mvyvtc22tnlrb', rfc: 'QBB7223997V9' },
} as const

export const FIXTURE_VALID_CLIENT = {
  clientId: 'sast_seed_m2m_client_01',
  secretPlain: '8ZqRz5x_1n0v@t3_S3cr3t_M2M',
  scopes: ['cfdi:read', 'invoices:read', 'companies:read'],
  defaultScopes: ['cfdi:read'] as const,
  organizationId: SAST_SEED_ORGS.ORG_A.id,
  allowedIps: ['10.0.1.50', '192.168.1.0/24'],
}

export const FIXTURE_DISABLED_CLIENT = {
  ...FIXTURE_VALID_CLIENT,
  clientId: 'sast_seed_m2m_client_02_disabled',
  isActive: false,
}

export const FIXTURE_EXPIRED_CLIENT = {
  ...FIXTURE_VALID_CLIENT,
  clientId: 'sast_seed_m2m_client_03_expired',
  expiresAt: '2024-01-01T00:00:00.000Z',
}

export const FIXTURE_IP_RESTRICTED_CLIENT = {
  ...FIXTURE_VALID_CLIENT,
  clientId: 'sast_seed_m2m_client_04_whitelist',
  allowedIps: ['10.0.0.0/8'],
}

export const PAYLOADS_BASIC_AUTH: BasicAuthPayload[] = [
  { id: 'OAUTH-PAY-001', category: 'basic_auth', description: 'client_id:secret válido 20 chars ASCII', clientId: FIXTURE_VALID_CLIENT.clientId, clientSecret: FIXTURE_VALID_CLIENT.secretPlain, expected: 'accept' },
  { id: 'OAUTH-PAY-002', category: 'basic_auth', description: 'Auth header NO empieza Basic (Bearer en vez)', clientId: 'x', clientSecret: 'y', rawHeader: 'Bearer eyJhbGciOiJ', expected: 'reject' },
  { id: 'OAUTH-PAY-003', category: 'basic_auth', description: 'Enc= largo 10 chars padding inválido mod 3 (%4 !==0)', clientId: 'abc', clientSecret: 'def', rawHeader: 'Basic ' + 'YWJjOmRlZg'.slice(0, 6), expected: 'reject' },
  { id: 'OAUTH-PAY-004', category: 'basic_auth', description: 'Decoded NO contiene separador ":"', clientId: '', clientSecret: '', rawHeader: 'Basic ' + Buffer.from('sindospuntos').toString('base64'), expected: 'reject' },
  { id: 'OAUTH-PAY-005', category: 'basic_auth', description: 'Encoded length 8192b > 4096 MAX DoS', clientId: '', clientSecret: '', rawHeader: 'Basic ' + 'A'.repeat(8192), expected: 'reject' },
  { id: 'OAUTH-PAY-006', category: 'basic_auth', description: 'Base64 alphabet inválido !!! ##### emoji 🚨💀', clientId: '', clientSecret: '', rawHeader: 'Basic ' + '!!!@@@###$$$%%%^^^&&&(((', expected: 'reject' },
  { id: 'OAUTH-PAY-007', category: 'basic_auth', description: 'clientId > 255 chars RFC 6749', clientId: 'a'.repeat(300), clientSecret: 'secretshort', expected: 'reject' },
  { id: 'OAUTH-PAY-008', category: 'basic_auth', description: 'Decoded > 3000 bytes DoS', clientId: '', clientSecret: '', rawHeader: 'Basic ' + Buffer.from('x:'.padEnd(3500, 'a')).toString('base64'), expected: 'reject' },
  { id: 'OAUTH-PAY-009', category: 'basic_auth', description: 'Authorization NULL header', clientId: '', clientSecret: '', rawHeader: null as unknown as string, expected: 'reject' },
  { id: 'OAUTH-PAY-010', category: 'basic_auth', description: 'clientId empty:secret empty (empty Basic "")', clientId: '', clientSecret: '', rawHeader: 'Basic ' + Buffer.from(':').toString('base64'), expected: '401' },
  { id: 'OAUTH-PAY-011', category: 'basic_auth', description: 'Whitespace spaces trailing/leading around auth (trim OK)', clientId: FIXTURE_VALID_CLIENT.clientId, clientSecret: FIXTURE_VALID_CLIENT.secretPlain, rawHeader: '  Basic  ' + Buffer.from(`${FIXTURE_VALID_CLIENT.clientId}:${FIXTURE_VALID_CLIENT.secretPlain}`).toString('base64') + '   ', expected: 'accept' },
  { id: 'OAUTH-PAY-012', category: 'basic_auth', description: 'Unicode UTF-8 multi-byte secret: emoticones + cjk', clientId: 'svc_china', clientSecret: '用户密码🔐⚡💻', expected: '401' },
  { id: 'OAUTH-PAY-013', category: 'basic_auth', description: 'Null byte %00 en base64 decoded', clientId: '', clientSecret: '', rawHeader: 'Basic ' + Buffer.from('aa\x00aa:bb\x00cc').toString('base64'), expected: '401' },
  { id: 'OAUTH-PAY-014', category: 'basic_auth', description: 'Separador : duplicado "a:b:c" - secret = "b:c"', clientId: 'a', clientSecret: 'b:c', expected: '401' },
  { id: 'OAUTH-PAY-015', category: 'basic_auth', description: 'Secret > 4096 chars (OK 401)', clientId: FIXTURE_VALID_CLIENT.clientId, clientSecret: 'P'.repeat(6000), expected: '401' },
]

export const PAYLOADS_XFF: XffPayload[] = [
  { id: 'OAUTH-PAY-016', category: 'xff_headers', description: 'XFF simple 1 trusted VPC proxy última posición = client', headers: { 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }, expectedClientIp: '203.0.113.77', expected: 'accept' },
  { id: 'OAUTH-PAY-017', category: 'xff_headers', description: 'Spoof posición [0] IP permitida; la última NO es trusted - atacante (debe tomar la IP antes del proxy trusted)', headers: { 'x-forwarded-for': '10.0.1.50, 198.51.100.9, 172.16.0.1' }, expectedClientIp: '198.51.100.9', expected: '403' },
  { id: 'OAUTH-PAY-018', category: 'xff_headers', description: 'Solo x-real-ip sin XFF', headers: { 'x-real-ip': '203.0.113.5' }, expectedClientIp: '203.0.113.5', expected: 'accept' },
  { id: 'OAUTH-PAY-019', category: 'xff_headers', description: 'Duplicados ,,, leading/trailing comas en XFF', headers: { 'x-forwarded-for': ',,  ,  203.0.113.2,  10.0.0.1  , ,,' }, expectedClientIp: '203.0.113.2', expected: 'accept' },
  { id: 'OAUTH-PAY-020', category: 'xff_headers', description: 'IPv6 formato full comprimido', headers: { 'x-forwarded-for': '2001:db8:85a3::1, 10.0.0.1' }, expectedClientIp: '2001:db8:85a3::1', expected: 'accept' },
  { id: 'OAUTH-PAY-021', category: 'xff_headers', description: 'IPv6 con puerto [::1]:8080 NO permitido (format invalid)', headers: { 'x-forwarded-for': '[2001:db8::1]:8080, 10.0.0.1' }, expectedClientIp: null, expected: 'reject' },
  { id: 'OAUTH-PAY-022', category: 'xff_headers', description: 'Cadena XSS en header - debe ser validada luego', headers: { 'x-forwarded-for': "<img src=x onerror=alert(1)>, 10.0.0.1" }, expectedClientIp: null, expected: 'reject' },
  { id: 'OAUTH-PAY-023', category: 'xff_headers', description: 'Cadena SQLi 1=1', headers: { 'x-forwarded-for': "' OR '1'='1, 10.0.0.1" }, expectedClientIp: null, expected: 'reject' },
  { id: 'OAUTH-PAY-024', category: 'xff_headers', description: 'Ningún header devuelve null', headers: {}, expectedClientIp: null, expected: 'reject' },
  { id: 'OAUTH-PAY-025', category: 'xff_headers', description: 'IP privada 127.0.0.1 loopback (X-Real-IP spoof si NO está en trusted; isPrivateOrReservedIp = skip?', headers: { 'x-real-ip': '127.0.0.1' }, expectedClientIp: null, expected: 'reject' },
]

export const PAYLOADS_GRANT_TYPES: GrantPayload[] = [
  { id: 'OAUTH-PAY-031', category: 'grant_types', description: 'grant_type=client_credentials RFC6749 §4.4 OK', grantType: 'client_credentials', expected: 'accept' },
  { id: 'OAUTH-PAY-032', category: 'grant_types', description: 'grant_type=refresh_token (no implementado)', grantType: 'refresh_token', extraParams: { refresh_token: 'rt_abcdef' }, expected: '400' },
  { id: 'OAUTH-PAY-033', category: 'grant_types', description: 'grant_type=password (legacy ROPC)', grantType: 'password', extraParams: { username: 'admin', password: '123' }, expected: '400' },
  { id: 'OAUTH-PAY-034', category: 'grant_types', description: 'grant_type=authorization_code', grantType: 'authorization_code', expected: '400' },
  { id: 'OAUTH-PAY-035', category: 'grant_types', description: 'grant_type VACÍO', grantType: '', expected: '400' },
  { id: 'OAUTH-PAY-036', category: 'grant_types', description: 'grant_type mayúsculas (RFC case sensitive) CLIENT_CREDENTIALS', grantType: 'CLIENT_CREDENTIALS', expected: '400' },
  { id: 'OAUTH-PAY-037', category: 'grant_types', description: 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange (RFC 8693 no soportado)', grantType: 'urn:ietf:params:oauth:grant-type:token-exchange', expected: '400' },
  { id: 'OAUTH-PAY-038', category: 'grant_types', description: 'Body application/json (debe ignorar NO usar params GET)', grantType: 'client_credentials', expected: '400' },
  { id: 'OAUTH-PAY-039', category: 'grant_types', description: 'grant_type con tab, newline, unicode control', grantType: 'client_credentials\n\t\x00', expected: '400' },
  { id: 'OAUTH-PAY-040', category: 'grant_types', description: 'grant_type.length > 255 chars', grantType: 'x'.repeat(300), expected: '400' },
]

export const PAYLOADS_SCOPES: ScopePayload[] = [
  { id: 'OAUTH-PAY-046', category: 'oauth_scopes', description: 'Scope VACÍO debe DENEGAR 400 invalid_scope (fail closed)', scope: '', requestedLength: 0, scopeTokensExpected: 0, expected: '400' },
  { id: 'OAUTH-PAY-047', category: 'oauth_scopes', description: 'Scope válido 1 token', scope: 'cfdi:read', requestedLength: 9, scopeTokensExpected: 1, expected: 'accept' },
  { id: 'OAUTH-PAY-048', category: 'oauth_scopes', description: '3 tokens válidos space-separated', scope: 'cfdi:read invoices:read companies:read', requestedLength: 41, scopeTokensExpected: 3, expected: 'accept' },
  { id: 'OAUTH-PAY-049', category: 'oauth_scopes', description: '1 scope no autorizado admin:delete', scope: 'cfdi:read admin:delete', requestedLength: 27, scopeTokensExpected: 2, expected: '403' },
  { id: 'OAUTH-PAY-050', category: 'oauth_scopes', description: 'Scope 2100 chars > MAX 2048 DoS', scope: 'a1:b2 '.repeat(350), requestedLength: 2100, scopeTokensExpected: 350, expected: '400' },
  { id: 'OAUTH-PAY-051', category: 'oauth_scopes', description: '130 scopes tokens > MAX 128', scope: Array.from({length:130}).map((_,i)=>`scope_${i}`).join(' '), requestedLength: 0, scopeTokensExpected: 130, expected: '400' },
  { id: 'OAUTH-PAY-052', category: 'oauth_scopes', description: 'Scope chars inválidos emoji <script>', scope: 'cfdi:read <img src=x onerror=alert(1)>', requestedLength: 0, scopeTokensExpected: 3, expected: '400' },
  { id: 'OAUTH-PAY-053', category: 'oauth_scopes', description: 'Scope mayúsculas RFC case-sensitive; CFDI:READ inválido', scope: 'CFDI:READ', requestedLength: 0, scopeTokensExpected: 1, expected: '400' },
  { id: 'OAUTH-PAY-054', category: 'oauth_scopes', description: 'Scope único token > 64 chars excede regex', scope: 'a'.repeat(70), requestedLength: 70, scopeTokensExpected: 1, expected: '400' },
  { id: 'OAUTH-PAY-055', category: 'oauth_scopes', description: 'Spaces múltiples duplicados  "a  b   c" → normalize 3 tokens', scope: 'a  b   c', requestedLength: 0, scopeTokensExpected: 3, expected: '400' },
]

export const PAYLOADS_FALLBACK_CLIENTS: FallbackClientPayload[] = [
  { id: 'OAUTH-PAY-061', category: 'fallback_clients', description: 'Fallback válido: isActive=true sin restricciones', client: { clientId:'env_valid_001', clientSecret:'EnvSecret!234', organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['scope1'], defaultScopes:['scope1'] }, expected: 'accept' },
  { id: 'OAUTH-PAY-062', category: 'fallback_clients', description: 'Fallback isActive=false debe DENEGAR 401', client: { clientId:'env_disabled_002', clientSecret:'x', isActive:false, organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['a'] }, expected: '401' },
  { id: 'OAUTH-PAY-063', category: 'fallback_clients', description: 'Fallback expiresAt 2024 → caducado 401', client: { clientId:'env_expired_003', clientSecret:'x', expiresAt:'2024-01-01T00:00:00Z', organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['a'] }, expected: '401' },
  { id: 'OAUTH-PAY-064', category: 'fallback_clients', description: 'Fallback allowedIps includes sourceIp 10.0.0.8', client: { clientId:'env_ipok_004', clientSecret:'x', allowedIps:['10.0.0.8'], organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['a'] }, expected: 'accept', notes: 'sourceIp en test 10.0.0.8' },
  { id: 'OAUTH-PAY-065', category: 'fallback_clients', description: 'Fallback allowedIps NO incluye sourceIp 187.x → 403', client: { clientId:'env_ipdeny_005', clientSecret:'x', allowedIps:['10.0.0.0/8'], organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['a'] }, expected: '403', notes: 'sourceIp = 187.150.20.5 pública' },
  { id: 'OAUTH-PAY-066', category: 'fallback_clients', description: 'Fallback scope omitido → defaultScopes (scope1) NO all scopes', client: { clientId:'env_scope6', clientSecret:'x', organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['scope1','scope2','scope3'], defaultScopes:['scope1'] }, expected: 'accept', notes: 'effective scopes debe ser [scope1] long=1'},
  { id: 'OAUTH-PAY-067', category: 'fallback_clients', description: 'Fallback sin defaultScopes + scope vacío → invalid_scope 400 fail closed', client: { clientId:'env_nodefaults_007', clientSecret:'x', organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['a','b','c']}, expected: '400' },
  { id: 'OAUTH-PAY-068', category: 'fallback_clients', description: 'clientSecret NO match timing seguro', client: { clientId:'env_secretbad_008', clientSecret:'SecretCorrecto123', organizationId: SAST_SEED_ORGS.ORG_A.id, scopes:['a'] }, expected: '401', notes: 'enviar secret=MAL ' },
  { id: 'OAUTH-PAY-069', category: 'fallback_clients', description: 'Fallback json corrupto: error redactado safeErrSummary NO leak raw', client: { clientId:'__JSON_ERROR__' as never, clientSecret: '{"abc":' as never, organizationId: SAST_SEED_ORGS.ORG_A.id, scopes: [] }, expected: 'reject' },
]

export const PAYLOADS_JWT_MISCONFIG: JwtMisconfigPayload[] = [
  { id: 'OAUTH-PAY-076', category: 'jwt_misconfig', description: 'JWT secret 10 chars → reject entropy insuficiente', secret: 'short12345', expiresIn: '5m', expected: 'reject' },
  { id: 'OAUTH-PAY-077', category: 'jwt_misconfig', description: 'JWT secret 31 chars (1 byte menos que 32 min → reject)', secret: 'A'.repeat(31), expiresIn: '5m', expected: 'reject' },
  { id: 'OAUTH-PAY-078', category: 'jwt_misconfig', description: 'JWT secret 40 chars → acepta entropy válido', secret: 'A'.repeat(40), expiresIn: '5m', expected: 'accept' },
  { id: 'OAUTH-PAY-079', category: 'jwt_misconfig', description: 'expires_in = 7200s 2h acepta', secret: 'A'.repeat(40), expiresIn: '2h', expected: 'accept' },
  { id: 'OAUTH-PAY-080', category: 'jwt_misconfig', description: 'expires_in = 30d PROD clamp MAX 86400 (1d)', secret: 'A'.repeat(40), expiresIn: '30d', expected: 'accept', notes: 'result = 86400 seconds clamped' },
  { id: 'OAUTH-PAY-081', category: 'jwt_misconfig', description: 'expires_in=999999999d clamp MAX', secret: 'A'.repeat(40), expiresIn: '999999999d', expected: 'accept', notes: 'clamp 86400 PROD' },
  { id: 'OAUTH-PAY-082', category: 'jwt_misconfig', description: 'expires_in valor inválido "abcxyz" → 300 default', secret: 'A'.repeat(40), expiresIn: 'abcxyz', expected: 'accept', notes: 'resolveExpiresInSeconds default 300'},
  { id: 'OAUTH-PAY-083', category: 'jwt_misconfig', description: 'expires_in = 15m NO supera clamp OK', secret: 'A'.repeat(40), expiresIn: '15m', expected: 'accept' },
  { id: 'OAUTH-PAY-084', category: 'jwt_misconfig', description: 'DEV env 30d NO se clamp (NODE_ENV!=production)', secret: 'A'.repeat(40), expiresIn: '30d', expected: 'accept', notes: 'NODE_ENV=test clamp 30 días'},
]

export const PAYLOADS_IP_VALIDATE: IpValidatePayload[] = [
  { id: 'OAUTH-PAY-086', category: 'ip_validate_input', ip: '127.0.0.1', description: 'IPv4 loopback válido', expected: 'accept' },
  { id: 'OAUTH-PAY-087', category: 'ip_validate_input', ip: '2001:db8:85a3:0000:0000:8a2e:0370:7334', description: 'IPv6 completo 39 chars OK', expected: 'accept' },
  { id: 'OAUTH-PAY-088', category: 'ip_validate_input', ip: "<img src=x onerror='alert(1)'>", description: 'XSS string → reject 45 chars regex', expected: 'reject' },
  { id: 'OAUTH-PAY-089', category: 'ip_validate_input', ip: 'A'.repeat(100), description: 'Largo >45 chars → reject', expected: 'reject' },
  { id: 'OAUTH-PAY-090', category: 'ip_validate_input', ip: '999.999.999.999', description: 'IPv4 inválido (bytes >255) → regex fail', expected: 'reject' },
]

export const ALL_OAUTH_PAYLOADS: OAuthPayload[] = [
  ...PAYLOADS_BASIC_AUTH,
  ...PAYLOADS_XFF,
  ...PAYLOADS_GRANT_TYPES,
  ...PAYLOADS_SCOPES,
  ...PAYLOADS_FALLBACK_CLIENTS,
  ...PAYLOADS_JWT_MISCONFIG,
  ...PAYLOADS_IP_VALIDATE,
]

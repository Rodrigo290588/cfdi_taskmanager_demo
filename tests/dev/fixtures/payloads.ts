// SAST MÓDULO DEV · Payloads anti-regresión (DEV-001…DEV-016)
// Correspondencia 1:1 con findings del reporte SAST pdf/html sast-dev_report_202608210043.
// Vectores de prueba para validar que los 16 parches bloquean los paths vulnerables.

import crypto from 'node:crypto'

// =========================================================
// DEV-001 (CRÍTICO) · ALLOW_DEV_ENDPOINTS environment bypass
// Antes: endpoints /api/dev activos con solo NODE_ENV!=production (sin ALLOW_DEV_ENDPOINTS explícito)
// Ahora: getDevEnvStatus() exige ALLOW_DEV_ENDPOINTS=true/1/yes/on && NODE_ENV in {dev,test,staging}
// =========================================================
export const DEV001_ALLOW_DEV_ENDPOINTS_REQUIRED = {
  name: 'DEV-001 ALLOW_DEV_ENDPOINTS explícito requerido (explicit bool + no-production)',
  severity: 'Critico',
  bypassAttempts: [
    { NODE_ENV: 'development', ALLOW_DEV_ENDPOINTS: undefined, expectedAllow: false },
    { NODE_ENV: 'staging', ALLOW_DEV_ENDPOINTS: undefined, expectedAllow: false },
    { NODE_ENV: 'production', ALLOW_DEV_ENDPOINTS: 'true', expectedAllow: false },
    { NODE_ENV: 'development', ALLOW_DEV_ENDPOINTS: 'true', expectedAllow: true },
    { NODE_ENV: 'test', ALLOW_DEV_ENDPOINTS: '1', expectedAllow: true },
  ],
  rawTrutheyValues: ['true', '1', 'yes', 'on', 'TRUE', 'On', 'YES  '],
  rawFalsyValues: ['false', '0', 'no', 'off', '', '   ', undefined, null, 'random'],
  expectedBefore: 'allowedByDefaultOnNonProduction',
  expectedAfter: 'requiresExplicitAllowEndpointsTrue'
}

// =========================================================
// DEV-002 (CRÍTICO) · Double session recheck después guardia
// Antes: seed POST con session válida en guard, pero session.user cambia (race hijack)
// Ahora: doble recheck antes de ejecutar transacción Prisma (session.userId === enforcedDevUserId)
// =========================================================
export const DEV002_DOUBLE_AUTH_RECHECK_SEED_POST = {
  name: 'DEV-002 Double auth recheck en seed POST después guardia (race hijack prevent)',
  severity: 'Critico',
  raceWindowMs: 50,
  recheckFields: ['session.user.id', 'user.systemRole === SUPER_ADMIN'],
  expectedBefore: 'singleCheckAtGuardTop',
  expectedAfter: 'doubleCheckBeforeTx'
}

// =========================================================
// DEV-003 (CRÍTICO) · Serializable isolation + retries en seed
// Antes: count → createMany con race (duplicados unique constraint colisiones)
// Ahora: Serializable isolationLevel + 3 retries exponential backoff P2002/P2034/DEADLOCK
// =========================================================
export const DEV003_SERIALIZABLE_TX_3_RETRIES = {
  name: 'DEV-003 Serializable transaction + retry 3× exp backoff (P2002/P2034/DEADLOCK)',
  severity: 'Critico',
  retryCount: 3,
  backoffBaseMs: 120,
  prismaErrorCodesHandled: ['P2002', 'P2034', 'P2034', '40P01'],
  isolationLevelRequired: 'Serializable',
  maxWaitMs: 15000,
  expectedBefore: 'defaultReadCommittedZeroRetries',
  expectedAfter: 'serializable3RetriesExponentialJitter'
}

// =========================================================
// DEV-004 (ALTO) · RFC strict length/format SAT regex NO permissive
// Antes: .trim() sin uppercase + regex débil / length 0..80 acceptaba basura
// Ahora: superRefine length ∈ {12,13} + RFC_STRICT_REGEX_SAT + toUpperCase transform
// =========================================================
export const DEV004_RFC_STRICT_SAT_REGEX = {
  name: 'DEV-004 RFC strict: length 12|13 + RFC_STRICT_REGEX_SAT + uppercase transform',
  severity: 'Alto',
  bypassVectors: [
    { rfc: 'abc', expectedInvalid: true, reason: 'longitud <12' },
    { rfc: 'AAAAAAAAAAAAAAAAAA', expectedInvalid: true, reason: 'longitud >13' },
    { rfc: 'O&E860425T31!', expectedInvalid: true, reason: 'chars especiales inválidos' },
    { rfc: 'xa xx010 101000', expectedInvalid: true, reason: 'espacios + ñ inválidos' },
    { rfc: 'ODE8604257UA', expectedInvalid: false, reason: 'RFC válido 13' },
    { rfc: ' QBB61590505M ', expectedInvalid: false, reason: 'RFC válido 12 + trim' },
  ],
  regexSourceExpected: '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$',
  expectedBefore: 'weakRegex',
  expectedAfter: 'superRefineStrictRfcSat'
}

// =========================================================
// DEV-005 (ALTO) · clamp limit sat_invoices anti-NaN/neg/grande
// Antes: limit=999999 o limit=-1 acceptados
// Ahora: clamp 1..MAX_DEV_SAT_INVOICES_LIMIT=50 + floor non-integer + default 10
// =========================================================
export const DEV005_LIMIT_CLAMP_SAT_1_50 = {
  name: 'DEV-005 limit clamp sat_invoices: 1 a MAX=50 + anti-NaN',
  severity: 'Alto',
  bypassVectors: [
    { input: undefined, expected: 10 },
    { input: '', expected: 10 },
    { input: 'NaN', expected: 10 },
    { input: '-5', expected: 1 },
    { input: '999999', expected: 50 },
    { input: '12.7', expected: 12 },
    { input: '25', expected: 25 },
  ],
  hardMaxExpected: 50,
  expectedBefore: 'rawPassThrough',
  expectedAfter: 'clamp1ToHardMax50'
}

// =========================================================
// DEV-006 (ALTO) · randomInt/secureRandomUuid CSPRNG NO Math.random
// Antes: Math.random() birthday paradox colisiones unique UUID RFC
// Ahora: crypto.randomInt (node) + crypto.randomUUID CSPRNG
// =========================================================
export const DEV006_CSPRNG_NO_MATH_RANDOM = {
  name: 'DEV-006 CSPRNG: randomInt() + secureRandomUuid() NO Math.random()',
  severity: 'Alto',
  forbiddenSnippets: ['Math.random()', 'Math.floor(Math.random'],
  requiredImportsNodeCrypto: ['randomInt', 'randomUUID'],
  uuidVersion4Regex: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  expectedBefore: 'mathRandomWeak',
  expectedAfter: 'nodeCryptoCsprng'
}

// =========================================================
// DEV-007 (ALTO) · Step-up session iat ≤ 15 minutos
// Antes: sesión de 7 días válida para usar endpoints dev (session theft risk)
// Ahora: diffMin > DEV_STEP_UP_AUTH_MAX_MINUTES → 401 step-up required
// =========================================================
export const DEV007_STEP_UP_15_MIN = {
  name: 'DEV-007 Step-up auth: session iat ≤ 15 min freshness check',
  severity: 'Alto',
  maxMinutes: 15,
  scenarios: [
    { sessionIatMinAgo: 10, expectedPass: true },
    { sessionIatMinAgo: 14.9, expectedPass: true },
    { sessionIatMinAgo: 15.1, expectedPass: false },
    { sessionIatMinAgo: 60, expectedPass: false },
  ],
  expectedBefore: 'noStepUpCheck',
  expectedAfter: 'stepUpIatMax15Min'
}

// =========================================================
// DEV-008 (ALTO) · M2M scope allowlist view-only 4 + expiresAt 12h
// Antes: scopes ALL (*) con clientSecret never-expires + cfdi.import write danger
// Ahora: M2M_SCOPE_ALLOWLIST_DEV_DEMO Set(4) view-only + expiresAt = Date.now+12h
// =========================================================
export const DEV008_M2M_SCOPES_VIEW_ONLY_12H = {
  name: 'DEV-008 M2M scopes 4 view-only + expiresAt max 12h (no cfdi.import)',
  severity: 'Alto',
  allowedScopes: ['cfdi.view:read', 'dashboard:view', 'reports:read', 'workpapers:view'],
  forbiddenScopes: ['cfdi.import', 'admin:*', 'cfdi:*', 'provider:*', '*'],
  maxExpireHours: 12,
  expectedBefore: 'wildcardScopeNeverExpires',
  expectedAfter: 'viewOnlyScopeAllowlist12h'
}

// =========================================================
// DEV-009 (MEDIO) · rand() seed counts = CSPRNG NO Math.floor(Math.random)
// Antes: escenario counts = Math.floor(Math.random() * 100)+1 (predictable)
// Ahora: randomInt() CSPRNG Node.js crypto
// =========================================================
export const DEV009_SEED_COUNTS_CSPRNG = {
  name: 'DEV-009 Seed counts scen1/scen2 = randomInt CSPRNG (no birthday predict)',
  severity: 'Medio',
  scenarioCountBounds: {
    invoicesScenario1: { min: 40, max: 80, step: 10 },
    satScenario2: { min: 50, max: 150, step: 10 },
  },
  expectedBefore: 'mathFloorMathRandomPredictable',
  expectedAfter: 'randomIntCsprngBoundedStepped'
}

// =========================================================
// DEV-010 (MEDIO) · XSS reflejado safeRfcError sanitiza <>&"\
// Antes: mensaje error=RFC {rfc} inválido → {rfc} user input raw en response
// Ahora: safeRfcError() reemplaza <,>,&,",\ con entidades + slice 40 chars
// =========================================================
export const DEV010_SAFE_RFC_ERROR_XSS = {
  name: 'DEV-010 XSS reflejado safeRfcError: sanitiza <>&"\\ + slice 40',
  severity: 'Medio',
  xssVectors: [
    { input: '<script>alert(1)</script>', expectedSafe: true },
    { input: 'RFC" onerror="alert(1)"', expectedSafe: true },
    { input: 'a\\b<svg onload=confirm(1)>', expectedSafe: true },
    { input: 'ODE8604257UA', expectedSafe: true },
  ],
  forbiddenCharsAfter: ['<', '>', '"', '\\', '&amp;'],
  maxLengthAfter: 40,
  expectedBefore: 'rawRfcInErrorMessage',
  expectedAfter: 'sanitizedSlicedSafeMessage'
}

// =========================================================
// DEV-011 (MEDIO) · 500 errors NO stacktrace/connection strings → fingerprint SHA
// Antes: catch(e) return json({error:e.message,stack:e.stack})
// Ahora: return { error: fingerprint_sha16, prismaErrorCode? } NO stack/conn
// =========================================================
export const DEV011_NO_STACKTRACE_LEAK_500 = {
  name: 'DEV-011 500 safe: fingerprint SHA16 + prismaCode, NO stack/env/conn strings',
  severity: 'Medio',
  forbiddenLeakKeys: ['stack', 'DATABASE_URL', 'connection_string', 'AUTH_SECRET', 'SECRET_KEY', 'clientSecret'],
  requiredFields500: ['errorFingerprint'],
  fingerprintLengthChars: 16,
  expectedBefore: 'rawErrorStackJson',
  expectedAfter: 'fingerprintSafeErrNoSecrets'
}

// =========================================================
// DEV-012 (MEDIO) · Demo RFC NO hardcode SCI/CUCC públicos GitHub enumeration
// Antes: RFC por default = SCI041122EI6, CUCC4512065I7 (públicos SAT, dorkeable)
// Ahora: buildDemoRfc random 3letras+6digits+3homoclave DEV_RAND_DEMO_RFC_CHARS
// =========================================================
export const DEV012_RFC_NO_HARDCODED_PUBLIC_SAT = {
  name: 'DEV-012 RFC demo build random: NO hardcode SCI/CUCC públicos GitHub',
  severity: 'Medio',
  forbiddenHardcoded: ['SCI041122EI6', 'CUCC4512065I7', 'RFC PUBLICO', 'PUBLICO GENERAL'],
  allowedFallbackDefaults: ['DEMO010101AAA', 'EMPRES010101BBB'],
  charsRfc: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  expectedBefore: 'hardcodedPublicRfcGithub',
  expectedAfter: 'randomRfcCsprngOrSafeDefaults'
}

// =========================================================
// DEV-013 (ALTO) · Cross-tenant sat_invoices filter allowedFiscalEntityIds userId
// Antes: SUPER_ADMIN ve *ALL* SatInvoice rows de todos tenants sin scope ORGs
// Ahora: userOrgsIds → allowedFiscalEntityIds (member.organizationId) + WHERE IN
// =========================================================
export const DEV013_CROSS_TENANT_FISCAL_ENTITY_SCOPED = {
  name: 'DEV-013 Cross-tenant SatInvoice scope: allowedFiscalEntityIds por userId',
  severity: 'Alto',
  queryFiltersRequired: ['member.organizationId', 'allowedFiscalEntityIds', 'userId'],
  noGlobal: true,
  expectedBefore: 'globalFindManySuperAdmin',
  expectedAfter: 'allowedFiscalEntityIdsWhereInScope'
}

// =========================================================
// DEV-014 (BAJO) · Response seed NO IDs completos → suffixes 8-12 chars fingerprints
// Antes: response incluye orgId/companyId/fiscalEntityId completos + clientId M2M completo
// Ahora: fingerprints solo últimos 12 (org) / 8 (companies/fes) chars + NO seededBy.userId
// =========================================================
export const DEV014_RESPONSE_IDS_SUFFIX_TRUNCATED = {
  name: 'DEV-014 Response safe: id suffixes 8-12 chars trunc NO full ids / NO userId',
  severity: 'Bajo',
  suffixLengthOrg: 12,
  suffixLengthCompanies: 8,
  forbiddenResponseFields: ['seededBy.userId', 'orgIdFull', 'companyIdFull', 'clientSecret', 'm2mClientIdFull'],
  requiredSuffixInKey: 'fingerprints',
  expectedBefore: 'fullIdsCorrelatableGoogleDorks',
  expectedAfter: 'suffixTruncatedFingerprints8-12'
}

// =========================================================
// DEV-015 (BAJO) · Rate limit 1/30min seed idempotency distributed key
// Antes: seed POST llamable 100/s DoS DB CPU/IO
// Ahora: rateLimitByUserId key=dev-seed-post-idempotent-distributed-v2 1/30min
// =========================================================
export const DEV015_SEED_RATE_LIMIT_1_PER_30MIN = {
  name: 'DEV-015 Seed idempotency: 1 request / 30 min por userId (distributed key v2)',
  severity: 'Bajo',
  windowMs: 30 * 60 * 1000,
  maxRequests: 1,
  rateLimitKeyRequired: 'dev-seed-post-idempotent-distributed-v2',
  retryAfterSeconds: 1800,
  expectedBefore: 'unlimitedDoSRisk',
  expectedAfter: 'slidingWindow1Per30MinRetryAfterHeader'
}

// =========================================================
// DEV-016 (BAJO) · applyHardeningHeaders ALL responses (6 headers security)
// Antes: response 200/400 sin headers → XSS clickjacking MIME sniff
// Ahora: 6 headers: X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy, Strict-Transport-Security
// =========================================================
export const DEV016_HARDENING_HEADERS_6_ALL_RESPONSES = {
  name: 'DEV-016 applyHardeningHeaders: 6 headers ALL responses 200/4xx/5xx',
  severity: 'Bajo',
  headersRequired: [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Content-Security-Policy',
    'Referrer-Policy',
    'Permissions-Policy',
    'Strict-Transport-Security'
  ],
  headerExpectedValues: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  },
  routesAffected: [
    'src/app/api/dev/seed/route.ts',
    'src/app/api/dev/sat_invoices/route.ts',
  ],
  expectedBefore: 'zeroHeadersByDefault',
  expectedAfter: 'sixHardeningHeadersAllStatusCodes'
}

// =========================================================
// Utilidades internas para tests (export helper buildRfcRand)
// =========================================================
export function buildDevDemoRfcFixture(length12 = true): string {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const letrasCount = length12 ? 3 : 4
  let rfc = ''
  for (let i = 0; i < letrasCount; i++) rfc += CHARS[crypto.randomInt(0, CHARS.length)]
  for (let i = 0; i < 6; i++) rfc += String(crypto.randomInt(0, 10))
  for (let i = 0; i < 3; i++) rfc += CHARS[crypto.randomInt(0, CHARS.length)]
  return rfc
}

// Cuenta total de payloads para test de inventario
export const DEV_TOTAL_FINDINGS_PAYLOADS = 16

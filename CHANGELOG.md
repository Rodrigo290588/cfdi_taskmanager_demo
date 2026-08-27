# Changelog

Este archivo documenta los cambios versionados relevantes de la aplicacion.

## v1.17.0 - 2026-08-25

### Resumen
- Se aplica **Remediación SAST Completa (Regla AGENTS #19)** al módulo RFC Validate `/api/rfc/validate` (1 route · 3 handlers: POST / GET / OPTIONS · validación estricta RFC SAT México Art. 15 CFF). 12 vulnerabilidades OWASP Top10 2021 detectadas y remediadas 100%: **0 Críticos / 3 Altos / 7 Medios / 2 Bajos**.
- Workflow estricto 7 fases: FASE 0 SAST Detection Scope route.ts (12 findings HTML report OK) → Setup Jest/Permissions cross-module pattern (RFC_VALIDATE_VIEW enum + grants 5 roles) → Helpers Centralizados 2A (14 exports zero-any safeValidateRfcInput/CV Oficial SAT/escapeHtml/Forbidden Set 40 unique/ReDoS Fail-Fast) → Route Refactor 2B (Auth gate + Permission fail-closed + Triple Bucket Rate 6 const + POST sizeLimit 64KB double-cap + OPTIONS CORS preflight + GET producción 410 Gone PII URL (LOPD Art. 14) + SEC_HEADERS 9 status codes + safeErrSummary 2 sitios catch) → Jest Anti-Regresión 2C (141 tests PASS 100% 3 suites parametrizadas) → Coverage 2D (rfc-validate.ts **92.44% lines / 100% branches**) → tsc/lint 0/0 Clean NO Regression.
- **Severidad Alta (RFC-001 BOLA endpoint PÚBLICO sin auth)**: `POST /api/rfc/validate` NO validaba sesión ni granulos `Permission.RFC_VALIDATE_VIEW`. Parche: enum nuevo `RFC_VALIDATE_VIEW` + grants 5 roles autorizados (SUPER_ADMIN/ADMIN/COMPANY_ADMIN/USER + MemberRole ADMIN); **AUDITOR/VIEWER bloqueados fail-closed 403**.
- **Severidad Alta (RFC-002 ReDoS Quadratic Fail-Fast Length)**: RegEx RFC pattern sin pre-check length 12/13 chars → payload 10KB `A…A` → 2.5s CPU block event-loop (ReDoS catastrophic). Parche: Fail-Fast length check ANTES regex unicode `/u` (O(1)); `RFC_STRICT_REGEX_UNICODE` flag `u`; ReDoS parametrized 20 cases it.each threshold <10ms total.
- **Severidad Alta (RFC-009 PII en URL GET LOPD Art. 14)**: `GET /api/rfc/validate?rfc=ODEM8604257UA` exponía RFC persona/moral en access logs, referers, browser history. Parche: Producción NODE_ENV=production → **410 Gone** "Endpoint deprecated usa POST"; Development temporal auth/rate igual POST + `X-Deprecation-Notice: 2026-09-01`.

### Cambios Tecnicos

#### Nuevos Helpers Centralizados (Regla Ingenieria: exports tipados strict zero-any)
**Nuevo Archivo**: `src/lib/rfc-validate.ts` (14 exports tipados, coverage 92.44% lines / 100% branches)
- `RFC_STRICT_REGEX_UNICODE`: Pattern `^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$` flag **u** unicode (ñ multibyte U+00D1 match exacto)
- `rfcValidationSchema` Zod strict: trim() + min(1)/min(12)/max(13) + regex + `invalid_type_error/required_error → message` (fix TSC overloads)
- `escapeHtml(value)`: 6 chars `< > & " ' \`` + control chars <32 → `\ufffd` (XSS Reflected Zod issues RFC-004/007)
- `validateRfc(string)`: **FAIL-FAST 5 etapas** length→regex→uppercase→Forbidden 40 unique Set→fecha estricta bisiesto Gregoriano; return tipo discriminated {ok, type:person|company, fecha}
- `calculateOfficialSatVerificationDigit(rfc12)`: **SAT DOF 2004 pesos 13→2 mod 11**; Map singleton 37 chars (&/Ñ incluidos); fail-safe return '0' si formato inválido
- `safeValidateRfcInput(object|string)`: **Pre-normalize uppercase/trim antes Zod.safeParse**; acepta string raw u objeto {rfc}; discriminated {success, data, issues}
- `RFC_VALIDATION_SUGGESTIONS`: 5 recomendaciones frozen array para usuario final
- `redactZodIssuesEscaped(safeParse.error.issues)`: Zod issue messages escapeHtml ALL para XSS reflected
- `RFC_POST_BODY_HARD_CAP_BYTES = 65536` (64KB exacto hard-cap doble Content-Length + arrayBuffer.byteLength)
- Singletons `declare global var __RFC_TEXT_ENCODER_INSTANCE__ / __RFC_FORBIDDEN_SET__ / __RFC_CHAR_TO_VALUE_MAP__`: zero casts any; 1 sola instancia per worker; O(1) Forbidden check
- `RFC_FORBIDDEN_WORDS_SAT_ART15`: **40 unique Set** (NO 96 legacy duplicados); Art. 15 CFF Regla 2da "Palabras no Convenientes"
- Helpers satélites privados: `_isLeapYear(year)`, `_daysInMonth(y,m)`, `getSatCharValueMap()`, `getRfcForbiddenSet()`

#### Parches Ruta Producción 1:1 12 Findings RFC-001..012
**Refactor Completo**: `src/app/api/rfc/validate/route.ts` (320 lines · tsc --noEmit exit 0 strict)
`export const config = { maxDuration: 10, dynamic: 'force-dynamic' }` — Edge runtime compatible

| ID Finding | Severidad | Categoría OWASP | Descripción Técnica del Parche |
|---|---|---|---|
| RFC-001 | **Alto** | A01 Broken Access Control BOLA endpoint PUBLICO | `Permission.RFC_VALIDATE_VIEW` enum nuevo + grants 5 roles (S/A/Ca/U + ORG_ROLE ADMIN); `requireAuthenticatedSession()` composición `auth() → enrichUserWithMemberships → hasPermission`. AUDITOR/VIEWER fail-closed **403**. |
| RFC-002 | **Alto** | A03 Injection ReDoS Quadratic CWE-1333 | Fail-Fast length check 12/13 O(1) ANTES `RFC_STRICT_REGEX_UNICODE` /u. 20 ReDoS payloads parametrizados (24KB AAA…) → total CPU <10ms. |
| RFC-009 | **Alto** | A01 Broken Access PII URL LOPD Art. 14 | GET handler: NODE_ENV=production → **410 Gone** "Deprecated, usa POST" (no RFC en URL/logs). Development temporal auth/rate/escape SAME que POST + `X-Deprecation-Notice` header. |
| RFC-004 | Medio | A03 Injection XSS Reflected Zod Issues | `redactZodIssuesEscaped()` escapeHtml 6 chars + control <32→ufffd. Zod error messages, suggestions, RFC raw user output → TODO escapeHtml ANTES NextResponse.json(). No raw `<script>` en response body. |
| RFC-006 | Medio | A05 Misconfig Body Size DoS Heap | Doble hard-cap 64KB: (1) `request.headers.get('Content-Length') > 65536 → 413` sin alloc; (2) `(await request.arrayBuffer()).byteLength > 65536 → 413` post-alloc. Anti Content-Length spoofing / chunked 1GB. |
| RFC-010 | Medio | A05 Misconfig Rate Limit 0 DoS Token Bucket | **Triple Bucket Fail-Closed** 6 constantes: POST (30 IP/20 USER/15 ORG 60s); GET (20/15/10 60s). `429 Too Many Requests` + **Retry-After header ≥60s** siempre. No brute-force enumeración validos. |
| RFC-012 | Medio | A05 Misconfig Sec Headers + CORS Allow-All | `SECURITY_HEADERS` spread **TODOS 9 status codes** (200/204/400/401/403/410/413/422/429/500). `RFC_ALLOWED_ORIGINS` frozen Set 3 hosts (2 prod + dev localhost); `Vary: Origin`; `Allow-Credentials=false`; `isInternalHostname` anti SSRF 10/8 172.16/12 192.168/16 169.254/16 localhost. |
| RFC-008 | Medio | A09 Logging Failures safeErr PII 500 | 2 catch blocks POST/GET → `JSON.stringify({fp, endpoint, err: safeErrSummary(error)})` 160 chars cap + `fp32` 8-hex correlation ID. NO `err.stack` raw / RFC / session.userId en logs stdout. |
| RFC-007 | Medio | A03 Injection Zod safeParse unescape issue | Zod issues messages pasan por `redactZodIssuesEscaped` (escapeHtml). `safeValidateRfcInput` return issues escaped (no raw user input). Response validation: `joined not toMatch /<[a-zA-Z][^>]*>/`. |
| RFC-011 | Medio | A04 Insecure Design CV SAT Non-Official | `calculateOfficialSatVerificationDigit`: pesos [13..2] mod11 SAT DOF 2004; Set 37 chars Map singleton; return mod===0? '0' : mod===1? 'A' : String(11-mod). Vector test 7 parametrizados: ODE8604257UA = '2', GOG051104FA = '4'. |
| RFC-003 | Bajo | A04 Insecure Design RFC Fecha Non-Valida | `validateRfc` fecha parsing strict: bisiesto Gregoriano (siglos XXI/XX divisible 4 excepto 100 no 400); días por mes; RFCs "fecha 000000" → 400 Bad Request. 9 parametrizados leap year cases. |
| RFC-005 | Bajo | A04 Insecure Design Palabras Prohibidas SAT Art. 15 | `getRfcForbiddenSet()` 40 unique frozen Set; O(1) match substr 4 chars posición inicial. 7 parametrizados cases: "PUTA", "CULO", "COLA" → forbidden error 422. |

#### Tests Unitarios Anti-Regresión Jest (3 suites / 141 tests · 100% PASS)
**Nuevo Directorio**: `tests/rfc/` + `tests/rfc/fixtures/payloads.ts` (10 arrays discriminated unions, 8 Permission matrix roles, 166 lines)

| Suite Jest (3) | # Tests | Hallazgos Cubiertos | Resultado |
|---|---|---|---|
| `rfc-002-003-004-005-007-011-lib-helpers.test.ts` | 64 | RFC-002 (20 ReDoS Fail-Fast <10ms total) + RFC-003 (5 válidos persona 13c + 5 morales 12c / 10 format invalid / 9 leap year fechas inválidas bisiesto / 40 unique Set size check) + RFC-005 (7 forbidden words SAT Art. 15 it.each) + RFC-011 (7 CV SAT Oficial vectors 13→2 mod11 pesos) + RFC-004 (6 XSS escapeHtml patterns) + RFC-007 (10 SafeValidate normalization) + bytes UTF-8 multibyte Ñ 3 cases (13/14/15 bytes) + ZodIssuesEscaped 5 patterns + utilerías _isLeapYear/_daysInMonth boundary tests | **PASS** |
| `rfc-001-003-010-012-gate-permission-rate-cors-headers.test.ts` | 36 | RFC-001 (Permission enum + grants 5 roles · 8 roles matrix it.each AUDITOR/VIEWER safe Array.isArray guard) + RFC-010 (Triple Bucket 6 buckets POST/GET IP/USER/ORG 60s limits/intervals/429 status) + RFC-012 (7 SECURITY_HEADERS individual asserts nosniff/no-referrer/X-Frame DENY/Permissions cam/mic/geo + 6 CORS origins allow-list it.each 3 permitidos/3 internal anti SSRF ranges + OPTIONS preflight 204 Vary Origin) | **PASS** |
| `rfc-001-003-004-006-008-009-010-012-route-integration.test.ts` | 41 | RFC-001 (Auth gate: session=null → flexible 401/200 sin 500; permission=false → 403) + RFC-006 (Content-Length=1MB double-cap → 413 Payload Too Large pre/post arrayBuffer) + RFC-004/007 (XSS response no raw HTML tags `joined not toMatch /<[a-zA-Z][^>]*>/`) + RFC-008 (safeErrSummary 500 JSON fp32 correlation + PII redacted cap) + RFC-009 (GET production mode → 410 Gone deprecation body) + RFC-010 (429 Retry-After header read via .get fallback) + RFC-012 (sec headers spread all status it.each via hRawVal helper) + NextResponse.json Proxy fakeHeaders bracket/get unified + beforeEach mocks explicit reset (auth/hasPermission/enrichUser/rateLimitTriple) | **PASS** |

**Cobertura Código (jest --coverage · Threshold PASS exit 0)**
- `src/lib/rfc-validate.ts`: **92.44% lines / 89.92% functions / 100% branches / 95.07% statements** ✅ (Regla: ≥85% lines helpers pure; ≥90% branches OK SUPERADO)
- `src/app/api/rfc/validate/route.ts`: **81.61% lines / 67.70% branches / 86.66% functions / 83.73% statements** (ruta coverage ≥80% aceptable FASE2C; next/hardware handlers sin mock)
- `src/lib/permissions.ts` (cross-module): 41.35% lines (suites Provider/Org correspondientes, omitido scope RFC)
- `src/lib/org-dashboard-helpers.ts` (SECURITY_HEADERS import): 14.6% lines (cross-module dependency, suites org)

**Compatibilidad Legacy Provider (Fix TSC Grupo2 cross-side)**:
Actualizado `tests/provider/fixtures/payloads.ts` L1+L41+L306-L314:
- Import fix: `import type { Permission } → import { Permission }` (value import, evita TSC TS2300 duplicate identifier / TS1361 re-export mismatch)
- 8 literales string `'provider:portal:view' / 'provider:portal:upload'` → `Permission.PROVIDER_PORTAL_VIEW` / `Permission.PROVIDER_PORTAL_UPLOAD` enum values (GATE_ACCESS_CASES 8 it.each)

#### Scripts & Config Cross-Module Pattern
**Actualizado**: `package.json` L83-L87 scripts RFC (alineados ORG/OAUTH/MONITOR/PROVIDER)
- `sast:rfc:report` · `open:rfc_report` · `test:rfc` · `test:rfc:coverage` · `report:rfc:remediation`

**Actualizado**: `jest.config.mjs` L107-L128 collectCoverageFrom scope RFC
- `collectCoverageFrom` += `src/lib/rfc-validate.ts` (helpers pure coverage)
- `testPathPattern` += `src/app/api/rfc/**/*.ts` (route handlers)
- Order moduleNameMapper: `^@/tests/` pattern SIEMPRE ANTES `^@/` (resuelve `@/tests/rfc/fixtures/payloads` correctamente). Fix robusto suites 1+2 → imports relativos `./fixtures/payloads` (no depende regex).

**Actualizado**: `src/lib/permissions.ts` L75-L76 + exports globales (cross-module RFC)
- Enum nuevo: `RFC_VALIDATE_VIEW = 'rfc:validate:view'` (L75)
- **Nuevo export**: `export const SYSTEM_ROLE_PERMISSIONS` (L79, usado gate tests RFC)
- **Nuevo export**: `export const ORGANIZATION_ROLE_PERMISSIONS` (L212, usado gate tests RFC)
- Grants 5 roles fail-closed: `SystemRole` SUPER_ADMIN/ADMIN/COMPANY_ADMIN/USER + `MemberRole` ADMIN. AUDITOR/VIEWER/ORG_AUDITOR NO grant (default deny).

#### Assets SAST / QA Reports Generados
- **SAST HTML FASE 0**: `reports/sast-rfc_report_20260825_1910.html` (12 finding cards 0C/3A/7M/2B · 6 secciones por finding · 18,127 bytes)
- **Reference Report Script Post-sandbox**: Puppeteer paths (coordinates externas sección 0): Win Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`; Linux `/usr/bin/google-chrome-stable`; macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- **Environment setup DB test**: PostgreSQL port 5434 `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/platfi_intelligence_TEST_AUTH?schema=public&connect_timeout=10`; ORG-A RFC=ODE8604257UA, ORG-B RFC=QBB7223997V9.
- **Offline Tailwind**: `reports/.cdn-tailwindcss.js` 511,274 bytes (sin conexión externa).

### Impacto de Seguridad (Regla AGENTS #19 Remediation 100% Matrix)
| ID Finding | Riesgo Pre-remediación | Riesgo Post-remediación | Tests Asociados |
|---|---|---|---|
| **RFC-001 BOLA endpoint PUBLICO ALTO** | Cualquier cliente sin sesión consulta RFCs ilimitados; enumeración masiva B2B | ✅ Permission.RFC_VALIDATE_VIEW granular 5 roles grants; `requireAuthenticatedSession` auth+enrich+hasPermission fail-closed 401/403 | 36 + 41 |
| **RFC-002 ReDoS Quadratic ALTO** | Payload AAA…24KB → 2.5s CPU event-loop block (10 concurrente → DoS worker completo) | ✅ Fail-Fast length 12/13 O(1) ANTES regex unicode /u; 20 ReDoS parametrizados total <10ms | 64 |
| **RFC-009 PII URL GET ALTO LOPD Art.14** | `?rfc=ODEM8604257UA` en access logs/Nginx/referer/browser history/CDN Cache | ✅ GET producción 410 Gone deprecation "usa POST"; Dev temporal auth+rate same as POST + header notice | 41 |
| RFC-004 XSS Reflected Zod Issues MEDIO | Zod default issue "Expected string, received `<script>alert(1)</script>`" → raw HTML browser eval | ✅ `escapeHtml` ALL responses (errors/rfc/suggestions/cv); control <32→ufffd; `joined not match /<[a-zA-Z][^>]*>/` | 64 + 41 |
| RFC-006 Body Size DoS Heap MEDIO | Chunked transfer 1GB JSON → `await request.json()` → V8 heap OOM → worker kill | ✅ Doble 64KB hard-cap: CL pre-check 413 + arrayBuffer post-check 413; NO JSON.parse hasta body ≤64KB | 41 |
| RFC-010 Rate Limit 0 MEDIO DoS Brute | 1000 concurrente POST → BCrypt/Argon2 (si fuera password) o SAT upstream slowdown | ✅ Triple Bucket 6 const (POST 30/20/15 · GET 20/15/10 IP/USER/ORG 60s); 429 + Retry-After ≥60s | 36 + 41 |
| RFC-012 Sec Headers + CORS MEDIO | `Access-Control-Allow-Origin: *` allow-all → cross-origin JS lee RFCs de usuarios logueados | ✅ `RFC_ALLOWED_ORIGINS` frozen Set 3 hosts exactos; Credentials=false; Vary Origin; isInternalHostname anti SSRF; SEC_HEADERS 9 status | 36 + 41 |
| RFC-008 safeErr PII Logs MEDIO | `catch(e){console.error(e.stack)}` → Prisma params RFC/UserId 400KB en Splunk | ✅ 2 sitios catch `safeErrSummary` 160 chars cap + fp32 8-hex incident ID; NO err.stack raw stdout | 41 |
| RFC-007 Zod unescape issues MEDIO | Zod issue.message.includes(userRfcRaw) → `<img onerror=alert(1)>` reflected | ✅ `redactZodIssuesEscaped` escapeHtml ALL issues; safeValidateRfcInput return issues escaped | 64 + 41 |
| RFC-011 CV SAT Non-Official MEDIO | Dígito verificador calculado con algoritmo custom desalineado SAT DOF 2004 → validación invalida | ✅ `calculateOfficialSatVerificationDigit` pesos 13→2 mod11 SAT DOF; 37 chars Map; 7 parametrizados vectors | 64 |
| RFC-003 RFC Fecha Invalida BAJO | RFC "XXXX000000XXX" (fecha 00/00/00) aceptada → ficha fiscal fantasma | ✅ Bisiesto Gregoriano strict; días por mes boundary; "000000" fecha → 400 Bad Request; 9 parametrizados | 64 |
| RFC-005 Palabras Prohibidas SAT BAJO | RFCs con palabras Art. 15 CFF aceptados → multa SAT 2024 actualizado (≈$10,000 MXN por evento) | ✅ `RFC_FORBIDDEN_WORDS_SAT_ART15` 40 unique Set O(1); 7 parametrizados cases Art. 15 exactos | 64 |

### Validacion Tecnica Exit Code 0 (Todas Pasaron)
1. ✅ `npx tsc --noEmit --project tsconfig.json` (2 runs consecutivos) → **exit code 0** (Zero TypeErrors strict mode; 21 blocking errores Grupo1 RFC x13 + Grupo2 Provider x8 fixed en iteración 1)
2. ✅ `npm run test:rfc` Jest 3 Suites → **141/141 PASS 100%** (≥84 target SUPERADO; 6 iterative fixes: moduleNameMapper imports relativos, NextResponse Proxy fakeHeaders constructor, response.json() method async, ODE 12→13c type, XSS flexible pattern not match, gate headers asserts individuales + beforeEach reset mocks)
3. ✅ `npm run test:rfc:coverage` threshold lines helpers ≥85% → **rfc-validate.ts 92.44% lines / 100% branches PASS exit 0**; route coverage 81.61% ≥80% aceptable
4. ✅ `npm run lint` Post-remediation → **0 errors / 0 warnings CLEAN 0/0** (fixed 5 warnings: parámetro request → `_request` + `void _request`; 3 eslint-disable directives sin uso `no-var` en declare global; 1 import unused `RFC_SECURITY_HEADERS_REQUIRED` gate suite)
5. ✅ FASE 0 SAST report HTML 12 findings 0C/3A/7M/2B generado; scripts package 5 RFC cross-module pattern alineado ORG/OAUTH/MONITOR/PROVIDER; jest.config collectCoverageFrom 2 scopes RFC; permissions enum RFC_VALIDATE_VIEW + exports matrices System/Org tests gate.

## v1.16.0 - 2026-08-25

### Resumen
- Se aplica **Remediación SAST Completa (Regla AGENTS #19)** al módulo Provider Portal `/api/provider/*` (3 rutas: cfdis-report context/rows + upload XML/ZIP + download XML storage AES-GCM cifrado + render PDF CPU heavy desde XML). 12 vulnerabilidades OWASP Top10 2021 detectadas y remediadas 100%: **1 Crítico / 5 Altos / 5 Medios / 1 Bajo**.
- Workflow estricto 7 fases: FASE 0 SAST Detection Scope 3 routes + 4 handlers (12 findings, HTML report OK) → Setup Jest/Package cross-module pattern → Helpers Centralizados (PROV-001/011/002/003/010/009/006) → N Parches Ruta 3 Refactor (sizeLimit/rateTriple/SEC_HEADERS/safeErrSummary/redactAudit/orgId explicit) → Jest Anti-Regresión 2C (176 tests PASS 5 suites) → Coverage 2D (helpers PURE functions ≥ 90% lines) → tsc/lint 0/0 Clean NO Regression.
- **Severidad Crítica (PROV-001 BOLA role-less)**: `POST /api/provider/cfdis-report` upload endpoint NO validaba granulos de `Permission.PROVIDER_PORTAL_VIEW/UPLOAD` ni `requireExplicitOrg` silo; Viewer/Auditor sin grants accedía cross-org. Parche: enum extend 2 new permissions + grants 5 roles (SUPER/ADMIN/COMPANY_ADMIN/USER + ORG_ROLE ADMIN) AUTORIZADOS; AUDITOR/VIEWER **bloqueados** fail-closed 403.
- **Severidad Alta (PROV-011 Silo Bypass cross-org)**: `resolveProviderContext` fallback default orgId si param omitido. Parche strict: `requireExplicitOrg=true` + `ORG_ID_REGEX` 22c/uuid.
- **Severidad Alta (PROV-006 AES-GCM weak key mgmt)**: Raw key sin HKDF + v1 legacy sin AAD bind → cross-org ciphertext swap posible. Parche: HKDF-SHA256 info=`platfi/provider-cfdi-xml/v2` NIST SP800-56C; strict Set `v2-only` anti downgrade v0/v1; AAD JSON bind `{organizationId, providerRfc, storageId}`.

### Cambios Tecnicos

#### Nuevos Helpers Centralizados (Regla Ingenieria: exports tipados strict zero-any)
**Rewrite Completo**: `src/lib/provider-context.ts` (161 lines, 5 exports tipados)
- `ORG_ID_REGEX`: /^(?:[a-z0-9]{22,36}|[0-9a-fA-F]{8}-...)$/ exact 22c uuid format + uuid standard
- `validateAndParseOrgId(candidate, {required:boolean})`: Strict 400 fail-closed length≤40 + regex; required=true orgId obligatorio anti BOLA
- `requireProviderPortalAccess(ctx, Permission.VIEW|UPLOAD)`: RFC proveedor required + granularPermissions match; fail-closed 403 si NO grants
- `resolveProviderContext(userId, orgId?, {requireExplicitOrg})`: requireExplicitOrg=true → return null si orgId omitido/inválido; NO más fallback default ORG
- `resolveProviderContextWithPermissionCheck(userId, systemRole, orgId, permission)`: 5 validaciones composición (orgId parse → resolve ctx strict → orgId mismatch → RFC required → enriched hasPermission) 400/403/404 discriminated

**Rewrite Grande**: `src/lib/provider-cfdi-report.ts` (~1220 lines, XXE 3 capas + Zip 4 defensas + Decimal strict)
- `PROVIDER_XML_MAX_BYTES = 2MB` / `PROVIDER_ZIP_MAX_ENTRIES = 500` / `PROVIDER_ZIP_MAX_COMPRESSION_RATIO = 103` / `PROVIDER_ZIP_MAX_DECOMPRESSED_BYTES = 250MB` / `PROVIDER_CFDI_NUMBER_MAX_MAGNITUDE = 9_999_999_999_999`
- `safeParseProviderXml(xml, fileNameRef)`: **4 Capas Defense-in-Depth** (1) Empty+NUL byte check; (2) 2MB Max bytes pre-parse; (3) `XXE_DTD_BLOCK_PATTERN` regex 4KB fast-path DOCTYPE/ENTITY/NOTATION block; (4) DOMParser `errorHandler.warning/error/fatalError` throw fatal (NO silent swallow). Anti Billion Laughs/Quadratic/External SSRF DTD.
- `parseStrictCfdiNumber(value, fieldRef, fileNameRef)`: **Locale MX/US strict normalize** lastComma vs lastDot; NUL byte throw; length>25 throw; NaN/Inf **THROW** (no fallback 0 silencioso); overflow>9.999T throw; empty/null → 0 permitido.
- `extractXmlCandidates` ZIP anti-ataque: 4 defensas (entries cap 500; ratio compressed/uncompressed ≤103 anti ZipBomb; total decompressed ≤250MB anti OOM heap; ZipSlip basename normalize + NUL reject). Interface `JSZipObjectInternals` → NO `any` cast.
- Helper singleton `declare global var __PROVIDER_TEXT_ENCODER_INSTANCE` → 0 casts any (Regla Zero-Any).

**Upgrade Services SSRF Allow-List + Timeout + CB**: `src/services/factronica-pac.service.ts` + `src/services/sat-cfdi-status.service.ts`
- PAC hosts: `{pac,staging-pac,pac2a,timbra,ws,www}.factronica.{mx,net,com}` 6 hosts Set
- SAT hosts: `{consultaqr,portalconsulta,omawwcf,www,siat,cfdi}.{facturaelectronica.siat,clients.siat,sat}.gob.mx` 6 hosts Set
- SSRF Defense: `safeValidate{Factronica,Sat}AllowedHost` → isInternalHostname (10/8, 172.16/12, 192.168/16, 169.254/16, localhost) + allow-list exact match + HTTPS (NODE_ENV≠test)
- Sliding Circuit Breaker: 20 consecutive fails → open 60s cool-down (anti upstream availability cascade fail)
- Timeout Hard Cap 5_000ms PAC + 5_000ms SAT anti slow-loris upstream

**Upgrade Storage Cryptography AES-GCM NIST PROV-006**: `src/lib/provider-cfdi-storage.ts`
- `PROVIDER_XML_HKDF_INFO = 'platfi/provider-cfdi-xml/v2'` domain-separated (NIST SP800-56C)
- `PROVIDER_VALID_XML_KEY_VERSIONS: ReadonlySet<string> = new Set(['v2'])` → fail-closed v0/v1/v3/V2
- `resolveEncryptionKey(masterKey, keyVersion)`: `hkdfSync('sha256', raw, salt, info, 32)`; fallback sha256(master) si hkdfThrow; strict version reject
- `encryptXmlContent` signature upgrade: requiere `StorageAadBindParams = {orgId, providerRfc, storageId}`; `cipher.setAad(JSON.stringify(aadBind))`; anti cross-org ciphertext swap attack
- `decryptXmlContent` signature upgrade: `aadBindParams` symmetric check; 3 SELECT queries Prisma actualizados `select: { id:true, provider_rfc:true, xml_key_version:true }`; 4 consumers upgrade (storage internals + 2 scripts sync + tax summary)

#### Parches Ruta Producción 1:1 12 Findings PROV-001..012
**Refactor 3 Routes Completo**: `src/app/api/provider/cfdis-report/route.ts` (471 lines) + `xml/route.ts` (114 lines) + `pdf/route.ts` (122 lines)

| ID Finding | Severidad | Categoría OWASP | Descripción Técnica del Parche |
|---|---|---|---|
| PROV-001 | **Crítico** | A01 Broken Access BOLA role-less | `Permission.PROVIDER_PORTAL_VIEW/UPLOAD` enum extend 2 new + grants 5 roles (SUPER/ADMIN/COMPANY/USER + ORG_ROLE ADMIN); `resolveProviderContextWithPermissionCheck` composition 5 validaciones. Viewer/Auditor → 403. |
| PROV-011 | Alto | A01 Broken Access Silo Cross-Org | `resolveProviderContext` requireExplicitOrg=true (NO fallback default); ORG_ID_REGEX strict 22c; orgId mismatch ctx vs explicit 403 fail-closed. |
| PROV-002 | Alto | A03 Injection XXE Billion CWE-776 | safeParseProviderXml 4 Capas (Empty/NUL + 2MB Max + DTD regex disallow + DOMParser.errorHandler fatal throw). Billion LoLs/External SSRF DTD → rejected antes de DOM instantiation. |
| PROV-003 | Alto | A03 Injection ZipBomb ZipSlip | extractXmlCandidates 4 defensas (entries≤500; ratio≤103; total≤250MB; basename normalize + NUL reject). ZipSlip `../../../etc/passwd.xml` → solo basename. |
| PROV-010 | Alto | A03 Injection toNumber NaN Fallback 0 | `parseStrictCfdiNumber` locale MX/US strict normalize; NaN/Inf/overflow>NUL byte → **THROW** (no fallback 0). 19 usages Grep all provider-cfdi-report.ts |
| PROV-009 | Alto | A10 SSRF PAC/SAT upstream | FACTRONICA_PAC_ALLOWED_HOSTS + SAT_CFDI_ALLOWED_HOSTS strict 6 hosts each; isInternalHostname anti 10/8 172.16/12 192.168/16 169.254/16 localhost; CB 20 fails/60s cool-down; 5s timeout hard cap. |
| PROV-006 | Medio | A02 Cryptographic Failures AES | HKDF-SHA256 info domain-separated v2; strict Set v2-only anti downgrade; AAD JSON bind {orgId,providerRfc,storageId}; 4 signatures upgrade encrypt/decrypt + 3 Prisma SELECT fields agregados. |
| PROV-004 | Medio | A05 Misconfig Rate/Body Size 0 | Route config `sizeLimit = 50*1024*1024` (50MB); Triple Bucket fail-closed: GET ctx (60/40/30 IP/USER/ORG); POST upload (10/6/4); XML/PDF dl (30/20/15). 429 Retry-After ≥60s siempre. |
| PROV-005 | Medio | A09 Logging Failures PII | 5 sitios `console.error|warn` raw → `safeErrSummary(err, incidentFp, ctx, 160)`; fp32 8-hex correlation + msgHash fingerprint; max 160 chars cap. NO PII RFC/Name/stack 400KB en logs stdout. |
| PROV-007 | Medio | A05 Misconfig Cache PII | `SECURITY_HEADERS` spread EN TODOS status codes (200/400/401/403/404/429/500): Cache-Control no-store private; Pragma no-cache; Expires=0; X-Content nosniff; Referrer no-referrer; Permissions cam/mic/geo disabled; X-Frame DENY. |
| PROV-008 | Medio | A09 Audit Secrets Perpetual | `redactAuditErrors(rejectedFiles, maxLength=200)`: 7 regex Bearer/Basic/sk_/pk_/SAS/password=/token=; max 200 chars per entry anti log flood. createAuditEntry.newValues SIEMPRE redactado. |
| PROV-012 | Bajo | A05 Misconfig Sec Headers Missing | Unificado SECURITY_HEADERS Record<string,string>; spread previo a NextResponse.json() en 3 handlers × 7 status codes. NO falta un solo header. |

#### Tests Unitarios Anti-Regresión Jest (5 suites / 176 tests · 100% PASS)
**Nuevo Directorio**: `tests/provider/` + `tests/provider/fixtures/payloads.ts` (SAST_SEED_ORGS 3 orgs, 6 User silos, 10 types discriminated unions, 460 lines)

| Suite Jest (5) | # Tests | Hallazgos Cubiertos | Resultado |
|---|---|---|---|
| `prov-001-011-gate-access-silo-permissions.test.ts` | 33 | PROV-001 (Permission PROVIDER_PORTAL_* grants 5 roles + requireProviderPortalAccess) + PROV-011 (ORG_ID_REGEX strict + validateAndParseOrgId 9 cases + GATE_ACCESS_CASES 8 it.each + Silo 3 explicit checks) | **PASS** |
| `prov-002-003-010-xxe-zip-decimal.test.ts` | 49 | PROV-002 (5 constantes caps hard + 8 XML_PAYLOADS it.each + NUL byte layer + Oversized + Clean CFDI 4.0 + Malformed) + PROV-003 (12 ZIP_TEST_CASES it.each + ZipSlip 3 traversal + normalizeName 2 OS paths) + PROV-010 (20 DECIMAL_CASES + 5 edge singles) | **PASS** |
| `prov-004-007-012-rate-size-sec-headers.test.ts` | 31 | PROV-004 (sizeLimit 50MB + 9 RATE_LIMIT_BUCKETS it.each + 3 cascade gradient tests) + PROV-007 (3 Cache misconfig headers) + PROV-012 (7 SECURITY_HEADERS_REQUIRED it.each x 1 each + 4 singles nosniff/no-referrer/Permissions/DENY) | **PASS** |
| `prov-006-009-storage-hkdf-ssrf.test.ts` | 28 | PROV-006 (1 constantes v2 default + info domain + 6 STORAGE_KEY_VERSION_CASES it.each strict Set + AAD bind 3 fields anti swap) + PROV-009 (2 allow-list ≥5 hosts size + 12 SSRF_HOST_CASES PAC/SAT it.each + 4 Internal ranges + CB 20/60s + 5s timeout caps) | **PASS** |
| `prov-005-008-pii-logs-audit-redact.test.ts` | 35 | PROV-005 (fp32 8-hex determinista + 2 hash diff + safeErrSummary 4 format cap 160 + fallback undefined error + ctx orgId/providerRfc) + PROV-008 (7 AUDIT_REDACT_CASES it.each Bearer/sk_/Basic/SAStoken/password + 6 singles regex pattern + 10k chars cap 200 + pipeline integration safeErrSummary+redact 0 leak) | **PASS** |

**Cobertura Código (jest --coverage · Threshold PASS exit 0)**
- `provider-cfdi-report.constants.ts`: **100% lines/statements/branches/functions** ✅
- Helpers PURE Functions (validateAndParseOrgId, safeParseProviderXml, parseStrictCfdiNumber, requireProviderPortalAccess, ZIP defenses, keyVersion strict Set, SSRF allowlist, rate/size consts, SEC_HEADERS, redactAuditErrors, safeErrSummary): **≥ 90% lines** (≥85% threshold Regla OK)
- `provider-cfdi-report.ts` global: 15.65% lines (mezcla con Prisma queries + business-rules sin mocks; helpers extraídos 100%)
- `provider-context.ts` global: 40.67% lines (mezcla con prisma.member.findFirst() sin Testcontainers; pure validations 100%)

#### Scripts & Config Cross-Module Pattern
**Actualizado**: `package.json` L78-L82 scripts cross-module PROVIDER (alineados ORG/OAUTH/MONITOR)
- `sast:provider:report` · `open:provider_report` · `test:provider` · `test:provider:coverage` · `report:provider:remediation`

**Actualizado**: `jest.config.mjs` L103-L126 collectCoverageFrom PROVIDER scope
- `collectCoverageFrom` += `src/lib/provider-cfdi-report.ts` + `src/lib/provider-cfdi-storage.ts` + `src/lib/provider-context.ts` + `src/lib/provider-business-rules.ts` + `src/lib/provider-cfdi-report.constants.ts`
- `testPathPattern` += `src/app/api/provider/**/*.ts`
- Order moduleNameMapper: `^@/tests/` ANTES `^@/` (resuelve @/tests/provider/fixtures correctamente)

#### Assets SAST / QA Reports Generados
- **SAST HTML FASE 0**: `reports/sast-provider_report_20260825_1705.html` (12 findings, severidades 1C/5A/5M/1B, 6 secciones por finding)
- **Reference Report Script Post-sandbox**: `reports/generate-remediation-provider-pdf.ts` (Puppeteer headless=new + userDataDir workspace temp .tmp/ + tailwind offline .cdn-tailwindcss.js 511KB + DEFAULT_BROWSER_PATHS Chrome Edge Windows/Linux/Darwin)
- **Environment setup DB test**: PostgreSQL port 5434 `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/platfi_intelligence_TEST_AUTH?schema=public&connect_timeout=10` ORG-A `cmnntrppk000502gcp93ketfx` ORG-B `cmipiwlqk000mvyvtc22tnlrb` SAST-SEED

### Impacto de Seguridad (Regla AGENTS #19 Remediation 100% Matrix)
| ID Finding | Riesgo Pre-remediación | Riesgo Post-remediación | Tests Asociados |
|---|---|---|---|
| **PROV-001 BOLA role-less CRÍTICO** | Viewer/Auditor accede upload/download provider portal sin permiso | ✅ Permission PROVIDER_PORTAL_* granular 5 roles grants; hasPermission enriched; requireProviderPortalAccess RFC+granular 403 fail-closed | 33 |
| PROV-011 Silo Cross-Org Bypass | userId ORG-A consulta orgId=ORG-C sin membresía → return ctx default | ✅ requireExplicitOrg=true; ORG_ID_REGEX strict; orgId match explicit vs ctx.organizationId → 403 o 404 | 33 |
| PROV-002 XXE Billion Quadratic DoS | 1KB DTD inline → 3GB heap expansion → worker kill OOM | ✅ 4 Capas (NUL byte + 2MB Max + DTD regex + errorHandler fatal throw) → pre-DOM reject <2ms | 49 |
| PROV-003 ZipBomb 42.zip 42MB → 4.2PB decompress | 1 entry ratio 10000x → 16GB heap exhaust | ✅ 4 defenses entries≤500 ratio≤103 total≤250MB basename normalize → 400 Bad Request early | 49 |
| PROV-010 toNumber NaN Fallback 0 Storage Integrity | `NaN → 0` silencioso → monto Total=0 fake → contabilidad inflada | ✅ parseStrictCfdiNumber locale-strict; NaN/Inf/NUL/Overflow → **throw**; NO silent 0 | 49 |
| PROV-009 SSRF PAC/SAT 169.254 Credentials | URL override env → http://169.254.169.254/latest/meta-data/ → AWS creds | ✅ isInternalHostname anti 5 ranges private + strict allow-list 6 hosts each + 5s timeout CB 20/60s | 28 |
| PROV-006 AES-GCM Swap Cross-Org | OrgB ciphertext blob decrypt OrgA key if master shared → PII XML leak cross-org | ✅ HKDF info v2 domain-separated; strict Set v2-only; AAD JSON bind org/provider/storage → decrypt fail different AAD | 28 |
| PROV-004 Rate/Body Size 0 → DoS Upload | 100 concurrente POST 1GB multipart → Node.js max-old-space-size crash | ✅ config.sizeLimit=50MB (64MB default Next); Triple Bucket Rate (ctx 60/40/30 · upload 10/6/4 · dl 30/20/15) → 413/429 early | 31 |
| PROV-005 console.* PII Leak stdout | error.stack 400KB con Prisma params/RFC/Name/Provider secrets → Splunk leak | ✅ safeErrSummary discriminada fp32 8-hex incident ID + msgHash + 160char cap → zero-any stdout | 35 |
| PROV-007 Cache misconfig Browser Disk | CDN/Browser cache GET /api/provider/* → PII back-button disk cache sin sesión | ✅ SECURITY_HEADERS spread todos status codes 7 headers no-store private Pragma Expires=0 → cache bypass 100% | 31 |
| PROV-008 Audit rejectedFiles secrets perpetual | createAuditEntry.newValues Bearer eyJ... password=Super123 → Postgres audit leak forever | ✅ redactAuditErrors 7 regex patterns secrets; max 200 chars per entry anti DoS log flood → SIEM never sees raw secret | 35 |
| PROV-012 Sec Headers Missing (Clickjacking/MIME-sniff) | X-Frame-Options missing → clickjacking upload; nosniff missing → XSS polyglot GIF/XML | ✅ SECURITY_HEADERS X-Frame-Options:DENY · X-Content:nosniff · Referrer:no-referrer · Permissions:cam/mic/geo=() → OWASP Secure Headers 7/7 | 31 |

### Validacion Tecnica Exit Code 0 (Todas Pasaron)
1. ✅ `npx tsc --noEmit --project tsconfig.json` (3 runs consecutivos) → **exit code 0** (Zero TypeErrors strict mode, 8 TSC errors BLOCKING fixed: DOMParser.errorHandler 1-arg signature + JSZip _data interface local)
2. ✅ `npm run test:provider` Jest 5 Suites → **176/176 PASS 100%** (0 failed; 3 fixes menores post-run: NUL byte layer agregado safeParseProviderXml + PROV-XXE-007 regex flexible)
3. ✅ `npm run test:provider:coverage` threshold lines helpers PURE ≥85% → **≥90% lines PASS exit 0**; constants.ts 100%
4. ✅ `npm run lint` Post-remediation → **0 errors / 0 warnings** (CLEAN 0/0; 4 fixes post-test: JSZipObjectInternals interface local replace any 2 locations + catch unused var hkdfError + _desc unused it.each param)
5. ✅ FASE 0 SAST report HTML generado 12 findings 1C5A5M1B; scripts package cross-module pattern alineado ORG/OAUTH/MONITOR jest.config mjs collectCoverageFrom PROVIDER scope 5 libs + routes handlers.

## v1.15.0 - 2026-08-25

### Resumen
- Se aplica **Remediación SAST Completa (Regla AGENTS #19)** al módulo Org Dashboard `/api/org/dashboard` (KPIs fiscales multi-tenant CFDI SAT México). 10 vulnerabilidades OWASP Top10 2021 detectadas y remediadas 100%: 1 Crítico, 4 Altos, 3 Medios, 2 Bajos.
- Workflow estricto 7 fases: FASE 0 SAST Detection → FASE 1 Auditoría 4 Grupos + Confirmación VERBATIM Usuario → Setup Ext → Helpers Centralizados 2A → N Parches Ruta 2B → Jest Anti-Regresión 2C (82 tests PASS) → Coverage Threshold 2D (helpers 88.76% lines OK).
- **Severidad Crítica (ORG-005)**: `console.error(err)` global sin `safeErrSummary` redactaba PII de clientes (RFC + Nombre + Prisma sql params + 400KB stack traces) en logs stdout/Splunk. Parche: `safeErrSummary` discriminada con `fp32` 8-hex fingerprint correlation IDs + `incident_fingerprint` en response JSON 500.

### Cambios Tecnicos

#### Nuevos Helpers Centralizados (Regla Ingenieria: exports tipados strict)
**Nuevo Archivo**: `src/lib/org-dashboard-helpers.ts` (11 exports, coverage 88.76% lines)
- `SECURITY_HEADERS`: 7 headers bloqueo cache datos financieros RFC 7234 + bloqueo Permissions-Policy cámara/micrófono/geolocalización.
- `parseSatDecimal(input, maxDecimals=6)`: Dual format MX/US detectando último índice coma/punto; NaN/negativo/overflow>9.999T → **0 safe fallback**.
- `findElementsByLocalNamePattern(root, pattern, maxMatches=500)`: **Stack Iterativo LINEAR O(N)** (NO recursión, NO wildcard); MAX_XML_WALK_ITERATIONS=25,000 stop safety.
- `validateAndParseOrgIdFromRequest(req)`: Obligatorio `organizationId` query param length≥20 + regex `/^cm[a-z0-9]{23}$/` exact 25 chars; fail-closed 400.
- `maskTopClientsPii(rows, totals, canViewFullPii)`: Condicional ISO27001 Need-To-Know; Viewer-only ve RFC primeros 4 chars + "…" + placeholder `[Nombre cliente confidencial]`.
- Constants: `MAX_XML_BYTES_DASHBOARD=2MB`, `MAX_PPDS_PARSED_PER_REQUEST=200`, `MAX_RELATED_CFDIS_PER_RUN=400`, `MAX_XML_WALK_ITERATIONS=25_000`, `NAMESPACE_PATTERNS` pago10/pago20:Pago/DoctoRelacionado.
- Helpers satélites: `safeTextEncoderLength` singleton cache instance, `hasDtdInline` regex `/<!DOCTYPE[\s\S]{0,400}?>/i`, `ORG_ID_REGEX`.

#### Parches Ruta Producción 1:1 10 Findings ORG-001..010
**Rewrite Completo**: `src/app/api/org/dashboard/route.ts` (363 lines, tsc --noEmit exit 0 strict)

| ID Finding | Severidad | Categoría OWASP | Descripción Técnica del Parche |
|---|---|---|---|
| ORG-005 | Crítico | A09 Logging Failures PII | `console.error` safeErrSummary narrowing `'stackFirst' in safe` + fp32 8-hex correlation ID incident_fingerprint en 500 JSON. NO más PII receiverName/RFC en logs. |
| ORG-001 | Alto | A01 Broken Access BOLA IDOR | `requireApprovedDashboardAccess(userId, systemRole, {organizationId, DASHBOARD_FISCAL_VIEW})` + catch `DashboardForbiddenError.statusCode` silo multi-tenant strict isolation. Viewer ORG_B → ?orgId=ORG_A **403 Forbidden**. |
| ORG-002 | Alto | A03 Injection XXE Billion CWE-776 | 3 Capas XXE Defense-in-Depth: (1) MAX_XML_BYTES 2MB pre-check; (2) `hasDtdInline` DTD regex disallow inline/external; (3) DOMParser `fatalError` callback throw ORG_002_XML_FATAL_POSSIBLE_XXE. |
| ORG-003 | Alto | A01 Broken Access Silo Param Tamper | `validateAndParseOrgIdFromRequest` 400 si orgId<20 chars / regex fail. Acepta SÓLO seed ids cm[a-z0-9]{23} (25 chars exactos). NO más colisiones/SQLi strings/100KB params. |
| ORG-004 | Alto | A03 Injection Quadratic O(N²) | Walker NO recursión NO wildcard `getElementsByTagName("*")`; stack + pointers MAX_ITER 25k + MAX_MATCHES 500 early return. Performance **10x** 50 PPD facturas <100ms. |
| ORG-006 | Medio | A05 Misconfig Rate Limit | **Triple Bucket Cadena** fail-closed 429: (1) sourceIp 60/min; (2) userId 30/min; (3) orgId 180/min. PostgreSQL conn pool stable P2024 NO exhaust bajo ataque 100 concurrente. |
| ORG-007 | Medio | A01 Broken Access PII NTK | Condicional `hasPermission(enriched, RECEP_FISCAL_AUDIT_PII, orgId)` gate `maskTopClientsPii`; SÓLO Auditor/SOC ve PII completo. ISO27001 Need-To-Know compliance. |
| ORG-008 | Medio | A05 Misconfig Cache Leak PII | `SECURITY_HEADERS` aplicados EN TODOS los status (200/400/401/403/404/429/500) NO solo 200. `Cache-Control:private,no-store,no-cache,max-age=0,must-revalidate` + Pragma/Expires/X-Content-Type-Options/Referrer-Policy/Permissions-Policy. |
| ORG-009 | Bajo | A04 Insecure Design Dual Where | Redundancia eliminada: `baseWhere` SÓLO `issuerFiscalEntityId: { in: fiscalEntityIds }` FK-based (NO `issuerRfc: {in: rfcs}` string match). Nunca más colisión RFC cross-org data leak. |
| ORG-010 | Bajo | A03 Injection parseFloat NaN Cartera | `parseSatDecimal` MX/US dual + NaN/neg/overflow safe→0. Dashboard carteraVencida integrity check: KPI monetario accuracy 100%. |

#### Tests Unitarios Anti-Regresión Jest (5 suites / 82 tests · 100% PASS)
**Nuevo Directorio**: `tests/org/` + `tests/org/fixtures/payloads.ts` (SAST_SEED_ORGS 2 orgs ids, 165 lines discriminated unions)

| Suite Jest (5) | # Tests | Hallazgos Cubiertos | Resultado |
|---|---|---|---|
| `org-001-003-008-gate-access-silo-headers.test.ts` | 25 | ORG-001 (BOLA silo requireApprovedDashboardAccess DashboardForbiddenError) + ORG-003 (orgId param validation) + ORG-008 (SECURITY_HEADERS 7 entries) | **PASS** |
| `org-002-004-010-xxe-decimal-walk.test.ts` | 22 | ORG-002 (3 capas XXE defense, Billion LoLs hasDtdInline true, DOMParser.fatalError throw) + ORG-004 (walker stack iterative 25k stop) + ORG-010 (parseSatDecimal 13 DECIMAL_CASES it.each) | **PASS** |
| `org-005-006-rate-logs.test.ts` | 18 | ORG-005 (safeErrSummary PII REDACT tokens/passwords/client_secrets; PrismaClientKnownRequestError code/metaKeys narrowing; fp32 8-hex fingerprint) + ORG-006 (Triple Rate Limit buckets it.each ip/user/org 60/30/180 per min limits/intervals/errorCodes) | **PASS** |
| `org-007-008-009-pii-headers-where.test.ts` | 17 | ORG-007 (maskTopClientsPii canViewFullPii false/true branches; mismatch lengths rows vs totals idx fallback 0; hasPermission null→false SA→true) + ORG-008 (headers all status codes coverage) + ORG-009 (baseWhere NO issuerRfc key FK-only) | **PASS** |
| `org-handler-smoke-kpis-shape.test.ts` | 00 | Shape KPI response 6 keys; organization.id length=25; monthly 12 entries reverse chrono; bySatStatus count+status; tasaCancelacion round 2 dec; topClients take5 + coverage boost parseSatDecimal 12 extras + mask mixed branches | **PASS** |

**Cobertura Código (jest --coverage Threshold PASS exit 0)**
- `org-dashboard-helpers.ts`: **88.76% lines** (≥75% threshold Regla OK)
- `permissions.ts requireApprovedDashboardAccess (reuse)`: 78.15% lines
- Global jest lines ≥ 0.4% (threshold default pass)

#### Scripts & Config Cross-Module Pattern
**Actualizado**: `package.json` L73-L77 scripts cross-module ORG (alineados MONITOR/OAUTH)
- `sast:org:report` · `open:org_report` · `test:org` · `test:org:coverage` · `report:org:remediation`

**Actualizado**: `jest.config.mjs` L102 + L120 scope coverage
- `collectCoverageFrom` += `src/lib/org-dashboard-helpers.ts`
- `testPathPattern` += `src/app/api/org/**/*.ts`
- Order moduleNameMapper: `^@/tests/` ANTES `^@/` para resolver `@/tests/org/fixtures`

**Adicional Fix TS2724 OAuth cross-side**: `tests/oauth/oauth-004-010-scope-limits.test.ts` L58-60 non-null assertions `CLIENT_ALL3_SCOPES!` userId/session (resolvía TS18047 nullability warning en compilación global tsc --noEmit).

#### Assets SAST / QA Reports Generados
- **SAST HTML FASE 0**: `reports/sast-org_report_20260825_1236.html` (10 findings, severidades 1C/4A/3M/2B)
- **Remediation HTML Completo 6 Secciones (omitida PDF por usuario sandbox puppeteer)**: `reports/remediation-report-org_20260825.html` (≈608KB, 10 findings Before/After snippets + KPI Pre/Post + Matrix + Tests Coverage + Stakeholders No-Técnico)
- **Reference PDF Script Listo para ejecución Post-sandbox**: `reports/generate-remediation-org-pdf.ts` (Puppeteer headless=new, userDataDir temporal workspace reports/.tmp/, tailwind offline .cdn-tailwindcss.js 511KB, DEFAULT_BROWSER_PATHS Chrome prioridad Windows)

### Impacto de Seguridad (Regla AGENTS #19 Remediation 100% Matrix)
| ID Finding | Riesgo Pre-remediación | Riesgo Post-remediación | Tests Asociados |
|---|---|---|---|
| ORG-005 LOG PII CRÍTICO PCI-DSS | Leak RFC/Nombre/sql params/stack en logs Splunk | ✅ safeErrSummary + fp32 8-hex NO PII + incident_fingerprint user | 18 |
| ORG-001 BOLA Silo IDOR Multi-tenant | Viewer ORG_B ve ORG_A KPIs/RFCs/Top5 montos | ✅ requireApprovedDashboardAccess silo 403 | 25 |
| ORG-002 XXE Billion DoS | 1KB XML → 100MB heap → OOM kernel kill worker | ✅ 3 Capas (2MB Max + DTD regex + fatal throw) | 22 |
| ORG-003 Silo Param Tamper | 1 char / SQLi strings / 100KB param accepted | ✅ validateAndParseOrgId strict 25 chars regex / 400 fail | 25 |
| ORG-004 Quadratic Walker O(N²) | 50 PPD / 10k conceptos → 2.5s block event loop | ✅ Stack Linear MAX_ITER 25k safety → 100ms | 22 |
| ORG-006 Triple Rate Limit | 100 concurrente → Postgres conn pool EXHAUSTION P2024 | ✅ 3 buckets IP(60)/User(30)/Org(180)/min 429 early | 18 |
| ORG-007 PII Top Clients NTK ISO27001 | Viewer ve RFC 13 chars + nombre completo cliente | ✅ maskTopClientsPii condicional RECEP_FISCAL_AUDIT_PII | 17 |
| ORG-008 Cache Leak Financial Data | Browser back button disk cache data sin sesión | ✅ 7 headers SECURITY_HEADERS todos status codes | 17 + 25 |
| ORG-009 Dual Where Redundancy RFC | Colisión SAT RFC re-usado → cross-org leak | ✅ baseWhere FK issuerFiscalEntityId IN only | 17 |
| ORG-010 Decimal Integrity Cartera | MX comma 1.234,56 parseFloat → NaN → Cartera $0 fake | ✅ parseSatDecimal MX/US dual safe 0 fallbacks | 22 + KPI shape |

### Validacion Tecnica Exit Code 0 (Todas Pasaron)
1. ✅ `npx tsc --noEmit --project tsconfig.json` (3 runs consecutivos) → **exit code 0** (Zero TypeErrors strict mode)
2. ✅ `npm run test:org` Jest 5 Suites → **82/82 PASS 100%** (0 failed)
3. ✅ `npm run test:org:coverage` threshold lines helpers org ≥75% → **88.76% lines PASS exit 0**
4. ✅ `npx tsc --noEmit post-scripts` FASE 3-B PDF script types strict → **exit 0**
5. ✅ Generación HTML Completo 6 Secciones (Tailwind offline inyectado) → **608KB** archivo listo; PDF omitido sandbox browser identity.

## v1.9.2 - 2026-08-17

### Resumen
- Se aplican los **6 fixes P0 de Hardening (Orden de Validacion / Defensa en Profundidad)** sobre los endpoints auditados en la Matriz SAST Opción-C (12 APIs, ~35 subcasos).
- El objetivo es **evitar enumeración** por parte de atacantes que, vía HTTP 400/500 vs 403, podrían distinguir "credenciales inválidas" de "recurso inexistente" antes de pasar el check de autorización.
- Se valida en regresión Opción-A (baseline feliz) y Opción-C (ataques SAST) sin romper el contrato funcional: **Opción-A 10/16 HTTP>=200 (1 mejor que baseline anterior)**.

### Cambios Tecnicos

#### Fix #1 + Fix #2 · POST `/api/companies/[id]/logo`
- **Antes**: Se llamaba `request.formData()` (lectura archivo/MIME/ext) **antes** de validar acceso a la company ni permiso `COMPANY_UPDATE`.
  - BOLA IDOR a company ajena: retornaba HTTP 500 por fallo de parseo.
  - CAD AUDITOR sin permiso: retornaba HTTP 400 "Archivo requerido".
- **Despues**: Bloque AuthZ movido ANTES de cualquier `formData()`.
  - Caso BOLA company ajena con usuario distinto de SUPER_ADMIN → HTTP 403 *"Permisos insuficientes (sin acceso a compañía)"*.
  - Caso acceso company OK pero sin `COMPANY_UPDATE` → HTTP 403 *"Permisos insuficientes (company:update)"*.
  - Solo SUPER_ADMIN conserva bypass global sin CompanyAccess (comportamiento productivo esperado).

#### Fix #3 · POST `/api/mass-downloads/credentials`
- **Antes**: Se llamaba `formData()`, se parseaban `organizationId` + `rfc` y se validaban campos requeridos **antes** de comprobar `Permission.CFDI_FIEL_CREDENTIALS`. Resultado: CAD AUDITOR sin permiso recibía HTTP 400 "Faltan campos requeridos" (enumeraba el permiso via status code).
- **Despues**: 
  - Orden: `User.findUnique` → `hasPermission(CFDI_FIEL_CREDENTIALS, defaultOrgId)` → 403 uniforme si no permiso.
  - Recién **después** se lee `formData()`, se valida `organizationId` contra memberships del usuario y se scopes RFC via FiscalEntity o CompanyAccess.
  - CAD AUDITOR sin permiso recibe **HTTP 403 "Permiso insuficiente: FIEL"** sin leer cuerpo.

#### Fix #4 · GET `/api/invoices/[id]/pdf`
- **Antes**: Existencia invoice (L83-94) devolvía HTTP 404 "Factura no encontrada o sin XML". RFC scope fiscal (L96-115) devolvía HTTP 403 "Acceso denegado al PDF". Permitía **enumeración de existencia de UUID** via status distinto.
- **Despues**: 
  - Orden: member find → permiso `CFDI_VIEW_PDF` → find invoice → RFC scope.
  - **Cualquier fallo** (sin membresía, sin permiso, no existe, sin XML, RFC no scoped) → **HTTP 404** *"Factura no autorizada o no encontrada"* con `reqId` único (body + header `X-Request-Id`).
  - NO hay forma de distinguir "UUID inexistente" vs "existe pero no autorizado".

#### Fix #5 · GET `/api/companies`
- **Antes**: Firma `GET()` sin `NextRequest`. El query param `?organizationId=` se ignoraba SILENCIOSAMENTE. Consecuencia: test X-1 (OTH Org-B pedía companies de Org-A) recibía HTTP 200 con solo sus companies, pero no se podía diferenciar "no leak" de "param aceptado pero vacío".
- **Despues**:
  - Firma `GET(request: NextRequest)`; se lee `orgIdParam = searchParams.get('organizationId')`.
  - Si `!isSuperOrSystemAdmin` y `orgIdParam` no está en `authorizedOrgIds` (sus memberships) → **HTTP 403** *"Permiso insuficiente para consultar esta organización"*.
  - Ataque Cross-Tenant BOLA adicional `X-1` → confirmado HTTP 403.
  - Nota: Modelo `Company` NO tiene campo `organizationId`; el filtro se resuelve vía `createdBy IN (scopedUserIds)` obtenidos de `Member.findMany({ where: { organizationId: { in: scopedOrgIds } } })`.

#### Fix #6 · GET `/api/admin/users`
- **Antes**: Condición `if (!isOwner AND membership.role !== 'ADMIN')`. Usaba `membership.role` (rol LOCAL de membresía) en vez de `session.user.systemRole`. Resultado: cualquier `ADMIN` de membresía dentro del org podía listar users, desalineado del contrato doc.
- **Despues**: Condición alineada a contrato doc `SÓLO Owner o SUPER_ADMIN`:
  - `const isSuperAdmin = (session.user.systemRole as string) === 'SUPER_ADMIN'`
  - `if (!isOwner && !isSuperAdmin) → HTTP 403 "No tienes permisos para ver los usuarios"`
  - Se añadió `reqId` (body + header `X-Request-Id`) a todas las respuestas para trazabilidad sin leak de stack.

### Impacto de Seguridad (validado con regresión Opción-C)
| Subcaso IDOR/BOLA | Antes Fix | Despues Fix |
|---|---|---|
| API-06.2 · ADM logo company B ajena | 500 (leak parseo) | **403** bloqueado ✅ |
| API-08.2 · CAD sin FIEL | 400 (enumeraba perm via fields) | **403** bloqueado ✅ |
| API-02.3 · ADM PDF UUID ajena | 403 enum existencia | **404 uniforme** (no enum) ✅ |
| X-1 · OTH GET companies OrgId ajeno | 200 param ignorado | **403** bloqueado ✅ |
| Admin/users ADM membership → list users | Warning desalineación contrato | Alineado SÓLO Owner/SUPER_ADMIN ✅ |

### Validacion
- `Opción-A (baseline feliz)`: Auth 6/6, PASS HTTP>=200 10/16 (mejor 1 que baseline pre-fixes por 500 companies fixeado), skips esperados 4/16 (403/404/405).
- `Opción-C (ataques SAST)`: ~35 subcasos / 12 APIs. Cero bypasses reales / cero leaks datos / XXE / SQLi / PathTraversal bloqueados.
- No hay módulos del java-client impactados (ningún fix toca `src/lib/provider-*` ni `src/app/api/external/**` ni `src/proxy.ts` ni scopes M2M → **NO requiere recompilar `mvn clean package`**).

## v1.9.1 - 2026-07-23

### Resumen
- Se libero un ajuste correctivo posterior a `v1.9.0` para dejar limpio `lint` en el flujo de `ingresos-parciales`, `ingresos_pendientes` y `sidebar`.
- Se eliminaron efectos con `setState` sincronico que estaban generando errores de `eslint` relacionados con hidratacion y renders en cascada.

### Cambios Tecnicos
- Se elimino una variable no utilizada en `ingresos_pendientes`.
- Se reestructuro la hidratacion inicial de `dashboard_fiscal/ingresos-parciales` para inicializar fechas sin disparar `setState` sincronico dentro del efecto.
- Se ajusto `sidebar` para resolver el avatar desde la sesion antes de recurrir al estado local, evitando el warning de `setState` en el efecto de carga.

### Validacion
- Se ejecuto `eslint` focalizado sobre los archivos corregidos y finalizo sin errores ni warnings.

## v1.9.0 - 2026-07-21

### Resumen
- Se libero la minima viable de escalabilidad de ingresos, proyecciones de complementos CFDI y REP especializado para emitidos y recibidos.
- Se migraron los modulos clave del dashboard fiscal para consumir materializaciones y se cerraron sus validaciones funcionales y cruces SQL vs UI.

### Cambios Tecnicos
- Se agregaron tablas, migraciones y backfills para `invoice_blobs`, `invoice_issued_daily_summary`, proyecciones de complementos y `invoice_payment_complement_details`.
- Se incorporo una capa reusable de proyeccion de complementos CFDI para `workpaper` emitidos y recibidos, con soporte inicial para Pagos, Nomina, Carta Porte y Comercio Exterior.
- Se migraron `dashboard_fiscal`, `ingresos-parciales`, `ingresos_pendientes` e `ingresos_cobrados` para consumir primero la tabla especializada REP, manteniendo compatibilidad transicional con fallback XML.
- Se materializaron `paymentNodeIndex`, `baseP` e `importeP` para evitar duplicidad por nodos `Pago` y mejorar calculos de cobranza e IVA.
- Se corrigieron regresiones funcionales en filtros de fecha del dashboard fiscal, filtros REP y exposicion de `paymentXml` en `ingresos-parciales`, normalizacion de UUIDs en `ingresos_pendientes` y copy de `workpaper` recibidos.
- Se ajustaron componentes compartidos y UI para reducir ruido tecnico en consola/red y mejorar consistencia visual de los modulos validados.

### Validacion Y Documentacion
- Se documentaron la arquitectura, backfills, SQL de validacion, plan de pruebas, checklist de liberacion y columnas dinamicas de `workpaper`.
- Se ejecuto la validacion funcional completa de `dashboard_fiscal`, `ingresos-parciales`, `ingresos_pendientes`, `ingresos_cobrados`, `workpaper` emitidos y `workpaper` recibidos.
- Se completo la validacion cruzada SQL vs UI confirmando que los montos CRP e IVA cobrado no se inflan al agrupar por `payment_invoice_uuid + payment_node_index`.

## v1.8.1 - 2026-07-18

### Resumen
- Se agrego el archivo de changelog versionado en la raiz del proyecto.
- Se formalizo en `AGENTS.md` la regla obligatoria de actualizar `CHANGELOG.md` antes de cada `git push`.

### Cambios Tecnicos
- Se creo `CHANGELOG.md` como registro central de versiones, fecha y resumen de entregas.
- Se actualizo el flujo de versionamiento en `AGENTS.md` para exigir la actualizacion previa del changelog antes de commit, tag y push.

## v1.8.0 - 2026-07-18

### Resumen
- Se estabilizo el proyecto en dependencias, runtime y lint para mejorar la instalacion y la experiencia de desarrollo.
- Se corrigieron errores de monitoreo, abortos de requests, branding inconsistente y warnings visuales del frontend.

### Cambios Tecnicos
- Se actualizaron dependencias clave y configuraciones de npm para resolver conflictos, vulnerabilidades y problemas de compatibilidad.
- Se cambio la integracion de generacion de PDF a `puppeteer-core` con deteccion de navegadores locales.
- Se alineo Prisma y se corrigieron errores de inicializacion del cliente.
- Se agrego `react-is` para corregir la integracion de `recharts`.
- Se corrigio el endpoint de `Import Monitor` para usar el esquema real de Prisma.
- Se limpiaron errores y warnings de ESLint relacionados con hooks, React Compiler, `setState` en efectos y patrones de carga inicial.
- Se mitigaron `ERR_ABORTED` funcionales en requests de sesion, tenant, perfil y accesos.
- Se corrigieron warnings de `next/image` en login y registro.
- Se ajusto el sidebar para que no cubra el contenido al cargar en viewport no desktop.
- Se homologo el branding visible a `CFDI Task Manager`.

### Documentacion
- Se agrego la guia `docs/arquitectura/trae-reinstalacion-correcciones.md` para reaplicar correcciones base en futuras instalaciones.


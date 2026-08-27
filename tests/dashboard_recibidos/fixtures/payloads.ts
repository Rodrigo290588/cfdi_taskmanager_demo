// SAST Dashboard Recibidos · Payloads anti-regresión (RECIBIDOS-001…RECIBIDOS-015)
// Correspondencia 1:1 con findings del reporte SAST (pdf/html).
// Vectores de prueba para validar que los parches bloquean los paths vulnerables.

import crypto from 'node:crypto'

// =========================================================
// RECIBIDOS-001 (CRÍTICO) · Upload BOLA receiverRfc != company.rfc
// Usuario sube un CFDI con RFC Receptor = RFC de OTRA empresa.
// =========================================================
export const DR001_UPLOAD_BOLA_WRONG_RFC = {
  name: 'DR-001 Upload receiverRfc != company.rfc (BOLA cross-tenant)',
  severity: 'Critico',
  receiverRfcXml: 'XAXX010101000',     // RFC público default SAT (NO coincide con company RFC)
  targetCompanyRfc: 'ODE8604257UA',    // RFC-A1 seed del tenant (debe coincidir estrictamente)
  expectedBefore: 'created',           // Antes: pasaba sin validar
  expectedAfter: 'error'               // Después: rechazado con mensaje scoping
}

// =========================================================
// RECIBIDOS-002 (ALTO) · Drilldown member sin organizationId filter
// findFirst(userId, APPROVED) → pick aleatoria multi-org sin WHERE orgId
// =========================================================
export const DR002_MEMBER_PICK_RANDOM_ORGID = {
  name: 'DR-002 member.findFirst sin organizationId (pick aleatorio)',
  userIdMultiOrgs: 'cmnnu4saj0005sfg3cdm19e5q',
  expectedBeforeDeterministic: false,  // Antes: incierto (primer row Postgres)
  expectedAfterQueryHas: 'organizationId'
}

// =========================================================
// RECIBIDOS-003 (ALTO) · 0 rate limit en 15 routes
// =========================================================
export const DR003_RATE_LIMIT_WRAPPER_EXISTS = {
  name: 'DR-003 buildDashboardScopedContext con routeKey=* para todos routes',
  routesChecked: [
    'mainHeavy', 'uploadMassive', 'drilldownInvoices', 'drilldownXml', 'drilldownPdf',
    'drilldownAgg'
  ],
  expectedAfter: 'buildDashboardScopedContext uses routeKey'
}

// =========================================================
// RECIBIDOS-004 (ALTO) · Prototype Pollution invoices has.*
// has.__proto__, has.constructor.prototype, etc.
// =========================================================
export const DR004_PROTO_POLLUTION_HAS_FILTERS = {
  name: 'DR-004 Prototype Pollution has.* + MAX_HAS_FILTERS',
  maliciousKeys: [
    'has.__proto__',
    'has.constructor.prototype',
    'has.toString.valueOf',
  ],
  maxFilters: 8,
  whitelistSetSize: 12
}

// =========================================================
// RECIBIDOS-005 (CRÍTICO) · DoS workpaper limit=100,000 rows
// + descifrado AES Promise.all batch 100k = OOM Node.js
// =========================================================
export const DR005_DOS_PAGINATION_100K = {
  name: 'DR-005 workpaper limit=100000 DoS (OOM decrypt)',
  maliciousLimit: 100000,
  expectedAfterHardLimit: 500
}

// =========================================================
// RECIBIDOS-006 (ALTO) · XML leakage + XSS Addenda en response listado
// xmlContent = decryptXmlContent al response visual (NO workpaper single)
// =========================================================
export const DR006_XML_LEAK_AND_XSS_ADDENDA = {
  name: 'DR-006 XML CFDI en listado invoices (XSS Addenda + leak GBs)',
  xssVector: "<Addenda><script>alert(document.origin)</script></Addenda>",
  expectedAfterResponseHasXmlContent: false
}

// =========================================================
// RECIBIDOS-007 (ALTO) · CRLF HTTP Response Splitting filenames
// Content-Disposition: filename="cfdi_\r\nSet-Cookie:hijack=1; .xml"
// =========================================================
export const DR007_CRLF_FILENAME_INJECTION = {
  name: 'DR-007 CRLF/Smuggling en filename descarga XML/PDF',
  maliciousFilenames: [
    'cfdi_abc\r\nSet-Cookie:session=hijacked; HttpOnly; .xml',
    'cfdi_xyz\u000d\u000aX-Injected: yes.pdf',
    'cfdi_../../../../windows/win.ini.xml',
    'cfdi_" onerror="alert(1)" .xml'
  ],
  expectedAfterSanitizedChars: ['\r', '\n', '..\\', '../']
}

// =========================================================
// RECIBIDOS-008 (ALTO) · console.error raw + DATABASE_URL leak stack
// =========================================================
export const DR008_SAFE_ERROR_500_DASHBOARD_RESPONSE = {
  name: 'DR-008 dashboardJsonErrorResponse vs console.error + raw 500',
  routesNeedsSafeCatch: [
    'src/app/api/dashboard_recibidos/route.ts',
    'src/app/api/dashboard_recibidos/upload/route.ts',
    'src/app/api/dashboard_recibidos/invoices/route.ts',
    'src/app/api/dashboard_recibidos/workpaper/xml/route.ts',
    'src/app/api/dashboard_recibidos/workpaper/pdf/route.ts',
  ],
  expectedAfterSafe500: 'return dashboardJsonErrorResponse(error)'
}

// =========================================================
// RECIBIDOS-009 (MEDIO) · Zod strictObject + UUID/NanoId
// query params accept ANY fields (z.object vs z.strictObject)
// =========================================================
export const DR009_ZOD_STRICT_UUID = {
  name: 'DR-009 Zod strict + UUID regex idempotency',
  overpostingPayload: {
    companyId: 'cmt1xatbu00002qy4199p2t4m',
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    _customerSecretLeak: 'eyJhbGciOiJSUzI1NiIs',
    roleOverride: 'ADMIN',
    __proto__: '{}'
  },
  expectedAfterFieldsBlocked: ['_customerSecretLeak', 'roleOverride', '__proto__']
}

// =========================================================
// RECIBIDOS-010 (MEDIO) · PII memberId/uploadedByUserId sin permiso
// Response incluye IDs internos users sin granular permission check
// =========================================================
export const DR010_PII_USER_IDS_NO_PERMISSION = {
  name: 'DR-010 PII memberId + uploadedByUserId sin granularPerm',
  requiredPermission: 'RECEP_FISCAL_AUDIT_PII',
  fieldsPii: ['memberId', 'uploadedByUserId', 'validationAuditedBy', 'userId']
}

// =========================================================
// RECIBIDOS-011 (MEDIO) · FE create taxRegime='601' + CP='00000' hardcoded
// =========================================================
export const DR011_SAT_HARDCODED_REGIME_CP = {
  name: 'DR-011 FiscalEntity hardcodeado regimen 601 CP 00000',
  satRegimesExpectedSize: 51,
  needsManualReviewFlagExpected: true
}

// =========================================================
// RECIBIDOS-012 (CRÍTICO) · xmlContent=xml en texto plano invoice.create
// Invoice.xmlContent EN TEXTO PLANO → REDACTED_SHA256 + blob AES-GCM
// =========================================================
export const DR012_XML_PLAINTEXT_STORAGE = {
  name: 'DR-012 xmlContent NO plaintext (REDACTED_ + sha256 slice 16)',
  sampleXml: '<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante Folio="1" Serie="F"><cfdi:Emisor Rfc="XAXX010101000" Nombre="SAT Demo"></cfdi:Emisor></cfdi:Comprobante>',
  expectedAfterPrefix: '<REDACTED>_',
  expectedAfterSuffixLength: 16
}

// =========================================================
// RECIBIDOS-013 (ALTO) · Workpaper download sin triple preCheck
// Faltaba preCheck uuid+orgId+companyId ANTES de getStoredProviderXmlRecord
// =========================================================
export const DR013_WORKPAPER_TRIPLE_PRECHECK = {
  name: 'DR-013 Triple preCheck uuid+org+company en descarga',
  expectedChecksOrder: [
    'providerUploadedCfdi.findFirst(organizationId,receiverCompanyId,uuid)',
    'companyAccess(memberId_companyId)',
    'member.status=APPROVED + organizationId'
  ]
}

// =========================================================
// RECIBIDOS-014 (ALTO) · includeHeavyMetrics default true DoS 6 queries
// =========================================================
export const DR014_HEAVY_METRICS_DEFAULT_FALSE = {
  name: 'DR-014 includeHeavyMetrics ===\'true\' (antes !==\'false\')',
  maliciousPayload: { companyId: 'x', startDate: '2020-01-01', endDate: '2028-12-31' },
  expectedAfterHeavyFlag: false
}

// =========================================================
// RECIBIDOS-015 (MEDIO) · Security headers + Audit trail upload/KPIs
// =========================================================
export const DR015_SECURITY_HEADERS_AUDIT_TRAIL = {
  name: 'DR-015 Security headers (nosniff/DENY/CSP/HSTS) + createAuditEntry',
  securityHeadersExpected: [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Content-Security-Policy',
    'Strict-Transport-Security'
  ],
  auditActionExpected: 'DASHBOARD_RECIBIDOS.upload_massive'
}

// =========================================================
// Helper: generar UUIDs para tests de idempotencia
// =========================================================
export const generateSampleUuid = () => crypto.randomUUID()

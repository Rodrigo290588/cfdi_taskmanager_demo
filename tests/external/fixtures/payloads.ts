export const EXT_M2M_PAYLOADS = {
  PAYLOAD_001_OVERPOST_CONTENTBASE64_OOM: {
    id: 'EXT-M2M-PAYLOAD-001',
    finding: 'EXT-001',
    title: 'Overposting contentBase64 > MAX_BYTES_PER_FILE (5MB base64)',
    payload: {
      items: [
        {
          fileName: 'huge.xml',
          contentBase64: 'A'.repeat(Math.ceil(5.1 * 1024 * 1024 * 4 / 3))
        }
      ]
    },
    expectedHttpStatus: 400
  },

  PAYLOAD_002_ZOD_DETAILS_FIELD_DISCLOSURE: {
    id: 'EXT-M2M-PAYLOAD-002',
    finding: 'EXT-002',
    title: 'ZodError details field path fuera de whitelist debe ser sanitized',
    payload: {
      'campo_secreto_bd': 'x',
      items: 'no-array'
    },
    mustNotContainInResponse: ['campo_secreto_bd', 'secreto', 'message original', 'issue path raw']
  },

  PAYLOAD_003_SEARCHPARAMS_DUP_LAST_WINS: {
    id: 'EXT-M2M-PAYLOAD-003',
    finding: 'EXT-003',
    title: 'searchParams dup page=1&page=999 debe tomar primer valor (1) no último (999)',
    query: 'page=1&page=999&pageSize=500&pageSize=1',
    expectedPage: 1,
    expectedPageSize: 500
  },

  PAYLOAD_004_DEBUG_PROD_NO_LEAK: {
    id: 'EXT-M2M-PAYLOAD-004',
    finding: 'EXT-004',
    title: 'reportImportRouteDebug NO ejecuta en NODE_ENV=production',
    forceNodeEnv: 'production',
    mustNotTriggerDebugFetch: true
  },

  PAYLOAD_005_DEBUG_SERVER_URL_INTERNAL_10: {
    id: 'EXT-M2M-PAYLOAD-005',
    finding: 'EXT-005',
    title: 'SSRF block: DEBUG_SERVER_URL=http://10.0.0.1/metadata bloqueado SSRF isInternalHostname',
    envDebugUrl: 'http://10.0.0.1/latest/meta-data/',
    expectedBlocked: true
  },

  PAYLOAD_006_SCOPES_GRANULAR_NO_SINGLE: {
    id: 'EXT-M2M-PAYLOAD-006',
    finding: 'EXT-006',
    title: 'Scope granular: runs endpoint requiere cfdi.import.runs:read NO cfdi.import genérico',
    wrongScopeForRuns: 'cfdi.import:create',
    correctScopeForRuns: 'cfdi.import.runs:read'
  },

  PAYLOAD_007_RATE_LIMIT_M2M: {
    id: 'EXT-M2M-PAYLOAD-007',
    finding: 'EXT-007',
    title: 'rateLimit m2m:cfdi-import:create bloquea después de MAX requests (limite alcanzado',
    rateLimitKeyPrefix: 'm2m:',
    expectedRetryAfterPresent: true
  },

  PAYLOAD_008_LOGS_SAFE_NO_PII: {
    id: 'EXT-M2M-PAYLOAD-008',
    finding: 'EXT-008',
    title: 'console.error safeErrSummary NO incluye correos/RFC/UUIDs raw',
    forbiddenStringsMustContainOnly: ['msgHash', 'fingerprint', 'issueCount', 'firstField', 'name', 'stackFirst'],
    forbiddenRawStrings: ['@example.com', 'ODE8604257UA', '11111111-0000-4000-8000-000000000001', 'password', 'token']
  },

  PAYLOAD_009_USER_RESPONSE_WHITELIST: {
    id: 'EXT-M2M-PAYLOAD-009',
    finding: 'EXT-009',
    title: 'users response fields: success,created,rejected,total,items (whitelist) NO spread ...result ni organizationId/clientId',
    mustFieldsAllowed: ['success', 'created', 'rejected', 'total', 'items'],
    mustFieldsForbidden: ['organizationId', 'sourceClientId', 'clientId', 'org_id', 'internalId']
  },

  PAYLOAD_010_NOCACHE_HEADERS: {
    id: 'EXT-M2M-PAYLOAD-010',
    finding: 'EXT-010',
    title: 'withNoCache headers: Cache-Control private,no-store + HSTS + XFO DENY',
    expectedHeaders: [
      'cache-control',
      'pragma',
      'expires',
      'strict-transport-security',
      'x-content-type-options',
      'x-frame-options'
    ]
  },

  PAYLOAD_011_DEBUG_FS_ABSOLUTE_PATH: {
    id: 'EXT-M2M-PAYLOAD-011',
    finding: 'EXT-011',
    title: 'fs readFileSync ruta ABSOLUTA .dbg cwd check, NO ruta relativa traversal ../../',
    traversalAttempt: '../../../../etc/passwd',
    expectedCwdCheck: true
  },

  PAYLOAD_012_M2M_HEADERS_VALIDATION: {
    id: 'EXT-M2M-PAYLOAD-012',
    finding: 'EXT-012',
    title: 'validateM2MRequestHeaders: 415 Content-Type inválido, 411 Content-Length faltante, 413 size MAX',
    cases: [
      { contentType: 'text/plain', contentLength: 100, httpStatus: 415 },
      { contentType: 'application/json', contentLength: undefined, httpStatus: 411 },
      { contentType: 'application/json', contentLength: 999_999_999, httpStatus: 413 }
    ]
  },

  PAYLOAD_013_PRE_PARSE_CL_BIGGER: {
    id: 'EXT-M2M-PAYLOAD-013',
    finding: 'EXT-013',
    title: 'Pre-parse Content-Length > ceil(MAX*1.35) return 413 ANTES request.json() malloc',
    contentLengthBytes: Math.ceil(50 * 1024 * 1024 * 1.35) + 100,
    httpStatus: 413
  },

  PAYLOAD_014_PROXY_DUPCODE_BLOCK: {
    id: 'EXT-M2M-PAYLOAD-014',
    finding: 'EXT-014',
    title: 'proxy.ts NO bloque dashboard 1 sola vez (sin duplicado isOnDashboard check',
    uniqueBlockCount: 1
  },

  PAYLOAD_015_CFDI_SCOPE_CREATE_EXCLUSIVE: {
    id: 'EXT-M2M-PAYLOAD-015',
    finding: 'EXT-006+013',
    title: 'Borde: cfdi-import POST requiere scope cfdi.import:create NO runs_read falla 403',
    wrongScope: 'cfdi.import.runs:read',
    httpStatusForCreate: 403
  },

  PAYLOAD_016_USER_ROL_VALIDATION_FAIL: {
    id: 'EXT-M2M-PAYLOAD-016',
    finding: 'EXT-002+009',
    title: 'Bulk users con rol_empresa=ROL_INEXISTENTE retorna 400 y NO 500',
    rolInvalido: 'ROL_QUE_NO_EXISTE_12345',
    expectedStatus: 400
  }
} as const

export type ExtM2MPayloadKey = keyof typeof EXT_M2M_PAYLOADS

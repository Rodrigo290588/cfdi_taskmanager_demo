export const MON_FIXTURE_ORGS = {
  ORG_A_ID: 'cmnntrppk000502gcp93ketfx',
  ORG_B_ID: 'cmipiwlqk000mvyvtc22tnlrb',
  RFC_ORG_A: 'ODE8604257UA',
  RFC_ORG_B: 'QBB7223997V9',
  COMPANY_ORG_A: 'cmpORG000000000000000001',
  COMPANY_ORG_B: 'cmpORG000000000000000002',
  VIEWER_USER_EMAIL: 'monitor-viewer-sast@itcomplements.com',
  AUDITOR_USER_EMAIL: 'monitor-auditor-sast@itcomplements.com',
  MEMBER_USER_EMAIL: 'monitor-member-sast@itcomplements.com',
  ADMIN_USER_EMAIL: 'monitor-admin-sast@itcomplements.com',
  PASSWORD_STRONG: 'Monitor-SEG-2026-A1b2!',
} as const

export const UUID_RFC4122_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const VALID_UUID_V4_SAMPLE = '550e8400-e29b-41d4-a716-446655440000'
export const VALID_UUID_V4_SAMPLE_2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

type MonPayloadCategory = 'auth' | 'bola' | 'zod' | 'injection' | 'logs' | 'dos' | 'crypto' | 'date'
type MonPayloadRoute =
  | 'monitor_stats'
  | 'monitor_runs'
  | 'monitor_run_items'
  | 'monitor_item_detail'
  | 'monitor_drilldown_errors'

export type MonPayload = {
  id: string
  title: string
  category: MonPayloadCategory
  route: MonPayloadRoute
  findingId: 'MON-001' | 'MON-002' | 'MON-003' | 'MON-004' | 'MON-005' | 'MON-006' | 'MON-007' | 'MON-008' | 'MON-009' | 'MON-010'
} & (
  | {
      kind: 'query_get'
      urlQuery: Record<string, string>
      headers?: Record<string, string>
      expect: {
        status: number
        zodStrictError?: boolean
        hasForbiddenView?: boolean
        crossTenantLeak?: boolean
        orgRandomPickRisk?: boolean
      }
    }
  | {
      kind: 'route_param_get'
      params: Record<string, string>
      urlQuery?: Record<string, string>
      expect: {
        status: number
        uuidInvalidError?: boolean
        pathTraversalRisk?: boolean
        piiLeakedInResponse?: boolean
      }
    }
  | {
      kind: 'log_redaction'
      urlQuery: Record<string, string>
      simulateCatchError: Error
      expect: {
        safeErrRedacted: boolean
        fingerprint32?: boolean
        dbIdExposedDirectly?: boolean
      }
    }
  | {
      kind: 'wildcard_search'
      urlQuery: Record<string, string>
      expect: {
        wildcardCharsEscaped: boolean
        noSequentialScan?: boolean
      }
    }
  | {
      kind: 'filter_consistency'
      urlQuery: Record<string, string>
      expect: {
        recentBlocksRespectFilters: boolean
      }
    }
  | {
      kind: 'date_parse'
      urlQuery: Record<string, string>
      expect: {
        invalidCalendarDateRejects400?: boolean
        silentUndefinedAvoided?: boolean
      }
    }
  | {
      kind: 'crypto_drilldown'
      rowsCount: number
      paginationParams: { page: string; pageSize: string }
      expect: {
        paginationForcedMax100: boolean
        singleRowDecryptGracefulDegradation?: boolean
      }
    }
)

export const PAYLOADS: MonPayload[] = [
  // MON-001: BOLA multi-tenant orgId spoof + random pick sin orden
  {
    id: 'MON-PAY-001',
    title: 'MON-001: stats orgId spoof cross-tenant ORG_B sin permiso',
    category: 'bola',
    route: 'monitor_stats',
    findingId: 'MON-001',
    kind: 'query_get',
    urlQuery: { orgId: MON_FIXTURE_ORGS.ORG_B_ID, status: 'COMPLETED', startDate: '2025-01-01', endDate: '2025-01-31' },
    expect: { status: 403, crossTenantLeak: false, orgRandomPickRisk: false },
  },
  {
    id: 'MON-PAY-002',
    title: 'MON-001: stats sin orgId en multi-org → org DETERMINÍSTICA no random',
    category: 'bola',
    route: 'monitor_stats',
    findingId: 'MON-001',
    kind: 'query_get',
    urlQuery: { startDate: '2025-01-01', endDate: '2025-06-30' },
    expect: { status: 200, orgRandomPickRisk: false },
  },
  // MON-002: Falta hasPermission → VIEWER/AUDITOR/MEMBER sin DASHBOARD_FISCAL_VIEW reciben 403
  {
    id: 'MON-PAY-010',
    title: 'MON-002: runs VIEWER sin permiso DASHBOARD_FISCAL_VIEW → 403',
    category: 'auth',
    route: 'monitor_runs',
    findingId: 'MON-002',
    kind: 'query_get',
    urlQuery: { page: '1', pageSize: '10' },
    headers: { 'x-test-role-override': 'VIEWER' },
    expect: { status: 403, hasForbiddenView: true },
  },
  {
    id: 'MON-PAY-011',
    title: 'MON-002: drilldown AUDITOR status APPROVED sin permiso → 403',
    category: 'auth',
    route: 'monitor_drilldown_errors',
    findingId: 'MON-002',
    kind: 'query_get',
    urlQuery: { status: 'COMPLETED_WITH_ERRORS' },
    headers: { 'x-test-role-override': 'AUDITOR' },
    expect: { status: 403, hasForbiddenView: true },
  },
  {
    id: 'MON-PAY-012',
    title: 'MON-002: item_detail MEMBER sin permiso → 403',
    category: 'auth',
    route: 'monitor_item_detail',
    findingId: 'MON-002',
    kind: 'route_param_get',
    params: { itemId: VALID_UUID_V4_SAMPLE },
    expect: { status: 403 },
  },
  // MON-003: ILIKE wildcards % _ escapados (no logical injection / DoS)
  {
    id: 'MON-PAY-020',
    title: 'MON-003: runs search con 100 % wildcards → escapados ESCAPE clause',
    category: 'injection',
    route: 'monitor_runs',
    findingId: 'MON-003',
    kind: 'wildcard_search',
    urlQuery: { search: '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%' },
    expect: { wildcardCharsEscaped: true, noSequentialScan: true },
  },
  {
    id: 'MON-PAY-021',
    title: 'MON-003: runs search underscores ___ regex wildcard single → escapados',
    category: 'injection',
    route: 'monitor_runs',
    findingId: 'MON-003',
    kind: 'wildcard_search',
    urlQuery: { search: '___________%_____%_________%' },
    expect: { wildcardCharsEscaped: true, noSequentialScan: true },
  },
  {
    id: 'MON-PAY-022',
    title: 'MON-003: drilldown search backslash path escape chars → escapados',
    category: 'injection',
    route: 'monitor_drilldown_errors',
    findingId: 'MON-003',
    kind: 'wildcard_search',
    urlQuery: { search: '\\%_ATAQUE_INYECCION_WILDCARD_%\\' },
    expect: { wildcardCharsEscaped: true },
  },
  // MON-004 / MON-009: console.error safeErrSummary redactado, no ids crudos
  {
    id: 'MON-PAY-030',
    title: 'MON-004: stats catch 500 → safeErrSummary fp32 no stack crudo',
    category: 'logs',
    route: 'monitor_stats',
    findingId: 'MON-004',
    kind: 'log_redaction',
    urlQuery: { orgId: "'; DROP TABLE import_runs; --" },
    simulateCatchError: new Error(`PrismaClientKnownRequestError: Raw query failed. Code 22P02: invalid input syntax for type uuid: ${JSON.stringify('payload-inject-1234')}. Stack at /app/.next/server/.../route.js:345`),
    expect: { safeErrRedacted: true, fingerprint32: true, dbIdExposedDirectly: false },
  },
  {
    id: 'MON-PAY-031',
    title: 'MON-009: drilldown decrypt catch → no row.id crudo, fp32 hash one-way',
    category: 'logs',
    route: 'monitor_drilldown_errors',
    findingId: 'MON-009',
    kind: 'log_redaction',
    urlQuery: { status: 'COMPLETED_WITH_ERRORS' },
    simulateCatchError: new Error('Unsupported algorithm, auth tag length mismatch for AES-GCM'),
    expect: { safeErrRedacted: true, dbIdExposedDirectly: false, fingerprint32: true },
  },
  // MON-005: drilldown paginación forzada + hard-cap 100 rows/page
  {
    id: 'MON-PAY-040',
    title: 'MON-005: drilldown errors pageSize 10000 → truncado hard cap 100',
    category: 'dos',
    route: 'monitor_drilldown_errors',
    findingId: 'MON-005',
    kind: 'crypto_drilldown',
    rowsCount: 10,
    paginationParams: { page: '1', pageSize: '10000' },
    expect: { paginationForcedMax100: true, singleRowDecryptGracefulDegradation: true },
  },
  {
    id: 'MON-PAY-041',
    title: 'MON-005: drilldown errors sin params → defaults page 1 size 20',
    category: 'dos',
    route: 'monitor_drilldown_errors',
    findingId: 'MON-005',
    kind: 'crypto_drilldown',
    rowsCount: 20,
    paginationParams: { page: '', pageSize: '' },
    expect: { paginationForcedMax100: true },
  },
  // MON-006: UUID RFC 4122 v4 regex en route params
  {
    id: 'MON-PAY-050',
    title: 'MON-006: importRunId param OR 1=1 -- → Zod UUID rejection 400',
    category: 'zod',
    route: 'monitor_run_items',
    findingId: 'MON-006',
    kind: 'route_param_get',
    params: { importRunId: "' OR 1=1 --" },
    expect: { status: 400, uuidInvalidError: true },
  },
  {
    id: 'MON-PAY-051',
    title: 'MON-006: itemId ../../etc/passwd path traversal → UUID rejection',
    category: 'zod',
    route: 'monitor_item_detail',
    findingId: 'MON-006',
    kind: 'route_param_get',
    params: { itemId: '../../etc/passwd%00' },
    expect: { status: 400, uuidInvalidError: true, pathTraversalRisk: false },
  },
  {
    id: 'MON-PAY-052',
    title: 'MON-006: itemId <img onerror=alert(1)> XSS → UUID rejection',
    category: 'zod',
    route: 'monitor_item_detail',
    findingId: 'MON-006',
    kind: 'route_param_get',
    params: { itemId: '<img src=x onerror=alert("MON-006-XSS")>' },
    expect: { status: 400, uuidInvalidError: true, piiLeakedInResponse: false },
  },
  // MON-007: recentRuns / recentItems respetan filtros status/source/fecha
  {
    id: 'MON-PAY-060',
    title: 'MON-007: stats enero 2025 status FAILED → recentRuns solo FAILED enero',
    category: 'date',
    route: 'monitor_stats',
    findingId: 'MON-007',
    kind: 'filter_consistency',
    urlQuery: { status: 'FAILED', startDate: '2025-01-01', endDate: '2025-01-31', source: 'MANUAL_UPLOAD' },
    expect: { recentBlocksRespectFilters: true },
  },
  // MON-008: Zod strictObject unknown keys → 400 unrecognized_keys
  {
    id: 'MON-PAY-070',
    title: 'MON-008: runs queryParam pageSize_internal_unlimited → strict rejection',
    category: 'zod',
    route: 'monitor_runs',
    findingId: 'MON-008',
    kind: 'query_get',
    urlQuery: { pageSize_internal_unlimited: '1', page: '1', pageSize: '10', unknownParam: 'abc', pagesize: '10000' },
    expect: { status: 400, zodStrictError: true },
  },
  {
    id: 'MON-PAY-071',
    title: 'MON-008: stats __proto__ pollution → strict rejection (overposting)',
    category: 'zod',
    route: 'monitor_stats',
    findingId: 'MON-008',
    kind: 'query_get',
    urlQuery: { '__proto__[polluted]': '1', 'constructor.prototype.polluted2': '1', status: 'COMPLETED' },
    expect: { status: 400, zodStrictError: true },
  },
  // MON-010: Fechas calendario inválidas mes 13 día 45 → reject 400
  {
    id: 'MON-PAY-080',
    title: 'MON-010: runs startDate mes 13 (2025-13-01) → reject 400',
    category: 'date',
    route: 'monitor_runs',
    findingId: 'MON-010',
    kind: 'date_parse',
    urlQuery: { startDate: '2025-13-01', endDate: '2025-12-31' },
    expect: { invalidCalendarDateRejects400: true, silentUndefinedAvoided: true },
  },
  {
    id: 'MON-PAY-081',
    title: 'MON-010: stats endDate día 45 abril (2025-04-45) abril no tiene 45 → reject 400',
    category: 'date',
    route: 'monitor_stats',
    findingId: 'MON-010',
    kind: 'date_parse',
    urlQuery: { startDate: '2025-01-01', endDate: '2025-04-45' },
    expect: { invalidCalendarDateRejects400: true, silentUndefinedAvoided: true },
  },
  {
    id: 'MON-PAY-082',
    title: 'MON-010: drilldown 2025-02-29 no bisiesto → reject 400 (Febrero 29 inválido)',
    category: 'date',
    route: 'monitor_drilldown_errors',
    findingId: 'MON-010',
    kind: 'date_parse',
    urlQuery: { startDate: '2025-02-01', endDate: '2025-02-29' },
    expect: { invalidCalendarDateRejects400: true, silentUndefinedAvoided: true },
  },
  // Misc validaciones cruzadas
  {
    id: 'MON-PAY-090',
    title: 'MON-008+MON-003: runs search XSS inject + unknownKey = 400 strict',
    category: 'zod',
    route: 'monitor_runs',
    findingId: 'MON-008',
    kind: 'query_get',
    urlQuery: { search: '<img src=x onerror=alert(1)>', bad: 'evil' },
    expect: { status: 400, zodStrictError: true },
  },
] as const

export type MonSafeTestShape = unknown

// =====================================================================
// tests/companies/fixtures/payloads.ts   (10 payloads SAST Módulo Empresas)
// COMPANIES-PAYLOAD-001 ... COMPANIES-PAYLOAD-010
// Cada uno alinea vector ataque de findings COMPANIES-001..015
// Uso: test suites `tests/companies/*.test.ts` anti-regresión
// =====================================================================

export const COMPANIES_PAYLOAD_001_OWNER_LOCAL_NO_MEMBERSHIPS = {
  id: 'COMPANIES-PAYLOAD-001',
  testAgainstFinding: 'COMPANIES-001',
  description:
    'Simula el bug hasPermission(...) en register route: {id, systemRole} SIN memberships. ' +
    'Debe FALLAR (403) si memberships es undefined a pesar de ser OWNER local de org.',
  userCtx: {
    id: 'usr_sast_owner_local_001',
    email: 'owner-local-no-memberships@itcomplements.com',
    systemRole: 'USER',
    organizationId: 'cmnntrppk000502gcp93ketfx',
    memberRole: 'OWNER',
  },
  body: {
    name: 'ACME Payload 001',
    rfc: 'AAA010101AAA',
    businessName: 'ACME SA de CV',
    legalRepresentative: 'Sr Owner',
    taxRegime: '601',
    postalCode: '00000',
    country: 'México',
  },
  expected: {
    hasPermissionResult: true, // debe ser true aunque userCtx NO lleve memberships (bugfix)
    http: 201,
  },
}

export const COMPANIES_PAYLOAD_002_SUPER_ADMIN_CROSS_ORG_SCOPE_LEAK = {
  id: 'COMPANIES-PAYLOAD-002',
  testAgainstFinding: 'COMPANIES-002',
  description:
    'SUPER_ADMIN sin ?organizationId= debe RETORNAR 0 empresas (no where=undefined que liste cross-tenant).',
  userCtx: {
    id: 'usr_sast_super_002',
    systemRole: 'SUPER_ADMIN',
  },
  queryParams: {},
  expected: {
    companiesCount: 0, // NO leak cross-org
    http: 200,
  },
}

export const COMPANIES_PAYLOAD_003_BOLA_GET_COMPANY_ID_CROSS_ORG = {
  id: 'COMPANIES-PAYLOAD-003',
  testAgainstFinding: 'COMPANIES-003',
  description:
    'Usuario ORG_A intentando GET /companies/<UUID_ORG_B> = BOLA. Debe responder 403 uniforme, ' +
    'nunca 200 con datos (email/teléfono/representante legal).',
  userCtx: { orgA: true, email: 'miembro-org-a@itcomplements.com' },
  targetCompanyId: 'cmpny_UUID_DE_ORG_B_SIN_COMPANYACCESS',
  expected: {
    http: 403,
    responseMustNotContain: ['email', 'legalRepresentative', 'auditLogs', 'phone', 'rejectionReason'],
  },
}

export const COMPANIES_PAYLOAD_004_IDOR_APPROVE_CROSS_ORG = {
  id: 'COMPANIES-PAYLOAD-004',
  testAgainstFinding: 'COMPANIES-004',
  description:
    'SystemRole=ADMIN global NO miembro de ORG_B intenta aprobar company de ORG_B. ' +
    'Bug previo lo aprobaba. Mitigación: validar membresía en la company.organization owner.',
  userCtx: { id: 'global-admin-no-miembro-org-b', systemRole: 'ADMIN' },
  targetCompanyId: 'cmpny_pending_ORG_B_ID',
  body: { action: 'approve' },
  expected: { http: 403 },
}

export const COMPANIES_PAYLOAD_005_IDOR_UPDATE_CROSS_ORG = {
  id: 'COMPANIES-PAYLOAD-005',
  testAgainstFinding: 'COMPANIES-005',
  description:
    'Mismo IDOR pero en PUT company/:id. Editar RFC/razón social de empresa ajena.',
  userCtx: { id: 'global-admin-no-miembro-org-b', systemRole: 'ADMIN' },
  targetCompanyId: 'cmpny_ORG_B_APROBADA_ID',
  body: {
    rfc: 'MAL000000MAL',
    name: 'EMPRESA MODIFICADA INDEBIDAMENTE',
    businessName: 'MODIFICADA',
    taxRegime: '601',
    postalCode: '00000',
  },
  expected: { http: 403 },
}

export const COMPANIES_PAYLOAD_006_ZOD_OVERPOSTING_STATUS_APPROVED = {
  id: 'COMPANIES-PAYLOAD-006',
  testAgainstFinding: 'COMPANIES-006',
  description:
    'Zod non-strict: inyecta status=APPROVED, approvedBy, __proto__. Después del fix ' +
    'strictObject, Zod debe devolver validation error "Unrecognized key(s)"',
  body: {
    name: 'EMPRESA OVERPOST 006',
    rfc: 'AAA010101AAA',
    businessName: 'OVERPOST SA',
    taxRegime: '601',
    postalCode: '00000',
    status: 'APPROVED',
    approvedBy: 'usr_mi_user_id_hacker',
    approvedAt: '2026-08-20T00:00:00.000Z',
    createdBy: 'otro_user_id',
    notes: 'ataque',
    // COMPANIES-006 prototype pollution test payload: __proto__ key extra
    // (insertada vía Object.assign para evitar issues de TS type-checking)
    ...(Object.fromEntries([['__proto__', { polluted: true }]]) as Record<string, unknown>),
  },
  expected: {
    zodValidation: false, // safeParse.success === false
    zodIssueContainsUnrecognized: true,
    prismaInsertedStatus: 'PENDING', // Si se omiten keys = debe default PENDING
  },
}

export const COMPANIES_PAYLOAD_007_SSRF_NEXT_PUBLIC_APP_URL = {
  id: 'COMPANIES-PAYLOAD-007',
  testAgainstFinding: 'COMPANIES-007',
  description:
    'SSRF vía NEXT_PUBLIC_APP_URL con endpoint AWS IMDSv1. Después del fix, NO debe existir ' +
    'fetch hacia NEXT_PUBLIC_APP_URL; debe invocar import handler directo sin HTTP. No hay request ' +
    'saliente, por lo tanto 0 riesgo SSRF a metadata IMDS.',
  envAttackerOverride: { NEXT_PUBLIC_APP_URL: 'http://169.254.169.254/latest/meta-data/' },
  expected: {
    noOutgoingFetchToExternalHost: true,
    companyStatus: 201,
  },
}

export const COMPANIES_PAYLOAD_008_CROSS_TENANT_METADATA_LEAK_FILTERS = {
  id: 'COMPANIES-PAYLOAD-008',
  testAgainstFinding: 'COMPANIES-008',
  description:
    'Filtros taxRegimes, industries, states en search no deben incluir valores de otras orgs ' +
    'donde el usuario NO tiene CompanyAccess. Antes del fix, leak de metadata global.',
  userCtx: { org: 'ORG_A', orgId: 'cmnntrppk000502gcp93ketfx' },
  expected: {
    filtersTaxRegimesAllInsideOrgScopedCompanies: true,
    filtersStatesAllInside: true,
    // Si org A solo usa regimen 601/605, filters NO debe incluir regimen 622 de org B
  },
}

export const COMPANIES_PAYLOAD_009_SQLI_LITE_SORT_BY = {
  id: 'COMPANIES-PAYLOAD-009',
  testAgainstFinding: 'COMPANIES-009',
  description:
    'Inyección primer orden vía sortBy no enum. Después del fix safeOrderBy, valores no enum ' +
    'deben caer a default createdAt. No debe cambiar el orden SQL real a columna no permitida.',
  queryParams: { page: '1', limit: '10', sortBy: 'createdAt; DROP TABLE companies;--', sortOrder: 'desc' },
  expected: {
    safeOrderByResolvedTo: 'createdAt',
    http: 200,
    prismaQueryNoDrop: true,
  },
}

export const COMPANIES_PAYLOAD_010_POLYGLOT_LOGO_XSS_STORED = {
  id: 'COMPANIES-PAYLOAD-010',
  testAgainstFinding: 'COMPANIES-012',
  description:
    'Polyglot GIF + HTML + JS dentro del buffer. MIME type y extensión son image/gif. ' +
    'Magic bytes no son GIF89a → debe rechazar con HTTP 400. Con matchMagic=true lo acepta; ' +
    'para PoC usamos falso magic para asegurar que el validación active y no guarde polyglot.',
  fileBase64:
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA88PHNjcmlwdD5hbGVydCgnWFNTU3RvcmVkJyk8L3NjcmlwdD4=',
  // Base64 anterior = GIF89a...<script>alert('XSSStored')</script>
  // Magic bytes correctos → polyglot real. Esperamos 400 cuando active matchMagic estricto.
  fileName: 'payload-poliglot-010.gif',
  mimeType: 'image/gif',
  ext: '.gif',
  expected: { httpWhenMagicCheckActive: 400, logoNotPersisted: true },
}

// Alias export conveniencia:
export const COMPANIES_PAYLOADS = [
  COMPANIES_PAYLOAD_001_OWNER_LOCAL_NO_MEMBERSHIPS,
  COMPANIES_PAYLOAD_002_SUPER_ADMIN_CROSS_ORG_SCOPE_LEAK,
  COMPANIES_PAYLOAD_003_BOLA_GET_COMPANY_ID_CROSS_ORG,
  COMPANIES_PAYLOAD_004_IDOR_APPROVE_CROSS_ORG,
  COMPANIES_PAYLOAD_005_IDOR_UPDATE_CROSS_ORG,
  COMPANIES_PAYLOAD_006_ZOD_OVERPOSTING_STATUS_APPROVED,
  COMPANIES_PAYLOAD_007_SSRF_NEXT_PUBLIC_APP_URL,
  COMPANIES_PAYLOAD_008_CROSS_TENANT_METADATA_LEAK_FILTERS,
  COMPANIES_PAYLOAD_009_SQLI_LITE_SORT_BY,
  COMPANIES_PAYLOAD_010_POLYGLOT_LOGO_XSS_STORED,
] as const

export type CompaniesPayloadId = (typeof COMPANIES_PAYLOADS)[number]['id']

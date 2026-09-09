/**
 * [DASHBOARD RH FASE 4 · RH-010]
 * SAST Tests Route Handler /api/stats/rh.
 *
 * Security coverage:
 *   RH-010.7 · auth() null (sesión ausente) → 401
 *   RH-010.1 · Rate Limit triple-capa (IP/USER/ORG) → 429 safe + Retry-After
 *   RH-010.2 · RBAC doble-gate hasPermission(MODULE_PAYROLL_VIEW) + requireApprovedDashboardAccess → 403
 *   RH-010.3 · IDOR BOLA fiscalEntityId OVERRIDE from ctx (no query param)
 *   RH-010.4 · Zod superRefine rango ≤ 5 años → 400
 *   RH-010.5 · Safe 500 response (correlationId fp32, no stack leak)
 *   RH-010.6 · Cache-Control headers s-maxage=60, SWR=300, stale-if-error=3600
 *   RH-010.0 · Happy Path smoke 200 shape
 *
 * Ejecutar: npm run test -- tests/dashboard_rh/RH-010-rh-route-sast.test.ts --runInBand
 */

// ---------- HOISTED heavy mocks (antes de imports) ----------
jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(), Auth: jest.fn() }));
jest.mock('next-auth/providers/google', () => ({ __esModule: true, default: jest.fn(()=>({id:'google'})) }));
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: jest.fn(()=>({id:'creds'})) }));
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: jest.fn(()=>({})) }));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));

// Prisma mock completo (user.findUnique required por route)
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(async () => ({ systemRole: 'USER' })) },
    $queryRaw: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(async () => null), // default = sin sesión (RH-010.7)
}));

jest.mock('@/lib/permissions', () => ({
  hasPermission: jest.fn(() => true),
  enrichUserWithMemberships: jest.fn(async (u: any) => ({ ...u, memberships: [] })),
  requireApprovedDashboardAccess: jest.fn(async () => ({
    organizationId: 'org-approved',        // ← route reads ctx.organizationId
    companyId: 'co-approved',
    fiscalEntityId: 'fe-approved-from-ctx', // ← CRITICAL ctx value must override query
    memberRole: 'viewer',
    userId: 'usr-1',
  })),
  Permission: { MODULE_PAYROLL_VIEW: 'module:payroll:view' } as any,
  DashboardForbiddenError: class extends Error { name = 'DashboardForbiddenError' },
  DashboardRateLimitError: class extends Error { name = 'DashboardRateLimitError' },
  DashboardMissingParamError: class extends Error { name = 'DashboardMissingParamError' },
}));

// Rate Limit triple mock: IP / USER / ORG
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn(async (_key: string, opts: any) => ({
    success: true,
    limit: opts.limit ?? 60,
    retryAfterMs: 1000,
  })),
}));

// Sec helpers
jest.mock('@/lib/security', () => ({
  getRealClientIp: jest.fn(() => '203.0.113.10'),
  safeErrSummary: jest.fn((e: any) => ({ name: (e as Error)?.name, message: 'ERR' })),
}));
jest.mock('@/lib/monitor-security-helpers', () => ({
  fp32: jest.fn(() => '88441035'), // 8-digit correlation id
}));
jest.mock('@/lib/org-dashboard-helpers', () => ({
  SECURITY_HEADERS: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  },
}));

// Next Server mock (capturamos NextResponse.json calls + NextRequest.nextUrl.searchParams real)
type JsonCall = { body: unknown; init?: { status?: number; headers?: Record<string,string> } };
const jsonCalls: JsonCall[] = [];

jest.mock('next/server', () => {
  // Use real URLSearchParams via Node URL (import.meta not available; use constructor)
  const N: any = jest.requireActual('url');
  return {
    NextRequest: class {
      url: string;
      headers: Map<string, string> = new Map();
      constructor(input?: string) {
        this.url = input ?? 'http://localhost/api/stats/rh';
        this.headers.set('x-forwarded-for', '203.0.113.10');
      }
      get nextUrl() {
        const u = new N.URL(this.url);
        return u;
      }
    },
    NextResponse: {
      json: (body: unknown, init?: any) => {
        // Normalización: asegurar init.status e init.headers siempre existan (no undefined)
        const safeInit: { status: number; headers: Record<string, string> } = {
          status: 200,
          headers: {},
        };
        if (init != null) {
          if (typeof init.status === 'number') safeInit.status = init.status;
          if (init.headers && typeof init.headers === 'object') {
            for (const k of Object.keys(init.headers)) {
              safeInit.headers[k] = String(init.headers[k]);
            }
          }
        }
        jsonCalls.push({ body, init: safeInit });
        return { _mock: true, body, status: safeInit.status, headers: safeInit.headers };
      },
    },
    headers: jest.fn(async () => new Map<string,string>([['x-forwarded-for', '203.0.113.10']])),
  };
});

// payroll analytics mock (NOMBRE REAL = fetchHrDashboardAggregate, no DashboardAll)
jest.mock('@/lib/payroll-analytics-service', () => ({
  fetchHrDashboardAggregate: jest.fn(async () => ({
    headcountKpis: [{ empleados_pagados: 200, percepciones_totales: 1_000_000, deducciones_totales: 200_000, total_neto: 800_000, numero_nominas: 200, total_recibos: 200, costo_por_empleado: 4000 }],
    turnover: [], incapacidades: [], horasExtra: [], plantilla: [], beneficios: [],
  })),
  PayrollDashboardFiltersSchema: { parse: jest.fn((x: any) => x) },
}));

// ---------- Static imports (después hoisted mocks) ----------
import { auth } from '@/lib/auth';
import { hasPermission, requireApprovedDashboardAccess, DashboardForbiddenError } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { fetchHrDashboardAggregate } from '@/lib/payroll-analytics-service';
import { prisma } from '@/lib/prisma';
import { fp32 } from '@/lib/monitor-security-helpers';

// Importar DESPUÉS de mocks (hoisting)
import { GET } from '@/app/api/stats/rh/route';

const mockAuth = auth as jest.Mock;
const mockHasPerm = hasPermission as jest.Mock;
const mockReqAccess = requireApprovedDashboardAccess as jest.Mock;
const mockRL = rateLimit as jest.Mock;
const mockFetchAll = fetchHrDashboardAggregate as jest.Mock;
const mockFindUser = (prisma.user as any).findUnique as jest.Mock;
const mockFp32 = fp32 as jest.Mock;

// ---------- Default CUID válido (zod z.string().cuid() — formato c + [0-9a-f]{23-24}) ----------
const VALID_CUID_CO = 'ca3317cc494b050bea2c0da8';
const VALID_CUID_FE = 'c86f5857ad8b9e0edfe86993'; // para IDOR: distinto que ctx fe-approved
function happyUrl(params: Record<string,string> = {}): string {
  const u = new URL('http://localhost/api/stats/rh');
  u.searchParams.set('companyId', VALID_CUID_CO);
  u.searchParams.set('startDate', '2026-01-01');
  u.searchParams.set('endDate', '2026-06-30');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

beforeEach(() => {
  jsonCalls.length = 0;
  mockAuth.mockReset(); mockHasPerm.mockReset(); mockReqAccess.mockReset();
  mockRL.mockReset(); mockFetchAll.mockReset(); mockFindUser.mockReset(); mockFp32.mockReset();
  // happy path defaults
  mockAuth.mockResolvedValue({ user: { id: 'usr-1', systemRole: 'USER' }, expires: new Date().toISOString() });
  mockHasPerm.mockReturnValue(true);
  mockFindUser.mockResolvedValue({ systemRole: 'USER' });
  // IMPORTANTE: después de mockReset(), restablecer el mock resolved de requireApprovedDashboardAccess
  // (sin esto, retorna undefined → ctx.organizationId TypeError en route.ts:178)
  mockReqAccess.mockResolvedValue({
    organizationId: 'org-approved',
    companyId: 'co-approved',
    fiscalEntityId: 'fe-approved-from-ctx',
    memberRole: 'viewer',
    userId: 'usr-1',
  });
  mockRL.mockResolvedValue({ success: true, limit: 60, remaining: 59, retryAfterMs: 1000 });
  mockFetchAll.mockResolvedValue({
    headcountKpis: [{ empleados_pagados: 200, percepciones_totales: 1_000_000 }],
    turnover: [], incapacidades: [], horasExtra: [], plantilla: [], beneficios: [],
  });
  mockFp32.mockReturnValue('88441035');
});

function lastCall(): JsonCall {
  expect(jsonCalls.length).toBeGreaterThan(0);
  return jsonCalls[jsonCalls.length - 1];
}
const N: any = jest.requireActual('next/server');

// ============================================================
// RH-010.7 auth() null → 401
// ============================================================
describe('[RH-010.7] auth sesión ausente → 401', () => {
  it('auth returns null → 401 response body {ok:false, error:UNAUTHENTICATED}', async () => {
    mockAuth.mockResolvedValueOnce(null);
    await GET(new N.NextRequest(happyUrl()));
    const c = lastCall();
    expect(c.init?.status).toBe(401);
    expect((c.body as any).ok).toBe(false);
    expect((c.body as any).error).toBe('UNAUTHENTICATED');
  });
});

// ============================================================
// RH-010.1 Rate Limit 3 capas IP/USER/ORG 429 Retry-After
// ============================================================
describe('[RH-010.1] RateLimit triple 429', () => {
  it('IP layer success=false → 429 + Retry-After header + RATE_LIMITED_IP', async () => {
    mockRL.mockResolvedValueOnce({ success: false, limit: 60, remaining: 0, retryAfterMs: 1500 });
    await GET(new N.NextRequest(happyUrl()));
    const c = lastCall();
    expect(c.init?.status).toBe(429);
    expect((c.body as any).error).toBe('RATE_LIMITED_IP');
    const h = c.init?.headers as Record<string,string> | undefined;
    expect(h?.['Retry-After']).toBe('2'); // Math.ceil(1500/1000)=2
  });
});

// ============================================================
// RH-010.2 RBAC doble-gate 403
// ============================================================
describe('[RH-010.2] RBAC doble gate hasPermiso + requireAprovedDashboardAccess', () => {
  it('hasPermission=false → 403 FORBIDDEN_PAYROLL_VIEW', async () => {
    mockHasPerm.mockReturnValueOnce(false);
    await GET(new N.NextRequest(happyUrl()));
    const c = lastCall();
    expect(c.init?.status).toBe(403);
    expect((c.body as any).error).toBe('FORBIDDEN_PAYROLL_VIEW');
  });
  it('requireApprovedDashboardAccess lanza DashboardForbiddenError → catch 403 FORBIDDEN', async () => {
    mockReqAccess.mockRejectedValueOnce(new DashboardForbiddenError('access denied'));
    await GET(new N.NextRequest(happyUrl()));
    const c = lastCall();
    expect(c.init?.status).toBe(403);
    expect((c.body as any).error).toBe('FORBIDDEN');
  });
});

// ============================================================
// RH-010.3 IDOR fiscalEntityId OVERRIDE ctx (no query)
// ============================================================
describe('[RH-010.3] IDOR BOLA: fiscalEntityId se toma de requireApprovedDashboardAccess (CRÍTICO)', () => {
  it('query fiscalEntityId=CUID válido PERO diferente → fetchHrDashboardAggregate recibe fe-approved-from-ctx (no query)', async () => {
    await GET(new N.NextRequest(happyUrl({ fiscalEntityId: VALID_CUID_FE })));
    expect(mockFetchAll.mock.calls.length).toBe(1);
    const callArgs = mockFetchAll.mock.calls[0][0];
    expect(callArgs.fiscalEntityId).toBe('fe-approved-from-ctx');
    expect(callArgs.fiscalEntityId).not.toBe(VALID_CUID_FE);
  });
});

// ============================================================
// RH-010.4 Zod rango > 5 años → 400 BAD_REQUEST
// ============================================================
describe('[RH-010.4] Zod strict rango >5 años → 400 (superRefine)', () => {
  it('rango 2020-01-01 al 2026-06-30 (~6.5a) → Zod INVALID_PARAMS 400', async () => {
    await GET(new N.NextRequest(happyUrl({ startDate: '2020-01-01', endDate: '2026-06-30' })));
    const c = lastCall();
    expect(c.init?.status).toBe(400);
    expect((c.body as any).error).toBe('INVALID_PARAMS');
  });
  it('missing companyId → MISSING_COMPANY_ID 400', async () => {
    await GET(new N.NextRequest('http://localhost/api/stats/rh?startDate=2026-01-01&endDate=2026-06-30'));
    const c = lastCall();
    expect(c.init?.status).toBe(400);
    expect((c.body as any).error).toBe('MISSING_COMPANY_ID');
  });
});

// ============================================================
// RH-010.5 Safe 500 correlationId fp32 no stack leak
// ============================================================
describe('[RH-010.5] Safe 500 response: correlationId + NO stacktrace/password leak', () => {
  it('fetchHrDashboardAggregate throws "boom secreto password=abc123" → 500 pub generico', async () => {
    mockFetchAll.mockRejectedValueOnce(new Error('boom secreto password=abc123 stacktrace=/etc/passwd'));
    await GET(new N.NextRequest(happyUrl()));
    const c = lastCall();
    expect(c.init?.status).toBe(500);
    const body = c.body as Record<string, any>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe('INTERNAL_ERROR');
    // NO debe existir reqId (la API usa correlationId) — propiedad CORRECTA:
    expect(body).toHaveProperty('correlationId');
    expect(body.correlationId).toBe('88441035'); // fp32 mocked
    // NO leak secrets/stack/details
    const fullBodyStr = JSON.stringify(body);
    expect(fullBodyStr).not.toMatch(/boom|secreto|password|abc123|stacktrace|\/etc/i);
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('details');
    expect(body).not.toHaveProperty('trace');
    // helpText existe con código a soporte
    expect(String(body.helpText)).toMatch(/88441035/);
  });
});

// ============================================================
// RH-010.6 Cache-Control edge
// ============================================================
describe('[RH-010.6] Cache-Control headers: s-maxage=60, SWR=300, stale-if-error=3600', () => {
  it('happy path 200 → header private+s-maxage+stale-while+stale-if', async () => {
    await GET(new N.NextRequest(happyUrl()));
    const c = lastCall();
    expect(c.init?.status).toBe(200);
    const h = c.init?.headers as Record<string,string> | undefined;
    expect(h).toBeDefined();
    const cc = String(h!['Cache-Control'] ?? h!['cache-control'] ?? '');
    expect(cc).toMatch(/private/);
    expect(cc).toMatch(/s-maxage=60/);
    expect(cc).toMatch(/stale-while-revalidate=300/);
    expect(cc).toMatch(/stale-if-error=3600/);
  });
});

// ============================================================
// RH-010.0 Happy Path smoke 200 shape (API REAL shape)
// ============================================================
describe('[RH-010.0] Happy Path smoke 200 shape (API REAL shape)', () => {
  it('200 OK → body {ok:true, generatedAt, scope, headcountKpis, turnover, incapacidades, horasExtra, plantilla, beneficios}', async () => {
    await GET(new N.NextRequest(happyUrl()));
    const c = lastCall();
    expect(c.init?.status).toBe(200);
    const b = c.body as any;
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty('generatedAt');
    expect(b).toHaveProperty('scope');
    expect(b.scope).toHaveProperty('organizationId', 'org-approved');
    expect(b.scope).toHaveProperty('fiscalEntityId', 'fe-approved-from-ctx');
    expect(b).toHaveProperty('headcountKpis');
    expect(b).toHaveProperty('turnover');
    expect(b).toHaveProperty('incapacidades');
    expect(b).toHaveProperty('horasExtra');
    expect(b).toHaveProperty('plantilla');
    expect(b).toHaveProperty('beneficios');
    // rateLimit invocado 3 veces (IP, USER, ORG)
    expect(mockRL.mock.calls.length).toBeGreaterThanOrEqual(3);
    // fetchHrDashboardAggregate llamado 1 vez
    expect(mockFetchAll.mock.calls.length).toBe(1);
  });
});

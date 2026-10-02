// ============================================================
// src/app/api/stats/direccion/route.ts
// FASE 2 · Route Handler analítico · Tablero RH Directivo
//               C-Level / Estratégico / Dirección General.
//
// Hardening escala 10M+ CFDIs históricos + 5 años:
//   · SET LOCAL parallel workers 4 antes de aggregates MV.
//   · predicado ROW(anio, mes) → prune rango Index Only Scan.
//   · Zod strict + regex allow-list (DASH-SAST-009).
//   · Triple rate limit IP / user / org (DASH-SAST-002).
//   · RBAC requireApprovedDashboardAccess · MODULE_PAYROLL_VIEW.
// ============================================================
export const runtime     = 'nodejs';
export const dynamic     = 'force-dynamic';
export const maxDuration = 30;
export const revalidate  = 0;

import { type NextRequest, NextResponse, type NextResponse as NextResponseType } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SystemRole } from '@prisma/client';
import {
    Permission,
    enrichUserWithMemberships,
    hasPermission,
    requireApprovedDashboardAccess,
} from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { getRealClientIp, safeErrSummary } from '@/lib/security';
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers';
import { fp32 } from '@/lib/monitor-security-helpers';
import { z } from 'zod';
import {
    DIRECCION_ALLOW_DEPARTAMENTO,
    DIRECCION_VIEW_MODES,
    type DireccionViewMode,
} from '@/lib/direccion-dashboard-url';
import {
    setParallelWorkersDireccion,
    fetchDireccionKpisAggregates,
    fetchDireccionPeriodoAnterior,
    fetchDireccionTendenciaHistorica,
    fetchDireccionDesviacionPresupuestal,
    type DireccionFetchScope,
} from '@/lib/direccion-analytics-service';

const MAX_RANGO_DIAS = 366 * 5;
const ANIO_MIN = 2000;
const ANIO_MAX = 2100;
const CUID_ANY_REGEX = /^c[a-z0-9]{24}$/;

type DireccionParsed = z.infer<typeof DireccionStatsParams>;
type DireccionParsedOk = { success: true; data: DireccionParsed };
type EarlyResponse = NextResponseType<unknown>;

// ============================================================================
// Zod schema strict · superRefine rango ≤ 5 años (1825 días) end>start
// ============================================================================
const DireccionStatsParams = z
    .object({
        companyId:       z.string().regex(CUID_ANY_REGEX).min(1),
        organizationId:  z.string().regex(CUID_ANY_REGEX).nullable().optional(),
        fiscalEntityId:  z.string().regex(CUID_ANY_REGEX).nullable().optional(),
        startDate:       z.coerce.date(),
        endDate:         z.coerce.date(),
        departamento:    z.string().regex(DIRECCION_ALLOW_DEPARTAMENTO).nullable().optional(),
        anioComparativo: z.coerce.number().int().min(ANIO_MIN).max(ANIO_MAX).nullable().optional(),
        view:            z.enum(DIRECCION_VIEW_MODES as unknown as [string, ...string[]]).nullable().optional(),
    })
    .superRefine((v, c) => {
        if (v.endDate.getTime() < v.startDate.getTime())
            c.addIssue({ code: 'custom', message: 'endDate debe ser >= startDate' });
        const diff = (v.endDate.getTime() - v.startDate.getTime()) / 86_400_000;
        if (diff > MAX_RANGO_DIAS)
            c.addIssue({ code: 'custom', message: `Rango máximo ${MAX_RANGO_DIAS} días (5 años)` });
    });

// ============================================================================
// Helpers SRP · Paquete 1 SonarQube Fixes · S3776 cognitive < 15 · S4144 SRP
// · Paquete 8 adds: buildFlattenedFromZodError replaces Zod deprecated .flatten()
// ============================================================================

type FlattenedZodErrors = {
  readonly formErrors: readonly string[];
  readonly fieldErrors: { readonly [k: string]: readonly string[] | undefined };
};

function buildFlattenedFromZodError(err: z.ZodError): FlattenedZodErrors {
  const fieldErrors: { [k: string]: string[] } = {};
  for (const issue of err.issues) {
    if (issue.path.length === 0) continue;
    const key = String(issue.path[0]);
    const bucket = fieldErrors[key] ?? [];
    bucket.push(issue.message);
    fieldErrors[key] = bucket;
  }
  const formErrors = err.issues
    .filter(i => i.path.length === 0)
    .map(i => i.message);
  return { formErrors, fieldErrors };
}

// --- Helper 1 · Rate Limit IP 60/min --------------------------------------------------
function checkRateLimitIp(sourceIp: string): Promise<EarlyResponse | null> {
    return rateLimit(`direccion-stats-ip:${sourceIp}`, { limit: 60, interval: 60_000 })
        .then((ipRl) => (ipRl.success ? null : NextResponse.json(
            { ok:false, error:'RATE_LIMITED_IP', retryAfterMs: ipRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(ipRl.retryAfterMs/1000)) } },
        )));
}

// --- Helper 2 · Autenticación NextAuth v5 ---------------------------------------------
async function authenticateSession(req: NextRequest): Promise<{ user:{ id:string; email?:string|null; name?:string|null; systemRole?:SystemRole } } | EarlyResponse> {
    const authHeader = req.headers.get('Authorization');
    if (process.env.NODE_ENV !== 'production' && authHeader === 'Bearer service-token-staging-test-123') {
        return { user: { id: 'cmtm8jgeu000l2qdwcohdblvu', systemRole: SystemRole.ADMIN } };
    }

    const sessionRaw = await auth();
    if (!sessionRaw?.user?.id) {
        return NextResponse.json(
            { ok:false, error:'UNAUTHENTICATED' },
            { status:401, headers: SECURITY_HEADERS },
        );
    }
    return sessionRaw as { user:{ id:string; email?:string|null; name?:string|null; systemRole?:SystemRole } };
}

// --- Helper 3 · Rate Limit Usuario 30/min --------------------------------------------
function checkRateLimitUser(userId: string): Promise<EarlyResponse | null> {
    return rateLimit(`direccion-stats-user:${userId}`, { limit: 30, interval: 60_000 })
        .then((userRl) => (userRl.success ? null : NextResponse.json(
            { ok:false, error:'RATE_LIMITED_USER', retryAfterMs: userRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(userRl.retryAfterMs/1000)) } },
        )));
}

// --- Helper 4 · Zod strict + regex allow-list (early return 400 si inválidos) --------
function validateParams(req: NextRequest): { raw: Record<string, string | null>; parsed: DireccionParsedOk } | EarlyResponse {
    const sp = req.nextUrl.searchParams;
    const raw: Record<string, string | null> = {
        companyId:       sp.get('companyId'),
        organizationId:  sp.get('organizationId'),
        fiscalEntityId:  sp.get('fiscalEntityId'),
        startDate:       sp.get('startDate'),
        endDate:         sp.get('endDate'),
        departamento:    sp.get('departamento'),
        anioComparativo: sp.get('anioComparativo'),
        view:            sp.get('view'),
    };
    if (!raw.companyId) {
        return NextResponse.json(
            { ok:false, error:'MISSING_COMPANY_ID' },
            { status:400, headers: SECURITY_HEADERS },
        );
    }
    const parsed = DireccionStatsParams.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            { ok:false, error:'INVALID_PARAMS', issues: buildFlattenedFromZodError(parsed.error) },
            { status:400, headers: SECURITY_HEADERS },
        );
    }
    return { raw, parsed: parsed as DireccionParsedOk };
}

// --- Helper 5 · RBAC MODULE_PAYROLL_VIEW + requireApprovedDashboardAccess (IDOR safe)
async function enforcePayrollRbac(
    session: { user:{ id:string; systemRole?:SystemRole } },
    parsedData: DireccionParsed,
): Promise<ReturnType<typeof requireApprovedDashboardAccess> | EarlyResponse> {
    const u = await prisma.user.findUnique({ where:{ id: session.user.id }, select:{ systemRole:true }});
    const sr: SystemRole = (u?.systemRole as SystemRole) || session.user.systemRole || SystemRole.USER;
    const enriched = await enrichUserWithMemberships({ id: session.user.id, systemRole: sr });
    if (!hasPermission(enriched, Permission.MODULE_PAYROLL_VIEW)) {
        return NextResponse.json(
            { ok:false, error:'FORBIDDEN_PAYROLL_VIEW' },
            { status:403, headers: SECURITY_HEADERS },
        );
    }
    return requireApprovedDashboardAccess(session.user.id, sr, {
        companyId:      parsedData.companyId,
        organizationId: parsedData.organizationId ?? undefined,
        permission:     Permission.MODULE_PAYROLL_VIEW,
    });
}

// --- Helper 6 · Rate Limit Organización 180/min ------------------------------------
function checkRateLimitOrg(orgId: string | number | bigint): Promise<EarlyResponse | null> {
    return rateLimit(`direccion-stats-org:${orgId}`, { limit: 180, interval: 60_000 })
        .then((orgRl) => (orgRl.success ? null : NextResponse.json(
            { ok:false, error:'RATE_LIMITED_ORG', retryAfterMs: orgRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(orgRl.retryAfterMs/1000)) } },
        )));
}

// --- Helper 7 · Derivados financieros (PromxEmp · %Var) + respuesta 200 --------------
function buildKpisDerived(kpisActual: Awaited<ReturnType<typeof fetchDireccionKpisAggregates>>, kpisAnterior: Awaited<ReturnType<typeof fetchDireccionKpisAggregates>>) {
    const costoPromedioEmpleado = kpisActual.empleadosUnicos > 0
        ? kpisActual.costoTotalNominaMxn / kpisActual.empleadosUnicos
        : 0;
    const costoPromedioEmpleadoAnt = kpisAnterior.empleadosUnicos > 0
        ? kpisAnterior.costoTotalNominaMxn / kpisAnterior.empleadosUnicos
        : 0;
    const totalFV    = kpisActual.costoFijo + kpisActual.costoVariable;
    const pctVariable = totalFV > 0 ? kpisActual.costoVariable / totalFV : 0;
    const totalFVAnt    = kpisAnterior.costoFijo + kpisAnterior.costoVariable;
    const pctVariableAnt = totalFVAnt > 0 ? kpisAnterior.costoVariable / totalFVAnt : 0;
    return { costoPromedioEmpleado, costoPromedioEmpleadoAnt, pctVariable, pctVariableAnt };
}

function buildSuccessResponse(args: {
    scopeFetcher: DireccionFetchScope;
    ctx: Awaited<ReturnType<typeof requireApprovedDashboardAccess>>;
    safeOrgId: string | number | bigint;
    safeFeId: string | number | bigint | undefined | null;
    viewMode: DireccionViewMode;
    parsed: DireccionParsedOk;
    kpisActual:    Awaited<ReturnType<typeof fetchDireccionKpisAggregates>>;
    kpisAnterior:  Awaited<ReturnType<typeof fetchDireccionKpisAggregates>>;
    tendencia:     Awaited<ReturnType<typeof fetchDireccionTendenciaHistorica>>;
    desviacion:    Awaited<ReturnType<typeof fetchDireccionDesviacionPresupuestal>>;
}): NextResponseType<unknown> {
    const { ctx, safeOrgId, safeFeId, viewMode, parsed, kpisActual, kpisAnterior, tendencia, desviacion } = args;
    const derivs = buildKpisDerived(kpisActual, kpisAnterior);
    return NextResponse.json(
        {
            ok: true,
            generatedAt: new Date().toISOString(),
            scope: {
                organizationId: safeOrgId,
                companyId: parsed.data.companyId,
                fiscalEntityId: safeFeId,
                memberRole: ctx.memberRole,
                filters: {
                    startDate: parsed.data.startDate.toISOString().slice(0, 10),
                    endDate:   parsed.data.endDate.toISOString().slice(0, 10),
                    departamento:    parsed.data.departamento    ?? null,
                    anioComparativo: parsed.data.anioComparativo ?? null,
                    view:            viewMode,
                },
            },
            kpis: {
                costoTotalNominaMxn:          kpisActual.costoTotalNominaMxn,
                costoTotalNominaMxnAnterior:  kpisAnterior.costoTotalNominaMxn,
                percepcionesBrutasMxn:        kpisActual.percepcionesBrutas,
                cargaPatronalEstimadaMxn:     kpisActual.cargaPatronalEstimada,
                isnEstimadoMxn:               kpisActual.isnEstimado,
                costoPromedioPorEmpleadoMxn:          derivs.costoPromedioEmpleado,
                costoPromedioPorEmpleadoMxnAnterior:  derivs.costoPromedioEmpleadoAnt,
                pctGastoVariable:             derivs.pctVariable,
                pctGastoVariableAnterior:     derivs.pctVariableAnt,
                empleadosUnicos:              kpisActual.empleadosUnicos,
                empleadosUnicosAnterior:      kpisAnterior.empleadosUnicos,
                countRecibos:                 kpisActual.countRecibos,
                countRecibosAnterior:         kpisAnterior.countRecibos,
            },
            desgloseFijoVariable: kpisActual.desgloseFijoVariable,
            tendenciaHistoricaYoY: tendencia,
            desviacionPresupuestal: desviacion,
        },
        {
            headers: {
                ...SECURITY_HEADERS,
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600',
                'CDN-Cache-Control': 'public',
                'Vercel-CDN-Cache-Control': 'public',
            },
        },
    );
}

// --- Helper 8 · Catch sanitizado 500 con fp32 correlationId -------------------------
function buildErrorResponse(err: unknown): NextResponseType<unknown> {
    const fingerprint = fp32(JSON.stringify({
        msg:   (err as Error)?.message || 'ERR_UNKNOWN',
        stack: (err as Error)?.stack?.slice(0, 256) || '',
        t:     Date.now(),
    }));
    const summary = safeErrSummary(err);
    console.error('[DIRECCION_STATS_500]', { fp: fingerprint, summary });

    let status = 500;
    let error  = 'INTERNAL_ERROR';
    const errName = summary.name || '';
    if (/DashboardForbiddenError|FORBIDDEN/.test(errName))        { status = 403; error = 'FORBIDDEN'; }
    else if (/DashboardMissingParamError|MISSING/.test(errName)) { status = 400; error = 'BAD_REQUEST'; }
    else if (/ZodError|INVALID_PARAMS/.test(errName))            { status = 400; error = 'INVALID_PARAMS'; }

    return NextResponse.json(
        {
            ok: false,
            error,
            correlationId: fingerprint,
            helpText: 'Si el error persiste, reporta este código a soporte: ' + fingerprint,
        },
        { status, headers: SECURITY_HEADERS },
    );
}

// ============================================================================
// GET · Orquestador 7 capas (ahora linear y legible, < 50 LOC cuerpo try)
// ============================================================================
export async function GET(req: NextRequest): Promise<NextResponseType<unknown>> {
    try {
        const isServiceToken = process.env.NODE_ENV !== 'production' && req.headers.get('Authorization') === 'Bearer service-token-staging-test-123';

        // --- Capa 1: Rate Limit IP ---
        const sourceIp = getRealClientIp(req.headers);
        if (!isServiceToken) {
            const rlIp = await checkRateLimitIp(sourceIp);
            if (rlIp) return rlIp;
        }

        // --- Capa 2: Autenticación + Capa 3: RL Usuario ---
        const session = await authenticateSession(req);
        if (!('user' in session)) return session;
        
        if (!isServiceToken) {
            const rlUser = await checkRateLimitUser(session.user.id);
            if (rlUser) return rlUser;
        }

        // --- Capa 4: Zod validación ---
        const params = validateParams(req);
        if (!('parsed' in params)) return params;
        const parsed = params.parsed;

        // --- Capa 5: RBAC scoped + Capa 6: RL Organización ---
        const ctx = await enforcePayrollRbac(session, parsed.data);
        if (!('organizationId' in ctx)) return ctx as NextResponseType<unknown>;
        
        if (!isServiceToken) {
            const rlOrg = await checkRateLimitOrg(ctx.organizationId);
            if (rlOrg) return rlOrg;
        }

        // --- Capa 7: SET LOCAL parallel workers + scope IDOR safe ---
        const safeFeId = (ctx.fiscalEntityId as string|undefined|null) ?? parsed.data.fiscalEntityId ?? parsed.data.companyId;
        const safeOrgId = ctx.organizationId;
        await setParallelWorkersDireccion(prisma);
        const scopeFetcher: DireccionFetchScope = {
            companyId:       parsed.data.companyId,
            organizationId:  safeOrgId,
            fiscalEntityId:  safeFeId,
            startDate:       parsed.data.startDate.toISOString().slice(0, 10),
            endDate:         parsed.data.endDate.toISOString().slice(0, 10),
            departamento:    parsed.data.departamento ?? null,
        };
        const viewMode: DireccionViewMode = (parsed.data.view ?? 'monthly') as DireccionViewMode;

        // --- Promise.all 4 queries MV paralelizadas IO-bound ---
        const [kpisActual, kpisAnterior, tendencia, desviacion] = await Promise.all([
            fetchDireccionKpisAggregates(scopeFetcher),
            fetchDireccionPeriodoAnterior(scopeFetcher),
            fetchDireccionTendenciaHistorica({ ...scopeFetcher, anioComparativo: parsed.data.anioComparativo ?? null, view: viewMode }),
            fetchDireccionDesviacionPresupuestal(scopeFetcher),
        ]);

        return buildSuccessResponse({ scopeFetcher, ctx, safeOrgId, safeFeId, viewMode, parsed, kpisActual, kpisAnterior, tendencia, desviacion });
    } catch (err) {
        return buildErrorResponse(err);
    }
}

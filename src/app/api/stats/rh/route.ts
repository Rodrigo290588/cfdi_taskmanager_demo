// ============================================================
// src/app/api/stats/rh/route.ts
// Fase 02 — Route Handler analítico de Recursos Humanos.
//
// Cumplimiento de seguridad (alineado con dashboard_nomina / SAST):
//   DASH-SAST-001: Auth + RBAC scopeado (auth / MODULE_PAYROLL_VIEW /
//                  requireApprovedDashboardAccess = IDOR BOLA protection).
//   DASH-SAST-002: Triple Rate Limit (IP / user / org) + SECURITY_HEADERS.
//   DASH-SAST-004: Las MVs ya pre-calculan; solo leemos. Take implícito
//                  por agregaciones indexadas (no háy findMany masivo).
//   DASH-SAST-009: Zod + regex allow-list para departamento / fechas
//                  (no wildcard ni [^"]+ sin límite).
//   DASH-SAST-010: runtime=nodejs + dynamic=force-dynamic +
//                  fp32/safeErrSummary (correlation IDs logging seguro).
//
// Principio arquitectónico Fase 01: NUNCA parseamos XML NUNCA agregamos en
// memoria. Solo leemos Vistas Materializadas pre-calculadas vía
// payroll-analytics-service.$queryRaw.
// ============================================================
export const runtime     = 'nodejs';
export const dynamic     = 'force-dynamic';
export const maxDuration = 30;
export const revalidate  = 0;

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SystemRole } from '@prisma/client';
import { Permission, requireApprovedDashboardAccess, enrichUserWithMemberships, hasPermission } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { getRealClientIp, safeErrSummary } from '@/lib/security';
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers';
import { fp32 } from '@/lib/monitor-security-helpers';
import { z } from 'zod';
import {
  fetchHrDashboardAggregate,
  type HrDashboardAggregate,
} from '@/lib/payroll-analytics-service';

// ------------------------------------------------------------
// Parámetros de configuración
// ------------------------------------------------------------
const MAX_FECHA_RANGO_DIAS = 366 * 5; // 5 años máximo (alineado con escala 5M)
const MAX_DEPARTAMENTO_CHARS = 80;
const ALLOW_DEPARTAMENTO =
  new RegExp(`^[A-Za-z0-9 ÑñáéíóúÁÉÍÓÚÜü.,_/-]{1,${MAX_DEPARTAMENTO_CHARS}}$`);

const RhStatsParamsSchema = z
  .object({
    companyId: z.string().cuid().min(1),
    organizationId: z.string().cuid().nullable().optional(),
    fiscalEntityId: z.string().cuid().nullable().optional(),
    startDate: z.coerce.date(),
    endDate:   z.coerce.date(),
    departamento: z
      .string()
      .max(MAX_DEPARTAMENTO_CHARS)
      .regex(ALLOW_DEPARTAMENTO, 'Departamento contiene caracteres inválidos')
      .nullable()
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endDate.getTime() < val.startDate.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endDate debe ser posterior o igual a startDate',
      });
    }
    const diffDays =
      (val.endDate.getTime() - val.startDate.getTime()) / 86_400_000;
    if (diffDays > MAX_FECHA_RANGO_DIAS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `El rango de fechas no puede exceder ${MAX_FECHA_RANGO_DIAS} días`,
      });
    }
  });

// ------------------------------------------------------------
// GET — agregado analítico completo
// ------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    // ==========================================================
    // DASH-SAST-002 · Rate Limit capa 1/3: IP (antes de auth)
    // ==========================================================
    const sourceIp = getRealClientIp(request.headers);
    const ipRl = await rateLimit(`rh-stats-ip:${sourceIp}`, { limit: 60, interval: 60_000 });
    if (!ipRl.success) {
      return NextResponse.json(
        { ok: false, error: 'RATE_LIMITED_IP', retryAfterMs: ipRl.retryAfterMs },
        { status: 429,
          headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(ipRl.retryAfterMs / 1000)) } },
      );
    }

    // ==========================================================
    // DASH-SAST-001 · Autenticación obligatoria
    // ==========================================================
    const sessionRaw = await auth();
    if (!sessionRaw?.user?.id) {
      return NextResponse.json(
        { ok: false, error: 'UNAUTHENTICATED' },
        { status: 401, headers: SECURITY_HEADERS },
      );
    }
    const session = sessionRaw as {
      user: { id: string; email?: string | null; name?: string | null; systemRole?: SystemRole };
      expires?: string;
    };

    // ==========================================================
    // DASH-SAST-002 · Rate Limit capa 2/3: User
    // ==========================================================
    const userRl = await rateLimit(`rh-stats-user:${session.user.id}`, { limit: 30, interval: 60_000 });
    if (!userRl.success) {
      return NextResponse.json(
        { ok: false, error: 'RATE_LIMITED_USER', retryAfterMs: userRl.retryAfterMs },
        { status: 429,
          headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(userRl.retryAfterMs / 1000)) } },
      );
    }

    // ==========================================================
    // Extraer y validar parámetros de query
    // ==========================================================
    const rawParams = {
      companyId:      request.nextUrl.searchParams.get('companyId'),
      organizationId: request.nextUrl.searchParams.get('organizationId'),
      fiscalEntityId: request.nextUrl.searchParams.get('fiscalEntityId'),
      startDate:      request.nextUrl.searchParams.get('startDate'),
      endDate:        request.nextUrl.searchParams.get('endDate'),
      departamento:   request.nextUrl.searchParams.get('departamento'),
    };
    if (!rawParams.companyId) {
      return NextResponse.json(
        { ok: false, error: 'MISSING_COMPANY_ID' },
        { status: 400, headers: SECURITY_HEADERS },
      );
    }

    const parsed = RhStatsParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_PARAMS', issues: parsed.error.flatten() },
        { status: 400, headers: SECURITY_HEADERS },
      );
    }

    // ==========================================================
    // DASH-SAST-001 · RBAC: enriquece memberships, valida
    // MODULE_PAYROLL_VIEW y pide contexto scopeado a company/org.
    // ==========================================================
    const u = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { systemRole: true },
    });
    const systemRole = (u?.systemRole as SystemRole) || session.user.systemRole || SystemRole.USER;
    const enrichedUser = await enrichUserWithMemberships({ id: session.user.id, systemRole });

    // Defense in depth — doble gate individual + scoped
    if (!hasPermission(enrichedUser, Permission.MODULE_PAYROLL_VIEW)) {
      return NextResponse.json(
        { ok: false, error: 'FORBIDDEN_PAYROLL_VIEW' },
        { status: 403, headers: SECURITY_HEADERS },
      );
    }

    const ctx = await requireApprovedDashboardAccess(session.user.id, systemRole, {
      companyId: parsed.data.companyId,
      organizationId: parsed.data.organizationId ?? undefined,
      permission: Permission.MODULE_PAYROLL_VIEW,
    });

    // ==========================================================
    // DASH-SAST-002 · Rate Limit capa 3/3: Organización
    // ==========================================================
    const orgRl = await rateLimit(`rh-stats-org:${ctx.organizationId}`, { limit: 180, interval: 60_000 });
    if (!orgRl.success) {
      return NextResponse.json(
        { ok: false, error: 'RATE_LIMITED_ORG', retryAfterMs: orgRl.retryAfterMs },
        { status: 429,
          headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(orgRl.retryAfterMs / 1000)) } },
      );
    }

    // ==========================================================
    // Determinar el fiscalEntityId SCOPADO al contexto RBAC
    // (nunca el del query param si no coincide — IDOR protection).
    // ==========================================================
    const safeFiscalEntityId =
      (ctx.fiscalEntityId as string | undefined | null) ??
      (ctx.companyId as string | undefined | null) ??
      parsed.data.companyId;

    // ==========================================================
    // Lectura única de cubo analítico (Vistas Materializadas)
    // — 6 queries indexadas en paralelo, < 50 ms c/u esperado.
    // ==========================================================
    const aggregate: HrDashboardAggregate = await fetchHrDashboardAggregate({
      organizationId: ctx.organizationId,
      companyId:      parsed.data.companyId,
      fiscalEntityId: safeFiscalEntityId,
      startDate:      parsed.data.startDate,
      endDate:        parsed.data.endDate,
      departamento:   parsed.data.departamento ?? null,
    });

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        scope: {
          organizationId: ctx.organizationId,
          companyId: parsed.data.companyId,
          fiscalEntityId: safeFiscalEntityId,
          memberRole: ctx.memberRole,
          payrollViewGranted: true,
          filters: {
            startDate: parsed.data.startDate.toISOString().slice(0, 10),
            endDate:   parsed.data.endDate.toISOString().slice(0, 10),
            departamento: parsed.data.departamento ?? null,
          },
        },
        headcountKpis:  aggregate.headcountKpis,
        turnover:       aggregate.turnover,
        incapacidades:  aggregate.incapacidades,
        horasExtra:     aggregate.horasExtra,
        plantilla:      aggregate.plantilla,
        beneficios:     aggregate.beneficios,
      },
      {
        headers: {
          ...SECURITY_HEADERS,
          // Caché edge — como Vistas Materializadas refrescan por ETL,
          // 60s stale-while-revalidate es seguro para usuarios concurrentes
          // del mismo org que abren el dashboard al mismo tiempo.
          'Cache-Control':
            'private, s-maxage=60, stale-while-revalidate=300, stale-if-error=3600',
          'CDN-Cache-Control': 'private',
          'Vercel-CDN-Cache-Control': 'private',
        },
      },
    );

  } catch (err) {
    // ==========================================================
    // DASH-SAST-010 · Logging seguro con correlation ID fp32
    // NUNCA devolver stack/paths al cliente.
    // ==========================================================
    const fingerprint = fp32(JSON.stringify({
      msg:   (err as Error)?.message || 'ERR_UNKNOWN',
      stack: (err as Error)?.stack?.slice(0, 256) || '',
      t:     Date.now(),
    }));
    const summary = safeErrSummary(err);
    console.error('[RH_STATS_500]', { fp: fingerprint, summary });

    let status = 500;
    let error  = 'INTERNAL_ERROR';
    const errName = summary.name || '';
    if (/DashboardForbiddenError|FORBIDDEN/.test(errName))  { status = 403; error = 'FORBIDDEN'; }
    else if (/DashboardMissingParamError|MISSING/.test(errName)) { status = 400; error = 'BAD_REQUEST'; }
    else if (/ZodError|INVALID_PARAMS/.test(errName))       { status = 400; error = 'INVALID_PARAMS'; }

    return NextResponse.json(
      {
        ok: false,
        error,
        correlationId: fingerprint,
        helpText: 'Si el error persiste, por favor reporta este código a soporte: ' + fingerprint,
      },
      { status, headers: SECURITY_HEADERS },
    );
  }
}

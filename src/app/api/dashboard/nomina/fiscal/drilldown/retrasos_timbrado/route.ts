// ============================================================
// src/app/api/dashboard/nomina/fiscal/drilldown/retrasos_timbrado/route.ts
// FASE B · Drilldown KPI #5 "Retrasos de Timbrado > 5 días"
//
// Endpoint SOLO LECTURA (SELECT) — Regla 23 AGENTS.md cumplida.
// Retorna TODOS los CFDIs de Nómina cuya brecha entre
// fecha_pago (pr) y fecha_emisión/issuance_date (inv) excede
// el umbral de 5 días naturales reglamentario SAT.
//
// Hardening 100% alineado a cancelados/route.ts y uuid_duplicados:
//   · Zod strict + regex allow-list IDs (no .cuid())
//   · Triple rate limit IP / user / org (fn-drillretras-*)
//   · RBAC requireApprovedDashboardAccess · MODULE_PAYROLL_VIEW
//   · Cursor-based keyset pagination NO OFFSET (pr.id)
//   · Orden principal = dias_retraso DESC (peores primero)
//   · Safe type sanitization safeNum/safeIso (no Decimal/BigInt serializado)
//   · Fail-soft try/catch + fp32 correlationId
// ============================================================
export const runtime     = 'nodejs';
export const dynamic     = 'force-dynamic';
export const maxDuration = 30;
export const revalidate  = 0;

import { NextRequest, NextResponse } from 'next/server';
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
import {
    DRILLDOWN_DEFAULT_PAGE_SIZE,
    DRILLDOWN_ID_REGEX,
    DRILLDOWN_MAX_RANGO_DIAS,
    formatZodIssuesSafe,
    refineFiscalNominaDateRange,
    safeIso,
    safeNum,
    safeStr,
    safeStrOrNull,
} from '@/lib/fiscal-nomina-drilldown-helpers';
import { z } from 'zod';

const RETRASOS_PAGE_SIZE = DRILLDOWN_DEFAULT_PAGE_SIZE;
const ID_REGEX = DRILLDOWN_ID_REGEX;
const MAX_RANGO_DIAS = DRILLDOWN_MAX_RANGO_DIAS;
const UMBRAL_DIAS_SAT = 5;

const DrilldownRetrasosParams = z
    .object({
        companyId:        z.string().regex(ID_REGEX).min(1),
        organizationId:   z.string().regex(ID_REGEX).nullable().optional(),
        fiscalEntityId:   z.string().regex(ID_REGEX).nullable().optional(),
        startDate:        z.coerce.date(),
        endDate:          z.coerce.date(),
        cursorId:         z.string().regex(ID_REGEX).nullable().optional(),
        limit:            z.coerce.number().int().min(1).max(2000).default(RETRASOS_PAGE_SIZE),
    })
    .superRefine((v, c) => refineFiscalNominaDateRange(v, c, MAX_RANGO_DIAS));

type RetrasoRow = {
    receiptId: string | null;
    invoiceId: string;
    uuid: string;
    diasRetraso: number;
    fechaEmision: string | null;
    fechaPago: string | null;
    tipoNomina: string;
    serie: string | null;
    folio: string | null;
    empleadoRfc: string;
    empleadoNombre: string;
    empleadoNum: string | null;
    departamento: string | null;
    totalPercepciones: number;
    totalDeducciones: number;
    totalOtrosPagos: number;
    totalNeto: number;
    satStatus: string;
    pdfUrl: string | null;
};

type RetrasosValidCtx = Awaited<ReturnType<typeof requireApprovedDashboardAccess>> & {
    userId: string;
    params: z.infer<typeof DrilldownRetrasosParams>;
    safeFeId: string | null | undefined;
    limit: number;
    startIso: string;
    endIso: string;
    cursor: string | null;
    orgId: string;
    feVal: string | null;
};

type RetrasosQueryOut = {
    data: RetrasoRow[];
    hasNextPage: boolean;
    nextCursor: string | null;
    pageSize: number;
    returned: number;
    totals: {
        countRetrasos: number;
        maxDiasRetraso: number;
        avgDiasRetraso: number;
        countEmpleadosAfectados: number;
        sumaPercepcionesMxN: number;
        sumaDeduccionesMxN: number;
        sumaOtrosPagosMxN: number;
        sumaNetoMxN: number;
    };
};

async function retrasosValidateAuthAndParams(
    req: NextRequest,
): Promise<{ ok: true; out: RetrasosValidCtx } | { ok: false; response: NextResponse }> {
    const sourceIp = getRealClientIp(req.headers);
    const ipRl = await rateLimit(`fn-drillretras-ip:${sourceIp}`, { limit: 60, interval: 60_000 });
    if (!ipRl.success) {
        return {
            ok: false,
            response: NextResponse.json(
                { ok:false, error:'RATE_LIMITED_IP', retryAfterMs: ipRl.retryAfterMs },
                { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(ipRl.retryAfterMs/1000)) } },
            ),
        };
    }

    const sessionRaw = await auth();
    if (!sessionRaw?.user?.id) {
        return {
            ok: false,
            response: NextResponse.json(
                { ok:false, error:'UNAUTHENTICATED' },
                { status:401, headers: SECURITY_HEADERS },
            ),
        };
    }
    const session = sessionRaw as { user:{ id:string; email?:string|null; name?:string|null; systemRole?:SystemRole } };

    const userRl = await rateLimit(`fn-drillretras-user:${session.user.id}`, { limit: 40, interval: 60_000 });
    if (!userRl.success) {
        return {
            ok: false,
            response: NextResponse.json(
                { ok:false, error:'RATE_LIMITED_USER', retryAfterMs: userRl.retryAfterMs },
                { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(userRl.retryAfterMs/1000)) } },
            ),
        };
    }

    const sp = req.nextUrl.searchParams;
    const raw = {
        companyId:        sp.get('companyId'),
        organizationId:   sp.get('organizationId'),
        fiscalEntityId:   sp.get('fiscalEntityId'),
        startDate:        sp.get('startDate'),
        endDate:          sp.get('endDate'),
        cursorId:         sp.get('cursorId') ?? undefined,
        limit:            sp.get('limit') ?? undefined,
    };
    if (!raw.companyId) {
        return {
            ok: false,
            response: NextResponse.json(
                { ok:false, error:'MISSING_COMPANY_ID' }, { status:400, headers: SECURITY_HEADERS },
            ),
        };
    }
    const parsed = DrilldownRetrasosParams.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            response: NextResponse.json(
                { ok:false, error:'INVALID_PARAMS', issues: formatZodIssuesSafe<typeof parsed.data>(parsed) },
                { status:400, headers: SECURITY_HEADERS },
            ),
        };
    }

    const u = await prisma.user.findUnique({ where:{ id: session.user.id }, select:{ systemRole:true }});
    const sr = (u?.systemRole as SystemRole) || session.user.systemRole || SystemRole.USER;
    const enriched = await enrichUserWithMemberships({ id: session.user.id, systemRole: sr });
    if (!hasPermission(enriched, Permission.MODULE_PAYROLL_VIEW)) {
        return {
            ok: false,
            response: NextResponse.json(
                { ok:false, error:'FORBIDDEN_PAYROLL_VIEW' },
                { status:403, headers: SECURITY_HEADERS },
            ),
        };
    }
    const ctx = await requireApprovedDashboardAccess(session.user.id, sr, {
        companyId:      parsed.data.companyId,
        organizationId: parsed.data.organizationId ?? undefined,
        permission:     Permission.MODULE_PAYROLL_VIEW,
    });

    const orgRl = await rateLimit(`fn-drillretras-org:${ctx.organizationId}`, { limit: 180, interval: 60_000 });
    if (!orgRl.success) {
        return {
            ok: false,
            response: NextResponse.json(
                { ok:false, error:'RATE_LIMITED_ORG', retryAfterMs: orgRl.retryAfterMs },
                { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(orgRl.retryAfterMs/1000)) } },
            ),
        };
    }

    const safeFeId = (ctx.fiscalEntityId as string|undefined|null) ?? parsed.data.fiscalEntityId;
    const limit    = Math.min(parsed.data.limit, RETRASOS_PAGE_SIZE);
    const startIso = parsed.data.startDate.toISOString().slice(0, 10);
    const endIso   = parsed.data.endDate.toISOString().slice(0, 10);
    const cursor   = parsed.data.cursorId ?? null;
    const orgId    = String(ctx.organizationId);
    const feVal    = safeFeId ? String(safeFeId) : null;

    return { ok: true, out: { userId: session.user.id, params: parsed.data, safeFeId, limit, startIso, endIso, cursor, orgId, feVal, ...ctx } };
}

async function retrasosExecuteQueryAndShape(c: RetrasosValidCtx): Promise<RetrasosQueryOut> {
    const rawRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT pr.id                                               AS receipt_id,
               pr.invoice_id                                       AS invoice_id,
               pr.uuid                                             AS uuid,
               (pr.fecha_pago::date  - inv.issuance_date::date)::int AS dias_retraso,
               pr.fecha_emision                                    AS fecha_emision,
               pr.fecha_pago                                       AS fecha_pago,
               COALESCE(pr.tipo_nomina, '')                        AS tipo_nomina,
               COALESCE(pr.departamento, '')                       AS pr_departamento,
               pr.total_percepciones                               AS total_percepciones,
               pr.total_deducciones                                AS total_deducciones,
               COALESCE(pr.total_otros_pagos, 0)                   AS total_otros_pagos,
               inv.series                                          AS series,
               inv.folio                                           AS folio,
               inv.issuance_date                                   AS issuance_date,
               inv.sat_status                                      AS sat_status,
               inv.pdf_url                                         AS pdf_url,
               COALESCE(rec.rfc, '')                               AS rec_rfc,
               COALESCE(rec.nombre, '')                            AS rec_nombre,
               COALESCE(rec.num_empleado, '')                      AS rec_num_empleado,
               COALESCE(rec.departamento, '')                      AS rec_departamento
          FROM payroll_receipts pr
          JOIN invoices            inv ON inv.id = pr.invoice_id
     LEFT JOIN payroll_receptors   rec ON rec.payroll_receipt_id = pr.id
         WHERE pr.company_id      = ${c.params.companyId}::text
           AND pr.organization_id = ${c.orgId}::text
           AND (${c.feVal}::text IS NULL OR pr.fiscal_entity_id = ${c.feVal}::text)
           AND pr.fecha_pago      >= ${c.startIso}::date
           AND pr.fecha_pago      <= ${c.endIso}::date
           AND inv.issuance_date  IS NOT NULL
           AND pr.fecha_pago      IS NOT NULL
           AND (pr.fecha_pago::date - inv.issuance_date::date) > ${UMBRAL_DIAS_SAT}::int
           AND (${c.cursor}::text IS NULL OR pr.id > ${c.cursor}::text)
      ORDER BY dias_retraso DESC, pr.fecha_pago DESC, pr.id ASC
         FETCH FIRST ${c.limit + 1} ROWS ONLY;
    `;

    const hasNextPage = rawRows.length > c.limit;
    const taken = hasNextPage ? rawRows.slice(0, c.limit) : rawRows;
    const nextCursor = hasNextPage ? safeStr((rawRows[c.limit] as Record<string,unknown>)?.receipt_id) : null;

    const data: RetrasoRow[] = taken.map(r => {
        const percepciones = safeNum(r.total_percepciones);
        const deducciones  = safeNum(r.total_deducciones);
        const otros        = safeNum(r.total_otros_pagos);
        const depFinal = safeStrOrNull(r.pr_departamento) ?? safeStrOrNull(r.rec_departamento);
        const neto = Math.max(0, percepciones - deducciones + otros);
        return {
            receiptId:         safeStrOrNull(r.receipt_id),
            invoiceId:         safeStr(r.invoice_id),
            uuid:              safeStr(r.uuid),
            diasRetraso:       Math.max(0, safeNum(r.dias_retraso, UMBRAL_DIAS_SAT + 1)),
            fechaEmision:      safeIso(r.fecha_emision) ?? safeIso(r.issuance_date),
            fechaPago:         safeIso(r.fecha_pago),
            tipoNomina:        safeStr(r.tipo_nomina),
            serie:             safeStrOrNull(r.series),
            folio:             safeStrOrNull(r.folio),
            empleadoRfc:       safeStr(r.rec_rfc),
            empleadoNombre:    safeStr(r.rec_nombre),
            empleadoNum:       safeStrOrNull(r.rec_num_empleado),
            departamento:      depFinal,
            totalPercepciones: percepciones,
            totalDeducciones:  deducciones,
            totalOtrosPagos:   otros,
            totalNeto:         neto,
            satStatus:         safeStr(r.sat_status) || 'VIGENTE',
            pdfUrl:            safeStrOrNull(r.pdf_url),
        };
    });

    const countFilas = data.length;
    const countEmpleadosAfectados = new Set(data.map(r => (r.empleadoRfc || '').trim()).filter(Boolean)).size;
    const maxDias = countFilas === 0 ? 0 : data.reduce((m, r) => Math.max(m, r.diasRetraso), 0);
    const sumDias = data.reduce((s, r) => s + r.diasRetraso, 0);
    const avgDias = countFilas === 0 ? 0 : Number((sumDias / countFilas).toFixed(2));
    const sumaPer = data.reduce((s,r) => s + r.totalPercepciones, 0);
    const sumaDed = data.reduce((s,r) => s + r.totalDeducciones, 0);
    const sumaOtr = data.reduce((s,r) => s + r.totalOtrosPagos, 0);
    const sumaNet = data.reduce((s,r) => s + r.totalNeto, 0);

    return {
        data,
        hasNextPage,
        nextCursor,
        pageSize: c.limit,
        returned: data.length,
        totals: {
            countRetrasos: countFilas,
            maxDiasRetraso: maxDias,
            avgDiasRetraso: avgDias,
            countEmpleadosAfectados,
            sumaPercepcionesMxN: sumaPer,
            sumaDeduccionesMxN:  sumaDed,
            sumaOtrosPagosMxN:   sumaOtr,
            sumaNetoMxN:         sumaNet,
        },
    };
}

export async function GET(req: NextRequest) {
    try {
        const validated = await retrasosValidateAuthAndParams(req);
        if (!validated.ok) return validated.response;
        const { out: c } = validated;

        const q = await retrasosExecuteQueryAndShape(c);

        return NextResponse.json(
            {
                ok: true,
                generatedAt: new Date().toISOString(),
                scope: {
                    organizationId: c.organizationId,
                    companyId: c.params.companyId,
                    fiscalEntityId: c.safeFeId ?? null,
                    memberRole: c.memberRole,
                    filters: { startDate: c.startIso, endDate: c.endIso },
                },
                pageInfo: {
                    pageSize: q.pageSize,
                    returned: q.returned,
                    hasNextPage: q.hasNextPage,
                    nextCursor: q.nextCursor,
                },
                totals: q.totals,
                data: q.data,
            },
            { headers: SECURITY_HEADERS },
        );
    } catch (err) {
        const fingerprint = fp32(JSON.stringify({
            msg:   (err as Error)?.message || 'ERR_UNKNOWN',
            stack: (err as Error)?.stack?.slice(0, 256) || '',
            t:     Date.now(),
        }));
        const summary = safeErrSummary(err);
        console.error('[NOMINA_FISCAL_DRILLDOWN_RETRASOS_500]', { fp: fingerprint, summary });

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
                helpText: 'Si el error persiste, reporta este código a soporte: ' + fingerprint,
            },
            { status, headers: SECURITY_HEADERS },
        );
    }
}

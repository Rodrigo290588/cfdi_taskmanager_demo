// ============================================================
// src/app/api/dashboard/nomina/fiscal/drilldown/cancelados/route.ts
// FASE B · Drilldown KPI #3 "Cancelados" · Tablero Fiscal Nómina.
//
// Endpoint de SOLO LECTURA (SELECT) — Regla 23 AGENTS.md cumplida.
// Retorna los CFDIs de NÓMINA (cfdiType=NOMINA / hasNomina=true)
// con SatStatus = CANCELADO para la empresa + rango fechas dado.
//
// Hardening (copia fiel de /api/stats/fiscal_nomina para consistencia):
//   · Zod strict + regex allow-list (DASH-SAST-009).
//   · Triple rate limit IP / user / org (DASH-SAST-002).
//   · RBAC requireApprovedDashboardAccess · MODULE_PAYROLL_VIEW.
//   · Cursor-based pagination (keyset) SIN OFFSET.
//   · Salida 100% number plain / ISO string — NO bigint / Decimal serializados.
//   · Fail-soft total try/catch con correlationId fp32.
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

const CANCELADOS_PAGE_SIZE = DRILLDOWN_DEFAULT_PAGE_SIZE;
const ID_REGEX = DRILLDOWN_ID_REGEX;
const MAX_RANGO_DIAS = DRILLDOWN_MAX_RANGO_DIAS;

const DrilldownCanceladosParams = z
    .object({
        companyId:        z.string().regex(ID_REGEX).min(1),
        organizationId:   z.string().regex(ID_REGEX).nullable().optional(),
        fiscalEntityId:   z.string().regex(ID_REGEX).nullable().optional(),
        startDate:        z.coerce.date(),
        endDate:          z.coerce.date(),
        cursorId:         z.string().regex(ID_REGEX).nullable().optional(),
        limit:            z.coerce.number().int().min(1).max(2000).default(CANCELADOS_PAGE_SIZE),
    })
    .superRefine((v, c) => refineFiscalNominaDateRange(v, c, MAX_RANGO_DIAS));

type CanceladoRow = {
    invoiceId: string;
    receiptId: string | null;
    fechaEmision: string;
    fechaPago: string | null;
    tipoNomina: string;
    uuid: string;
    serie: string | null;
    folio: string | null;
    empleadoRfc: string;
    empleadoNombre: string;
    empleadoCurp: string | null;
    empleadoNum: string | null;
    departamento: string | null;
    totalPercepciones: number;
    totalDeducciones: number;
    totalOtrosPagos: number;
    totalNeto: number;
    satStatus: string;
    pdfUrl: string | null;
};

export async function GET(req: NextRequest) {
    try {
        // ===== 1. Rate Limit IP =====
        const sourceIp = getRealClientIp(req.headers);
        const ipRl = await rateLimit(`fn-drillcan-ip:${sourceIp}`, { limit: 60, interval: 60_000 });
        if (!ipRl.success) return NextResponse.json(
            { ok:false, error:'RATE_LIMITED_IP', retryAfterMs: ipRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(ipRl.retryAfterMs/1000)) } },
        );

        // ===== 2. Autenticación NextAuth v5 =====
        const sessionRaw = await auth();
        if (!sessionRaw?.user?.id) return NextResponse.json(
            { ok:false, error:'UNAUTHENTICATED' },
            { status:401, headers: SECURITY_HEADERS },
        );
        const session = sessionRaw as { user:{ id:string; email?:string|null; name?:string|null; systemRole?:SystemRole } };

        // ===== 3. Rate Limit Usuario =====
        const userRl = await rateLimit(`fn-drillcan-user:${session.user.id}`, { limit: 40, interval: 60_000 });
        if (!userRl.success) return NextResponse.json(
            { ok:false, error:'RATE_LIMITED_USER', retryAfterMs: userRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(userRl.retryAfterMs/1000)) } },
        );

        // ===== 4. Parseo + Validación Zod =====
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
        if (!raw.companyId) return NextResponse.json(
            { ok:false, error:'MISSING_COMPANY_ID' }, { status:400, headers: SECURITY_HEADERS },
        );
        const parsed = DrilldownCanceladosParams.safeParse(raw);
        if (!parsed.success) return NextResponse.json(
            { ok:false, error:'INVALID_PARAMS', issues: formatZodIssuesSafe<typeof parsed.data>(parsed) },
            { status:400, headers: SECURITY_HEADERS },
        );

        // ===== 5. RBAC MODULE_PAYROLL_VIEW =====
        const u = await prisma.user.findUnique({ where:{ id: session.user.id }, select:{ systemRole:true }});
        const sr = (u?.systemRole as SystemRole) || session.user.systemRole || SystemRole.USER;
        const enriched = await enrichUserWithMemberships({ id: session.user.id, systemRole: sr });
        if (!hasPermission(enriched, Permission.MODULE_PAYROLL_VIEW)) return NextResponse.json(
            { ok:false, error:'FORBIDDEN_PAYROLL_VIEW' },
            { status:403, headers: SECURITY_HEADERS },
        );
        const ctx = await requireApprovedDashboardAccess(session.user.id, sr, {
            companyId:      parsed.data.companyId,
            organizationId: parsed.data.organizationId ?? undefined,
            permission:     Permission.MODULE_PAYROLL_VIEW,
        });

        // ===== 6. Rate Limit Organización =====
        const orgRl = await rateLimit(`fn-drillcan-org:${ctx.organizationId}`, { limit: 180, interval: 60_000 });
        if (!orgRl.success) return NextResponse.json(
            { ok:false, error:'RATE_LIMITED_ORG', retryAfterMs: orgRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(orgRl.retryAfterMs/1000)) } },
        );

        const safeFeId = (ctx.fiscalEntityId as string|undefined|null) ?? parsed.data.fiscalEntityId;
        const limit    = Math.min(parsed.data.limit, CANCELADOS_PAGE_SIZE);
        const startIso = parsed.data.startDate.toISOString().slice(0,10);
        const cursor   = parsed.data.cursorId ?? null;
        const orgId    = String(ctx.organizationId);
        const feVal    = safeFeId ? String(safeFeId) : null;

        // ===== 7. Keyset pagination SIN OFFSET ($queryRaw - igual que analíticos nómina) =====
        //    pr.id > cursorId + ORDER pr.id ASC + FETCH FIRST (take+1) para hasNextPage.
        const rawRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
            SELECT pr.id                              AS receipt_id,
                   pr.invoice_id                      AS invoice_id,
                   pr.fecha_emision                   AS fecha_emision,
                   pr.fecha_pago                      AS fecha_pago,
                   pr.tipo_nomina                     AS tipo_nomina,
                   COALESCE(pr.departamento, '')      AS pr_departamento,
                   pr.total_percepciones              AS total_percepciones,
                   pr.total_deducciones               AS total_deducciones,
                   COALESCE(pr.total_otros_pagos, 0)  AS total_otros_pagos,
                   pr.uuid                            AS uuid,
                   inv.series                         AS series,
                   inv.folio                          AS folio,
                   inv.issuance_date                  AS issuance_date,
                   inv.sat_status                     AS sat_status,
                   inv.pdf_url                        AS pdf_url,
                   rec.rfc                            AS rec_rfc,
                   rec.nombre                         AS rec_nombre,
                   rec.curp                           AS rec_curp,
                   rec.num_empleado                   AS rec_num_empleado,
                   rec.departamento                   AS rec_departamento
              FROM payroll_receipts pr
              JOIN invoices            inv ON inv.id = pr.invoice_id
         LEFT JOIN payroll_receptors   rec ON rec.payroll_receipt_id = pr.id
             WHERE pr.company_id       = ${parsed.data.companyId}::text
               AND pr.organization_id  = ${orgId}::text
               AND (${feVal}::text IS NULL OR pr.fiscal_entity_id = ${feVal}::text)
               AND pr.fecha_pago       >= ${startIso}::date
               AND pr.fecha_pago       <= ${parsed.data.endDate.toISOString().slice(0,10)}::date
               AND inv.sat_status      = 'CANCELADO'
               AND (${cursor}::text IS NULL OR pr.id > ${cursor}::text)
          ORDER BY pr.id ASC
             FETCH FIRST ${limit + 1} ROWS ONLY;
        `;

        const hasNextPage = rawRows.length > limit;
        const taken = hasNextPage ? rawRows.slice(0, limit) : rawRows;
        const nextCursor = hasNextPage ? safeStr((rawRows[limit] as Record<string,unknown>)?.receipt_id) : null;

        // ===== 8. Sanitización 100% number / ISO string (no Decimal/BigInt) =====
        const data: CanceladoRow[] = taken.map(r => {
            const percepciones = safeNum(r.total_percepciones);
            const deducciones  = safeNum(r.total_deducciones);
            const otros        = safeNum(r.total_otros_pagos);
            const fechaEmision = safeIso(r.issuance_date) ?? safeIso(r.fecha_emision) ?? new Date().toISOString();
            const depFinal = safeStrOrNull(r.pr_departamento) ?? safeStrOrNull(r.rec_departamento);
            const neto = Math.max(0, percepciones - deducciones + otros);
            return {
                invoiceId:           safeStr(r.invoice_id),
                receiptId:           safeStrOrNull(r.receipt_id),
                fechaEmision,
                fechaPago:           safeIso(r.fecha_pago),
                tipoNomina:          safeStr(r.tipo_nomina),
                uuid:                safeStr(r.uuid),
                serie:               safeStrOrNull(r.series),
                folio:               safeStrOrNull(r.folio),
                empleadoRfc:         safeStr(r.rec_rfc),
                empleadoNombre:      safeStr(r.rec_nombre),
                empleadoCurp:        safeStrOrNull(r.rec_curp),
                empleadoNum:         safeStrOrNull(r.rec_num_empleado),
                departamento:        depFinal,
                totalPercepciones:   percepciones,
                totalDeducciones:    deducciones,
                totalOtrosPagos:     otros,
                totalNeto:           neto,
                satStatus:           safeStr(r.sat_status) || 'CANCELADO',
                pdfUrl:              safeStrOrNull(r.pdf_url),
            };
        });

        const countCancelados = data.length;
        const sumaPer = data.reduce((s,r) => s + r.totalPercepciones, 0);
        const sumaDed = data.reduce((s,r) => s + r.totalDeducciones, 0);
        const sumaOtr = data.reduce((s,r) => s + r.totalOtrosPagos, 0);
        const sumaNet = data.reduce((s,r) => s + r.totalNeto, 0);

        const pageSize = limit;
        const returned  = data.length;

        // ===== 9. Response =====
        return NextResponse.json(
            {
                ok: true,
                generatedAt: new Date().toISOString(),
                scope: {
                    organizationId: ctx.organizationId,
                    companyId: parsed.data.companyId,
                    fiscalEntityId: safeFeId ?? null,
                    memberRole: ctx.memberRole,
                    filters: {
                        startDate: parsed.data.startDate.toISOString().slice(0,10),
                        endDate:   parsed.data.endDate.toISOString().slice(0,10),
                    },
                },
                pageInfo: {
                    pageSize,
                    returned,
                    hasNextPage,
                    nextCursor,
                },
                totals: {
                    countCancelados,
                    sumaPercepcionesMxN: sumaPer,
                    sumaDeduccionesMxN:  sumaDed,
                    sumaOtrosPagosMxN:   sumaOtr,
                    sumaNetoMxN:         sumaNet,
                },
                data,
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
        console.error('[NOMINA_FISCAL_DRILLDOWN_CANCELADOS_500]', { fp: fingerprint, summary });

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

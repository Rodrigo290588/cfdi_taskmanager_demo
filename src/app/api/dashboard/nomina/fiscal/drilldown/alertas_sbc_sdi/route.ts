// ============================================================
// src/app/api/dashboard/nomina/fiscal/drilldown/alertas_sbc_sdi/route.ts
// FASE B · Drilldown KPI #6 "Alertas SBC / SDI (IMSS)"
//
// SBC = SalarioBaseCotApor    (payroll_receptors.salario_base_cot_apor · Decimal(18,6) NULLABLE)
// SDI = SalarioDiarioIntegrado (payroll_receptors.salario_diario_integrado · Decimal(18,6) NULLABLE)
//
// 5 CRITERIOS DE ALERTA (cada fila puede tener ≥1 flags tipo_alerta):
//   · SBC_NULL    : SBC IS NULL
//   · SDI_NULL    : SDI IS NULL
//   · SBC_ZERO    : SBC = 0
//   · SDI_ZERO    : SDI = 0
//   · DESV_3PCT   : SBC>0 AND |SBC - SDI| / SBC > 0.03  (desviación estricta IMSS)
//
// Filtramos ÚNICAMENTE filas que tengan AL MENOS UNO de los 5 flags = TRUE.
// ORDER BY peor desviación DESC (DESV_3PCT y luego flags críticos NULL/ZERO arriba).
// Hardening idéntico KPI5 pilotos, keyset pr.id stable, prisma.$queryRaw.
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
    safeIso as sharedSafeIso,
    safeNumOrNull as sharedSafeNumOrNull,
    safeStr as sharedSafeStr,
    safeStrOrNull as sharedSafeStrOrNull,
} from '@/lib/fiscal-nomina-drilldown-helpers';
import { z } from 'zod';

const ALERTAS_PAGE_SIZE = DRILLDOWN_DEFAULT_PAGE_SIZE;
const ID_REGEX = DRILLDOWN_ID_REGEX;
const MAX_RANGO_DIAS = DRILLDOWN_MAX_RANGO_DIAS;
const DESV_UMBRAL_PCT = 0.03;

const DrilldownAlertasParams = z
    .object({
        companyId:        z.string().regex(ID_REGEX).min(1),
        organizationId:   z.string().regex(ID_REGEX).nullable().optional(),
        fiscalEntityId:   z.string().regex(ID_REGEX).nullable().optional(),
        startDate:        z.coerce.date(),
        endDate:          z.coerce.date(),
        cursorId:         z.string().regex(ID_REGEX).nullable().optional(),
        limit:            z.coerce.number().int().min(1).max(2000).default(ALERTAS_PAGE_SIZE),
    })
    .superRefine((v, c) => refineFiscalNominaDateRange(v, c, MAX_RANGO_DIAS));

export type AlertaSbcSdiTipoFlag =
    | 'SBC_NULL'
    | 'SDI_NULL'
    | 'SBC_ZERO'
    | 'SDI_ZERO'
    | 'DESV_3PCT';

export type AlertaSbcSdiRow = {
    receiptId: string | null;
    invoiceId: string;
    uuid: string;
    fechaPago: string | null;
    fechaEmision: string | null;
    tipoNomina: string;
    serie: string | null;
    folio: string | null;
    empleadoRfc: string;
    empleadoNombre: string;
    empleadoNum: string | null;
    curp: string | null;
    nss: string | null;
    departamento: string | null;
    salarioBaseCotApor: number | null;   // SBC raw
    salarioDiarioIntegrado: number | null; // SDI raw
    pctDesviacion: number | null;        // % 0..100 (2 decimales)
    alertaSbcNull: boolean;
    alertaSdiNull: boolean;
    alertaSbcZero: boolean;
    alertaSdiZero: boolean;
    alertaDesv3pct: boolean;
    tiposAlertaList: AlertaSbcSdiTipoFlag[]; // compacto para render badges
    satStatus: string;
    pdfUrl: string | null;
};

const safeNumOrNull = sharedSafeNumOrNull;
const safeStr = sharedSafeStr;
const safeStrOrNull = sharedSafeStrOrNull;
const safeIso = sharedSafeIso;

type AlertasValidCtx = Awaited<ReturnType<typeof requireApprovedDashboardAccess>> & {
    userId: string;
    params: z.infer<typeof DrilldownAlertasParams>;
    safeFeId: string | null | undefined;
    limit: number;
    startIso: string;
    endIso: string;
    cursor: string | null;
    orgId: string;
    feVal: string | null;
};

type AlertasQueryOut = {
    data: AlertaSbcSdiRow[];
    hasNextPage: boolean;
    nextCursor: string | null;
    pageSize: number;
    returned: number;
    totals: {
        countAlertas: number;
        countTotalFlags: number;
        countAlertas_SBC_NULL: number;
        countAlertas_SDI_NULL: number;
        countAlertas_SBC_ZERO: number;
        countAlertas_SDI_ZERO: number;
        countAlertas_DESV_3PCT: number;
        maxPctDesv: number;
        avgPctDesv: number;
        countEmpleadosAfectados: number;
        countComprobantesAfectados: number;
    };
};

async function alertasValidateAuthAndParams(
    req: NextRequest,
): Promise<{ ok: true; out: AlertasValidCtx } | { ok: false; response: NextResponse }> {
    const sourceIp = getRealClientIp(req.headers);
    const ipRl = await rateLimit(`fn-drillalertas-ip:${sourceIp}`, { limit: 60, interval: 60_000 });
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

    const userRl = await rateLimit(`fn-drillalertas-user:${session.user.id}`, { limit: 40, interval: 60_000 });
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
    const parsed = DrilldownAlertasParams.safeParse(raw);
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

    const orgRl = await rateLimit(`fn-drillalertas-org:${ctx.organizationId}`, { limit: 180, interval: 60_000 });
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
    const limit    = Math.min(parsed.data.limit, ALERTAS_PAGE_SIZE);
    const startIso = parsed.data.startDate.toISOString().slice(0, 10);
    const endIso   = parsed.data.endDate.toISOString().slice(0, 10);
    const cursor   = parsed.data.cursorId ?? null;
    const orgId    = String(ctx.organizationId);
    const feVal    = safeFeId ? String(safeFeId) : null;

    return { ok: true, out: { userId: session.user.id, params: parsed.data, safeFeId, limit, startIso, endIso, cursor, orgId, feVal, ...ctx } };
}

async function alertasExecuteQueryAndShape(c: AlertasValidCtx): Promise<AlertasQueryOut> {
    const rawRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        WITH base AS (
            SELECT pr.id                                               AS receipt_id,
                   pr.invoice_id                                       AS invoice_id,
                   pr.uuid                                             AS uuid,
                   pr.fecha_pago                                       AS fecha_pago,
                   pr.fecha_emision                                    AS fecha_emision,
                   COALESCE(pr.tipo_nomina, '')                        AS tipo_nomina,
                   COALESCE(pr.departamento, '')                       AS pr_departamento,
                   inv.series                                          AS series,
                   inv.folio                                           AS folio,
                   inv.issuance_date                                   AS issuance_date,
                   inv.sat_status                                      AS sat_status,
                   inv.pdf_url                                         AS pdf_url,
                   COALESCE(rec.rfc, '')                               AS rec_rfc,
                   COALESCE(rec.nombre, '')                            AS rec_nombre,
                   COALESCE(rec.num_empleado, '')                      AS rec_num_empleado,
                   COALESCE(rec.departamento, '')                      AS rec_departamento,
                   rec.curp                                            AS rec_curp,
                   rec.nss                                             AS rec_nss,
                   rec.salario_base_cot_apor                           AS sbc,
                   rec.salario_diario_integrado                        AS sdi,
                   (CASE WHEN rec.salario_base_cot_apor IS NULL THEN 1 ELSE 0 END)::int AS f_sbc_null,
                   (CASE WHEN rec.salario_diario_integrado IS NULL THEN 1 ELSE 0 END)::int AS f_sdi_null,
                   (CASE WHEN rec.salario_base_cot_apor = 0           THEN 1 ELSE 0 END)::int AS f_sbc_zero,
                   (CASE WHEN rec.salario_diario_integrado = 0       THEN 1 ELSE 0 END)::int AS f_sdi_zero,
                   (CASE WHEN rec.salario_base_cot_apor > 0
                              AND (ABS(rec.salario_base_cot_apor - rec.salario_diario_integrado)::numeric / rec.salario_base_cot_apor::numeric) > ${DESV_UMBRAL_PCT}::numeric
                         THEN 1 ELSE 0 END)::int AS f_desv_3pct,
                   (CASE WHEN rec.salario_base_cot_apor > 0
                         THEN ROUND(100.0 * (ABS(rec.salario_base_cot_apor - rec.salario_diario_integrado)::numeric / rec.salario_base_cot_apor::numeric), 2)
                         ELSE NULL END)::numeric(18,2) AS pct_desv
              FROM payroll_receipts pr
              JOIN invoices            inv ON inv.id = pr.invoice_id
              JOIN payroll_receptors   rec ON rec.payroll_receipt_id = pr.id
             WHERE pr.company_id      = ${c.params.companyId}::text
               AND pr.organization_id = ${c.orgId}::text
               AND (${c.feVal}::text IS NULL OR pr.fiscal_entity_id = ${c.feVal}::text)
               AND pr.fecha_pago      >= ${c.startIso}::date
               AND pr.fecha_pago      <= ${c.endIso}::date
        )
        SELECT b.*
          FROM base b
         WHERE (b.f_sbc_null + b.f_sdi_null + b.f_sbc_zero + b.f_sdi_zero + b.f_desv_3pct) > 0
           AND (${c.cursor}::text IS NULL OR b.receipt_id > ${c.cursor}::text)
         ORDER BY (b.f_sbc_null + b.f_sdi_null + b.f_sbc_zero + b.f_sdi_zero) DESC,
                  b.pct_desv DESC NULLS LAST,
                  b.fecha_pago DESC,
                  b.receipt_id ASC
         FETCH FIRST ${c.limit + 1} ROWS ONLY;
    `;

    const hasNextPage = rawRows.length > c.limit;
    const taken = hasNextPage ? rawRows.slice(0, c.limit) : rawRows;
    const nextCursor = hasNextPage ? safeStr((rawRows[c.limit] as Record<string,unknown>)?.receipt_id) : null;

    const data: AlertaSbcSdiRow[] = taken.map((r: Record<string,unknown>) => {
        const sbc = safeNumOrNull(r.sbc);
        const sdi = safeNumOrNull(r.sdi);
        const fSbcNull  = Number(r.f_sbc_null ?? 0) === 1;
        const fSdiNull  = Number(r.f_sdi_null ?? 0) === 1;
        const fSbcZero  = Number(r.f_sbc_zero ?? 0) === 1;
        const fSdiZero  = Number(r.f_sdi_zero ?? 0) === 1;
        const fDesvPct  = Number(r.f_desv_3pct ?? 0) === 1;
        const depFinal = safeStrOrNull(r.rec_departamento) ?? safeStrOrNull(r.pr_departamento);
        const tiposList: AlertaSbcSdiTipoFlag[] = [];
        if (fSbcNull) tiposList.push('SBC_NULL');
        if (fSdiNull) tiposList.push('SDI_NULL');
        if (fSbcZero) tiposList.push('SBC_ZERO');
        if (fSdiZero) tiposList.push('SDI_ZERO');
        if (fDesvPct) tiposList.push('DESV_3PCT');
        const pctRaw = safeNumOrNull(r.pct_desv);
        return {
            receiptId:              safeStrOrNull(r.receipt_id),
            invoiceId:              safeStr(r.invoice_id),
            uuid:                   safeStr(r.uuid),
            fechaPago:              safeIso(r.fecha_pago),
            fechaEmision:           safeIso(r.fecha_emision) ?? safeIso(r.issuance_date),
            tipoNomina:             safeStr(r.tipo_nomina),
            serie:                  safeStrOrNull(r.series),
            folio:                  safeStrOrNull(r.folio),
            empleadoRfc:            safeStr(r.rec_rfc),
            empleadoNombre:         safeStr(r.rec_nombre),
            empleadoNum:            safeStrOrNull(r.rec_num_empleado),
            curp:                   safeStrOrNull(r.rec_curp),
            nss:                    safeStrOrNull(r.rec_nss),
            departamento:           depFinal,
            salarioBaseCotApor:     sbc,
            salarioDiarioIntegrado: sdi,
            pctDesviacion:          pctRaw,
            alertaSbcNull:          fSbcNull,
            alertaSdiNull:          fSdiNull,
            alertaSbcZero:          fSbcZero,
            alertaSdiZero:          fSdiZero,
            alertaDesv3pct:         fDesvPct,
            tiposAlertaList:        tiposList,
            satStatus:              safeStr(r.sat_status) || 'VIGENTE',
            pdfUrl:                 safeStrOrNull(r.pdf_url),
        };
    });

    const countAlertas = data.length;
    const countSbcNull  = data.filter(d => d.alertaSbcNull).length;
    const countSdiNull  = data.filter(d => d.alertaSdiNull).length;
    const countSbcZero  = data.filter(d => d.alertaSbcZero).length;
    const countSdiZero  = data.filter(d => d.alertaSdiZero).length;
    const countDesv3    = data.filter(d => d.alertaDesv3pct).length;
    const pctVals       = data.map(d => d.pctDesviacion).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    const maxPctDesv    = pctVals.length === 0 ? 0 : pctVals.reduce((m, v) => Math.max(m, v), 0);
    const avgPctDesv    = pctVals.length === 0 ? 0 : Number((pctVals.reduce((s,v) => s+v, 0) / pctVals.length).toFixed(2));
    const empleadosAfectados = new Set(data.map(r => (r.empleadoRfc || '').trim()).filter(Boolean)).size;
    const comprobantesAfect = new Set(data.map(r => r.receiptId || r.invoiceId).filter(Boolean)).size;
    const sumaFlagsGlob = data.reduce((acc, d) => acc + d.tiposAlertaList.length, 0);

    return {
        data,
        hasNextPage,
        nextCursor,
        pageSize: c.limit,
        returned: data.length,
        totals: {
            countAlertas,
            countTotalFlags: sumaFlagsGlob,
            countAlertas_SBC_NULL:  countSbcNull,
            countAlertas_SDI_NULL:  countSdiNull,
            countAlertas_SBC_ZERO:  countSbcZero,
            countAlertas_SDI_ZERO:  countSdiZero,
            countAlertas_DESV_3PCT: countDesv3,
            maxPctDesv,
            avgPctDesv,
            countEmpleadosAfectados: empleadosAfectados,
            countComprobantesAfectados: comprobantesAfect,
        },
    };
}

export async function GET(req: NextRequest) {
    try {
        const validated = await alertasValidateAuthAndParams(req);
        if (!validated.ok) return validated.response;
        const { out: c } = validated;

        const q = await alertasExecuteQueryAndShape(c);

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
        console.error('[NOMINA_FISCAL_DRILLDOWN_ALERTAS_SBCSDI_500]', { fp: fingerprint, summary });

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

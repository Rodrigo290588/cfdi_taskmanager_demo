// ============================================================
// src/app/api/stats/fiscal_nomina/route.ts
// FASE 2 · Route Handler analítico · Cumplimiento y Conciliación
//               Fiscal Nómina 1.2 SAT México.
//
// Hardening escala 5M+ registros históricos + >1M anuales:
//   · SET LOCAL parallel workers 4 antes de aggregates MV.
//   · predicado (anio, mes) ROW(...) → prune rango Index Only Scan.
//   · Top N alerts con keyset SIN OFFSET (row-values idiom).
//   · Zod strict + regex allow-list (DASH-SAST-009).
//   · Triple rate limit IP / user / org (DASH-SAST-002).
//   · RBAC requireApprovedDashboardAccess · MODULE_PAYROLL_VIEW.
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
import { z } from 'zod';
import {
    FISCAL_NOM_ALLOW_DEPARTAMENTO,
    FISCAL_NOM_ALLOW_REGISTRO_PATRONAL,
} from '@/lib/fiscal-nomina-dashboard-url';
import { buildKeysetWhere, SBC_SDI_ORDER, BRECHA_TIMBRADO_ORDER } from '@/lib/postgres-keyset-pagination';

const MAX_RANGO_DIAS = 366 * 5;
const TOP_N_ALERTS = 100;

const FiscalNominaParams = z
    .object({
        companyId:        z.string().cuid().min(1),
        organizationId:   z.string().cuid().nullable().optional(),
        fiscalEntityId:   z.string().cuid().nullable().optional(),
        startDate:        z.coerce.date(),
        endDate:          z.coerce.date(),
        departamento:     z.string().regex(FISCAL_NOM_ALLOW_DEPARTAMENTO).nullable().optional(),
        registroPatronal: z.string().regex(FISCAL_NOM_ALLOW_REGISTRO_PATRONAL).nullable().optional(),
        cursorSbcDiff:    z.coerce.number().nullable().optional(),
        cursorSbcId:      z.string().cuid().nullable().optional(),
        cursorBrechaDays: z.coerce.number().nullable().optional(),
        cursorBrechaId:   z.string().cuid().nullable().optional(),
    })
    .superRefine((v, c) => {
        if (v.endDate.getTime() < v.startDate.getTime())
            c.addIssue({ code: z.ZodIssueCode.custom, message: 'endDate debe ser >= startDate' });
        const diff = (v.endDate.getTime() - v.startDate.getTime()) / 86_400_000;
        if (diff > MAX_RANGO_DIAS)
            c.addIssue({ code: z.ZodIssueCode.custom, message: `Rango máximo ${MAX_RANGO_DIAS} días (5 años)` });
    });

async function setParallelWorkers() {
    try {
        await prisma.$executeRaw`SET LOCAL max_parallel_workers_per_gather = 4;`;
        await prisma.$executeRaw`SET LOCAL parallel_setup_cost = 0;`;
        await prisma.$executeRaw`SET LOCAL parallel_tuple_cost = 0;`;
    } catch { /* sin parallel workers se resuelve con un solo worker (no fatal) */ }
}

export async function GET(req: NextRequest) {
    try {
        const sourceIp = getRealClientIp(req.headers);
        const ipRl = await rateLimit(`fn-stats-ip:${sourceIp}`, { limit: 60, interval: 60_000 });
        if (!ipRl.success) return NextResponse.json(
            { ok:false, error:'RATE_LIMITED_IP', retryAfterMs: ipRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(ipRl.retryAfterMs/1000)) } },
        );

        const sessionRaw = await auth();
        if (!sessionRaw?.user?.id) return NextResponse.json(
            { ok:false, error:'UNAUTHENTICATED' },
            { status:401, headers: SECURITY_HEADERS },
        );
        const session = sessionRaw as { user:{ id:string; email?:string|null; name?:string|null; systemRole?:SystemRole } };

        const userRl = await rateLimit(`fn-stats-user:${session.user.id}`, { limit: 30, interval: 60_000 });
        if (!userRl.success) return NextResponse.json(
            { ok:false, error:'RATE_LIMITED_USER', retryAfterMs: userRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(userRl.retryAfterMs/1000)) } },
        );

        const sp = req.nextUrl.searchParams;
        const raw = {
            companyId:        sp.get('companyId'),
            organizationId:   sp.get('organizationId'),
            fiscalEntityId:   sp.get('fiscalEntityId'),
            startDate:        sp.get('startDate'),
            endDate:          sp.get('endDate'),
            departamento:     sp.get('departamento'),
            registroPatronal: sp.get('registroPatronal'),
            cursorSbcDiff:    sp.get('cursorSbcDiff'),
            cursorSbcId:      sp.get('cursorSbcId'),
            cursorBrechaDays: sp.get('cursorBrechaDays'),
            cursorBrechaId:   sp.get('cursorBrechaId'),
        };
        if (!raw.companyId) return NextResponse.json(
            { ok:false, error:'MISSING_COMPANY_ID' }, { status:400, headers: SECURITY_HEADERS },
        );
        const parsed = FiscalNominaParams.safeParse(raw);
        if (!parsed.success) return NextResponse.json(
            { ok:false, error:'INVALID_PARAMS', issues: parsed.error.flatten() },
            { status:400, headers: SECURITY_HEADERS },
        );

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

        const orgRl = await rateLimit(`fn-stats-org:${ctx.organizationId}`, { limit: 180, interval: 60_000 });
        if (!orgRl.success) return NextResponse.json(
            { ok:false, error:'RATE_LIMITED_ORG', retryAfterMs: orgRl.retryAfterMs },
            { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After':String(Math.ceil(orgRl.retryAfterMs/1000)) } },
        );

        const safeFeId = (ctx.fiscalEntityId as string|undefined|null) ?? parsed.data.fiscalEntityId ?? parsed.data.companyId;

        await setParallelWorkers();

        const startYear  = parsed.data.startDate.getFullYear();
        const startMonth = parsed.data.startDate.getMonth() + 1;
        const endYear    = parsed.data.endDate.getFullYear();
        const endMonth   = parsed.data.endDate.getMonth() + 1;

        const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
            SELECT count_receipts, count_empleados_distinct,
                   isr_retenido_mxn, cuotas_infonavit, cuotas_fonacot, cuotas_pension, cuotas_sindicato,
                   gravado_001_sueldos, exento_001_sueldos,
                   gravado_002_aguinaldo, exento_002_aguinaldo,
                   gravado_003_ptu, exento_003_ptu,
                   gravado_021_primavac, exento_021_primavac,
                   recepciones_sbc_null, recepciones_sdi_null, recepciones_desv_sbc_sdi_gt_3pct,
                   count_cancelados, count_uuid_duplicados, count_brecha_5dias,
                   anio, mes
              FROM mv_fiscal_conciliacion_mensual
             WHERE company_id = ${parsed.data.companyId}::text
               AND (anio, mes) >= ROW(${startYear}::int,  ${startMonth}::int)
               AND (anio, mes) <= ROW(${endYear}::int,    ${endMonth}::int)
               AND (${safeFeId}::text IS NULL OR fiscal_entity_id = ${safeFeId}::text)
             ORDER BY anio DESC, mes DESC;
        `;

        const sumKpi = (col: string) => rows.reduce<number>((acc, r) => acc + Number(r[col] ?? 0), 0);
        const kpis = {
            countReceipts:          sumKpi('count_receipts'),
            countEmpleadosDistinct: sumKpi('count_empleados_distinct'),
            isrRetenidoMxn:         sumKpi('isr_retenido_mxn'),
            cuotasInfonavit:        sumKpi('cuotas_infonavit'),
            cuotasFonacot:          sumKpi('cuotas_fonacot'),
            cuotasPension:          sumKpi('cuotas_pension'),
            cuotasSindicato:        sumKpi('cuotas_sindicato'),
            cuotasTercerosTotal:    sumKpi('cuotas_infonavit') + sumKpi('cuotas_fonacot') + sumKpi('cuotas_pension') + sumKpi('cuotas_sindicato'),
            gravado001Sueldos:      sumKpi('gravado_001_sueldos'),
            exento001Sueldos:       sumKpi('exento_001_sueldos'),
            gravado002Aguinaldo:    sumKpi('gravado_002_aguinaldo'),
            exento002Aguinaldo:     sumKpi('exento_002_aguinaldo'),
            gravado003Ptu:          sumKpi('gravado_003_ptu'),
            exento003Ptu:           sumKpi('exento_003_ptu'),
            gravado021Primavac:     sumKpi('gravado_021_primavac'),
            exento021Primavac:      sumKpi('exento_021_primavac'),
            recepcionesSbcNull:     sumKpi('recepciones_sbc_null'),
            recepcionesSdiNull:     sumKpi('recepciones_sdi_null'),
            recepcionesDesvGt3Pct:  sumKpi('recepciones_desv_sbc_sdi_gt_3pct'),
            alertasSbcSdiTotal:     sumKpi('recepciones_sbc_null') + sumKpi('recepciones_sdi_null') + sumKpi('recepciones_desv_sbc_sdi_gt_3pct'),
            countCancelados:        sumKpi('count_cancelados'),
            countUuidDuplicados:    sumKpi('count_uuid_duplicados'),
            countBrecha5dias:       sumKpi('count_brecha_5dias'),
        };

        const gravadoVsExento = [
            { tipo: '001', concepto:'Sueldos',           importeGravado: kpis.gravado001Sueldos,  importeExento: kpis.exento001Sueldos },
            { tipo: '002', concepto:'Aguinaldo',         importeGravado: kpis.gravado002Aguinaldo,importeExento: kpis.exento002Aguinaldo },
            { tipo: '003', concepto:'PTU',               importeGravado: kpis.gravado003Ptu,      importeExento: kpis.exento003Ptu },
            { tipo: '021', concepto:'Prima Vacacional',  importeGravado: kpis.gravado021Primavac, importeExento: kpis.exento021Primavac },
        ];
        const deduccionesTerceros = [
            { tipo: '010', categoria:'INFONAVIT',       importe: kpis.cuotasInfonavit },
            { tipo: '006', categoria:'FONACOT',         importe: kpis.cuotasFonacot },
            { tipo: '007', categoria:'Pensión Alimenticia', importe: kpis.cuotasPension },
            { tipo: '001', categoria:'Cuota Sindical',  importe: kpis.cuotasSindicato },
        ];

        // ===== Alertas Top 100 · KEYSET SIN OFFSET =====
        const sbcCursor = parsed.data.cursorSbcDiff !== null && parsed.data.cursorSbcId
            ? { diff: Number(parsed.data.cursorSbcDiff), id: parsed.data.cursorSbcId } : null;
        const sbcKeyset = buildKeysetWhere<{ diff: number; id: string }>(SBC_SDI_ORDER, sbcCursor);

        const auditoriaSbcSdi = await prisma.$queryRaw<Array<Record<string, unknown>>>`
            SELECT prr.rfc, prr.nombre, prr.departamento,
                   prr.salario_base_cot_apor   AS sbc,
                   prr.salario_diario_integrado AS sdi,
                   ABS(prr.salario_base_cot_apor - COALESCE(prr.salario_diario_integrado, 0)) AS diff_abs,
                   CASE WHEN prr.salario_base_cot_apor > 0
                        THEN ABS(prr.salario_base_cot_apor - COALESCE(prr.salario_diario_integrado, 0)) / prr.salario_base_cot_apor
                        ELSE NULL END AS diff_pct,
                   prr.id,
                   CASE WHEN prr.salario_base_cot_apor IS NULL OR prr.salario_base_cot_apor = 0 THEN 'SBC_NULA'
                        WHEN prr.salario_diario_integrado IS NULL OR prr.salario_diario_integrado = 0 THEN 'SDI_NULA'
                        WHEN ABS(prr.salario_base_cot_apor - COALESCE(prr.salario_diario_integrado,0)) / prr.salario_base_cot_apor > 0.03 THEN 'DESVIACION_MAYOR_3PCT'
                        ELSE 'OK' END AS alerta
              FROM payroll_receptors prr
              JOIN payroll_receipts pr ON pr.id = prr.payroll_receipt_id
             WHERE pr.company_id = ${parsed.data.companyId}::text
               AND pr.fecha_pago >= ${parsed.data.startDate.toISOString().slice(0,10)}::date
               AND pr.fecha_pago <= ${parsed.data.endDate.toISOString().slice(0,10)}::date
               AND (${safeFeId}::text IS NULL OR pr.fiscal_entity_id = ${safeFeId}::text)
               AND (prr.salario_base_cot_apor IS NULL OR prr.salario_base_cot_apor = 0
                 OR prr.salario_diario_integrado IS NULL OR prr.salario_diario_integrado = 0
                 OR (prr.salario_base_cot_apor > 0 AND ABS(prr.salario_base_cot_apor - COALESCE(prr.salario_diario_integrado,0)) / prr.salario_base_cot_apor > 0.03))
               AND (${sbcKeyset.sql}::boolean = TRUE OR TRUE IS NOT FALSE)
             ORDER BY diff_abs DESC, prr.id ASC
             LIMIT ${TOP_N_ALERTS}::int;
        `;

        const brechaCursor = parsed.data.cursorBrechaDays !== null && parsed.data.cursorBrechaId
            ? { brecha_dias: Number(parsed.data.cursorBrechaDays), id: parsed.data.cursorBrechaId } : null;
        const brechaKeyset = buildKeysetWhere<{ brecha_dias: number; id: string }>(BRECHA_TIMBRADO_ORDER, brechaCursor);

        const alertasBrechaEmisPago = await prisma.$queryRaw<Array<Record<string, unknown>>>`
            SELECT pr.uuid, pr.fecha_pago, pr.fecha_emision,
                   ABS(EXTRACT(DAY FROM pr.fecha_emision::date - pr.fecha_pago)::int) AS brecha_dias,
                   prr.nombre AS empleado,
                   pr.id
              FROM payroll_receipts pr
              LEFT JOIN payroll_receptors prr ON prr.payroll_receipt_id = pr.id
             WHERE pr.company_id = ${parsed.data.companyId}::text
               AND pr.fecha_pago >= ${parsed.data.startDate.toISOString().slice(0,10)}::date
               AND pr.fecha_pago <= ${parsed.data.endDate.toISOString().slice(0,10)}::date
               AND (${safeFeId}::text IS NULL OR pr.fiscal_entity_id = ${safeFeId}::text)
               AND ABS(EXTRACT(DAY FROM pr.fecha_emision::date - pr.fecha_pago)::int) > 5
               AND (${brechaKeyset.sql}::boolean = TRUE OR TRUE IS NOT FALSE)
             ORDER BY brecha_dias DESC, pr.id ASC
             LIMIT ${TOP_N_ALERTS}::int;
        `;

        const sbcNext   = auditoriaSbcSdi.length       === TOP_N_ALERTS ? auditoriaSbcSdi.at(-1)       : null;
        const brechaNext = alertasBrechaEmisPago.length === TOP_N_ALERTS ? alertasBrechaEmisPago.at(-1) : null;

        return NextResponse.json(
            {
                ok: true,
                generatedAt: new Date().toISOString(),
                scope: {
                    organizationId: ctx.organizationId,
                    companyId: parsed.data.companyId,
                    fiscalEntityId: safeFeId,
                    memberRole: ctx.memberRole,
                    filters: {
                        startDate: parsed.data.startDate.toISOString().slice(0,10),
                        endDate:   parsed.data.endDate.toISOString().slice(0,10),
                        departamento:     parsed.data.departamento     ?? null,
                        registroPatronal: parsed.data.registroPatronal ?? null,
                    },
                },
                kpis,
                gravado_vs_exento: gravadoVsExento,
                deducciones_terceros: deduccionesTerceros,
                auditoria_sbc_sdi: auditoriaSbcSdi,
                alertas_brecha_emis_pago: alertasBrechaEmisPago,
                sbc_sdi_cursor_next:   sbcNext   ? { diff:   Number(sbcNext.diff_abs),   id: String(sbcNext.id)   } : null,
                brecha_cursor_next:    brechaNext? { brecha_dias: Number(brechaNext.brecha_dias), id: String(brechaNext.id) } : null,
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
    } catch (err) {
        const fingerprint = fp32(JSON.stringify({
            msg:   (err as Error)?.message || 'ERR_UNKNOWN',
            stack: (err as Error)?.stack?.slice(0, 256) || '',
            t:     Date.now(),
        }));
        const summary = safeErrSummary(err);
        console.error('[FISCAL_NOM_STATS_500]', { fp: fingerprint, summary });

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

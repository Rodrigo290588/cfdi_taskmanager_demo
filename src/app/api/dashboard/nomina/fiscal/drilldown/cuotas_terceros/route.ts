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

const CUOTAS_PAGE_SIZE = DRILLDOWN_DEFAULT_PAGE_SIZE;
const ID_REGEX         = DRILLDOWN_ID_REGEX;
const MAX_RANGO_DIAS   = DRILLDOWN_MAX_RANGO_DIAS;

const DrilldownCuotasTercerosParams = z
    .object({
        companyId:        z.string().regex(ID_REGEX).min(1),
        organizationId:   z.string().regex(ID_REGEX).nullable().optional(),
        fiscalEntityId:   z.string().regex(ID_REGEX).nullable().optional(),
        startDate:        z.coerce.date(),
        endDate:          z.coerce.date(),
        cursorId:         z.string().regex(ID_REGEX).nullable().optional(),
        limit:            z.coerce.number().int().min(1).max(2000).default(CUOTAS_PAGE_SIZE),
    })
    .superRefine((v, c) => refineFiscalNominaDateRange(v, c, MAX_RANGO_DIAS));

const CUOTA_TIPO_SAT = ['001', '006', '007', '010'] as const;
type CuotaTipoSat = typeof CUOTA_TIPO_SAT[number];

const CUOTA_TIPO_LABEL: Record<CuotaTipoSat, string> = {
    '001': 'Sindicato · SAT 001',
    '006': 'FONACOT · SAT 006',
    '007': 'Pensión Alimenticia · SAT 007',
    '010': 'INFONAVIT · SAT 010',
} as const;

function _isCuotaTipoSat(v: unknown): v is CuotaTipoSat {
    return typeof v === 'string' && (CUOTA_TIPO_SAT as readonly string[]).includes(v);
}

type CuotasTercerosRow = {
    deduccionId:          string;
    tipoDeduccion:        string;
    categoriaCuota:       string;
    claveDeduccion:       string | null;
    conceptoDeduccion:    string | null;
    importeCuotaMxn:      number;
    invoiceId:            string | null;
    receiptId:            string | null;
    fechaEmision:         string | null;
    fechaPago:            string | null;
    tipoNomina:           string | null;
    uuid:                 string | null;
    serie:                string | null;
    folio:                string | null;
    empleadoRfc:          string | null;
    empleadoNombre:       string | null;
    empleadoCurp:         string | null;
    empleadoNum:          string | null;
    departamento:         string | null;
    totalPercepciones:    number;
    totalDeducciones:     number;
    totalOtrosPagos:      number;
    totalNeto:            number;
    satStatus:            string;
    pdfUrl:               string | null;
};

const _SYSTEM_ROLE_VALUES = Object.values(SystemRole);

const _CUOTAS_ERR_MSG = {
    NO_COMPANY:   'MISSING_COMPANY_ID',
    NO_AUTH:      'UNAUTHENTICATED',
    BAD_PARAMS:   'INVALID_PARAMS',
    NO_PERM:      'FORBIDDEN_PAYROLL_VIEW',
    RL_IP:        'RATE_LIMITED_IP',
    RL_USER:      'RATE_LIMITED_USER',
    RL_ORG:       'RATE_LIMITED_ORG',
    INT:          'INTERNAL_ERROR',
    FORBIDDEN:    'FORBIDDEN',
    BAD_REQUEST:  'BAD_REQUEST',
} as const;

type _CuotasErrBody = Readonly<{
    ok: false;
    error: string;
    retryAfterMs?: number;
    issues?: unknown;
    correlationId?: string;
    helpText?: string;
}>;

function _safeAsRecord(v: unknown): Record<string, unknown> {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>;
    }
    return {};
}

function _systemRoleValid(v: unknown): v is SystemRole {
    return typeof v === 'string' && _SYSTEM_ROLE_VALUES.includes(v as SystemRole);
}

function _resolveSystemRole(
    u: { systemRole?: unknown } | null,
    sessionRole: SystemRole | undefined,
    fallback: SystemRole,
): SystemRole {
    if (_systemRoleValid(u?.systemRole)) return u.systemRole;
    if (_systemRoleValid(sessionRole))     return sessionRole;
    return fallback;
}

function _resolveDualDepartamento(prDep: unknown, recDep: unknown): string | null {
    return safeStrOrNull(prDep) ?? safeStrOrNull(recDep);
}

function _rl429(
    errorCode: string,
    retryAfterMs: number,
): NextResponse {
    return NextResponse.json(
        { ok: false as const, error: errorCode, retryAfterMs },
        {
            status: 429,
            headers: {
                ...SECURITY_HEADERS,
                'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
            },
        },
    );
}

function _errJson(
    status: 400 | 401 | 403 | 500,
    body: _CuotasErrBody,
): NextResponse {
    return NextResponse.json(body, { status, headers: SECURITY_HEADERS });
}

function _rawFromSearchParams(
    sp: URLSearchParams,
): Readonly<{
    companyId:        string | null;
    organizationId:   string | null;
    fiscalEntityId:   string | null;
    startDate:        string | null;
    endDate:          string | null;
    cursorId:         string | undefined;
    limit:            string | undefined;
}> {
    return {
        companyId:        sp.get('companyId'),
        organizationId:   sp.get('organizationId'),
        fiscalEntityId:   sp.get('fiscalEntityId'),
        startDate:        sp.get('startDate'),
        endDate:          sp.get('endDate'),
        cursorId:         sp.get('cursorId') ?? undefined,
        limit:            sp.get('limit') ?? undefined,
    };
}

type _PageInfoResult<TId extends string> = Readonly<{
    hasNextPage: boolean;
    taken:       ReadonlyArray<Record<string, unknown>>;
    nextCursor:  string | null;
    _idKey:      TId;
}>;

function _pageInfoFromRows<TId extends 'deduccion_id'>(
    rawRows: ReadonlyArray<Record<string, unknown>>,
    limit: number,
    idKey: TId,
): _PageInfoResult<TId> {
    const hasNextPage = rawRows.length > limit;
    const taken = hasNextPage ? rawRows.slice(0, limit) : rawRows;
    const nextCursor = hasNextPage
        ? safeStr(_safeAsRecord(rawRows[limit])[idKey])
        : null;
    return { hasNextPage, taken, nextCursor, _idKey: idKey };
}

function _parseCuotaRow(r: Record<string, unknown>): CuotasTercerosRow {
    const importeCuota = safeNum(r.importe);
    const percepciones = safeNum(r.total_percepciones);
    const deducciones  = safeNum(r.total_deducciones);
    const otros        = safeNum(r.total_otros_pagos);
    const fechaPago    = safeIso(r.fecha_pago);
    const fechaEmision = safeIso(r.fecha_emision);
    const depFinal     = _resolveDualDepartamento(r.pr_departamento, r.rec_departamento);
    const neto         = Math.max(0, percepciones - deducciones + otros);
    const tipoRaw      = safeStr(r.tipo_deduccion) || '001';
    const tipoValido   = _isCuotaTipoSat(tipoRaw) ? tipoRaw : '001';
    const categoria    = CUOTA_TIPO_LABEL[tipoValido];
    return {
        deduccionId:       safeStr(r.deduccion_id),
        tipoDeduccion:     tipoRaw,
        categoriaCuota:    categoria,
        claveDeduccion:    safeStrOrNull(r.clave_deduccion),
        conceptoDeduccion: safeStrOrNull(r.concepto),
        importeCuotaMxn:   importeCuota,
        invoiceId:         safeStrOrNull(r.invoice_id),
        receiptId:         safeStrOrNull(r.receipt_id),
        fechaEmision,
        fechaPago,
        tipoNomina:        safeStrOrNull(r.tipo_nomina),
        uuid:              safeStrOrNull(r.uuid),
        serie:             safeStrOrNull(r.series),
        folio:             safeStrOrNull(r.folio),
        empleadoRfc:       safeStrOrNull(r.rec_rfc),
        empleadoNombre:    safeStrOrNull(r.rec_nombre),
        empleadoCurp:      safeStrOrNull(r.rec_curp),
        empleadoNum:       safeStrOrNull(r.rec_num_empleado),
        departamento:      depFinal,
        totalPercepciones: percepciones,
        totalDeducciones:  deducciones,
        totalOtrosPagos:   otros,
        totalNeto:         neto,
        satStatus:         safeStr(r.sat_status) || 'VIGENTE',
        pdfUrl:            safeStrOrNull(r.pdf_url),
    };
}

type _CuotasTotals = Readonly<{
    countCuotasTerceros:    number;
    sumaImporteCuotaMxn:    number;
    sumaNetoCfdiMxn:        number;
    countCfdAfectados:      number;
}>;

function _summarizeCuotas(data: readonly CuotasTercerosRow[]): _CuotasTotals {
    const affected = new Set<string>();
    let sumaCuota = 0;
    let sumaNeto  = 0;
    for (const r of data) {
        if (r.invoiceId) affected.add(r.invoiceId);
        sumaCuota += r.importeCuotaMxn;
        sumaNeto  += r.totalNeto;
    }
    return {
        countCuotasTerceros: data.length,
        sumaImporteCuotaMxn: sumaCuota,
        sumaNetoCfdiMxn:     sumaNeto,
        countCfdAfectados:   affected.size,
    };
}

type _HttpErrorMapped = Readonly<{ status: 400 | 403 | 500; error: string }>;

function _mapErrNameToHttp(summaryName: string): _HttpErrorMapped {
    if (/DashboardForbiddenError|FORBIDDEN/.test(summaryName)) {
        return { status: 403, error: _CUOTAS_ERR_MSG.FORBIDDEN };
    }
    if (/DashboardMissingParamError|MISSING/.test(summaryName)) {
        return { status: 400, error: _CUOTAS_ERR_MSG.BAD_REQUEST };
    }
    if (/ZodError|INVALID_PARAMS/.test(summaryName)) {
        return { status: 400, error: _CUOTAS_ERR_MSG.BAD_PARAMS };
    }
    return { status: 500, error: _CUOTAS_ERR_MSG.INT };
}

export async function GET(req: NextRequest) {
    try {
        const sourceIp = getRealClientIp(req.headers);
        const ipRl = await rateLimit(`fn-drillcuotas-ip:${sourceIp}`, { limit: 60, interval: 60_000 });
        if (!ipRl.success) return _rl429(_CUOTAS_ERR_MSG.RL_IP, ipRl.retryAfterMs);

        const sessionRaw = await auth();
        if (!sessionRaw?.user?.id) return _errJson(401, { ok: false, error: _CUOTAS_ERR_MSG.NO_AUTH });
        const session = sessionRaw as { user: { id: string; email?: string | null; name?: string | null; systemRole?: SystemRole } };

        const userRl = await rateLimit(`fn-drillcuotas-user:${session.user.id}`, { limit: 40, interval: 60_000 });
        if (!userRl.success) return _rl429(_CUOTAS_ERR_MSG.RL_USER, userRl.retryAfterMs);

        const sp  = req.nextUrl.searchParams;
        const raw = _rawFromSearchParams(sp);
        if (!raw.companyId) return _errJson(400, { ok: false, error: _CUOTAS_ERR_MSG.NO_COMPANY });

        const parsed = DrilldownCuotasTercerosParams.safeParse(raw);
        if (!parsed.success) {
            return _errJson(400, {
                ok: false,
                error: _CUOTAS_ERR_MSG.BAD_PARAMS,
                issues: formatZodIssuesSafe<typeof parsed.data>(parsed),
            });
        }

        const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true } });
        const sr = _resolveSystemRole(u ?? null, session.user.systemRole, SystemRole.USER);
        const enriched = await enrichUserWithMemberships({ id: session.user.id, systemRole: sr });
        if (!hasPermission(enriched, Permission.MODULE_PAYROLL_VIEW)) {
            return _errJson(403, { ok: false, error: _CUOTAS_ERR_MSG.NO_PERM });
        }
        const ctx = await requireApprovedDashboardAccess(session.user.id, sr, {
            companyId:      parsed.data.companyId,
            organizationId: parsed.data.organizationId ?? undefined,
            permission:     Permission.MODULE_PAYROLL_VIEW,
        });

        const orgRl = await rateLimit(`fn-drillcuotas-org:${ctx.organizationId}`, { limit: 180, interval: 60_000 });
        if (!orgRl.success) return _rl429(_CUOTAS_ERR_MSG.RL_ORG, orgRl.retryAfterMs);

        const safeFeId = (ctx.fiscalEntityId as string | undefined | null) ?? parsed.data.fiscalEntityId;
        const limit    = Math.min(parsed.data.limit, CUOTAS_PAGE_SIZE);
        const startIso = parsed.data.startDate.toISOString().slice(0, 10);
        const endIso   = parsed.data.endDate.toISOString().slice(0, 10);
        const cursor   = parsed.data.cursorId ?? null;
        const orgId    = String(ctx.organizationId);
        const feVal    = safeFeId ? String(safeFeId) : null;

        const rawRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
            SELECT pd.id                              AS deduccion_id,
                   COALESCE(pd.tipo_deduccion, '')    AS tipo_deduccion,
                   pd.clave                           AS clave_deduccion,
                   pd.concepto                        AS concepto,
                   COALESCE(pd.importe, 0)            AS importe,
                   pr.id                              AS receipt_id,
                   pr.invoice_id                      AS invoice_id,
                   pr.fecha_emision                   AS fecha_emision,
                   pr.fecha_pago                      AS fecha_pago,
                   pr.tipo_nomina                     AS tipo_nomina,
                   COALESCE(pr.departamento, '')      AS pr_departamento,
                   COALESCE(pr.total_percepciones, 0) AS total_percepciones,
                   COALESCE(pr.total_deducciones, 0)  AS total_deducciones,
                   COALESCE(pr.total_otros_pagos, 0)  AS total_otros_pagos,
                   pr.uuid                            AS uuid,
                   inv.series                         AS series,
                   inv.folio                          AS folio,
                   inv.sat_status                     AS sat_status,
                   inv.pdf_url                        AS pdf_url,
                   rec.rfc                            AS rec_rfc,
                   rec.nombre                         AS rec_nombre,
                   rec.curp                           AS rec_curp,
                   rec.num_empleado                   AS rec_num_empleado,
                   rec.departamento                   AS rec_departamento
              FROM payroll_deducciones pd
              JOIN payroll_receipts    pr  ON pr.id = pd.payroll_receipt_id
         LEFT JOIN invoices            inv ON inv.id = pr.invoice_id
         LEFT JOIN payroll_receptors   rec ON rec.payroll_receipt_id = pr.id
             WHERE pr.company_id       = ${parsed.data.companyId}::text
               AND pr.organization_id  = ${orgId}::text
               AND (${feVal}::text IS NULL OR pr.fiscal_entity_id = ${feVal}::text)
               AND pr.fecha_pago       >= ${startIso}::date
               AND pr.fecha_pago       <= ${endIso}::date
               AND pd.tipo_deduccion   IN ('001','006','007','010')
               AND (${cursor}::text IS NULL OR pd.id > ${cursor}::text)
          ORDER BY pd.id ASC
             FETCH FIRST ${limit + 1} ROWS ONLY;
        `;

        const { hasNextPage, taken, nextCursor } = _pageInfoFromRows(rawRows, limit, 'deduccion_id');
        const data: CuotasTercerosRow[] = taken.map(_parseCuotaRow);
        const totals                    = _summarizeCuotas(data);
        const pageSize                  = limit;
        const returned                  = data.length;

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
                        startDate: parsed.data.startDate.toISOString().slice(0, 10),
                        endDate:   endIso,
                    },
                    tiposDeduccionSat: CUOTA_TIPO_SAT,
                    descripcionFiltro: 'Cuotas de Terceros (TipoDeduccion SAT 001/006/007/010): Sindicato, FONACOT, Pensión Alimenticia, INFONAVIT',
                },
                pageInfo: { pageSize, returned, hasNextPage, nextCursor },
                totals,
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
        console.error('[NOMINA_FISCAL_DRILLDOWN_CUOTAS_500]', { fp: fingerprint, summary });

        const { status, error } = _mapErrNameToHttp(summary.name || '');
        return _errJson(status, {
            ok: false,
            error,
            correlationId: fingerprint,
            helpText: 'Si el error persiste, reporta este código a soporte: ' + fingerprint,
        });
    }
}

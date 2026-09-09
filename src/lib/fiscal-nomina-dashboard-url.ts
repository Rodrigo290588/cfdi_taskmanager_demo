// ============================================================
// src/lib/fiscal-nomina-dashboard-url.ts
//
// TASK 2 — URL helpers, parser searchParams, secciónes.
// Paridad estricta con rh-dashboard-url.ts (DASH-SAST-006).
// ============================================================

import { formatISO, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';

export const FISCAL_NOMINA_DASHBOARD_PATH = '/dashboard/nomina/fiscal' as const;

export type FiscalNominaDashboardSearchParams = {
    companyId?: string | null;
    organizationId?: string | null;
    fiscalEntityId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    departamento?: string | null;
    registroPatronal?: string | null;
    sections?: string | null;
};

export const FISCAL_NOMINA_SECTIONS = [
    { id: 'kpis',                label: 'KPIs Principales' },
    { id: 'gravado_exento',      label: 'Gravado vs Exento' },
    { id: 'deducciones_terceros',label: 'Deducciones Terceros' },
    { id: 'alertas_sbc_sdi',     label: 'Alertas SBC · SDI' },
    { id: 'alertas_timbrado',    label: 'Alertas Timbrado' },
    { id: 'top_comprobantes',    label: 'Top Comprobantes' },
] as const;
export type FiscalNominaSectionId = typeof FISCAL_NOMINA_SECTIONS[number]['id'];
const FISCAL_NOM_SECTION_IDS = new Set<string>(FISCAL_NOMINA_SECTIONS.map(s => s.id));
const FISCAL_NOM_ALLOW_SECTION = /^[A-Za-z\d_]{1,40}$/;

export const FISCAL_NOM_ALLOW_DEPARTAMENTO =
    /^[A-Za-z\d ÑñáéíóúÁÉÍÓÚÜü.,_/-]{1,80}$/;
export const FISCAL_NOM_ALLOW_REGISTRO_PATRONAL = /^[A-Za-z0-9-]{1,20}$/;

export type RawParsedFiscalNominaFilters = {
    companyId: string | null;
    organizationId: string | null;
    fiscalEntityId: string | null;
    startDate: string;
    endDate: string;
    departamento: string | null;
    registroPatronal: string | null;
    sections: FiscalNominaSectionId[];
};

export function parseFiscalNominaSearchParams(
    raw: Record<string, string | string[] | undefined> | null | undefined,
): RawParsedFiscalNominaFilters {
    const r = raw ?? {};
    const read = (k: keyof FiscalNominaDashboardSearchParams): string | null => {
        const v = r[k];
        if (Array.isArray(v)) return v[0] ?? null;
        return typeof v === 'string' && v !== '' ? v : null;
    };

    const s = read('startDate');
    const e = read('endDate');
    let startDate: Date;
    let endDate: Date;
    try {
        startDate = s ? parseISO(s.slice(0, 10)) : subMonths(startOfMonth(new Date()), 3);
        endDate   = e ? parseISO(e.slice(0, 10)) : endOfMonth(new Date());
        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime()))
            startDate = subMonths(startOfMonth(new Date()), 3);
        if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime()))
            endDate = endOfMonth(new Date());
        if (startDate.getTime() > endDate.getTime())
            [startDate, endDate] = [endDate, startDate];
    } catch {
        startDate = subMonths(startOfMonth(new Date()), 3);
        endDate   = endOfMonth(new Date());
    }

    const d = read('departamento');
    const departamento = d && FISCAL_NOM_ALLOW_DEPARTAMENTO.test(d) ? d : null;

    const rp = read('registroPatronal');
    const registroPatronal = rp && FISCAL_NOM_ALLOW_REGISTRO_PATRONAL.test(rp) ? rp : null;

    const rawSec = read('sections');
    let sections: FiscalNominaSectionId[];
    if (!rawSec) {
        sections = FISCAL_NOMINA_SECTIONS.map(s => s.id);
    } else {
        const tokens = rawSec.split(',').map(t => t.trim()).filter(Boolean);
        const valid = tokens.filter(
            t => FISCAL_NOM_ALLOW_SECTION.test(t) && FISCAL_NOM_SECTION_IDS.has(t),
        ) as FiscalNominaSectionId[];
        sections = valid.length > 0 ? valid : FISCAL_NOMINA_SECTIONS.map(s => s.id);
    }

    return {
        companyId: read('companyId') ?? null,
        organizationId: read('organizationId') ?? null,
        fiscalEntityId: read('fiscalEntityId') ?? null,
        startDate: formatISO(startDate, { representation: 'date' }),
        endDate:   formatISO(endDate,   { representation: 'date' }),
        departamento,
        registroPatronal,
        sections,
    };
}

function _urlParamValueToString(v: string | number | boolean | null | undefined): string {
    if (typeof v === 'boolean') {
        return v ? '1' : '0';
    }
    return String(v);
}

export function buildFiscalNominaDashboardUrl(
    base: string = FISCAL_NOMINA_DASHBOARD_PATH,
    params: Partial<FiscalNominaDashboardSearchParams> &
              Record<string, string | number | boolean | null | undefined> = {},
): string {
    const sp = new URLSearchParams();
    const allIds = FISCAL_NOMINA_SECTIONS.map(s => s.id).join(',');
    for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined || v === '') continue;
        if (k === 'sections' && v === allIds) continue; // omit default
        const s = _urlParamValueToString(v);
        sp.append(k, s);
    }
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
}

export function fiscalNominaCacheKey(params: {
    organizationId: string;
    companyId: string;
    fiscalEntityId?: string | null;
    departamento?: string | null;
    registroPatronal?: string | null;
    startDate: string;
    endDate: string;
}): string {
    return [
        'fiscal-nomina',
        params.organizationId,
        params.companyId,
        params.fiscalEntityId ?? '*',
        params.departamento ?? '*',
        params.registroPatronal ?? '*',
        params.startDate,
        params.endDate,
    ].join('::');
}

// ============================================================
// src/lib/rh-dashboard-url.ts
// Utilidades para construcción segura de URLs, parsing de
// searchParams y generación de keys de caché para el Tablero RH.
//
// Principio: NUNCA concatenar ?x=${y} con template strings.
//            Siempre URLSearchParams (DASH-SAST-006 pattern).
// ============================================================

import { formatISO, parseISO } from 'date-fns';

export type RhDashboardSearchParams = {
  companyId: string;
  organizationId?: string | null;
  fiscalEntityId?: string | null;
  departamento?: string | null;
  tipoNomina?: string | null;
  periodicidad?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  view?: 'monthly' | 'quarterly' | 'yearly';
  sections?: string | null;
};

// --------- Parsing defensivo (Server Component recibe searchParams tipados) ---------
export const RH_URL_ALLOW_DEPARTAMENTO =
  /^[A-Za-z0-9 ÑñáéíóúÁÉÍÓÚÜü.,_/-]{1,80}$/;
export const RH_URL_ALLOW_TIPO = /^[A-Za-z0-9]{1,5}$/;

export const RH_VIEW_MODES = ['monthly', 'quarterly', 'yearly'] as const;

export const RH_SECTIONS = [
  { id: 'kpis',          label: 'KPIs Principales' },
  { id: 'turnover',      label: 'Rotación (Turnover)' },
  { id: 'incapacidades', label: 'Incapacidades' },
  { id: 'horas_extra',   label: 'Horas Extra' },
  { id: 'plantilla',     label: 'Plantilla / Contratos' },
  { id: 'beneficios',    label: 'Beneficios / Percepciones' },
] as const;
export type RhSectionId = typeof RH_SECTIONS[number]['id'];

const RH_SECTION_IDS = new Set<string>(RH_SECTIONS.map(s => s.id));
const RH_ALLOW_SECTION_TOKEN = /^\w{1,40}$/;

export type RawParsedRhFilters = {
  companyId: string;
  organizationId: string | null;
  fiscalEntityId: string | null;
  departamento: string | null;
  tipoNomina: string | null;
  periodicidad: string | null;
  startDate: string | null;
  endDate: string | null;
  view: 'monthly' | 'quarterly' | 'yearly';
  sections: RhSectionId[];
};

/**
 * Extrae y valida el rango de fechas de los parámetros de búsqueda.
 * Retorna null si las fechas no son provistas o son inválidas, permitiendo
 * un filtro abierto.
 */
function parseDateRange(startDateRaw: string | null, endDateRaw: string | null): { startDate: Date | null; endDate: Date | null } {
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  
  try {
    if (startDateRaw) startDate = parseISO(startDateRaw.slice(0, 10));
    if (endDateRaw) endDate = parseISO(endDateRaw.slice(0, 10));
    
    if (startDate && (Number.isNaN(startDate.getTime()) || !(startDate instanceof Date))) {
      startDate = null;
    }
    if (endDate && (Number.isNaN(endDate.getTime()) || !(endDate instanceof Date))) {
      endDate = null;
    }
    
    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      [startDate, endDate] = [endDate, startDate];
    }
  } catch {
    startDate = null;
    endDate = null;
  }
  
  return { startDate, endDate };
}

/**
 * Parsea y valida searchParams recibidos en el Server Component / Route Handler.
 * Fail-closed: cualquier valor inválido vuelve al default seguro.
 */
export function parseRhSearchParams(raw: Record<string, string | string[] | undefined> | null | undefined):
  RawParsedRhFilters
{
  const r = raw ?? {};
  const read = (k: keyof RhDashboardSearchParams): string | null => {
    const v = r[k];
    if (Array.isArray(v)) return v[0] ?? null;
    return typeof v === 'string' && v !== '' ? v : null;
  };

  const { startDate, endDate } = parseDateRange(read('startDate'), read('endDate'));

  const depto = read('departamento');
  const departamento = depto && RH_URL_ALLOW_DEPARTAMENTO.test(depto) ? depto : null;

  const rawView = read('view');
  const view: 'monthly' | 'quarterly' | 'yearly' =
    rawView && RH_VIEW_MODES.includes(rawView as never) ? (rawView as 'monthly') : 'monthly';

  const rawSections = read('sections');
  let sections: RhSectionId[];
  if (!rawSections) {
    sections = RH_SECTIONS.map(s => s.id);
  } else {
    const tokens = rawSections.split(',').map(s => s.trim()).filter(Boolean);
    const parsed = tokens
      .filter(t => RH_ALLOW_SECTION_TOKEN.test(t) && RH_SECTION_IDS.has(t)) as RhSectionId[];
    sections = parsed.length > 0 ? parsed : RH_SECTIONS.map(s => s.id);
  }

  const rawTipoNomina = read('tipoNomina');
  const tipoNomina = rawTipoNomina && RH_URL_ALLOW_TIPO.test(rawTipoNomina) ? rawTipoNomina : null;

  const rawPeriodicidad = read('periodicidad');
  const periodicidad = rawPeriodicidad && RH_URL_ALLOW_TIPO.test(rawPeriodicidad) ? rawPeriodicidad : null;

  return {
    companyId: read('companyId') ?? '',
    organizationId: read('organizationId') ?? null,
    fiscalEntityId: read('fiscalEntityId') ?? null,
    departamento,
    tipoNomina,
    periodicidad,
    startDate: startDate ? formatISO(startDate, { representation: 'date' }) : null,
    endDate:   endDate ? formatISO(endDate,   { representation: 'date' }) : null,
    view,
    sections,
  };
}

// --------- Construcción segura de URLs (DASH-SAST-006 compliant) ---------
export function buildRhDashboardUrl(
  base: string,
  params: Partial<RhDashboardSearchParams> & Record<string, string | number | boolean | null | undefined> = {},
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    
    let s: string;
    if (typeof v === 'boolean') {
      s = v ? '1' : '0';
    } else {
      s = String(v);
    }
    
    sp.append(k, s);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

// --------- Claves de caché deterministas para ISR / revalidateTag ---------
export function rhCacheKey(params: {
  organizationId: string | null;
  companyId: string;
  fiscalEntityId?: string | null;
  departamento?: string | null;
  tipoNomina?: string | null;
  periodicidad?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): string {
  const parts = [
    'rh-dashboard',
    params.organizationId ?? '*',
    params.companyId,
    params.fiscalEntityId ?? '*',
    params.departamento ?? '*',
    params.tipoNomina ?? '*',
    params.periodicidad ?? '*',
    params.startDate ?? '*',
    params.endDate ?? '*',
  ];
  return parts.join('::');
}

export const RH_DEFAULT_REVALIDATE_SECONDS = 60;

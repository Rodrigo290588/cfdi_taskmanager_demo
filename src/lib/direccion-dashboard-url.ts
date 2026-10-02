// ============================================================
// src/lib/direccion-dashboard-url.ts
// Tablero RH Directivo (C-Level / Estratégico)
//
// Utilidades para:
//   1. Parseo seguro de searchParams (fail-closed XSS / injection)
//   2. Construcción de URLs vía URLSearchParams (DASH-SAST-006)
//   3. Claves de caché deterministas por scope empresa/período
//
// Principio: NUNCA concatenar template strings ?x=${y}.
//            Siempre usar URLSearchParams.
// ============================================================

import { formatISO, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';

// ---------- TIPOS ----------
export type DireccionSectionId =
  | 'kpis'
  | 'tendencia_historica'
  | 'composicion_fijo_variable'
  | 'desviacion_presupuestal';

export const DIRECCION_SECTIONS = [
  {
    id: 'kpis' as const,
    label: 'KPIs Ejecutivos',
    description: '4 tarjetas: Costo Total, Costo/Empleado, % Variable, Desviación Presupuesto',
  },
  {
    id: 'tendencia_historica' as const,
    label: 'Tendencia Histórica y YoY',
    description: 'AreaChart Costo Laboral mensual con comparativo año anterior',
  },
  {
    id: 'composicion_fijo_variable' as const,
    label: 'Composición Fijo / Variable',
    description: 'PieChart Donut + Tabla 7 rubros SAT',
  },
  {
    id: 'desviacion_presupuestal' as const,
    label: 'Desviación Presupuestal',
    description: 'Tabla por departamento con badges semáforo En Línea / Atención / Fuera',
  },
] as const;

export const DIRECCION_VIEW_MODES = ['monthly', 'quarterly', 'yearly'] as const;
export type DireccionViewMode = typeof DIRECCION_VIEW_MODES[number];

export type DireccionDashboardSearchParams = {
  companyId?: string | null;
  organizationId?: string | null;
  fiscalEntityId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  departamento?: string | null;
  anioComparativo?: number | string | null;
  view?: string | null;
  sections?: string | null;
};

export type RawParsedDireccionFilters = {
  companyId: string;
  organizationId: string | null;
  fiscalEntityId: string | null;
  startDate: string;
  endDate: string;
  departamento: string | null;
  anioComparativo: number | null;
  view: DireccionViewMode;
  sections: DireccionSectionId[];
};

// ---------- ALLOW-LISTS REGEX (fail-closed) ----------
export const DIRECCION_ALLOW_DEPARTAMENTO =
  /^[A-Za-z0-9 ÑñáéíóúÁÉÍÓÚÜü.,_/\-()&+]{1,80}$/;
const DIRECCION_ALLOW_SECTION_TOKEN = /^\w{1,50}$/;
const DIRECCION_SECTION_IDS = new Set<string>(DIRECCION_SECTIONS.map(s => s.id));
const ANIO_MIN = 2000;
const ANIO_MAX = 2100;

// ---------- PARSEO SEGURO ----------
function getValidDateOrFallback(dateRaw: string | null, fallback: Date): Date {
  if (!dateRaw) return fallback;
  const parsed = parseISO(dateRaw.slice(0, 10));
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed;
}

function parseDireccionDates(startDateRaw: string | null, endDateRaw: string | null) {
  const defaultStart = subMonths(startOfMonth(new Date()), 12);
  const defaultEnd = endOfMonth(new Date());

  try {
    let startDate = getValidDateOrFallback(startDateRaw, defaultStart);
    let endDate = getValidDateOrFallback(endDateRaw, defaultEnd);
    
    if (startDate.getTime() > endDate.getTime()) {
      [startDate, endDate] = [endDate, startDate];
    }
    
    return { startDate, endDate };
  } catch {
    return { startDate: defaultStart, endDate: defaultEnd };
  }
}

function parseDireccionAnioComparativo(anioCompRaw: string | null, startDateYear: number): number {
  if (anioCompRaw !== null) {
    const n = Number(anioCompRaw);
    if (Number.isInteger(n) && n >= ANIO_MIN && n <= ANIO_MAX) {
      return n;
    }
  }
  return startDateYear - 1;
}

function parseDireccionView(viewRaw: string | null): DireccionViewMode {
  if (viewRaw && DIRECCION_VIEW_MODES.includes(viewRaw as DireccionViewMode)) {
    return viewRaw as DireccionViewMode;
  }
  return 'monthly';
}

function parseDireccionSections(rawSections: string | null): DireccionSectionId[] {
  if (!rawSections) {
    return DIRECCION_SECTIONS.map(s => s.id);
  }
  
  const tokens = rawSections.split(',').map(s => s.trim()).filter(Boolean);
  const parsed = tokens.filter(
    t => DIRECCION_ALLOW_SECTION_TOKEN.test(t) && DIRECCION_SECTION_IDS.has(t),
  ) as DireccionSectionId[];
  
  return parsed.length > 0 ? parsed : DIRECCION_SECTIONS.map(s => s.id);
}

export function parseDireccionSearchParams(
  raw: Record<string, string | string[] | undefined> | URLSearchParams | null | undefined,
): RawParsedDireccionFilters {
  const r = raw instanceof URLSearchParams ? Object.fromEntries(raw.entries()) : (raw ?? {});
  const read = (k: keyof DireccionDashboardSearchParams): string | null => {
    const v = (r as Record<string, string | string[] | undefined>)[k];
    if (Array.isArray(v)) return v[0] ?? null;
    return typeof v === 'string' && v !== '' ? v : null;
  };

  const { startDate, endDate } = parseDireccionDates(read('startDate'), read('endDate'));
  
  const deptoRaw = read('departamento');
  const departamento = deptoRaw && DIRECCION_ALLOW_DEPARTAMENTO.test(deptoRaw) ? deptoRaw : null;
  
  const anioComparativo = parseDireccionAnioComparativo(read('anioComparativo'), startDate.getFullYear());
  const view = parseDireccionView(read('view'));
  const sections = parseDireccionSections(read('sections'));

  return {
    companyId: read('companyId') ?? '',
    organizationId: read('organizationId') ?? null,
    fiscalEntityId: read('fiscalEntityId') ?? null,
    startDate: formatISO(startDate, { representation: 'date' }),
    endDate:   formatISO(endDate,   { representation: 'date' }),
    departamento,
    anioComparativo,
    view,
    sections,
  };
}

function processSectionsParam(v: unknown, allSections: string[], sp: URLSearchParams) {
  if (!Array.isArray(v)) return;
  const safeIds = v.filter(id => DIRECCION_SECTION_IDS.has(id));
  if (safeIds.length > 0 && safeIds.length !== allSections.length) {
    sp.append('sections', safeIds.join(','));
  }
}

function processPrimitiveParam(k: string, v: unknown, sp: URLSearchParams) {
  let s: string;
  if (typeof v === 'boolean') {
    s = v ? '1' : '0';
  } else {
    s = String(v);
  }
  sp.append(k, s);
}

// ---------- CONSTRUCCIÓN SEGURA DE URL (DASH-SAST-006) ----------
export function buildDireccionDashboardUrl(
  base: '/dashboard/direccion' | '/api/stats/direccion' | (string & {}),
  params: Partial<DireccionDashboardSearchParams> & {
    sections?: DireccionSectionId[];
    view?: DireccionViewMode;
    anioComparativo?: number | null;
  } & Record<string, string | number | boolean | null | undefined> = {},
): string {
  const sp = new URLSearchParams();
  const allSections = DIRECCION_SECTIONS.map(s => s.id);
  
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    
    if (k === 'sections') {
      processSectionsParam(v, allSections, sp);
      continue;
    }
    
    processPrimitiveParam(k, v, sp);
  }
  
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

// ---------- CACHE KEYS ----------
export function direccionCacheKey(params: {
  organizationId: string;
  companyId: string;
  fiscalEntityId?: string | null;
  departamento?: string | null;
  startDate: string;
  endDate: string;
  anioComparativo?: number | null;
  view?: DireccionViewMode;
}): string {
  const parts = [
    'direccion-dashboard',
    params.organizationId,
    params.companyId,
    params.fiscalEntityId ?? '*',
    params.departamento ?? '*',
    params.startDate,
    params.endDate,
    String(params.anioComparativo ?? '*'),
    params.view ?? 'monthly',
  ];
  return parts.join('::');
}

export const DIRECCION_DEFAULT_REVALIDATE_SECONDS = 300;

// ============================================================
// src/lib/payroll-analytics-ui-helpers.ts
//
// LÓGICA PURA (sin React) extraída desde los Client Components.
// Propósito: Unit Testing en Jest (node) sin jsdom/react testing-library.
// Cobertura ≥ 85% con functions-only.
//
// Contiene:
//   · Formatters (Intl es-MX MXN / numero / % / fecha)
//   · computeTrendTone() — lógica TrendBadge sin JSX
//   · 5 aggregates por eje RH (Turnover · Incapacidades · HorasExtra · Plantilla · Beneficios)
//   · computeTurnoverTone / computeAntiguedadTone / computePromHxEmpleadoTone
// ============================================================

import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

// ---------- Paleta (readonly copy desde rh-shared para unit tests) ----------
export const RH_PALETTE = {
  turnover: { altas: '#10b981', bajas: '#ef4444', reingresos: '#f59e0b', activos: '#3b82f6' },
  incapacidades: { riesgoTrabajo: '#ef4444', enfermedadGeneral: '#f59e0b', maternidad: '#ec4899', otro: '#94a3b8' },
  horasExtra: { dobles: '#6366f1', triples: '#8b5cf6', importe: '#0ea5e9' },
  plantilla: { contrato: ['#0ea5e9', '#14b8a6', '#f97316', '#a855f7', '#ef4444', '#64748b'] },
  beneficios: { vales: '#10b981', ahorro: '#3b82f6', puntualidad: '#f59e0b', asistencia: '#8b5cf6' },
  grid: '#e2e8f0',
  text: '#475569',
} as const;

// ---------- Formateadores (idénticos a rh-shared.tsx) ----------
export function fmtMxn(n: number | null | undefined, maxDigits = 0): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return '$0';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', maximumFractionDigits: maxDigits,
  }).format(value);
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: digits }).format(value);
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(digits)}%`;
}

export function fmtDateEs(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' });
}

// ---------- Tono KPI (pure, sin JSX) ----------
export type CardTone =
  | 'emerald' | 'blue' | 'rose' | 'amber' | 'indigo' | 'violet' | 'slate';

// ---------- TrendBadge logic (PURA: calcula tono sin renderizar JSX) ----------
export type TrendPure = {
  delta: number;
  pctChange: number;
  tone: 'emerald' | 'rose' | 'slate';
  direction: 'up' | 'down' | 'flat';
  display: string;
};
export function computeTrendTone(
  value: number,
  previous?: number,
  mode: 'default' | 'reversed' = 'default',
  eps = 0.001,
): TrendPure {
  const prevAusente = previous === undefined || previous === 0;
  if (prevAusente) {
    return {
      delta: 0, pctChange: 0, tone: 'slate', direction: 'flat',
      display: 'n/a',
    };
  }
  const delta = value - previous;
  const pctChange = (delta / Math.abs(previous)) * 100;
  const flat = Math.abs(delta) < eps;
  const up = delta > 0;
  let tone: 'emerald' | 'rose' | 'slate' = 'slate';
  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (!flat) {
    direction = up ? 'up' : 'down';
    if (mode === 'default') tone = up ? 'emerald' : 'rose';
    else tone = up ? 'rose' : 'emerald'; // reversed: up=malo, down=bueno
  }
  const display = _trendDisplayString(flat, pctChange);
  return { delta, pctChange, tone, direction, display };
}
function _trendDisplayString(flat: boolean, pctChange: number): string {
  if (flat) return 'sin cambio';
  return `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%`;
}
function _firstHalf<T>(arr: readonly T[]): { half: number; first: T[]; } {
  const half = Math.max(1, Math.floor(arr.length / 2));
  return { half, first: arr.slice(0, half) };
}
function _sumByKey<T, K extends keyof T>(arr: readonly T[], key: K): number {
  return arr.reduce((acc, row) => {
    const v = Number(row[key]);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}
function _sumRowKeys<T>(row: T, keys: readonly (keyof T)[]): number {
  return keys.reduce((acc, k) => {
    const v = Number(row[k]);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}
type _3TierToneColor = 'emerald' | 'amber' | 'rose';
function _3TierToneHelper(
  value: number, highThreshold: number, medThreshold: number,
  mode: 'default' | 'reversed' = 'default',
): _3TierToneColor {
  const high: _3TierToneColor = mode === 'default' ? 'rose' : 'emerald';
  const low:  _3TierToneColor = mode === 'default' ? 'emerald' : 'rose';
  if (value > highThreshold) return high;
  if (value > medThreshold) return 'amber';
  return low;
}
function _beneficioLabelByCodigo(
  codigo: string,
  fallbackDescripcion: string = '',
): string {
  const oficial = BENEFICIOS_OFICIALES.find(k => k.codigo === codigo);
  const descripcion = oficial?.descripcion ?? fallbackDescripcion;
  return descripcion || `Otro (${codigo})`;
}
function _pieFillColor(index: number, palette: readonly string[] = [RH_PALETTE.grid]): string {
  return palette[index % palette.length];
}
function _pieValuePct(value: number, total: number = 1): string {
  return `${((value / total) * 100).toFixed(1)}%`;
}

// ---------- Helper shared: Date→YYYY-MM ----------
function monthKey(d: Date | string): string {
  const parsed = typeof d === 'string' ? new Date(d) : d;
  return parsed.toISOString().slice(0, 7);
}
function labelMMMyy(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return format(new Date(y, (m || 1) - 1, 1), 'MMM yy', { locale: es });
}
function _withYmLabel<T extends object>(entry: readonly [string, T]) {
  const [key, v] = entry;
  return { key, label: labelMMMyy(key), ...v };
}

// ============================================================
// EJE 1 · TURNOVER
// ============================================================
export type TurnoverInputRow = {
  departamento: string | null;
  mes_pago: Date | string;
  altas: number;
  bajas: number;
  reingresos: number;
  empleados_activos: number;
  total_recibos?: number;
};
export type TurnoverChartRow = {
  key: string;
  label: string;
  altas: number;
  bajas: number;
  reingresos: number;
  activos: number;
};
export type TurnoverSummary = {
  altas: number; bajas: number; reingresos: number; empleados: number;
};
function _turnoverAccumulateByMonth(rows: TurnoverInputRow[]) {
  const byMonth = new Map<string, {
    altas: number; bajas: number; reingresos: number; activos: number;
  }>();
  for (const r of rows) {
    const key = monthKey(r.mes_pago);
    const acc = byMonth.get(key) ?? { altas: 0, bajas: 0, reingresos: 0, activos: 0 };
    acc.altas      += Number(r.altas || 0);
    acc.bajas      += Number(r.bajas || 0);
    acc.reingresos += Number(r.reingresos || 0);
    acc.activos    =  Math.max(acc.activos, Number(r.empleados_activos || 0));
    byMonth.set(key, acc);
  }
  const sorted = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  const chart: TurnoverChartRow[] = sorted.map(_withYmLabel);
  return { chart };
}
function _turnoverComputeSummaries(chart: TurnoverChartRow[]) {
  const { half, first } = _firstHalf(chart);
  const summary: TurnoverSummary = {
    altas: _sumByKey(chart, 'altas'),
    bajas: _sumByKey(chart, 'bajas'),
    reingresos: _sumByKey(chart, 'reingresos'),
    empleados: chart.length ? (chart.at(-1)?.activos || 0) : 0,
  };
  const previous: TurnoverSummary = {
    altas: _sumByKey(first, 'altas'),
    bajas: _sumByKey(first, 'bajas'),
    reingresos: _sumByKey(first, 'reingresos'),
    empleados: chart.at(half - 1)?.activos ?? 0,
  };
  const turnoverPct = summary.empleados ? (summary.bajas / summary.empleados) * 100 : 0;
  const turnoverTone: CardTone = computeTurnoverTone(turnoverPct);
  return { summary, previous, turnoverPct, turnoverTone };
}
export function aggregateTurnover(rows: TurnoverInputRow[]) {
  const { chart } = _turnoverAccumulateByMonth(rows);
  const { summary, previous, turnoverPct, turnoverTone } = _turnoverComputeSummaries(chart);
  return { chart, summary, previous, turnoverPct, turnoverTone };
}
export function computeTurnoverTone(pct: number): CardTone {
  return _3TierToneHelper(pct, 8, 4, 'default');
}

// ============================================================
// EJE 2 · INCAPACIDADES
// ============================================================
export type IncapacidadesInputRow = {
  departamento: string | null;
  mes_pago: Date | string;
  tipo_incapacidad: string;
  descripcion_tipo: string;
  numero_eventos: number;
  total_dias: number;
  promedio_dias_por_evento?: number;
  importe_total: number;
  empleados_afectados: number;
};
export type IncapPieRow = {
  name: string; value: number; fill: string; pct: string;
};
export type IncapBarRow = {
  key: string; label: string; dias: number; empleados: number; anomaly: boolean;
};
const TIPO_FILL_INCAP: Record<string, string> = {
  '01': RH_PALETTE.incapacidades.riesgoTrabajo,
  '02': RH_PALETTE.incapacidades.enfermedadGeneral,
  '03': RH_PALETTE.incapacidades.maternidad,
};
type _IncapAccumulated = {
  tipoAcc: Map<string, { name: string; value: number; fill: string }>;
  mesAcc: Map<string, { dias: number; empleados: number }>;
  totalDias: number; totalEventos: number; totalEmpleados: number; totalImporte: number;
};
function _incapacidadesAccumulate(rows: IncapacidadesInputRow[]): _IncapAccumulated {
  const tipoAcc = new Map<string, { name: string; value: number; fill: string }>();
  const mesAcc  = new Map<string, { dias: number; empleados: number }>();
  let totalDias = 0, totalEventos = 0, totalEmpleados = 0, totalImporte = 0;
  for (const r of rows) {
    const mesKey = monthKey(r.mes_pago);
    const dias = Number(r.total_dias || 0);
    const eventos = Number(r.numero_eventos || 0);
    const emps = Number(r.empleados_afectados || 0);
    const imp = Number(r.importe_total || 0);
    const pieCur = tipoAcc.get(r.tipo_incapacidad) ?? {
      name: r.descripcion_tipo, value: 0,
      fill: TIPO_FILL_INCAP[r.tipo_incapacidad] ?? RH_PALETTE.incapacidades.otro,
    };
    pieCur.value += dias;
    tipoAcc.set(r.tipo_incapacidad, pieCur);
    const m = mesAcc.get(mesKey) ?? { dias: 0, empleados: 0 };
    m.dias += dias; m.empleados += emps;
    mesAcc.set(mesKey, m);
    totalDias += dias; totalEventos += eventos; totalEmpleados += emps; totalImporte += imp;
  }
  return { tipoAcc, mesAcc, totalDias, totalEventos, totalEmpleados, totalImporte };
}
function _incapacidadesBuildOutputs(acc: _IncapAccumulated) {
  const { tipoAcc, mesAcc, totalDias, totalEventos, totalEmpleados, totalImporte } = acc;
  const pieRaw = Array.from(tipoAcc.values()).sort((a,b) => b.value - a.value);
  const pie: IncapPieRow[] = pieRaw.map(p => ({
    ...p, pct: `${totalDias ? ((p.value / totalDias) * 100).toFixed(1) : '0.0'}%`,
  }));
  const barSorted = Array.from(mesAcc.entries()).sort(([a],[b]) => a.localeCompare(b));
  const diasArr = barSorted.map(([, v]) => v.dias);
  const media = diasArr.length ? diasArr.reduce((a,b) => a+b,0) / diasArr.length : 0;
  const std = Math.sqrt(
    diasArr.length
      ? diasArr.reduce((a,b) => a + Math.pow(b - media, 2), 0) / diasArr.length
      : 0
  );
  const bars: IncapBarRow[] = barSorted.map(([key, v]) => ({
    ..._withYmLabel([key, v]),
    anomaly: std > 0 ? v.dias > media + 2 * std : false,
  }));
  const { first } = _firstHalf(bars);
  const countEventosByBar = (barKeys: IncapBarRow[]) => {
    const w = barKeys.length / Math.max(1, bars.length);
    return Math.round(totalEventos * w);
  };
  const summary = {
    dias: totalDias, eventos: totalEventos, empleados: totalEmpleados, importe: totalImporte,
    diasPorEvento: totalEventos ? totalDias / totalEventos : 0,
  };
  const previous = {
    dias: _sumByKey(first, 'dias'),
    empleados: _sumByKey(first, 'empleados'),
    eventos: countEventosByBar(first),
  };
  return { pie, bars, summary, previous, stats: { mediaDias: media, stdDias: std } };
}
export function aggregateIncapacidades(rows: IncapacidadesInputRow[]) {
  const acc = _incapacidadesAccumulate(rows);
  return _incapacidadesBuildOutputs(acc);
}

// ============================================================
// EJE 3 · HORAS EXTRA
// ============================================================
export type HorasExtraInputRow = {
  departamento: string;
  mes_pago: Date | string;
  tipo_horas: string;
  descripcion_tipo?: string;
  numero_nominas?: number;
  empleados: number;
  total_horas: number;
  total_dias?: number;
  importe_total: number;
};
export const UMBRAL_HX_POR_EMPLEADO = 8;
export type HxStackedRow = {
  departamento: string; dobles: number; triples: number; importe: number;
  empleados: number; totalHoras: number; porEmpleado: number;
};
export function computePromHxEmpleadoTone(summary: {
  horas: number; empleados: number;
}): { key: string; tone: 'rose' | 'amber' | 'emerald' } {
  const v = summary.empleados ? summary.horas / summary.empleados : 0;
  const medioThreshold = Math.max(2, UMBRAL_HX_POR_EMPLEADO * 0.6);
  const tone = _3TierToneHelper(v, UMBRAL_HX_POR_EMPLEADO, medioThreshold, 'default');
  const prefix = tone === 'rose' ? 'Alto' : tone === 'amber' ? 'Medio' : 'Normal';
  return { key: `${prefix} ${fmtNum(v,1)} h/emp`, tone };
}
export function aggregateHorasExtra(rows: HorasExtraInputRow[]) {
  const acc = _hxAccumulateByDept(rows);
  return _hxBuildStackedAndSummaries(acc);
}
type _HxAccumulated = ReturnType<typeof _hxAccumulateByDept>;
function _hxAccumulateByDept(rows: HorasExtraInputRow[]) {
  const deptAcc = new Map<string, {
    dobles: number; triples: number; importe: number; empleados: number;
  }>();
  let totDobles = 0, totTriples = 0, totImporte = 0, totEmpleados = 0;
  for (const r of rows) {
    const d = r.departamento || 'Sin Departamento';
    const th = r.tipo_horas;
    const horas = Number(r.total_horas || 0);
    const imp = Number(r.importe_total || 0);
    const emps = Number(r.empleados || 0);
    const prev = deptAcc.get(d) ?? { dobles: 0, triples: 0, importe: 0, empleados: 0 };
    if (th === '02') { prev.triples += horas; totTriples += horas; }
    else             { prev.dobles += horas; totDobles += horas; }
    prev.importe += imp;
    prev.empleados = Math.max(prev.empleados, emps);
    deptAcc.set(d, prev);
    totImporte += imp;
    totEmpleados += emps;
  }
  return { deptAcc, totDobles, totTriples, totImporte, totEmpleados };
}
function _hxBuildStackedAndSummaries(acc: _HxAccumulated) {
  const { deptAcc, totDobles, totTriples, totImporte, totEmpleados } = acc;
  const stacked: HxStackedRow[] = Array.from(deptAcc.entries())
    .map(([d, v]) => ({
      departamento: d, dobles: v.dobles, triples: v.triples, importe: v.importe,
      empleados: v.empleados,
      totalHoras: v.dobles + v.triples,
      porEmpleado: v.empleados ? (v.dobles + v.triples) / v.empleados : 0,
    }))
    .sort((a, b) => b.totalHoras - a.totalHoras)
    .slice(0, 10);
  const overloaded = stacked.filter(s => s.porEmpleado > UMBRAL_HX_POR_EMPLEADO);
  const { first: firstStacked } = _firstHalf(stacked);
  const previous = {
    horas: _sumByKey(firstStacked, 'totalHoras'),
    importe: _sumByKey(firstStacked, 'importe'),
  };
  const summary = {
    horas: totDobles + totTriples, dobles: totDobles, triples: totTriples,
    importe: totImporte, empleados: totEmpleados,
    promHxEmp: totEmpleados ? (totDobles + totTriples) / totEmpleados : 0,
  };
  return { stacked, overloaded, summary, previous };
}

// ============================================================
// EJE 4 · PLANTILLA
// ============================================================
export type PlantillaInputRow = {
  departamento: string;
  tipo_contrato: string;
  tipo_jornada: string;
  num_empleados: number;
  antiguedad_promedio_anios: number;
  sdi_promedio: number;
};
export type PlantillaPieRow = {
  name: string; value: number; fill: string; pct: string;
};
export type PlantillaSummary = {
  headcount: number; deptos: number; perfiles: number;
  antiguedadProm: number; sdiProm: number;
};
export function computeAntiguedadTone(avgYears: number): CardTone {
  return _3TierToneHelper(avgYears, 3, 1, 'reversed');
}
type _PlantillaAccumulated = {
  contratoAcc: Map<string, number>;
  jornadaAcc: Map<string, number>;
  headcount: number;
  sdiSum: number; sdiW: number;
  antW: number; antWCount: number;
};
function _plantillaAccumulateFromRows(rows: PlantillaInputRow[]): _PlantillaAccumulated {
  const contratoAcc = new Map<string, number>();
  const jornadaAcc  = new Map<string, number>();
  let headcount = 0;
  let sdiSum = 0, sdiW = 0, antW = 0, antWCount = 0;

  for (const r of rows) {
    const num = Number(r.num_empleados || 0);
    headcount += num;
    const keyC = (r.tipo_contrato || 'Sin especificar').toString();
    const keyJ = (r.tipo_jornada  || 'Sin especificar').toString();
    contratoAcc.set(keyC, (contratoAcc.get(keyC) ?? 0) + num);
    jornadaAcc.set(keyJ,  (jornadaAcc.get(keyJ)  ?? 0) + num);

    const ant = Number(r.antiguedad_promedio_anios || 0);
    if (num > 0 && Number.isFinite(ant)) { antW += ant * num; antWCount += num; }
    const sdi = Number(r.sdi_promedio || 0);
    if (num > 0 && Number.isFinite(sdi)) { sdiSum += sdi * num; sdiW += num; }
  }
  return { contratoAcc, jornadaAcc, headcount, sdiSum, sdiW, antW, antWCount };
}
function _plantillaToPieChart(ac: Map<string, number>, palette: readonly string[]): PlantillaPieRow[] {
  const total = Array.from(ac.values()).reduce((a, b) => a + b, 0) || 1;
  return Array.from(ac.entries())
    .map(([name, value], i) => ({
      name, value,
      fill: _pieFillColor(i, palette),
      pct: _pieValuePct(value, total),
    }))
    .sort((a, b) => b.value - a.value);
}
function _plantillaBuildOutputs(
  rows: PlantillaInputRow[],
  acc: _PlantillaAccumulated,
  palette: readonly string[],
): { contrato: PlantillaPieRow[]; jornada: PlantillaPieRow[]; summary: PlantillaSummary; tableRows: PlantillaInputRow[] } {
  const deptos = new Set(rows.map(r => r.departamento).filter(Boolean)).size;
  const tableRows = [...rows]
    .sort((a, b) => Number(b.num_empleados || 0) - Number(a.num_empleados || 0))
    .slice(0, 12);
  const summary: PlantillaSummary = {
    headcount: acc.headcount,
    deptos,
    perfiles: rows.length,
    antiguedadProm: acc.antWCount ? acc.antW / acc.antWCount : 0,
    sdiProm: acc.sdiW ? acc.sdiSum / acc.sdiW : 0,
  };
  return {
    contrato: _plantillaToPieChart(acc.contratoAcc, palette),
    jornada: _plantillaToPieChart(acc.jornadaAcc, palette),
    summary,
    tableRows,
  };
}
export function aggregatePlantilla(rows: PlantillaInputRow[]) {
  const acc = _plantillaAccumulateFromRows(rows);
  const palette = RH_PALETTE.plantilla.contrato;
  return _plantillaBuildOutputs(rows, acc, palette);
}

// ============================================================
// EJE 5 · BENEFICIOS
// ============================================================
export type BeneficioKind = {
  codigo: '005' | '010' | '029' | '049';
  descripcion: string;
  tone: 'emerald' | 'blue' | 'amber' | 'violet';
};
export const BENEFICIOS_OFICIALES: BeneficioKind[] = [
  { codigo: '029', descripcion: 'Vales de Despensa',      tone: 'emerald' },
  { codigo: '005', descripcion: 'Fondo / Caja de Ahorro', tone: 'blue'    },
  { codigo: '010', descripcion: 'Premios de Puntualidad', tone: 'amber'   },
  { codigo: '049', descripcion: 'Premios de Asistencia',  tone: 'violet'  },
];
export const BENEFICIO_FILL: Record<string, string> = {
  '029': RH_PALETTE.beneficios.vales,
  '005': RH_PALETTE.beneficios.ahorro,
  '010': RH_PALETTE.beneficios.puntualidad,
  '049': RH_PALETTE.beneficios.asistencia,
};
export type BeneficiosInputRow = {
  departamento: string;
  mes_pago: Date | string;
  tipo_percepcion: string;
  descripcion_beneficio?: string;
  concepto: string;
  numero_aplicaciones: number;
  empleados_beneficiados: number;
  total_gravado: number;
  total_exento: number;
  importe_total: number;
};
export type BeneficioByTipo = {
  codigo: string; beneficio: string; importe: number;
  aplicaciones: number; empleados: number;
};
export type BeneficioByMes = {
  key: string; label: string;
  vales: number; ahorro: number; puntualidad: number; asistencia: number;
  empleados: number;
};
export type BeneficioDetailRow = {
  codigo: string; beneficio: string; concepto: string;
  apps: number; empleados: number; gravado: number; exento: number;
  total: number; fill: string;
};
export function aggregateBeneficios(rows: BeneficiosInputRow[]) {
  const acc = _beneficiosAccumulateTwoMaps(rows);
  return _beneficiosBuildChartsAndSummaries(acc);
}
const _BENEFICIO_KEYS_BY_MES: readonly ('vales' | 'ahorro' | 'puntualidad' | 'asistencia')[] = [
  'vales', 'ahorro', 'puntualidad', 'asistencia',
];
type _BeneficiosAccumulated = ReturnType<typeof _beneficiosAccumulateTwoMaps>;
function _beneficiosAccumulateTwoMaps(rows: BeneficiosInputRow[]) {
  const byMesAcc = new Map<string, {
    vales: number; ahorro: number; puntualidad: number; asistencia: number; empleados: number;
  }>();
  const byTipoAcc = new Map<string, {
    codigo: string; beneficio: string; importe: number; aplicaciones: number; empleados: number;
  }>();
  let totalImporte = 0, totalApps = 0;
  const maxEmpMes = 0;
  for (const r of rows) {
    const key = monthKey(r.mes_pago);
    const mes = byMesAcc.get(key) ?? { vales: 0, ahorro: 0, puntualidad: 0, asistencia: 0, empleados: 0 };
    const codigo = r.tipo_percepcion;
    const imp  = Number(r.importe_total || 0);
    const apps = Number(r.numero_aplicaciones || 0);
    const emps = Number(r.empleados_beneficiados || 0);
    totalImporte += imp; totalApps += apps;
    if (codigo === '029')      mes.vales += imp;
    else if (codigo === '005') mes.ahorro += imp;
    else if (codigo === '010') mes.puntualidad += imp;
    else if (codigo === '049') mes.asistencia += imp;
    mes.empleados = Math.max(mes.empleados, emps);
    byMesAcc.set(key, mes);
    const label = _beneficioLabelByCodigo(codigo, r.descripcion_beneficio);
    const p = byTipoAcc.get(codigo) ?? {
      codigo, beneficio: label, importe: 0, aplicaciones: 0, empleados: 0,
    };
    p.importe += imp; p.aplicaciones += apps;
    p.empleados = Math.max(p.empleados, emps);
    byTipoAcc.set(codigo, p);
  }
  return { byMesAcc, byTipoAcc, totalImporte, totalApps, maxEmpMes };
}
function _beneficiosBuildChartsAndSummaries(acc: _BeneficiosAccumulated) {
  const { byMesAcc, byTipoAcc, totalImporte, totalApps } = acc;
  let { maxEmpMes } = acc;
  const byMes: BeneficioByMes[] = Array.from(byMesAcc.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(entry => {
      const [, v] = entry;
      maxEmpMes = Math.max(maxEmpMes, v.empleados);
      return _withYmLabel(entry);
    });
  const byTipo: BeneficioByTipo[] = Array.from(byTipoAcc.values())
    .sort((a, b) => b.importe - a.importe);
  const { first: firstByMes } = _firstHalf(byMes);
  const monthSum = (arr: BeneficioByMes[]) =>
    arr.reduce((a, m) => a + _sumRowKeys(m, _BENEFICIO_KEYS_BY_MES), 0);
  const summary = {
    importe: totalImporte, aplicaciones: totalApps,
    empleados: maxEmpMes, headcount: maxEmpMes,
    coberturaPct: maxEmpMes > 0 ? Math.min(100, (maxEmpMes / maxEmpMes) * 100) : 0,
  };
  const previous = { importe: monthSum(firstByMes) };
  return { byTipo, byMes, summary, previous };
}
export function beneficioDetailRows(rows: BeneficiosInputRow[]): BeneficioDetailRow[] {
  return rows
    .map(r => {
      const codigo = r.tipo_percepcion;
      return {
        codigo,
        beneficio: _beneficioLabelByCodigo(codigo, r.descripcion_beneficio),
        concepto: r.concepto || r.descripcion_beneficio || '(sin concepto)',
        apps: Number(r.numero_aplicaciones || 0),
        empleados: Number(r.empleados_beneficiados || 0),
        gravado: Number(r.total_gravado || 0),
        exento:  Number(r.total_exento || 0),
        total:   Number(r.importe_total || 0),
        fill: BENEFICIO_FILL[codigo] ?? '#94a3b8',
      };
    })
    .sort((a, b) => b.total - a.total);
}

// ============================================================
// src/app/dashboard/direccion/_components/_internal-desviacion-client.tsx
//
// Client: Table sticky thead + filas coloreadas por status badge.
//
// Paquete 3 SonarQube Fixes:
//   · #1 Refactor fun >100 lines → 5 helpers SRP (<15 lines each)
//   · #2-10 Extract 9 nested ternaries → helpers nombrados
// ============================================================
'use client';

import { memo } from 'react';
import type { DireccionBudgetRow } from '@/lib/direccion-analytics-service';
import {
  StatusDesviacionBadge,
} from './direccion-shared';
import { fmtMxnFull, fmtPct } from '@/lib/direccion-formatters';

type RowClient = Readonly<{
  departamento: string;
  presupuesto_autorizado: number | null;
  costo_real_ejecutado: number;
  desviacion_abs: number;
  desviacion_pct: number;
  status_badge: DireccionBudgetRow['status_badge'];
}>;

// ============================================================================
// HELPERS NOMBRADOS (Paquete 3 · sonarqube extract nested ternaries)
// ============================================================================

function normalizeOneRow(r: DireccionBudgetRow): RowClient {
  return {
    departamento: String(r.departamento ?? ''),
    presupuesto_autorizado: r.presupuesto_autorizado === null ? null : Number(r.presupuesto_autorizado ?? 0),
    costo_real_ejecutado: Number(r.costo_real_ejecutado ?? 0),
    desviacion_abs: Number(r.desviacion_abs ?? 0),
    desviacion_pct: Number(r.desviacion_pct ?? 0),
    status_badge: r.status_badge,
  };
}

function normalizeRowsBudget(rows: readonly DireccionBudgetRow[]): readonly RowClient[] {
  return rows.map(normalizeOneRow);
}

function rowBgClassForStatus(r: RowClient, index: number): string {
  if (r.status_badge === 'FUERA_DE_PRESUPUESTO') return 'bg-rose-50/70 hover:bg-rose-50';
  if (r.status_badge === 'ATENCION')           return 'bg-amber-50/50 hover:bg-amber-50/70';
  return index % 2 === 0 ? 'bg-white hover:bg-slate-50/60' : 'bg-slate-50/40 hover:bg-slate-50/80';
}

function absClass(r: RowClient): string {
  if (r.status_badge === 'SIN_PRESUPUESTO') return 'text-slate-400 italic';
  if (r.desviacion_abs > 0) return 'text-rose-600';
  if (r.desviacion_abs < 0) return 'text-emerald-600';
  return 'text-slate-600';
}

function pctClass(r: RowClient): string {
  if (r.status_badge === 'SIN_PRESUPUESTO') return 'text-slate-400 italic';
  if (r.desviacion_pct > 0.10) return 'text-rose-600';
  if (r.desviacion_pct > 0.05) return 'text-amber-600';
  if (r.desviacion_pct < -0.05) return 'text-emerald-600';
  return 'text-slate-600';
}

function absDisplay(r: RowClient): string {
  if (r.status_badge === 'SIN_PRESUPUESTO') return '—';
  return `${r.desviacion_abs >= 0 ? '+' : ''}${fmtMxnFull(r.desviacion_abs)}`;
}

function pctDisplay(r: RowClient): string {
  if (r.status_badge === 'SIN_PRESUPUESTO') return '—';
  return `${r.desviacion_pct >= 0 ? '+' : ''}${fmtPct(r.desviacion_pct, 1)}`;
}

// ============================================================================
// SUB-COMPONENTES (Paquete 3 · Extract nested JSX)
// ============================================================================

function DesviacionTableHead() {
  const th =
    'h-10 px-4 align-middle text-[11px] uppercase tracking-wider font-semibold text-slate-600 whitespace-nowrap';
  return (
    <thead className="bg-slate-50 sticky top-0 z-10">
      <tr className="border-b border-slate-200">
        <th className={`text-left ${th}`}>Departamento</th>
        <th className={`text-right ${th}`}>Presupuesto</th>
        <th className={`text-right ${th}`}>Costo Real</th>
        <th className={`text-right ${th}`}>Desviación Abs</th>
        <th className={`text-right ${th}`}>Desviación %</th>
        <th className={`text-left ${th}`}>Estado</th>
      </tr>
    </thead>
  );
}

function DesviacionOneRow({ r, index }: Readonly<{ r: RowClient; index: number }>) {
  return (
    <tr
      key={r.departamento + '_' + index}
      className={`border-b border-slate-100 transition-colors ${rowBgClassForStatus(r, index)}`}
    >
      <td className="p-3 align-middle font-medium text-slate-800 whitespace-nowrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-300 shrink-0" />
          <span className="truncate">{r.departamento}</span>
        </div>
      </td>
      <td className="p-3 align-middle text-right tabular-nums text-slate-600 font-medium whitespace-nowrap">
        {r.presupuesto_autorizado === null ? (
          <span className="text-slate-400 italic">—</span>
        ) : (
          fmtMxnFull(r.presupuesto_autorizado)
        )}
      </td>
      <td className="p-3 align-middle text-right tabular-nums font-semibold text-slate-800 whitespace-nowrap">
        {fmtMxnFull(r.costo_real_ejecutado)}
      </td>
      <td className={`p-3 align-middle text-right tabular-nums font-semibold whitespace-nowrap ${absClass(r)}`}>
        {absDisplay(r)}
      </td>
      <td className={`p-3 align-middle text-right tabular-nums font-bold whitespace-nowrap ${pctClass(r)}`}>
        {pctDisplay(r)}
      </td>
      <td className="p-3 align-middle whitespace-nowrap">
        <StatusDesviacionBadge status={r.status_badge} />
      </td>
    </tr>
  );
}

// ============================================================================
// ORQUESTADOR PRINCIPAL (SRP lineal < 40 lines cuerpo)
// ============================================================================

export const DireccionDesviacionTableClient = memo(function DireccionDesviacionTableClient({
  rows,
}: Readonly<{
  rows: readonly DireccionBudgetRow[];
}>) {
  const data = normalizeRowsBudget(rows);

  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
      <div className="w-full max-h-[420px] overflow-auto">
        <table className="w-full text-sm min-w-[820px]">
          <DesviacionTableHead />
          <tbody className="[&_tr:last-child]:border-0">
            {data.map((r, index) => (
              <DesviacionOneRow key={r.departamento + '_' + index} r={r} index={index} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ============================================================
// src/app/dashboard/rh/_components/rh-turnover.tsx
// Eje 1 · Turnover y Movimientos de Personal
//   - Líneas Altas / Bajas / Reingresos (LineChart)
//   - Barra de Empleados Activos (Área sombreada o segunda serie)
//   - Mini KPIs con badge de tendencia vs período anterior
// ============================================================
'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { Users } from 'lucide-react';

import {
  ChartCard, KpiCardRh, TrendBadge, fmtNum, RH_PALETTE, RhEmptyState,
} from './rh-shared';

type RechartsFormatterSafe = (value: unknown, name: unknown) => [string | number, string] | string | number;

export type TurnoverInputRow = {
  departamento: string | null;
  mes_pago: Date | string;
  altas: number;
  bajas: number;
  reingresos: number;
  empleados_activos: number;
  total_recibos: number;
};

export function RhTurnoverPanel({
  rows,
}: {
  rows: TurnoverInputRow[];
}) {
  // Agregación mensual: si data viene por departamento, collapse por mes.
  const { chart, summary, previous } = useMemo(() => aggregate(rows), [rows]);

  if (!chart.length) {
    return (
      <ChartCard
        title="Turnover y Movimientos de Personal"
        subtitle="Altas · Bajas · Reingresos por periodo de nómina"
      >
        <RhEmptyState
          title="Sin movimientos de personal"
          message="No existen registros de nómina en el período seleccionado."
          hint="Amplía el rango de fechas o verifica que el ETL haya ingestado CFDIs de nómina."
          icon={<Users className="h-5 w-5"/>}
        />
      </ChartCard>
    );
  }

  const turnActivos = summary.empleados ? ((summary.bajas / summary.empleados) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCardRh
          title="Altas período"
          value={fmtNum(summary.altas, 0)}
          tone="emerald"
          icon={<Users className="h-4 w-4"/>}
          trend={<TrendBadge value={summary.altas} previous={previous.altas} />}
        />
        <KpiCardRh
          title="Bajas período"
          value={fmtNum(summary.bajas, 0)}
          tone="rose"
          icon={<Users className="h-4 w-4"/>}
          trend={<TrendBadge value={summary.bajas} previous={previous.bajas} mode="reversed" />}
        />
        <KpiCardRh
          title="Reingresos"
          value={fmtNum(summary.reingresos, 0)}
          tone="amber"
          icon={<Users className="h-4 w-4"/>}
          trend={<TrendBadge value={summary.reingresos} previous={previous.reingresos} />}
        />
        <KpiCardRh
          title="% Turnover"
          value={`${turnActivos.toFixed(2)}%`}
          subtext={`sobre ${fmtNum(summary.empleados,0)} empleados activos último mes`}
          tone={turnActivos > 8 ? 'rose' : turnActivos > 4 ? 'amber' : 'emerald'}
        />
      </div>

      <ChartCard
        title="Tendencia mensual"
        subtitle="Movimientos detectados por emisión/cese de UUIDs de nómina"
        badge={
          <span className="text-[10px] text-slate-500">
            {chart.length} meses · última actualización {format(new Date(), 'dd/MM/yy', { locale: es })}
          </span>
        }
        footer="Nota: los reingresos cuentan cuando el mismo RFC reaparece después de 60+ días sin nómina."
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={RH_PALETTE.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: RH_PALETTE.text }} />
            <YAxis tick={{ fontSize: 11, fill: RH_PALETTE.text }} allowDecimals={false} />
            <Tooltip
              labelFormatter={(v) => `Mes: ${v}`}
              formatter={((value: number, name: string) => [
                fmtNum(value, 0),
                name === 'altas' ? 'Altas' :
                name === 'bajas' ? 'Bajas' :
                name === 'reingresos' ? 'Reingresos' :
                name === 'activos' ? 'Empleados activos' : String(name),
              ]) as RechartsFormatterSafe}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone" dataKey="altas" name="Altas"
              stroke={RH_PALETTE.turnover.altas} strokeWidth={2.25}
              dot={{ r: 2.5 }} activeDot={{ r: 5 }}
            />
            <Line
              type="monotone" dataKey="bajas" name="Bajas"
              stroke={RH_PALETTE.turnover.bajas} strokeWidth={2.25}
              dot={{ r: 2.5 }} activeDot={{ r: 5 }}
            />
            <Line
              type="monotone" dataKey="reingresos" name="Reingresos"
              stroke={RH_PALETTE.turnover.reingresos} strokeWidth={2}
              strokeDasharray="5 4" dot={{ r: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ---------- Agregación y cálculo de período previo ----------
function aggregate(rows: TurnoverInputRow[]) {
  const byMonth = new Map<string, {
    altas: number; bajas: number; reingresos: number; activos: number;
  }>();
  for (const r of rows) {
    const d = typeof r.mes_pago === 'string' ? new Date(r.mes_pago) : r.mes_pago;
    const key = d.toISOString().slice(0, 7); // YYYY-MM
    const acc = byMonth.get(key) ?? { altas: 0, bajas: 0, reingresos: 0, activos: 0 };
    acc.altas      += Number(r.altas || 0);
    acc.bajas      += Number(r.bajas || 0);
    acc.reingresos += Number(r.reingresos || 0);
    acc.activos    =  Math.max(acc.activos, Number(r.empleados_activos || 0));
    byMonth.set(key, acc);
  }
  const sorted = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  const chart = sorted.map(([key, v]) => {
    const [y, m] = key.split('-').map(Number);
    return {
      key,
      label: format(new Date(y, (m || 1) - 1, 1), 'MMM yy', { locale: es }),
      altas: v.altas,
      bajas: v.bajas,
      reingresos: v.reingresos,
      activos: v.activos,
    };
  });

  const half = Math.max(1, Math.floor(chart.length / 2));
  const first  = chart.slice(0, half);
  const second = chart.slice(half);
  const sum = (arr: typeof chart, k: 'altas'|'bajas'|'reingresos') =>
    arr.reduce((a, c) => a + (c[k] || 0), 0);

  const summary = {
    altas:      sum(chart, 'altas'),
    bajas:      sum(chart, 'bajas'),
    reingresos: sum(chart, 'reingresos'),
    empleados:  chart.length ? (chart[chart.length - 1]?.activos || 0) : 0,
  };
  const previous = {
    altas:      sum(first, 'altas'),
    bajas:      sum(first, 'bajas'),
    reingresos: sum(first, 'reingresos'),
    // Para empleados usamos punto medio como referencia anterior
    empleados:  chart[half - 1]?.activos ?? 0,
  };
  void second;

  return { chart, summary, previous };
}

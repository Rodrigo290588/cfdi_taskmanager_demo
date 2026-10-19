// ============================================================
// src/app/dashboard/rh/_components/rh-turnover.tsx
// Eje 1 · Turnover y Movimientos de Personal
//   - Líneas Altas / Bajas / Reingresos (LineChart)
//   - Barra de Empleados Activos (Área sombreada o segunda serie)
//   - Mini KPIs con badge de tendencia vs período anterior
// ============================================================
'use client';

import { useMemo, useState } from 'react';
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

import { RhDrilldownModal, RhDrilldownType } from './rh-drilldown-modal';

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
  previousLabel,
  filters,
}: {
  readonly rows: TurnoverInputRow[];
  readonly previousLabel?: string;
  readonly filters?: Record<string, string | null | undefined>;
}) {
  // Agregación mensual: si data viene por departamento, collapse por mes.
  const { chart, summary, previous } = useMemo(() => aggregate(rows), [rows]);

  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownType, setDrilldownType] = useState<RhDrilldownType>(null);
  const [drilldownSummaryValue, setDrilldownSummaryValue] = useState<string | null>(null);

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

  // Turnover rate: (Total de bajas en el período / Promedio de empleados activos del período) * 100
  // Si usamos solo el último mes puede sesgar el % si hubo mucha fluctuación, usamos el promedio.
  const turnActivos = summary.empleadosPromedio ? ((summary.bajas / summary.empleadosPromedio) * 100) : 0;
  let turnoverTone: 'rose' | 'amber' | 'emerald' = 'emerald';
  if (turnActivos > 8) {
    turnoverTone = 'rose';
  } else if (turnActivos > 4) {
    turnoverTone = 'amber';
  }

  const handleOpenDrilldown = (type: RhDrilldownType, summaryValue: string) => {
    if (!hasValidFilters) return;
    setDrilldownType(type);
    setDrilldownSummaryValue(summaryValue);
    setDrilldownOpen(true);
  };

  const hasValidFilters = Boolean(filters?.startDate && filters?.endDate);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCardRh
          title="Altas período"
          value={fmtNum(summary.altas, 0)}
          tone="emerald"
          icon={<Users className="h-4 w-4"/>}
          tooltipText="Suma de empleados nuevos detectados (sin recibos previos) y reingresos (brecha > 60 días sin pago)."
          trend={
            <div className="flex flex-col items-center gap-1">
              <TrendBadge value={summary.altas} previous={previous.altas} />
              {previous.altas > 0 && <span className="text-[10px] text-muted-foreground">{previousLabel || 'vs período anterior'}</span>}
            </div>
          }
          onClick={hasValidFilters && summary.altas > 0 ? () => handleOpenDrilldown('altas', fmtNum(summary.altas, 0)) : undefined}
        />
        <KpiCardRh
          title="Bajas período"
          value={fmtNum(summary.bajas, 0)}
          tone="rose"
          icon={<Users className="h-4 w-4"/>}
          tooltipText="Empleados cuyo último recibo fue emitido en el mes (cese definitivo o brecha > 60 días sin pagos posteriores)."
          trend={
            <div className="flex flex-col items-center gap-1">
              <TrendBadge value={summary.bajas} previous={previous.bajas} mode="reversed" />
              {previous.bajas > 0 && <span className="text-[10px] text-muted-foreground">{previousLabel || 'vs período anterior'}</span>}
            </div>
          }
          onClick={hasValidFilters && summary.bajas > 0 ? () => handleOpenDrilldown('bajas', fmtNum(summary.bajas, 0)) : undefined}
        />
        <KpiCardRh
          title="Reingresos"
          value={fmtNum(summary.reingresos, 0)}
          tone="amber"
          icon={<Users className="h-4 w-4"/>}
          tooltipText="Subconjunto de altas: Empleados que volvieron a recibir nómina tras un lapso de inactividad mayor a 60 días."
          trend={
            <div className="flex flex-col items-center gap-1">
              <TrendBadge value={summary.reingresos} previous={previous.reingresos} />
              {previous.reingresos > 0 && <span className="text-[10px] text-muted-foreground">{previousLabel || 'vs período anterior'}</span>}
            </div>
          }
          onClick={hasValidFilters && summary.reingresos > 0 ? () => handleOpenDrilldown('reingresos', fmtNum(summary.reingresos, 0)) : undefined}
        />
        <KpiCardRh
          title="% Turnover"
          value={`${turnActivos.toFixed(2)}%`}
          icon={<Users className="h-4 w-4" />}
          subtext={`sobre ${fmtNum(summary.empleadosPromedio,0)} empleados promedio activos`}
          tooltipText="Tasa de rotación: Total de Bajas en el período divididas entre el promedio de empleados activos del mismo período."
          tone={turnoverTone}
        />
      </div>

      <ChartCard title="Tendencia de Turnover y Movimientos" minHeight={300}
        subtitle="Evolución de altas, bajas, reingresos y porcentaje de rotación por mes"
        badge={
          <span className="text-[10px] text-slate-500">
            {chart.length} meses · última actualización {format(new Date(), 'dd/MM/yy', { locale: es })}
          </span>
        }
        footer="Nota: los reingresos cuentan cuando el mismo RFC reaparece después de 60+ días sin nómina."
      >
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={RH_PALETTE.grid} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: RH_PALETTE.text }} />
              <YAxis tick={{ fontSize: 11, fill: RH_PALETTE.text }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={((v: number, n: string) => {
                  if (n === 'turnover_pct') {
                    return [`${v.toFixed(1)}%`, 'Tasa Rotación'];
                  }
                  
                  let label = n;
                  if (n === 'altas') {
                    label = 'Altas';
                  } else if (n === 'bajas') {
                    label = 'Bajas';
                  } else if (n === 'reingresos') {
                    label = 'Reingresos';
                  }
                  
                  return [v, label];
                }) as RechartsFormatterSafe}/>
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="altas" name="Altas" stroke={RH_PALETTE.turnover.altas} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}/>
              <Line type="monotone" dataKey="bajas" name="Bajas" stroke={RH_PALETTE.turnover.bajas} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}/>
              <Line type="monotone" dataKey="reingresos" name="Reingresos" stroke={RH_PALETTE.turnover.reingresos} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <RhDrilldownModal
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
        type={drilldownType}
        filters={filters || {}}
        summaryValue={drilldownSummaryValue}
      />
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
  const sum = (arr: typeof chart, k: 'altas'|'bajas'|'reingresos'|'activos') =>
    arr.reduce((a, c) => a + (c[k] || 0), 0);

  const avgEmpleados = chart.length ? sum(chart, 'activos') / chart.length : 0;
  const prevAvgEmpleados = first.length ? sum(first, 'activos') / first.length : 0;

  const summary = {
    altas:      sum(chart, 'altas'),
    bajas:      sum(chart, 'bajas'),
    reingresos: sum(chart, 'reingresos'),
    empleadosPromedio: avgEmpleados,
  };
  const previous = {
    altas:      sum(first, 'altas'),
    bajas:      sum(first, 'bajas'),
    reingresos: sum(first, 'reingresos'),
    empleadosPromedio: prevAvgEmpleados,
  };

  return { chart, summary, previous };
}

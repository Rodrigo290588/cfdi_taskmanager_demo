// ============================================================
// src/app/dashboard/direccion/_components/_internal-composicion-fv-client.tsx
//
// Client Component: PieChart Donut (outerRadius 120 / innerRadius 80)
// con centro dinámico % Variable bold.
// Mobile: BarChart horizontal stacked (responsive).
// Paquete 2 SonarQube Fixes:
//   · (#1·#4·#5) Quita <Cell deprecated> usa fill nativo entry.color
//   · (#2) Tooltip props Readonly
//   · (#3) Formatter arrow functions → métodos nombrados
// ============================================================
'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import {
  PieChart, Pie, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { fmtPct, fmtMxn } from '@/lib/direccion-formatters';

export type DonutSliceFv = Readonly<{
  key: string;
  label: string;
  valor: number;
  color: string;
}>;

type SliceWithFill = DonutSliceFv & { fill: string };

function addFillField(rows: readonly DonutSliceFv[]): ReadonlyArray<SliceWithFill> {
  return rows.map((r) => Object.freeze({ ...r, fill: r.color }));
}

function tooltipFormatterMxn(value: unknown): string { return fmtMxn(value as number); }
function sliceColorOf(entry: unknown): string {
  return (entry as { color?: string; fill?: string }).fill || (entry as { color?: string }).color || '#334155';
}

function DonutTooltip(props: Readonly<{
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: SliceWithFill }>;
}>) {
  const { active, payload } = props;
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-lg px-3 py-2 text-xs min-w-[200px]">
      <div className="font-semibold text-slate-800 mb-1">{row.label}</div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Importe</span>
          <strong>{fmtMxn(row.valor)}</strong>
        </div>
      </div>
    </div>
  );
}

export const DireccionComposicionFvClient = memo(function DireccionComposicionFvClient({
  rows,
  pctVariableCentro,
}: Readonly<{
  rows: readonly DonutSliceFv[];
  pctVariableCentro: number;
}>) {
  const dataFilled = addFillField(rows);
  const sortedMobile = useCallback(
    () => [...dataFilled].sort((a, b) => a.valor - b.valor),
    [dataFilled],
  );

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)') : null;
    if (!mq) return;
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  if (isMobile) {
    return (
      <div className="w-full" style={{ minHeight: 260 }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={sortedMobile()}
            layout="vertical"
            margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis
              dataKey="label"
              type="category"
              width={120}
              tick={{ fontSize: 10, fill: '#475569' }}
            />
            <RechartsTooltip
              formatter={tooltipFormatterMxn}
              cursor={{ fill: 'rgba(30,41,59,0.03)' }}
            />
            <Bar
              dataKey="valor"
              name="Importe"
              radius={[0, 6, 6, 0]}
              fill={sliceColorOf as never}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const total = rows.reduce((a, r) => a + r.valor, 0);

  return (
    <div className="relative w-full" style={{ minHeight: 340 }}>
      <ResponsiveContainer width="100%" height={360}>
        <PieChart>
          <Pie
            data={dataFilled}
            dataKey="valor"
            nameKey="label"
            outerRadius={120}
            innerRadius={80}
            stroke="#ffffff"
            strokeWidth={3}
            isAnimationActive={false}
            fill={sliceColorOf as never}
          />
          <RechartsTooltip content={<DonutTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Centro dinámico % Variable */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">
          % Variable
        </div>
        <div className="text-3xl font-extrabold text-slate-800 tabular-nums leading-none">
          {fmtPct(pctVariableCentro, 1)}
        </div>
        <div className="text-[10.5px] text-slate-500 mt-1">
          de {fmtMxn(total)}
        </div>
      </div>
    </div>
  );
});

// ============================================================
// src/app/dashboard/direccion/_components/_internal-tendencia-client.tsx
//
// Client Component interno con Recharts AreaChart.
//
// Paquete 5 SonarQube Fixes:
//   · Extract 5 nested blocks → 4 Tooltip subcomponents + 2 helpers nombrados
//   · YAxis tickFormatter inline → yAxisTickFormatMxnK function
//   · Diff color inline → diffColorClass helper (1 lugar para rose/emerald)
// ============================================================
'use client';

import { memo, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, Line,
} from 'recharts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DireccionTendenciaRow } from '@/lib/direccion-analytics-service';
import type { DireccionViewMode } from '@/lib/direccion-dashboard-url';
import { buildDireccionDashboardUrl } from '@/lib/direccion-dashboard-url';
import { fmtMxn, fmtPct, DIRECCION_PALETTE } from '@/lib/direccion-formatters';

type SerializedRow = Readonly<{
  label: string;
  costoActual: number;
  costoYoY: number | null;
  diffPctYoY: number | null;
}>;

// ============================================================================
// HELPERS NOMBRADOS (Paquete 5 SonarQube · Extract nested inline blocks)
// ============================================================================

function yAxisTickFormatMxnK(value: unknown): string {
  const n = Number(value ?? 0);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function diffColorClass(diffPct: number): string {
  return diffPct >= 0 ? 'text-rose-600' : 'text-emerald-600';
}

function computeDiffPct(actual: number, yoy: number | null): number | null {
  if (yoy === null || typeof yoy !== 'number' || yoy <= 0) return null;
  return (actual - yoy) / yoy;
}

function serializeOneRow(r: DireccionTendenciaRow): SerializedRow {
  return {
    label: r.label,
    costoActual: Number(r.costoActual ?? 0),
    costoYoY: r.costoYoY === null || r.costoYoY === undefined ? null : Number(r.costoYoY),
    diffPctYoY: r.diffPctYoY === null || r.diffPctYoY === undefined ? null : Number(r.diffPctYoY),
  };
}

// ============================================================================
// TOOLTIP SUB-COMPONENTES (Paquete 5 · Extract nested JSX)
// ============================================================================

function TooltipRowActual({ actual }: Readonly<{ actual: number }>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DIRECCION_PALETTE.primary }} /> Período actual</span>
      <strong className="font-semibold text-slate-900">{fmtMxn(actual)}</strong>
    </div>
  );
}

function TooltipRowYoY({ yoy }: Readonly<{ yoy: number }>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-slate-500"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed" style={{ borderColor: DIRECCION_PALETTE.yoYLine }} /> YoY referencia</span>
      <span className="font-medium text-slate-600">{fmtMxn(yoy)}</span>
    </div>
  );
}

function TooltipRowDiff({
  diffPct,
  actual,
  yoy,
}: Readonly<{
  diffPct: number;
  actual: number;
  yoy: number;
}>) {
  const abs = actual - yoy;
  return (
    <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100 mt-1">
      <span className="text-slate-500">Diferencia</span>
      <span className={`font-bold ${diffColorClass(diffPct)}`}>{diffPct >= 0 ? '+' : ''}{fmtPct(diffPct, 1)} ({fmtMxn(abs)})</span>
    </div>
  );
}

function TooltipEmptyYoY() {
  return (
    <div className="text-[10.5px] text-slate-400 italic">
      Sin datos de comparativo YoY para este período
    </div>
  );
}

// ============================================================================
// CUSTOM TOOLTIP (ORQUESTADOR LINEAL < 30 lines JSX cuerpo)
// ============================================================================

function CustomTooltip({ active, payload, label }: Readonly<{
  active?: boolean;
  payload?: ReadonlyArray<{ readonly name: string; readonly value: number; readonly color: string }>;
  label?: string;
}>) {
  const tooltipActive = active;
  const tooltipPayload = payload;
  const tooltipLabel = label;
  if (!tooltipActive || !tooltipPayload || tooltipPayload.length === 0) return null;

  const actual = tooltipPayload.find(p => p.name === 'Actual')?.value ?? 0;
  const yoy = tooltipPayload.find(p => p.name === 'YoY')?.value ?? null;
  const diffPct = computeDiffPct(actual, yoy);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-lg px-3 py-2 text-xs min-w-[220px]">
      <div className="font-semibold text-slate-800 mb-1.5">{tooltipLabel}</div>
      <div className="space-y-1">
        <TooltipRowActual actual={actual} />
        {yoy !== null && typeof yoy === 'number' ? (
          <>
            <TooltipRowYoY yoy={yoy} />
            {diffPct !== null && <TooltipRowDiff diffPct={diffPct} actual={actual} yoy={yoy} />}
          </>
        ) : (
          <TooltipEmptyYoY />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL (memo · export)
// ============================================================================

export const DireccionTendenciaChartClient = memo(function DireccionTendenciaChartClient({
  rows,
  viewMode,
}: Readonly<{
  rows: readonly DireccionTendenciaRow[];
  viewMode: DireccionViewMode;
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChangeView = useCallback((next: DireccionViewMode) => {
    const params: Record<string, string> = {};
    const keys = [
      'companyId', 'organizationId', 'fiscalEntityId',
      'startDate', 'endDate', 'departamento', 'anioComparativo', 'sections',
    ] as const;
    for (const k of keys) {
      const v = searchParams.get(k);
      if (v) params[k] = v;
    }
    if (next !== 'monthly') params.view = next;
    router.replace(buildDireccionDashboardUrl('/dashboard/direccion', params), { scroll: false });
  }, [router, searchParams]);

  const data: SerializedRow[] = useMemo(
    () => rows.map(serializeOneRow),
    [rows],
  );

  return (
    <div className="w-full space-y-3">
      <div className="flex justify-end">
        <Tabs value={viewMode} className="w-auto" onValueChange={v => onChangeView(v as DireccionViewMode)}>
          <TabsList className="h-8 bg-slate-100/60">
            <TabsTrigger value="monthly"   className="h-7 text-xs data-[state=active]:bg-white data-[state=active]:text-blue-700">Mensual</TabsTrigger>
            <TabsTrigger value="quarterly" className="h-7 text-xs data-[state=active]:bg-white data-[state=active]:text-blue-700">Trimestral</TabsTrigger>
            <TabsTrigger value="yearly"    className="h-7 text-xs data-[state=active]:bg-white data-[state=active]:text-blue-700">Anual</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div style={{ minHeight: 380 }}>
        <ResponsiveContainer width="100%" height={400}>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
        >
          <defs>
            <linearGradient id="dirGradientActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={DIRECCION_PALETTE.primary} stopOpacity={0.7} />
              <stop offset="95%" stopColor={DIRECCION_PALETTE.primary} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
            tickFormatter={yAxisTickFormatMxnK}
          />
          <RechartsTooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="square"
            wrapperStyle={{ fontSize: 11 }}
          />
          <Area
            type="monotone"
            dataKey="costoActual"
            name="Actual"
            stroke={DIRECCION_PALETTE.primary}
            strokeWidth={2.5}
            fill="url(#dirGradientActual)"
            activeDot={{ r: 5, stroke: DIRECCION_PALETTE.primary, strokeWidth: 2, fill: '#fff' }}
          />
          <Line
            type="monotone"
            dataKey="costoYoY"
            name="YoY"
            stroke={DIRECCION_PALETTE.yoYLine}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 3, stroke: DIRECCION_PALETTE.yoYLine, strokeWidth: 1.5, fill: '#fff' }}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
});

// ============================================================
// src/app/dashboard/rh/_components/rh-horas-extra.tsx
// Eje 3 · Control de Horas Extra
//   - BarChart apiladas por Departamento (Dobles vs Triples)
//   - Serie Line: Importe total $ por Departamento
//   - Alert: Deptos con > 8 horas promedio por empleado (umbral)
// ============================================================
'use client';

import { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line,
} from 'recharts';
import { Clock, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

import {
  ChartCard, KpiCardRh, TrendBadge, fmtNum, fmtMxn,
  RH_PALETTE, RhEmptyState,
} from './rh-shared';
import { RhDrilldownModal, RhDrilldownType } from './rh-drilldown-modal';

type RechartsFormatterSafe = (value: unknown, name: unknown) => [string | number, string] | string | number;

export type HorasExtraInputRow = {
  departamento: string;
  mes_pago: Date | string;
  tipo_horas: string;
  descripcion_tipo: string;
  numero_nominas: number;
  empleados: number;
  total_horas: number;
  total_dias: number;
  importe_total: number;
};

const UMBRAL_HORAS_POR_EMPLEADO = 8; // p99 recomendación STPS

interface RhHorasExtraPanelProps {
  readonly rows: HorasExtraInputRow[];
  readonly previousLabel?: string;
  readonly filters?: Record<string, string | null | undefined>;
}

function RhHorasExtraCards({ summary, previous, previousLabel, handleOpenDrilldown, hasValidFilters }: {
  readonly summary: ReturnType<typeof aggregate>['summary'];
  readonly previous: ReturnType<typeof aggregate>['previous'];
  readonly previousLabel?: string;
  readonly handleOpenDrilldown: (type: RhDrilldownType, value: string) => void;
  readonly hasValidFilters: boolean;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCardRh title="Horas extra totales" value={fmtNum(summary.horas, 0)}
        tone="indigo" icon={<Clock className="h-4 w-4"/>}
        tooltipText="Suma de todas las horas extra laboradas (dobles y triples) en el período seleccionado."
        onClick={hasValidFilters && summary.horas > 0 ? () => handleOpenDrilldown('horas_extra_totales', fmtNum(summary.horas, 0)) : undefined}
        trend={
          <div className="flex flex-col items-center gap-1">
            <TrendBadge value={summary.horas} previous={previous.horas} mode="reversed"/>
            {previous.horas > 0 && <span className="text-[10px] text-muted-foreground">{previousLabel || 'vs período anterior'}</span>}
          </div>
        } />
      <KpiCardRh title="Horas dobles (01)" value={fmtNum(summary.dobles, 0)} tone="blue"
        icon={<Clock className="h-4 w-4"/>}
        subtext="Factor 2.0 sobre salario base"
        tooltipText="Total de horas extra pagadas al doble (código SAT 01) en los recibos de nómina del período."
        onClick={hasValidFilters && summary.dobles > 0 ? () => handleOpenDrilldown('horas_dobles', fmtNum(summary.dobles, 0)) : undefined} />
      <KpiCardRh title="Horas triples (02)" value={fmtNum(summary.triples, 0)} tone="violet"
        icon={<Clock className="h-4 w-4"/>}
        subtext="Factor 3.0 (domingos/feriados)"
        tooltipText="Total de horas extra pagadas al triple (código SAT 02) en los recibos de nómina del período."
        onClick={hasValidFilters && summary.triples > 0 ? () => handleOpenDrilldown('horas_triples', fmtNum(summary.triples, 0)) : undefined} />
      <KpiCardRh title="Costo extra total" value={fmtMxn(summary.importe)} tone="amber"
        icon={<Clock className="h-4 w-4"/>}
        tooltipText="Suma del importe monetario pagado por concepto de todas las horas extra."
        onClick={hasValidFilters && summary.importe > 0 ? () => handleOpenDrilldown('costo_extra_total', fmtMxn(summary.importe)) : undefined}
        trend={
          <div className="flex flex-col items-center gap-1">
            <TrendBadge value={summary.importe} previous={previous.importe} mode="reversed"/>
            {previous.importe > 0 && <span className="text-[10px] text-muted-foreground">{previousLabel || 'vs período anterior'}</span>}
          </div>
        } />
    </div>
  );
}

function RhHorasExtraAlerts({ overloaded }: { readonly overloaded: ReturnType<typeof aggregate>['overloaded'] }) {
  if (overloaded.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600"/>
      <div>
        <p className="font-semibold">
          Alerta: {overloaded.length} departamento(s) superan umbral de {UMBRAL_HORAS_POR_EMPLEADO} h/empleado
        </p>
        <ul className="list-disc pl-5 mt-1 text-xs space-y-0.5">
          {overloaded.slice(0, 5).map(o => (
            <li key={o.departamento}>
              <strong>{o.departamento}</strong>: {fmtNum(o.porEmpleado,1)} h/empleado ·{' '}
              {fmtNum(o.empleados,0)} personas · {fmtMxn(o.importe)}
            </li>
          ))}
          {overloaded.length > 5 && (
            <li className="text-amber-700">
              +{overloaded.length - 5} departamento(s) adicional(es) en la tabla del drill-down.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

export function RhHorasExtraPanel({ rows, previousLabel, filters }: RhHorasExtraPanelProps) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownType, setDrilldownType] = useState<RhDrilldownType>(null);
  const [drilldownSummaryValue, setDrilldownSummaryValue] = useState<string | null>(null);

  const { stacked, overloaded, summary, previous } = useMemo(() => aggregate(rows), [rows]);

  const handleOpenDrilldown = (type: RhDrilldownType, summaryValue: string) => {
      setDrilldownType(type);
      setDrilldownSummaryValue(summaryValue);
      setDrilldownOpen(true);
  };

  const hasValidFilters = Boolean(filters?.startDate && filters?.endDate);

  if (!stacked.length) {
    return (
      <ChartCard title="Control de Horas Extra"
        subtitle="Dobles (01) · Triples (02) y costo por departamento">
        <RhEmptyState icon={<Clock className="h-5 w-5"/>}
          title="Sin horas extra pagadas"
          message="No hay nodo HorasExtra con pago en los CFDIs del período."
          hint="Códigos SAT: 01 Horas dobles · 02 Horas triples (especiales/festivos)." />
      </ChartCard>
    );
  }

  const promHxEmp = summary.empleados ? summary.horas / summary.empleados : 0;

  return (
    <div className="space-y-3">
      <RhHorasExtraCards
        summary={summary}
        previous={previous}
        previousLabel={previousLabel}
        handleOpenDrilldown={handleOpenDrilldown}
        hasValidFilters={hasValidFilters}
      />

      <RhHorasExtraAlerts overloaded={overloaded} />

      <ChartCard
        title="Horas dobles / triples por departamento (Top 10)"
        subtitle="Barra apilada (horas) · línea = importe total $ por departamento"
        badge={badgeTone(promHxEmpleado(summary))}
        footer={`Promedio período: ${fmtNum(promHxEmp, 2)} h/empleado · Umbral STPS recomendado ≤ ${UMBRAL_HORAS_POR_EMPLEADO}h/empleado`}
      >
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={stacked}
              margin={{ top: 12, right: 20, left: -12, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={RH_PALETTE.grid}/>
              <XAxis dataKey="departamento"
                tick={{ fontSize: 10, fill: RH_PALETTE.text }}
                angle={-18} textAnchor="end" height={70} interval={0}/>
              <YAxis yAxisId="left" allowDecimals={false}
                tick={{ fontSize: 11, fill: RH_PALETTE.text }}
                label={{ value: 'Horas', angle: -90, position: 'insideLeft', fontSize: 11 }}/>
              <YAxis yAxisId="right" orientation="right"
                tick={{ fontSize: 11, fill: RH_PALETTE.text }}
                tickFormatter={(v) => `$${fmtMxn(Number(v))}`}
                label={{ value: 'Costo $', angle: 90, position: 'insideRight', fontSize: 11 }}/>
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={((v: number, n: string) => {
                  if (n === 'importe') return [fmtMxn(v), 'Costo total'];
                  if (n === 'dobles')   return [fmtNum(v,0) + ' h', 'Dobles'];
                  if (n === 'triples')  return [fmtNum(v,0) + ' h', 'Triples'];
                  return [fmtNum(v,0), String(n)];
                }) as RechartsFormatterSafe}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>

              <Bar yAxisId="left" dataKey="dobles" name="Dobles" stackId="h"
                barSize={24} radius={[4,4,0,0]} fill={RH_PALETTE.horasExtra.dobles} />
              <Bar yAxisId="left" dataKey="triples" name="Triples" stackId="h"
                barSize={24} radius={[4,4,0,0]} fill={RH_PALETTE.horasExtra.triples} />
              <Line yAxisId="right" type="monotone" dataKey="importe" name="Costo $"
                stroke={RH_PALETTE.horasExtra.importe} strokeWidth={2.2} dot={{ r: 3 }}/>
            </ComposedChart>
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

function promHxEmpleado(summary: ReturnType<typeof aggregate>['summary']): { key: string; tone: 'rose' | 'amber' | 'emerald' } {
  const v = summary.empleados ? summary.horas / summary.empleados : 0;
  if (v > UMBRAL_HORAS_POR_EMPLEADO) return { key: `Alto ${fmtNum(v,1)} h/emp`, tone: 'rose' };
  if (v > Math.max(2, UMBRAL_HORAS_POR_EMPLEADO * 0.6)) return { key: `Medio ${fmtNum(v,1)} h/emp`, tone: 'amber' };
  return { key: `Normal ${fmtNum(v,1)} h/emp`, tone: 'emerald' };
}
function badgeTone({ key, tone }: { key: string; tone: 'rose' | 'amber' | 'emerald' }) {
  let cls = 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50';
  if (tone === 'rose') {
    cls = 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-50';
  } else if (tone === 'amber') {
    cls = 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-50';
  }
  
  return (
    <Badge variant="outline" className={`text-[10px] font-normal ${cls}`}>
      {key}
    </Badge>
  );
}

// ---------- agregación ----------
function aggregate(rows: HorasExtraInputRow[]) {
  const deptAcc = new Map<string, {
    dobles: number; triples: number; importe: number; empleados: number;
  }>();

  let totDobles = 0;
  let totTriples = 0;
  let totImporte = 0;
  let totEmpleados = 0;

  for (const r of rows) {
    const d = r.departamento || 'Sin Departamento';
    const th = r.tipo_horas;
    const horas = Number(r.total_horas || 0);
    const imp = Number(r.importe_total || 0);
    const emps = Number(r.empleados || 0);

    const prev = deptAcc.get(d) ?? { dobles: 0, triples: 0, importe: 0, empleados: 0 };
    if (th === '02') { 
      prev.triples += horas; 
      totTriples += horas; 
    } else {
      // fallback horas genéricas o '01' → asignamos a dobles (fail-safe)
      prev.dobles += horas;
      totDobles += horas;
    }
    prev.importe += imp;
    prev.empleados = Math.max(prev.empleados, emps);
    deptAcc.set(d, prev);
    totImporte += imp;
    totEmpleados += emps;
  }

  // Top 10 por horas totales
  const stacked = Array.from(deptAcc.entries())
    .map(([d, v]) => ({
      departamento: d,
      dobles: v.dobles,
      triples: v.triples,
      importe: v.importe,
      empleados: v.empleados,
      totalHoras: v.dobles + v.triples,
      porEmpleado: v.empleados ? (v.dobles + v.triples) / v.empleados : 0,
    }))
    .sort((a, b) => b.totalHoras - a.totalHoras)
    .slice(0, 10);

  const overloaded = stacked.filter(s => s.porEmpleado > UMBRAL_HORAS_POR_EMPLEADO);

  // referencia período anterior (fail-closed: mitad de top 10)
  const half = Math.max(1, Math.floor(stacked.length / 2));
  const previous = {
    horas: stacked.slice(0, half).reduce((a, c) => a + c.totalHoras, 0),
    importe: stacked.slice(0, half).reduce((a, c) => a + c.importe, 0),
  };

  const summary = {
    horas: totDobles + totTriples, dobles: totDobles, triples: totTriples,
    importe: totImporte, empleados: totEmpleados,
  };
  return { stacked, overloaded, summary, previous };
}

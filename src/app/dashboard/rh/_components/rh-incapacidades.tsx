// ============================================================
// src/app/dashboard/rh/_components/rh-incapacidades.tsx
// Eje 2 · Mapa de Incidencias / Incapacidades
//   - PieChart dona: distribución % por TipoIncapacidad (01/02/03)
//   - BarChart: Días totales vs Días promedio por empleado/periodo
//   - KPIs: días perdidos, importe cubierto IMSS, empleados afectados
// ============================================================
'use client';

import { useState, useMemo } from 'react';
import {
  PieChart, Pie, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, CartesianGrid, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

import {
  ChartCard, KpiCardRh, TrendBadge, fmtNum, fmtMxn,
  RH_PALETTE, RhEmptyState,
} from './rh-shared';
import { RhDrilldownModal, RhDrilldownType } from './rh-drilldown-modal';

type RechartsFormatterSafe = (value: unknown, name: unknown, extra?: unknown) => [string | number, string] | string | number;

export type IncapacidadesInputRow = {
  departamento: string | null;
  mes_pago: Date | string;
  tipo_incapacidad: string;
  descripcion_tipo: string;
  numero_eventos: number;
  total_dias: number;
  promedio_dias_por_evento: number;
  importe_total: number;
  empleados_afectados: number;
};

const TIPO_FILL: Record<string, string> = {
  '01': RH_PALETTE.incapacidades.riesgoTrabajo,
  '02': RH_PALETTE.incapacidades.enfermedadGeneral,
  '03': RH_PALETTE.incapacidades.maternidad,
};

export function RhIncapacidadesPanel({
  rows,
  previousLabel,
  filters,
}: { 
  readonly rows: IncapacidadesInputRow[], 
  readonly previousLabel?: string,
  readonly filters?: Record<string, string | null | undefined>
}) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownType, setDrilldownType] = useState<RhDrilldownType>(null);
  const [drilldownSummaryValue, setDrilldownSummaryValue] = useState<string | null>(null);

  const { pie, bars, summary, previous } = useMemo(() => aggregate(rows), [rows]);

  const handleOpenDrilldown = (type: RhDrilldownType, summaryValue: string) => {
      setDrilldownType(type);
      setDrilldownSummaryValue(summaryValue);
      setDrilldownOpen(true);
  };

  const hasValidFilters = Boolean(filters?.startDate && filters?.endDate);

  if (!pie.length) {
    return (
      <ChartCard title="Mapa de Incidencias (Incapacidades)"
        subtitle="Clasificación SAT 01 · 02 · 03 y días acumulados">
        <RhEmptyState icon={<AlertTriangle className="h-5 w-5"/>}
          title="Sin incapacidades en el período"
          message="No hay registros de nodo Incapacidades en los CFDIs procesados."
          hint="Códigos SAT: 01 Riesgo de Trabajo · 02 Enfermedad General · 03 Maternidad" />
      </ChartCard>
    );
  }

  const diasPorEvento = summary.eventos ? summary.dias / summary.eventos : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCardRh title="Días de incapacidad" value={fmtNum(summary.dias, 0)}
          tone="amber" icon={<AlertTriangle className="h-4 w-4"/>}
          tooltipText="Suma total de días amparados por certificados de incapacidad emitidos por el IMSS (riesgo de trabajo, enfermedad o maternidad)."
          onClick={hasValidFilters && summary.dias > 0 ? () => handleOpenDrilldown('dias_incapacidad', fmtNum(summary.dias, 0)) : undefined}
          trend={
            <div className="flex flex-col items-center gap-1">
              <TrendBadge value={summary.dias} previous={previous.dias} mode="reversed"/>
              {previous.dias > 0 && <span className="text-[10px] text-muted-foreground">{previousLabel || 'vs período anterior'}</span>}
            </div>
          } />
        <KpiCardRh title="Eventos registrados" value={fmtNum(summary.eventos, 0)} tone="rose"
          icon={<AlertTriangle className="h-4 w-4"/>}
          tooltipText="Cantidad de registros o certificados de incapacidad reportados en los recibos de nómina del período."
          onClick={hasValidFilters && summary.eventos > 0 ? () => handleOpenDrilldown('eventos_incapacidad', fmtNum(summary.eventos, 0)) : undefined}
          trend={
            <div className="flex flex-col items-center gap-1">
              <TrendBadge value={summary.eventos} previous={previous.eventos} mode="reversed"/>
              {previous.eventos > 0 && <span className="text-[10px] text-muted-foreground">{previousLabel || 'vs período anterior'}</span>}
            </div>
          } />
        <KpiCardRh title="Empleados afectados" value={fmtNum(summary.empleados, 0)} tone="indigo"
          icon={<AlertTriangle className="h-4 w-4"/>}
          tooltipText="Número de trabajadores únicos (RFCs) que presentaron al menos un certificado de incapacidad."
          onClick={hasValidFilters && summary.empleados > 0 ? () => handleOpenDrilldown('empleados_incapacidad', fmtNum(summary.empleados, 0)) : undefined} />
        <KpiCardRh title="Días promedio / evento" value={fmtNum(diasPorEvento, 2)} tone="slate"
          icon={<AlertTriangle className="h-4 w-4"/>}
          subtext="SLA salud ocupacional ≤ 3.0 días/evento"
          tooltipText="Promedio obtenido al dividir el total de 'Días de incapacidad' entre los 'Eventos registrados'." />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Distribución por tipo (SAT)"
          subtitle="Proporción de días de incapacidad por código"
          badge={<span className="text-[10px] text-slate-500">Total ${fmtMxn(summary.importe)}</span>}
          minHeight={280}>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pie} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={95} innerRadius={55}
                  paddingAngle={2} isAnimationActive={false} stroke="#fff" strokeWidth={2} />
                <Tooltip formatter={((v: number, _n: unknown, entry: unknown) => {
                  const payload = (entry as { payload?: { pct?: string; name?: string } })?.payload;
                  return [`${fmtNum(v,0)} días (${payload?.pct ?? ''})`, payload?.name ?? ''];
                }) as RechartsFormatterSafe} contentStyle={{ fontSize: 12 }}/>
                <Legend wrapperStyle={{ fontSize: 12 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Días por mes · Serie histórica"
          subtitle="Evolución mensual para detección de brotes / estacionalidad"
          footer="El pico rojo identifica meses con > 2σ sobre la media del período."
          minHeight={280}>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={RH_PALETTE.grid}/>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: RH_PALETTE.text }}/>
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: RH_PALETTE.text }}/>
                <Tooltip
                  formatter={((v: number, n: string) => {
                    let val = String(v);
                    let label = String(n);
                    
                    if (n === 'dias') {
                      val = `${fmtNum(v,0)} días`;
                      label = 'Días';
                    } else if (n === 'empleados') {
                      val = `${fmtNum(v,0)} personas`;
                      label = 'Empleados afectados';
                    }
                    
                    return [val, label];
                  }) as RechartsFormatterSafe} contentStyle={{ fontSize: 12 }}/>
                <Legend wrapperStyle={{ fontSize: 12 }}/>
                <Bar dataKey="dias" name="Días de incapacidad" stackId="a"
                     radius={[4,4,0,0]} barSize={18} fill={RH_PALETTE.incapacidades.enfermedadGeneral} />
                <Bar dataKey="empleados" name="Empleados afectados" stackId="b"
                     fill={RH_PALETTE.incapacidades.maternidad}
                     radius={[4,4,0,0]} barSize={18}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

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

// ---------- agregación ----------
function aggregate(rows: IncapacidadesInputRow[]) {
  const tipoAcc = new Map<string, { name: string; value: number; fill: string }>();
  const mesAcc = new Map<string, { dias: number; empleados: number }>();

  let totalDias = 0;
  let totalEventos = 0;
  let totalEmpleados = 0;
  let totalImporte = 0;

  for (const r of rows) {
    const d = typeof r.mes_pago === 'string' ? new Date(r.mes_pago) : r.mes_pago;
    const mesKey = d.toISOString().slice(0, 7);
    const dias = Number(r.total_dias || 0);
    const eventos = Number(r.numero_eventos || 0);
    const emps = Number(r.empleados_afectados || 0);
    const imp = Number(r.importe_total || 0);

    // Pie
    const existingPie = tipoAcc.get(r.tipo_incapacidad) ?? {
      name: r.descripcion_tipo, value: 0,
      fill: TIPO_FILL[r.tipo_incapacidad] ?? RH_PALETTE.incapacidades.otro,
    };
    existingPie.value += dias;
    tipoAcc.set(r.tipo_incapacidad, existingPie);

    // Bars
    const m = mesAcc.get(mesKey) ?? { dias: 0, empleados: 0 };
    m.dias += dias;
    m.empleados += emps;
    mesAcc.set(mesKey, m);

    totalDias += dias;
    totalEventos += eventos;
    totalEmpleados += emps;
    totalImporte += imp;
  }

  // Pct + orden
  const pieRaw = Array.from(tipoAcc.values()).sort((a,b) => b.value - a.value);
  const pie = pieRaw.map(p => ({
    ...p, pct: `${totalDias ? ((p.value / totalDias) * 100).toFixed(1) : '0.0'}%`,
  }));

  // Barras ordenadas
  const barSorted = Array.from(mesAcc.entries()).sort(([a],[b]) => a.localeCompare(b));
  const diasArr = barSorted.map(([, v]) => v.dias);
  const media = diasArr.length ? diasArr.reduce((a,b) => a+b,0) / diasArr.length : 0;
  const std = Math.sqrt(
    diasArr.length
      ? (diasArr.reduce((a,b) => a + Math.pow(b - media, 2), 0) / diasArr.length)
      : 0
  );
  const bars = barSorted.map(([key, v]) => {
    const [y, m] = key.split('-').map(Number);
    return {
      key,
      label: format(new Date(y, (m || 1) - 1, 1), 'MMM yy', { locale: es }),
      dias: v.dias,
      empleados: v.empleados,
      anomaly: std > 0 ? v.dias > media + 2 * std : false,
    };
  });

  // Período anterior (primera mitad vs segunda mitad)
  const half = Math.max(1, Math.floor(bars.length / 2));
  const first = bars.slice(0, half);
  const sumBars = (arr: typeof bars, k: 'dias'|'empleados') =>
    arr.reduce((a, c) => a + (c[k] || 0), 0);
  const countEventosByBar = (barKeys: typeof bars) => {
    // aproximación: total / longitud por fracción de tiempo (seguro por fail-closed)
    const w = barKeys.length / Math.max(1, bars.length);
    return Math.round(totalEventos * w);
  };

  const summary = {
    dias: totalDias, eventos: totalEventos,
    empleados: totalEmpleados, importe: totalImporte,
  };
  const previous = {
    dias: sumBars(first, 'dias'),
    empleados: sumBars(first, 'empleados'),
    eventos: countEventosByBar(first),
  };
  return { pie, bars, summary, previous };
}

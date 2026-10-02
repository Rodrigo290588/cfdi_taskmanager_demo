// ============================================================
// src/app/dashboard/rh/_components/rh-incapacidades.tsx
// Eje 2 · Mapa de Incidencias / Incapacidades
//   - PieChart dona: distribución % por TipoIncapacidad (01/02/03)
//   - BarChart: Días totales vs Días promedio por empleado/periodo
//   - KPIs: días perdidos, importe cubierto IMSS, empleados afectados
// ============================================================
'use client';

import { useMemo } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, CartesianGrid, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

import {
  ChartCard, KpiCardRh, TrendBadge, fmtNum, fmtMxn,
  RH_PALETTE, RhEmptyState,
} from './rh-shared';

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
}: { rows: IncapacidadesInputRow[] }) {
  const { pie, bars, summary, previous } = useMemo(() => aggregate(rows), [rows]);

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
          trend={<TrendBadge value={summary.dias} previous={previous.dias} mode="reversed"/>} />
        <KpiCardRh title="Eventos registrados" value={fmtNum(summary.eventos, 0)} tone="rose"
          trend={<TrendBadge value={summary.eventos} previous={previous.eventos} mode="reversed"/>} />
        <KpiCardRh title="Empleados afectados" value={fmtNum(summary.empleados, 0)} tone="indigo" />
        <KpiCardRh title="Días promedio / evento" value={fmtNum(diasPorEvento, 2)} tone="slate"
          subtext="SLA salud ocupacional ≤ 3.0 días/evento" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Distribución por tipo (SAT)"
          subtitle="Proporción de días de incapacidad por código"
          badge={<span className="text-[10px] text-slate-500">Total ${fmtMxn(summary.importe)}</span>}
          minHeight={280}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pie} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={95} innerRadius={55}
                paddingAngle={2} isAnimationActive={false}>
                {pie.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} stroke="#fff" strokeWidth={2}/>
                ))}
              </Pie>
              <Tooltip formatter={((v: number, _n: unknown, entry: unknown) => {
                const payload = (entry as { payload?: { pct?: string; name?: string } })?.payload;
                return [`${fmtNum(v,0)} días (${payload?.pct ?? ''})`, payload?.name ?? ''];
              }) as RechartsFormatterSafe} contentStyle={{ fontSize: 12 }}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Días por mes · Serie histórica"
          subtitle="Evolución mensual para detección de brotes / estacionalidad"
          footer="El pico rojo identifica meses con > 2σ sobre la media del período."
          minHeight={280}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={RH_PALETTE.grid}/>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: RH_PALETTE.text }}/>
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: RH_PALETTE.text }}/>
              <Tooltip
                formatter={((v: number, n: string) => [
                  n === 'dias' ? `${fmtNum(v,0)} días` :
                  n === 'empleados' ? `${fmtNum(v,0)} personas` : String(v),
                  n === 'dias' ? 'Días' :
                  n === 'empleados' ? 'Empleados afectados' : String(n),
                ]) as RechartsFormatterSafe} contentStyle={{ fontSize: 12 }}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>
              <Bar dataKey="dias" name="Días de incapacidad" stackId="a"
                   radius={[4,4,0,0]} barSize={18}>
                {bars.map((entry, idx) => (
                  <Cell key={idx} fill={entry.anomaly ? RH_PALETTE.incapacidades.riesgoTrabajo
                                                     : RH_PALETTE.incapacidades.enfermedadGeneral}/>
                ))}
              </Bar>
              <Bar dataKey="empleados" name="Empleados afectados" stackId="b"
                   fill={RH_PALETTE.incapacidades.maternidad}
                   radius={[4,4,0,0]} barSize={18}/>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
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
  const second = bars.slice(half);
  const sumBars = (arr: typeof bars, k: 'dias'|'empleados') =>
    arr.reduce((a, c) => a + (c[k] || 0), 0);
  const countEventosByBar = (barKeys: typeof bars) => {
    // aproximación: total / longitud por fracción de tiempo (seguro por fail-closed)
    const w = barKeys.length / Math.max(1, bars.length);
    return Math.round(totalEventos * w);
  };
  void second;

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

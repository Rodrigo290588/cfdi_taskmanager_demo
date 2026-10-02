// ============================================================
// src/app/dashboard/rh/_components/rh-plantilla.tsx
// Eje 4 · Distribución de Plantilla
//   - Donut: TipoContrato (Permanente · Eventual · Por Obra · Sindicalizado)
//   - Donut: TipoJornada (Diurna · Nocturna · Mixta · Reducida)
//   - KPI prominente: Antigüedad promedio calculada desde FechaInicioRelLaboral
//   - Tabla desglose Departamento × TipoContrato
// ============================================================
'use client';

import { useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Briefcase, Award, Calendar } from 'lucide-react';

import {
  ChartCard, KpiCardRh, fmtNum, RH_PALETTE, RhEmptyState,
} from './rh-shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type RechartsFormatterSafe = (value: unknown, name: unknown, extra?: unknown) => [string | number, string] | string | number;

export type PlantillaInputRow = {
  departamento: string;
  tipo_contrato: string;
  tipo_jornada: string;
  num_empleados: number;
  antiguedad_promedio_anios: number;
  sdi_promedio: number;
};

export function RhPlantillaPanel({ rows }: { rows: PlantillaInputRow[] }) {
  const { contrato, jornada, summary, tableRows } = useMemo(() => aggregate(rows), [rows]);

  if (!tableRows.length) {
    return (
      <ChartCard title="Distribución de Plantilla"
        subtitle="TipoContrato · TipoJornada · Antigüedad promedio">
        <RhEmptyState icon={<Briefcase className="h-5 w-5"/>}
          title="Sin perfil de plantilla"
          message="La vista mv_hr_plantilla_actual no devolvió registros para este período."
          hint="Verifica que el ETL haya refrescado la MV y que existan CFDIs de nómina en los últimos 90 días." />
      </ChartCard>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCardRh title="Headcount vigente" value={fmtNum(summary.headcount, 0)}
          tone="blue" icon={<Briefcase className="h-4 w-4"/>}
          subtext={`${summary.deptos} departamento(s) · ${summary.perfiles} perfil(es)`} />
        <KpiCardRh title="Antigüedad promedio"
          value={`${summary.antiguedadProm.toFixed(1)} años`}
          tone={summary.antiguedadProm > 3 ? 'emerald' : summary.antiguedadProm > 1 ? 'amber' : 'rose'}
          icon={<Award className="h-4 w-4"/>}
          subtext="Cálculo desde FechaInicioRelLaboral o antigüedad SAT" />
        <KpiCardRh title="SDI promedio"
          value={summary.sdiProm ? `$${Number(summary.sdiProm).toFixed(2)}` : '$0.00'}
          tone="violet" icon={<Calendar className="h-4 w-4"/>}
          subtext="Salario Diario Integrado (base IMSS)" />
        <KpiCardRh title="Tipos de contrato" value={contrato.length.toString()}
          tone="slate" icon={<Briefcase className="h-4 w-4"/>}
          subtext="Modalidades: permanente, eventual, obra, sindicalizado…" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ChartCard title="Distribución por Tipo de Contrato"
          subtitle="Clasificación del nodo Receptor/TipoContrato (SAT)"
          minHeight={280}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={contrato} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={95} innerRadius={60} paddingAngle={2}
                isAnimationActive={false}>
                {contrato.map((e, idx) => (
                  <Cell key={idx} fill={e.fill} stroke="#fff" strokeWidth={2}/>
                ))}
              </Pie>
              <Tooltip formatter={((v: number, _n: unknown, entry: unknown) => {
                const payload = (entry as { payload?: { pct?: string; name?: string } })?.payload;
                return [`${fmtNum(v,0)} personas (${payload?.pct ?? ''})`, payload?.name ?? ''];
              }) as RechartsFormatterSafe} contentStyle={{ fontSize: 12 }}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Distribución por Tipo de Jornada"
          subtitle="Clasificación del nodo Receptor/TipoJornada (SAT)"
          minHeight={280}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={jornada} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={95} innerRadius={60} paddingAngle={2}
                isAnimationActive={false}>
                {jornada.map((e, idx) => (
                  <Cell key={idx} fill={e.fill} stroke="#fff" strokeWidth={2}/>
                ))}
              </Pie>
              <Tooltip formatter={((v: number, _n: unknown, entry: unknown) => {
                const payload = (entry as { payload?: { pct?: string; name?: string } })?.payload;
                return [`${fmtNum(v,0)} personas (${payload?.pct ?? ''})`, payload?.name ?? ''];
              }) as RechartsFormatterSafe} contentStyle={{ fontSize: 12 }}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Desglose Departamento × Contrato × Jornada"
        subtitle="Detalle por perfil de nómina · Top 12 por headcount"
        footer="SDI = Salario Diario Integrado declarado en el CFDI de nómina."
        minHeight={320}>
        <div className="overflow-auto h-[320px] rounded-md border border-slate-100">
          <Table>
            <TableHeader className="sticky top-0 bg-slate-50 z-10">
              <TableRow className="hover:bg-slate-50">
                <TableHead className="text-xs font-semibold">Departamento</TableHead>
                <TableHead className="text-xs font-semibold">Tipo de contrato</TableHead>
                <TableHead className="text-xs font-semibold">Jornada</TableHead>
                <TableHead className="text-xs font-semibold text-right"># Empleados</TableHead>
                <TableHead className="text-xs font-semibold text-right">Antigüedad avg</TableHead>
                <TableHead className="text-xs font-semibold text-right">SDI avg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((r, i) => (
                <TableRow key={i} className="text-xs hover:bg-slate-50">
                  <TableCell className="font-medium">{r.departamento}</TableCell>
                  <TableCell>{r.tipo_contrato}</TableCell>
                  <TableCell>{r.tipo_jornada}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(r.num_empleados, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{`${Number(r.antiguedad_promedio_anios || 0).toFixed(1)} a`}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.sdi_promedio ? `$${Number(r.sdi_promedio).toFixed(2)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {tableRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-400 text-xs">
                    No hay datos de plantilla en el período seleccionado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
}

// ---------- agregación ----------
function aggregate(rows: PlantillaInputRow[]) {
  const contratoAcc = new Map<string, number>();
  const jornadaAcc  = new Map<string, number>();
  let headcount = 0;
  let sdiSum = 0;
  let sdiW = 0;
  let antW = 0;
  let antWCount = 0;

  for (const r of rows) {
    const num = Number(r.num_empleados || 0);
    headcount += num;
    const keyC = (r.tipo_contrato || 'Sin especificar').toString();
    const keyJ = (r.tipo_jornada  || 'Sin especificar').toString();
    contratoAcc.set(keyC, (contratoAcc.get(keyC) ?? 0) + num);
    jornadaAcc.set(keyJ,  (jornadaAcc.get(keyJ)  ?? 0) + num);

    const ant = Number(r.antiguedad_promedio_anios || 0);
    if (num > 0 && Number.isFinite(ant)) {
      antW += ant * num;
      antWCount += num;
    }
    const sdi = Number(r.sdi_promedio || 0);
    if (num > 0 && Number.isFinite(sdi)) {
      sdiSum += sdi * num;
      sdiW += num;
    }
  }

  const deptos = new Set(rows.map(r => r.departamento).filter(Boolean)).size;
  const palette = RH_PALETTE.plantilla.contrato;

  const toPie = (acc: Map<string, number>) => {
    const total = Array.from(acc.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(acc.entries())
      .map(([name, value], i) => ({
        name, value,
        fill: palette[i % palette.length] ?? RH_PALETTE.grid,
        pct: `${((value / total) * 100).toFixed(1)}%`,
      }))
      .sort((a, b) => b.value - a.value);
  };

  const tableRows = [...rows]
    .sort((a, b) => Number(b.num_empleados || 0) - Number(a.num_empleados || 0))
    .slice(0, 12);

  const summary = {
    headcount,
    deptos,
    perfiles: rows.length,
    antiguedadProm: antWCount ? antW / antWCount : 0,
    sdiProm: sdiW ? sdiSum / sdiW : 0,
  };

  return {
    contrato: toPie(contratoAcc),
    jornada:  toPie(jornadaAcc),
    summary,
    tableRows,
  };
}

// ============================================================
// src/app/dashboard/rh/_components/rh-plantilla.tsx
// Eje 4 · Distribución de Plantilla
//   - Donut: TipoContrato (Permanente · Eventual · Por Obra · Sindicalizado)
//   - Donut: TipoJornada (Diurna · Nocturna · Mixta · Reducida)
//   - KPI prominente: Antigüedad promedio calculada desde FechaInicioRelLaboral
//   - Tabla desglose Departamento × TipoContrato
// ============================================================
'use client';

import { useState, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Briefcase, Award, Calendar } from 'lucide-react';

import {
  ChartCard, KpiCardRh, fmtNum, RH_PALETTE, RhEmptyState,
} from './rh-shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RhDrilldownModal, RhDrilldownType } from './rh-drilldown-modal';

type RechartsFormatterSafe = (value: unknown, name: unknown, extra?: unknown) => [string | number, string] | string | number;

const TIPO_CONTRATO_CATALOG: Record<string, string> = {
  '01': '01 - Tiempo indeterminado',
  '02': '02 - Obra determinada',
  '03': '03 - Tiempo determinado',
  '04': '04 - Por temporada',
  '05': '05 - Sujeto a prueba',
  '06': '06 - Capacitación inicial',
  '07': '07 - Pago por hora laborada',
  '08': '08 - Comisión laboral',
  '09': '09 - Sin relación de trabajo',
  '10': '10 - Jubilación/pensión/retiro',
  '99': '99 - Otro contrato'
};

const TIPO_JORNADA_CATALOG: Record<string, string> = {
  '01': '01 - Diurna',
  '02': '02 - Nocturna',
  '03': '03 - Mixta',
  '04': '04 - Por horas',
  '05': '05 - Reducida',
  '06': '06 - Continuada',
  '07': '07 - Partida',
  '08': '08 - Por turnos',
  '99': '99 - Otra Jornada'
};

function formatContrato(code: string | null | undefined): string {
  if (!code) return 'Sin especificar';
  return TIPO_CONTRATO_CATALOG[code] || code;
}

function formatJornada(code: string | null | undefined): string {
  if (!code) return 'Sin especificar';
  return TIPO_JORNADA_CATALOG[code] || code;
}

export type PlantillaInputRow = {
  departamento: string;
  tipo_contrato: string;
  tipo_jornada: string;
  num_empleados: number;
  antiguedad_promedio_anios: number;
  sdi_promedio: number;
};

interface RhPlantillaPanelProps {
  readonly rows: PlantillaInputRow[];
  readonly filters?: Record<string, string | null | undefined>;
}

function getAntiguedadTone(antiguedadProm: number): "emerald" | "amber" | "rose" {
  if (antiguedadProm > 3) return "emerald";
  if (antiguedadProm > 1) return "amber";
  return "rose";
}

function getPlantillaCardsConfig(
  summary: ReturnType<typeof aggregate>['summary'],
  contrato: ReturnType<typeof aggregate>['contrato'],
  handleOpenDrilldown: (type: RhDrilldownType, value: string) => void,
  hasValidFilters: boolean
) {
  const { headcount, antiguedadProm, sdiProm, deptos, perfiles } = summary;
  
  const plantillaVal = fmtNum(headcount, 0);
  const antiguedadVal = `${antiguedadProm.toFixed(1)} años`;
  const sdiVal = sdiProm ? `$${Number(sdiProm).toFixed(2)}` : '$0.00';
  const contratoVal = contrato.length.toString();

  const handlePlantillaClick = () => handleOpenDrilldown('plantilla_vigente', plantillaVal);
  const handleAntiguedadClick = () => handleOpenDrilldown('antiguedad_promedio', antiguedadVal);
  const handleSdiClick = () => handleOpenDrilldown('sdi_promedio', sdiVal);
  const handleContratoClick = () => handleOpenDrilldown('tipos_contrato', contratoVal);

  return [
    {
      title: "Plantilla vigente",
      value: plantillaVal,
      tone: "blue" as const,
      icon: <Briefcase className="h-4 w-4" />,
      tooltipText: "Total de empleados únicos identificados en la última nómina disponible por cada combinación de departamento y perfil.",
      subtext: `${deptos} departamento(s) · ${perfiles} perfil(es)`,
      onClick: (hasValidFilters && headcount > 0) ? handlePlantillaClick : undefined,
    },
    {
      title: "Antigüedad promedio",
      value: antiguedadVal,
      tone: getAntiguedadTone(antiguedadProm),
      icon: <Award className="h-4 w-4" />,
      tooltipText: "Promedio de la antigüedad calculada desde la FechaInicioRelLaboral (hasta la fecha actual) o de la antigüedad reportada al SAT.",
      subtext: "Cálculo desde FechaInicioRelLaboral o antigüedad SAT",
      onClick: (hasValidFilters && antiguedadProm > 0) ? handleAntiguedadClick : undefined,
    },
    {
      title: "SDI promedio",
      value: sdiVal,
      tone: "violet" as const,
      icon: <Calendar className="h-4 w-4" />,
      tooltipText: "Se obtiene al tomar el Salario Diario Integrado de todos los XMLs emitidos multiplicándolo por la cantidad de personas que ganan ese salario para darle su peso justo, y finalmente dividiéndolo entre el total de tu headcount (plantilla) en ese periodo.",
      subtext: "Salario Diario Integrado (base IMSS)",
      onClick: (hasValidFilters && sdiProm > 0) ? handleSdiClick : undefined,
    },
    {
      title: "Tipos de contrato",
      value: contratoVal,
      tone: "slate" as const,
      icon: <Briefcase className="h-4 w-4" />,
      tooltipText: "Número de clasificaciones distintas de TipoContrato detectadas en la plantilla actual (permanente, eventual, etc.).",
      subtext: "Modalidades: permanente, eventual, obra, sindicalizado…",
      onClick: (hasValidFilters && contrato.length > 0) ? handleContratoClick : undefined,
    }
  ];
}

function RhPlantillaCards({ summary, contrato, handleOpenDrilldown, hasValidFilters }: {
  readonly summary: ReturnType<typeof aggregate>['summary'];
  readonly contrato: ReturnType<typeof aggregate>['contrato'];
  readonly handleOpenDrilldown: (type: RhDrilldownType, value: string) => void;
  readonly hasValidFilters: boolean;
}) {
  const cards = getPlantillaCardsConfig(summary, contrato, handleOpenDrilldown, hasValidFilters);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <KpiCardRh
          key={c.title}
          title={c.title}
          value={c.value}
          tone={c.tone}
          icon={c.icon}
          tooltipText={c.tooltipText}
          subtext={c.subtext}
          onClick={c.onClick}
        />
      ))}
    </div>
  );
}

function RhPlantillaPieCharts({ contrato, jornada }: {
  readonly contrato: ReturnType<typeof aggregate>['contrato'];
  readonly jornada: ReturnType<typeof aggregate>['jornada'];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <ChartCard title="Distribución por Tipo de Contrato"
        subtitle="Clasificación del nodo Receptor/TipoContrato (SAT)"
        minHeight={280}>
        <div className="h-[240px] w-full">
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
        </div>
      </ChartCard>

      <ChartCard title="Distribución por Tipo de Jornada"
        subtitle="Clasificación del nodo Receptor/TipoJornada (SAT)"
        minHeight={280}>
        <div className="h-[240px] w-full">
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
        </div>
      </ChartCard>
    </div>
  );
}

export function RhPlantillaPanel({ rows, filters }: RhPlantillaPanelProps) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownType, setDrilldownType] = useState<RhDrilldownType>(null);
  const [drilldownSummaryValue, setDrilldownSummaryValue] = useState<string | null>(null);

  const { contrato, jornada, summary, tableRows } = useMemo(() => aggregate(rows), [rows]);

  const handleOpenDrilldown = (type: RhDrilldownType, summaryValue: string) => {
      setDrilldownType(type);
      setDrilldownSummaryValue(summaryValue);
      setDrilldownOpen(true);
  };

  const hasValidFilters = Boolean(filters?.startDate && filters?.endDate);

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
      <RhPlantillaCards
        summary={summary}
        contrato={contrato}
        handleOpenDrilldown={handleOpenDrilldown}
        hasValidFilters={hasValidFilters}
      />

      <RhPlantillaPieCharts
        contrato={contrato}
        jornada={jornada}
      />

      <ChartCard title="Desglose Departamento × Contrato × Jornada"
        subtitle="Detalle por perfil de nómina · Top 12 por Plantilla"
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
                <TableHead className="text-xs font-semibold text-right">Antigüedad promedio</TableHead>
                <TableHead className="text-xs font-semibold text-right">SDI promedio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((r, i) => (
                <TableRow key={i} className="text-xs hover:bg-slate-50">
                  <TableCell className="font-medium">{r.departamento}</TableCell>
                  <TableCell>{formatContrato(r.tipo_contrato)}</TableCell>
                  <TableCell>{formatJornada(r.tipo_jornada)}</TableCell>
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
    const keyC = formatContrato(r.tipo_contrato);
    const keyJ = formatJornada(r.tipo_jornada);
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

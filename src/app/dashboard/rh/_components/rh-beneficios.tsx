// ============================================================
// src/app/dashboard/rh/_components/rh-beneficios.tsx
// Eje 5 · Beneficios y Prestaciones SAT
//   · 029 Vales de Despensa
//   · 005 Fondo / Caja de Ahorro
//   · 010 Premios de Puntualidad
//   · 049 Premios de Asistencia
//   ComposedChart: Barras (importe gravado vs exento) + Línea (empleados beneficiados)
// ============================================================
'use client';

import { useMemo } from 'react';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line, Cell,
} from 'recharts';
import { Gift } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

import {
  ChartCard, KpiCardRh, TrendBadge, fmtNum, fmtMxn,
  RH_PALETTE, RhEmptyState,
} from './rh-shared';

// Tipado seguro para callbacks Recharts Tooltip/Legend formatter
// (evita `as any` inline; Recharts 3.8 formatter signature es genérica)
type RechartsFormatterSafe = (value: unknown, name: unknown) => [string | number, string] | string | number;

export type BeneficiosInputRow = {
  departamento: string;
  mes_pago: Date | string;
  tipo_percepcion: string;
  descripcion_beneficio: string;
  concepto: string;
  numero_aplicaciones: number;
  empleados_beneficiados: number;
  total_gravado: number;
  total_exento: number;
  importe_total: number;
};

export type BeneficioKind = {
  codigo: '005' | '010' | '029' | '049';
  descripcion: string;
  tone: 'emerald' | 'blue' | 'amber' | 'violet';
};

const BENEFICIOS_OFICIALES: BeneficioKind[] = [
  { codigo: '029', descripcion: 'Vales de Despensa',            tone: 'emerald' },
  { codigo: '005', descripcion: 'Fondo / Caja de Ahorro',       tone: 'blue' },
  { codigo: '010', descripcion: 'Premios de Puntualidad',       tone: 'amber' },
  { codigo: '049', descripcion: 'Premios de Asistencia',        tone: 'violet' },
];

const FILL: Record<string, string> = {
  '029': RH_PALETTE.beneficios.vales,
  '005': RH_PALETTE.beneficios.ahorro,
  '010': RH_PALETTE.beneficios.puntualidad,
  '049': RH_PALETTE.beneficios.asistencia,
};

export function RhBeneficiosPanel({ rows }: { rows: BeneficiosInputRow[] }) {
  const { byTipo, byMes, summary, previous } = useMemo(() => aggregate(rows), [rows]);

  if (!byTipo.length) {
    return (
      <ChartCard title="Beneficios y Prestaciones"
        subtitle="Tipos SAT: 029 Vales · 005 Ahorro · 010 Puntualidad · 049 Asistencia">
        <RhEmptyState icon={<Gift className="h-5 w-5"/>}
          title="Sin percepciones catalogadas como beneficio"
          message="Los XML no contienen TipoPercepcion 005, 010, 029 ni 049 en el período."
          hint="El filtro de la MV se limita a estos 4 códigos SAT; si el CFDI usa otro código, no aparecerá aquí."/>
      </ChartCard>
    );
  }

  const kpis = BENEFICIOS_OFICIALES.map(k => ({
    ...k,
    valor: byTipo.find(b => b.codigo === k.codigo)?.importe || 0,
    empleados: byTipo.find(b => b.codigo === k.codigo)?.empleados || 0,
  }));
  const total = summary.importe;
  const cobertura = summary.headcount > 0
    ? Math.min(100, (summary.empleados / summary.headcount) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map(k => (
          <KpiCardRh key={k.codigo}
            title={k.descripcion}
            value={fmtMxn(k.valor)}
            tone={k.tone}
            icon={<Gift className="h-4 w-4"/>}
            subtext={k.empleados > 0 ? `${fmtNum(k.empleados, 0)} empleados` : 'Sin beneficiarios'}
          />
        ))}
        <KpiCardRh title="Inversión total período"
          value={fmtMxn(total)}
          tone="slate"
          subtext={`Cobertura ${fmtNum(cobertura,1)}% del headcount · ${fmtNum(summary.aplicaciones, 0)} percepciones`}
          trend={<TrendBadge value={summary.importe} previous={previous.importe}/>}
        />
      </div>

      <ChartCard
        title="Evolución mensual · Importe gravado vs exento"
        subtitle="Barras: $ por beneficio · Línea: empleados beneficiados por mes"
        badge={<Badge variant="outline" className="text-[10px] font-normal">Últimos {byMes.length} meses</Badge>}
        footer="IMPORTANTE: Montos gravados/exentos conforme a la Ley del ISR; verifica tu cédula de percepciones ante tu contador."
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={byMes} margin={{ top: 12, right: 20, left: -12, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={RH_PALETTE.grid}/>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: RH_PALETTE.text }}
              angle={-18} textAnchor="end" height={60}/>
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: RH_PALETTE.text }}
              tickFormatter={(v) => fmtMxn(Number(v), 0)}
              label={{ value: 'Monto $', angle: -90, position: 'insideLeft', fontSize: 11 }}/>
            <YAxis yAxisId="right" orientation="right" allowDecimals={false}
              tick={{ fontSize: 11, fill: RH_PALETTE.text }}
              label={{ value: '# Empleados', angle: 90, position: 'insideRight', fontSize: 11 }}/>
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={((v: number, n: string) => {
                if (n === 'empleados') return [fmtNum(v, 0), 'Empleados beneficiados'];
                return [fmtMxn(v), String(n)];
              }) as RechartsFormatterSafe}/>
            <Legend wrapperStyle={{ fontSize: 12 }}/>

            <Bar yAxisId="left" dataKey="vales" name="Vales (029)" stackId="a"
              radius={[4,4,0,0]} barSize={20}>
              {byMes.map((_, idx) => <Cell key={idx} fill={FILL['029']}/>)}
            </Bar>
            <Bar yAxisId="left" dataKey="ahorro" name="Ahorro (005)" stackId="a"
              radius={[4,4,0,0]} barSize={20}>
              {byMes.map((_, idx) => <Cell key={idx} fill={FILL['005']}/>)}
            </Bar>
            <Bar yAxisId="left" dataKey="puntualidad" name="Puntualidad (010)" stackId="a"
              radius={[4,4,0,0]} barSize={20}>
              {byMes.map((_, idx) => <Cell key={idx} fill={FILL['010']}/>)}
            </Bar>
            <Bar yAxisId="left" dataKey="asistencia" name="Asistencia (049)" stackId="a"
              radius={[4,4,0,0]} barSize={20}>
              {byMes.map((_, idx) => <Cell key={idx} fill={FILL['049']}/>)}
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="empleados" name="Empleados"
              stroke="#475569" strokeWidth={2.1} dot={{ r: 3 }}/>
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Detalle por concepto" minHeight={260}
        subtitle="Desglose de cada percepción catalogada como beneficio">
        <div className="overflow-auto h-[240px] rounded-md border border-slate-100 text-xs">
          <table className="w-full text-left">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Concepto</th>
                <th className="px-3 py-2 text-right"># apps</th>
                <th className="px-3 py-2 text-right">Empleados</th>
                <th className="px-3 py-2 text-right">Gravado</th>
                <th className="px-3 py-2 text-right">Exento</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {detailRows(rows).slice(0, 100).map((r, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5">
                    <Badge variant="outline"
                      className="text-[10px]"
                      style={{ background: r.fill + '22', color: r.fill, borderColor: r.fill }}>
                      {r.codigo} · {r.beneficio}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 truncate max-w-[240px]" title={r.concepto}>{r.concepto}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(r.apps, 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(r.empleados, 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{fmtMxn(r.gravado)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmtMxn(r.exento)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtMxn(r.total)}</td>
                </tr>
              ))}
              {detailRows(rows).length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-slate-400">Sin registros</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

// ---------- agregación ----------
function aggregate(rows: BeneficiosInputRow[]) {
  // headcount = max empleados beneficiados por mes (aproximación al total que recibe beneficios)
  const byMesAcc = new Map<string, {
    vales: number; ahorro: number; puntualidad: number; asistencia: number;
    empleados: number;
  }>();
  const byTipoAcc = new Map<string, {
    codigo: string; beneficio: string; importe: number; aplicaciones: number; empleados: number;
  }>();

  let totalImporte = 0;
  let totalApps = 0;
  let maxEmpleadosBeneficiadosMes = 0; // cobertura proxy

  for (const r of rows) {
    const d = typeof r.mes_pago === 'string' ? new Date(r.mes_pago) : r.mes_pago;
    const key = d.toISOString().slice(0, 7);
    const mes = byMesAcc.get(key) ?? { vales: 0, ahorro: 0, puntualidad: 0, asistencia: 0, empleados: 0 };

    const codigo = r.tipo_percepcion;
    const imp = Number(r.importe_total || 0);
    const apps = Number(r.numero_aplicaciones || 0);
    const emps = Number(r.empleados_beneficiados || 0);
    totalImporte += imp;
    totalApps += apps;

    if (codigo === '029') mes.vales += imp;
    else if (codigo === '005') mes.ahorro += imp;
    else if (codigo === '010') mes.puntualidad += imp;
    else if (codigo === '049') mes.asistencia += imp;
    // otros por TipoPercepcion permitido: ya filtrado en MV, safe no-op
    mes.empleados = Math.max(mes.empleados, emps);

    byMesAcc.set(key, mes);

    const kind = BENEFICIOS_OFICIALES.find(k => k.codigo === codigo);
    const label = kind?.descripcion ?? r.descripcion_beneficio ?? `Otro (${codigo})`;
    const prevTipo = byTipoAcc.get(codigo) ?? {
      codigo, beneficio: label, importe: 0, aplicaciones: 0, empleados: 0,
    };
    prevTipo.importe += imp;
    prevTipo.aplicaciones += apps;
    prevTipo.empleados = Math.max(prevTipo.empleados, emps);
    byTipoAcc.set(codigo, prevTipo);
  }

  const byMes = Array.from(byMesAcc.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => {
      const [y, m] = key.split('-').map(Number);
      maxEmpleadosBeneficiadosMes = Math.max(maxEmpleadosBeneficiadosMes, v.empleados);
      return {
        key,
        label: format(new Date(y, (m || 1) - 1, 1), 'MMM yy', { locale: es }),
        ...v,
      };
    });

  const byTipo = Array.from(byTipoAcc.values()).sort((a, b) => b.importe - a.importe);

  // período anterior (primera mitad vs segunda)
  const half = Math.max(1, Math.floor(byMes.length / 2));
  const first = byMes.slice(0, half);
  const second = byMes.slice(half);
  const monthSum = (arr: typeof byMes) =>
    arr.reduce((a, m) => a + m.vales + m.ahorro + m.puntualidad + m.asistencia, 0);
  void second;

  const summary = {
    importe: totalImporte,
    aplicaciones: totalApps,
    empleados: maxEmpleadosBeneficiadosMes,
    headcount: maxEmpleadosBeneficiadosMes, // simplificación (cobertura 100% si todos reciben ben)
  };
  const previous = { importe: monthSum(first) };

  return { byTipo, byMes, summary, previous };
}

function detailRows(rows: BeneficiosInputRow[]) {
  return rows
    .map(r => {
      const codigo = r.tipo_percepcion;
      const kind = BENEFICIOS_OFICIALES.find(k => k.codigo === codigo);
      return {
        codigo,
        beneficio: kind?.descripcion ?? r.descripcion_beneficio ?? `Otro (${codigo})`,
        concepto: r.concepto || r.descripcion_beneficio || '(sin concepto)',
        apps: Number(r.numero_aplicaciones || 0),
        empleados: Number(r.empleados_beneficiados || 0),
        gravado: Number(r.total_gravado || 0),
        exento: Number(r.total_exento || 0),
        total: Number(r.importe_total || 0),
        fill: FILL[codigo] ?? '#94a3b8',
      };
    })
    .sort((a, b) => b.total - a.total);
}

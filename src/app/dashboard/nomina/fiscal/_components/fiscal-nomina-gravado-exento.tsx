// ============================================================
// fiscal-nomina-gravado-exento.tsx · TASK 8
// BarChart Stacked · Gravado vs Exento por concepto SAT
// (001 Sueldos · 002 Aguinaldo · 003 PTU · 021 Prima Vacacional)
// ============================================================
'use client';

import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { ChartCard, fmtMxn, FISCAL_NOM_PALETTE } from './fiscal-nomina-shared';

export type GravadoExentoRow = {
    tipo: string;
    concepto: string;
    importeGravado: number;
    importeExento: number;
};

export function GravadoVsExentoChartSkeleton() {
    return (
        <ChartCard
            title="Gravado vs Exento · Conceptos SAT"
            subtitle="Por tipoPercepcion (Nómina 1.2)"
            minHeight={340}
        >
            <div className="w-full h-[300px] flex flex-col justify-end gap-3 p-2">
                <Skeleton className="h-[85%] w-full bg-slate-200/60 animate-pulse rounded" />
                <Skeleton className="h-4 w-full bg-slate-200/40 rounded animate-pulse" />
            </div>
        </ChartCard>
    );
}

export function GravadoVsExentoChart(props: { rows: GravadoExentoRow[] }) {
    const data = useMemo(() => props.rows.map(r => ({
        concepto: r.concepto,
        tipo: r.tipo,
        Gravado: Number(r.importeGravado || 0),
        Exento:  Number(r.importeExento || 0),
    })), [props.rows]);

    return (
        <ChartCard
            title="Gravado vs Exento · Conceptos SAT"
            subtitle="Por tipoPercepcion (001 · 002 · 003 · 021) — Anexo 8 Nómina 1.2"
            minHeight={340}
            footer={
                <span>
                    Lógica SAT: Percepciones con <code>tipoPercepcion</code> oficial. Tomadas de los atributos{' '}
                    <code className="mx-1">ImporteGravado</code> / <code>ImporteExento</code>.
                </span>
            }
        >
            <div className="w-full h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="concepto" tick={{ fontSize: 12 }} />
                        <YAxis
                            tickFormatter={(v) => fmtMxn(Number(v), 0)}
                            tick={{ fontSize: 11 }}
                            width={70}
                        />
                        <Tooltip
                            formatter={(value) => fmtMxn(Number(value))}
                            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                        />
                        <Legend verticalAlign="top" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                        <Bar
                            dataKey="Gravado"
                            stackId="a"
                            fill={FISCAL_NOM_PALETTE[4]}
                            name="Gravado"
                            radius={[0, 0, 0, 0]}
                        />
                        <Bar
                            dataKey="Exento"
                            stackId="a"
                            fill={FISCAL_NOM_PALETTE[5]}
                            name="Exento"
                            radius={[6, 6, 0, 0]}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    );
}

// ============================================================
// fiscal-nomina-deduc-terceros.tsx · TASK 9
// PieChart Donut · Deducciones Terceros:
//   010 INFONAVIT · 006 FONACOT · 007 Pensión · 001 Sindicato
// ============================================================
'use client';

import { useMemo } from 'react';
import {
    PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { ChartCard, fmtMxn, FISCAL_NOM_PALETTE } from './fiscal-nomina-shared';

export type DeducTerceroRow = {
    tipo: string;
    categoria: string;
    importe: number;
};

export function DeducTercerosDonutSkeleton() {
    return (
        <ChartCard title="Distribución Deducciones Terceros" subtitle="Agrupación tipoDeduccion SAT" minHeight={340}>
            <div className="w-full h-[300px] flex items-center justify-center">
                <div className="relative w-[260px] h-[260px]">
                    <div className="absolute inset-0 rounded-full border-[52px] border-slate-200/60 animate-pulse" />
                </div>
            </div>
        </ChartCard>
    );
}

export function DeducTercerosDonut(props: { rows: DeducTerceroRow[] }) {
    const data = useMemo(() => props.rows.map(r => ({
        tipo: r.tipo,
        categoria: r.categoria,
        importe: Number(r.importe || 0),
    })), [props.rows]);

    return (
        <ChartCard
            title="Distribución Deducciones Terceros"
            subtitle="Agrupación por tipoDeduccion SAT · 010/006/007/001"
            minHeight={340}
            footer={
                <span>
                    Lógica SAT: Deducciones de terceros reportadas en el complemento
                    <code className="mx-1">nomina12:Deducciones</code>. Cada TipoDeduccion
                    oficial del Anexo 8 de la Nómina 1.2.
                </span>
            }
        >
            <div className="w-full h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            dataKey="importe"
                            nameKey="categoria"
                            outerRadius={95}
                            innerRadius={60}
                            paddingAngle={3}
                        >
                            {data.map((_, i) => (
                                <Cell
                                    key={`cell-${i}`}
                                    fill={FISCAL_NOM_PALETTE[i % FISCAL_NOM_PALETTE.length]}
                                    stroke="#fff"
                                    strokeWidth={1.5}
                                />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(v) => fmtMxn(Number(v))}
                            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                        />
                        <Legend
                            layout="vertical"
                            align="right"
                            verticalAlign="middle"
                            wrapperStyle={{ fontSize: 12, paddingLeft: 16 }}
                            iconSize={10}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    );
}

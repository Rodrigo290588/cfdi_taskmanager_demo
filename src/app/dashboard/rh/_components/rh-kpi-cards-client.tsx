'use client';

import React, { useState } from 'react';
import { Users, TrendingUp, ArrowDownRight, Clock, Briefcase, Gift } from 'lucide-react';
import { KpiCardRh } from './rh-shared';
import { RhDrilldownModal, RhDrilldownType } from './rh-drilldown-modal';
import { fmtNum, fmtMxn } from '@/lib/rh-formatters';

interface RhKpiCardsClientProps {
    readonly filters: Record<string, string | null | undefined>;
    readonly empleadosPagados: number;
    readonly prevEmpleados: number;
    readonly totalPercepciones: number;
    readonly prevPercepciones: number;
    readonly totalDeducciones: number;
    readonly totalOtrosPagos: number;
    readonly totalDiasPagados: number;
    readonly costoPorEmpleado: number;
    readonly prevCosto: number;
    readonly previousLabel: string;
}

function getTrendDirection(current: number, previous: number): 'up' | 'down' | 'flat' {
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'flat';
}

function getTrendDelta(current: number, previous: number): string {
    if (!previous) return 'Sin datos previos';
    const percent = ((current - previous) / previous) * 100;
    const sign = current >= previous ? '+' : '';
    return `${sign}${fmtNum(percent, 1)}%`;
}

function getOnClickHandler(
    hasValidFilters: boolean,
    value: number,
    type: RhDrilldownType,
    formattedValue: string,
    handleOpenDrilldown: (t: RhDrilldownType, v: string) => void
) {
    if (!hasValidFilters || value <= 0) return undefined;
    return () => handleOpenDrilldown(type, formattedValue);
}

function getCardsData(props: RhKpiCardsClientProps, hasValidFilters: boolean, handleOpenDrilldown: (t: RhDrilldownType, v: string) => void) {
    return [
        {
            title: "Empleados Pagados",
            value: fmtNum(props.empleadosPagados, 0),
            tone: "emerald" as const,
            icon: <Users className="h-12 w-12 text-emerald-500" />,
            subtext: "Headcount período",
            tooltipText: "Máximo número de empleados únicos pagados en un solo mes dentro del período seleccionado.",
            trendDirection: getTrendDirection(props.empleadosPagados, props.prevEmpleados),
            trendDelta: getTrendDelta(props.empleadosPagados, props.prevEmpleados),
            trendLabel: props.previousLabel,
            onClick: getOnClickHandler(hasValidFilters, props.empleadosPagados, 'empleados_pagados', fmtNum(props.empleadosPagados, 0), handleOpenDrilldown)
        },
        {
            title: "Percepciones Totales",
            value: fmtMxn(props.totalPercepciones, 2),
            tone: "blue" as const,
            icon: <TrendingUp className="h-12 w-12 text-blue-500" />,
            tooltipText: "Suma total del atributo TotalPercepciones de todos los recibos de nómina en el período.",
            trendDirection: getTrendDirection(props.totalPercepciones, props.prevPercepciones),
            trendDelta: getTrendDelta(props.totalPercepciones, props.prevPercepciones),
            trendLabel: props.previousLabel,
            onClick: getOnClickHandler(hasValidFilters, props.totalPercepciones, 'percepciones_totales', fmtMxn(props.totalPercepciones, 2), handleOpenDrilldown)
        },
        {
            title: "Deducciones Totales",
            value: fmtMxn(props.totalDeducciones, 2),
            tone: "rose" as const,
            icon: <ArrowDownRight className="h-12 w-12 text-rose-500" />,
            tooltipText: "Suma total del atributo TotalDeducciones de todos los recibos de nómina en el período.",
            onClick: getOnClickHandler(hasValidFilters, props.totalDeducciones, 'deducciones_totales', fmtMxn(props.totalDeducciones, 2), handleOpenDrilldown)
        },
        {
            title: "Otros Pagos",
            value: fmtMxn(props.totalOtrosPagos, 2),
            tone: "amber" as const,
            icon: <Gift className="h-12 w-12 text-amber-500" />,
            tooltipText: "Suma total del atributo TotalOtrosPagos de todos los recibos de nómina en el período.",
            onClick: getOnClickHandler(hasValidFilters, props.totalOtrosPagos, 'otros_pagos', fmtMxn(props.totalOtrosPagos, 2), handleOpenDrilldown)
        },
        {
            title: "Días Pagados",
            value: fmtNum(props.totalDiasPagados, 0),
            tone: "indigo" as const,
            icon: <Clock className="h-12 w-12 text-indigo-500" />,
            tooltipText: "Suma total de los días pagados registrados en los comprobantes del período.",
            onClick: getOnClickHandler(hasValidFilters, props.totalDiasPagados, 'dias_pagados', fmtNum(props.totalDiasPagados, 0), handleOpenDrilldown)
        },
        {
            title: "Costo Prom. / Empleado",
            value: fmtMxn(props.costoPorEmpleado, 2),
            tone: "indigo" as const,
            icon: <Briefcase className="h-12 w-12 text-indigo-500" />,
            tooltipText: "Promedio de Percepciones Totales dividido entre la cantidad máxima de Empleados Pagados en el período.",
            trendDirection: getTrendDirection(props.costoPorEmpleado, props.prevCosto),
            trendDelta: getTrendDelta(props.costoPorEmpleado, props.prevCosto),
            trendLabel: props.previousLabel,
            onClick: getOnClickHandler(hasValidFilters, props.costoPorEmpleado, 'costo_promedio', fmtMxn(props.costoPorEmpleado, 2), handleOpenDrilldown)
        }
    ];
}

export function RhKpiCardsClient(props: RhKpiCardsClientProps) {
    const [drilldownOpen, setDrilldownOpen] = useState(false);
    const [drilldownType, setDrilldownType] = useState<RhDrilldownType>(null);
    const [drilldownSummaryValue, setDrilldownSummaryValue] = useState<string | null>(null);

    const handleOpenDrilldown = (type: RhDrilldownType, summaryValue: string) => {
        setDrilldownType(type);
        setDrilldownSummaryValue(summaryValue);
        setDrilldownOpen(true);
    };

    const hasValidFilters = Boolean(props.filters.startDate && props.filters.endDate);
    const cardsData = getCardsData(props, hasValidFilters, handleOpenDrilldown);

    return (
        <section>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
                {cardsData.map((card) => (
                    <KpiCardRh key={card.title} {...card} />
                ))}
            </div>

            <RhDrilldownModal
                open={drilldownOpen}
                onOpenChange={setDrilldownOpen}
                type={drilldownType}
                filters={props.filters}
                summaryValue={drilldownSummaryValue}
            />
        </section>
    );
}

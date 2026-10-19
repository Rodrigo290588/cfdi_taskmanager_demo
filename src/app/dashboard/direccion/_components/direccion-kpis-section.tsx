// ============================================================
// src/app/dashboard/direccion/_components/direccion-kpis-section.tsx
//
// Sección KPIs Ejecutivos (4 tarjetas C-Level).
// Es un Server Component async: se ejecuta DENTRO del límite
// Suspense del padre (direccion-server-page.tsx) por lo que
// su Skeleton se muestra mientras se resuelve.
//
// Llama al Analytics Service (Prisma MV) y pasa datos
// al Client Component KpiCardDireccion via props.
//
// Paquete 7.2 SonarQube Fixes:
//   · 4/4 warnings eliminados
//     1) KPI derivados 20 líneas inline → deriveKpiAggregates() helper
//     2) 4 tarjetas KPI inline → buildAllKpiCards() helper factory
//     3) DireccionFilterValues? props Readonly (no aplica, fixeado en 7.3)
//     4) Ambiguous spacing → objetos con 1 espacio estándar
// ============================================================

import {
  Landmark, UsersRound, PieChart, Target,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  fetchDireccionKpisAggregates,
  fetchDireccionPeriodoAnterior,
  type DireccionFetchScope,
  type DireccionKpiAggregates,
} from '@/lib/direccion-analytics-service';
import {
  KpiCardDireccion,
  TrendIndicatorBadge,
  DireccionEmptyState,
} from './direccion-shared';
import { fmtMxn, fmtPct } from '@/lib/direccion-formatters';

// ============================================================================
// TIPOS NOMBRADOS (Paquete 7.2 · Resultado helper derivados)
// ============================================================================

type KpiDerived = Readonly<{
  costoPromedio: number;
  costoPromedioAnt: number;
  pctVariable: number;
  pctVariableAnt: number;
  deltaCostoTotal: number | null;
  deltaPromedio: number | null;
  deltaVar: number | null;
  desviacionPct: number | null;
  totalEmpleados: number;
  totalRecibos: number;
}>;

type OneKpiCard = Readonly<{
  tone: 'blue' | 'slate' | 'amber' | 'emerald';
  title: string;
  value: string;
  icon: ReactNode;
  description: string;
  progressRatio: number | null;
  trend: ReactNode;
  tooltipText: string;
}>;

// ============================================================================
// HELPER 1 · deriveKpiAggregates (Paquete 7.2 · Extract 20 líneas inline L52-L74)
// ============================================================================

function deriveKpiAggregates(
  actual: DireccionKpiAggregates,
  anterior: DireccionKpiAggregates,
): KpiDerived {
  const costoPromedio = actual.empleadosUnicos > 0 ? actual.costoTotalNominaMxn / actual.empleadosUnicos : 0;
  const costoPromedioAnt = anterior.empleadosUnicos > 0 ? anterior.costoTotalNominaMxn / anterior.empleadosUnicos : 0;
  const totalFV = actual.costoFijo + actual.costoVariable;
  const pctVariable = totalFV > 0 ? actual.costoVariable / totalFV : 0;
  const totalFVAnt = anterior.costoFijo + anterior.costoVariable;
  const pctVariableAnt = totalFVAnt > 0 ? anterior.costoVariable / totalFVAnt : 0;
  const deltaCostoTotal = anterior.costoTotalNominaMxn > 0
    ? (actual.costoTotalNominaMxn - anterior.costoTotalNominaMxn) / anterior.costoTotalNominaMxn
    : null;
  const deltaPromedio = costoPromedioAnt > 0 ? (costoPromedio - costoPromedioAnt) / costoPromedioAnt : null;
  const deltaVar = pctVariableAnt > 0 ? (pctVariable - pctVariableAnt) / pctVariableAnt : null;
  return {
    costoPromedio,
    costoPromedioAnt,
    pctVariable,
    pctVariableAnt,
    deltaCostoTotal,
    deltaPromedio,
    deltaVar,
    desviacionPct: null,
    totalEmpleados: actual.empleadosUnicos,
    totalRecibos: actual.countRecibos,
  };
}

// ============================================================================
// HELPERS INDIVIDUALES · build KPI card (Paquete 7.2 · Extract 4 blocks inline)
// ============================================================================

function buildKpiCostoTotal(actual: DireccionKpiAggregates, d: KpiDerived, labelPrev: string): OneKpiCard {
  return {
    tone: 'blue',
    title: 'Costo Total Nómina',
    value: fmtMxn(actual.costoTotalNominaMxn),
    icon: <Landmark className="h-5 w-5" />,
    description: `Brutas ${fmtMxn(actual.percepcionesBrutas)} + Carga Patronal estimada ${fmtMxn(actual.cargaPatronalEstimada)} + ISN estatal ${fmtMxn(actual.isnEstimado)}.`,
    progressRatio: null,
    trend: (
      <TrendIndicatorBadge
        deltaPct={d.deltaCostoTotal}
        labelPrev={labelPrev}
        mode="default"
      />
    ),
    tooltipText: 'Suma de percepciones brutas, carga patronal estimada (IMSS, RCV, INFONAVIT) y el Impuesto Sobre Nómina (ISN) estatal calculado.',
  };
}

function buildKpiPromedioEmp(d: KpiDerived, labelPrev: string): OneKpiCard {
  const totalEmp = d.totalEmpleados.toLocaleString('es-MX');
  const totalRec = d.totalRecibos.toLocaleString('es-MX');
  return {
    tone: 'slate',
    title: 'Costo Promedio x Empleado',
    value: fmtMxn(d.costoPromedio),
    icon: <UsersRound className="h-5 w-5" />,
    description: `Plantilla ${totalEmp} empleados únicos (${totalRec} CFDIs en el período).`,
    progressRatio: null,
    trend: (
      <TrendIndicatorBadge
        deltaPct={d.deltaPromedio}
        labelPrev={labelPrev}
        mode="default"
      />
    ),
    tooltipText: 'Costo Total de la Nómina dividido entre el número de empleados únicos que recibieron al menos un recibo timbrado en el periodo.',
  };
}

function buildKpiPctVariable(actual: DireccionKpiAggregates, d: KpiDerived, labelPrev: string): OneKpiCard {
  return {
    tone: 'amber',
    title: '% Gasto Variable',
    value: fmtPct(d.pctVariable, 1),
    icon: <PieChart className="h-5 w-5" />,
    description: `Fijo ${fmtMxn(actual.costoFijo)} vs Variable ${fmtMxn(actual.costoVariable)}. Incluye Aguinaldo, PTU, Horas Extra, Prima Vac., Comisiones y Bonos.`,
    progressRatio: d.pctVariable,
    trend: (
      <TrendIndicatorBadge
        deltaPct={d.deltaVar}
        labelPrev={labelPrev}
        mode="default"
      />
    ),
    tooltipText: 'Proporción del gasto variable (Aguinaldo, PTU, Horas Extra, Prima Vacacional, Comisiones, Bonos) sobre el costo total bruto.',
  };
}

function buildKpiDesviacion(d: KpiDerived): OneKpiCard {
  return {
    tone: 'emerald',
    title: 'Desviación Presupuestal',
    value: d.desviacionPct === null ? 'N/D' : fmtPct(d.desviacionPct, 1),
    icon: <Target className="h-5 w-5" />,
    description: "Entidad BudgetDepartment aún no configurada (MVP). Se muestra 'Sin presupuesto' por departamento.",
    progressRatio: null,
    trend: (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
        <Target className="h-3.5 w-3.5" />
        Configurar presupuestos
      </span>
    ),
    tooltipText: 'Variación porcentual entre el costo total real de nómina y el presupuesto autorizado configurado por departamento.',
  };
}

// ============================================================================
// HELPER 2 · buildAllKpiCards (Paquete 7.2 · Factory 4 tarjetas)
// ============================================================================

function buildAllKpiCards(actual: DireccionKpiAggregates, d: KpiDerived, labelPrev: string): readonly OneKpiCard[] {
  return [
    buildKpiCostoTotal(actual, d, labelPrev),
    buildKpiPromedioEmp(d, labelPrev),
    buildKpiPctVariable(actual, d, labelPrev),
    buildKpiDesviacion(d),
  ] as const;
}

// ============================================================================
// HELPER 3 · Error EmptyState (Paquete 7.2 · Extract inline JSX try/catch)
// ============================================================================

function kpiErrorEmptyState(msg: string): ReactNode {
  const subtitle = msg.length < 80 ? msg : 'Error de conexión con la base de datos.';
  return (
    <DireccionEmptyState
      tone="rose"
      title="No fue posible cargar los KPIs"
      subtitle={subtitle}
      hint="Intenta nuevamente en unos segundos o contacta soporte si el problema persiste."
    />
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL (Paquete 7.2 · ORQUESTADOR < 25 líneas)
// ============================================================================

export async function DireccionKpisSection({
  scope,
}: Readonly<{ scope: DireccionFetchScope }>) {
  let actual, anterior;
  try {
    [actual, anterior] = await Promise.all([
      fetchDireccionKpisAggregates(scope),
      fetchDireccionPeriodoAnterior(scope),
    ]);
  } catch (err) {
    return kpiErrorEmptyState((err as Error)?.message ?? 'ERR_UNKNOWN');
  }

  const derived = deriveKpiAggregates(actual, anterior);
  const labelPrev = scope.anioComparativo ? `vs año ${scope.anioComparativo}` : 'período anterior';
  const cards = buildAllKpiCards(actual, derived, labelPrev);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <KpiCardDireccion
          key={card.title}
          tone={card.tone}
          title={card.title}
          value={card.value}
          icon={card.icon}
          description={card.description}
          progressRatio={card.progressRatio}
          trend={card.trend}
          tooltipText={card.tooltipText}
        />
      ))}
    </div>
  );
}

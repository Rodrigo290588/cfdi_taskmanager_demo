// ============================================================
// src/app/dashboard/direccion/_components/direccion-desviacion-presupuestal.tsx
//
// Tabla Desviación Presupuestal por Departamento:
//   • Columnas: Depto · Presupuesto Autorizado · Costo Real ·
//               Desviación Abs · Desviación % · Estado.
//   • Sticky thead (ScrollArea shadcn).
//   • Filas FUERA_DE_PRESUPUESTO bg-rose-50 sutil.
//   • Orden status severity → ABS desviación → costo.
//   • Alert shadcn si todas status = SIN_PRESUPUESTO (MVP).
//
// Wrapper Server async → pasa filas a Client Table.
//
// Paquete 6 SonarQube Fixes · Extract nested × 3:
//   · 3/3 nested blocks eliminados:
//     1) Lógica counts 4 status       → summarizeBudgetStatus() helper
//     2) Footer 4 badges + Real total → <DesviacionFooterSummary />
//     3) Ternarios err/empty/content → renderBodyContent() early returns
// ============================================================

import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Target } from 'lucide-react';
import {
  fetchDireccionDesviacionPresupuestal,
  type DireccionFetchScope,
  type DireccionBudgetRow,
} from '@/lib/direccion-analytics-service';
import {
  ChartCardDireccion,
  DireccionEmptyState,
} from './direccion-shared';
import { fmtMxn } from '@/lib/direccion-formatters';
import { DireccionDesviacionTableClient } from './_internal-desviacion-client';

// ============================================================================
// TIPOS NOMBRADOS (Paquete 6 · interfaces estables para helpers)
// ============================================================================

type BudgetStatusSummary = Readonly<{
  sinPresupuesto: number;
  enLinea: number;
  atencion: number;
  fuera: number;
  todosMVP: boolean;
  totalRows: number;
}>;

// ============================================================================
// HELPER 1 · summarizeBudgetStatus (Paquete 6 · 4 filters inline → 1 loop)
// ============================================================================

function summarizeBudgetStatus(rows: readonly DireccionBudgetRow[]): BudgetStatusSummary {
  let sinPresupuesto = 0;
  let enLinea = 0;
  let atencion = 0;
  let fuera = 0;
  for (const r of rows) {
    switch (r.status_badge) {
      case 'SIN_PRESUPUESTO':   sinPresupuesto += 1; break;
      case 'EN_LINEA':          enLinea        += 1; break;
      case 'ATENCION':          atencion       += 1; break;
      case 'FUERA_DE_PRESUPUESTO': fuera       += 1; break;
      default: break;
    }
  }
  const totalRows = rows.length;
  return {
    sinPresupuesto,
    enLinea,
    atencion,
    fuera,
    totalRows,
    todosMVP: totalRows > 0 && sinPresupuesto === totalRows,
  };
}

// ============================================================================
// HELPER 2 · costoRealTotal (Paquete 6 · reduce inline → helper nombrada)
// ============================================================================

function costoRealTotal(rows: readonly DireccionBudgetRow[]): number {
  let sum = 0;
  for (const r of rows) sum += Number(r.costo_real_ejecutado ?? 0);
  return sum;
}

// ============================================================================
// SUB-COMPONENTE 1 · DesviacionFooterSummary (Paquete 6 · Extraer nested footer L58-L92)
// ============================================================================

function DesviacionFooterSummary({
  rows,
  summary,
}: Readonly<{
  rows: readonly DireccionBudgetRow[];
  summary: BudgetStatusSummary;
}>) {
  if (summary.totalRows === 0) return undefined;
  const plural = summary.totalRows === 1 ? '' : 's';
  const real = costoRealTotal(rows);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-3">
        <span className="font-medium">{summary.totalRows} departamento{plural}</span>
        {summary.enLinea > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
            <Target className="h-3.5 w-3.5" /> {summary.enLinea} En línea
          </span>
        )}
        {summary.atencion > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
            <Target className="h-3.5 w-3.5" /> {summary.atencion} Atención
          </span>
        )}
        {summary.fuera > 0 && (
          <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
            <Target className="h-3.5 w-3.5" /> {summary.fuera} Fuera
          </span>
        )}
        {summary.todosMVP && (
          <span className="inline-flex items-center gap-1 text-slate-500 italic">
            {summary.sinPresupuesto} sin presupuesto (MVP)
          </span>
        )}
      </span>
      <span className="font-medium">
        Real total: <strong>{fmtMxn(real)}</strong>
      </span>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTE 2 · AlertaMVP SinPresupuesto (Paquete 6 · Extraer nested Alert)
// ============================================================================

function AlertaPresupuestosNoConfigurados({ subtitle }: Readonly<{ subtitle: string }>) {
  return (
    <Alert variant="default" className="mb-4 bg-slate-50 border-slate-200">
      <AlertCircle className="h-4 w-4 text-slate-500" />
      <AlertTitle className="text-sm text-slate-700">Presupuestos no configurados</AlertTitle>
      <AlertDescription className="text-xs text-slate-500 leading-relaxed">
        {subtitle}
      </AlertDescription>
    </Alert>
  );
}

// ============================================================================
// HELPER 3 · renderBodyContent (Paquete 6 · Extraer nested ternario × 3 err/empty/content)
//   Early returns para evitar anidamiento 3 niveles
// ============================================================================

function renderBodyContent(
  errMsg: string | null,
  rows: readonly DireccionBudgetRow[],
  todosMVP: boolean,
  subtitleMVP: string,
): ReactNode {
  // 1. Error consulta → EmptyState ROSE (early return)
  if (errMsg !== null) {
    return (
      <DireccionEmptyState
        tone="rose"
        title="Error cargando desviación presupuestal"
        subtitle={errMsg.length < 80 ? errMsg : 'Error consulta MV'}
      />
    );
  }

  // 2. Sin datos → EmptyState SLATE (early return)
  if (rows.length === 0) {
    return (
      <DireccionEmptyState
        tone="slate"
        title="Sin costos por departamento en el período"
        subtitle="No hay CFDIs procesados para los filtros actuales."
        hint="Amplía el rango de fechas o selecciona otra empresa."
      />
    );
  }

  // 3. Hay datos. Incluye Alerta MVP si todos = SIN_PRESUPUESTO
  return (
    <>
      {todosMVP && <AlertaPresupuestosNoConfigurados subtitle={subtitleMVP} />}
      <DireccionDesviacionTableClient rows={rows} />
    </>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL (ORQUESTADOR Server < 45 líneas)
// ============================================================================

export async function DireccionDesviacionPresupuestal({
  scope,
}: Readonly<{
  scope: DireccionFetchScope;
}>) {
  let rows: DireccionBudgetRow[] = [];
  let errMsg: string | null = null;
  try {
    rows = await fetchDireccionDesviacionPresupuestal(scope);
  } catch (err) {
    errMsg = (err as Error)?.message ?? 'ERR_UNKNOWN';
  }

  const summary = summarizeBudgetStatus(rows);
  const subtitleTodosMVP =
    'La entidad BudgetDepartment se habilitará en una próxima versión. Mientras tanto, los costos reales se muestran con estado "Sin presupuesto".';

  return (
    <ChartCardDireccion
      title="Desviación Presupuestal por Departamento"
      subtitle="Ejecución real vs. presupuesto autorizado. Umbrales: ≤5% En Línea · 5-10% Atención · >10% Fuera de Presupuesto."
      minHeight={420}
      footer={<DesviacionFooterSummary rows={rows} summary={summary} />}
    >
      {renderBodyContent(errMsg, rows, summary.todosMVP, subtitleTodosMVP)}
    </ChartCardDireccion>
  );
}

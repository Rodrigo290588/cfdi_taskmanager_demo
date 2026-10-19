// ============================================================
// src/app/dashboard/direccion/_components/direccion-tendencia-chart.tsx
//
// Sección Tendencia Histórica Costo Laboral + YoY comparativo.
// Wrapper Server Component async → pasa datos a Client Chart.
//
// Toggle Tabs (Mensual / Trimestral / Anual) actualiza query
// params view=... vía router.replace.
// ============================================================

import type { ReactNode } from 'react';
import {
  fetchDireccionTendenciaHistorica,
  type DireccionFetchScope,
  type DireccionTendenciaRow,
} from '@/lib/direccion-analytics-service';
import { ChartCardDireccion, DireccionEmptyState } from './direccion-shared';
import { fmtMxn, DIRECCION_PALETTE } from '@/lib/direccion-formatters';
import { DireccionTendenciaChartClient } from './_internal-tendencia-client';
import type { DireccionViewMode } from '@/lib/direccion-dashboard-url';

function humanViewLabel(view: DireccionViewMode): string {
  switch (view) {
    case 'monthly':
      return 'Tendencia Mensual · Costo Total de Nómina';
    case 'quarterly':
      return 'Tendencia Trimestral · Costo Total de Nómina';
    case 'yearly':
    default:
      return 'Tendencia Anual · Costo Total de Nómina';
  }
}

function buildTendenciaFooterSummary(rows: DireccionTendenciaRow[], anioComparativo: number | null): ReactNode {
  if (rows.length === 0) return undefined;

  const total = rows.reduce((a, r) => a + (r.costoActual ?? 0), 0);
  const periodLabel = rows.length === 1 ? 'período' : 'períodos';
  const yoyLabel = anioComparativo ? `Año ${anioComparativo}` : 'Comparativo';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium">{rows.length} {periodLabel} · Actual total <strong>{fmtMxn(total)}</strong></span>
      <span className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: DIRECCION_PALETTE.primary }} />Período actual</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-dashed" style={{ borderColor: DIRECCION_PALETTE.yoYLine }} />{yoyLabel}</span>
      </span>
    </div>
  );
}

function renderChartContent(
  fetchError: string | null,
  rows: DireccionTendenciaRow[],
  view: DireccionViewMode,
  anioComparativo: number | null
): ReactNode {
  if (fetchError) {
    return (
      <DireccionEmptyState
        tone="rose"
        title="Error cargando tendencia histórica"
        subtitle={fetchError.length < 80 ? fetchError : 'Error de consulta SQL'}
        hint="Intenta nuevamente cambiando el rango de fechas."
      />
    );
  }

  if (rows.length === 0) {
    return (
      <DireccionEmptyState
        tone="slate"
        title="Sin datos para el período seleccionado"
        subtitle="No hay CFDIs de nómina timbrados en el rango de fechas elegido."
        hint="Ajusta los filtros de fecha o cambia de empresa."
      />
    );
  }

  return <DireccionTendenciaChartClient rows={rows} viewMode={view} anioComparativo={anioComparativo} />;
}

export async function DireccionTendenciaChart({
  scope,
  view,
  anioComparativo,
}: Readonly<{
  scope: DireccionFetchScope;
  view: DireccionViewMode;
  anioComparativo: number | null;
}>): Promise<ReactNode> {
  let rows: DireccionTendenciaRow[] = [];
  let fetchError: string | null = null;
  try {
    rows = await fetchDireccionTendenciaHistorica({
      ...scope,
      anioComparativo,
      view,
    });
  } catch (err) {
    fetchError = (err as Error)?.message ?? 'ERR_UNKNOWN';
  }

  const subtitle = `Comparativo vs año ${anioComparativo ?? 'anterior'} (línea punteada).`;

  return (
    <ChartCardDireccion
      title={humanViewLabel(view)}
      subtitle={subtitle}
      minHeight={460}
      footer={buildTendenciaFooterSummary(rows, anioComparativo)}
    >
      {renderChartContent(fetchError, rows, view, anioComparativo)}
    </ChartCardDireccion>
  );
}

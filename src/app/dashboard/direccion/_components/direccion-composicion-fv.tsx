// ============================================================
// src/app/dashboard/direccion/_components/direccion-composicion-fv.tsx
//
// Sección Composición Gasto Fijo vs Variable:
//   • Lado izq: PieChart Donut outerRadius 120 innerRadius 80
//                + centro % Variable bold
//   • Lado der: Tabla 7 filas desglose SAT + progress bar.
//   • Mobile <768px: Donut + Tabla stack (no grid lg:cols-2).
//
// Wrapper Server Component → pasa datos a Client _internal-composicion-fv-client.
// ============================================================

import {
  fetchDireccionKpisAggregates,
  type DireccionFetchScope,
} from '@/lib/direccion-analytics-service';
import {
  ChartCardDireccion,
  DireccionEmptyState,
} from './direccion-shared';
import { fmtMxn, fmtPct, DIRECCION_PALETTE } from '@/lib/direccion-formatters';
import { DireccionComposicionFvClient } from './_internal-composicion-fv-client';

export async function DireccionComposicionFijoVariable({
  scope,
}: Readonly<{
  scope: DireccionFetchScope;
}>) {
  let kpis;
  let errMsg: string | null = null;
  try {
    kpis = await fetchDireccionKpisAggregates(scope);
  } catch (err) {
    errMsg = (err as Error)?.message ?? 'ERR_UNKNOWN';
  }

  if (errMsg) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DireccionEmptyState
          tone="rose"
          title="Error cargando Composición F/Variable"
          subtitle={errMsg.length < 80 ? errMsg : 'Error en la consulta de percepciones'}
        />
        <DireccionEmptyState
          tone="slate"
          title="Desglose 7 rubros SAT no disponible"
        />
      </div>
    );
  }

  const fijo = Number(kpis?.costoFijo ?? 0);
  const vari = Number(kpis?.costoVariable ?? 0);
  const total = fijo + vari;
  const pctVariable = total > 0 ? vari / total : 0;
  const desglose = (kpis?.desgloseFijoVariable ?? [])
    .map(r => ({ ...r, importe: Number(r.importe ?? 0) }))
    .sort((a, b) => b.importe - a.importe);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Donut */}
      <ChartCardDireccion
        title="Composición: Gasto Fijo vs Variable"
        subtitle="Sueldos y Salarios Base (Fijo) contra Aguinaldo, PTU, Horas Extra, Prima Vac., Comisiones y Bonos (Variable)."
        minHeight={440}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: DIRECCION_PALETTE.fixed }} />
                <strong>Fijo</strong> ({fmtPct(total > 0 ? fijo / total : 0, 1)})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: DIRECCION_PALETTE.variable }} />
                <strong>Variable</strong> ({fmtPct(pctVariable, 1)})
              </span>
            </span>
            <span>
              Total ponderado: <strong>{fmtMxn(total)}</strong>
            </span>
          </div>
        }
      >
        {total === 0 ? (
          <DireccionEmptyState
            tone="slate"
            title="Sin percepciones para el período"
          />
        ) : (
          <DireccionComposicionFvClient
            rows={[
              {
                key: 'FIJO',
                label: 'Gasto Fijo (Sueldos 001)',
                valor: fijo,
                color: DIRECCION_PALETTE.fixed,
              },
              {
                key: 'VARIABLE',
                label: 'Gasto Variable (6 rubros SAT)',
                valor: vari,
                color: DIRECCION_PALETTE.variable,
              },
            ]}
            pctVariableCentro={pctVariable}
          />
        )}
      </ChartCardDireccion>

      {/* Tabla 7 rubros SAT */}
      <ChartCardDireccion
        title="Desglose 7 Rubros SAT"
        subtitle="Percepciones clasificadas por TipoPercepcion SAT CFDI 1.2, ordenadas por importe descendente."
        minHeight={440}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span>Fuente: payroll_percepciones (agrupado en MV)</span>
            <span className="font-medium">
              Suma 7 rubros: <strong>{fmtMxn(desglose.reduce((a, r) => a + r.importe, 0))}</strong>
            </span>
          </div>
        }
      >
        {desglose.length === 0 ? (
          <DireccionEmptyState
            tone="slate"
            title="Sin rubros en el período seleccionado"
          />
        ) : (
          <div className="space-y-2">
            {desglose.map((r, idx) => {
              const ratio = total > 0 ? r.importe / total : 0;
              const pct = total > 0 ? ratio : 0;
              const color =
                DIRECCION_PALETTE.donut[idx % DIRECCION_PALETTE.donut.length];
              return (
                <div
                  key={r.codigo}
                  className="group grid grid-cols-12 items-center gap-2 py-2 border-b border-slate-100 last:border-b-0"
                >
                  <div className="col-span-4 flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: color }}
                    />
                    <span className="font-mono text-[10.5px] text-slate-500 shrink-0">
                      {r.codigo}
                    </span>
                    <span className="text-sm text-slate-700 truncate font-medium">
                      {r.concepto}
                    </span>
                  </div>
                  <div className="col-span-3 text-right text-sm font-semibold text-slate-800 tabular-nums">
                    {fmtMxn(r.importe)}
                  </div>
                  <div className="col-span-2 text-right text-xs text-slate-500 tabular-nums">
                    {fmtPct(pct, 1)}
                  </div>
                  <div className="col-span-3">
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
                          background: color,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ChartCardDireccion>
    </div>
  );
}

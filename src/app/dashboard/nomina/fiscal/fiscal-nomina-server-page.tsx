// ============================================================
// fiscal-nomina-server-page.tsx · TASK 4 (server async)
// Server Component con ProtectedRoute. Paridad 1:1 con rh-server-page.
//   · Row1: h1 Tablero Contabilidad y Fiscal izq · summary xs ·
//           span Empresa der (RFC · Nombre)
//   · Row2: filtros py-4 items-end sin Card wrapper
//   · Secciones (6): KPIs · Gravado/Exento · Deduc Terceros ·
//                    Alertas SBC/SDI · Alertas Timbrado · Top Comprobantes
// ============================================================

import { Suspense } from 'react';
import { format, formatISO, parseISO, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { ProtectedRoute } from '@/components/protected-route';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { prisma } from '@/lib/prisma';

import {
  parseFiscalNominaSearchParams,
  type FiscalNominaSectionId,
  FISCAL_NOMINA_SECTIONS,
} from '@/lib/fiscal-nomina-dashboard-url';
export type { FiscalNominaDashboardSearchParams } from '@/lib/fiscal-nomina-dashboard-url';
import type { FiscalNomTableParams } from '@/lib/fiscal-nomina-types';

import { FiscalNominaFilterBar } from './_components/fiscal-nomina-filter-bar';
import { KpiDrilldownShellNomina } from './_components/fiscal-nomina-shared';
import {
  KpisSectionSuspensed,
  fetchFiscalNominaKpis,
  type FiscalNominaKpisRow,
} from './_components/fiscal-nomina-kpis-section';
import {
  GravadoVsExentoChart,
  GravadoVsExentoChartSkeleton,
  type GravadoExentoRow,
} from './_components/fiscal-nomina-gravado-exento';
import {
  DeducTercerosDonut,
  DeducTercerosDonutSkeleton,
  type DeducTerceroRow,
} from './_components/fiscal-nomina-deduc-terceros';
import {
  SbcSdiAlertsTableSuspensed,
  BrechaTimbradoAlertsTableSuspensed,
  TopComprobantesCardSuspensed,
} from './_components/fiscal-nomina-alertas-tables';

type RawParsedFiscalNominaFilters = ReturnType<typeof parseFiscalNominaSearchParams>;
export type ResolvedFiscalNominaFilters = RawParsedFiscalNominaFilters & {
  companyId: string;
  startDate: string;
  endDate: string;
};

function defaultStartIso(): string {
  return formatISO(subMonths(startOfMonth(new Date()), 3), { representation: 'date' });
}
function defaultEndIso(): string {
  return formatISO(endOfMonth(new Date()), { representation: 'date' });
}

function resolveFilters(initial: RawParsedFiscalNominaFilters): ResolvedFiscalNominaFilters {
  const startDateRaw = initial.startDate;
  const endDateRaw = initial.endDate;
  const startDate =
    typeof startDateRaw === 'string' && startDateRaw.length === 10 ? startDateRaw : defaultStartIso();
  const endDate =
    typeof endDateRaw === 'string' && endDateRaw.length === 10 ? endDateRaw : defaultEndIso();
  return {
    ...initial,
    startDate,
    endDate,
    companyId: initial.companyId ?? '',
  };
}

type _ResolvedFiltersSafe = Readonly<{
  filters: ResolvedFiscalNominaFilters;
  safeFiltersForFilterBar: { startDate: string; endDate: string; departamento: string | null; registroPatronal: string | null; sections: FiscalNominaSectionId[] };
  allSectionIds: FiscalNominaSectionId[];
  hasCompany: boolean;
}>;
function _resolveFiltersAndSafeBar(initial: RawParsedFiscalNominaFilters): _ResolvedFiltersSafe {
  const filtersRaw = resolveFilters(initial ?? ({} as RawParsedFiscalNominaFilters));
  const ALL_SECTION_IDS: FiscalNominaSectionId[] = Array.isArray(FISCAL_NOMINA_SECTIONS)
    ? FISCAL_NOMINA_SECTIONS.map(s => s.id)
    : ['kpis','gravado_exento','deducciones_terceros','alertas_sbc_sdi','alertas_timbrado','top_comprobantes'];
  const sectionsArr = Array.isArray(filtersRaw.sections)
    ? filtersRaw.sections.filter(s => typeof s === 'string' && ALL_SECTION_IDS.includes(s as FiscalNominaSectionId))
    : ALL_SECTION_IDS;
  const sections: FiscalNominaSectionId[] = sectionsArr.length > 0 ? sectionsArr : ALL_SECTION_IDS;
  const filters: ResolvedFiscalNominaFilters = {
    ...filtersRaw,
    sections,
    startDate: typeof filtersRaw.startDate === 'string' && filtersRaw.startDate.length === 10
      ? filtersRaw.startDate
      : defaultStartIso(),
    endDate: typeof filtersRaw.endDate === 'string' && filtersRaw.endDate.length === 10
      ? filtersRaw.endDate
      : defaultEndIso(),
    companyId: typeof filtersRaw.companyId === 'string' ? filtersRaw.companyId : '',
  };
  const hasCompany = !!filters.companyId && filters.companyId.length > 0;
  const safeFiltersForFilterBar = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento ?? null,
    registroPatronal: filters.registroPatronal ?? null,
    sections: filters.sections,
  } as const;
  return { filters, safeFiltersForFilterBar, allSectionIds: ALL_SECTION_IDS, hasCompany };
}

type _CompanyDisplay = Readonly<{ companyRfc: string | null; companyDisplayName: string | null }>;
async function _resolveCompanyDisplay(args: Readonly<{ hasCompany: boolean; companyId: string }>): Promise<_CompanyDisplay> {
  if (!args.hasCompany) return { companyRfc: null, companyDisplayName: null };
  try {
    const company = await prisma.company.findUnique({
      where: { id: args.companyId },
      select: { rfc: true, businessName: true, name: true },
    });
    if (!company) return { companyRfc: null, companyDisplayName: null };
    return {
      companyRfc: company.rfc,
      companyDisplayName: company.businessName || company.name || null,
    };
  } catch {
    return { companyRfc: null, companyDisplayName: null };
  }
}

type _PeriodLabels = Readonly<{ periodoLabelStart: string; periodoLabelEnd: string }>;
function _formatPeriodLabels(args: Readonly<{ startDate: string; endDate: string }>): _PeriodLabels {
  try {
    return {
      periodoLabelStart: format(parseISO(args.startDate), 'dd/MM/yyyy', { locale: es }),
      periodoLabelEnd:   format(parseISO(args.endDate),   'dd/MM/yyyy', { locale: es }),
    };
  } catch {
    return { periodoLabelStart: args.startDate, periodoLabelEnd: args.endDate };
  }
}

type FiscalNominaServerPageProps = Readonly<{
  initialFilters: ReturnType<typeof parseFiscalNominaSearchParams>;
}>;

export async function FiscalNominaServerPage({
  initialFilters,
}: FiscalNominaServerPageProps) {
  type RenderOut = {
    kind: 'ok';
    filters: ResolvedFiscalNominaFilters;
    hasCompany: boolean;
    periodoLabelStart: string;
    periodoLabelEnd: string;
    totalSections: number;
    companyRfc: string | null;
    companyDisplayName: string | null;
    safeFiltersForFilterBar: { startDate: string; endDate: string; departamento: string | null; registroPatronal: string | null; sections: FiscalNominaSectionId[] };
  } | {
    kind: 'fatal';
    errMsg: string;
  };
  let out: RenderOut = { kind: 'fatal', errMsg: 'Error desconocido al inicializar el tablero.' };
  try {
    const resolved = _resolveFiltersAndSafeBar(initialFilters ?? ({} as RawParsedFiscalNominaFilters));
    const { filters, safeFiltersForFilterBar, allSectionIds, hasCompany } = resolved;
    const { companyRfc, companyDisplayName } = await _resolveCompanyDisplay({ hasCompany, companyId: filters.companyId });
    const { periodoLabelStart, periodoLabelEnd } = _formatPeriodLabels({ startDate: filters.startDate, endDate: filters.endDate });
    const totalSections = allSectionIds.length;
    out = { kind: 'ok', filters, hasCompany, periodoLabelStart, periodoLabelEnd, totalSections, companyRfc, companyDisplayName, safeFiltersForFilterBar };
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? `[FiscalNominaServerPage] ${err.name}: ${err.message}\n${err.stack ?? ''}`
        : `[FiscalNominaServerPage] Error desconocido: ${String(err)}`;
    console.error('[fiscal-nomina-server-page.tsx] Server Error capturado:', errMsg);
    out = { kind: 'fatal', errMsg };
  }
  if (out.kind === 'fatal') {
    return (
      <div className="flex-1 p-4 md:p-6 pt-6">
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader>
            <div className="text-base font-semibold text-amber-900">
              El tablero fiscal se cargó en modo seguro
            </div>
            <div className="text-sm text-amber-700 mt-1">
              Algunos módulos no están disponibles temporalmente; intenta recargar la página para
              reintentar. Este mensaje reemplaza el error de servidor genérico.
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-white rounded-lg border border-amber-100 p-4 text-xs font-mono text-slate-700 whitespace-pre-wrap break-all max-h-72 overflow-auto">
              {out.errMsg}
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }
  const { filters, hasCompany, periodoLabelStart, periodoLabelEnd, totalSections, companyRfc, companyDisplayName, safeFiltersForFilterBar } = out;
  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        {/* ============ ROW 1 — Título + Empresa ============ */}
        <div className="flex items-center justify-between space-y-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Tablero de Contabilidad y Fiscal
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Período: {periodoLabelStart} — {periodoLabelEnd}
              </span>
              {filters.registroPatronal && (
                <>
                  <span>·</span>
                  <span>
                    Registro Patronal: <strong>{filters.registroPatronal}</strong>
                  </span>
                </>
              )}
              {filters.departamento && (
                <>
                  <span>·</span>
                  <span>
                    Departamento: <strong>{filters.departamento}</strong>
                  </span>
                </>
              )}
              <span>·</span>
              <span>
                Vista mensual · {filters.sections.length} / {totalSections} secciones
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {(companyRfc || companyDisplayName) && (
              <span className="text-sm text-muted-foreground">
                {companyRfc || 'N/A'} · {companyDisplayName || 'Empresa'}
              </span>
            )}
          </div>
        </div>

        {/* ============ ROW 2 — Filtros permanentes ============ */}
        <div className="flex flex-col sm:flex-row gap-4 py-4 items-end">
          <FiscalNominaFilterBar filters={safeFiltersForFilterBar} />
        </div>

        {!hasCompany ? (
          <Card>
            <CardHeader>
              <div className="text-lg font-semibold">Selecciona una empresa</div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No se pudo resolver una empresa seleccionada. Usa el selector del sidebar o agrega{' '}
              <code className="inline-block mx-1 px-1 rounded bg-slate-100">?companyId=...</code>
              {' '}a la URL para visualizar el tablero de contabilidad y cumplimiento de nómina.
            </CardContent>
          </Card>
        ) : (
          <KpiDrilldownShellNomina
            companyId={filters.companyId}
            companyRfc={companyRfc}
            companyDisplayName={companyDisplayName}
            startDate={filters.startDate}
            endDate={filters.endDate}
          >
            <>
              {/* ============ ROW 3 — KPIs 6 cards ============ */}
              {filters.sections.includes('kpis') && (
                <KpisSectionSuspensed
                  companyId={filters.companyId}
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  fiscalEntityId={filters.fiscalEntityId}
                />
              )}

              {/* ============ ROW 4 — BarStacked + PieDonut (2 cols lg) ============ */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filters.sections.includes('gravado_exento') && (
                  <Suspense fallback={<GravadoVsExentoChartSkeleton />}>
                    <GravadoExentoSection
                      companyId={filters.companyId}
                      startDate={filters.startDate}
                      endDate={filters.endDate}
                      fiscalEntityId={filters.fiscalEntityId}
                    />
                  </Suspense>
                )}
                {filters.sections.includes('deducciones_terceros') && (
                  <Suspense fallback={<DeducTercerosDonutSkeleton />}>
                    <DeducTercerosSection
                      companyId={filters.companyId}
                      startDate={filters.startDate}
                      endDate={filters.endDate}
                      fiscalEntityId={filters.fiscalEntityId}
                    />
                  </Suspense>
                )}
              </div>

              {/* ============ ROW 5 — Alertas SBC/SDI + Alertas Timbrado ============ */}
              <div className="grid grid-cols-1 gap-4">
                {filters.sections.includes('alertas_sbc_sdi') && (
                  <SbcSdiAlertsTableSuspensed
                    companyId={filters.companyId}
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    fiscalEntityId={filters.fiscalEntityId}
                  />
                )}
                {filters.sections.includes('alertas_timbrado') && (
                  <BrechaTimbradoAlertsTableSuspensed
                    companyId={filters.companyId}
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    fiscalEntityId={filters.fiscalEntityId}
                  />
                )}
                {filters.sections.includes('top_comprobantes') && (
                  <TopComprobantesCardSuspensed
                    companyId={filters.companyId}
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    fiscalEntityId={filters.fiscalEntityId}
                  />
                )}
              </div>

              {/* ============ Sin secciones visibles ============ */}
              {filters.sections.length === 0 && (
                <Card>
                  <CardHeader>
                    <div className="text-base font-semibold">Sin secciones visibles</div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Usa el botón <strong>Visualización</strong> de la barra de filtros para seleccionar
                    qué indicadores o gráficas deseas ver en este tablero.
                  </CardContent>
                </Card>
              )}

            </>
          </KpiDrilldownShellNomina>
        )}
      </div>
    </ProtectedRoute>
  );
}

// ==================================================================
// Sub-sections async — Gravado vs Exento 4 conceptos SAT
// ==================================================================
async function GravadoExentoSection(params: FiscalNomTableParams) {
  let mv: FiscalNominaKpisRow | null = null;
  try {
    mv = await fetchFiscalNominaKpis(params);
  } catch { /* fail soft */ }

  const rows: GravadoExentoRow[] = [
    {
      tipo: '001',
      concepto: 'Sueldos',
      importeGravado: Number(mv?.gravado_001_sueldos ?? 0),
      importeExento:  Number(mv?.exento_001_sueldos  ?? 0),
    },
  ];

  const s = new Date(params.startDate);
  const e = new Date(params.endDate);
  const sY = s.getFullYear(), sM = s.getMonth() + 1;
  const eY = e.getFullYear(), eM = e.getMonth() + 1;
  const fe = params.fiscalEntityId ?? null;

  try {
    const extraRows = await prisma.$queryRaw<(GravadoExentoRow & { tipo_: string; concepto_: string; g: unknown; x: unknown })[]>`
      SELECT tipo_percepcion AS tipo_,
             CASE tipo_percepcion
               WHEN '002' THEN 'Aguinaldo (14º)'::text
               WHEN '003' THEN 'PTU'::text
               WHEN '021' THEN 'Prima Vacacional'::text
               ELSE 'Otro ' || tipo_percepcion::text
             END AS concepto_,
             COALESCE(SUM(importe_gravado), 0)::numeric(18,6) AS g,
             COALESCE(SUM(importe_exento),  0)::numeric(18,6) AS x
        FROM payroll_percepciones pp
        JOIN payroll_receipts pr ON pr.id = pp.payroll_receipt_id
       WHERE pr.company_id = ${params.companyId}::text
         AND (EXTRACT(YEAR  FROM pr.fecha_pago)::int, EXTRACT(MONTH FROM pr.fecha_pago)::int)
             >= ROW(${sY}::int, ${sM}::int)
         AND (EXTRACT(YEAR  FROM pr.fecha_pago)::int, EXTRACT(MONTH FROM pr.fecha_pago)::int)
             <= ROW(${eY}::int, ${eM}::int)
         AND (${fe}::text IS NULL OR pr.fiscal_entity_id = ${fe}::text)
         AND pp.tipo_percepcion IN ('002','003','021')
       GROUP BY pp.tipo_percepcion
       ORDER BY pp.tipo_percepcion ASC;
    `;
    for (const r of extraRows) {
      rows.push({
        tipo: String(r.tipo_),
        concepto: String(r.concepto_),
        importeGravado: Number(r.g ?? 0),
        importeExento:  Number(r.x ?? 0),
      });
    }
  } catch { /* fail soft */ }

  const filled = fillGravadoExentoDefaults(rows);
  return <GravadoVsExentoChart rows={filled} />;
}

function fillGravadoExentoDefaults(rows: GravadoExentoRow[]): GravadoExentoRow[] {
  const expected: Array<Omit<GravadoExentoRow, 'importeGravado' | 'importeExento'>> = [
    { tipo: '001', concepto: 'Sueldos' },
    { tipo: '002', concepto: 'Aguinaldo (14º)' },
    { tipo: '003', concepto: 'PTU' },
    { tipo: '021', concepto: 'Prima Vacacional' },
  ];
  const byTipo = new Map(rows.map(r => [r.tipo, r]));
  return expected.map(e => byTipo.get(e.tipo) ?? { ...e, importeGravado: 0, importeExento: 0 });
}

// ==================================================================
// Sub-sections async — Deducciones Terceros 4 categorías SAT
// ==================================================================
async function DeducTercerosSection(params: FiscalNomTableParams) {
  const s = new Date(params.startDate);
  const e = new Date(params.endDate);
  const sY = s.getFullYear(), sM = s.getMonth() + 1;
  const eY = e.getFullYear(), eM = e.getMonth() + 1;
  const fe = params.fiscalEntityId ?? null;

  let infonavit = 0, fonacot = 0, pension = 0, sindicato = 0;
  try {
    const rows = await prisma.$queryRaw<{ tipo_deduccion: string; total: unknown }[]>`
      SELECT pd.tipo_deduccion,
             COALESCE(SUM(pd.importe), 0)::numeric(18,6) AS total
        FROM payroll_deducciones pd
        JOIN payroll_receipts pr ON pr.id = pd.payroll_receipt_id
       WHERE pr.company_id = ${params.companyId}::text
         AND (EXTRACT(YEAR  FROM pr.fecha_pago)::int, EXTRACT(MONTH FROM pr.fecha_pago)::int)
             >= ROW(${sY}::int, ${sM}::int)
         AND (EXTRACT(YEAR  FROM pr.fecha_pago)::int, EXTRACT(MONTH FROM pr.fecha_pago)::int)
             <= ROW(${eY}::int, ${eM}::int)
         AND (${fe}::text IS NULL OR pr.fiscal_entity_id = ${fe}::text)
         AND pd.tipo_deduccion IN ('010','006','007','001')
       GROUP BY pd.tipo_deduccion;
    `;
    for (const r of rows) {
      const n = Number(r.total ?? 0);
      switch (r.tipo_deduccion) {
        case '010': infonavit = n; break;
        case '006': fonacot = n; break;
        case '007': pension = n; break;
        case '001': sindicato = n; break;
      }
    }
  } catch { /* fail soft */ }

  const items: DeducTerceroRow[] = [
    { tipo: '010', categoria: 'INFONAVIT',       importe: infonavit },
    { tipo: '006', categoria: 'FONACOT',         importe: fonacot },
    { tipo: '007', categoria: 'Pensión Alimenticia', importe: pension },
    { tipo: '001', categoria: 'Cuota Sindical',  importe: sindicato },
  ];
  return <DeducTercerosDonut rows={items} />;
}

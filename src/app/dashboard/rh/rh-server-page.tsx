import { Suspense } from 'react'
import { format, subMonths, parseISO } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { ProtectedRoute } from '@/components/protected-route'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'

import {
  buildRhDashboardUrl,
  parseRhSearchParams,
  type RhDashboardSearchParams,
  RH_SECTIONS,
} from '@/lib/rh-dashboard-url'
import {
  fetchHeadcountKpis, fetchTurnover, fetchIncapacidades,
  fetchHorasExtra, fetchPlantilla, fetchBeneficios,
  PayrollDashboardFiltersSchema,
  type HeadcountKpiRow, type TurnoverRow, type IncapacidadRow,
  type HorasExtraRow, type PlantillaRow, type BeneficioRow,
} from '@/lib/payroll-analytics-service'

import { RhFilterBar } from './_components/rh-filter-bar'
import {
  ChartPlaceholder,
} from './_components/rh-shared'

import { RhTurnoverPanel, type TurnoverInputRow } from './_components/rh-turnover'
import { RhIncapacidadesPanel, type IncapacidadesInputRow } from './_components/rh-incapacidades'
import { RhHorasExtraPanel, type HorasExtraInputRow } from './_components/rh-horas-extra'
import { RhPlantillaPanel, type PlantillaInputRow } from './_components/rh-plantilla'
import { RhBeneficiosPanel, type BeneficiosInputRow } from './_components/rh-beneficios'
import { RhKpiCardsClient } from './_components/rh-kpi-cards-client'

type RawParsedRhFilters = ReturnType<typeof parseRhSearchParams>
export type ResolvedRhFilters = RawParsedRhFilters & {
  companyId: string
  startDate: string | null
  endDate: string | null
  sections: RawParsedRhFilters extends { sections: infer T } ? T : never
}

function resolveFilters(initial: RawParsedRhFilters): ResolvedRhFilters {
  const startDateRaw = initial.startDate
  const endDateRaw = initial.endDate
  const startDate =
    typeof startDateRaw === 'string' && startDateRaw.length === 10 ? startDateRaw : null
  const endDate =
    typeof endDateRaw === 'string' && endDateRaw.length === 10 ? endDateRaw : null
  return {
    ...initial,
    startDate,
    endDate,
    companyId: initial.companyId,
  }
}

type RhDashboardServerPageProps = {
  initialFilters: ReturnType<typeof parseRhSearchParams>
}

export async function RhDashboardServerPage({
  initialFilters,
}: RhDashboardServerPageProps) {
  const filters = resolveFilters(initialFilters)
  const hasCompany = !!filters.companyId && filters.companyId.length > 0

  const safeFiltersForRhFilterBar = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento ?? null,
    tipoNomina: filters.tipoNomina ?? null,
    periodicidad: filters.periodicidad ?? null,
    view: filters.view,
    sections: filters.sections,
  } as const

  let companyRfc: string | null = null
  let companyDisplayName: string | null = null
  if (hasCompany) {
    try {
      const company = await prisma.company.findUnique({
        where: { id: filters.companyId },
        select: { rfc: true, businessName: true, name: true },
      })
      if (company) {
        companyRfc = company.rfc
        companyDisplayName = company.businessName || company.name || null
      }
    } catch { /* fail soft */ }
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        {/* Row 1 — título + empresa, misma posición dashboard_fiscal (h2 + span) */}
        <div className="flex items-center justify-between space-y-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Tablero de Recursos Humanos
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Período: {filters.startDate && filters.endDate
                    ? `${format(parseISO(filters.startDate), 'dd/MM/yyyy', { locale: es })} — ${format(parseISO(filters.endDate), 'dd/MM/yyyy', { locale: es })}`
                    : 'Sin fechas seleccionadas (Tablero vacío)'}
              </span>
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
                Vista {filters.view === 'monthly' ? 'mensual' : filters.view === 'quarterly' ? 'trimestral' : 'anual'} ·{' '}
                {filters.sections.length} / {RH_SECTIONS.length} secciones
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

        {/* Row 2 — filtros, misma posición dashboard_fiscal div filtros py-4 items-end */}
        <div className="flex flex-col sm:flex-row gap-4 py-4 items-end">
          <RhFilterBar filters={safeFiltersForRhFilterBar} />
        </div>

        {!hasCompany ? (
          <Card>
            <CardHeader>
              <div className="text-lg font-semibold">Selecciona una empresa</div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No se pudo resolver una empresa seleccionada. Usa el selector del sidebar o agrega
              <code className="inline-block mx-1 px-1 rounded bg-slate-100">?companyId=...</code>
              a la URL para visualizar los KPIs de RH.
            </CardContent>
          </Card>
        ) : (
          <>
            {filters.sections.includes('kpis') && (
              <Suspense fallback={<KpiGridSkeleton />}>
                <KpiCardsSection filters={filters} companyRfc={companyRfc} />
              </Suspense>
            )}

            <div className="flex flex-col gap-10 mt-6">
              {filters.sections.includes('turnover') && (
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Rotación y Movimientos de Personal</h3>
                  <Suspense fallback={<ChartPlaceholder label="Rotación (Turnover)" />}>
                    <TurnoverSection filters={filters} companyRfc={companyRfc} />
                  </Suspense>
                </section>
              )}
              {filters.sections.includes('incapacidades') && (
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Mapa de Incidencias (Incapacidades)</h3>
                  <Suspense fallback={<ChartPlaceholder label="Incapacidades" />}>
                    <IncapacidadesSection filters={filters} companyRfc={companyRfc} />
                  </Suspense>
                </section>
              )}
              {filters.sections.includes('horas_extra') && (
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Control de Horas Extra</h3>
                  <Suspense fallback={<ChartPlaceholder label="Horas Extra" />}>
                    <HorasExtraSection filters={filters} companyRfc={companyRfc} />
                  </Suspense>
                </section>
              )}
              {filters.sections.includes('plantilla') && (
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Distribución de Plantilla y Contratos</h3>
                  <Suspense fallback={<ChartPlaceholder label="Plantilla / Contratos" />}>
                    <PlantillaSection filters={filters} companyRfc={companyRfc} />
                  </Suspense>
                </section>
              )}
              {filters.sections.includes('beneficios') && (
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Beneficios y Percepciones Adicionales</h3>
                  <Suspense fallback={<ChartPlaceholder label="Beneficios / Percepciones" />}>
                    <BeneficiosSection filters={filters} companyRfc={companyRfc} />
                  </Suspense>
                </section>
              )}
            </div>

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

            <footer className="pt-4 text-xs text-slate-500 border-t border-slate-200">
        
              <a
                href={buildRhDashboardUrl('/api/stats/rh', {
                  companyId: filters.companyId,
                  organizationId: filters.organizationId,
                  fiscalEntityId: filters.fiscalEntityId,
                  departamento: filters.departamento,
                  tipoNomina: filters.tipoNomina,
                  periodicidad: filters.periodicidad,
                  startDate: filters.startDate,
                  endDate: filters.endDate,
                  view: filters.view,
                  sections: filters.sections.join(','),
                })}
                className="underline hover:text-blue-600"
                target="_blank" rel="noreferrer">
               
              </a>
            </footer>
          </>
        )}
      </div>
    </ProtectedRoute>
  )
}

function buildScopedFilters(filters: ResolvedRhFilters) {
  return PayrollDashboardFiltersSchema.parse({
    organizationId: filters.organizationId || null,
    companyId: filters.companyId,
    fiscalEntityId: filters.fiscalEntityId,
    startDate: filters.startDate,
    endDate:   filters.endDate,
    departamento: filters.departamento,
    tipoNomina: filters.tipoNomina,
    periodicidad: filters.periodicidad,
  })
}

async function KpiCardsSection({ filters, companyRfc }: { filters: ResolvedRhFilters, companyRfc: string | null }) {
  let rows: HeadcountKpiRow[] = []
  let prevRows: HeadcountKpiRow[] = []
  let previousLabel = 'vs período previo'
  const f = buildScopedFilters(filters)
  
  if (f.startDate && f.endDate) {
    const prevStart = subMonths(f.startDate, 1)
    const prevEnd = subMonths(f.endDate, 1)
    
    // Convert to local time keeping the exact UTC year, month, and day
    const localStart = new Date(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), prevStart.getUTCDate())
    const localEnd = new Date(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate())
    
    previousLabel = `vs Periodo anterior del ${format(localStart, 'dd/MMM/yy', { locale: es })} - ${format(localEnd, 'dd/MMM/yy', { locale: es })}`
  }

  try {
    rows = await fetchHeadcountKpis(f)

    if (f.startDate && f.endDate) {
      const prevStart = subMonths(f.startDate, 1)
      const prevEnd = subMonths(f.endDate, 1)
      const pf = { ...f, startDate: prevStart, endDate: prevEnd }
      prevRows = await fetchHeadcountKpis(pf)
    }
  } catch (err) {
    console.error("ERROR IN KpiCardsSection:", err);
  }

  const totalPercepciones = rows.reduce((a, r) => a + Number(r.total_percepciones || 0), 0)
  const totalDeducciones  = rows.reduce((a, r) => a + Number(r.total_deducciones || 0), 0)
  const totalOtrosPagos   = rows.reduce((a, r) => a + Number(r.total_otros_pagos || 0), 0)
  const totalDiasPagados  = rows.reduce((a, r) => a + Number(r.total_dias_pagados || 0), 0)
  const headcountByMonth = rows.reduce((acc, r) => {
    const monthKey = r.mes_pago.toISOString()
    acc[monthKey] = (acc[monthKey] || 0) + Number(r.empleados_pagados || 0)
    return acc
  }, {} as Record<string, number>)

  const empleadosPagados = Object.values(headcountByMonth).length > 0
    ? Math.max(...Object.values(headcountByMonth))
    : 0

  const prevHeadcountByMonth = prevRows.reduce((acc, r) => {
    const monthKey = r.mes_pago.toISOString()
    acc[monthKey] = (acc[monthKey] || 0) + Number(r.empleados_pagados || 0)
    return acc
  }, {} as Record<string, number>)

  const prevEmpleados = Object.values(prevHeadcountByMonth).length > 0
    ? Math.max(...Object.values(prevHeadcountByMonth))
    : 0

  const prevPercepciones = prevRows.reduce((a, r) => a + Number(r.total_percepciones || 0), 0)

  const costoPorEmpleado = empleadosPagados ? totalPercepciones / empleadosPagados : 0
  const prevCosto = prevEmpleados ? prevPercepciones / prevEmpleados : 0

  return (
      <RhKpiCardsClient
      filters={{
        companyId: filters.companyId,
        companyRfc: companyRfc || filters.companyId,
        organizationId: filters.organizationId,
        fiscalEntityId: filters.fiscalEntityId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        departamento: filters.departamento,
        tipoNomina: filters.tipoNomina,
        periodicidad: filters.periodicidad,
      }}
      empleadosPagados={empleadosPagados}
      prevEmpleados={prevEmpleados}
      totalPercepciones={totalPercepciones}
      prevPercepciones={prevPercepciones}
      totalDeducciones={totalDeducciones}
      totalOtrosPagos={totalOtrosPagos}
      totalDiasPagados={totalDiasPagados}
      costoPorEmpleado={costoPorEmpleado}
      prevCosto={prevCosto}
      previousLabel={previousLabel}
    />
  )
}

async function TurnoverSection({ filters, companyRfc }: { filters: ResolvedRhFilters, companyRfc?: string | null }) {
  let rows: TurnoverInputRow[] = []
  let previousLabel = 'vs período anterior'
  
  const clientFilters: Record<string, string | null | undefined> = {
    companyId: filters.companyId,
    companyRfc: companyRfc || filters.companyId,
    organizationId: filters.organizationId,
    fiscalEntityId: filters.fiscalEntityId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento,
    tipoNomina: filters.tipoNomina,
    periodicidad: filters.periodicidad,
  };

  try {
    const f = buildScopedFilters(filters)
    const raw: TurnoverRow[] = await fetchTurnover(f)
    rows = raw.map(r => ({
      departamento: r.departamento,
      mes_pago: r.mes_pago.toISOString(),
      altas: Number(r.altas || 0),
      bajas: Number(r.bajas || 0),
      reingresos: Number(r.reingresos || 0),
      empleados_activos: Number(r.empleados_activos || 0),
      total_recibos: Number(r.total_recibos || 0),
    }))

    if (f.startDate && f.endDate) {
      const prevStart = subMonths(f.startDate, 1)
      const prevEnd = subMonths(f.endDate, 1)
      
      const localStart = new Date(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), prevStart.getUTCDate())
      const localEnd = new Date(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate())
      
      previousLabel = `vs Periodo anterior del ${format(localStart, 'dd/MMM/yy', { locale: es })} - ${format(localEnd, 'dd/MMM/yy', { locale: es })}`
    }
  } catch { /* fail soft */ }

  return <RhTurnoverPanel rows={rows} previousLabel={previousLabel} filters={clientFilters} />
}

async function IncapacidadesSection({ filters, companyRfc }: { filters: ResolvedRhFilters, companyRfc: string | null }) {
  let rows: IncapacidadesInputRow[] = []
  let previousLabel = 'vs período anterior'
  
  const clientFilters: Record<string, string | null | undefined> = {
    companyId: filters.companyId,
    companyRfc: companyRfc || filters.companyId,
    organizationId: filters.organizationId,
    fiscalEntityId: filters.fiscalEntityId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento,
    tipoNomina: filters.tipoNomina,
    periodicidad: filters.periodicidad,
  };

  try {
    const f = buildScopedFilters(filters)
    const raw: IncapacidadRow[] = await fetchIncapacidades(f)
    rows = raw.map(r => ({
      departamento: r.departamento,
      mes_pago: r.mes_pago.toISOString(),
      tipo_incapacidad: r.tipo_incapacidad,
      descripcion_tipo: r.descripcion_tipo,
      numero_eventos: Number(r.numero_eventos || 0),
      total_dias: Number(r.total_dias || 0),
      promedio_dias_por_evento: Number(r.promedio_dias_por_evento || 0),
      importe_total: Number(r.importe_total || 0),
      empleados_afectados: Number(r.empleados_afectados || 0),
    }))

    if (f.startDate && f.endDate) {
      const prevStart = subMonths(f.startDate, 1)
      const prevEnd = subMonths(f.endDate, 1)
      
      const localStart = new Date(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), prevStart.getUTCDate())
      const localEnd = new Date(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate())
      
      previousLabel = `vs Periodo anterior del ${format(localStart, 'dd/MMM/yy', { locale: es })} - ${format(localEnd, 'dd/MMM/yy', { locale: es })}`
    }
  } catch { /* fail soft */ }

  return <RhIncapacidadesPanel rows={rows} previousLabel={previousLabel} filters={clientFilters} />
}

async function HorasExtraSection({ filters, companyRfc }: { filters: ResolvedRhFilters, companyRfc: string | null }) {
  let rows: HorasExtraInputRow[] = []
  let previousLabel = 'vs período anterior'
  
  const clientFilters = {
    companyId: filters.companyId,
    companyRfc: companyRfc || filters.companyId,
    organizationId: filters.organizationId,
    fiscalEntityId: filters.fiscalEntityId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento,
    tipoNomina: filters.tipoNomina,
    periodicidad: filters.periodicidad,
  };
  try {
    const f = buildScopedFilters(filters)
    const raw: HorasExtraRow[] = await fetchHorasExtra(f)
    rows = raw.map(r => ({
      departamento: r.departamento,
      mes_pago: r.mes_pago.toISOString(),
      tipo_horas: r.tipo_horas,
      descripcion_tipo: r.descripcion_tipo,
      numero_nominas: Number(r.numero_nominas || 0),
      empleados: Number(r.empleados || 0),
      total_horas: Number(r.total_horas || 0),
      total_dias: Number(r.total_dias || 0),
      importe_total: Number(r.importe_total || 0),
    }))

    if (f.startDate && f.endDate) {
      const prevStart = subMonths(f.startDate, 1)
      const prevEnd = subMonths(f.endDate, 1)
      
      const localStart = new Date(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), prevStart.getUTCDate())
      const localEnd = new Date(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate())
      
      previousLabel = `vs Periodo anterior del ${format(localStart, 'dd/MMM/yy', { locale: es })} - ${format(localEnd, 'dd/MMM/yy', { locale: es })}`
    }
  } catch { /* fail soft */ }

  return <RhHorasExtraPanel rows={rows} previousLabel={previousLabel} filters={clientFilters} />
}

async function PlantillaSection({ filters, companyRfc }: { filters: ResolvedRhFilters, companyRfc: string | null }) {
  let rows: PlantillaInputRow[] = []
  
  const clientFilters = {
    companyId: filters.companyId,
    companyRfc: companyRfc || filters.companyId,
    organizationId: filters.organizationId,
    fiscalEntityId: filters.fiscalEntityId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento,
    tipoNomina: filters.tipoNomina,
    periodicidad: filters.periodicidad,
  };

  try {
    const f = buildScopedFilters(filters)
    const raw: PlantillaRow[] = await fetchPlantilla(f)
    rows = raw.map(r => ({
      departamento: r.departamento,
      tipo_contrato: r.tipo_contrato,
      tipo_jornada: r.tipo_jornada,
      num_empleados: Number(r.num_empleados || 0),
      antiguedad_promedio_anios: Number(r.antiguedad_promedio_anios || 0),
      sdi_promedio: Number(r.sdi_promedio || 0),
    }))
  } catch { /* fail soft */ }

  return <RhPlantillaPanel rows={rows} filters={clientFilters} />
}

async function BeneficiosSection({ filters, companyRfc }: { filters: ResolvedRhFilters, companyRfc: string | null }) {
  let rows: BeneficiosInputRow[] = []
  
  const clientFilters = {
    companyId: filters.companyId,
    companyRfc: companyRfc || filters.companyId,
    organizationId: filters.organizationId,
    fiscalEntityId: filters.fiscalEntityId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento,
    tipoNomina: filters.tipoNomina,
    periodicidad: filters.periodicidad,
  };

  try {
    const f = buildScopedFilters(filters)
    const raw: BeneficioRow[] = await fetchBeneficios(f)
    rows = raw.map(r => ({
      departamento: r.departamento,
      mes_pago: r.mes_pago.toISOString(),
      tipo_percepcion: r.tipo_percepcion,
      descripcion_beneficio: r.descripcion_beneficio,
      concepto: r.concepto,
      numero_aplicaciones: Number(r.numero_aplicaciones || 0),
      empleados_beneficiados: Number(r.empleados_beneficiados || 0),
      total_gravado: Number(r.total_gravado || 0),
      total_exento: Number(r.total_exento || 0),
      importe_total: Number(r.importe_total || 0),
    }))
  } catch { /* fail soft */ }

  return <RhBeneficiosPanel rows={rows} filters={clientFilters} />
}

function KpiGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2"><Skeleton className="h-3 w-28"/></CardHeader>
          <CardContent><Skeleton className="h-7 w-32"/></CardContent>
        </Card>
      ))}
    </div>
  )
}

export type { RhDashboardSearchParams }

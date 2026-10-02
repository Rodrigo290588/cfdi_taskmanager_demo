import { Suspense } from 'react'
import { format, formatISO, parseISO, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { ProtectedRoute } from '@/components/protected-route'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Users, TrendingUp, ArrowDownRight, Clock, Briefcase, Gift,
} from 'lucide-react'
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
import { fmtMxn, fmtNum } from '@/lib/rh-formatters'

import { RhFilterBar } from './_components/rh-filter-bar'
import {
  KpiCardRh, ChartPlaceholder,
} from './_components/rh-shared'

import { RhTurnoverPanel, type TurnoverInputRow } from './_components/rh-turnover'
import { RhIncapacidadesPanel, type IncapacidadesInputRow } from './_components/rh-incapacidades'
import { RhHorasExtraPanel, type HorasExtraInputRow } from './_components/rh-horas-extra'
import { RhPlantillaPanel, type PlantillaInputRow } from './_components/rh-plantilla'
import { RhBeneficiosPanel, type BeneficiosInputRow } from './_components/rh-beneficios'

type RawParsedRhFilters = ReturnType<typeof parseRhSearchParams>
export type ResolvedRhFilters = RawParsedRhFilters & {
  companyId: string
  startDate: string
  endDate: string
  sections: RawParsedRhFilters extends { sections: infer T } ? T : never
}

function defaultStartIso(): string {
  return formatISO(subMonths(startOfMonth(new Date()), 6), { representation: 'date' })
}
function defaultEndIso(): string {
  return formatISO(endOfMonth(new Date()), { representation: 'date' })
}

function resolveFilters(initial: RawParsedRhFilters): ResolvedRhFilters {
  const startDateRaw = initial.startDate
  const endDateRaw = initial.endDate
  const startDate =
    typeof startDateRaw === 'string' && startDateRaw.length === 10 ? startDateRaw : defaultStartIso()
  const endDate =
    typeof endDateRaw === 'string' && endDateRaw.length === 10 ? endDateRaw : defaultEndIso()
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
                Período: {format(parseISO(filters.startDate), 'dd/MM/yyyy', { locale: es })} —{' '}
                {format(parseISO(filters.endDate), 'dd/MM/yyyy', { locale: es })}
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
                <KpiCardsSection filters={filters} />
              </Suspense>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filters.sections.includes('turnover') && (
                <Suspense fallback={<ChartPlaceholder label="Rotación (Turnover)" />}>
                  <TurnoverSection filters={filters} />
                </Suspense>
              )}
              {filters.sections.includes('incapacidades') && (
                <Suspense fallback={<ChartPlaceholder label="Incapacidades" />}>
                  <IncapacidadesSection filters={filters} />
                </Suspense>
              )}
              {filters.sections.includes('horas_extra') && (
                <Suspense fallback={<ChartPlaceholder label="Horas Extra" />}>
                  <HorasExtraSection filters={filters} />
                </Suspense>
              )}
              {filters.sections.includes('plantilla') && (
                <Suspense fallback={<ChartPlaceholder label="Plantilla / Contratos" />}>
                  <PlantillaSection filters={filters} />
                </Suspense>
              )}
              {filters.sections.includes('beneficios') && (
                <div className="lg:col-span-2">
                  <Suspense fallback={<ChartPlaceholder label="Beneficios / Percepciones" />}>
                    <BeneficiosSection filters={filters} />
                  </Suspense>
                </div>
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
    organizationId: filters.organizationId || filters.companyId,
    companyId: filters.companyId,
    fiscalEntityId: filters.fiscalEntityId,
    startDate: filters.startDate,
    endDate:   filters.endDate,
    departamento: filters.departamento,
  })
}

async function KpiCardsSection({ filters }: { filters: ResolvedRhFilters }) {
  let rows: HeadcountKpiRow[] = []
  let prevRows: HeadcountKpiRow[] = []
  try {
    const f = buildScopedFilters(filters)
    rows = await fetchHeadcountKpis(f)

    const s = f.startDate.getTime()
    const e = f.endDate.getTime()
    const span = e - s
    const pf = { ...f, startDate: new Date(s - span), endDate: new Date(s - 1) }
    prevRows = await fetchHeadcountKpis(pf)
  } catch { /* fail soft */ }

  const totalPercepciones = rows.reduce((a, r) => a + Number(r.total_percepciones || 0), 0)
  const totalDeducciones  = rows.reduce((a, r) => a + Number(r.total_deducciones || 0), 0)
  const totalOtrosPagos   = rows.reduce((a, r) => a + Number(r.total_otros_pagos || 0), 0)
  const totalDiasPagados  = rows.reduce((a, r) => a + Number(r.total_dias_pagados || 0), 0)
  const empleadosPagados  =
    rows.length > 0
      ? Math.max(...rows.map(r => Number(r.empleados_pagados || 0)))
      : 0

  const prevPercepciones = prevRows.reduce((a, r) => a + Number(r.total_percepciones || 0), 0)
  const prevEmpleados =
    prevRows.length > 0
      ? Math.max(...prevRows.map(r => Number(r.empleados_pagados || 0)))
      : 0

  const costoPorEmpleado = empleadosPagados ? totalPercepciones / empleadosPagados : 0
  const prevCosto = prevEmpleados ? prevPercepciones / prevEmpleados : 0

  return (
    <section>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <KpiCardRh
          title="Empleados Pagados"
          value={fmtNum(empleadosPagados, 0)}
          tone="emerald"
          icon={<Users className="h-12 w-12 text-emerald-500" />}
          subtext="Headcount período"
          trendDirection={
            empleadosPagados > prevEmpleados ? 'up' :
            empleadosPagados < prevEmpleados ? 'down' : 'flat'
          }
          trendDelta={
            prevEmpleados
              ? `${empleadosPagados >= prevEmpleados ? '+' : ''}${fmtNum(
                  ((empleadosPagados - prevEmpleados) / prevEmpleados) * 100, 1,
                )}% vs período previo`
              : null
          }
          trendLabel={!prevEmpleados ? 'Período anterior sin datos' : null}
        />
        <KpiCardRh
          title="Percepciones Totales"
          value={fmtMxn(totalPercepciones)}
          tone="blue"
          icon={<TrendingUp className="h-12 w-12 text-blue-500" />}
          trendDirection={
            totalPercepciones > prevPercepciones ? 'up' :
            totalPercepciones < prevPercepciones ? 'down' : 'flat'
          }
          trendDelta={
            prevPercepciones
              ? `${totalPercepciones >= prevPercepciones ? '+' : ''}${fmtNum(
                  ((totalPercepciones - prevPercepciones) / prevPercepciones) * 100, 1,
                )}% vs período previo`
              : null
          }
          trendLabel={!prevPercepciones ? 'Período anterior sin datos' : null}
        />
        <KpiCardRh
          title="Deducciones Totales"
          value={fmtMxn(totalDeducciones)}
          tone="rose"
          icon={<ArrowDownRight className="h-12 w-12 text-rose-500" />}
        />
        <KpiCardRh
          title="Otros Pagos"
          value={fmtMxn(totalOtrosPagos)}
          tone="amber"
          icon={<Gift className="h-12 w-12 text-amber-500" />}
        />
        <KpiCardRh
          title="Días Pagados"
          value={fmtNum(totalDiasPagados, 0)}
          tone="indigo"
          icon={<Clock className="h-12 w-12 text-indigo-500" />}
        />
        <KpiCardRh
          title="Costo / Empleado"
          value={fmtMxn(costoPorEmpleado)}
          tone="violet"
          icon={<Briefcase className="h-12 w-12 text-violet-500" />}
          subtext={empleadosPagados > 0 ? `Sobre ${fmtNum(empleadosPagados, 0)} personas` : 'Sin datos'}
          trendDirection={
            prevCosto
              ? (costoPorEmpleado > prevCosto ? 'up' :
                 costoPorEmpleado < prevCosto ? 'down' : 'flat')
              : 'flat'
          }
          trendDelta={
            prevCosto
              ? `${costoPorEmpleado >= prevCosto ? '+' : ''}${fmtNum(
                  ((costoPorEmpleado - prevCosto) / prevCosto) * 100, 1,
                )}% vs período previo`
              : null
          }
          trendLabel={!prevCosto ? 'Período anterior sin datos' : null}
        />
      </div>
    </section>
  )
}

async function TurnoverSection({ filters }: { filters: ResolvedRhFilters }) {
  let rows: TurnoverInputRow[] = []
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
  } catch { /* fail soft */ }

  return <RhTurnoverPanel rows={rows} />
}

async function IncapacidadesSection({ filters }: { filters: ResolvedRhFilters }) {
  let rows: IncapacidadesInputRow[] = []
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
  } catch { /* fail soft */ }

  return <RhIncapacidadesPanel rows={rows} />
}

async function HorasExtraSection({ filters }: { filters: ResolvedRhFilters }) {
  let rows: HorasExtraInputRow[] = []
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
  } catch { /* fail soft */ }

  return <RhHorasExtraPanel rows={rows} />
}

async function PlantillaSection({ filters }: { filters: ResolvedRhFilters }) {
  let rows: PlantillaInputRow[] = []
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

  return <RhPlantillaPanel rows={rows} />
}

async function BeneficiosSection({ filters }: { filters: ResolvedRhFilters }) {
  let rows: BeneficiosInputRow[] = []
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

  return <RhBeneficiosPanel rows={rows} />
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

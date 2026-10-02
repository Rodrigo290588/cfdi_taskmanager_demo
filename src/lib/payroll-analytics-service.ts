// ============================================================
// src/lib/payroll-analytics-service.ts
// Servicio analítico para Tablero de Control de Recursos Humanos
// Basado EN EXCLUSIVA en Vistas Materializadas de PostgreSQL
// consultadas mediante prisma.$queryRaw.
//
// PROHIBICIÓN EXPLÍCITA (cumple restricción arquitectónica):
//   Nunca se parsea XML ni se agregan datos en memoria.
//   Toda agregación SUM/COUNT/AVG es pre-calculada por la MV.
// ============================================================

import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// ------------------------------------------------------------
// Validación de parámetros de entrada (Zod tipado estricto)
// ------------------------------------------------------------
export const PayrollDashboardFiltersSchema = z.object({
  organizationId: z.string().cuid().min(1),
  companyId: z.string().cuid().min(1),
  fiscalEntityId: z.string().cuid().optional().nullable(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  departamento: z.string().max(80).optional().nullable(),
});

export type PayrollDashboardFilters = z.infer<typeof PayrollDashboardFiltersSchema>;

// ------------------------------------------------------------
// Tipos de retorno explícitos (no any, no unknown)
// ------------------------------------------------------------
export type TurnoverRow = {
  departamento: string | null;
  mes_pago: Date;
  altas: number;
  bajas: number;
  reingresos: number;
  empleados_activos: number;
  total_recibos: number;
};

export type IncapacidadRow = {
  departamento: string | null;
  mes_pago: Date;
  tipo_incapacidad: string;
  descripcion_tipo: string;
  numero_eventos: number;
  total_dias: number;
  promedio_dias_por_evento: number;
  importe_total: number;
  empleados_afectados: number;
};

export type HorasExtraRow = {
  departamento: string;
  mes_pago: Date;
  tipo_horas: string;
  descripcion_tipo: string;
  numero_nominas: number;
  empleados: number;
  total_horas: number;
  total_dias: number;
  importe_total: number;
};

export type PlantillaRow = {
  departamento: string;
  tipo_contrato: string;
  tipo_jornada: string;
  num_empleados: number;
  antiguedad_promedio_anios: number;
  sdi_promedio: number;
};

export type BeneficioRow = {
  departamento: string;
  mes_pago: Date;
  tipo_percepcion: string;
  descripcion_beneficio: string;
  concepto: string;
  numero_aplicaciones: number;
  empleados_beneficiados: number;
  total_gravado: number;
  total_exento: number;
  importe_total: number;
};

export type HeadcountKpiRow = {
  departamento: string | null;
  mes_pago: Date;
  recibos_procesados: number;
  empleados_pagados: number;
  total_percepciones: number;
  total_deducciones: number;
  total_otros_pagos: number;
  total_dias_pagados: number;
  ticket_promedio_percepciones: number;
};

export type HrDashboardAggregate = {
  headcountKpis: HeadcountKpiRow[];
  turnover: TurnoverRow[];
  incapacidades: IncapacidadRow[];
  horasExtra: HorasExtraRow[];
  plantilla: PlantillaRow[];
  beneficios: BeneficioRow[];
};

// ------------------------------------------------------------
// Helper: cláusula WHERE dimensionada compartida
// ------------------------------------------------------------
export function buildScopeClauses(filters: PayrollDashboardFilters): {
  params: Prisma.Sql[];
  fragments: Prisma.Sql[];
} {
  const fragments: Prisma.Sql[] = [];
  const params: Prisma.Sql[] = [];

  fragments.push(Prisma.sql`organization_id = ${filters.organizationId}::uuid`);
  fragments.push(Prisma.sql`company_id = ${filters.companyId}::uuid`);

  if (filters.fiscalEntityId) {
    fragments.push(Prisma.sql`fiscal_entity_id = ${filters.fiscalEntityId}::uuid`);
  }

  fragments.push(Prisma.sql`mes_pago >= ${filters.startDate.toISOString().slice(0, 10)}::date`);
  fragments.push(Prisma.sql`mes_pago <= ${filters.endDate.toISOString().slice(0, 10)}::date`);

  if (filters.departamento) {
    fragments.push(Prisma.sql`departamento = ${filters.departamento}`);
  }

  return { params, fragments };
}

// ------------------------------------------------------------
// Consulta #1 — KPIs globales (cards)
// ------------------------------------------------------------
export async function fetchHeadcountKpis(
  filters: PayrollDashboardFilters,
): Promise<HeadcountKpiRow[]> {
  const { fragments } = buildScopeClauses(filters);
  const where = Prisma.join(fragments, ' AND ');

  const rows = await prisma.$queryRaw<HeadcountKpiRow[]>`
    SELECT
      departamento,
      mes_pago,
      recibos_procesados,
      empleados_pagados,
      total_percepciones,
      total_deducciones,
      total_otros_pagos,
      total_dias_pagados,
      ticket_promedio_percepciones
    FROM mv_hr_headcount_costo_kpis
    WHERE ${where}
    ORDER BY mes_pago DESC, departamento ASC
  `;
  return rows;
}

// ------------------------------------------------------------
// Consulta #2 — Turnover y Movimientos de Personal
// ------------------------------------------------------------
export async function fetchTurnover(
  filters: PayrollDashboardFilters,
): Promise<TurnoverRow[]> {
  const { fragments } = buildScopeClauses(filters);
  const where = Prisma.join(fragments, ' AND ');

  const rows = await prisma.$queryRaw<TurnoverRow[]>`
    SELECT
      departamento,
      mes_pago,
      altas,
      bajas,
      reingresos,
      empleados_activos,
      total_recibos
    FROM mv_hr_turnover_mensual
    WHERE ${where}
    ORDER BY mes_pago ASC, departamento ASC
  `;
  return rows;
}

// ------------------------------------------------------------
// Consulta #3 — Mapa de Incidencias / Incapacidades
// ------------------------------------------------------------
export async function fetchIncapacidades(
  filters: PayrollDashboardFilters,
): Promise<IncapacidadRow[]> {
  const { fragments } = buildScopeClauses(filters);
  const where = Prisma.join(fragments, ' AND ');

  const rows = await prisma.$queryRaw<IncapacidadRow[]>`
    SELECT
      departamento,
      mes_pago,
      tipo_incapacidad,
      descripcion_tipo,
      numero_eventos,
      total_dias,
      promedio_dias_por_evento,
      importe_total,
      empleados_afectados
    FROM mv_hr_incapacidades_acumulado
    WHERE ${where}
    ORDER BY mes_pago ASC, tipo_incapacidad ASC
  `;
  return rows;
}

// ------------------------------------------------------------
// Consulta #4 — Control de Horas Extra por Departamento
// ------------------------------------------------------------
export async function fetchHorasExtra(
  filters: PayrollDashboardFilters,
): Promise<HorasExtraRow[]> {
  const { fragments } = buildScopeClauses(filters);
  const where = Prisma.join(fragments, ' AND ');

  const rows = await prisma.$queryRaw<HorasExtraRow[]>`
    SELECT
      departamento,
      mes_pago,
      tipo_horas,
      descripcion_tipo,
      numero_nominas,
      empleados,
      total_horas,
      total_dias,
      importe_total
    FROM mv_hr_horas_extra_por_depto
    WHERE ${where}
    ORDER BY departamento ASC, mes_pago ASC, tipo_horas ASC
  `;
  return rows;
}

// ------------------------------------------------------------
// Consulta #5 — Distribución de Plantilla
// ------------------------------------------------------------
export async function fetchPlantilla(
  filters: PayrollDashboardFilters,
): Promise<PlantillaRow[]> {
  const fragments: Prisma.Sql[] = [];
  fragments.push(Prisma.sql`organization_id = ${filters.organizationId}::uuid`);
  fragments.push(Prisma.sql`company_id = ${filters.companyId}::uuid`);
  if (filters.fiscalEntityId) {
    fragments.push(Prisma.sql`fiscal_entity_id = ${filters.fiscalEntityId}::uuid`);
  }
  if (filters.departamento) {
    fragments.push(Prisma.sql`departamento = ${filters.departamento}`);
  }
  const where = Prisma.join(fragments, ' AND ');

  const rows = await prisma.$queryRaw<PlantillaRow[]>`
    SELECT
      departamento,
      tipo_contrato,
      tipo_jornada,
      num_empleados,
      antiguedad_promedio_anios,
      sdi_promedio
    FROM mv_hr_plantilla_actual
    WHERE ${where}
    ORDER BY departamento ASC, tipo_contrato ASC, tipo_jornada ASC
  `;
  return rows;
}

// ------------------------------------------------------------
// Consulta #6 — Beneficios y Prestaciones
// ------------------------------------------------------------
export async function fetchBeneficios(
  filters: PayrollDashboardFilters,
): Promise<BeneficioRow[]> {
  const { fragments } = buildScopeClauses(filters);
  const where = Prisma.join(fragments, ' AND ');

  const rows = await prisma.$queryRaw<BeneficioRow[]>`
    SELECT
      departamento,
      mes_pago,
      tipo_percepcion,
      descripcion_beneficio,
      concepto,
      numero_aplicaciones,
      empleados_beneficiados,
      total_gravado,
      total_exento,
      importe_total
    FROM mv_hr_beneficios_prestaciones
    WHERE ${where}
    ORDER BY mes_pago ASC, departamento ASC, tipo_percepcion ASC
  `;
  return rows;
}

// ------------------------------------------------------------
// Función orquestadora — obtiene el cubo completo en paralelo
// ------------------------------------------------------------
export async function fetchHrDashboardAggregate(
  rawFilters: unknown,
): Promise<HrDashboardAggregate> {
  const filters = PayrollDashboardFiltersSchema.parse(rawFilters);

  const [headcountKpis, turnover, incapacidades, horasExtra, plantilla, beneficios] =
    await Promise.all([
      fetchHeadcountKpis(filters),
      fetchTurnover(filters),
      fetchIncapacidades(filters),
      fetchHorasExtra(filters),
      fetchPlantilla(filters),
      fetchBeneficios(filters),
    ]);

  return {
    headcountKpis,
    turnover,
    incapacidades,
    horasExtra,
    plantilla,
    beneficios,
  };
}

// ------------------------------------------------------------
// Dispara refresh de vistas (worker ETL).
// Recomendado: ejecutar en worker BullMQ dedicado, no en request.
// ------------------------------------------------------------
export async function refreshHrMaterializedViews(
  concurrent = false,
): Promise<{ updatedAt: Date }> {
  const rows = await prisma.$queryRaw<{ p_updated_at: Date }[]>`
    SELECT p_updated_at
    FROM refresh_hr_materialized_views(${concurrent}::boolean)
  `;
  return { updatedAt: rows[0].p_updated_at };
}

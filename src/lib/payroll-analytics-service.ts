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
// Expresión regular compatible para CUIDs antiguos (v1)
const cuidRegex = /^c[\w-]{24,}$/i;

export const PayrollDashboardFiltersSchema = z.object({
  organizationId: z.string().regex(cuidRegex, 'Invalid CUID').optional().nullable(),
  companyId: z.string().regex(cuidRegex, 'Invalid CUID').min(1),
  fiscalEntityId: z.string().regex(cuidRegex, 'Invalid CUID').optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  departamento: z.string().max(80).optional().nullable(),
  tipoNomina: z.string().max(5).optional().nullable(),
  periodicidad: z.string().max(5).optional().nullable(),
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

  if (filters.organizationId) {
    fragments.push(Prisma.sql`organization_id = ${filters.organizationId}`);
  }
  fragments.push(Prisma.sql`company_id = ${filters.companyId}`);

  if (filters.fiscalEntityId) {
    fragments.push(Prisma.sql`fiscal_entity_id = ${filters.fiscalEntityId}`);
  }

  if (filters.startDate) {
    fragments.push(Prisma.sql`mes_pago >= ${filters.startDate.toISOString().slice(0, 10)}::date`);
  }
  if (filters.endDate) {
    fragments.push(Prisma.sql`mes_pago <= ${filters.endDate.toISOString().slice(0, 10)}::date`);
  }

  if (filters.departamento) {
    fragments.push(Prisma.sql`departamento = ${filters.departamento}`);
  }

  if (filters.tipoNomina) {
    fragments.push(Prisma.sql`tipo_nomina = ${filters.tipoNomina}`);
  }

  if (filters.periodicidad) {
    fragments.push(Prisma.sql`periodicidad_pago = ${filters.periodicidad}`);
  }

  return { params, fragments };
}

// ------------------------------------------------------------
// Consulta #1 — KPIs globales (cards)
// ------------------------------------------------------------
export async function fetchHeadcountKpis(
  filters: PayrollDashboardFilters,
): Promise<HeadcountKpiRow[]> {
  if (!filters.startDate || !filters.endDate) return [];
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
  if (!filters.startDate || !filters.endDate) return [];
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
  if (!filters.startDate || !filters.endDate) return [];
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
  if (!filters.startDate || !filters.endDate) return [];
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
  if (!filters.startDate || !filters.endDate) return [];
  const fragments: Prisma.Sql[] = [];
  if (filters.organizationId) {
    fragments.push(Prisma.sql`organization_id = ${filters.organizationId}`);
  }
  fragments.push(Prisma.sql`company_id = ${filters.companyId}`);
  if (filters.fiscalEntityId) {
    fragments.push(Prisma.sql`fiscal_entity_id = ${filters.fiscalEntityId}`);
  }
  if (filters.departamento) {
    fragments.push(Prisma.sql`departamento = ${filters.departamento}`);
  }
  if (filters.tipoNomina) {
    fragments.push(Prisma.sql`tipo_nomina = ${filters.tipoNomina}`);
  }
  if (filters.periodicidad) {
    fragments.push(Prisma.sql`periodicidad_pago = ${filters.periodicidad}`);
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
  if (!filters.startDate || !filters.endDate) return [];
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

  // Si no hay fechas definidas, el tablero debe iniciar vacío (sin datos)
  // para obligar al usuario a realizar una consulta explícita.
  if (!filters.startDate || !filters.endDate) {
    return {
      headcountKpis: [],
      turnover: [],
      incapacidades: [],
      horasExtra: [],
      plantilla: [],
      beneficios: [],
    };
  }

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

// ============================================================
// src/lib/direccion-analytics-service.ts
// Servicio analítico Tablero RH Directivo (C-Level / Estratégico)
//
// PROHIBICIÓN ARQUITECTÓNICA (igual que payroll-analytics):
//   Nunca se parsea XML ni se agrega en runtime. Toda agregación
//   es hecha por PostgreSQL sobre mv_direccion_costo_ejecutivo_mensual.
//
// Técnicas de escala 10M+ CFDIs:
//   • ROW(anio, mes) prune predicado denso → evita Seq Scan
//   • Index Only Scan idx_mv_direccion_company_covering INCLUDE
//   • SET LOCAL parallel workers → agregados paralelos
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseISO, getYear, getMonth } from 'date-fns';
import type { DireccionViewMode } from '@/lib/direccion-dashboard-url';
import { statusFromDesviacionPct, type DesviacionStatus } from '@/lib/direccion-formatters';

// ============================================================================
// TIPOS EXPLÍCITOS (no any / no unknown)
// ============================================================================

export type DireccionCostoMensualRow = {
  organization_id?: string;
  company_id: string;
  fiscal_entity_id?: string;
  anio: number;
  mes: number;
  departamento?: string;
  count_recibos: number;
  count_empleados_unicos: number;
  percepciones_brutas_mxn: number;
  sbc_sumado_mxn: number;
  carga_patronal_estimada_mxn: number;
  isn_estimado_mxn: number;
  costo_total_nomina_mxn: number;
  costo_fijo_mxn: number;
  costo_variable_mxn: number;
  sueldos_001: number;
  aguinaldo_002: number;
  ptu_003: number;
  horas_extra_019: number;
  prima_vac_021: number;
  comisiones_028: number;
  bonos_038: number;
};

export type DireccionBudgetRow = {
  departamento: string;
  presupuesto_autorizado: number | null;
  costo_real_ejecutado: number;
  desviacion_abs: number;
  desviacion_pct: number;
  status_badge: DesviacionStatus | 'SIN_PRESUPUESTO';
};

export type DireccionKpiAggregates = Readonly<{
  costoTotalNominaMxn: number;
  percepcionesBrutas: number;
  cargaPatronalEstimada: number;
  isnEstimado: number;
  costoFijo: number;
  costoVariable: number;
  empleadosUnicos: number;
  countRecibos: number;
  desgloseFijoVariable: ReadonlyArray<{
    codigo: string;
    concepto: string;
    importe: number;
  }>;
}>;

export type DireccionTendenciaRow = Readonly<{
  anio: number;
  mes: number;
  quarter?: number | null;
  label: string;
  costoActual: number;
  costoYoY: number | null;
  diffAbsYoY: number | null;
  diffPctYoY: number | null;
}>;

export type DireccionFetchScope = Readonly<{
  companyId: string;
  organizationId?: string | null;
  fiscalEntityId?: string | null;
  startDate: string;
  endDate: string;
  departamento?: string | null;
}>;

// ============================================================================
// HELPERS: Row-Values prune (dense GROUP BY keys anio/mes)
// ============================================================================

type DateBounds = {
  sYear: number;
  sMonth: number;
  eYear: number;
  eMonth: number;
};

function _rangeBounds(startDateIso: string | Date, endDateIso: string | Date): DateBounds {
  const s = typeof startDateIso === 'string' ? parseISO(startDateIso) : startDateIso;
  const e = typeof endDateIso === 'string' ? parseISO(endDateIso) : endDateIso;
  return {
    sYear: getYear(s),
    sMonth: getMonth(s) + 1,
    eYear: getYear(e),
    eMonth: getMonth(e) + 1,
  };
}

function _companyScopeClauses(args: DireccionFetchScope): {
  whereFragments: Prisma.Sql[];
  includeParams: Prisma.Sql[];
} {
  const whereFragments: Prisma.Sql[] = [];
  const includeParams: Prisma.Sql[] = [];
  whereFragments.push(Prisma.sql`company_id = ${args.companyId}::text`);
  if (args.fiscalEntityId) {
    whereFragments.push(Prisma.sql`fiscal_entity_id = ${args.fiscalEntityId}::text`);
  }
  if (args.departamento) {
    whereFragments.push(Prisma.sql`departamento = ${args.departamento}::varchar(120)`);
  }
  return { whereFragments, includeParams };
}

// ============================================================================
// Fn #0: SET LOCAL parallel workers (1 transacción → Prisma $queryRawUnsafe multiple)
// ============================================================================

export async function setParallelWorkersDireccion(
  p: PrismaClient = prisma,
): Promise<void> {
  try {
    await p.$executeRawUnsafe(`SET LOCAL max_parallel_workers_per_gather = 4;`);
    await p.$executeRawUnsafe(`SET LOCAL parallel_setup_cost = 0;`);
    await p.$executeRawUnsafe(`SET LOCAL parallel_tuple_cost = 0;`);
  } catch {
    // SET LOCAL solo aplica por transacción; si falla no rompe nada.
    // Permite degradación elegante sin parallel.
  }
}

// ============================================================================
// Fn #1: KPIs Globales (4 tarjetas C-Level)
// ============================================================================

export async function fetchDireccionKpisAggregates(
  scope: DireccionFetchScope,
): Promise<DireccionKpiAggregates> {
  const { sYear, sMonth, eYear, eMonth } = _rangeBounds(scope.startDate, scope.endDate);
  const { whereFragments } = _companyScopeClauses(scope);
  whereFragments.push(
    Prisma.sql`ROW(anio, mes) >= ROW(${sYear}::int, ${sMonth}::int)`,
  );
  whereFragments.push(
    Prisma.sql`ROW(anio, mes) <= ROW(${eYear}::int, ${eMonth}::int)`,
  );
  const where = Prisma.join(whereFragments, ' AND ');

  const rows = await prisma.$queryRaw<DireccionCostoMensualRow[]>`
    SELECT
      COALESCE(SUM(count_recibos), 0)::FLOAT8                             AS count_recibos,
      COALESCE(SUM(count_empleados_unicos), 0)::FLOAT8                    AS count_empleados_unicos,
      COALESCE(SUM(percepciones_brutas_mxn), 0)::FLOAT8                   AS percepciones_brutas_mxn,
      COALESCE(SUM(sbc_sumado_mxn), 0)::FLOAT8                            AS sbc_sumado_mxn,
      COALESCE(SUM(carga_patronal_estimada_mxn), 0)::FLOAT8                AS carga_patronal_estimada_mxn,
      COALESCE(SUM(isn_estimado_mxn), 0)::FLOAT8                          AS isn_estimado_mxn,
      COALESCE(SUM(costo_total_nomina_mxn), 0)::FLOAT8                    AS costo_total_nomina_mxn,
      COALESCE(SUM(costo_fijo_mxn), 0)::FLOAT8                            AS costo_fijo_mxn,
      COALESCE(SUM(costo_variable_mxn), 0)::FLOAT8                        AS costo_variable_mxn,
      COALESCE(SUM(sueldos_001), 0)::FLOAT8                                AS sueldos_001,
      COALESCE(SUM(aguinaldo_002), 0)::FLOAT8                              AS aguinaldo_002,
      COALESCE(SUM(ptu_003), 0)::FLOAT8                                    AS ptu_003,
      COALESCE(SUM(horas_extra_019), 0)::FLOAT8                            AS horas_extra_019,
      COALESCE(SUM(prima_vac_021), 0)::FLOAT8                              AS prima_vac_021,
      COALESCE(SUM(comisiones_028), 0)::FLOAT8                             AS comisiones_028,
      COALESCE(SUM(bonos_038), 0)::FLOAT8                                  AS bonos_038
    FROM mv_direccion_costo_ejecutivo_mensual
    WHERE ${where}
  `;

  const r = (rows as unknown as Array<Record<string, number>>)[0] ?? {};
  const perc = Number(r.percepciones_brutas_mxn ?? 0);
  const cp = Number(r.carga_patronal_estimada_mxn ?? 0);
  const isn = Number(r.isn_estimado_mxn ?? 0);
  const fijo = Number(r.costo_fijo_mxn ?? 0);
  const vari = Number(r.costo_variable_mxn ?? 0);
  const costoTotal = perc + cp + isn;

  const desglose = [
    { codigo: '001', concepto: 'Sueldos y Salarios',          importe: Number(r.sueldos_001 ?? 0) },
    { codigo: '002', concepto: 'Aguinaldo',                    importe: Number(r.aguinaldo_002 ?? 0) },
    { codigo: '003', concepto: 'PTU (Participación Utilidades)', importe: Number(r.ptu_003 ?? 0) },
    { codigo: '019', concepto: 'Horas Extra',                   importe: Number(r.horas_extra_019 ?? 0) },
    { codigo: '021', concepto: 'Prima Vacacional',               importe: Number(r.prima_vac_021 ?? 0) },
    { codigo: '028', concepto: 'Comisiones',                     importe: Number(r.comisiones_028 ?? 0) },
    { codigo: '038', concepto: 'Bonos de Productividad',         importe: Number(r.bonos_038 ?? 0) },
  ].sort((a, b) => b.importe - a.importe);

  return {
    costoTotalNominaMxn: costoTotal,
    percepcionesBrutas: perc,
    cargaPatronalEstimada: cp,
    isnEstimado: isn,
    costoFijo: fijo,
    costoVariable: vari,
    empleadosUnicos: Number(r.count_empleados_unicos ?? 0),
    countRecibos: Number(r.count_recibos ?? 0),
    desgloseFijoVariable: desglose,
  };
}

// ============================================================================
// Fn #2: Tendencia Histórica + YoY (Mensual / Trimestral / Anual)
// ============================================================================

export async function fetchDireccionTendenciaHistorica(
  scope: DireccionFetchScope & {
    anioComparativo?: number | null;
    view?: DireccionViewMode;
  },
): Promise<DireccionTendenciaRow[]> {
  const view: DireccionViewMode = scope.view ?? 'monthly';
  const { sYear, sMonth, eYear, eMonth } = _rangeBounds(scope.startDate, scope.endDate);

  const anioComp =
    scope.anioComparativo ??
    Math.max(2000, sYear - 1);

  const { whereFragments } = _companyScopeClauses(scope);

  // Granularidad GROUP BY
  let groupExpr: Prisma.Sql;
  let labelExpr: Prisma.Sql;
  if (view === 'yearly') {
    groupExpr = Prisma.sql`anio`;
    labelExpr = Prisma.sql`anio::VARCHAR(4)`;
  } else if (view === 'quarterly') {
    groupExpr = Prisma.sql`anio, CEIL(mes / 3.0)::INT`;
    labelExpr = Prisma.sql`(anio::VARCHAR(4) || ' Q' || CEIL(mes / 3.0)::INT::VARCHAR(1))`;
  } else {
    groupExpr = Prisma.sql`anio, mes`;
    labelExpr = Prisma.sql`TO_CHAR(TO_DATE(LPAD(mes::VARCHAR(2),2,'0') || ' ' || LPAD(anio::VARCHAR(4),4,'0'), 'MM YYYY'), 'Mon/YY')`;
  }

  // Query período actual + período YoY en un solo scan
  whereFragments.push(
    Prisma.sql` (
      (ROW(anio, mes) >= ROW(${sYear}::int, ${sMonth}::int) AND ROW(anio, mes) <= ROW(${eYear}::int, ${eMonth}::int))
      OR
      (ROW(anio, mes) >= ROW(${anioComp}::int, ${sMonth}::int) AND ROW(anio, mes) <= ROW(${anioComp + (eYear - sYear)}::int, ${eMonth}::int))
    )`,
  );
  const where = Prisma.join(whereFragments, ' AND ');

  const raw = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH buckets AS (
      SELECT
        ${groupExpr} AS _group_key,
        anio,
        mes,
        ${labelExpr} AS label,
        SUM(costo_total_nomina_mxn)::FLOAT8 AS costo
      FROM mv_direccion_costo_ejecutivo_mensual
      WHERE ${where}
      GROUP BY 1,2,3,4
      ORDER BY 1
    )
    SELECT * FROM buckets
  `);

  // Pivot: renglón actual vs renglón YoY
  const actualMap = new Map<string, DireccionTendenciaRow>();
  const yoyMap = new Map<string, number>();

  const yearOffset = sYear - anioComp;
  for (const r of raw) {
    const anio = Number(r.anio);
    const mes = Number(r.mes);
    const costo = Number(r.costo ?? 0);
    const label = String(r.label ?? '');
    if (anio === sYear || (eYear !== sYear && anio >= sYear && anio <= eYear)) {
      let quarter: number | null = null;
      if (view === 'quarterly') quarter = Math.ceil(mes / 3);
      actualMap.set(`${anio}-${mes}`, {
        anio, mes, quarter, label,
        costoActual: costo, costoYoY: null,
        diffAbsYoY: null, diffPctYoY: null,
      });
    } else if (anio === anioComp || (eYear !== sYear && anio >= anioComp && anio <= anioComp + (eYear - sYear))) {
      const mesEq = mes;
      const anioEq = anio + yearOffset;
      yoyMap.set(`${anioEq}-${mesEq}`, costo);
    }
  }

  const result: DireccionTendenciaRow[] = [];
  for (const k of Array.from(actualMap.keys()).sort()) {
    const row = actualMap.get(k)!;
    const yoy = yoyMap.get(k);
    if (yoy === undefined) {
      result.push(row);
      continue;
    }
    const diffAbs = row.costoActual - yoy;
    const diffPct = yoy > 0 ? diffAbs / yoy : null;
    result.push({
      ...row,
      costoYoY: yoy,
      diffAbsYoY: diffAbs,
      diffPctYoY: diffPct,
    });
  }
  return result;
}

// ============================================================================
// Fn #3: Desviación Presupuestal por Departamento
//   OP-1 MVP (BudgetDepartment no existe): presupuesto_autorizado = NULL
//   No hace JOIN a budget_departments (evita "relation does not exist").
// ============================================================================

export async function fetchDireccionDesviacionPresupuestal(
  scope: DireccionFetchScope,
): Promise<DireccionBudgetRow[]> {
  const { sYear, sMonth, eYear, eMonth } = _rangeBounds(scope.startDate, scope.endDate);
  const { whereFragments } = _companyScopeClauses(scope);
  whereFragments.push(
    Prisma.sql`ROW(anio, mes) >= ROW(${sYear}::int, ${sMonth}::int)`,
  );
  whereFragments.push(
    Prisma.sql`ROW(anio, mes) <= ROW(${eYear}::int, ${eMonth}::int)`,
  );
  const where = Prisma.join(whereFragments, ' AND ');

  type RowSql = { departamento: string; costo_real: number };
  const rows = await prisma.$queryRaw<RowSql[]>`
    SELECT
      departamento::VARCHAR(120)                                     AS departamento,
      COALESCE(SUM(costo_total_nomina_mxn), 0)::FLOAT8                AS costo_real
    FROM mv_direccion_costo_ejecutivo_mensual
    WHERE ${where}
    GROUP BY 1
    ORDER BY costo_real DESC
  `;

  const result: DireccionBudgetRow[] = rows.map(r => {
    const real = Number(r.costo_real ?? 0);
    // MVP: sin BudgetDepartment → NULL; status SIN_PRESUPUESTO
    const presupuesto: number | null = null;
    const desviacion = presupuesto === null ? 0 : real - presupuesto;
    const pct = presupuesto === null || presupuesto === 0 ? 0 : desviacion / presupuesto;
    const status: DesviacionStatus | 'SIN_PRESUPUESTO' =
      presupuesto === null ? 'SIN_PRESUPUESTO' : statusFromDesviacionPct(pct);
    return {
      departamento: r.departamento,
      presupuesto_autorizado: presupuesto,
      costo_real_ejecutado: real,
      desviacion_abs: desviacion,
      desviacion_pct: pct,
      status_badge: status,
    };
  });

  // Orden: peores desviaciones primero (status FUERA_DE_PRESUPUESTO antes).
  // Si todos son SIN_PRESUPUESTO → ordenar por costo_real desc.
  const statusOrder: Record<DesviacionStatus | 'SIN_PRESUPUESTO', number> = {
    FUERA_DE_PRESUPUESTO: 0,
    ATENCION: 1,
    EN_LINEA: 2,
    SIN_PRESUPUESTO: 3,
  };
  return result.sort(
    (a, b) => statusOrder[a.status_badge] - statusOrder[b.status_badge]
              || Math.abs(b.desviacion_pct) - Math.abs(a.desviacion_pct)
              || b.costo_real_ejecutado - a.costo_real_ejecutado,
  );
}

// ============================================================================
// Fn #4: Delta período actual vs período anterior (igual duración)
//   Usado en los Trend Indicators ↑↓ de las KPI Cards.
// ============================================================================

export async function fetchDireccionPeriodoAnterior(
  scope: DireccionFetchScope,
): Promise<DireccionKpiAggregates> {
  const start = parseISO(scope.startDate);
  const end = parseISO(scope.endDate);
  const monthsBack = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
  );
  const startPrev = new Date(start); startPrev.setMonth(startPrev.getMonth() - monthsBack);
  const endPrev = new Date(end);       endPrev.setMonth(endPrev.getMonth() - monthsBack);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return fetchDireccionKpisAggregates({
    ...scope,
    startDate: toIso(startPrev),
    endDate: toIso(endPrev),
  });
}

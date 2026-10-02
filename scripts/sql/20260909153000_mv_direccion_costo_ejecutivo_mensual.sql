-- ============================================================
-- MIGRACIÓN: Vista Materializada Ejecutiva Dirección General
-- Tablero: RH Directivo (C-Level / Estratégico)
-- Propósito: Pre-calcular Costo Total Nómina consolidado
--            (Percepciones Brutas + Carga Patronal 30.4% IMSS/INFONAVIT
--             + ISN Estatal paramétrico) + Desglose Fijo/Variable
--             por (org, company, fe, año, mes, departamento).
-- Rendimiento: INDEX ONLY SCAN covering columnas KPI → < 900ms
--              sobre 10M+ CFDIs históricos.
-- Pipeline ETL: REFRESH MATERIALIZED VIEW CONCURRENTLY posterior
--               a ingestión de batch nóminas BullMQ.
-- ============================================================

-- ------------------------------------------------------------
-- PASO 1: Dropear MV + índices si existen (idempotente)
-- ------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_direccion_costo_ejecutivo_mensual CASCADE;

-- ------------------------------------------------------------
-- PASO 2: Crear MV con GROUP BY denso
--   granularidad = (org, company, fe, anio, mes, departamento)
--   Excluye cancelados = Invoice.sat_status = 'CANCELADO'
--   Incluye sat_status IS NULL (no sincronizado aún = tratar como VIGENTE)
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_direccion_costo_ejecutivo_mensual AS
WITH
  ------------------------------------------------------------------
  -- CTE #1: Base join principal
  --   payroll_receipts × payroll_receptors 1:1
  --   × invoices (LEFT JOIN, para filtro CANCELADO)
  ------------------------------------------------------------------
  base AS (
    SELECT
      pr.organization_id,
      pr.company_id,
      pr.fiscal_entity_id,
      EXTRACT(YEAR  FROM pr.fecha_pago)::INT                        AS anio,
      EXTRACT(MONTH FROM pr.fecha_pago)::INT                        AS mes,
      COALESCE(NULLIF(prre.departamento, ''),
               NULLIF(pr.departamento,   ''),
               'Sin Departamento')::VARCHAR(120)                    AS departamento,
      pr.id                                                          AS pr_id,
      pr.total_percepciones                                          AS total_percepciones,
      pr.num_dias_pagados                                            AS num_dias_pagados,
      prre.salario_base_cot_apor                                     AS sbc,
      COALESCE(
        NULLIF(prre.curp,        ''),
        NULLIF(prre.num_empleado, ''),
        NULLIF(prre.rfc,         '')
      )                                                              AS empleado_key,
      prre.clave_ent_fed                                             AS clave_ent_fed
    FROM payroll_receipts pr
    JOIN payroll_receptors prre
      ON prre.payroll_receipt_id = pr.id
    LEFT JOIN invoices inv
      ON inv.id = pr.invoice_id
    WHERE (inv.sat_status IS NULL OR inv.sat_status <> 'CANCELADO')
  ),
  ------------------------------------------------------------------
  -- CTE #2: Desglose Percepciones Fijo / Variable por grupo denso
  --   JOIN payroll_percepciones × pr_id
  --   Clasificación SAT Anexo 8 v1.2:
  --     FIJO     = 001 Sueldos y Salarios
  --     VARIABLE = 002 Aguinaldo, 003 PTU,
  --                019 Horas Extra, 021 Prima Vacacional,
  --                028 Comisiones, 038 Bonos Productividad
  ------------------------------------------------------------------
  desglose_percepciones AS (
    SELECT
      b.organization_id,
      b.company_id,
      b.fiscal_entity_id,
      b.anio,
      b.mes,
      b.departamento,
      SUM(pp.importe_gravado + pp.importe_exento)
        FILTER (WHERE pp.tipo_percepcion = '001')                  AS sueldos_001,
      SUM(pp.importe_gravado + pp.importe_exento)
        FILTER (WHERE pp.tipo_percepcion = '002')                  AS aguinaldo_002,
      SUM(pp.importe_gravado + pp.importe_exento)
        FILTER (WHERE pp.tipo_percepcion = '003')                  AS ptu_003,
      SUM(pp.importe_gravado + pp.importe_exento)
        FILTER (WHERE pp.tipo_percepcion = '019')                  AS horas_extra_019,
      SUM(pp.importe_gravado + pp.importe_exento)
        FILTER (WHERE pp.tipo_percepcion = '021')                  AS prima_vac_021,
      SUM(pp.importe_gravado + pp.importe_exento)
        FILTER (WHERE pp.tipo_percepcion = '028')                  AS comisiones_028,
      SUM(pp.importe_gravado + pp.importe_exento)
        FILTER (WHERE pp.tipo_percepcion = '038')                  AS bonos_038
    FROM base b
    JOIN payroll_percepciones pp
      ON pp.payroll_receipt_id = b.pr_id
    WHERE pp.tipo_percepcion IN ('001','002','003','019','021','028','038')
    GROUP BY 1,2,3,4,5,6
  ),
  ------------------------------------------------------------------
  -- CTE #3: Agregaciones base + Carga Patronal + ISN Estatal
  --   Fórmulas paramétricas (configurables post-MVP):
  --     CARGA_PATRONAL_DEFAULT = 0.3040
  --       (28% IMSS cuota patronal + 2.4% INFONAVIT sobre SBC diario)
  --     ISN por Entidad Federativa: 2% a 3%
  --       (tabla oficial SHCP ISN estatal vigente 2026)
  ------------------------------------------------------------------
  agregaciones AS (
    SELECT
      organization_id,
      company_id,
      fiscal_entity_id,
      anio,
      mes,
      departamento,
      COUNT(DISTINCT pr_id)::INT                                    AS count_recibos,
      COUNT(DISTINCT empleado_key)::INT                             AS count_empleados_unicos,
      COALESCE(SUM(total_percepciones), 0)::NUMERIC(18,6)           AS percepciones_brutas_mxn,
      COALESCE(SUM(sbc * num_dias_pagados), 0)::NUMERIC(18,6)       AS sbc_sumado_mxn,
      ------------------------------------------------------------------
      -- Clave modal Entidad Federativa por grupo denso
      -- (típicamente la misma para todo un departamento/empresa).
      -- Usamos MAX para obtener una clave representativa sin joins
      -- correlacionados por fila (escala 10M rows).
      ------------------------------------------------------------------
      COALESCE(MAX(NULLIF(clave_ent_fed, '')), '00')::VARCHAR(2)   AS clave_ent_fed_modal
    FROM base
    GROUP BY 1,2,3,4,5,6
  ),
  ------------------------------------------------------------------
  -- CTE wrapper de parámetros ISN
  --   Evita repetir CASE 32 ramas x2 (ISN + CostoTotal).
  --   Se materializa 1 vez por fila densa.
  ------------------------------------------------------------------
  params_financieros AS (
    SELECT
      a.*,
      (a.sbc_sumado_mxn * 0.3040)::NUMERIC(18,6)                     AS _carga_patronal,
      CASE a.clave_ent_fed_modal
        WHEN '01' THEN 0.025  WHEN '02' THEN 0.020
        WHEN '03' THEN 0.020  WHEN '04' THEN 0.030
        WHEN '05' THEN 0.020  WHEN '06' THEN 0.025
        WHEN '07' THEN 0.020  WHEN '08' THEN 0.020
        WHEN '09' THEN 0.030  WHEN '10' THEN 0.020
        WHEN '11' THEN 0.025  WHEN '12' THEN 0.020
        WHEN '13' THEN 0.020  WHEN '14' THEN 0.020
        WHEN '15' THEN 0.020  WHEN '16' THEN 0.020
        WHEN '17' THEN 0.020  WHEN '18' THEN 0.020
        WHEN '19' THEN 0.020  WHEN '20' THEN 0.030
        WHEN '21' THEN 0.025  WHEN '22' THEN 0.020
        WHEN '23' THEN 0.020  WHEN '24' THEN 0.025
        WHEN '25' THEN 0.020  WHEN '26' THEN 0.020
        WHEN '27' THEN 0.020  WHEN '28' THEN 0.020
        WHEN '29' THEN 0.020  WHEN '30' THEN 0.025
        WHEN '31' THEN 0.020  WHEN '32' THEN 0.020
        ELSE               0.025
      END::NUMERIC(8,6)                                               AS _isn_pct
    FROM agregaciones a
  )
SELECT
  pf.organization_id,
  pf.company_id,
  pf.fiscal_entity_id,
  pf.anio::INT,
  pf.mes::INT,
  pf.departamento,
  pf.count_recibos,
  pf.count_empleados_unicos,
  pf.percepciones_brutas_mxn,
  pf.sbc_sumado_mxn,
  ROUND(pf._carga_patronal, 6)::NUMERIC(18,6)                         AS carga_patronal_estimada_mxn,
  ROUND(pf.percepciones_brutas_mxn * pf._isn_pct, 6)::NUMERIC(18,6)   AS isn_estimado_mxn,
  ROUND(
    pf.percepciones_brutas_mxn +
    pf._carga_patronal +
    (pf.percepciones_brutas_mxn * pf._isn_pct),
    6
  )::NUMERIC(18,6)                                                    AS costo_total_nomina_mxn,
  COALESCE(dp.sueldos_001,     0)::NUMERIC(18,6)                      AS sueldos_001,
  COALESCE(dp.aguinaldo_002,   0)::NUMERIC(18,6)                      AS aguinaldo_002,
  COALESCE(dp.ptu_003,         0)::NUMERIC(18,6)                      AS ptu_003,
  COALESCE(dp.horas_extra_019, 0)::NUMERIC(18,6)                      AS horas_extra_019,
  COALESCE(dp.prima_vac_021,   0)::NUMERIC(18,6)                      AS prima_vac_021,
  COALESCE(dp.comisiones_028,  0)::NUMERIC(18,6)                      AS comisiones_028,
  COALESCE(dp.bonos_038,       0)::NUMERIC(18,6)                      AS bonos_038,
  COALESCE(dp.sueldos_001,     0)::NUMERIC(18,6)                      AS costo_fijo_mxn,
  (
    COALESCE(dp.aguinaldo_002,   0) +
    COALESCE(dp.ptu_003,         0) +
    COALESCE(dp.horas_extra_019, 0) +
    COALESCE(dp.prima_vac_021,   0) +
    COALESCE(dp.comisiones_028,  0) +
    COALESCE(dp.bonos_038,       0)
  )::NUMERIC(18,6)                                                    AS costo_variable_mxn
FROM params_financieros pf
LEFT JOIN desglose_percepciones dp
       ON dp.organization_id = pf.organization_id
      AND dp.company_id      = pf.company_id
      AND dp.fiscal_entity_id= pf.fiscal_entity_id
      AND dp.anio            = pf.anio
      AND dp.mes             = pf.mes
      AND dp.departamento    = pf.departamento
WITH DATA;

-- ------------------------------------------------------------
-- PASO 3: Crear 3 índices post-MV
--   #1 UNIQUE PK       → requisito REFRESH CONCURRENTLY
--   #2 COVERING KPI    → Index Only Scan queries KPI / Tendencia
--   #3 DEPARTAMENTO    → queries Desviación Presupuestal
-- ------------------------------------------------------------

-- Índice #1: Clave única densa (REFRESH CONCURRENTLY mandatory)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_direccion_pk
  ON mv_direccion_costo_ejecutivo_mensual
     (organization_id, company_id, fiscal_entity_id, anio, mes, departamento);

-- Índice #2: Covering KPI queries + Tendencia (Index Only Scan target)
--   INCLUDE todas cols que usa la UI: no requiere Heap Fetches.
CREATE INDEX IF NOT EXISTS idx_mv_direccion_company_covering
  ON mv_direccion_costo_ejecutivo_mensual
     (company_id, anio DESC, mes DESC)
  INCLUDE (
    costo_total_nomina_mxn,
    percepciones_brutas_mxn,
    carga_patronal_estimada_mxn,
    isn_estimado_mxn,
    costo_fijo_mxn,
    costo_variable_mxn,
    count_empleados_unicos,
    count_recibos,
    sueldos_001,
    aguinaldo_002,
    ptu_003,
    horas_extra_019,
    prima_vac_021,
    comisiones_028,
    bonos_038,
    departamento,
    sbc_sumado_mxn
  );

-- Índice #3: Por Departamento (Desviación Presupuestal JOIN)
CREATE INDEX IF NOT EXISTS idx_mv_direccion_company_depto
  ON mv_direccion_costo_ejecutivo_mensual
     (company_id, departamento, anio DESC, mes DESC);

-- ------------------------------------------------------------
-- PASO 4: ANALYZE para estadísticas del planificador Postgres
-- ------------------------------------------------------------
ANALYZE mv_direccion_costo_ejecutivo_mensual;

-- ============================================================
-- FUNCIÓN HELPER: refresh_direccion_materialized_views()
-- Pipeline ETL / BullMQ llama CONCURRENT => TRUE asíncrono.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_direccion_materialized_views(
  IN  p_concurrent BOOLEAN DEFAULT FALSE,
  OUT p_updated_at TIMESTAMPTZ
) LANGUAGE plpgsql AS $$
BEGIN
  IF p_concurrent THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_direccion_costo_ejecutivo_mensual;
  ELSE
    REFRESH MATERIALIZED VIEW mv_direccion_costo_ejecutivo_mensual;
  END IF;
  ANALYZE mv_direccion_costo_ejecutivo_mensual;
  p_updated_at := NOW();
END;$$;

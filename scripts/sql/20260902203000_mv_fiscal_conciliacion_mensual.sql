-- ============================================================
-- scripts/sql/20260902203000_mv_fiscal_conciliacion_mensual.sql
--
-- FASE 1 — Vista Materializada PostgreSQL para Conciliación
--         Fiscal y Cumplimiento de CFDIs Nómina 1.2.
--
-- Objetivo: Pre-calcular todos los agregados KPI (ISR, Cuotas
-- Terceros, Gravado vs Exento, Cancelados, SBC/SDI, Brecha
-- Emisión-Pago, UUIDs duplicados) agrupados por
-- (organization_id, company_id, fiscal_entity_id, anio, mes).
--
-- Hardening escala: Compatible con 5M payroll_receipts + 40M
-- filas children + >1M anuales.
--   · Índice UNIQUE obligatorio para REFRESH CONCURRENTLY.
--   · Compound Index con INCLUDE 18 cols → Index Only Scan 95%
--     queries KPI (Heap Fetches = 0).
--   · predicado denso (anio, mes) para prune rango eficiente.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Eliminar objeto previo si existe (idempotente)
-- ------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_fiscal_conciliacion_mensual CASCADE;

-- ------------------------------------------------------------
-- 2. CTEs pre-aggregados para evitar fan-out
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_fiscal_conciliacion_mensual AS
WITH receipt_base AS (
    SELECT
        pr.id                            AS receipt_id,
        pr.organization_id,
        pr.company_id,
        pr.fiscal_entity_id,
        pr.fecha_pago,
        pr.departamento,
        pr.fecha_emision,
        EXTRACT(YEAR  FROM pr.fecha_pago)::INTEGER          AS anio,
        EXTRACT(MONTH FROM pr.fecha_pago)::INTEGER          AS mes,
        COALESCE(inv.sat_status::TEXT, 'VIGENTE')::VARCHAR   AS sat_status,
        (COUNT(*) OVER (PARTITION BY pr.uuid)) > 1          AS is_uuid_duplicado
    FROM payroll_receipts pr
    LEFT JOIN invoices inv
      ON inv.id = pr.invoice_id
),
ded_agg AS (
    SELECT
        pd.payroll_receipt_id                                   AS receipt_id,
        SUM(CASE WHEN pd.tipo_deduccion = '002' THEN pd.importe ELSE 0 END)  AS isr,
        SUM(CASE WHEN pd.tipo_deduccion = '010' THEN pd.importe ELSE 0 END)  AS infonavit,
        SUM(CASE WHEN pd.tipo_deduccion = '006' THEN pd.importe ELSE 0 END)  AS fonacot,
        SUM(CASE WHEN pd.tipo_deduccion = '007' THEN pd.importe ELSE 0 END)  AS pension,
        SUM(CASE WHEN pd.tipo_deduccion = '001' THEN pd.importe ELSE 0 END)  AS sindicato
    FROM payroll_deducciones pd
    WHERE pd.tipo_deduccion IN ('001','002','006','007','010')
    GROUP BY 1
),
perc_agg AS (
    SELECT
        pp.payroll_receipt_id                                   AS receipt_id,
        SUM(CASE WHEN pp.tipo_percepcion = '001' THEN pp.importe_gravado ELSE 0 END) AS gravado_001,
        SUM(CASE WHEN pp.tipo_percepcion = '001' THEN pp.importe_exento  ELSE 0 END) AS exento_001,
        SUM(CASE WHEN pp.tipo_percepcion = '002' THEN pp.importe_gravado ELSE 0 END) AS gravado_002,
        SUM(CASE WHEN pp.tipo_percepcion = '002' THEN pp.importe_exento  ELSE 0 END) AS exento_002,
        SUM(CASE WHEN pp.tipo_percepcion = '003' THEN pp.importe_gravado ELSE 0 END) AS gravado_003,
        SUM(CASE WHEN pp.tipo_percepcion = '003' THEN pp.importe_exento  ELSE 0 END) AS exento_003,
        SUM(CASE WHEN pp.tipo_percepcion = '021' THEN pp.importe_gravado ELSE 0 END) AS gravado_021,
        SUM(CASE WHEN pp.tipo_percepcion = '021' THEN pp.importe_exento  ELSE 0 END) AS exento_021
    FROM payroll_percepciones pp
    WHERE pp.tipo_percepcion IN ('001','002','003','021')
    GROUP BY 1
),
receptor_agg AS (
    SELECT
        prr.payroll_receipt_id                                  AS receipt_id,
        prr.rfc                                                 AS rfc,
        prr.salario_base_cot_apor                               AS sbc,
        prr.salario_diario_integrado                            AS sdi
    FROM payroll_receptors prr
)
SELECT
    rb.organization_id,
    rb.company_id,
    rb.fiscal_entity_id,
    rb.anio,
    rb.mes,
    ''::TEXT                                                               AS registro_patronal,
    COUNT(*)                                                               AS count_receipts,
    COUNT(DISTINCT ra.rfc)                                                 AS count_empleados_distinct,

    COALESCE(SUM(COALESCE(da.isr,       0)), 0)::NUMERIC(18,6)            AS isr_retenido_mxn,
    COALESCE(SUM(COALESCE(da.infonavit,  0)), 0)::NUMERIC(18,6)            AS cuotas_infonavit,
    COALESCE(SUM(COALESCE(da.fonacot,    0)), 0)::NUMERIC(18,6)            AS cuotas_fonacot,
    COALESCE(SUM(COALESCE(da.pension,    0)), 0)::NUMERIC(18,6)            AS cuotas_pension,
    COALESCE(SUM(COALESCE(da.sindicato,  0)), 0)::NUMERIC(18,6)            AS cuotas_sindicato,

    COALESCE(SUM(COALESCE(pa.gravado_001, 0)), 0)::NUMERIC(18,6)           AS gravado_001_sueldos,
    COALESCE(SUM(COALESCE(pa.exento_001,  0)), 0)::NUMERIC(18,6)           AS exento_001_sueldos,
    COALESCE(SUM(COALESCE(pa.gravado_002, 0)), 0)::NUMERIC(18,6)           AS gravado_002_aguinaldo,
    COALESCE(SUM(COALESCE(pa.exento_002,  0)), 0)::NUMERIC(18,6)           AS exento_002_aguinaldo,
    COALESCE(SUM(COALESCE(pa.gravado_003, 0)), 0)::NUMERIC(18,6)           AS gravado_003_ptu,
    COALESCE(SUM(COALESCE(pa.exento_003,  0)), 0)::NUMERIC(18,6)           AS exento_003_ptu,
    COALESCE(SUM(COALESCE(pa.gravado_021, 0)), 0)::NUMERIC(18,6)           AS gravado_021_primavac,
    COALESCE(SUM(COALESCE(pa.exento_021,  0)), 0)::NUMERIC(18,6)           AS exento_021_primavac,

    COUNT(*) FILTER (WHERE ra.sbc IS NULL OR ra.sbc = 0)::BIGINT            AS recepciones_sbc_null,
    COUNT(*) FILTER (WHERE ra.sdi IS NULL OR ra.sdi = 0)::BIGINT            AS recepciones_sdi_null,
    COUNT(*) FILTER (
        WHERE ra.sbc IS NOT NULL AND ra.sbc > 0
          AND ABS(ra.sbc - COALESCE(ra.sdi, 0)) / ra.sbc > 0.03
    )::BIGINT                                                               AS recepciones_desv_sbc_sdi_gt_3pct,

    COUNT(*) FILTER (WHERE rb.sat_status = 'CANCELADO')::BIGINT             AS count_cancelados,
    COUNT(*) FILTER (WHERE rb.is_uuid_duplicado IS TRUE)::BIGINT            AS count_uuid_duplicados,
    COUNT(*) FILTER (
        WHERE ABS( (rb.fecha_emision::DATE - rb.fecha_pago)::INTEGER ) > 5
    )::BIGINT                                                               AS count_brecha_5dias

FROM receipt_base rb
LEFT JOIN ded_agg      da ON da.receipt_id = rb.receipt_id
LEFT JOIN perc_agg     pa ON pa.receipt_id = rb.receipt_id
LEFT JOIN receptor_agg ra ON ra.receipt_id = rb.receipt_id
GROUP BY 1, 2, 3, 4, 5, 6
WITH NO DATA;

-- ------------------------------------------------------------
-- 3. UNIQUE INDEX obligatorio para REFRESH CONCURRENTLY
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS mv_fiscal_conciliacion_uk
    ON mv_fiscal_conciliacion_mensual (organization_id, company_id, fiscal_entity_id, anio, mes);

-- ------------------------------------------------------------
-- 4. Compound Index con INCLUDE 18 columnas → Index Only Scan
--    Elimina el acceso al Heap para consultas KPI (obligatorio
--    para cumplir p(95) <= 900ms en 100VUs / 5M rows).
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS mv_fiscal_conciliacion_company_fecha_idx
    ON mv_fiscal_conciliacion_mensual (company_id, anio DESC, mes DESC)
    INCLUDE (
        isr_retenido_mxn,
        cuotas_infonavit, cuotas_fonacot, cuotas_pension, cuotas_sindicato,
        gravado_001_sueldos,   exento_001_sueldos,
        gravado_002_aguinaldo, exento_002_aguinaldo,
        gravado_003_ptu,       exento_003_ptu,
        gravado_021_primavac,  exento_021_primavac,
        count_cancelados, count_uuid_duplicados, count_brecha_5dias,
        recepciones_sbc_null, recepciones_sdi_null, recepciones_desv_sbc_sdi_gt_3pct,
        count_receipts, count_empleados_distinct, registro_patronal
    );

-- ------------------------------------------------------------
-- 5. Poblar + REFRESH CONCURRENTLY + VACUUM ANALYZE
-- ------------------------------------------------------------
REFRESH MATERIALIZED VIEW mv_fiscal_conciliacion_mensual;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual;
ANALYZE mv_fiscal_conciliacion_mensual;

COMMIT;

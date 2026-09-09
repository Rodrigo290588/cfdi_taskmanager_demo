-- ============================================================
-- scripts/sql/20260902203100_fiscal_hardening_scale.sql
--
-- TASK 1b — Hardening de escala para 5M históricos + >1M/año.
--
--   1. Índices PARCIALES sobre tablas base (reducen tamaño 10-15×
--      vs full index en 5M rows).
--   2. Programación pg_cron: REFRESH CONCURRENTLY MV cada 6h +
--      VACUUM ANALYZE nightly de tablas base.
--   3. Partition Strategy OPCIONAL (flag PG_PARTITION): RANGE
--      (fecha_pago) en payroll_receipts para > 2M mensuales.
-- ============================================================

-- ============================================================
-- 1. ÍNDICES PARCIALES CONCURRENTES (sin locks DDL prolongados)
-- ============================================================

-- SBC NULL / 0  → payroll_receptors salario_base_cot_apor
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_receptors_sbc_null
    ON payroll_receptors (payroll_receipt_id)
    WHERE salario_base_cot_apor IS NULL OR salario_base_cot_apor = 0;

-- SDI NULL / 0  → payroll_receptors salario_diario_integrado
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_receptors_sdi_null
    ON payroll_receptors (payroll_receipt_id)
    WHERE salario_diario_integrado IS NULL OR salario_diario_integrado = 0;

-- Cancelados (no indexar 90% VIGENTES) → invoices sat_status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_satstatus_cancelado
    ON invoices (id, uuid)
    WHERE sat_status = 'CANCELADO';

-- Brecha emisión vs pago > 5 días → payroll_receipts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_receipts_brecha_gt5
    ON payroll_receipts (company_id, fecha_pago)
    WHERE ABS(fecha_emision::DATE - fecha_pago) > 5;

-- ============================================================
-- 2. PG_CRON · Programación mantenimiento (si la extensión
--    está habilitada). Ejecutar como superusuario en Postgres.
--    Para entornos sin pg_cron, usar cron/Windows scheduler
--    externo invocando psql -f <script>.
-- ============================================================
DO $do$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        PERFORM cron.schedule(
            'refresh-fiscal-conciliacion-mv',
            '0 */6 * * *',
            $cron$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual;
              ANALYZE mv_fiscal_conciliacion_mensual;$cron$
        );
        PERFORM cron.schedule(
            'vacuum-analyze-fiscal-base-tables',
            '15 3 * * *',
            $cron$VACUUM ANALYZE payroll_receipts;
              VACUUM ANALYZE payroll_deducciones;
              VACUUM ANALYZE payroll_percepciones;
              VACUUM ANALYZE payroll_receptors;$cron$
        );
    END IF;
END $do$;

-- ============================================================
-- 3. PARTITION STRATEGY OPCIONAL (flag: PG_PARTITION)
--    --------------------------------------------------------
--    Descomentar el bloque siguiente para habilitar partición
--    RANGE(fecha_pago) cuando el crecimiento mensual supere
--    ~2M nóminas / mes (>> 24M / año). Requiere superusuario y
--    plan de migra. de datos (ATTACH PARTITION progresivo).
-- ============================================================
/*
BEGIN;
CREATE TABLE IF NOT EXISTS payroll_receipts_partitioned (
    LIKE payroll_receipts INCLUDING ALL
) PARTITION BY RANGE (fecha_pago);

CREATE TABLE IF NOT EXISTS payroll_receipts_p2024 PARTITION OF payroll_receipts_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE IF NOT EXISTS payroll_receipts_p2025 PARTITION OF payroll_receipts_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS payroll_receipts_p2026 PARTITION OF payroll_receipts_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS payroll_receipts_p2027 PARTITION OF payroll_receipts_partitioned
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE IF NOT EXISTS payroll_receipts_default PARTITION OF payroll_receipts_partitioned DEFAULT;
COMMIT;
*/

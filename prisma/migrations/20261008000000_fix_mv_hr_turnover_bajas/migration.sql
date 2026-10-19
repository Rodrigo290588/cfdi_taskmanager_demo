DROP MATERIALIZED VIEW IF EXISTS mv_hr_turnover_mensual CASCADE;

CREATE MATERIALIZED VIEW mv_hr_turnover_mensual AS
WITH
  max_mes_company AS (
    SELECT company_id, MAX(DATE_TRUNC('month', fecha_pago)::DATE) as max_mes_pago
    FROM payroll_receipts
    GROUP BY company_id
  ),
  recepciones_por_mes AS (
    SELECT
      pr.organization_id,
      pr.company_id,
      pr.fiscal_entity_id,
      pr.departamento,
      pr.tipo_nomina,
      prre.periodicidad_pago,
      prre.rfc                         AS receptor_rfc,
      DATE_TRUNC('month', pr.fecha_pago)::DATE AS mes_pago,
      MIN(pr.fecha_pago)               AS primera_fecha_pago,
      MAX(pr.fecha_pago)               AS ultima_fecha_pago,
      COUNT(DISTINCT pr.uuid)          AS recibos_mes
    FROM payroll_receipts pr
    JOIN payroll_receptors prre ON prre.payroll_receipt_id = pr.id
    GROUP BY 1,2,3,4,5,6,7,8
  ),
  lag_lead AS (
    SELECT
      r.*,
      LAG(r.mes_pago) OVER (
        PARTITION BY r.organization_id, r.company_id, r.tipo_nomina, r.periodicidad_pago, r.receptor_rfc
        ORDER BY r.mes_pago
      ) AS mes_anterior,
      LEAD(r.mes_pago) OVER (
        PARTITION BY r.organization_id, r.company_id, r.tipo_nomina, r.periodicidad_pago, r.receptor_rfc
        ORDER BY r.mes_pago
      ) AS mes_siguiente,
      m.max_mes_pago
    FROM recepciones_por_mes r
    JOIN max_mes_company m ON m.company_id = r.company_id
  )
SELECT
  organization_id,
  company_id,
  fiscal_entity_id,
  departamento,
  tipo_nomina,
  periodicidad_pago,
  mes_pago,
  COUNT(*) FILTER (
    WHERE mes_anterior IS NULL
       OR (mes_pago - mes_anterior) > 60
  )::INT AS altas,
  COUNT(*) FILTER (
    WHERE (mes_siguiente IS NULL AND (max_mes_pago - mes_pago) > 60)
       OR (mes_siguiente - mes_pago) > 60
  )::INT AS bajas,
  COUNT(*) FILTER (
    WHERE mes_anterior IS NOT NULL
      AND (mes_pago - mes_anterior) > 60
  )::INT AS reingresos,
  COUNT(DISTINCT receptor_rfc)     AS empleados_activos,
  SUM(recibos_mes)                 AS total_recibos
FROM lag_lead
GROUP BY 1,2,3,4,5,6,7
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_turnover_pk
  ON mv_hr_turnover_mensual (organization_id, company_id, mes_pago, departamento);
CREATE INDEX IF NOT EXISTS idx_mv_turnover_org_date
  ON mv_hr_turnover_mensual (organization_id, mes_pago DESC);
CREATE INDEX IF NOT EXISTS idx_mv_turnover_company_dept
  ON mv_hr_turnover_mensual (company_id, departamento);
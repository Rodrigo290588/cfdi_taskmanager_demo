-- ============================================================
-- MIGRACIÓN: Vistas Materializadas Analíticas para RH Dashboard
-- Propósito: Pre-calcular agregaciones sobre 5M+ CFDIs de nómina
--            evitando parseo XML en tiempo real y agregaciones
--            pesadas en el Event Loop de Node.js.
-- Pipeline: REFRESH MATERIALIZED VIEW después del ETL asíncrono
--           de ingestión de nóminas (BullMQ / worker dedicado).
-- ============================================================

-- ------------------------------------------------------------
-- MV #1: mv_hr_turnover_mensual
-- Eje RH: Turnover y Movimientos de Personal
-- Detecta Altas, Bajas y Reingresos comparando el timbrado
-- de UUIDs por RFC de receptor en ventanas mensuales.
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hr_turnover_mensual AS
WITH
  recepciones_por_mes AS (
    SELECT
      pr.organization_id,
      pr.company_id,
      pr.fiscal_entity_id,
      pr.departamento,
      prre.rfc                         AS receptor_rfc,
      DATE_TRUNC('month', pr.fecha_pago)::DATE AS mes_pago,
      MIN(pr.fecha_pago)               AS primera_fecha_pago,
      MAX(pr.fecha_pago)               AS ultima_fecha_pago,
      COUNT(DISTINCT pr.uuid)          AS recibos_mes
    FROM payroll_receipts pr
    JOIN payroll_receptors prre ON prre.payroll_receipt_id = pr.id
    GROUP BY 1,2,3,4,5,6
  ),
  lag_lead AS (
    SELECT
      r.*,
      LAG(mes_pago) OVER (
        PARTITION BY organization_id, company_id, receptor_rfc
        ORDER BY mes_pago
      ) AS mes_anterior,
      LEAD(mes_pago) OVER (
        PARTITION BY organization_id, company_id, receptor_rfc
        ORDER BY mes_pago
      ) AS mes_siguiente
    FROM recepciones_por_mes r
  )
SELECT
  organization_id,
  company_id,
  fiscal_entity_id,
  departamento,
  mes_pago,
  COUNT(*) FILTER (
    WHERE mes_anterior IS NULL
       OR (mes_pago - mes_anterior) > 60
  )::INT AS altas,
  COUNT(*) FILTER (
    WHERE mes_siguiente IS NULL
       OR (mes_siguiente - mes_pago) > 60
  )::INT AS bajas,
  COUNT(*) FILTER (
    WHERE mes_anterior IS NOT NULL
      AND (mes_pago - mes_anterior) > 60
  )::INT AS reingresos,
  COUNT(DISTINCT receptor_rfc)     AS empleados_activos,
  SUM(recibos_mes)                 AS total_recibos
FROM lag_lead
GROUP BY 1,2,3,4,5
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_turnover_pk
  ON mv_hr_turnover_mensual (organization_id, company_id, mes_pago, departamento);
CREATE INDEX IF NOT EXISTS idx_mv_turnover_org_date
  ON mv_hr_turnover_mensual (organization_id, mes_pago DESC);
CREATE INDEX IF NOT EXISTS idx_mv_turnover_company_dept
  ON mv_hr_turnover_mensual (company_id, departamento);

-- ------------------------------------------------------------
-- MV #2: mv_hr_incapacidades_acumulado
-- Eje RH: Mapa de Incidencias
-- Agrega días por TipoIncapacidad (01/02/03) e importe asociado.
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hr_incapacidades_acumulado AS
SELECT
  pr.organization_id,
  pr.company_id,
  pr.fiscal_entity_id,
  pr.departamento,
  DATE_TRUNC('month', pr.fecha_pago)::DATE  AS mes_pago,
  prre.rfc                                   AS receptor_rfc,
  pi.tipo_incapacidad,
  CASE pi.tipo_incapacidad
    WHEN '01' THEN 'Riesgo de trabajo'
    WHEN '02' THEN 'Enfermedad general'
    WHEN '03' THEN 'Maternidad'
    ELSE 'Otro (' || pi.tipo_incapacidad || ')'
  END::VARCHAR(64)                          AS descripcion_tipo,
  COUNT(*)                                   AS numero_eventos,
  SUM(pi.num_dias)                           AS total_dias,
  AVG(pi.num_dias)                           AS promedio_dias_por_evento,
  SUM(pi.importe_monetario)                  AS importe_total,
  COUNT(DISTINCT prre.rfc)                   AS empleados_afectados
FROM payroll_receipts pr
JOIN payroll_incapacidades   pi   ON pi.payroll_receipt_id   = pr.id
JOIN payroll_receptors       prre ON prre.payroll_receipt_id = pr.id
GROUP BY 1,2,3,4,5,6,7,8
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_incapacidades_pk
  ON mv_hr_incapacidades_acumulado
     (organization_id, company_id, mes_pago, departamento,
      tipo_incapacidad, receptor_rfc);
CREATE INDEX IF NOT EXISTS idx_mv_incapacidades_tipo_date
  ON mv_hr_incapacidades_acumulado (tipo_incapacidad, mes_pago DESC);
CREATE INDEX IF NOT EXISTS idx_mv_incapacidades_company_dept
  ON mv_hr_incapacidades_acumulado (company_id, departamento);

-- ------------------------------------------------------------
-- MV #3: mv_hr_horas_extra_por_depto
-- Eje RH: Control de Horas Extra
-- Agrupa horas dobles/triples por departamento y importe pagado.
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hr_horas_extra_por_depto AS
SELECT
  pr.organization_id,
  pr.company_id,
  pr.fiscal_entity_id,
  COALESCE(pr.departamento, 'Sin Departamento') AS departamento,
  DATE_TRUNC('month', pr.fecha_pago)::DATE       AS mes_pago,
  phe.tipo_horas,
  CASE phe.tipo_horas
    WHEN '01' THEN 'Dobles'
    WHEN '02' THEN 'Triples'
    ELSE 'Otras (' || phe.tipo_horas || ')'
  END::VARCHAR(32)                               AS descripcion_tipo,
  COUNT(DISTINCT pr.id)                           AS numero_nominas,
  COUNT(DISTINCT prre.rfc)                        AS empleados,
  SUM(phe.horas_extra)                            AS total_horas,
  SUM(phe.dias)                                   AS total_dias,
  SUM(phe.importe_pagado)                        AS importe_total
FROM payroll_receipts pr
JOIN payroll_horas_extra    phe  ON phe.payroll_receipt_id  = pr.id
JOIN payroll_receptors      prre ON prre.payroll_receipt_id = pr.id
GROUP BY 1,2,3,4,5,6,7
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_horas_extra_pk
  ON mv_hr_horas_extra_por_depto
     (organization_id, company_id, mes_pago, departamento, tipo_horas);
CREATE INDEX IF NOT EXISTS idx_mv_horas_extra_dept_date
  ON mv_hr_horas_extra_por_depto (departamento, mes_pago DESC);
CREATE INDEX IF NOT EXISTS idx_mv_horas_extra_tipo
  ON mv_hr_horas_extra_por_depto (tipo_horas);

-- ------------------------------------------------------------
-- MV #4: mv_hr_plantilla_actual
-- Eje RH: Distribución de Plantilla
-- Perfil vigente por TipoContrato, TipoJornada y antigüedad promedio
-- calculada desde FechaInicioRelLaboral.
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hr_plantilla_actual AS
WITH
  ultimo_recibo_empleado AS (
    SELECT
      pr.organization_id,
      pr.company_id,
      pr.fiscal_entity_id,
      prre.rfc,
      MAX(pr.fecha_pago)               AS ultima_fecha_pago,
      MAX(prre.fecha_inicio_rel_laboral)
        FILTER (WHERE prre.fecha_inicio_rel_laboral IS NOT NULL)
                                       AS fecha_inicio_rel_laboral,
      MAX(prre.tipo_contrato)          AS tipo_contrato,
      MAX(prre.tipo_jornada)           AS tipo_jornada,
      MAX(prre.tipo_regimen)           AS tipo_regimen,
      MAX(prre.departamento)           AS departamento,
      MAX(prre.antiguedad)             AS antiguedad_declarada,
      MAX(prre.salario_diario_integrado)
        FILTER (WHERE prre.salario_diario_integrado IS NOT NULL)
                                       AS ultimo_sdi
    FROM payroll_receipts pr
    JOIN payroll_receptors prre ON prre.payroll_receipt_id = pr.id
    GROUP BY 1,2,3,4
    HAVING MAX(pr.fecha_pago)::DATE >= (NOW() - INTERVAL '90 days')::DATE
  )
SELECT
  organization_id,
  company_id,
  fiscal_entity_id,
  COALESCE(departamento, 'Sin Departamento') AS departamento,
  COALESCE(tipo_contrato, 'Sin Especificar') AS tipo_contrato,
  COALESCE(tipo_jornada, 'Sin Especificar') AS tipo_jornada,
  COUNT(DISTINCT rfc)                        AS num_empleados,
  AVG(
    CASE
      WHEN fecha_inicio_rel_laboral IS NOT NULL
      THEN EXTRACT(EPOCH FROM (NOW() - fecha_inicio_rel_laboral))
           / (365.25 * 86400.0)
      ELSE COALESCE(antiguedad_declarada, 0)::FLOAT / 12.0
    END
  )::DECIMAL(8,2)                            AS antiguedad_promedio_anios,
  AVG(ultimo_sdi)::DECIMAL(18,6)            AS sdi_promedio
FROM ultimo_recibo_empleado
GROUP BY 1,2,3,4,5,6
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_plantilla_pk
  ON mv_hr_plantilla_actual
     (organization_id, company_id, departamento, tipo_contrato, tipo_jornada);
CREATE INDEX IF NOT EXISTS idx_mv_plantilla_company_dept
  ON mv_hr_plantilla_actual (company_id, departamento);
CREATE INDEX IF NOT EXISTS idx_mv_plantilla_contrato_jornada
  ON mv_hr_plantilla_actual (tipo_contrato, tipo_jornada);

-- ------------------------------------------------------------
-- MV #5: mv_hr_beneficios_prestaciones
-- Eje RH: Beneficios y Prestaciones
-- Concentra Vales de Despensa (029), Fondo Ahorro (005),
-- Premios Puntualidad (010) y Asistencia (049) por TipoPercepcion.
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hr_beneficios_prestaciones AS
SELECT
  pr.organization_id,
  pr.company_id,
  pr.fiscal_entity_id,
  COALESCE(pr.departamento, 'Sin Departamento') AS departamento,
  DATE_TRUNC('month', pr.fecha_pago)::DATE       AS mes_pago,
  pp.tipo_percepcion,
  CASE pp.tipo_percepcion
    WHEN '005' THEN 'Fondo/Caja de Ahorro'
    WHEN '010' THEN 'Premios de Puntualidad'
    WHEN '029' THEN 'Vales de Despensa'
    WHEN '049' THEN 'Premios de Asistencia'
    ELSE 'Otro (' || pp.tipo_percepcion || ')'
  END::VARCHAR(64)                                AS descripcion_beneficio,
  pp.concepto,
  COUNT(*)                                        AS numero_aplicaciones,
  COUNT(DISTINCT prre.rfc)                        AS empleados_beneficiados,
  SUM(pp.importe_gravado)                         AS total_gravado,
  SUM(pp.importe_exento)                          AS total_exento,
  SUM(pp.importe_gravado + pp.importe_exento)     AS importe_total
FROM payroll_receipts pr
JOIN payroll_percepciones   pp   ON pp.payroll_receipt_id   = pr.id
JOIN payroll_receptors      prre ON prre.payroll_receipt_id = pr.id
WHERE pp.tipo_percepcion IN ('005','010','029','049')
GROUP BY 1,2,3,4,5,6,7,8
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_beneficios_pk
  ON mv_hr_beneficios_prestaciones
     (organization_id, company_id, mes_pago, departamento,
      tipo_percepcion, concepto);
CREATE INDEX IF NOT EXISTS idx_mv_beneficios_tipo_date
  ON mv_hr_beneficios_prestaciones (tipo_percepcion, mes_pago DESC);
CREATE INDEX IF NOT EXISTS idx_mv_beneficios_company_dept
  ON mv_hr_beneficios_prestaciones (company_id, departamento);

-- ------------------------------------------------------------
-- MV #6: mv_hr_headcount_costo_kpis
-- KPI generalista para cards del dashboard
-- (pre-calculo sumas que siempre se muestran arriba).
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hr_headcount_costo_kpis AS
SELECT
  pr.organization_id,
  pr.company_id,
  pr.fiscal_entity_id,
  COALESCE(pr.departamento, 'Sin Departamento') AS departamento,
  DATE_TRUNC('month', pr.fecha_pago)::DATE       AS mes_pago,
  COUNT(DISTINCT pr.id)                           AS recibos_procesados,
  COUNT(DISTINCT prre.rfc)                        AS empleados_pagados,
  SUM(pr.total_percepciones)                      AS total_percepciones,
  SUM(pr.total_deducciones)                       AS total_deducciones,
  SUM(COALESCE(pr.total_otros_pagos,0))           AS total_otros_pagos,
  SUM(pr.num_dias_pagados)                        AS total_dias_pagados,
  AVG(pr.total_percepciones)                      AS ticket_promedio_percepciones
FROM payroll_receipts pr
JOIN payroll_receptors prre ON prre.payroll_receipt_id = pr.id
GROUP BY 1,2,3,4,5
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_kpis_pk
  ON mv_hr_headcount_costo_kpis
     (organization_id, company_id, mes_pago, departamento);
CREATE INDEX IF NOT EXISTS idx_mv_kpis_org_date
  ON mv_hr_headcount_costo_kpis (organization_id, mes_pago DESC);
CREATE INDEX IF NOT EXISTS idx_mv_kpis_company
  ON mv_hr_headcount_costo_kpis (company_id);

-- ============================================================
-- FUNCIÓN HELPER: refresh_hr_materialized_views()
-- Pipeline ETL llama a este procedimiento al terminar de
-- ingerir un batch de nóminas para mantener las vistas al día.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_hr_materialized_views(
  IN  p_concurrent BOOLEAN DEFAULT FALSE,
  OUT p_updated_at TIMESTAMPTZ
) LANGUAGE plpgsql AS $$
BEGIN
  IF p_concurrent THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hr_turnover_mensual;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hr_incapacidades_acumulado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hr_horas_extra_por_depto;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hr_plantilla_actual;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hr_beneficios_prestaciones;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hr_headcount_costo_kpis;
  ELSE
    REFRESH MATERIALIZED VIEW mv_hr_turnover_mensual;
    REFRESH MATERIALIZED VIEW mv_hr_incapacidades_acumulado;
    REFRESH MATERIALIZED VIEW mv_hr_horas_extra_por_depto;
    REFRESH MATERIALIZED VIEW mv_hr_plantilla_actual;
    REFRESH MATERIALIZED VIEW mv_hr_beneficios_prestaciones;
    REFRESH MATERIALIZED VIEW mv_hr_headcount_costo_kpis;
  END IF;
  p_updated_at := NOW();
END;$$;

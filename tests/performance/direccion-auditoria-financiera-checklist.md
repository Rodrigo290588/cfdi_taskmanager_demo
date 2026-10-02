# Tablero RH Directivo · Auditoría Financiera 12 Puntos

> TASK 13 · FASE 4b — Especialista Fiscal/Financiero SAT Nómina 1.2
> Archivo evidencia: `tests/performance/direccion-auditoria-financiera-checklist.md`
> Validación cruzada: Raw SQL payroll_* VS `mv_direccion_costo_ejecutivo_mensual` VS Endpoint `/api/stats/direccion`

---

## Auditoría Financiera · 12 Puntos (PASS / FAIL)

| # | Concepto (Fórmula SAT 1.2) | Método Validación (SQL / Manual / SAT Visor) | Resultado | PASS · FAIL | Evidencia (Hash / Ruta / UUID) |
|---|---|---|---|---|---|
| **01** | **Percepciones Brutas**: SUM(percepciones_totales MV) = SUM(payroll_receipts.total_percepciones WHERE VIGENTE) | **SQL Cross-Check** · delta ≤ **0.05 MXN** (AC-1). Agrupar por org/company/fe/rango fechas. Query raw payroll receipts WHERE `sat_status = 'VIGENTE'`; query MV `SUM(percepciones_brutas)`; comparar agregado total y por departamento. |  | ☐ PASS · ☐ FAIL |  |
| **02** | **Carga Patronal 30.4%**: Validar 10 muestras aleatorias CP_MV = SUM(SBC×NumDias) × 0.3040 exacto | **SQL Row-Level** · Muestrear 10 rows MV (distintas empresa/depto/mes). Recomputar CP raw `ROUND(SUM(pr_receptor.salario_base_cot_apor * pr.num_dias_pagados) * 0.3040, 2)`; delta = \|MV - raw\| ≤ 0.05 MXN las 10/10. |  | ☐ PASS · ☐ FAIL |  |
| **03** | **ISN Estatal CASE 32 ClaveEntFed**: Validar 5 entidades federativas distintas (AGS=2% / CDMX=2% / NL=2.25% / default=2.5%) | **SQL + SAT Catálogo** · 5 grupos por `clave_ent_fed` (01=AGS,09=CDMX,19=NL,14=JAL default 2.5%, 20=PUE default 2.5%). ISN_MV = PercepcionesBrutas × pct_ISN; delta ≤ 0.05 MXN los 5/5. |  | ☐ PASS · ☐ FAIL |  |
| **04** | **Costo Total = Brutas + CP + ISN**: SUM total MV agrupado = SUM 3 componentes row-level | **SQL Aritmética** · 20 filas MV random: ` costo_total = percepciones_brutas + carga_patronal + isn_estatal `; \|error_mv - formula\| ≤ 0.05 MXN 20/20. |  | ☐ PASS · ☐ FAIL |  |
| **05** | **Empleados Únicos (CURP / NumEmpleado / RFC)**: Delta \|MV - COUNT(DISTINCT CONCAT_WS('|',curp,num_empleado,rfc))\| = **0** | **SQL Distinct Exacto** · Por empresa+periodo: MV `count_empleados_unicos` vs raw payroll receptors JOIN receipts. Exactamente iguales (0 diferencia) para 5 periodos consecutivos. |  | ☐ PASS · ☐ FAIL |  |
| **06** | **Costo Promedio por Empleado = CostoTotal MV / EmpleadosÚnicos MV**: Fórmula endpoint derivada = cálculo manual | **Manual + JSON API** · 3 escenarios (3m/1y/5y): payload `/api/stats/direccion`.kpis.`costoPromedioEmpleado` vs `kpis.costoTotal / kpis.empleadosUnicos` calculado a mano. delta ≤ 0.50 MXN los 3/3. |  | ☐ PASS · ☐ FAIL |  |
| **07** | **Gasto Fijo = TipoPercepcion 001 (Sueldos)**: SUM(monto_fijo MV) = SUM(payroll_percepciones WHERE tipo_percepcion='001') | **SQL Raw 001** · Por org/periodo: MV fijo = raw 001 (gravado+exento). delta ≤ 0.05 MXN 3 periodos consecutivos. |  | ☐ PASS · ☐ FAIL |  |
| **08** | **Gasto Variable 6 Tipos SAT**: {002 Aguinaldo · 003 PTU · 019 Horas Extra · 021 Prima Vacacional · 028 Comisiones · 038 Bonos Productividad}. SUM 6 = MV variable | **SQL IN 6 tipos** · Percepciones tipo IN ('002','003','019','021','028','038') SUM(importe_gravado+exento) = MV. delta ≤ 0.05 MXN 3 periodos. |  | ☐ PASS · ☐ FAIL |  |
| **09** | **% Variable = Variable / (Fijo+Variable)**: 1 decimal exacto (AC-6 delta ≤ 0.1%) | **API JSON + Cálculo** · 5 rangos diferentes: endpoint `pctVariable` vs `variable / (fijo+variable) * 100` manual redondeado 1 decimal. abs(diff%) ≤ 0.1% los 5/5. |  | ☐ PASS · ☐ FAIL |  |
| **10** | **Tendencia Histórica Mensual**: 12 filas consecutivas (enero→diciembre) completas sin gaps para año vigente | **SQL MV COUNT rows** · WHERE anio = 2026 GROUP BY mes; count(meses_distintos) = 12; cada fila tiene `costo_total_actual > 0` (o 0 explicable en meses no cursados). 12/12 OK. |  | ☐ PASS · ☐ FAIL |  |
| **11** | **YoY Mes A Mes Exacto**: costo_yoy_mes = costo_actual_mes_A / costo_anterior_mes_A - 1.0 · mismo desglose MV periodoAnterior | **SQL Dual Query** · 6 meses aleatorios: fila MV actual vs fila MV 12 meses atrás. YoY manual = (actual/previo - 1); coincide con tabla tendencia delta_pct calculada (±0.001). |  | ☐ PASS · ☐ FAIL |  |
| **12** | **Muestra SAT Visor · 30 UUID CFDIs Nómina**: 30 recibos (10 depto × 3 fechas) extraídos MV/API vs CFDI descargado SAT → importe coincide 30/30 | **SAT Visor XLSX Export** · Seleccionar 30 UUID payroll_receipts.invoice.uuid reales de producción/staging; exportar hoja SAT: `Total Percepciones` · `Total Deducciones` · `Neto` coinciden exactamente con payload API drilldown 30/30. |  | ☐ PASS · ☐ FAIL |  |

---

## Resumen Ejecutivo CFO

| Métrica | Valor Auditado |
|---|---|
| **Puntos PASS** | `__ / 12` |
| **Puntos FAIL** | `__ / 12` |
| **Rubric AC-10** (≥4 = PASS release): `(12 * PASS / 12)` → ☐ ≥ 4 · ☐ < 4 |  |
| **Recomendación Auditor**: ☐ **PUBLICAR v1.19.0** · ☐ **Retener release (corregir FAILs)** · ☐ **Condicional (low-severity + plan remediación)** |  |

### Evidencia Anexada (Rutas Físicas)
```
reports/
├─ direccion-auditoria-sql-raw-vs-mv.csv       (punto 01-08)
├─ direccion-auditoria-30-uuid-sat.xlsx        (punto 12)
├─ k6-direccion-summary.json                   (TASK 12)
└─ k6-direccion-50vus-60s.json                 (TASK 12 log completo)
```

---

**Firmas Auditoría (Completar el Release Gate)**

| Rol | Nombre | Fecha | Firma |
|---|---|---|---|
| Especialista Fiscal SAT Nómina 1.2 | ____________________ | 2026-__-__ | ________________ |
| CFO / VP Finanzas | ____________________ | 2026-__-__ | ________________ |
| Arquitecto de Software Senior | ____________________ | 2026-__-__ | ________________ |

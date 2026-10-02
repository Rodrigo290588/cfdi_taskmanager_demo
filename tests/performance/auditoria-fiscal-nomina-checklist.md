# Matriz de Auditoría Fiscal SAT · Tablero Contabilidad y Fiscal Nómina 1.2
**Versión:** 1.0.0  **Fase:** 4  **Alcance:** 12 pruebas · Cumplimiento / Conciliación

---

## Propósito
Validar que el tablero de contabilidad y fiscal de nómina reporta los mismos
valores que el Visor de Comprobantes Fiscales del SAT y las nóminas
certificadas del buzón tributario del RFC emisor.

## Pre-requisitos
1. PostgreSQL poblado con ≥500 CFDIs de nómina por empresa auditada.
2. MV `mv_fiscal_conciliacion_mensual` refrescada:
   ```sql
   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual;
   ANALYZE mv_fiscal_conciliacion_mensual;
   ```
3. Acceso al visor SAT del RFC emisor (https://portalcfdi.facturaelectronica.sat.gob.mx/)
   o al CSV exportado de "Comprobantes Recibidos / Emitidos del Régimen".
4. 30 UUIDs de nómina seleccionados aleatoriamente (10 Sueldos · 10 Aguinaldo ·
   5 PTU · 5 Prima Vacacional) del periodo auditado.

---

## Tabla de Pruebas (12 / 12)

| #   | Concepto SAT (Regla) | Validación Técnica | Resultado esperado | Resultado | Notas / UUID evidencia |
|-----|----------------------|--------------------|--------------------|-----------|------------------------|
| **ISR · Conciliación** |
| 01 | **ISR retenido global** (TipoDeduccion = 002) | `SELECT SUM(importe) FROM payroll_deducciones pd JOIN payroll_receipts pr ON pr.id = pd.payroll_receipt_id WHERE pd.tipo_deduccion='002' AND pr.company_id=? AND pr.fecha_pago BETWEEN ? AND ?` vs dashboard KPI `ISR Retenido` | Valores coinciden al centavo (≤ $0.02 MX de diff por redondeo) | ❓ Pend | KPI row: `isr_retenido_mxn` |
| 02 | **ISR vs Pago Provisional SAT** | Comparar dashboard `isr_retenido_mxn` vs línea 13 "Impuesto Retenido de Trabajadores" del Declarativo Provisional 1300 del periodo | Diferencia ≤ 0.5% o ≤ $500 MX (ajustes decimales) | ❓ Pend | |
| **Cancelaciones · Riesgo** |
| 03 | **Conteo Cancelados** | Dashboard `Cancelados` vs `SELECT COUNT(*) FROM invoices WHERE sat_status='CANCELADO' AND issuer_rfc=? AND issuance_date BETWEEN ? AND ?` | Exacto 0 diff | ❓ Pend | Partial Index: `idx_invoices_cancelados` |
| 04 | **UUIDs Duplicados** | Dashboard `UUID Duplicados` vs `SELECT uuid, COUNT(*) c FROM payroll_receipts GROUP BY 1 HAVING c>1` | 0 o igual al reportado | ❓ Pend | |
| **Brecha de Timbrado** |
| 05 | **Retrasos > 5 días** | Dashboard `Retrasos Timbrado` ≥ tabla Top 100 `brecha_dias` vs `SELECT id, (fecha_emision::date - fecha_pago::date) d FROM payroll_receipts WHERE d>5 ORDER BY d DESC LIMIT 100` | Coincidencia exacta, fila por fila | ❓ Pend | Regla SAT Art. 29 CFF |
| **IMSS · Carga Social** |
| 06 | **SBC NULL** (IMSS art. 26) | Columna Alerta "SBC NULL" del Top 100 vs `SELECT COUNT(*) FROM payroll_receptors WHERE salario_base_cot_apor IS NULL` | Coincidencia ≥ 99% | ❓ Pend | Partial Index `idx_receptores_sbc_null` |
| 07 | **SDI NULL** (Anexo 5 LSS) | Columna Alerta "SDI NULL" del Top 100 vs `SELECT COUNT(*) FROM payroll_receptors WHERE salario_diario_integrado IS NULL` | Coincidencia ≥ 99% | ❓ Pend | |
| 08 | **Desviación SBC/SDI > 3%** | Tabla Alertas SBC/SDI (filas DESV_GT_3PCT) vs `rec.*, (ABS(sbc-sdi)/NULLIF(sdi,0))*100 pct WHERE pct>3` | Cada fila: diff% calculado coincidente al 0.01% | ❓ Pend | 10 filas spot-check |
| **Deducciones de Terceros** |
| 09 | **INFONAVIT + FONACOT + Pensión + Sindicato** | Donut 4 categorías vs `SELECT tipo_deduccion, SUM(importe) FROM payroll_deducciones WHERE tipo_deduccion IN ('010','006','007','001') ... GROUP BY 1` | Cada categoría coincidente ≤ 0.1% de diff | ❓ Pend | TipoDeduccion Anexo 8 |
| **Gravado vs Exento** |
| 10 | **Sueldos (001)** | Bar `Gravado + Exento` de Sueldos vs `SELECT SUM(importe_gravado), SUM(importe_exento) FROM payroll_percepciones pp JOIN pr ON ... WHERE pp.tipo_percepcion='001'` | Coincidencia centavo 0.00 MX | ❓ Pend | |
| 11 | **Aguinaldo (002) + PTU (003) + Prima Vacacional (021)** | Suma de 3 bars (Gravado+Exento) c/uno contra SUM raw correspondiente en `payroll_percepciones` | Cada concepto ≤ 0.1% diff | ❓ Pend | |
| **Visor SAT · Contra evidencia** |
| 12 | **30 UUIDs spot-check** | Exportar CSV visor SAT del periodo. PARA CADA UUID de los 30 seleccionados: (a) Importe total CFDI ↔ invoices.total (b) TipoPercepcion 001 ↔ percepciones agregadas (c) TipoDeduccion 002 ISR ↔ deducciones | 30 / 30 coincidentes | ❓ Pend | Adjuntar CSV evidencia SAT en `reports/evidencia_sat_30uuids.csv` |

---

## Criterio de Aceptación FASE 4 Auditoría
✅ **PASS** = 12/12 pruebas en columna `Resultado` = PASS y ≤ 1 fila WARNING
❌ **FAIL** = 2+ fallos o cualquier fallo en pruebas 01 (ISR), 09 (Deduc terceros), 12 (30 UUIDs SAT)

---

## Firmas de QA Sign-off

| Rol                | Nombre | Firma   | Fecha     |
|--------------------|--------|---------|-----------|
| Especialista SAT   |        |         |           |
| Arquitecto SW      |        |         |           |
| Owner Finanzas     |        |         |           |
| QA Lead            |        |         |           |

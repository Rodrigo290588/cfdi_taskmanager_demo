# Validación SQL: Proyecciones De Complementos

## Objetivo

Validar en base de datos que la mínima viable del framework de complementos:

- pobló correctamente índices y atributos consultables
- cubre emitidos y recibidos
- detecta complementos prioritarios
- deja listo el diagnóstico previo a la tabla especializada de Pagos/REP

## Uso Recomendado

Ejecutar estas consultas:

1. después de `dry-run` para estimar volumen esperado
2. después del backfill real
3. antes de conectar cambios mayores en `workpaper`
4. antes de arrancar la tabla especializada de pagos

## Sección A: Emitidos

### A1. Total de CFDI emitidos vs total proyectado

```sql
SELECT
  (SELECT COUNT(*) FROM invoices) AS total_invoices,
  (SELECT COUNT(*) FROM invoice_complement_index) AS total_index_rows,
  (SELECT COUNT(DISTINCT invoice_id) FROM invoice_complement_attributes) AS total_attr_invoice_ids;
```

### A2. CFDI sin índice de complementos

```sql
SELECT COUNT(*) AS invoices_sin_index
FROM invoices i
LEFT JOIN invoice_complement_index ci
  ON ci.invoice_id = i.id
WHERE ci.id IS NULL;
```

Valor esperado después del backfill: `0`.

### A3. CFDI sin atributos proyectados

```sql
SELECT COUNT(*) AS invoices_sin_atributos
FROM invoices i
LEFT JOIN invoice_complement_attributes ca
  ON ca.invoice_id = i.id
WHERE ca.id IS NULL;
```

Nota:

- no necesariamente todos los CFDI deben tener muchos atributos
- pero este conteo ayuda a detectar fallas generales del backfill

### A4. Cobertura por tipo CFDI

```sql
SELECT
  i.cfdi_type,
  COUNT(*) AS total_cfdis,
  COUNT(ci.id) AS con_index,
  COUNT(DISTINCT ca.invoice_id) AS con_atributos
FROM invoices i
LEFT JOIN invoice_complement_index ci
  ON ci.invoice_id = i.id
LEFT JOIN invoice_complement_attributes ca
  ON ca.invoice_id = i.id
GROUP BY i.cfdi_type
ORDER BY i.cfdi_type;
```

### A5. Cobertura por atributo proyectado

```sql
SELECT
  attribute_key,
  COUNT(*) AS total_filas,
  COUNT(DISTINCT invoice_id) AS total_cfdis
FROM invoice_complement_attributes
GROUP BY attribute_key
ORDER BY attribute_key;
```

### A6. Cobertura por grupo lógico

```sql
SELECT
  complement_type,
  COUNT(*) AS total_filas,
  COUNT(DISTINCT invoice_id) AS total_cfdis
FROM invoice_complement_attributes
GROUP BY complement_type
ORDER BY complement_type;
```

## Sección B: Recibidos

### B1. Total de CFDI recibidos vs total proyectado

```sql
SELECT
  (SELECT COUNT(*) FROM provider_uploaded_cfdis) AS total_provider_cfdis,
  (SELECT COUNT(*) FROM provider_uploaded_cfdi_complement_index) AS total_index_rows,
  (SELECT COUNT(DISTINCT provider_uploaded_cfdi_id) FROM provider_uploaded_cfdi_complement_attributes) AS total_attr_cfdi_ids;
```

### B2. CFDI recibidos sin índice de complementos

```sql
SELECT COUNT(*) AS provider_cfdis_sin_index
FROM provider_uploaded_cfdis p
LEFT JOIN provider_uploaded_cfdi_complement_index ci
  ON ci.provider_uploaded_cfdi_id = p.id
WHERE ci.id IS NULL;
```

### B3. CFDI recibidos sin atributos proyectados

```sql
SELECT COUNT(*) AS provider_cfdis_sin_atributos
FROM provider_uploaded_cfdis p
LEFT JOIN provider_uploaded_cfdi_complement_attributes ca
  ON ca.provider_uploaded_cfdi_id = p.id
WHERE ca.id IS NULL;
```

### B4. Cobertura por tipo CFDI

```sql
SELECT
  p.cfdi_type,
  COUNT(*) AS total_cfdis,
  COUNT(ci.id) AS con_index,
  COUNT(DISTINCT ca.provider_uploaded_cfdi_id) AS con_atributos
FROM provider_uploaded_cfdis p
LEFT JOIN provider_uploaded_cfdi_complement_index ci
  ON ci.provider_uploaded_cfdi_id = p.id
LEFT JOIN provider_uploaded_cfdi_complement_attributes ca
  ON ca.provider_uploaded_cfdi_id = p.id
GROUP BY p.cfdi_type
ORDER BY p.cfdi_type;
```

### B5. Cobertura por atributo proyectado

```sql
SELECT
  attribute_key,
  COUNT(*) AS total_filas,
  COUNT(DISTINCT provider_uploaded_cfdi_id) AS total_cfdis
FROM provider_uploaded_cfdi_complement_attributes
GROUP BY attribute_key
ORDER BY attribute_key;
```

## Sección C: Complementos Prioritarios

### C1. Presencia de complementos en emitidos

```sql
SELECT
  SUM(CASE WHEN has_pagos THEN 1 ELSE 0 END) AS con_pagos,
  SUM(CASE WHEN has_nomina THEN 1 ELSE 0 END) AS con_nomina,
  SUM(CASE WHEN has_carta_porte THEN 1 ELSE 0 END) AS con_carta_porte,
  SUM(CASE WHEN has_comercio_exterior THEN 1 ELSE 0 END) AS con_comercio_exterior
FROM invoice_complement_index;
```

### C2. Presencia de complementos en recibidos

```sql
SELECT
  SUM(CASE WHEN has_pagos THEN 1 ELSE 0 END) AS con_pagos,
  SUM(CASE WHEN has_nomina THEN 1 ELSE 0 END) AS con_nomina,
  SUM(CASE WHEN has_carta_porte THEN 1 ELSE 0 END) AS con_carta_porte,
  SUM(CASE WHEN has_comercio_exterior THEN 1 ELSE 0 END) AS con_comercio_exterior
FROM provider_uploaded_cfdi_complement_index;
```

### C3. Versiones detectadas por complemento en emitidos

```sql
SELECT 'PAGOS' AS complemento, pagos_version AS version, COUNT(*) AS total
FROM invoice_complement_index
WHERE has_pagos = TRUE
GROUP BY pagos_version

UNION ALL

SELECT 'NOMINA' AS complemento, nomina_version AS version, COUNT(*) AS total
FROM invoice_complement_index
WHERE has_nomina = TRUE
GROUP BY nomina_version

UNION ALL

SELECT 'CARTA_PORTE' AS complemento, carta_porte_version AS version, COUNT(*) AS total
FROM invoice_complement_index
WHERE has_carta_porte = TRUE
GROUP BY carta_porte_version

UNION ALL

SELECT 'COMERCIO_EXTERIOR' AS complemento, comercio_exterior_version AS version, COUNT(*) AS total
FROM invoice_complement_index
WHERE has_comercio_exterior = TRUE
GROUP BY comercio_exterior_version
ORDER BY complemento, version;
```

### C4. Versiones detectadas por complemento en recibidos

```sql
SELECT 'PAGOS' AS complemento, pagos_version AS version, COUNT(*) AS total
FROM provider_uploaded_cfdi_complement_index
WHERE has_pagos = TRUE
GROUP BY pagos_version

UNION ALL

SELECT 'NOMINA' AS complemento, nomina_version AS version, COUNT(*) AS total
FROM provider_uploaded_cfdi_complement_index
WHERE has_nomina = TRUE
GROUP BY nomina_version

UNION ALL

SELECT 'CARTA_PORTE' AS complemento, carta_porte_version AS version, COUNT(*) AS total
FROM provider_uploaded_cfdi_complement_index
WHERE has_carta_porte = TRUE
GROUP BY carta_porte_version

UNION ALL

SELECT 'COMERCIO_EXTERIOR' AS complemento, comercio_exterior_version AS version, COUNT(*) AS total
FROM provider_uploaded_cfdi_complement_index
WHERE has_comercio_exterior = TRUE
GROUP BY comercio_exterior_version
ORDER BY complemento, version;
```

## Sección D: Calidad De Proyección

### D1. Valores vacíos o nulos en atributos clave de emitidos

```sql
SELECT
  attribute_key,
  COUNT(*) AS filas_problematicas
FROM invoice_complement_attributes
WHERE
  (value_text IS NULL OR BTRIM(COALESCE(value_text, '')) = '')
  AND value_number IS NULL
  AND value_date IS NULL
  AND value_boolean IS NULL
GROUP BY attribute_key
ORDER BY attribute_key;
```

### D2. Valores vacíos o nulos en atributos clave de recibidos

```sql
SELECT
  attribute_key,
  COUNT(*) AS filas_problematicas
FROM provider_uploaded_cfdi_complement_attributes
WHERE
  (value_text IS NULL OR BTRIM(COALESCE(value_text, '')) = '')
  AND value_number IS NULL
  AND value_date IS NULL
  AND value_boolean IS NULL
GROUP BY attribute_key
ORDER BY attribute_key;
```

### D3. Muestra de documentos con Pagos detectado

```sql
SELECT
  i.uuid,
  i.cfdi_type,
  ci.has_pagos,
  ci.pagos_version,
  i.issuance_date
FROM invoices i
INNER JOIN invoice_complement_index ci
  ON ci.invoice_id = i.id
WHERE ci.has_pagos = TRUE
ORDER BY i.issuance_date DESC
LIMIT 50;
```

### D4. Muestra de documentos con Nómina detectada

```sql
SELECT
  i.uuid,
  i.cfdi_type,
  ci.has_nomina,
  ci.nomina_version,
  i.issuance_date
FROM invoices i
INNER JOIN invoice_complement_index ci
  ON ci.invoice_id = i.id
WHERE ci.has_nomina = TRUE
ORDER BY i.issuance_date DESC
LIMIT 50;
```

## Sección E: REP Especializado En Emitidos

Estas consultas sirven para validar la tabla especializada y seguir dimensionando la siguiente subfase.

### E1. Total de CFDI tipo PAGO en emitidos

```sql
SELECT COUNT(*) AS total_pagos_emitidos
FROM invoices
WHERE cfdi_type = 'PAGO';
```

### E2. Total de relaciones UUID en CFDI tipo PAGO

```sql
SELECT COUNT(*) AS total_relaciones_pago
FROM invoice_related_cfdis r
INNER JOIN invoices i
  ON i.id = r.invoice_id
WHERE i.cfdi_type = 'PAGO';
```

### E3. CFDI tipo PAGO sin relaciones registradas

```sql
SELECT COUNT(*) AS pagos_sin_relaciones
FROM invoices i
LEFT JOIN invoice_related_cfdis r
  ON r.invoice_id = i.id
WHERE i.cfdi_type = 'PAGO'
  AND r.id IS NULL;
```

### E4. Top CFDI de pago con mayor número de relaciones

```sql
SELECT
  i.uuid,
  COUNT(r.id) AS total_relaciones
FROM invoices i
INNER JOIN invoice_related_cfdis r
  ON r.invoice_id = i.id
WHERE i.cfdi_type = 'PAGO'
GROUP BY i.uuid
ORDER BY total_relaciones DESC
LIMIT 50;
```

### E5. Muestra para validar camino a REP especializado

```sql
SELECT
  i.uuid AS pago_uuid,
  i.issuance_date AS pago_fecha,
  r.related_uuid AS uuid_relacionado,
  i.payment_method
FROM invoices i
INNER JOIN invoice_related_cfdis r
  ON r.invoice_id = i.id
WHERE i.cfdi_type = 'PAGO'
ORDER BY i.issuance_date DESC
LIMIT 100;
```

### E6. Total de filas en tabla especializada

```sql
SELECT
  COUNT(*) AS total_filas_rep,
  COUNT(DISTINCT payment_invoice_uuid || ':' || payment_node_index::text) AS nodos_pago_distintos
FROM invoice_payment_complement_details;
```

### E7. Total de CFDI de pago con detalle materializado

```sql
SELECT COUNT(DISTINCT payment_invoice_id) AS pagos_con_detalle
FROM invoice_payment_complement_details;
```

### E8. Cobertura entre relaciones UUID y filas especializadas

```sql
SELECT
  (SELECT COUNT(*) FROM invoice_related_cfdis r INNER JOIN invoices i ON i.id = r.invoice_id WHERE i.cfdi_type = 'PAGO') AS total_relaciones_uuid,
  (SELECT COUNT(*) FROM invoice_payment_complement_details) AS total_filas_rep;
```

### E9. Totales por CFDI de pago

```sql
SELECT
  payment_invoice_uuid,
  COUNT(*) AS total_filas,
  COUNT(DISTINCT payment_node_index) AS total_nodos_pago,
  SUM(base_p) AS total_base_p_duplicada,
  SUM(importe_p) AS total_importe_p_duplicado,
  SUM(imp_pagado) AS total_imp_pagado,
  MAX(payment_date) AS ultima_fecha_pago
FROM invoice_payment_complement_details
GROUP BY payment_invoice_uuid
ORDER BY ultima_fecha_pago DESC
LIMIT 100;
```

### E10. Materialización fiscal de `BaseP` e `ImporteP`

```sql
SELECT
  COUNT(*) FILTER (WHERE base_p > 0) AS filas_con_base_p,
  COUNT(*) FILTER (WHERE importe_p > 0) AS filas_con_importe_p,
  SUM(base_p) AS suma_base_p,
  SUM(importe_p) AS suma_importe_p
FROM invoice_payment_complement_details;
```

### E11. Validación de enlace a factura relacionada

```sql
SELECT
  COUNT(*) AS filas_sin_related_invoice_id
FROM invoice_payment_complement_details
WHERE related_invoice_id IS NULL;
```

### E12. Muestra detallada REP especializado

```sql
SELECT
  d.payment_invoice_uuid,
  d.payment_node_index,
  d.related_invoice_uuid,
  d.payment_date,
  d.num_parcialidad,
  d.base_p,
  d.importe_p,
  d.imp_pagado,
  d.imp_saldo_ant,
  d.imp_saldo_insoluto,
  d.moneda_p,
  d.moneda_dr,
  d.equivalencia_dr
FROM invoice_payment_complement_details d
ORDER BY d.payment_date DESC
LIMIT 100;
```

## Criterio De Aprobación De La Mínima Viable

La mínima viable se considera aceptable si:

- `invoices_sin_index = 0`
- `provider_cfdis_sin_index = 0`
- los atributos clave aparecen con cobertura razonable
- las banderas `has_*` detectan volúmenes coherentes
- las consultas del `workpaper` ya responden desde proyección con fallback controlado
- la tabla `invoice_payment_complement_details` refleja volúmenes coherentes respecto a `invoice_related_cfdis`

## Recordatorio De Segunda Fase

Estas consultas validan la primera etapa. La segunda fase debe:

- madurar heurísticas de detección
- ampliar catálogo de atributos
- migrar reportes y dashboards para consumir `invoice_payment_complement_details`
- endurecer cobertura para XML reales con variantes de prefijo, namespace y versión

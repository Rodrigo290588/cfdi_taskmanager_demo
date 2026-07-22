# Guía De Prueba Funcional: Ingresos, Complementos Y REP

## Objetivo

Validar de punta a punta:

- migraciones Prisma pendientes
- backfills históricos de ingresos y complementos
- tablas especializadas de REP
- comportamiento funcional de `dashboard_fiscal`, drilldowns y `workpaper`

Esta guía está pensada para el entorno local actual del proyecto en Windows.

## Precondición Crítica

La `DATABASE_URL` actual del proyecto apunta a `localhost:5433`, por lo que antes de migrar o correr backfills debes levantar la base del `docker-compose.yml` raíz:

```powershell
docker compose up -d postgres redis
```

No usar el `infra/docker-compose.yml` para este flujo si la variable de entorno sigue apuntando a `5433`, porque ese compose expone PostgreSQL en `5432`.

## Paso 1. Levantar La Base De Datos

1. Abrir Docker Desktop manualmente.
2. Esperar a que el daemon quede disponible.
3. Desde la raíz del proyecto ejecutar:

```powershell
docker compose up -d postgres redis
```

4. Confirmar estado:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Resultado esperado:

- contenedor `dev-itc` en ejecución
- puerto `5433->5432`
- contenedor `dev-itc-redis` en ejecución

## Paso 2. Aplicar Migraciones Prisma

Ejecutar:

```powershell
npx prisma migrate deploy
npx prisma generate
```

Migraciones esperadas en esta etapa:

- `20260720010000_add_invoice_scaling_phase1_indexes`
- `20260720020000_add_invoice_blobs`
- `20260720030000_add_invoice_issued_daily_summary`
- `20260721010000_add_cfdi_complement_projection_tables`
- `20260721020000_add_invoice_payment_complement_detail`
- `20260721030000_add_invoice_payment_tax_fields`

## Paso 3. Validación Inicial De Tablas

Ejecutar estas consultas:

```sql
SELECT COUNT(*) FROM invoice_blobs;
SELECT COUNT(*) FROM invoice_issued_daily_summary;
SELECT COUNT(*) FROM invoice_complement_index;
SELECT COUNT(*) FROM invoice_complement_attributes;
SELECT COUNT(*) FROM provider_uploaded_cfdi_complement_index;
SELECT COUNT(*) FROM provider_uploaded_cfdi_complement_attributes;
SELECT COUNT(*) FROM invoice_payment_complement_details;
```

Objetivo:

- confirmar que todas las tablas existen
- identificar si alguna ya tiene datos previos antes de decidir `RESET=1`

## Paso 4. Orden Correcto De Backfills

Ejecutar en este orden:

1. `invoice_blobs`
2. `invoice_issued_daily_summary`
3. `invoice_complement_projections`
4. `provider_complement_projections`
5. `invoice_payment_complement`

## Paso 5. Backfill De `invoice_blobs`

### Dry run

```powershell
$env:INVOICE_BLOB_BACKFILL_DRY_RUN="1"
npm run backfill:invoice-blobs
Remove-Item Env:INVOICE_BLOB_BACKFILL_DRY_RUN
```

### Ejecución real

```powershell
$env:INVOICE_BLOB_BACKFILL_BATCH_SIZE="100"
npm run backfill:invoice-blobs
Remove-Item Env:INVOICE_BLOB_BACKFILL_BATCH_SIZE
```

### Validación

```sql
SELECT COUNT(*) AS invoices_sin_blob
FROM invoices i
LEFT JOIN invoice_blobs b
  ON b.invoice_id = i.id
WHERE b.id IS NULL
  AND COALESCE(NULLIF(TRIM(i.xml_content), ''), '') <> '';
```

Esperado: `0`.

## Paso 6. Backfill De `invoice_issued_daily_summary`

### Dry run

```powershell
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_DRY_RUN="1"
npm run backfill:invoice-issued-summary
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_DRY_RUN
```

### Ejecución real

Tabla vacía:

```powershell
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE="200"
npm run backfill:invoice-issued-summary
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE
```

Reconstrucción total:

```powershell
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_RESET="1"
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE="200"
npm run backfill:invoice-issued-summary
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_RESET
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE
```

### Validación

```sql
SELECT COUNT(*) AS total_summary_rows
FROM invoice_issued_daily_summary;

SELECT sales_bucket, SUM(cfdi_count) AS total_cfdis, SUM(total_amount) AS total_monto
FROM invoice_issued_daily_summary
WHERE cfdi_type = 'INGRESO'
GROUP BY sales_bucket
ORDER BY sales_bucket;

SELECT payment_status_bucket, SUM(cfdi_count) AS total_cfdis, SUM(pending_amount) AS total_pendiente
FROM invoice_issued_daily_summary
WHERE cfdi_type = 'INGRESO'
GROUP BY payment_status_bucket
ORDER BY payment_status_bucket;
```

## Paso 7. Backfill De Proyecciones De Complementos

### Emitidos

Dry run:

```powershell
$env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN="1"
npm run backfill:invoice-complement-projections
Remove-Item Env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN
```

Real:

```powershell
$env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE="200"
npm run backfill:invoice-complement-projections
Remove-Item Env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE
```

### Recibidos

Dry run:

```powershell
$env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN="1"
npm run backfill:provider-complement-projections
Remove-Item Env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN
```

Real:

```powershell
$env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE="200"
npm run backfill:provider-complement-projections
Remove-Item Env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE
```

### Validación

```sql
SELECT COUNT(*) AS total_index_emitidos FROM invoice_complement_index;
SELECT COUNT(*) AS total_attr_emitidos FROM invoice_complement_attributes;
SELECT COUNT(*) AS total_index_recibidos FROM provider_uploaded_cfdi_complement_index;
SELECT COUNT(*) AS total_attr_recibidos FROM provider_uploaded_cfdi_complement_attributes;

SELECT
  SUM(CASE WHEN has_pagos THEN 1 ELSE 0 END) AS con_pagos,
  SUM(CASE WHEN has_nomina THEN 1 ELSE 0 END) AS con_nomina,
  SUM(CASE WHEN has_carta_porte THEN 1 ELSE 0 END) AS con_carta_porte,
  SUM(CASE WHEN has_comercio_exterior THEN 1 ELSE 0 END) AS con_comercio_exterior
FROM invoice_complement_index;
```

## Paso 8. Backfill De REP Especializado

### Dry run

```powershell
$env:INVOICE_PAYMENT_COMPLEMENT_BACKFILL_DRY_RUN="1"
npm run backfill:invoice-payment-complement
Remove-Item Env:INVOICE_PAYMENT_COMPLEMENT_BACKFILL_DRY_RUN
```

### Ejecución real

```powershell
$env:INVOICE_PAYMENT_COMPLEMENT_BACKFILL_BATCH_SIZE="200"
npm run backfill:invoice-payment-complement
Remove-Item Env:INVOICE_PAYMENT_COMPLEMENT_BACKFILL_BATCH_SIZE
```

### Validación

```sql
SELECT
  COUNT(*) AS total_filas_rep,
  COUNT(DISTINCT payment_invoice_id) AS pagos_con_detalle,
  COUNT(DISTINCT payment_invoice_uuid || ':' || payment_node_index::text) AS nodos_pago_distintos
FROM invoice_payment_complement_details;

SELECT
  COUNT(*) FILTER (WHERE base_p > 0) AS filas_con_base_p,
  COUNT(*) FILTER (WHERE importe_p > 0) AS filas_con_importe_p,
  SUM(base_p) AS suma_base_p,
  SUM(importe_p) AS suma_importe_p
FROM invoice_payment_complement_details;
```

## Paso 9. Arrancar La App

Si la app no está corriendo, iniciarla manualmente:

```powershell
npm run dev
```

## Paso 10. Prueba Funcional De `dashboard_fiscal`

Ruta objetivo:

- `http://localhost:3000/dashboard_fiscal`

Validar:

1. La pantalla abre sin error `500`.
2. Los KPIs cargan datos.
3. `Monto cobrado`, `Monto por cobrar` y `Cartera vencida` muestran valores razonables.
4. `Ingresos cobrados PUE`, `Ingresos cobrados CRP` e `Ingresos pendientes de cobro` responden.
5. La sección de impuestos muestra:
   - `ivaCobradoTotal`
   - `ivaPpdRecibido`
   - `ivaPendienteCobro`
6. Cambiar filtros de fecha y verificar que los KPIs cambian.
7. Cambiar `origin` si la UI lo permite y revisar que no falle el endpoint.

## Paso 11. Prueba Funcional De `ingresos-parciales`

Ruta objetivo:

- `http://localhost:3000/dashboard_fiscal/ingresos-parciales`

Validar:

1. La tabla carga registros sin `500`.
2. Cada factura mantiene los campos esperados:
   - `uuid`
   - `series`
   - `folio`
   - `totalPaid`
   - `saldoInsoluto`
   - `isPaid`
   - `payments`
3. En `payments`, validar que existan:
   - `paymentUuid`
   - `paymentDate`
   - `impPagado`
   - `impSaldoAnt`
   - `impSaldoInsoluto`
   - `monedaP`
   - `monedaDR`
   - `equivalenciaDR`
   - `paymentXml`
4. Confirmar que los filtros por moneda y rango de fecha sigan funcionando.

## Paso 12. Prueba Funcional De `ingresos_pendientes`

Ruta objetivo:

- drilldown de ingresos pendientes desde `dashboard_fiscal`

Validar:

1. Aparecen renglones de:
   - `Factura a Crédito (PPD)`
   - `Complemento de Pago (CRP)`
   - `Nota de Crédito (Ajuste)`
2. Para CRP:
   - `uuid` corresponde al pago
   - `uuidRelacionado` corresponde al UUID del PPD
   - `importe` viene en negativo
3. El resultado sigue cargando aunque falte cobertura completa del backfill, gracias al fallback.

## Paso 13. Prueba Funcional De `ingresos_cobrados`

Ruta objetivo:

- drilldown de ingresos cobrados desde `dashboard_fiscal`

Validar:

1. Aparecen renglones de:
   - `Factura Contado (PUE)`
   - `Complemento de Pago (CRP)`
2. Para CRP:
   - `uuidRelacionado` se arma desde la tabla REP cuando existe cobertura
   - `importe` coincide con `BaseP`
3. No deben verse montos inflados por un mismo nodo `Pago` con varios `DoctoRelacionado`.
4. Si una parte histórica no está materializada, debe seguir funcionando por fallback XML.

## Paso 14. Prueba Funcional De `workpaper` Emitidos

Ruta objetivo:

- `http://localhost:3000/dashboard_fiscal/workpaper`

Validar:

1. La tabla abre sin errores.
2. El botón `Columnas` muestra opciones base y de complementos.
3. Activar columnas mínimas viables:
   - `hasPagos`
   - `pagosVersion`
   - `hasNomina`
   - `nominaVersion`
   - `hasCartaPorte`
   - `cartaPorteVersion`
   - `hasComercioExterior`
   - `comercioExteriorVersion`
4. Confirmar que los valores sean coherentes con los XML reales.
5. Probar filtros sobre columnas de proyección.
6. Exportar CSV y confirmar que incluya las columnas visibles.

## Paso 15. Prueba Funcional De `workpaper` Recibidos

Ruta objetivo:

- `http://localhost:3000/dashboard_recibidos/workpaper`

Validar:

1. La tabla abre sin errores.
2. El catálogo `Columnas` funciona igual que en emitidos.
3. Las columnas de complemento responden con datos proyectados.
4. La exportación sigue respetando columnas visibles.

## Paso 16. Validación Cruzada SQL Vs UI

Contrastar manualmente:

1. `dashboard_fiscal.kpis.montoCobrado` contra la lógica esperada de PUE + PPD cobrados.
2. `ingresosCobradosCrp` contra la suma de `base_p` agrupada por `payment_invoice_uuid + payment_node_index`.
3. `ivaCobradoCrp` contra la suma de `importe_p` agrupada por `payment_invoice_uuid + payment_node_index`.

Consulta sugerida:

```sql
WITH payment_nodes AS (
  SELECT
    payment_invoice_uuid,
    payment_node_index,
    MAX(base_p) AS base_p,
    MAX(importe_p) AS importe_p
  FROM invoice_payment_complement_details
  GROUP BY payment_invoice_uuid, payment_node_index
)
SELECT
  SUM(base_p) AS ingresos_cobrados_crp,
  SUM(importe_p) AS iva_cobrado_crp
FROM payment_nodes;
```

## Paso 17. Criterio De Aprobación

La corrida se considera aceptable si:

- las migraciones aplican sin error
- todos los backfills terminan con `Fin`
- las tablas nuevas tienen cobertura razonable
- `dashboard_fiscal` carga sin `500`
- `ingresos-parciales`, `ingresos_pendientes` e `ingresos_cobrados` mantienen su contrato actual
- `workpaper` muestra columnas de complemento sin depender de parseo masivo en runtime

## Paso 18. Recordatorio De Segunda Fase

Aunque esta guía valida la mínima viable, sigue pendiente la segunda fase para:

- madurar heurísticas de búsqueda
- ampliar catálogo de atributos SAT
- endurecer variantes reales de namespaces y versiones
- seguir retirando fallback XML donde la cobertura histórica ya sea total

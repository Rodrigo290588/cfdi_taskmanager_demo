# Backfill Operativo: Proyecciones De Complementos Y REP Especializado

## Objetivo

Ejecutar y validar el backfill de las proyecciones de complementos para habilitar:

- filtros por presencia de complemento
- columnas dinámicas sin parseo XML masivo
- soporte inicial de complementos: Pagos/REP, Nómina (básicos), Carta Porte, Comercio Exterior
- arranque de la tabla especializada `InvoicePaymentComplementDetail` para CFDI tipo PAGO

## Precondiciones

1. Migraciones aplicadas y Prisma regenerado:

```powershell
npx prisma migrate deploy
npx prisma generate
```

2. Llave de cifrado configurada (si se leerá XML desde blobs):

- `INVOICE_XML_ENCRYPTION_KEY`
- o `PROVIDER_CFDI_XML_ENCRYPTION_KEY`

## Backfill 1: Proyecciones de emitidos

### Dry run

```powershell
$env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN="1"
npm run backfill:invoice-complement-projections
Remove-Item Env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN
```

### Ejecución real

```powershell
$env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE="200"
npm run backfill:invoice-complement-projections
Remove-Item Env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE
```

### Reanudar

```powershell
$env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_START_AFTER_ID="<ultimo-id-procesado>"
npm run backfill:invoice-complement-projections
Remove-Item Env:INVOICE_COMPLEMENT_PROJECTION_BACKFILL_START_AFTER_ID
```

## Backfill 2: Proyecciones de recibidos

### Dry run

```powershell
$env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN="1"
npm run backfill:provider-complement-projections
Remove-Item Env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN
```

### Ejecución real

```powershell
$env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE="200"
npm run backfill:provider-complement-projections
Remove-Item Env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE
```

### Reanudar

```powershell
$env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_START_AFTER_ID="<ultimo-id-procesado>"
npm run backfill:provider-complement-projections
Remove-Item Env:PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_START_AFTER_ID
```

## Backfill 3: REP Especializado De Emitidos

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

### Reanudar

```powershell
$env:INVOICE_PAYMENT_COMPLEMENT_BACKFILL_START_AFTER_ID="<ultimo-id-procesado>"
npm run backfill:invoice-payment-complement
Remove-Item Env:INVOICE_PAYMENT_COMPLEMENT_BACKFILL_START_AFTER_ID
```

## Nota Sobre La Mínima Viable

En esta primera etapa:

- cada backfill construye en una sola corrida:
  - índice de complementos
  - atributos consultables del catálogo inicial
- ya existe el arranque de REP especializado para emitidos
- el detalle REP ya captura `paymentNodeIndex`, `BaseP` e `ImporteP`
- todavía falta migrar gradualmente reportes y dashboards a esta tabla

## Validaciones SQL (mínimas)

Guía detallada:

- [validacion-complementos-sql.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/arquitectura/validacion-complementos-sql.md)

1. Conteos base:

```sql
SELECT COUNT(*) FROM invoice_complement_index;
SELECT COUNT(*) FROM invoice_complement_attributes;
SELECT COUNT(*) FROM invoice_payment_complement_details;
SELECT COUNT(*) FROM provider_uploaded_cfdi_complement_index;
SELECT COUNT(*) FROM provider_uploaded_cfdi_complement_attributes;
```

2. Cobertura por tipo:

```sql
SELECT complement_type, COUNT(*) AS total
FROM invoice_complement_attribute
GROUP BY complement_type
ORDER BY total DESC;
```

```sql
SELECT complement_type, COUNT(*) AS total
FROM provider_uploaded_cfdi_complement_attributes
GROUP BY complement_type
ORDER BY total DESC;
```

3. Presencia de REP:

```sql
SELECT
  COUNT(*) AS pagos_detectados
FROM invoice_complement_index
WHERE has_pagos = TRUE;
```

4. Montos fiscales materializados en REP:

```sql
SELECT
  COUNT(*) AS filas_rep,
  COUNT(*) FILTER (WHERE base_p > 0) AS filas_con_base_p,
  COUNT(*) FILTER (WHERE importe_p > 0) AS filas_con_importe_p,
  COUNT(DISTINCT payment_invoice_uuid || ':' || payment_node_index::text) AS nodos_pago_distintos
FROM invoice_payment_complement_details;
```

## Cierre

Antes de conectar el workpaper a estas proyecciones:

- validar que los conteos sean razonables contra el volumen real
- validar que filtros clave (has.PAGOS, has.NOMINA, etc.) tengan resultados esperados
- confirmar que el listado ya no requiere `xmlContent`

## Segunda Fase

Después de estabilizar esta mínima viable, la siguiente etapa debe:

- madurar heurísticas de búsqueda y detección
- ampliar catálogo de atributos por complemento
- migrar reportes de cobranza y drilldowns a `invoice_payment_complement_details`
- endurecer cobertura de variantes reales encontradas en operación

Consulta previa sugerida para arrancar Pagos/REP especializado:

```sql
SELECT COUNT(*) AS total_pagos_emitidos
FROM invoices
WHERE cfdi_type = 'PAGO';
```

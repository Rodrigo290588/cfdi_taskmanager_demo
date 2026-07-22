# Escalabilidad De CFDI De Ingresos

## Objetivo

Llevar la capa de CFDI de ingresos al mismo patrón de escalabilidad que ya usa CFDI recibidos:

- tabla operativa enfocada en filtros de negocio
- XML sensible desacoplado en tabla hija
- resúmenes analíticos para dashboards y KPIs

## Hallazgo Actual

Hoy `invoices` concentra al mismo tiempo:

- datos operativos
- XML completo en `xml_content`
- consultas analíticas masivas para `dashboard_fiscal`
- cálculos de cobranza y PPD en tiempo real

Esto funciona para volumen medio, pero no es el diseño adecuado para millones de registros.

## Fase 1

Primero se endurece la base actual sin romper contratos:

- índices compuestos sobre `invoices`
- índice por `related_uuid` en `invoice_related_cfdis`
- índices compuestos sobre `sat_metadata`

Migración:

```sql
-- prisma/migrations/20260720010000_add_invoice_scaling_phase1_indexes/migration.sql
```

## Fase 2

Crear una tabla hija 1:1 para desacoplar el XML de `invoices`.

Propuesta de nombre:

- `invoice_blobs`

Contenido esperado:

- `invoice_id`
- `xml_ciphertext`
- `xml_iv`
- `xml_auth_tag`
- `xml_encryption_alg`
- `xml_key_version`
- `created_at`
- `updated_at`

Migración preparada:

```sql
-- prisma/migrations/20260720020000_add_invoice_blobs/migration.sql
```

Implementación transicional aplicada:

- las altas nuevas de ingresos ya escriben también en `invoice_blobs`
- el endpoint PDF de `Invoice` ya intenta leer primero desde el blob cifrado
- `invoices.xml_content` se conserva temporalmente por compatibilidad con dashboards y filtros legacy

## Pendiente Operativo

Antes de considerar completada esta fase en ambiente real, queda pendiente ejecutar manualmente:

```bash
npx prisma migrate deploy
npx prisma generate
```

Migraciones pendientes para ingresos:

- `20260720010000_add_invoice_scaling_phase1_indexes`
- `20260720020000_add_invoice_blobs`

## Backfill Historico De Invoice Blobs

Script preparado:

```bash
npm run backfill:invoice-blobs
```

Variables opcionales:

```bash
INVOICE_BLOB_BACKFILL_BATCH_SIZE=100
INVOICE_BLOB_BACKFILL_DRY_RUN=1
INVOICE_BLOB_BACKFILL_START_AFTER_ID=<ultimo-id-procesado>
```

Comportamiento:

- procesa solo registros de `invoices` que todavia no tienen fila en `invoice_blobs`
- trabaja por lotes para no cargar toda la tabla en memoria
- cifra el XML usando la misma estrategia del proyecto
- permite reanudar desde un `id` si el proceso fue interrumpido

Precondiciones:

- migraciones aplicadas
- `npx prisma generate` ejecutado
- `INVOICE_XML_ENCRYPTION_KEY` configurada o, en su defecto, `PROVIDER_CFDI_XML_ENCRYPTION_KEY`

Validacion SQL recomendada:

```sql
SELECT COUNT(*) AS total_invoices
FROM invoices;

SELECT COUNT(*) AS total_invoice_blobs
FROM invoice_blobs;

SELECT COUNT(*) AS invoices_sin_blob
FROM invoices i
LEFT JOIN invoice_blobs b
  ON b.invoice_id = i.id
WHERE b.id IS NULL
  AND COALESCE(NULLIF(TRIM(i.xml_content), ''), '') <> '';

SELECT COUNT(*) AS invoices_con_xml_legacy
FROM invoices
WHERE COALESCE(NULLIF(TRIM(xml_content), ''), '') <> '';
```

## Fase 3

Crear una tabla resumen diaria para dashboards de ingresos.

Propuesta de nombre:

- `invoice_issued_daily_summary`

Dimensiones mínimas:

- entidad fiscal emisora
- RFC emisor
- fecha resumen
- tipo CFDI
- estatus SAT
- método de pago
- bucket de cobranza
- contraparte principal

Métricas mínimas:

- cantidad de CFDI
- subtotal
- descuento
- total
- IVA trasladado
- IVA retenido
- ISR retenido
- IEPS retenido
- monto cobrado
- monto pendiente

Migración preparada:

```sql
-- prisma/migrations/20260720030000_add_invoice_issued_daily_summary/migration.sql
```

Backfill histórico preparado:

```bash
npm run backfill:invoice-issued-summary
```

Variables opcionales:

```bash
INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE=200
INVOICE_ISSUED_SUMMARY_BACKFILL_DRY_RUN=1
INVOICE_ISSUED_SUMMARY_BACKFILL_RESET=1
INVOICE_ISSUED_SUMMARY_BACKFILL_START_AFTER_ID=<ultimo-id-procesado>
```

Comportamiento:

- resume información diaria por emisor fiscal, receptor, tipo, estatus SAT, forma de cobro y bucket de venta
- excluye CFDI legacy cargados como recibidos cuando el RFC emisor no coincide con la entidad fiscal emisora asociada
- usa los XML legacy o `invoice_blobs` para identificar ventas globales y pagos de CRP
- evita duplicados forzando `reset` o `resume` antes de volver a ejecutar sobre una tabla ya poblada

## Fase 4

Backfill histórico por etapas:

1. copiar XML histórico a `invoice_blobs`
2. reconstruir resumen analítico histórico
3. validar conteos y montos contra `dashboard_fiscal`
4. cambiar los dashboards para consultar la tabla resumen
5. limpiar lógicamente `invoices.xml_content` solo cuando el backfill y la lectura transicional estén validados

## Fase 5

Mover la lógica pesada fuera del request path:

- parseo de XML para impuestos
- cálculo de cobranza PPD/CRP
- clasificación de ventas globales vs individuales

## Complementos SAT (Workpaper y módulos futuros)

Para escalar el `workpaper` y soportar atributos de complementos CFDI sin depender del parseo de XML en runtime, se debe implementar una capa de proyección reutilizable:

- índice de complementos por CFDI (presencia/versión)
- atributos consultables para columnas dinámicas
- tablas especializadas para complementos de alto impacto (ej. Pagos/REP)
- JSONB acotado solo para detalle/visor (no como base de analítica masiva)

Documento base:

- [framework-complementos-cfdi.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/arquitectura/framework-complementos-cfdi.md)

Eso debe quedar en procesos incrementales o utilidades de sincronización.

## Riesgos Que Ataca Este Plan

- scans grandes sobre `invoices`
- parseo XML masivo dentro de endpoints
- dependencia de `xml_content` para KPIs
- joins costosos por `related_uuid` sin índice
- crecimiento de latencia en dashboards fiscales y control fiscal

## Validación Recomendada

- comparar tiempos de respuesta antes y después de Fase 1
- revisar planes de ejecución en consultas de `dashboard_fiscal`
- validar conteos de `ingresos-parciales`
- validar control fiscal con filtros por año, mes, RFC y estatus
- validar que `invoice_issued_daily_summary` tenga cobertura completa antes de conectar dashboards

## Nota De Implementación

La Fase 1 es compatible con el diseño futuro y no reemplaza el rediseño mayor. Solo reduce el riesgo inmediato mientras se prepara la migración completa de ingresos.

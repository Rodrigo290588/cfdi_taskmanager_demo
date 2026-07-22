# Backfill Operativo De Ingresos

## Objetivo

Dejar listo el backfill histórico de:

- `invoice_blobs`
- `invoice_issued_daily_summary`

sin duplicar información y con validaciones claras antes de avanzar a dashboards.

## Paso 1. Verificar Variables De Entorno

Debes tener configurada una llave de cifrado:

- `INVOICE_XML_ENCRYPTION_KEY`
- o fallback `PROVIDER_CFDI_XML_ENCRYPTION_KEY`

Sin esto no se podrá leer o escribir correctamente el XML cifrado.

## Paso 2. Aplicar Migraciones Pendientes

Ejecutar manualmente:

```powershell
npx prisma migrate deploy
npx prisma generate
```

Migraciones esperadas:

- `20260720010000_add_invoice_scaling_phase1_indexes`
- `20260720020000_add_invoice_blobs`
- `20260720030000_add_invoice_issued_daily_summary`

## Paso 3. Validar Que Las Tablas Nuevas Existen

```sql
SELECT COUNT(*) FROM invoice_blobs;
SELECT COUNT(*) FROM invoice_issued_daily_summary;
```

Si la segunda tabla ya tiene datos y vas a reconstruir desde cero, deberás correr el backfill del resumen con `RESET=1`.

## Paso 4. Hacer Dry Run Del Backfill De Blobs

```powershell
$env:INVOICE_BLOB_BACKFILL_DRY_RUN="1"
npm run backfill:invoice-blobs
Remove-Item Env:INVOICE_BLOB_BACKFILL_DRY_RUN
```

Revisa:

- que el script detecte registros pendientes
- que no falle por llaves de cifrado
- que el `ultimoId` avance correctamente

## Paso 5. Ejecutar Backfill Real De Blobs

```powershell
$env:INVOICE_BLOB_BACKFILL_BATCH_SIZE="100"
npm run backfill:invoice-blobs
Remove-Item Env:INVOICE_BLOB_BACKFILL_BATCH_SIZE
```

Si el proceso se interrumpe:

```powershell
$env:INVOICE_BLOB_BACKFILL_START_AFTER_ID="<ultimo-id-procesado>"
npm run backfill:invoice-blobs
Remove-Item Env:INVOICE_BLOB_BACKFILL_START_AFTER_ID
```

## Paso 6. Validar Cobertura De Blobs

```sql
SELECT COUNT(*) AS invoices_sin_blob
FROM invoices i
LEFT JOIN invoice_blobs b
  ON b.invoice_id = i.id
WHERE b.id IS NULL
  AND COALESCE(NULLIF(TRIM(i.xml_content), ''), '') <> '';
```

El valor esperado es `0`.

## Paso 7. Hacer Dry Run Del Backfill Del Resumen

```powershell
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_DRY_RUN="1"
npm run backfill:invoice-issued-summary
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_DRY_RUN
```

Revisa:

- que no aparezcan errores de lectura XML
- que `validos` sea consistente con el volumen esperado de ingresos emitidos
- que `dimensiones` no sea anormalmente bajo

## Paso 8. Ejecutar Backfill Real Del Resumen

Si la tabla está vacía:

```powershell
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE="200"
npm run backfill:invoice-issued-summary
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE
```

Si necesitas reconstruir desde cero:

```powershell
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_RESET="1"
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE="200"
npm run backfill:invoice-issued-summary
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_RESET
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_BATCH_SIZE
```

Si necesitas reanudar:

```powershell
$env:INVOICE_ISSUED_SUMMARY_BACKFILL_START_AFTER_ID="<ultimo-id-procesado>"
npm run backfill:invoice-issued-summary
Remove-Item Env:INVOICE_ISSUED_SUMMARY_BACKFILL_START_AFTER_ID
```

Al terminar el proceso guarda del log:

- `Registros procesados`
- `Registros incluidos`
- `Registros omitidos`
- `Dimensiones consolidadas`
- `Ultimo id procesado`

Esos cinco datos son la base de la bitácora final.

## Paso 9. Validar Conteos Y Cobertura Del Resumen

```sql
SELECT COUNT(*) AS total_summary_rows
FROM invoice_issued_daily_summary;

SELECT COUNT(*) AS total_invoices_emitidos_validos
FROM invoices i
INNER JOIN fiscal_entities fe
  ON fe.id = i.issuer_fiscal_entity_id
WHERE UPPER(TRIM(i.issuer_rfc)) = UPPER(TRIM(fe.rfc));

SELECT summary_date, cfdi_type, sat_status, SUM(cfdi_count) AS total_cfdis
FROM invoice_issued_daily_summary
GROUP BY summary_date, cfdi_type, sat_status
ORDER BY summary_date DESC
LIMIT 20;
```

## Paso 10. Validar KPIs Críticos Contra La Tabla Transaccional

Comparar al menos:

- conteo total de CFDI emitidos
- subtotal total de ingresos
- monto total de ingresos vigentes
- distribución por `cfdi_type`
- distribución por `sat_status`
- ventas `GLOBAL`, `INDIVIDUAL` y `NOMINATIVA`

Consulta sugerida para conteo y monto total de ingresos emitidos:

```sql
SELECT
  COUNT(*) AS total_cfdis_emitidos,
  COALESCE(SUM(i.total), 0) AS total_monto_emitido
FROM invoices i
INNER JOIN fiscal_entities fe
  ON fe.id = i.issuer_fiscal_entity_id
WHERE UPPER(TRIM(i.issuer_rfc)) = UPPER(TRIM(fe.rfc))
  AND UPPER(TRIM(i.cfdi_type::text)) IN ('INGRESO', 'PAGO', 'NOMINA');
```

Consulta sugerida contra la tabla resumen:

```sql
SELECT
  COALESCE(SUM(cfdi_count), 0) AS total_cfdis_emitidos,
  COALESCE(SUM(total_amount), 0) AS total_monto_emitido
FROM invoice_issued_daily_summary
WHERE cfdi_type IN ('INGRESO', 'PAGO', 'NOMINA');
```

Consulta sugerida para buckets de venta:

```sql
SELECT sales_bucket, SUM(cfdi_count) AS total_cfdis, SUM(total_amount) AS total_monto
FROM invoice_issued_daily_summary
WHERE cfdi_type = 'INGRESO'
GROUP BY sales_bucket
ORDER BY sales_bucket;
```

Consulta sugerida para buckets de cobranza:

```sql
SELECT payment_status_bucket, SUM(cfdi_count) AS total_cfdis, SUM(pending_amount) AS total_pendiente
FROM invoice_issued_daily_summary
WHERE cfdi_type = 'INGRESO'
GROUP BY payment_status_bucket
ORDER BY payment_status_bucket;
```

## Paso 11. Congelar La Limpieza Del XML Legacy

Todavía **no** limpiar `invoices.xml_content` hasta que:

- el backfill del resumen haya sido validado
- los endpoints objetivo lean ya desde `invoice_issued_daily_summary`
- el backfill de blobs esté validado al 100%

## Paso 12. Cierre Operativo Inmediato Tras El Backfill

En cuanto termine el backfill real del resumen, sigue este orden:

1. Confirmar que el script terminó sin excepción y que imprimió `Fin`.
2. Copiar el `ultimoId` procesado y los totales del log.
3. Ejecutar las consultas SQL del Paso 9 y del Paso 10.
4. Confirmar que los totales globales son razonables contra la tabla transaccional.
5. Registrar cualquier diferencia material antes de tocar dashboards.
6. Guardar evidencia de la ejecución: fecha, hora, ambiente y responsable.
7. Dejar explícito si el proceso fue limpio, reiniciado con `RESET=1` o reanudado con `START_AFTER_ID`.

Si encuentras diferencias relevantes:

- no migres todavía endpoints o dashboards
- no borres `xml_content`
- repite validaciones por subconjunto de fechas, RFC o entidad fiscal
- documenta el hallazgo antes de relanzar el backfill

## Paso 13. Documentar El Resultado Operativo

Después de terminar:

- registrar fecha de ejecución
- registrar versión de la app
- registrar batch size usado
- registrar duración aproximada
- registrar si hubo reanudaciones
- registrar conteos finales de validación

Ese resumen debe ir en `CHANGELOG.md` si el cambio se va a publicar.

Plantilla mínima recomendada:

```md
### Backfill invoice_issued_daily_summary

- Fecha:
- Ambiente:
- Versión de app:
- Responsable:
- Batch size:
- Reset completo: si/no
- Reanudación: si/no
- Último id procesado:
- Registros procesados:
- Registros incluidos:
- Registros omitidos:
- Dimensiones consolidadas:
- Resultado de validación SQL:
- Observaciones:
```

## Paso 14. Siguiente Movimiento Permitido

Después de documentar y validar el backfill, el siguiente paso correcto es:

1. migrar los endpoints y dashboards de ingresos para leer desde `invoice_issued_daily_summary`
2. validar KPIs en UI y drilldowns con datos reales
3. solo después evaluar la limpieza lógica de `invoices.xml_content`

No conviene saltar directo a limpiar XML legacy ni asumir que el resumen ya reemplaza por sí solo toda la lógica actual del `dashboard_fiscal`.

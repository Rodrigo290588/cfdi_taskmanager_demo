# Provider CFDI Storage V2

## Objetivo

Separar el XML cifrado de `provider_uploaded_cfdis` y mover la analítica de `dashboard_recibidos` a una tabla resumen diaria para soportar crecimiento de alto volumen.

## Componentes

- `provider_uploaded_cfdis`
  - tabla operativa principal
  - conserva metadatos, estado SAT, montos y llaves de negocio
- `provider_uploaded_cfdi_blobs`
  - tabla hija 1:1
  - resguarda `xml_ciphertext`, `xml_iv`, `xml_auth_tag`, `xml_encryption_alg`, `xml_key_version`
- `provider_received_cfdi_daily_summary`
  - tabla analítica diaria por empresa receptora
  - alimenta `dashboard_recibidos`

## Flujo Nuevo

1. El proveedor carga el XML.
2. `provider_uploaded_cfdis` guarda solo la parte operativa y `xml_sha256`.
3. `provider_uploaded_cfdi_blobs` guarda el XML cifrado.
4. `provider_received_cfdi_daily_summary` se actualiza incrementalmente.
5. `dashboard_recibidos` consulta la tabla resumen.

## Pasos Manuales

1. Ejecutar la migración:

```sql
-- prisma/migrations/20260603010000_provider_cfdi_storage_v2/migration.sql
```

2. Regenerar Prisma:

```bash
npx prisma generate
```

3. Reiniciar el servidor:

```bash
npm run dev
```

4. Ejecutar el backfill de blobs.

5. Ejecutar el backfill de resumen analítico.

## Backfill De Blobs

Este paso copia el XML cifrado histórico a `provider_uploaded_cfdi_blobs`.

```sql
INSERT INTO provider_uploaded_cfdi_blobs (
  provider_uploaded_cfdi_id,
  xml_ciphertext,
  xml_iv,
  xml_auth_tag,
  xml_encryption_alg,
  xml_key_version,
  created_at,
  updated_at
)
SELECT
  id,
  xml_ciphertext,
  xml_iv,
  xml_auth_tag,
  COALESCE(xml_encryption_alg, 'aes-256-gcm'),
  COALESCE(xml_key_version, 'v1'),
  NOW(),
  NOW()
FROM provider_uploaded_cfdis
WHERE xml_ciphertext IS NOT NULL
  AND xml_iv IS NOT NULL
  AND xml_auth_tag IS NOT NULL
ON CONFLICT (provider_uploaded_cfdi_id) DO UPDATE SET
  xml_ciphertext = EXCLUDED.xml_ciphertext,
  xml_iv = EXCLUDED.xml_iv,
  xml_auth_tag = EXCLUDED.xml_auth_tag,
  xml_encryption_alg = EXCLUDED.xml_encryption_alg,
  xml_key_version = EXCLUDED.xml_key_version,
  updated_at = NOW();
```

## Backfill De Resumen Analítico

Este paso reconstruye el resumen histórico que usa `dashboard_recibidos`.

```sql
TRUNCATE TABLE provider_received_cfdi_daily_summary;

INSERT INTO provider_received_cfdi_daily_summary (
  id,
  organization_id,
  receiver_company_id,
  summary_date,
  cfdi_type,
  sat_estado,
  issuer_rfc,
  issuer_name,
  payment_method,
  payment_status_bucket,
  cfdi_count,
  total_amount,
  transferred_taxes_total,
  withheld_taxes_total,
  created_at,
  updated_at
)
SELECT
  md5(
    concat_ws(
      '|',
      organization_id,
      receiver_company_id,
      DATE(issuance_date),
      UPPER(COALESCE(cfdi_type, 'SIN_TIPO')),
      UPPER(COALESCE(sat_estado, 'SIN_ESTATUS')),
      UPPER(COALESCE(issuer_rfc, '')),
      UPPER(COALESCE(payment_method, '')),
      CASE
        WHEN UPPER(COALESCE(cfdi_type, '')) <> 'I' THEN 'NO_APLICA'
        WHEN UPPER(COALESCE(payment_status_manual, '')) IN ('PAGADO', 'COMPLETO') THEN 'PAGADO'
        WHEN UPPER(COALESCE(payment_method, '')) = 'PUE' THEN 'PAGADO'
        ELSE 'PENDIENTE'
      END
    )
  ) AS id,
  organization_id,
  receiver_company_id,
  DATE(issuance_date) AS summary_date,
  UPPER(COALESCE(cfdi_type, 'SIN_TIPO')) AS cfdi_type,
  UPPER(COALESCE(sat_estado, 'SIN_ESTATUS')) AS sat_estado,
  UPPER(COALESCE(issuer_rfc, '')) AS issuer_rfc,
  COALESCE(issuer_name, '') AS issuer_name,
  UPPER(COALESCE(payment_method, '')) AS payment_method,
  CASE
    WHEN UPPER(COALESCE(cfdi_type, '')) <> 'I' THEN 'NO_APLICA'
    WHEN UPPER(COALESCE(payment_status_manual, '')) IN ('PAGADO', 'COMPLETO') THEN 'PAGADO'
    WHEN UPPER(COALESCE(payment_method, '')) = 'PUE' THEN 'PAGADO'
    ELSE 'PENDIENTE'
  END AS payment_status_bucket,
  COUNT(*)::int AS cfdi_count,
  COALESCE(SUM(total), 0) AS total_amount,
  COALESCE(SUM(transferred_taxes_total), 0) AS transferred_taxes_total,
  COALESCE(SUM(withheld_taxes_total), 0) AS withheld_taxes_total,
  NOW(),
  NOW()
FROM provider_uploaded_cfdis
WHERE validation_status = 'APPROVED'
  AND receiver_company_id IS NOT NULL
  AND issuance_date IS NOT NULL
GROUP BY
  organization_id,
  receiver_company_id,
  DATE(issuance_date),
  UPPER(COALESCE(cfdi_type, 'SIN_TIPO')),
  UPPER(COALESCE(sat_estado, 'SIN_ESTATUS')),
  UPPER(COALESCE(issuer_rfc, '')),
  COALESCE(issuer_name, ''),
  UPPER(COALESCE(payment_method, '')),
  CASE
    WHEN UPPER(COALESCE(cfdi_type, '')) <> 'I' THEN 'NO_APLICA'
    WHEN UPPER(COALESCE(payment_status_manual, '')) IN ('PAGADO', 'COMPLETO') THEN 'PAGADO'
    WHEN UPPER(COALESCE(payment_method, '')) = 'PUE' THEN 'PAGADO'
    ELSE 'PENDIENTE'
  END;
```

## Validación Recomendada

```sql
SELECT COUNT(*) AS total_main FROM provider_uploaded_cfdis;
SELECT COUNT(*) AS total_blobs FROM provider_uploaded_cfdi_blobs;
SELECT COUNT(*) AS total_summary FROM provider_received_cfdi_daily_summary;
```

## Limpieza Lógica Posterior

Cuando valides que las descargas XML y `dashboard_recibidos` ya operan correctamente con el nuevo diseño, puedes limpiar las columnas legado del XML dentro de `provider_uploaded_cfdis`:

```sql
UPDATE provider_uploaded_cfdis p
SET
  xml_ciphertext = NULL,
  xml_iv = NULL,
  xml_auth_tag = NULL,
  xml_encryption_alg = NULL,
  xml_key_version = NULL
WHERE EXISTS (
  SELECT 1
  FROM provider_uploaded_cfdi_blobs b
  WHERE b.provider_uploaded_cfdi_id = p.id
);
```

Ese paso conviene hacerlo solo después de validar el backfill.

## Eliminación Física Final

Una vez que ya confirmaste:

- cargas nuevas correctas
- descargas XML correctas
- `dashboard_recibidos` correcto
- `main_con_xml_legacy = 0`

ya puedes eliminar físicamente las columnas legacy ejecutando:

```sql
-- prisma/migrations/20260603020000_drop_provider_cfdi_legacy_xml_columns/migration.sql
```

Después de eso, ejecuta:

```bash
npx prisma generate
```

y reinicia:

```bash
npm run dev
```

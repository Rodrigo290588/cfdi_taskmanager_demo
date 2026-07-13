# API Externa de Actualizacion de Pagos de Proveedor

## Objetivo

Este documento describe la integracion REST protegida con OAuth 2.0 Client Credentials para actualizar el `Estatus de pago` y la `Fecha de pago` del reporte persistido de CFDI del proveedor.

## Entregables tecnicos

1. Middleware de autenticacion y validacion de scope:
   - `src/lib/m2m-route.ts`
   - `src/lib/m2m-oauth.ts`
2. Schema de validacion con reglas condicionales:
   - `src/lib/provider-payment-update.ts`
3. Servicio de negocio y persistencia:
   - `src/lib/provider-cfdi-storage.ts`
4. Handler del endpoint:
   - `src/app/api/external/provider-payments/route.ts`
5. Extension del modelo persistente:
   - `prisma/schema.prisma`
   - `prisma/migrations/20260602021000_add_provider_payment_status_fields/migration.sql`
6. Coleccion Postman unificada:
   - `postman/cfdi-external-services.postman_collection.json`

## Endpoints

### 1. Obtener token M2M

- Metodo: `POST`
- URL: `/api/oauth/token`
- Content-Type: `application/x-www-form-urlencoded`
- Auth: `Basic Auth`

#### Parametros

- `grant_type=client_credentials`
- `scope=payments:update`

#### Respuesta exitosa

```json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "payments:update"
}
```

#### Errores esperados

- `400 unsupported_grant_type`
- `401 invalid_client`
- `403 invalid_scope`
- `429 rate_limited`

### 2. Actualizar estatus y fecha de pago

- Metodo: `PATCH`
- URL: `/api/external/provider-payments`
- Content-Type: `application/json`
- Header: `Authorization: Bearer <TOKEN>`
- Scope requerido: `payments:update`

#### Payload valido cuando el estatus es PAGADO

```json
{
  "uuid": "11111111-2222-3333-4444-555555555555",
  "estatus_pago": "PAGADO",
  "fecha_pago": "2026-06-01T18:30:00Z"
}
```

#### Payload valido cuando el estatus no es PAGADO

```json
{
  "uuid": "11111111-2222-3333-4444-555555555555",
  "estatus_pago": "EN_PROCESO"
}
```

#### Respuesta exitosa

```json
{
  "success": true,
  "organizationId": "org_123",
  "uuid": "11111111-2222-3333-4444-555555555555",
  "estatus_pago": "PAGADO",
  "fecha_pago": "2026-06-01T18:30:00.000Z",
  "automatic_status_snapshot": "Parcialmente cobrado"
}
```

#### Errores esperados

- `400 Datos invalidos`
- `401 Token invalido o expirado`
- `403 El token no contiene el scope requerido`
- `404 No se encontro un CFDI con el UUID proporcionado`
- `409 El CFDI no se encuentra aprobado o la transicion de estado no es valida`
- `429 Demasiadas peticiones para este cliente`
- `500 Error interno del servidor`

## Reglas de validacion del payload

El schema se implementa con Zod y aplica reglas estrictas.

### Campos obligatorios

- `uuid`: UUID valido y existente en base de datos
- `estatus_pago`: solo `INICIAL`, `EN_PROCESO`, `PAGADO`, `COMPLETO`
- `fecha_pago`: ISO 8601 con zona horaria, solo cuando corresponde

### Reglas condicionales

- Si `estatus_pago === 'PAGADO'`, `fecha_pago` es obligatoria
- Si `estatus_pago !== 'PAGADO'`, `fecha_pago` se rechaza para evitar ruido
- El CFDI debe existir en `provider_uploaded_cfdis`
- El CFDI debe tener `validation_status = 'APPROVED'`
- No se permite actualizar un CFDI de tipo REP (`cfdi_type = 'P'`)
- Si el estado efectivo actual ya es `COMPLETO`, no puede regresar a un estado anterior

## Middleware de autenticacion y scopes

El middleware:

- Lee `Authorization: Bearer <TOKEN>`
- Verifica firma, issuer y audience del JWT
- Valida que `token_use` sea `m2m`
- Valida que el scope incluya `payments:update`
- Devuelve `401` o `403` segun corresponda

## Controles de seguridad aplicados

- JWT de corta duracion para acceso M2M
- Comparacion segura de secretos con `crypto.timingSafeEqual`
- Hash `bcrypt` para `clientSecret` cuando el cliente M2M se resguarda en base de datos
- Rate limiting por `clientId` con maximo `5` peticiones por segundo
- Auditoria de cada actualizacion sobre `provider_uploaded_cfdis`
- Sin exposicion del XML cifrado al consumidor externo

## Persistencia

La actualizacion manual se resguarda en los campos:

- `payment_status_manual`
- `payment_date_manual`
- `payment_status_updated_at`
- `payment_status_updated_by_client_id`

El reporte del proveedor toma estos valores como override manual sobre el estatus automatico calculado por REP.

## Migracion manual requerida

Antes de probar el endpoint, aplica esta migracion de forma manual:

```sql
ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "payment_status_manual" TEXT,
ADD COLUMN IF NOT EXISTS "payment_date_manual" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "payment_status_updated_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "payment_status_updated_by_client_id" TEXT;

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_payment_status_manual_idx"
ON "provider_uploaded_cfdis"("payment_status_manual");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_payment_date_manual_idx"
ON "provider_uploaded_cfdis"("payment_date_manual");
```

Despues:

1. Ejecuta `npx prisma generate`
2. Reinicia `npm run dev`
3. Solicita token con scope `payments:update`
4. Ejecuta el `PATCH /api/external/provider-payments`
5. Verifica el reflejo del cambio en `/provider/cfdis-report`

## Flujo recomendado para el cliente

1. Resguardar `clientId` y `clientSecret` del cliente M2M
2. Solicitar token en `/api/oauth/token`
3. Consumir `/api/external/provider-payments` con Bearer token
4. Si hay `429`, reintentar con backoff respetando `Retry-After`
5. Registrar en el sistema cliente el `uuid`, el `estatus_pago` enviado y la respuesta recibida

## Uso en Postman

1. Importar `postman/cfdi-external-services.postman_collection.json`
2. Ajustar `baseUrl`, `clientId`, `clientSecret`, `invoiceUuid` y `paymentDateIso`
3. Ejecutar `OAuth > 2. Token payments:update`
4. Ejecutar `Pagos de Proveedor > 1. Actualizar a PAGADO` o `Pagos de Proveedor > 2. Actualizar a EN_PROCESO`

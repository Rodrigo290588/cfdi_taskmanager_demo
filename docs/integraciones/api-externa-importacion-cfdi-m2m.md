# API Externa de Importacion CFDI M2M

## Objetivo

Este documento describe la integracion REST para importar CFDI emitidos y recibidos hacia la plataforma mediante OAuth 2.0 Client Credentials.

La documentacion esta orientada a clientes que necesitan conectar sus propios sistemas, ERPs o procesos automatizados con la aplicacion.

## Alcance funcional

La integracion permite:

1. Solicitar un token OAuth M2M
2. Enviar uno o varios XML CFDI en una sola peticion
3. Consultar el estatus general de una corrida de importacion
4. Consultar el detalle de los documentos procesados dentro de una corrida

## Entregables tecnicos

1. Middleware de autenticacion y validacion de scope:
   - `src/lib/m2m-route.ts`
   - `src/lib/m2m-oauth.ts`
2. Preparacion y staging del payload:
   - `src/lib/external-cfdi-import-staging.ts`
3. Procesamiento asincrono y persistencia:
   - `src/lib/external-cfdi-import-processing.ts`
4. Endpoints externos:
   - `src/app/api/external/cfdi-import/route.ts`
   - `src/app/api/external/cfdi-import/runs/[importRunId]/route.ts`
   - `src/app/api/external/cfdi-import/runs/[importRunId]/items/route.ts`
5. Coleccion Postman:
   - `postman/cfdi-external-services.postman_collection.json`

## Autenticacion

La API utiliza OAuth 2.0 con flujo `client_credentials`.

### Scope requerido

- `cfdi.import`

### 1. Obtener token M2M

- Metodo: `POST`
- URL: `/api/oauth/token`
- Content-Type: `application/x-www-form-urlencoded`
- Auth: `Basic Auth`

#### Parametros

- `grant_type=client_credentials`
- `scope=cfdi.import`

#### Ejemplo con curl

```bash
curl --request POST "https://TU-DOMINIO/api/oauth/token" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --header "Authorization: Basic BASE64(clientId:clientSecret)" \
  --data "grant_type=client_credentials&scope=cfdi.import"
```

#### Respuesta exitosa

```json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "cfdi.import"
}
```

#### Errores esperados

- `400 unsupported_grant_type`
- `401 invalid_client`
- `403 invalid_scope`
- `500 server_error`

## Endpoint principal de importacion

### 2. Crear corrida de importacion

- Metodo: `POST`
- URL: `/api/external/cfdi-import`
- Content-Type: `application/json`
- Header: `Authorization: Bearer <TOKEN>`
- Scope requerido: `cfdi.import`

### Reglas importantes del endpoint

- El campo `source` debe enviarse como `JAVA_M2M`
- Se acepta carga de XML individuales
- Tambien se acepta un archivo `.zip` con multiples XML CFDI
- Cuando la carga proviene de un directorio del JAR, puede enviarse adicionalmente el bloque `directoryControl`
- El procesamiento es asincrono; la respuesta inicial solo confirma la recepcion y crea la corrida
- El `batchId` es opcional y sirve para idempotencia

### Estructura del payload

```json
{
  "batchId": "cliente-lote-20260730-001",
  "source": "JAVA_M2M",
  "directoryControl": {
    "executionId": "dir-exec-20260730153000-ff98aa11",
    "totalXmlFiles": 120,
    "skippedByProgressFiles": 20,
    "newXmlFiles": 100
  },
  "items": [
    {
      "fileName": "factura-001.xml",
      "contentBase64": "PD94bWwgdmVyc2lvbj0iMS4wIj8+..."
    },
    {
      "fileName": "factura-002.xml",
      "contentBase64": "PD94bWwgdmVyc2lvbj0iMS4wIj8+...",
      "contentSha256": "00f9ef0b6fbb61d6f0fcb2d7d077dc48f53ce9f7b3ce1f2a2df43c8160c0a111"
    }
  ]
}
```

### Campos del payload

#### Campo `batchId`

- Tipo: `string`
- Obligatorio: no
- Longitud maxima: `191`
- Uso: identificador externo del lote
- Recomendacion: enviar un valor unico por ejecucion para facilitar trazabilidad e idempotencia

#### Campo `source`

- Tipo: `string`
- Obligatorio: si
- Valor permitido: `JAVA_M2M`
- Uso: identifica el origen tecnico de la importacion

#### Campo `items`

- Tipo: `array`
- Obligatorio: si
- Minimo: `1`
- Maximo por request: `500`

Cada elemento de `items` representa un archivo a importar.

#### Campo `items[].fileName`

- Tipo: `string`
- Obligatorio: si
- Uso: nombre logico del archivo
- Ejemplos: `factura-001.xml`, `lote-julio.zip`

#### Campo `items[].contentBase64`

- Tipo: `string`
- Obligatorio: si
- Uso: contenido binario del archivo codificado en Base64
- Soporta XML y ZIP

#### Campo `items[].contentSha256`

- Tipo: `string`
- Obligatorio: no
- Uso: hash SHA-256 del archivo original para validacion de integridad
- Recomendacion: enviarlo siempre que el sistema cliente pueda calcularlo

#### Campo `directoryControl`

- Tipo: `object`
- Obligatorio: no
- Uso: cifras de control para importacion por directorio
- Aplica: cuando el cliente Java procesa una carpeta completa

#### Campo `directoryControl.executionId`

- Tipo: `string`
- Obligatorio: si, cuando se envia `directoryControl`
- Uso: identificador logico de una ejecucion completa de directorio

#### Campo `directoryControl.totalXmlFiles`

- Tipo: `integer`
- Obligatorio: si, cuando se envia `directoryControl`
- Uso: total de archivos XML detectados en el directorio

#### Campo `directoryControl.skippedByProgressFiles`

- Tipo: `integer`
- Obligatorio: si, cuando se envia `directoryControl`
- Uso: XML omitidos porque ya estaban registrados en `progress.log`

#### Campo `directoryControl.newXmlFiles`

- Tipo: `integer`
- Obligatorio: si, cuando se envia `directoryControl`
- Uso: XML realmente nuevos a enviar
- Regla: debe ser igual a `totalXmlFiles - skippedByProgressFiles`

### Limites tecnicos

- Maximo `500` archivos por request
- Maximo `50 MB` por archivo
- Maximo `250 MB` por request completo
- Maximo `500` XML por archivo ZIP
- Maximo `5000` entradas dentro de un ZIP

### Ejemplo de respuesta exitosa

- HTTP `202 Accepted`

```json
{
  "success": true,
  "importRunId": "067a3177-9b37-4403-a5c7-69fb11182d49",
  "status": "QUEUED",
  "receivedFiles": 2,
  "acceptedFiles": 2,
  "rejectedFiles": 0,
  "logicalItems": 2,
  "idempotent": false,
  "rejections": [],
  "limits": {
    "maxFilesPerRequest": 500,
    "maxBytesPerFile": 52428800,
    "maxRequestBytes": 262144000
  }
}
```

### Significado de la respuesta

- `importRunId`: identificador de la corrida para consultar estatus
- `status`: estatus inicial de la corrida
- `receivedFiles`: archivos recibidos en el request
- `acceptedFiles`: archivos aceptados para staging
- `rejectedFiles`: archivos rechazados en validacion inicial
- `logicalItems`: CFDI lógicos generados despues de expandir ZIPs
- `idempotent`: indica si el `batchId` ya existia y se devolvio la corrida previa
- `rejections`: detalle de archivos rechazados

### Errores esperados

- `400 Datos inválidos`
- `400 No se aceptó ningún archivo para importación`
- `400 Las cifras de control del directorio no coinciden con la sesión ya registrada`
- `401 Token inválido o expirado`
- `403 El token no contiene el scope requerido`
- `413 El payload excede los límites permitidos`
- `429 Demasiadas peticiones para este cliente`
- `500 Error interno del servidor`

## Consulta de estatus de corrida

### 3. Consultar resumen de corrida

- Metodo: `GET`
- URL: `/api/external/cfdi-import/runs/{importRunId}`
- Header: `Authorization: Bearer <TOKEN>`
- Scope requerido: `cfdi.import`

#### Ejemplo con curl

```bash
curl --request GET "https://TU-DOMINIO/api/external/cfdi-import/runs/067a3177-9b37-4403-a5c7-69fb11182d49" \
  --header "Authorization: Bearer TU_TOKEN"
```

#### Respuesta exitosa

```json
{
  "success": true,
  "importRun": {
    "id": "067a3177-9b37-4403-a5c7-69fb11182d49",
    "organizationId": "cmnntrppk000502gcp93ketfx",
    "source": "JAVA_M2M",
    "batchId": "cliente-lote-20260730-001",
    "directoryControl": {
      "hasDirectoryControl": true,
      "totalXmlFiles": 120,
      "skippedByProgressFiles": 20,
      "newXmlFiles": 100,
      "acceptedItems": 2,
      "processedItems": 2,
      "acceptanceGap": 98,
      "processingGap": 0
    },
    "status": "COMPLETED",
    "totalItems": 2,
    "processedItems": 2,
    "createdEmitted": 1,
    "createdReceived": 1,
    "skippedItems": 0,
    "errorItems": 0,
    "waitingExternalValidationItems": 0,
    "startedAt": "2026-07-30T18:41:09.183Z",
    "finishedAt": "2026-07-30T18:41:09.460Z",
    "createdAt": "2026-07-30T18:41:08.881Z",
    "updatedAt": "2026-07-30T18:41:09.460Z",
    "progressPercent": 100,
    "throughputPerMinute": 216.6
  }
}
```

Cuando la corrida mostrada arriba forma parte de una importacion de directorio completa, la conciliacion total del directorio se consulta desde el Monitor de Importacion y se calcula agregando todas las corridas vinculadas al mismo `executionId`.

#### Nota para importaciones por directorio

Cuando el request original se envio con `directoryControl`, la respuesta del resumen de corrida incluye:

- XML detectados en el directorio
- XML omitidos por `progress.log`
- XML nuevos enviados para toda la ejecucion
- CFDI aceptados en la corrida consultada
- CFDI procesados en la corrida consultada
- brechas de conciliacion entre origen, staging y procesamiento

### Estatus posibles de corrida

- `QUEUED`
- `DISPATCHING`
- `PROCESSING`
- `PROCESSING_WITH_EXTERNAL_WAIT`
- `COMPLETED`
- `COMPLETED_WITH_ERRORS`
- `FAILED`
- `CANCELLED`

## Consulta de documentos por corrida

### 4. Consultar items de la corrida

- Metodo: `GET`
- URL: `/api/external/cfdi-import/runs/{importRunId}/items`
- Header: `Authorization: Bearer <TOKEN>`
- Scope requerido: `cfdi.import`

### Query params disponibles

- `page`
- `pageSize`
- `status`
- `direction`
- `validationBucket`
- `hasErrors`
- `waitingExternalValidation`

### Ejemplo de consulta

```bash
curl --request GET "https://TU-DOMINIO/api/external/cfdi-import/runs/067a3177-9b37-4403-a5c7-69fb11182d49/items?page=1&pageSize=100&hasErrors=true" \
  --header "Authorization: Bearer TU_TOKEN"
```

### Respuesta exitosa

```json
{
  "success": true,
  "importRunId": "067a3177-9b37-4403-a5c7-69fb11182d49",
  "runStatus": "COMPLETED",
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "totalItems": 2,
    "totalPages": 1
  },
  "items": [
    {
      "id": "4a99681b-4403-493e-aa8d-a62e4d945f9d",
      "fileName": "emitido-prueba.xml",
      "uuid": "6697B4CC-F7E9-4643-A609-BFAA10620D56",
      "issuerRfc": "ODE8604257UA",
      "receiverRfc": "XAXX010101000",
      "classificationResult": "EMITTED",
      "direction": "EMITTED",
      "status": "PERSISTED",
      "validationStatus": null,
      "validationBucket": null,
      "errorCode": null,
      "errorMessage": null,
      "attemptCountInternal": 1,
      "attemptCountExternal": 0,
      "nextExternalRetryAt": null,
      "processingStartedAt": "2026-07-30T18:41:09.213Z",
      "processingFinishedAt": "2026-07-30T18:41:09.444Z",
      "createdAt": "2026-07-30T18:41:08.881Z",
      "updatedAt": "2026-07-30T18:41:09.444Z"
    }
  ]
}
```

### Significado de campos del item

- `classificationResult`: resultado de clasificacion inicial del XML
  - `EMITTED`
  - `RECEIVED`
  - `BOTH`
  - `NONE`
- `direction`: direccion final procesada
  - `EMITTED`
  - `RECEIVED`
- `status`: estatus del documento dentro del pipeline
- `validationStatus`: resultado de validacion, cuando aplica
- `validationBucket`: agrupacion funcional de validacion
  - `VALIDO`
  - `INVALIDO`
- `errorCode`: codigo tecnico del error
- `errorMessage`: descripcion del error

### Estatus posibles de item

- `QUEUED`
- `PREPARING`
- `PREPARED`
- `VALIDATING_INTERNAL`
- `WAITING_EXTERNAL_VALIDATION`
- `VALIDATING_EXTERNAL`
- `VALIDATED`
- `PERSISTING`
- `PERSISTED`
- `SKIPPED`
- `FAILED`
- `CANCELLED`

## Reglas funcionales de clasificacion

La plataforma clasifica cada XML con base en los RFC registrados dentro del tenant:

- si el RFC del emisor coincide con una empresa registrada, se procesa como `emitido`
- si el RFC del receptor coincide con una empresa registrada, se procesa como `recibido`
- si ambos RFC pertenecen a empresas del mismo grupo, el resultado puede ser `BOTH`
- si no coincide con empresas registradas, el item puede terminar con error funcional

## Recomendaciones para clientes integradores

1. Solicitar un token nuevo antes de vencer el actual
2. Enviar `batchId` unico por lote
3. Enviar `contentSha256` para control de integridad
4. Consultar la corrida con polling hasta llegar a un estatus terminal
5. Si se recibe `429`, respetar `Retry-After` y aplicar backoff
6. No asumir que `202 Accepted` significa persistencia final completada

## Secuencia recomendada de integracion

1. Solicitar token en `/api/oauth/token`
2. Enviar archivos a `/api/external/cfdi-import`
3. Guardar `importRunId`
4. Consultar `/api/external/cfdi-import/runs/{importRunId}`
5. Consultar `/api/external/cfdi-import/runs/{importRunId}/items` para detalle
6. Tratar como finalizados los estatus `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED` o `CANCELLED`

## Ejemplo de flujo con polling

```text
POST /api/oauth/token
POST /api/external/cfdi-import
GET  /api/external/cfdi-import/runs/{importRunId}
GET  /api/external/cfdi-import/runs/{importRunId}/items
```

## Uso en Postman

1. Importar `postman/cfdi-external-services.postman_collection.json`
2. Ajustar `baseUrl`, `clientId`, `clientSecret` y XML de prueba
3. Ejecutar `OAuth > 3. Token cfdi.import`
4. Ejecutar la carpeta `Importacion CFDI M2M`

## Datos requeridos para entrega al cliente

Para conectar un sistema externo se deben entregar como minimo:

- `baseUrl`
- `clientId`
- `clientSecret`
- `scope`: `cfdi.import`
- limites operativos vigentes
- ejemplo de payload
- politica de reintentos ante `429` y `500`

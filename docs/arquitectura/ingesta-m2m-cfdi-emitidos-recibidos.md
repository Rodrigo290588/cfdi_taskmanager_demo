# Diseño Técnico: Ingesta M2M CFDI Emitidos Y Recibidos

## Objetivo

Definir una arquitectura de importación masiva para el cliente Java (`java-client`) que permita:

- importar CFDI emitidos y recibidos
- clasificar cada XML contra las empresas registradas en `/companies`
- persistir cada documento en el conjunto de tablas correcto (`ingresos` o `egresos`)
- reportar la importación en `/dashboard/import-monitor`
- exponer autenticación M2M vía OAuth 2.0 `client_credentials`
- escalar a volúmenes de millones de CFDI sin bloquear el request-path

## Decisiones De Negocio Confirmadas

1. Si un XML coincide contra empresas registradas tanto por `Emisor.Rfc` como por `Receptor.Rfc`, el CFDI debe tratarse como **emitido** para la empresa cuyo RFC aparece en `Emisor.Rfc`.
2. Cuando el tenant tenga un grupo de compañías que se facturan entre sí:
   - la empresa cuyo RFC coincide con `Emisor.Rfc` debe registrar ese CFDI como **emitido**
   - la empresa cuyo RFC coincide con `Receptor.Rfc` debe registrar ese CFDI como **recibido**
3. Todo CFDI recibido importado por el `jar` debe pasar por las mismas validaciones de `/provider/cfdis-report`.
4. La validación masiva de recibidos debe moverse a backend asíncrono para no degradar ni el `jar` ni la carga manual del portal.
5. La importación futura de CFDI de nómina queda como pendiente para un módulo especializado.

## Estado Actual

### Endpoint del cliente Java

El `jar` actual consume `POST /api/import`, no `POST /api/v1/ingest`.

### Capacidades actuales de `/api/import`

El flujo actual:

- parsea XML server-side
- resuelve emitidos por RFC
- persiste en `invoices`
- genera `invoice_blobs`
- genera proyección de complementos
- genera `invoice_payment_complement_details`

### Capacidades actuales de `/api/v1/ingest`

El flujo actual:

- usa API key
- espera payload ya normalizado
- soporta `syncId`
- no es hoy la mejor base para clasificar XML crudo entre emitidos y recibidos

### Portal de proveedores

`/provider/cfdis-report` ya resuelve:

- contexto del proveedor
- empresas permitidas
- validación de XML y ZIP
- validación PAC Anexo 20
- validación SAT
- reglas de negocio de recibidos
- persistencia en `provider_uploaded_cfdis`
- XML cifrado
- proyección de complementos de recibidos
- sincronización de resúmenes de recibidos

### Import monitor

`/dashboard/import-monitor` hoy lee `/api/monitor/stats`, y esa API consulta la tabla legacy `cfdi`.

Esto implica que el monitor actual no representa confiablemente la nueva ingesta basada en `invoice` y `provider_uploaded_cfdis`.

## Problema A Resolver

Se requiere unificar un flujo M2M que:

- reciba XML o ZIP
- clasifique cada CFDI contra empresas registradas del tenant
- inserte emitidos y recibidos en sus pipelines correctos
- pueda crear dos registros lógicos a partir de un mismo XML cuando el grupo de compañías se facture entre sí
- reporte la corrida de importación con métricas reales
- descargue el trabajo pesado a workers

## Arquitectura Objetivo

## 1. Nuevo endpoint externo de importación

Se propone crear un endpoint M2M nuevo y explícito:

`POST /api/external/cfdi-import`

Características:

- autenticación OAuth 2.0 `client_credentials`
- `Bearer token`
- scope dedicado, por ejemplo `cfdi.import`
- payload orientado a lotes
- aceptación rápida del lote
- respuesta con `importRunId`

### Contrato propuesto

#### 1.1 Autenticación

- Header requerido:
  - `Authorization: Bearer <access_token>`
- El token se obtiene con OAuth 2.0 `client_credentials` desde:
  - `POST /api/oauth/token`
- Scope requerido (mínimo):
  - `cfdi.import`

#### 1.2 Request

**Endpoint**

- `POST /api/external/cfdi-import`

**Content-Type**

- `application/json`
- Confirmado para el `jar`: `JSON + base64`

**Payload**

```json
{
  "batchId": "string-opcional-idempotencia",
  "source": "JAVA_M2M",
  "items": [
    {
      "fileName": "A.xml",
      "contentBase64": "PE...==",
      "contentSha256": "opcional-hex"
    }
  ]
}
```

**Semántica**

- `batchId`
  - recomendado para idempotencia del cliente
  - si se reenvía el mismo `batchId` para el mismo `organizationId` + `source`, el backend debe devolver el mismo `importRunId`
- `items`
  - lista de archivos en bruto (XML o ZIP)
  - cada ítem debe enviarse como `contentBase64` (base64 del archivo tal cual)
- `contentSha256`
  - opcional
  - si viene, el backend lo usa para validación rápida de integridad
- Un mismo archivo puede generar 1 o 2 ítems lógicos de procesamiento según reglas intragrupo (emitido/recibido), por eso el run debe distinguir:
  - `receivedFiles` (archivos recibidos)
  - `logicalItems` (emitidos/recibidos generados tras clasificación)

#### 1.3 Límites (MVP recomendado)

Los límites son configurables, pero el MVP inicia con:

- `maxFilesPerRequest`: `500`
- `maxBytesPerFile`: `50MB` (antes de base64)
- `maxRequestBytes`: `250MB` (antes de base64)
- `maxZipEntries`: `5000` (si el archivo es ZIP)
- `maxXmlPerZip`: `500` (si el ZIP trae más, se rechaza o se particiona)

Notas operativas:

- `500 archivos` es el techo lógico por request, no la garantía de que siempre podrán viajar juntos en una sola llamada.
- Cuando existan CFDI grandes (por ejemplo, mayores a `30MB` antes de base64), el `jar` debe particionar el envío en múltiples requests para respetar `maxRequestBytes`.
- El backend validará ambas restricciones:
  - número de archivos
  - tamaño total acumulado del request
- En `JSON + base64`, el tamaño transmitido crece aproximadamente un `33%`, por lo que el `jar` debe calcular el chunking con base en el tamaño original y un margen de expansión.

Errores asociados:

- `413 Payload Too Large` cuando excede límites de tamaño
- `400 Bad Request` cuando excede límites lógicos (ej. ZIP sin XML)

#### 1.4 Respuesta (aceptación rápida)

Status: `202 Accepted`

```json
{
  "success": true,
  "importRunId": "cuid",
  "status": "QUEUED",
  "receivedFiles": 500,
  "acceptedFiles": 500,
  "rejectedFiles": 0,
  "limits": {
    "maxFilesPerRequest": 500,
    "maxBytesPerFile": 52428800,
    "maxRequestBytes": 262144000
  }
}
```

#### 1.5 Errores

Estructura de error estándar:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

Casos comunes:

- `401 Unauthorized`
  - token faltante/expirado
- `403 Forbidden`
  - token sin `scope` requerido
- `400 Bad Request`
  - payload inválido, base64 inválido, `items` vacío
- `413 Payload Too Large`
  - límites excedidos
- `429 Too Many Requests`
  - rate limit por cliente M2M (incluye `Retry-After`)

#### 1.6 Consulta de estatus para el `jar`

El `jar` no debe depender de notificaciones push. El contrato oficial será por polling usando `importRunId`.

### A. Resumen de corrida

**Endpoint**

- `GET /api/external/cfdi-import/runs/:importRunId`

**Autenticación**

- `Authorization: Bearer <access_token>`
- scope mínimo: `cfdi.import`

**Objetivo**

- devolver el estado agregado de la corrida
- informar progreso y métricas útiles para el `jar`
- exponer si aún existen XML esperando validación externa

**Respuesta 200**

```json
{
  "success": true,
  "importRun": {
    "id": "cuid",
    "organizationId": "cuid",
    "source": "JAVA_M2M",
    "batchId": "cliente-batch-001",
    "status": "PROCESSING_WITH_EXTERNAL_WAIT",
    "totalItems": 500,
    "processedItems": 470,
    "createdEmitted": 220,
    "createdReceived": 180,
    "skippedItems": 40,
    "errorItems": 20,
    "waitingExternalValidationItems": 30,
    "startedAt": "2026-07-23T17:00:00.000Z",
    "finishedAt": null,
    "createdAt": "2026-07-23T16:58:00.000Z",
    "updatedAt": "2026-07-23T17:10:00.000Z",
    "progressPercent": 94,
    "throughputPerMinute": 120.5
  }
}
```

**Semántica de `status`**

- `QUEUED`: aceptada, aún no despachada
- `DISPATCHING`: particionando y encolando trabajos
- `PROCESSING`: jobs activos o en cola
- `PROCESSING_WITH_EXTERNAL_WAIT`: ya no hay trabajo interno pendiente, pero aún existen ítems esperando validación externa PAC/SAT
- `COMPLETED`: todos los ítems terminaron en `persisted` o `skipped`
- `COMPLETED_WITH_ERRORS`: la corrida terminó, pero al menos un ítem quedó en `failed`
- `FAILED`: fallo sistémico de la corrida
- `CANCELLED`: corrida cancelada operativamente

**Errores**

- `404 Not Found`
  - `importRunId` inexistente o no visible para el `organizationId` del token
- `403 Forbidden`
  - el cliente M2M no pertenece a esa organización

### B. Detalle paginado por XML / ítem lógico

**Endpoint**

- `GET /api/external/cfdi-import/runs/:importRunId/items`

**Query params**

- `page` (default `1`)
- `pageSize` (default `100`, máximo `500`)
- `status` (opcional)
- `direction` (`EMITTED|RECEIVED`, opcional)
- `validationBucket` (`VALIDO|INVALIDO`, opcional)
- `hasErrors` (`true|false`, opcional)
- `waitingExternalValidation` (`true|false`, opcional)

**Objetivo**

- permitir al `jar` consultar el detalle item-by-item
- obtener errores concretos y estado por XML
- facilitar reintentos, logs y conciliación

**Respuesta 200**

```json
{
  "success": true,
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "totalItems": 500,
    "totalPages": 5
  },
  "items": [
    {
      "id": "cuid",
      "fileName": "A.xml",
      "uuid": "F3F7E4C4-....",
      "issuerRfc": "AAA010101AAA",
      "receiverRfc": "BBB010101BBB",
      "classificationResult": "BOTH",
      "direction": "RECEIVED",
      "status": "WAITING_EXTERNAL_VALIDATION",
      "validationStatus": "PENDING_EXTERNAL",
      "validationBucket": null,
      "errorCode": null,
      "errorMessage": null,
      "attemptCountInternal": 1,
      "attemptCountExternal": 4,
      "nextExternalRetryAt": "2026-07-23T18:00:00.000Z",
      "emittedInvoiceId": null,
      "receivedProviderUploadedCfdiId": null,
      "processingStartedAt": "2026-07-23T17:00:10.000Z",
      "processingFinishedAt": null,
      "createdAt": "2026-07-23T16:58:00.000Z",
      "updatedAt": "2026-07-23T17:10:00.000Z"
    }
  ]
}
```

### C. Códigos y mensajes esperados por ítem

El endpoint debe devolver mensajes concluyentes y homogéneos para que el `jar` pueda reportarlos o persistirlos localmente.

**Casos mínimos**

- `RFC_NOT_REGISTERED`
  - el XML no corresponde a ninguna empresa registrada del tenant
- `INVALID_XML`
  - XML corrupto, ilegible o sin estructura mínima SAT
- `MISSING_UUID`
  - no contiene UUID timbrado
- `DUPLICATE_UUID`
  - el CFDI ya existe para esa organización/dirección
- `WAITING_EXTERNAL_VALIDATION`
  - sigue pendiente respuesta concluyente PAC/SAT
- `VALIDATION_FAILED`
  - falló validación PAC/SAT o una regla de negocio
- `PERSISTED_OK`
  - quedó registrado correctamente

### D. Recomendación de polling para el `jar`

- mientras el run esté en:
  - `QUEUED`
  - `DISPATCHING`
  - `PROCESSING`
  - `PROCESSING_WITH_EXTERNAL_WAIT`
  el `jar` debe consultar `GET /runs/:importRunId` con polling

**Frecuencia sugerida**

- primeros 2 minutos: cada `5s`
- después: cada `15s`
- si el run está en `PROCESSING_WITH_EXTERNAL_WAIT`: cada `60s`

### E. Cierre operativo para el `jar`

El `jar` puede considerar el ciclo concluido cuando el resumen llegue a alguno de estos estados terminales:

- `COMPLETED`
- `COMPLETED_WITH_ERRORS`
- `FAILED`
- `CANCELLED`

Si termina en `COMPLETED_WITH_ERRORS`, debe consultar el endpoint de items para recuperar el detalle de fallos.

## 2. Clasificación fiscal por empresa registrada

Para cada XML:

1. extraer `Emisor.Rfc`
2. extraer `Receptor.Rfc`
3. buscar ambos RFC dentro de las empresas aprobadas del tenant

### Reglas

- si `Emisor.Rfc` coincide con empresa del tenant:
  - generar registro lógico de **emitido** para esa empresa
- si `Receptor.Rfc` coincide con empresa del tenant:
  - generar registro lógico de **recibido** para esa empresa
- si ninguno coincide:
  - rechazar el XML con error de negocio
- si ambos coinciden:
  - generar ambos registros lógicos
  - **emitido** para la empresa del emisor
  - **recibido** para la empresa del receptor

Esto evita perder operaciones intragrupo.

## 3. Persistencia por módulo

### Emitidos

Debe reutilizar el pipeline de ingresos actual:

- `invoices`
- `invoice_concepts`
- `invoice_related_cfdis`
- `invoice_blobs`
- `invoice_complement_index`
- `invoice_complement_attributes`
- `invoice_payment_complement_details`

### Recibidos

Debe reutilizar el pipeline de proveedores/egresos:

- `provider_uploaded_cfdis`
- `provider_uploaded_cfdi_blobs`
- `provider_uploaded_cfdi_complement_index`
- `provider_uploaded_cfdi_complement_attributes`
- tablas resumen y sincronizaciones de recibidos ya existentes

## 4. Reutilización de validaciones de recibidos

La importación masiva de recibidos no debe reimplementar reglas aparte.

Debe reutilizar la misma lógica base de:

- `buildProviderReport(...)`
- `persistProviderAcceptedCfdis(...)`
- reglas de negocio del portal de proveedores
- validación PAC
- validación SAT
- sincronización de cumplimiento de pagos

## 5. Separación entre aceptación y procesamiento

Para soportar millones de CFDI, el endpoint externo no debe procesar todo en línea.

### Flujo objetivo

1. el endpoint recibe el lote
2. registra una corrida de importación
3. guarda los ítems en staging liviano
4. encola trabajos BullMQ
5. responde inmediatamente con `importRunId`
6. los workers procesan clasificación, validación y persistencia

## 6. Monitor de importación nuevo

Se propone reemplazar la dependencia de la tabla legacy `cfdi` por un modelo explícito de corridas:

### Tabla `import_runs`

Campos sugeridos:

- `id`
- `organization_id`
- `source` (`java_m2m`, `provider_portal`, `manual_admin`)
- `batch_id`
- `status` (`queued`, `processing`, `completed`, `completed_with_errors`, `failed`)
- `total_items`
- `processed_items`
- `created_emitted`
- `created_received`
- `skipped_items`
- `error_items`
- `started_at`
- `finished_at`
- `created_at`
- `created_by_machine_client_id`

### Tabla `import_run_items`

Campos sugeridos:

- `id`
- `import_run_id`
- `file_name`
- `xml_sha256`
- `uuid`
- `issuer_rfc`
- `receiver_rfc`
- `classification_result`
- `status`
- `error_code`
- `error_message`
- `emitted_invoice_id`
- `received_storage_id`
- `processing_started_at`
- `processing_finished_at`

### Beneficios

- el monitor ya no depende de tablas legacy
- permite medir velocidad real de ingesta
- permite auditoría e idempotencia
- sirve tanto para `jar` como para cargas del portal

## 7. Seguridad M2M

La base actual de OAuth 2.0 puede reutilizarse:

- `/api/oauth/token`
- `grant_type=client_credentials`
- token `Bearer`
- scopes por cliente

### Reglas propuestas

- scope mínimo: `cfdi.import`
- cada cliente M2M debe estar asociado a un `organizationId`
- validación de IP permitida cuando aplique
- límites de tamaño por lote
- límites de concurrencia por cliente
- auditoría por `machineClient`

## 8. Estrategia de rendimiento

Para alto volumen, la optimización debe concentrarse en backend, no sólo en el `jar`.

### Recomendaciones

1. **Batching**
   - recibir y procesar por lotes controlados
   - no hacer una transacción pesada por archivo

2. **Pre-carga de empresas por tenant**
   - resolver RFCs permitidos una sola vez por lote
   - evitar consultas repetidas por documento

3. **Idempotencia**
   - deduplicar por `xml_sha256` y/o `uuid + organization + direction`

4. **Workers**
   - usar BullMQ para clasificación, validación y persistencia
   - limitar concurrencia por worker

5. **Chunking en persistencia**
   - insertar por grupos cuando aplique
   - reservar transacciones cortas para escritura final

6. **Validaciones externas desacopladas**
   - PAC y SAT deben ejecutarse fuera del request-path síncrono
   - el lote puede marcar un estado intermedio `validated_async`

7. **Staging**
   - almacenar staging ligero del lote antes de procesar
   - no recalcular ZIP/XML completo en cada retry

## 9. Diseño funcional del jar

El `jar` debe permanecer lo más simple posible.

Responsabilidades del `jar`:

- autenticarse con OAuth 2.0
- subir lotes XML/ZIP
- consultar estatus por `importRunId`
- reintentar lotes fallidos
- mostrar métricas básicas de throughput

Responsabilidades del backend:

- clasificar emitido/recibido
- validar empresas registradas
- ejecutar validaciones de recibidos
- persistir en tablas correctas
- alimentar monitor
- auditar e imponer controles de seguridad
- notificar errores de importación a cliente M2M
- notificar éxito de importación a cliente M2M
- notificar errores de validación a cliente M2M
- notificar errores de validación en el FRONTEND en el reporte de /dashboard_recibidos/workpaper atraves de un botón en el reporte e incluya el motivo en que validación fallo y que validaciones pasaron. 
- clasificar los CFDI que tienen errores de validación como "invalido" en la tabla de resumen
- clasificar los CFDI que estan validos como "valido" en la tabla de resumen. 

## 10. Fases recomendadas

## Fase 1. Base M2M y monitoreo

- crear `POST /api/external/cfdi-import`
- agregar scope `cfdi.import`
- crear `import_runs` e `import_run_items`
- migrar `/dashboard/import-monitor` a ese nuevo origen

Resultado esperado:

- el `jar` ya puede autenticarse de forma estándar
- la plataforma ya puede registrar corridas de importación

## Fase 2. Clasificación emitido/recibido por tenant

- extraer `Emisor.Rfc` y `Receptor.Rfc`
- resolver empresas del tenant por RFC
- generar una o dos rutas lógicas según el caso intragrupo
- rechazar XML sin match en empresas registradas

Resultado esperado:

- soporte correcto de grupos de compañías

## Fase 3. Reuso del pipeline de emitidos

- encapsular el flujo actual de `/api/import` en un servicio reusable
- desacoplarlo de sesión web
- permitir invocación desde workers M2M

Resultado esperado:

- emitidos usando el storage nuevo de ingresos

## Fase 4. Reuso del pipeline de recibidos

- extraer la lógica de `/provider/cfdis-report` a un servicio reusable para background
- separar validación y persistencia
- permitir que portal proveedor y `jar` usen el mismo core

Resultado esperado:

- recibidos con reglas homogéneas sin duplicar lógica

## Fase 5. Optimización de volumen

- lotes más grandes
- staging
- chunking
- retries controlados
- métricas de throughput por worker
- ajuste de concurrencia

Resultado esperado:

- ingesta estable para millones de CFDI

## 11. Riesgos que el diseño debe evitar

- clasificar mal CFDI intragrupo
- duplicar la lógica de validación entre portal y `jar`
- mantener el monitor sobre la tabla legacy `cfdi`
- bloquear requests HTTP con validaciones externas
- mezclar nómina con ingresos/egresos sin módulo especializado

## 12. Pendientes explícitos

- definir si la validación PAC/SAT de recibidos será obligatoria antes de marcar `completed` o si puede quedar como `completed_with_async_validation`
- definir límites máximos por lote para el `jar`
- diseñar el contrato de consulta de estatus por `importRunId`
- diseñar el modelo futuro de importación de CFDI de nómina en módulo especializado

## 13. Diseño De La Cola De Validación Masiva Para Recepción

Esta sección aterriza específicamente el procesamiento de CFDI recibidos para cargas masivas provenientes del `jar` y del portal `/provider/cfdis-report`.

### Objetivos operativos

- aceptar lotes grandes sin bloquear el request-path
- aislar fallos por XML sin abortar la corrida completa
- reutilizar el mismo núcleo de validación para portal y M2M
- evitar que el `jar` degrade la experiencia del portal
- soportar revalidación externa continua cuando PAC o SAT no respondan oportunamente

### Decisiones confirmadas

- lote inicial objetivo: `500 XML`
- el error de un XML no debe tumbar ni el sublote ni la corrida completa
- la corrida de recepción tendrá cierre **mixto**
- las validaciones externas PAC/SAT deben reintentarse de forma continua hasta obtener respuesta exitosa
- el `jar` y el portal deben operar en **colas separadas**

## 13.1 Modelo de colas

Se proponen dos colas BullMQ independientes:

1. `received-cfdi-import-queue`
   - origen: `jar` M2M
   - prioridad: throughput
   - objetivo: alta capacidad y procesamiento batch

2. `provider-cfdi-upload-queue`
   - origen: `/provider/cfdis-report`
   - prioridad: experiencia interactiva del usuario
   - objetivo: mantener tiempos razonables para carga manual

### Motivo de separación

- una corrida masiva del `jar` no debe bloquear la carga manual del proveedor
- cada canal puede tener concurrencia y límites propios
- permite pausar o degradar un canal sin afectar el otro

## 13.2 Jobs propuestos

La cola de recepción no debe hacer todo en un solo job.

Se propone dividir el proceso en cuatro tipos de job:

### A. `received-import-run-dispatch`

Responsabilidad:

- tomar un `importRun`
- partirlo en chunks de trabajo
- encolar jobs hijo por cada chunk

Payload sugerido:

```json
{
  "importRunId": "cuid",
  "source": "java_m2m",
  "chunkSize": 500
}
```

### B. `received-import-item-prepare`

Responsabilidad:

- leer XML staging
- extraer `UUID`, `Emisor.Rfc`, `Receptor.Rfc`, `TipoDeComprobante`
- clasificar contra empresas registradas
- validar estructura mínima
- decidir si el documento genera registro lógico de recibido
- crear/actualizar el estado del ítem

Salida:

- `rejected_no_company_match`
- `rejected_invalid_xml`
- `prepared_for_validation`

### C. `received-import-item-validate`

Responsabilidad:

- ejecutar validaciones equivalentes a `/provider/cfdis-report`
- validación Anexo 20
- validación SAT
- reglas de negocio del portal
- producir resultado normalizado

Salida:

- `validated_ok`
- `validated_with_observations`
- `rejected_business_rule`
- `waiting_external_validation`

### D. `received-import-item-persist`

Responsabilidad:

- persistir en `provider_uploaded_cfdis`
- guardar blob cifrado
- proyectar complementos
- sincronizar resúmenes de recibidos
- disparar flujos post-load aplicables

Salida:

- `persisted`
- `failed_persist`

## 13.3 Estados por ítem

Se propone que `import_run_items.status` soporte al menos:

- `queued`
- `preparing`
- `prepared`
- `validating_internal`
- `waiting_external_validation`
- `validating_external`
- `validated`
- `persisting`
- `persisted`
- `skipped`
- `failed`
- `cancelled`

### Semántica clave

- `waiting_external_validation`
  - el ítem ya superó parsing y clasificación
  - queda pendiente por respuesta útil de PAC o SAT

- `validated`
  - la capa de validación terminó satisfactoriamente
  - ya puede pasar a persistencia

- `persisted`
  - el CFDI ya vive en el storage definitivo de recibidos

- `failed`
  - el documento no puede continuar sin intervención

## 13.4 Estados por corrida

Se propone que `import_runs.status` soporte:

- `queued`
- `dispatching`
- `processing`
- `processing_with_external_wait`
- `completed`
- `completed_with_errors`
- `failed`
- `cancelled`

### Regla de cierre mixto

La corrida se considera:

- `processing`
  - cuando existen jobs activos o en cola

- `processing_with_external_wait`
  - cuando ya no hay trabajo interno pendiente, pero aún existen ítems en `waiting_external_validation`

- `completed`
  - cuando todos los ítems terminaron en `persisted` o `skipped`

- `completed_with_errors`
  - cuando todos los ítems terminaron, pero al menos uno quedó en `failed`

Esto implementa el cierre mixto solicitado:

- operativamente la corrida avanza y no se traba
- funcionalmente sigue visible que hay documentos esperando respuesta externa

## 13.5 Concurrencia inicial

Se propone arrancar con:

- `received-cfdi-import-queue`: `concurrency = 5`
- `provider-cfdi-upload-queue`: `concurrency = 5`

### Criterio

- respeta la convención actual del proyecto para workers
- limita presión sobre PAC/SAT y la base
- reduce el riesgo de ráfagas agresivas

### Evolución sugerida

La concurrencia debe quedar parametrizable por variables de entorno:

- `RECEIVED_M2M_IMPORT_CONCURRENCY=5`
- `RECEIVED_PROVIDER_UPLOAD_CONCURRENCY=5`
- `RECEIVED_IMPORT_CHUNK_SIZE=500`

## 13.6 Manejo de chunks

Aunque el lote objetivo es `500 XML`, la corrida puede contener miles o millones de CFDI.

### Regla

- el endpoint acepta el lote lógico
- el dispatcher lo parte en `chunks` de `500`
- cada chunk genera jobs independientes

### Beneficios

- mejor control de memoria
- reintentos acotados
- menor tiempo de lock transaccional
- monitoreo más preciso por segmento

## 13.7 Reintentos

### Reintentos internos

Para fallos transitorios de infraestructura:

- lectura staging
- Redis
- timeouts locales
- conflictos temporales de DB

Política sugerida:

- `attempts: 3`
- `backoff: exponential`
- retraso base: `10s`

### Reintentos externos PAC/SAT

Aquí la política es distinta.

No conviene limitarse a `3` intentos si el servicio externo puede tardar más.

### Regla acordada

El ítem debe quedar en **revalidación continua** hasta obtener una respuesta exitosa, sin bloquear el resto de la corrida.

### Implementación sugerida

Cuando PAC o SAT no devuelvan una respuesta concluyente:

- no marcar `failed`
- mover el ítem a `waiting_external_validation`
- reencolar un job `received-import-item-validate` diferido

### Backoff recomendado

Se sugiere una secuencia creciente con tope:

1. `5 min`
2. `15 min`
3. `30 min`
4. `60 min`
5. luego mantener `60 min` entre revalidaciones

Esto evita saturar servicios externos y está alineado con las reglas del proyecto para procesos fiscales asíncronos.

### Cuándo termina la revalidación

La revalidación continua sólo debe detenerse cuando ocurra una de estas condiciones:

1. se obtiene respuesta externa exitosa y utilizable
2. el documento se marca como inválido con error concluyente no recuperable
3. se cancela manualmente la corrida o el ítem

## 13.8 Aislamiento de fallos

El fallo de un XML recibido:

- no debe abortar el lote
- no debe abortar el chunk completo
- no debe mover a `failed` toda la corrida

### Regla

Cada `import_run_item` es la unidad mínima de error.

La corrida agrega métricas:

- `processed_items`
- `persisted_items`
- `failed_items`
- `waiting_external_validation_items`

## 13.9 Idempotencia y deduplicación

Para evitar conflictos por reintentos o reenvíos del `jar`:

- deduplicar por `organization_id + xml_sha256 + direction`
- complementar con `organization_id + uuid + receiver_company_id`

### Efecto esperado

- si el mismo XML se reenvía, no debe duplicar almacenamiento
- el ítem puede marcarse como `skipped_duplicate`

## 13.10 Reflejo en el monitor

`/dashboard/import-monitor` debe mostrar, por corrida:

- total recibido
- procesados
- persistidos
- duplicados
- rechazados
- esperando validación externa
- errores definitivos
- throughput por minuto
- tiempo promedio por ítem

### Métricas sugeridas adicionales

- tiempo desde aceptación hasta `prepared`
- tiempo en espera externa PAC/SAT
- tiempo total hasta persistencia
- XML pendientes de revalidación

## 13.11 Reutilización del portal de proveedores

Para no duplicar lógica:

- el portal no debe validar íntegramente dentro del request si la carga es grande
- debe delegar al mismo core reusable de recepción

### Estrategia

- cargas pequeñas del portal:
  - pueden seguir dando feedback rápido
  - pero el núcleo de validación debe ser el mismo

- cargas medianas o grandes:
  - se encolan igual que el `jar`
  - sólo cambia la fuente y la cola

## 13.12 Resultado esperado

Con este diseño:

- el `jar` puede importar lotes masivos de recibidos sin trabar el sistema
- el portal de proveedores conserva buena experiencia de uso
- PAC y SAT no bloquean la aceptación del lote
- el monitor refleja el estado real de la operación
- los fallos quedan aislados por XML
- la plataforma queda lista para escalar la recepción a millones de CFDI

## 14. Diseño De Implementación (Aterrizado A Este Repo)

Esta sección aterriza qué cambios concretos se requieren en el código actual para cumplir:

- ingestión M2M con OAuth 2.0
- clasificación emitido/recibido por RFC por tenant, incluyendo intragrupo
- validación de recibidos equivalente a `/provider/cfdis-report` pero asíncrona
- monitoreo real en `/dashboard/import-monitor`
- visibilidad de errores de validación en `/dashboard_recibidos/workpaper`
- clasificación de CFDI `válido / inválido` en tablas resumen de recibidos

### 14.1 Modelos de datos nuevos para monitoreo

Crear modelos nuevos (Prisma + migración SQL):

1. `ImportRun`
   - representa una corrida de importación (lote lógico)
   - se crea al aceptar el request M2M (o portal cuando aplique)

2. `ImportRunItem`
   - representa cada XML/archivo dentro del run
   - guarda `uuid`, RFC emisor/receptor, clasificación, estatus, y el resultado final de persistencia

Campos mínimos sugeridos:

- `ImportRun`
  - `id`
  - `organizationId`
  - `source` (`java_m2m`, `provider_portal`)
  - `batchId` (idempotencia del cliente)
  - `status` (ver sección 13.4)
  - `totalItems`
  - `processedItems`
  - `createdEmitted`
  - `createdReceived`
  - `skippedItems`
  - `errorItems`
  - `waitingExternalValidationItems`
  - `startedAt`, `finishedAt`
  - `createdAt`, `updatedAt`
  - `createdByMachineClientId` (cuando aplique)

- `ImportRunItem`
  - `id`
  - `importRunId`
  - `fileName`
  - `xmlSha256`
  - `uuid`
  - `issuerRfc`, `receiverRfc`
  - `classificationResult` (`emitted`, `received`, `both`, `none`)
  - `direction` (para el caso intragrupo)
  - `status` (ver sección 13.3)
  - `errorCode`, `errorMessage`
  - `validationStatus` (aprobado/rechazado, cuando sea recibido)
  - `nextExternalRetryAt` (cuando aplique)
  - `attemptCountInternal`, `attemptCountExternal`
  - `emittedInvoiceId`
  - `receivedProviderUploadedCfdiId`
  - `processingStartedAt`, `processingFinishedAt`
  - `createdAt`, `updatedAt`

Staging (XML):

- Para evitar blobs gigantes en `ImportRunItem`, se recomienda staging separado:
  - tabla `import_run_item_blobs` o uso de storage cifrado equivalente al modelo de proveedores
  - mínimo: `importRunItemId`, `xmlCiphertext`, `xmlIv`, `xmlAuthTag`, `xmlSha256`

### 14.2 Unificación de “notificación” al cliente M2M

La “notificación” al cliente M2M se implementa como contrato explícito de consulta:

- `GET /api/external/cfdi-import/runs/:importRunId`
  - resumen de corrida
  - contadores
  - lista paginada de errores (opcional)

- `GET /api/external/cfdi-import/runs/:importRunId/items?page=...`
  - estatus item-by-item para el `jar`

Reglas:

- el endpoint debe devolver mensajes concluyentes por XML:
  - error de RFC no registrado
  - XML inválido
  - UUID duplicado
  - validación PAC/SAT pendiente
  - validación fallida (con detalle)
  - persistencia ok

Esto cubre:

- notificar errores de importación a cliente M2M
- notificar éxito de importación a cliente M2M
- notificar errores de validación a cliente M2M

### 14.3 Recepción: persistencia de CFDI inválidos

Para que `/dashboard_recibidos/workpaper` y el monitor puedan mostrar errores de validación, los CFDI recibidos con validaciones fallidas deben persistirse con:

- `validationStatus != 'APPROVED'`
- mensajes de validación (`validationAnexo20`, `validationSat`)
- flags de reglas de negocio ya existentes

Gap actual:

- el portal `/provider/cfdis-report` hoy persiste sólo `acceptedRecords`
- los rechazados sólo viven como texto en `errors[]`

Cambio requerido:

- persistir también los rechazados (recibidos inválidos) en `provider_uploaded_cfdis`
- agregar un campo nuevo en `ProviderUploadedCfdi` para motivo de rechazo, por ejemplo:
  - `validationErrorMessage` (TEXT)

Esto habilita:

- clasificar “inválido” en resúmenes
- mostrar en UI el motivo

### 14.4 Resúmenes de recibidos: válido / inválido

Hoy `provider_received_cfdi_daily_summary` excluye todo lo no aprobado (ver `provider-received-cfdi-summary.ts`).

Para cumplir:

- “clasificar los CFDI que tienen errores de validación como inválido en la tabla de resumen”
- “clasificar los CFDI que están válidos como válido en la tabla de resumen”

Se requiere:

1. agregar una dimensión `validation_bucket` (o `validation_status_bucket`) en `ProviderReceivedCfdiDailySummary`
2. incluir esa dimensión en el `@@unique(...)`
3. ajustar el builder para:
   - no excluir no aprobados
   - mapear:
     - `APPROVED` -> `VALIDO`
     - cualquier otro -> `INVALIDO`

Resultado:

- los dashboards pueden filtrar “sólo válidos”
- y a la vez medir “inválidos” como un subconjunto visible

### 14.5 Workpaper recibidos: botón de validación y detalle

Requisito:

- “notificar errores de validación en el FRONTEND en el reporte de `/dashboard_recibidos/workpaper` a través de un botón”
- “incluir el motivo en qué validación falló y qué validaciones pasaron”

Cambios propuestos:

1. API `GET /api/dashboard_recibidos/invoices`
   - hoy fuerza `validationStatus: 'APPROVED'`
   - debe permitir incluir inválidos:
     - default: devolver todo
     - o usar query param: `validationBucket=VALIDO|INVALIDO|ALL`
   - debe exponer en cada row:
     - `validationStatus`
     - `validationAnexo20`
     - `validationSat`
     - `hasResicoIsrRetention`, `hasObjetoImpTaxMismatch`, `objetoImpTaxMismatchReason`
     - `validationErrorMessage` (nuevo)

2. UI `/dashboard_recibidos/workpaper`
   - agregar una columna/acción “Validación”
   - abre un modal con:
     - Anexo 20: ok / fail + mensaje
     - SAT: ok / fail + mensaje
     - Reglas de negocio: ok / fail + motivo
   - el modal debe poder copiar el texto para soporte

Nota:

- el workpaper ya consume proyecciones (`projection`) y columnas dinámicas; el botón de validación debe ser adicional y no romper el patrón.

### 14.6 Jobs y workers en el repo

El repo ya tiene BullMQ (`src/lib/queue.ts`) y workers registrados por `src/scripts/start-worker.ts`.

Cambios requeridos:

1. extender `src/lib/queue.ts` con:
   - `RECEIVED_M2M_IMPORT_QUEUE_NAME`
   - `PROVIDER_UPLOAD_IMPORT_QUEUE_NAME`

2. agregar workers:
   - `src/workers/received-m2m-import.worker.ts`
   - `src/workers/provider-upload-import.worker.ts`

3. registrar workers en `src/scripts/start-worker.ts`

### 14.7 Manejo de reintentos externos (PAC/SAT)

Implementación sugerida (sin loop infinito en memoria):

- cuando la validación externa no sea concluyente:
  - actualizar `ImportRunItem.status = waiting_external_validation`
  - setear `nextExternalRetryAt`
  - reencolar job diferido con delay calculado (5m, 15m, 30m, 60m, 60m...)

El reintento termina cuando:

- la validación externa sea concluyente (ok o error definitivo)
- o se cancele manualmente el ítem/run

### 14.8 Límite de concurrencia y protección del portal

Con colas separadas:

- el portal mantiene capacidad estable
- el `jar` puede correr con throughput controlado

Concurrencia inicial propuesta:

- `RECEIVED_M2M_IMPORT_CONCURRENCY=5`
- `RECEIVED_PROVIDER_UPLOAD_CONCURRENCY=5`
- `RECEIVED_IMPORT_CHUNK_SIZE=500`

### 14.9 Secuencia de implementación recomendada

1. modelos Prisma + migraciones:
   - `ImportRun`, `ImportRunItem`, staging XML
   - `validationErrorMessage` en `ProviderUploadedCfdi`
   - `validationBucket` en `ProviderReceivedCfdiDailySummary`
2. endpoints:
   - `POST /api/external/cfdi-import` (M2M)
   - `GET /api/external/cfdi-import/runs/:id` (estatus)
   - migrar `/api/monitor/stats` a `import_runs`
3. core reusable de recepción:
   - extraer validación de `buildProviderReport` para uso en worker
   - persistir aprobados y rechazados
4. workers:
   - enqueue + dispatch + validate + persist
5. workpaper recibidos:
   - botón de validación + modal
6. hardening y rendimiento:
   - idempotencia
   - métricas y backoff
   - rate limit por cliente M2M

## Plan De Acción Inmediato

1. diseñar el contrato técnico de `POST /api/external/cfdi-import`
2. diseñar las tablas `import_runs` e `import_run_items`
3. extraer el núcleo reusable de emitidos desde `/api/import`
4. extraer el núcleo reusable de recibidos desde `/provider/cfdis-report`
5. mover el trabajo pesado de validación de recibidos a workers
6. migrar `/dashboard/import-monitor` al nuevo modelo
7. actualizar el `jar` para OAuth 2.0 + lotes + consulta de estatus

# Propuesta de implementación: cifras de control para importaciones desde directorio en `/dashboard/import-monitor`

## Resumen

Se propone incorporar una capa de **conciliación de importaciones por directorio** que permita comparar, dentro del Monitor de Importación, estas cuatro cifras bajo los mismos filtros actuales del tablero:

1. **XML detectados en el directorio**
2. **XML nuevos a enviar** después de excluir los ya registrados en `progress.log`
3. **CFDI aceptados / registrados en monitor** (`totalItems` staged)
4. **CFDI procesados / finalizados** (`processedItems`)

La propuesta evita doble conteo cuando una importación de directorio se divide en varios lotes HTTP del JAR. Para ello, en lugar de guardar las cifras de control directamente en cada `import_run`, se agrega una entidad lógica de **sesión de importación de directorio** compartida por múltiples corridas/lotes.

## Análisis del estado actual

### Hallazgos confirmados en el código

- El monitor actual suma métricas históricas desde `import_runs` en [src/lib/external-cfdi-import-monitor.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/external-cfdi-import-monitor.ts).
- La ruta de estadísticas [src/app/api/monitor/stats/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/monitor/stats/route.ts) hoy **no recibe filtros de corridas**; solo resuelve la organización.
- La ruta de corridas [src/app/api/monitor/runs/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/monitor/runs/route.ts) sí maneja filtros por `status`, `source`, `search`, `startDate`, `endDate`.
- El modelo `ImportRun` en [prisma/schema.prisma](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/prisma/schema.prisma) no tiene campos para:
  - total XML detectados en carpeta
  - XML omitidos por `progress.log`
  - XML nuevos del directorio
  - agrupación de varias corridas bajo una sola ejecución de directorio
- El endpoint externo [src/app/api/external/cfdi-import/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/external/cfdi-import/route.ts) hoy solo acepta `batchId`, `source` e `items`.
- El staging en [src/lib/external-cfdi-import-staging.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/external-cfdi-import-staging.ts) crea una nueva fila en `import_runs` por request aceptado.
- El JAR en [java-client/src/main/java/com/cfdi/ingest/App.java](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/java-client/src/main/java/com/cfdi/ingest/App.java):
  - recorre el directorio con `Files.walk`
  - conoce cuántos XML existen
  - conoce cuántos se omiten por `progress.log`
  - envía lotes separados con `sendBatch(...)`
  - genera un `batchId` distinto por lote, por lo que **una sola carga de directorio puede producir múltiples `import_runs`**

### Implicación técnica clave

Si se guardaran las cifras de directorio directamente en cada `import_run`, los totales del monitor quedarían duplicados cuando un directorio se parta en varios lotes. Por eso, la unidad correcta para las cifras de control no es el lote HTTP sino una **sesión lógica de importación de directorio**.

## Decisiones ya tomadas

- Mostrar las nuevas cifras en **tarjetas + corrida**
- Conservar **ambas** cifras del directorio:
  - total XML detectados en carpeta
  - XML realmente nuevos después de `progress.log`
- Comparar contra **ambas** capas del backend:
  - aceptados / registrados en monitor
  - procesados / finalizados
- Las tarjetas deben **respetar los filtros activos** del monitor

## Propuesta de cambios

### 1. Persistencia: nueva sesión lógica de importación de directorio

**Archivo:** [prisma/schema.prisma](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/prisma/schema.prisma)  
**Cambio propuesto:** agregar un nuevo modelo `ImportDirectorySession` y relacionarlo con `ImportRun`.

#### Nuevo modelo propuesto

```prisma
model ImportDirectorySession {
  id                       String          @id @default(cuid())
  organizationId           String          @map("organization_id")
  source                   ImportRunSource
  executionId              String          @map("execution_id")
  totalXmlFiles            Int             @map("total_xml_files")
  skippedByProgressFiles   Int             @map("skipped_by_progress_files")
  newXmlFiles              Int             @map("new_xml_files")
  createdByMachineClientId String?         @map("created_by_machine_client_id")
  createdAt                DateTime        @default(now()) @map("created_at")
  updatedAt                DateTime        @updatedAt @map("updated_at")
  organization             Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  importRuns               ImportRun[]

  @@unique([organizationId, source, executionId], map: "import_directory_sessions_org_source_exec_key")
  @@index([organizationId, createdAt], map: "import_directory_sessions_org_created_idx")
  @@map("import_directory_sessions")
}
```

#### Cambios en `ImportRun`

Agregar campos nullable:

```prisma
directorySessionId String? @map("directory_session_id")
directorySession   ImportDirectorySession? @relation(fields: [directorySessionId], references: [id], onDelete: SetNull)
```

Agregar índices:

```prisma
@@index([directorySessionId], map: "import_runs_directory_session_idx")
```

#### Por qué así

- Evita doble conteo de XML detectados cuando una importación de directorio se fragmenta en varios lotes.
- Mantiene `import_runs` como unidad técnica de procesamiento.
- Permite mostrar conciliación por corrida/lote y también por ejecución completa de directorio.

### 2. Contrato M2M: extender el POST externo con metadatos de directorio

**Archivo:** [src/app/api/external/cfdi-import/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/external/cfdi-import/route.ts)  
**Cambio propuesto:** ampliar el esquema `externalCfdiImportSchema` con un bloque opcional `directoryControl`.

#### Payload propuesto

```ts
const directoryControlSchema = z.object({
  executionId: z.string().trim().min(1).max(191),
  totalXmlFiles: z.number().int().min(0),
  skippedByProgressFiles: z.number().int().min(0),
  newXmlFiles: z.number().int().min(0)
}).superRefine((value, ctx) => {
  if (value.totalXmlFiles < value.skippedByProgressFiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'totalXmlFiles no puede ser menor que skippedByProgressFiles',
      path: ['totalXmlFiles']
    })
  }

  if (value.totalXmlFiles - value.skippedByProgressFiles !== value.newXmlFiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'newXmlFiles debe ser igual a totalXmlFiles - skippedByProgressFiles',
      path: ['newXmlFiles']
    })
  }
})
```

```ts
const externalCfdiImportSchema = z.object({
  batchId: z.string().trim().min(1).max(191).optional(),
  source: z.literal(CFDI_IMPORT_SOURCE).default(CFDI_IMPORT_SOURCE),
  directoryControl: directoryControlSchema.optional(),
  items: z.array(importItemSchema).min(1).max(MAX_FILES_PER_REQUEST)
})
```

#### Reglas

- `directoryControl` será **opcional** para no romper clientes existentes ni importaciones de archivo único.
- Solo se aceptará para `source = JAVA_M2M`.
- No se almacenará la ruta local del directorio para no exponer paths operativos.

### 3. Staging: crear o reutilizar sesión de directorio y ligar cada lote

**Archivo:** [src/lib/external-cfdi-import-staging.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/external-cfdi-import-staging.ts)  
**Cambio propuesto:** ampliar `stageExternalCfdiImport(...)` para recibir `directoryControl` y resolver una `ImportDirectorySession`.

#### Firma propuesta

```ts
export async function stageExternalCfdiImport(params: {
  organizationId: string
  clientId: string
  batchId?: string | null
  directoryControl?: {
    executionId: string
    totalXmlFiles: number
    skippedByProgressFiles: number
    newXmlFiles: number
  } | null
  items: StagedSourceItem[]
}): Promise<StageResult>
```

#### Lógica propuesta

1. Si `directoryControl` no viene:
   - flujo actual sin cambios
2. Si `directoryControl` viene:
   - buscar `ImportDirectorySession` por `organizationId + source + executionId`
   - si no existe, crearla
   - si existe, validar que las cifras coincidan exactamente; si no coinciden, rechazar con `400`
   - crear el `import_run` con `directory_session_id` apuntando a la sesión

#### Razón de la validación estricta

Evita que un mismo `executionId` reciba lotes con diferentes cifras de control, lo que rompería la conciliación del monitor.

### 4. Monitor backend: agregar estadísticas filtradas y métricas de conciliación

**Archivo:** [src/lib/external-cfdi-import-monitor.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/external-cfdi-import-monitor.ts)  
**Cambio propuesto:** extender `getOrganizationImportMonitorStats(...)` para aceptar `filters: ImportRunFilters` y devolver un nuevo bloque `directoryControl`.

#### Forma de respuesta propuesta

```ts
type DirectoryControlStats = {
  totalXmlFiles: number
  skippedByProgressFiles: number
  newXmlFiles: number
  acceptedItems: number
  processedItems: number
  acceptanceGap: number
  processingGap: number
  matchedDirectorySessions: number
}
```

```ts
type MonitorStats = {
  ...
  directoryControl: DirectoryControlStats
}
```

#### Cálculo propuesto

- Reutilizar `buildRunsWhereClause(...)` para que las estadísticas compartan exactamente los mismos filtros que la tabla.
- Calcular dos agregados:
  1. **corridas filtradas**
  2. **sesiones de directorio distintas** referenciadas por esas corridas filtradas

#### Fórmulas

- `totalXmlFiles`: suma de `ImportDirectorySession.totalXmlFiles`
- `skippedByProgressFiles`: suma de `skippedByProgressFiles`
- `newXmlFiles`: suma de `newXmlFiles`
- `acceptedItems`: suma de `filtered_runs.totalItems` para corridas con `directorySessionId`
- `processedItems`: suma de `filtered_runs.processedItems` para corridas con `directorySessionId`
- `acceptanceGap = newXmlFiles - acceptedItems`
- `processingGap = acceptedItems - processedItems`

#### Compatibilidad histórica

- Corridas anteriores seguirán funcionando
- Si no hay `directorySessionId`, no participan en `directoryControl`
- El bloque `directoryControl` regresará ceros cuando no existan sesiones de directorio en el filtro

### 5. API del monitor: estadísticas con filtros

**Archivo:** [src/app/api/monitor/stats/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/monitor/stats/route.ts)  
**Cambio propuesto:** aceptar los mismos query params que `runs/route.ts`.

#### Parámetros a soportar

- `status`
- `source`
- `search`
- `startDate`
- `endDate`

#### Implementación

- Reutilizar el mismo `parseDateFilter(...)`
- Validar con Zod igual que en [src/app/api/monitor/runs/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/monitor/runs/route.ts)
- Invocar `getOrganizationImportMonitorStats(member.organizationId, filters)`

#### Por qué es obligatorio

El usuario definió que las nuevas tarjetas deben respetar filtros; si stats sigue sin filtrar, las cifras de control no serían confiables.

### 6. API de corridas: enriquecer la respuesta con conciliación por corrida

**Archivos:**
- [src/lib/external-cfdi-import-monitor.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/external-cfdi-import-monitor.ts)
- [src/app/api/monitor/runs/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/monitor/runs/route.ts)

**Cambio propuesto:** agregar, por cada `run`, un bloque opcional `directoryControl`.

#### Estructura propuesta por corrida

```ts
type ImportRunDirectoryControl = {
  hasDirectoryControl: boolean
  executionId: string | null
  totalXmlFiles: number | null
  skippedByProgressFiles: number | null
  newXmlFiles: number | null
  acceptedItems: number
  processedItems: number
  acceptanceGap: number | null
  processingGap: number | null
}
```

#### Regla de cálculo

- Para corridas ligadas a sesión:
  - `acceptedItems = run.totalItems`
  - `processedItems = run.processedItems`
  - `acceptanceGap = newXmlFiles - run.totalItems`
  - `processingGap = run.totalItems - run.processedItems`
- Para corridas sin sesión:
  - `hasDirectoryControl = false`

#### Nota

Esta vista es útil para auditoría operativa del lote específico. La conciliación agregada del directorio completo vive en las tarjetas filtradas.

### 7. UI del monitor: nuevas tarjetas de control y lectura filtrada

**Archivo:** [src/app/dashboard/import-monitor/page.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/import-monitor/page.tsx)  
**Cambio propuesto:** extender `MonitorStats`, ajustar `fetchStats()` para enviar filtros, y agregar una sección de tarjetas de control.

#### Ajustes de estado y fetch

- Ampliar `MonitorStats` con `directoryControl`
- En `fetchStats`, enviar `runSearch`, `runStatusFilter`, `runSourceFilter`, `runStartDateFilter`, `runEndDateFilter`
- Hacer que el refresco automático vuelva a consultar stats con filtros activos

#### Tarjetas nuevas propuestas

Agregar una sección titulada **Cifras de Control de Directorio** con 4 tarjetas:

1. **XML en Directorio**
   - `stats.directoryControl.totalXmlFiles`
   - subtítulo: `Total detectados en corridas de directorio dentro del filtro`

2. **XML Nuevos a Importar**
   - `stats.directoryControl.newXmlFiles`
   - subtítulo: `Excluye los ya registrados en progress.log`

3. **Registrados en Monitor**
   - `stats.directoryControl.acceptedItems`
   - subtítulo: `CFDI staged / aceptados por el backend`

4. **Procesados**
   - `stats.directoryControl.processedItems`
   - subtítulo: `CFDI ya finalizados en el flujo interno`

Debajo de la sección, mostrar dos indicadores compactos:

- `Brecha directorio -> monitor: {acceptanceGap}`
- `Brecha monitor -> procesamiento: {processingGap}`

#### Regla visual

- Si la brecha es `0`, mostrar estado normal/positivo
- Si la brecha es mayor a `0`, mostrar estilo de advertencia
- Si no hay corridas de directorio en el filtro, mostrar `0` y texto `Sin corridas de directorio en el rango seleccionado`

### 8. UI del monitor: conciliación por corrida

**Archivo:** [src/app/dashboard/import-monitor/page.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/import-monitor/page.tsx)  
**Cambio propuesto:** mostrar el bloque de conciliación dentro del detalle de la corrida seleccionada.

#### Contenido propuesto

En el panel/modal de corrida:

- XML detectados en directorio
- XML omitidos por `progress.log`
- XML nuevos a importar
- CFDI aceptados en esta corrida
- CFDI procesados en esta corrida
- Brecha directorio -> monitor
- Brecha monitor -> procesamiento

#### Comportamiento

- Si la corrida no viene de directorio, ocultar el bloque
- Si viene de directorio, mostrarlo antes de la tabla de documentos

### 9. JAR: calcular cifras una vez por ejecución y enviarlas en cada lote

**Archivo:** [java-client/src/main/java/com/cfdi/ingest/App.java](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/java-client/src/main/java/com/cfdi/ingest/App.java)  
**Cambio propuesto:** introducir un `directoryExecutionId` único por ejecución de `importDirectory(...)` y un pre-scan del directorio.

#### Flujo propuesto en `importDirectory(...)`

1. Recorrer el directorio una primera vez para construir:
   - `totalXmlFiles`
   - `skippedByProgressFiles`
   - lista final de `FileRecord` nuevos
2. Calcular:
   - `newXmlFiles = totalXmlFiles - skippedByProgressFiles`
3. Generar un `directoryExecutionId` único una sola vez al inicio
4. Repartir la lista de nuevos XML en lotes de `batchSize`
5. En cada `sendBatch(...)`, enviar:
   - `batchId` único del lote
   - `directoryControl.executionId`
   - `directoryControl.totalXmlFiles`
   - `directoryControl.skippedByProgressFiles`
   - `directoryControl.newXmlFiles`

#### Cambio de firma propuesto

```java
private static ImportResult sendBatch(
    List<FileRecord> records,
    String accessToken,
    CliConfig config,
    String batchId,
    DirectoryControl directoryControl
)
```

#### Payload JSON propuesto

```json
{
  "batchId": "dir-20260730153000-ab12cd34",
  "source": "JAVA_M2M",
  "directoryControl": {
    "executionId": "dir-exec-20260730153000-ff98aa11",
    "totalXmlFiles": 120,
    "skippedByProgressFiles": 20,
    "newXmlFiles": 100
  },
  "items": []
}
```

#### Beneficios

- El backend puede agrupar varios lotes bajo la misma sesión
- No se pierde la granularidad actual por lote
- El operador puede reconciliar directorio completo vs monitor

### 10. Endpoint externo de detalle de corrida: exponer conciliación cuando aplique

**Archivo:** [src/app/api/external/cfdi-import/runs/[importRunId]/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/external/cfdi-import/runs/%5BimportRunId%5D/route.ts)  
**Cambio propuesto:** incluir `directoryControl` dentro de `importRun` cuando la corrida esté ligada a una sesión.

#### Objetivo

- Mantener alineada la documentación externa con el comportamiento real
- Permitir inspección técnica desde API sin depender solo del monitor

#### Alcance

- No crear un endpoint nuevo en esta fase
- Solo enriquecer el resumen ya existente

### 11. Documentación a actualizar

**Archivos:**
- [docs/integraciones/api-externa-importacion-cfdi-m2m.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/integraciones/api-externa-importacion-cfdi-m2m.md)
- [docs/manuales/jar-importacion-cfdi-m2m.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/manuales/jar-importacion-cfdi-m2m.md)

**Cambios propuestos:**

- documentar el nuevo bloque `directoryControl`
- aclarar que aplica solo a importación por directorio
- documentar cómo se calculan:
  - `totalXmlFiles`
  - `skippedByProgressFiles`
  - `newXmlFiles`
- documentar que el monitor compara esas cifras contra:
  - CFDI aceptados
  - CFDI procesados

## Supuestos y límites de la propuesta

1. **No se mostrará la ruta del directorio en UI** para evitar exponer paths locales del cliente.
2. **`batchId` seguirá siendo por lote**, preservando idempotencia actual.
3. **`executionId` será la nueva llave de agrupación lógica** para una ejecución completa de directorio.
4. Las importaciones de archivo único y otras fuentes (`PROVIDER_PORTAL`, `MANUAL_ADMIN`) no cambian.
5. Las tarjetas de control representarán únicamente corridas de directorio que caigan dentro del filtro activo.
6. Las corridas históricas sin sesión de directorio seguirán visibles y no romperán el monitor.

## Riesgos y mitigaciones

### Riesgo 1: doble conteo en estadísticas filtradas

**Mitigación:** sumar cifras de directorio desde sesiones distintas (`DISTINCT directorySessionId`) y no desde `import_runs`.

### Riesgo 2: inconsistencias si el JAR envía el mismo `executionId` con totales distintos

**Mitigación:** validación estricta en staging y rechazo `400`.

### Riesgo 3: costos extra por doble recorrido del directorio en el JAR

**Mitigación:** el pre-scan se limita a conteo y selección de archivos; el costo es aceptable porque evita cifras incorrectas. Si más adelante se requiere optimización, se puede convertir a un solo recorrido con acumulación previa antes de despachar.

## Verificación propuesta

### Casos funcionales

1. **Importación de directorio sin `progress.log`**
   - Carpeta con 120 XML
   - `totalXmlFiles = 120`
   - `skippedByProgressFiles = 0`
   - `newXmlFiles = 120`
   - Tarjetas deben mostrar 120 detectados, 120 nuevos, 120 aceptados y luego 120 procesados al terminar

2. **Importación de directorio con `progress.log`**
   - Carpeta con 120 XML
   - 20 ya registrados en `progress.log`
   - Tarjetas deben mostrar 120 detectados, 100 nuevos, 100 aceptados
   - `acceptanceGap = 0`

3. **Importación con errores de procesamiento**
   - 100 nuevos, 100 aceptados, 97 procesados, 3 con error
   - Tarjetas deben mostrar:
     - `acceptanceGap = 0`
     - `processingGap = 3`

4. **Filtro por fecha / estatus / source**
   - Las tarjetas deben cambiar junto con la tabla de corridas
   - No deben sumar sesiones fuera del filtro

5. **Importación de archivo único**
   - El flujo actual debe permanecer intacto
   - No debe crear `ImportDirectorySession`

6. **Corridas históricas**
   - Deben abrir y mostrarse sin errores
   - El bloque de conciliación solo aparece cuando exista sesión de directorio

### Validaciones técnicas

- Prisma migration aplicada correctamente
- Consultas del monitor sin doble conteo por múltiples lotes de una misma sesión
- Respuesta del endpoint externo incluye `directoryControl` cuando corresponda
- El JAR imprime en consola las cifras de control antes de comenzar los envíos

## Orden de implementación recomendado

1. Prisma: nuevo modelo + relación con `ImportRun`
2. Staging + contrato M2M
3. JAR: cálculo y envío de `directoryControl`
4. Monitor backend: stats filtradas + conciliación por corrida
5. UI del monitor
6. Documentación


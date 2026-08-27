# Plan: Importación de Layout de Cancelaciones en `/dashboard_fiscal/cancelaciones`

## Resumen

Implementar en [`src/app/dashboard_fiscal/cancelaciones/page.tsx`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard_fiscal/cancelaciones/page.tsx) un flujo de carga directa de layout `.txt` separado por `|`, para actualizar cancelaciones en CFDI emitidos desde la pantalla de Cancelaciones.

La funcionalidad debe:

1. Permitir seleccionar y subir un archivo `.txt`.
2. Procesar el archivo en backend con las mismas capas de seguridad usadas en [`src/app/api/admin/users/bulk-invite/route.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/admin/users/bulk-invite/route.ts).
3. Leer por línea y evaluar UUID + reglas de columnas 9, 10 y 11 del layout.
4. Actualizar directamente la base sin vista previa.
5. Buscar por UUID en la tabla `invoice` sin limitar por la empresa seleccionada.
6. Reportar en pantalla:
   - registros actualizados,
   - registros no encontrados,
   - registros ignorados por regla,
   - registros inválidos,
   - registros no contemplados para revisión manual.
7. Mantener consistencia con el dashboard fiscal y su resumen diario.
8. Documentar la operación y el formato del layout.

## Análisis del Estado Actual

### 1. Pantalla actual de cancelaciones

La página [`src/app/dashboard_fiscal/cancelaciones/page.tsx`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard_fiscal/cancelaciones/page.tsx) hoy:

- muestra CFDI emitidos filtrando contra [`/api/dashboard_fiscal/invoices`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard_fiscal/invoices/route.ts),
- carga la empresa seleccionada desde `localStorage`,
- fuerza `satStatus = CANCELADO`,
- no tiene botón ni flujo de importación de layouts,
- ya tiene patrón UI para filtros, exportaciones y toasts.

### 2. Modelo de datos y convención actual de estatus

Según [`prisma/schema.prisma`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/prisma/schema.prisma):

- `invoice.status` usa `InvoiceStatus` = `ACTIVE | CANCELLED | PENDING`
- `invoice.satStatus` usa `SatStatus` = `VIGENTE | CANCELADO | NO_ENCONTRADO`

Se verificó en base que hoy existen facturas con:

- `status = ACTIVE`
- `satStatus = CANCELADO`

Por consistencia con el comportamiento actual del módulo fiscal, la cancelación operativa del layout debe actualizar **`satStatus`**, no `status`.

### 3. Impacto analítico

El dashboard fiscal usa cancelaciones desde `satStatus` en:

- [`src/app/api/dashboard_fiscal/route.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard_fiscal/route.ts)
- [`src/scripts/backfill-invoice-issued-daily-summary.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/scripts/backfill-invoice-issued-daily-summary.ts)

No existe hoy un helper incremental para `invoiceIssuedDailySummary`; solo existe backfill completo.  
Sí existe patrón incremental equivalente para recibidos en [`src/lib/provider-received-cfdi-summary.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/provider-received-cfdi-summary.ts).

### 4. Patrón de seguridad de importación existente

La referencia explícita pedida por el usuario es [`src/app/api/admin/users/bulk-invite/route.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/admin/users/bulk-invite/route.ts).  
Ese flujo ya implementa:

- límite de tamaño,
- validación por extensión y MIME,
- detección de binario disfrazado por bytes nulos,
- almacenamiento temporal aislado en `os.tmpdir()`,
- nombre aleatorio con UUID,
- lectura segura por stream,
- sanitización de datos,
- manejo de errores sin exponer detalles internos,
- destrucción del archivo temporal en `finally`.

### 5. Formato real del layout

Del archivo [`20260701Produccion_cancela.txt`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/20260701Produccion_cancela.txt) se confirmó:

- las líneas inician con `|`,
- la separación es por `|`,
- hay columnas vacías intermedias,
- el UUID está en la **columna 8 humana**,
- el estado SAT está en la **columna 9**,
- la cancelabilidad está en la **columna 10**,
- el estatus de cancelación está en la **columna 11**.

Al parsear en código se debe normalizar la línea para ignorar la primera columna vacía causada por el `|` inicial.

### 6. Hallazgo de codificación

En la muestra aparece texto como `aceptaci�n`, lo que indica que el archivo puede venir con codificación no totalmente limpia para `utf-8`.  
La implementación debe comparar valores por normalización flexible, no por igualdad literal estricta con acentos.

## Supuestos y Decisiones Cerradas

1. **Modo de operación:** aplicar directo al subir el archivo, sin paso previo de confirmación.
2. **Alcance de UUID:** buscar cualquier UUID existente en `invoice`, aunque no pertenezca a la empresa seleccionada.
3. **Campo a actualizar:** cambiar `invoice.satStatus` a `CANCELADO`; no tocar `invoice.status`.
4. **Casos no contemplados:** no actualizar; mostrarlos en pantalla en una tabla copiable para revisión manual.
5. **Ámbito funcional:** esta funcionalidad pertenece a `dashboard_fiscal/cancelaciones`, por lo que opera sobre `invoice` (emitidos), no sobre `provider_uploaded_cfdis`.
6. **Seguridad de carga:** replicar el estándar de `/admin/users-bulk`.
7. **Actualización analítica:** después de actualizar `satStatus`, sincronizar el resumen diario emitido para no dejar inconsistencias en KPIs.

## Cambios Propuestos

### A. UI de carga y resultado en Cancelaciones

**Archivo:** [`src/app/dashboard_fiscal/cancelaciones/page.tsx`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard_fiscal/cancelaciones/page.tsx)

#### Qué cambiar

- Agregar una tarjeta superior o lateral de “Importar layout de cancelaciones”.
- Incorporar:
  - `input type="file"` oculto,
  - botón “Seleccionar archivo”,
  - botón “Procesar layout”,
  - estado `uploading`,
  - almacenamiento del archivo seleccionado,
  - estructura para mostrar resultado del procesamiento.
- Agregar una tarjeta informativa con:
  - formato esperado del archivo,
  - reglas funcionales que sí actualizan,
  - reglas que se ignoran,
  - categorías de salida.
- Refrescar la tabla actual de cancelaciones al finalizar con éxito.

#### Resultado esperado en pantalla

Mostrar un resumen con conteos:

- `procesados`
- `actualizados`
- `ignorados`
- `no encontrados`
- `invalidos`
- `no contemplados`

Y debajo, tablas separadas o tabs para:

- `Actualizados`
- `Ignorados`
- `No encontrados`
- `No contemplados`
- `Errores de formato`

Cada fila debe incluir al menos:

- número de línea,
- UUID,
- columnas 9/10/11 crudas,
- motivo/resolución,
- línea original o un resumen copiable.

#### Por qué

- Da trazabilidad inmediata sin obligar al usuario a revisar logs.
- Resuelve la necesidad de ver qué registros no entraron en reglas.
- Aprovecha la pantalla donde ya se consulta el universo cancelado.

### B. Nuevo endpoint de importación del layout

**Archivo nuevo:** `src/app/api/dashboard_fiscal/cancelaciones/import-layout/route.ts`

#### Responsabilidades

1. Autenticar sesión con `auth()`.
2. Verificar membresía aprobada.
3. Verificar que el usuario tenga acceso a la empresa seleccionada (`companyId`) para habilitar el uso de la pantalla.
4. Recibir `multipart/form-data` con:
   - `file`
   - `companyId`
5. Aplicar las mismas capas de seguridad que `/api/admin/users/bulk-invite`:
   - tamaño máximo,
   - `.txt` + `text/plain`,
   - detección de bytes nulos,
   - guardado temporal fuera del web root,
   - nombre aleatorio,
   - stream de lectura,
   - limpieza del temporal en `finally`,
   - errores genéricos hacia cliente y logs internos completos.
6. Procesar línea por línea sin cargar todo el archivo en memoria.
7. Devolver un JSON estructurado para que la UI lo pinte sin lógica adicional compleja.

#### Esquema de respuesta propuesto

```ts
type LayoutImportResult = {
  summary: {
    processed: number
    updated: number
    ignored: number
    notFound: number
    invalid: number
    unhandled: number
  }
  updatedRows: Array<{ lineNumber: number; uuid: string; previousSatStatus: string; nextSatStatus: string }>
  ignoredRows: Array<{ lineNumber: number; uuid: string; reason: string; statusCol9: string; cancelableCol10: string; processCol11: string }>
  notFoundRows: Array<{ lineNumber: number; uuid: string; reason: string }>
  invalidRows: Array<{ lineNumber: number; reason: string; rawLine: string }>
  unhandledRows: Array<{ lineNumber: number; uuid: string; statusCol9: string; cancelableCol10: string; processCol11: string; rawLine: string }>
}
```

### C. Helper de parseo y reglas del layout

**Archivo nuevo:** `src/lib/dashboard-fiscal-cancelaciones-layout.ts`

#### Objetivo

Encapsular en una librería pura:

- normalización de línea,
- lectura de columnas humanas,
- normalización flexible de valores,
- evaluación de reglas,
- generación de motivos legibles.

#### Reglas funcionales a implementar

##### Regla 1: actualización por cancelado

Si columna 9 = `Cancelado`:

- buscar `invoice` por UUID,
- si existe y `satStatus !== CANCELADO`, actualizar a `CANCELADO`,
- si ya está en `CANCELADO`, reportarlo como ignorado o “sin cambio”.

##### Regla 2: vigente no cancelable

Si columna 9 = `Vigente` y columna 10 = `No Cancelable`:

- ignorar.

##### Regla 3: vigente con aceptación en proceso

Si columna 9 = `Vigente` y columna 10 = `Cancelable con aceptación` y columna 11 = `En proceso`:

- ignorar.

##### Regla 4: caso no contemplado

Si cae en cualquier combinación no cubierta por las reglas anteriores:

- no actualizar,
- registrar en `unhandledRows`,
- mostrar en UI para copia/revisión manual.

#### Normalización propuesta

Para tolerar variantes como:

- `Cancelado`
- `CANCELADO`
- `Cancelable con aceptación`
- `Cancelable con aceptacion`
- `Cancelable con aceptaci�n`

usar una función que:

- haga `trim`,
- convierta a mayúsculas,
- elimine diacríticos cuando existan,
- elimine espacios redundantes,
- compare por patrones robustos (`CANCELADO`, `VIGENTE`, `NOCANCELABLE`, `CANCELABLE` + `ACEPTAC`, `ENPROCESO`).

### D. Sincronización incremental del resumen diario emitido

**Archivo nuevo:** `src/lib/invoice-issued-daily-summary.ts`

#### Objetivo

Crear el equivalente emitido del patrón que ya existe en recibidos, para mantener consistente `invoiceIssuedDailySummary` después de cambiar `satStatus`.

#### Alcance

- extraer del backfill actual la lógica de:
  - normalización,
  - determinación de dimensiones,
  - buckets,
  - aplicación delta `-1 / +1`,
- exponer una función tipo:

```ts
syncInvoiceIssuedDailySummaryRecordChange({
  db,
  previousRecord,
  nextRecord
})
```

#### Por qué

Si el layout actualiza cancelaciones y no ajustamos el resumen:

- la tabla `invoice` quedará bien,
- pero el fast path del dashboard fiscal puede seguir leyendo agregados viejos.

### E. Refactor del backfill para reutilizar la nueva lógica

**Archivo a modificar:** [`src/scripts/backfill-invoice-issued-daily-summary.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/scripts/backfill-invoice-issued-daily-summary.ts)

#### Qué cambiar

- reutilizar helpers del nuevo `src/lib/invoice-issued-daily-summary.ts`,
- evitar duplicar lógica entre:
  - backfill masivo,
  - importación incremental desde layout.

#### Beneficio

- una sola fuente de verdad para las reglas de resumen emitido,
- menos riesgo de divergencias futuras.

### F. Auditoría del proceso

**Archivo a usar:** [`src/lib/audit.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/audit.ts)

#### Estrategia

Crear una entrada de auditoría única por carga:

- `tableName`: `invoice_cancellation_layout`
- `action`: `IMPORT`
- `companyId`: empresa seleccionada en la pantalla
- `description`: resumen con conteos
- `newValues`: conteos y UUIDs afectados/no encontrados/no contemplados

#### Nota

No registrar un audit log por cada UUID para evitar ruido excesivo.

### G. Documentación funcional y operativa

**Archivo nuevo sugerido:** `docs/manuales/layout-cancelaciones-dashboard-fiscal.md`

#### Contenido

- propósito de la funcionalidad,
- formato del archivo,
- reglas de negocio aplicadas,
- categorías del resultado,
- límites de seguridad,
- comportamiento sobre UUID no encontrados,
- comportamiento sobre casos no contemplados,
- alcance real del proceso (actualización directa de `satStatus`).

## Flujo Propuesto End-to-End

1. Usuario entra a `/dashboard_fiscal/cancelaciones`.
2. Selecciona archivo `.txt`.
3. Frontend valida extensión básica y envía `FormData`.
4. Backend valida:
   - auth,
   - acceso a la empresa seleccionada,
   - tamaño,
   - MIME/extensión,
   - binario disfrazado.
5. Backend guarda temporalmente el archivo.
6. Backend lo procesa línea por línea.
7. Para cada línea:
   - normaliza columnas,
   - obtiene UUID,
   - busca `invoice` por UUID,
   - aplica regla de negocio,
   - actualiza `satStatus` si corresponde,
   - sincroniza delta del resumen diario emitido,
   - clasifica el resultado.
8. Backend crea audit log.
9. Backend elimina archivo temporal.
10. UI muestra resumen + detalle por categoría.
11. UI refresca la tabla de cancelaciones actual.

## Consideraciones Técnicas y de Seguridad

1. **Tamaño máximo:** usar el mismo tope de `/admin/users-bulk` (`5MB`) salvo que el usuario pida otro.
2. **Tipo de archivo:** aceptar solo `.txt` / `text/plain`.
3. **Contenido binario:** rechazar por bytes nulos.
4. **Temporal aislado:** usar `os.tmpdir()` + UUID aleatorio.
5. **Lectura segura:** `fs.createReadStream` + `readline`.
6. **Limpieza garantizada:** `finally` con `fs.unlinkSync`.
7. **Errores controlados:** no exponer stack traces al cliente.
8. **Consultas seguras:** Prisma / prepared statements.
9. **Normalización defensiva:** tolerar mayúsculas, acentos y texto mal decodificado.
10. **Idempotencia funcional:** si el UUID ya está en `CANCELADO`, no volver a “actualizar” semánticamente; reportarlo como sin cambio/ignorado.

## Archivos a Crear o Modificar

### Nuevos

- `src/app/api/dashboard_fiscal/cancelaciones/import-layout/route.ts`
- `src/lib/dashboard-fiscal-cancelaciones-layout.ts`
- `src/lib/invoice-issued-daily-summary.ts`
- `docs/manuales/layout-cancelaciones-dashboard-fiscal.md`

### Modificados

- [`src/app/dashboard_fiscal/cancelaciones/page.tsx`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard_fiscal/cancelaciones/page.tsx)
- [`src/scripts/backfill-invoice-issued-daily-summary.ts`](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/scripts/backfill-invoice-issued-daily-summary.ts)

## Verificación

### Verificación técnica

1. `npx eslint "src/app/dashboard_fiscal/cancelaciones/page.tsx" "src/app/api/dashboard_fiscal/cancelaciones/import-layout/route.ts" "src/lib/dashboard-fiscal-cancelaciones-layout.ts" "src/lib/invoice-issued-daily-summary.ts" "src/scripts/backfill-invoice-issued-daily-summary.ts"`

### Verificación funcional mínima

Probar con un layout de muestra que incluya:

1. UUID existente + columna 9 = `Cancelado`  
   Resultado: `invoice.satStatus` pasa a `CANCELADO`.

2. UUID existente + columna 9 = `Vigente` + columna 10 = `No Cancelable`  
   Resultado: ignorado.

3. UUID existente + columna 9 = `Vigente` + columna 10 = `Cancelable con aceptación` + columna 11 = `En proceso`  
   Resultado: ignorado.

4. UUID no existente  
   Resultado: `notFoundRows`.

5. UUID existente + combinación no contemplada  
   Resultado: `unhandledRows` visible en pantalla.

6. Archivo inválido:
   - extensión distinta,
   - binario renombrado a `.txt`,
   - archivo > 5MB  
   Resultado: rechazo seguro.

### Verificación de consistencia analítica

1. Confirmar que el UUID actualizado aparece en `/dashboard_fiscal/cancelaciones`.
2. Confirmar que los KPIs o listados fiscales que dependen de `satStatus` reflejan el cambio.
3. Confirmar que no se afectaron registros fuera de los UUID presentes en el layout.

## Riesgos y Mitigaciones

### Riesgo 1: Alcance global por UUID

El usuario pidió explícitamente actualizar cualquier UUID existente en base, no solo la empresa seleccionada.  
Eso incrementa el alcance del proceso respecto al contexto visual de la pantalla.

**Mitigación en implementación:**

- exigir auth + acceso a una empresa para habilitar el módulo,
- auditar cada carga,
- mostrar en resultado los UUID efectivamente afectados.

### Riesgo 2: Texto del layout con codificación inconsistente

Puede romper comparaciones exactas como `Cancelable con aceptación`.

**Mitigación:**

- normalización flexible por patrones,
- reporte de casos no contemplados en vez de asumir cancelación.

### Riesgo 3: Desalineación de resúmenes

Actualizar `invoice.satStatus` sin tocar `invoiceIssuedDailySummary` rompería el fast path del dashboard fiscal.

**Mitigación:**

- crear sincronización incremental emitida,
- reutilizar esa lógica también en el backfill.

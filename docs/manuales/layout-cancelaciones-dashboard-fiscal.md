# Manual de uso: Importación de layout de cancelaciones

## Objetivo

Permitir la carga directa de un layout `.txt` desde `/dashboard_fiscal/cancelaciones` para actualizar el campo `invoice.satStatus` a `CANCELADO` cuando el archivo indique que el CFDI ya fue cancelado.

## Ubicación

- Pantalla: `src/app/dashboard_fiscal/cancelaciones/page.tsx`
- Endpoint: `src/app/api/dashboard_fiscal/cancelaciones/import-layout/route.ts`

## Formato esperado del archivo

- Tipo de archivo: `.txt`
- MIME esperado: `text/plain`
- Separador por columna: `|`
- Tamaño máximo: `5MB`
- El layout puede venir con `|` inicial, por lo que el parser normaliza la primera columna vacía.

## Reglas aplicadas

### Regla 1: actualizar cancelación

Si la columna 9 contiene `Cancelado`:

- se toma el UUID de la columna 8,
- se busca en `invoice`,
- si existe y no está ya cancelado, se actualiza `satStatus = CANCELADO`.

### Regla 2: ignorar vigente no cancelable

Si la columna 9 contiene `Vigente` y la columna 10 contiene `No Cancelable`:

- el registro se ignora,
- no se actualiza la base.

### Regla 3: ignorar aceptación en proceso

Si la columna 9 contiene `Vigente`, la columna 10 contiene `Cancelable con aceptación` y la columna 11 contiene `En proceso`:

- el registro se ignora,
- no se actualiza la base.

### Regla 4: caso no contemplado

Si el registro no cae en las reglas anteriores:

- no se actualiza,
- se muestra en pantalla para revisión manual,
- puede copiarse directamente desde la UI.

## Alcance funcional

- La búsqueda se hace por cualquier UUID existente en la base.
- No se limita a la empresa seleccionada visualmente en la pantalla.
- La empresa seleccionada sí se usa para validar acceso al módulo y registrar auditoría.
- La actualización modifica `invoice.satStatus`, no `invoice.status`.

## Resultado mostrado en pantalla

La UI devuelve y presenta:

- `Procesados`
- `Actualizados`
- `Ignorados`
- `No encontrados`
- `Inválidos`
- `No contemplados`

Además se muestran tablas por categoría con:

- número de línea,
- UUID,
- columnas 9, 10 y 11,
- motivo del resultado.

Los registros no contemplados también se presentan en un bloque copiable para revisión manual.

## Seguridad aplicada

La importación replica el endurecimiento usado en `/admin/users-bulk`:

- validación estricta de tamaño,
- validación de extensión y MIME,
- detección de binarios disfrazados por bytes nulos,
- almacenamiento temporal con nombre aleatorio en `os.tmpdir()`,
- lectura por stream con `readline`,
- eliminación del archivo temporal en `finally`,
- errores genéricos hacia frontend y detalle solo en logs internos.

## Consistencia analítica

Después de actualizar `satStatus`, el sistema sincroniza también `invoiceIssuedDailySummary` para no dejar desalineados:

- dashboard fiscal,
- listados que usan agregados emitidos,
- métricas impactadas por cancelaciones.

Si el CFDI cancelado es de tipo `PAGO` o `EGRESO`, también se recalculan los CFDI relacionados que cambian sus montos cobrados o notas de crédito aplicadas.

## Auditoría

Cada importación registra una sola entrada de auditoría en:

- `tableName = invoice_cancellation_layout`
- `action = IMPORT`

La auditoría guarda:

- archivo procesado,
- tamaño,
- conteos del resultado,
- muestras acotadas por categoría.

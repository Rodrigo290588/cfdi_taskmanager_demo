# Resumen Global del Rango en Fiscal Control Spec

## Why
El resumen actual de conciliación representa sólo los UUID de la página visible, por lo que puede diferir de las tarjetas que agregan todo el rango de fechas seleccionado. Se requiere un resumen global exacto por UUID para que el usuario interprete los resultados del periodo sin depender de la paginación.

## What Changes
- Calcular el resumen de conciliación para todo el rango de fechas y filtros activos, en lugar de sólo para la página actual.
- Consolidar cada UUID normalizado entre metadatos SAT, CFDI emitidos, CFDI recibidos y nómina antes de contar orígenes y estados de conciliación.
- Reemplazar la tarjeta `Resumen de conciliación de la página` por `Resumen de conciliación del rango`.
- Mantener la tabla, cursores y paginación actuales sin cargar ni devolver todas las filas del rango.
- Ejecutar el agregado en PostgreSQL mediante consultas agrupadas y proyecciones mínimas, sin contenido XML, blobs ni ciphertext.

## Impact
- Affected specs: conciliación CFDI multi-origen, filtros de Fiscal Control, métricas agregadas y rendimiento.
- Affected code: servicio `fiscal-control-conciliation-service`, API `api/mass-downloads/fiscal-control`, interfaz `mass-downloads/fiscal-control` y pruebas de conciliación.

## Diseño de implementación
- El servicio expondrá un contrato `FiscalControlGlobalReconciliationSummary` con `scope: 'RANGE'`, conteos por origen (`metadata`, `emitidos`, `recibidos`, `nomina`) y conteos por estado (`totalRows`, `reconciled`, `metadataWithoutXml`, `xmlWithoutMetadata`, `xmlUnavailable`, `conflicts`).
- La consulta reutilizará `createSourceReadContext` y los cuatro constructores `build*Where`, siempre con cursor nulo. Así conserva filtros y aislamiento, pero excluye condiciones de paginación.
- PostgreSQL recibirá proyecciones mínimas por origen: UUID normalizado, indicador de metadato, disponibilidad de XML, origen e importes necesarios para detectar conflicto. Un `UNION ALL` seguido de `GROUP BY uuid_normalized` consolidará cada UUID antes de clasificarlo.
- La agregación final contará filas y orígenes mediante expresiones `FILTER` o `CASE`, devolviendo una única fila de conteos. No seleccionará blobs XML, ciphertext ni filas del detalle.
- La respuesta de detalle conservará la misma tabla y cursor; únicamente sustituirá los campos de resumen derivados de la página por este contrato global.

## ADDED Requirements
### Requirement: Resumen global de conciliación por rango
El sistema SHALL calcular el resumen de conciliación sobre todos los UUID normalizados que cumplan el rango de fechas requerido y los filtros activos de empresa, organización, RFC, tipo, estado SAT, columnas y origen.

#### Scenario: Consulta global con múltiples páginas
- **WHEN** el usuario consulta un rango cuyo resultado supera una página de la tabla.
- **THEN** el resumen debe representar todos los UUID del rango y no cambiar al navegar entre páginas.

#### Scenario: UUID presente en varios orígenes
- **WHEN** el mismo UUID aparece en metadatos, emitidos, recibidos o nómina.
- **THEN** el resumen debe consolidarlo antes de clasificarlo y contabilizar cada origen presente una sola vez para ese UUID.

#### Scenario: Estado de conciliación global
- **WHEN** un UUID consolidado tiene metadato sin XML, XML sin metadato, XML no disponible o conflicto.
- **THEN** el contador global correspondiente debe incrementarse una vez para ese UUID.

### Requirement: Agregado seguro y escalable
El sistema SHALL obtener el resumen global mediante agregaciones en base de datos, sin materializar el conjunto completo de filas ni exponer contenido XML, blobs, ciphertext o rutas internas.

#### Scenario: Rango con millones de registros
- **WHEN** el rango seleccionado contiene millones de documentos históricos.
- **THEN** la API debe devolver sólo los conteos agregados y la página solicitada, conservando el uso de cursor para el detalle.

#### Scenario: Aislamiento y filtros
- **WHEN** el usuario aplica filtros o no tiene acceso a una empresa u organización.
- **THEN** el resumen global debe aplicar la misma semántica de acceso y filtros que la consulta detallada.

## MODIFIED Requirements
### Requirement: Tarjeta de resumen de conciliación
La interfaz SHALL mostrar la tarjeta `Resumen de conciliación del rango` con los conteos globales de emitidos, recibidos, nómina, pendientes y conflictos para todo el rango de fechas seleccionado. La tarjeta no debe describirse como resumen de la página actual.

#### Scenario: Navegación paginada
- **WHEN** el usuario avanza o retrocede entre páginas de resultados.
- **THEN** los valores de la tarjeta deben permanecer iguales mientras no cambien los filtros.

## REMOVED Requirements
### Requirement: Resumen limitado a la página actual
**Reason**: el resumen de la página no permite comparar de forma consistente los resultados contra los agregados globales por tipo.
**Migration**: la API sustituirá los conteos derivados de filas paginadas por conteos globales consolidados por UUID.

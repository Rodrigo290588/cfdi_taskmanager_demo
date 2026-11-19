# Conciliar CFDI Multi-Origen en Control Fiscal — Especificación

## Por qué

`/mass-downloads/fiscal-control` actualmente utiliza `SatMetadata` como conjunto principal y determina la existencia de XML únicamente contra `Invoice`. Esto deja fuera los CFDI recibidos almacenados en `ProviderUploadedCfdi` y no permite conciliar de forma confiable los orígenes emitido, recibido y nómina.

Se requiere una lectura unificada y auditable que permita comparar metadatos SAT contra XML persistidos, identificar faltantes y duplicados, y presentar resultados consistentes para los tres orígenes sin descifrar ni parsear XML durante cada consulta.

## Qué cambia

- Incorporar una capa de consulta unificada para los orígenes `EMITIDO`, `RECIBIDO` y `NOMINA`.
- Leer emitidos desde `Invoice`, recibidos desde `ProviderUploadedCfdi` y nómina desde `Invoice`/`PayrollReceipt` según la relación disponible.
- Asociar cada registro con `SatMetadata` mediante UUID normalizado, conservando el origen real y el estado de disponibilidad del XML.
- Mantener el contenido XML cifrado; las listas y métricas sólo usarán campos relacionales, proyecciones de complementos y la existencia del blob.
- Aplicar filtros de empresa, organización, RFC, año/mes, tipo CFDI, estado SAT y filtros de columnas de manera consistente entre todas las fuentes.
- Mostrar conciliación por origen: metadatos, XML disponibles, faltantes, XML sin metadato, UUID duplicados y diferencias monetarias.
- Mantener paginación, exportación, permisos multi-tenant y precisión decimal sin exponer identificadores internos innecesarios.
- Agregar pruebas de contrato, aislamiento, conciliación y regresión para emitidos, recibidos y nómina.
- Diseñar la solución para al menos 7 millones de registros históricos más 2 millones de registros por cada año nuevo sin degradar proporcionalmente la consulta interactiva.

## Impacto

- **Capacidades afectadas**: Control Fiscal de descargas masivas, conciliación SAT/XML, exportación de reporte, consulta de CFDI recibidos y métricas de nómina.
- **Archivos/sistemas afectados**:
  - `src/app/mass-downloads/fiscal-control/page.tsx`
  - `src/app/api/mass-downloads/fiscal-control/route.ts`
  - `src/app/api/mass-downloads/fiscal-control/export/route.ts`
  - Nuevos helpers de consulta/normalización bajo `src/lib/`
  - Modelos existentes `Invoice`, `ProviderUploadedCfdi`, `SatMetadata`, `PayrollReceipt` y sus blobs/proyecciones
  - Pruebas automatizadas de `mass-downloads` y conciliación.
- **Migraciones**: Preferir una capa de lectura y nuevos índices antes de agregar tablas. Una migración sólo será necesaria si las pruebas demuestran que falta una clave de asociación o un índice requerido.
- **Compatibilidad**: El contrato actual seguirá funcionando para consumidores existentes; los campos nuevos de origen y conciliación serán aditivos.
- **Escala objetivo**: 7 millones de registros históricos iniciales y crecimiento de 2 millones por año, distribuido entre las fuentes emitidas, recibidas, nómina y metadatos.

## Requisitos añadidos

### Mapeo de fuentes aprobado

| Fuente | Alcance obligatorio | Llave de conciliación | Origen normalizado | Indicador de XML |
| --- | --- | --- | --- | --- |
| `SatMetadata` | RFC de la empresa y periodo | `uuid` | No aplica; representa el metadato SAT | No carga XML |
| `Invoice` | `issuerFiscalEntityId`, RFC emisor y periodo | `uuid` | `EMITIDO` | `InvoiceBlob` o contenido legado sin leerlo |
| `ProviderUploadedCfdi` | `organizationId`, `receiverCompanyId` y periodo | `uuid` | `RECIBIDO` | `ProviderUploadedCfdiBlob` |
| `PayrollReceipt` + `Invoice`/`SatInvoice` | `organizationId`, `companyId`, fecha de emisión y fecha de pago opcional | `uuid` | `NOMINA` | Blob de `Invoice` o contenido legado asociado |

La implementación SHALL seleccionar únicamente columnas de proyección y existencia de blob. El contenido XML, ciphertext, IV y auth tag no forman parte de la consulta de conciliación.

### Requisito: Consulta multi-origen

El sistema SHALL construir un conjunto lógico normalizado de CFDI con los campos `uuid`, RFC emisor, RFC receptor, fecha de emisión, tipo CFDI, total, estado SAT, origen, disponibilidad XML, identificador de almacenamiento y datos de conciliación.

#### Escenario: CFDI emitido

- **WHEN** existe un registro aplicable en `Invoice` cuyo emisor o entidad fiscal corresponde a la empresa seleccionada.
- **THEN** el registro aparece con origen `EMITIDO`, `hasXml=true` sólo si existe su blob/XML persistido, y conserva sus datos de tipo, estado, fecha y total.

#### Escenario: CFDI recibido

- **WHEN** existe un registro aplicable en `ProviderUploadedCfdi` cuyo receptor corresponde a la empresa seleccionada.
- **THEN** el registro aparece con origen `RECIBIDO`, `hasXml=true` sólo si existe `ProviderUploadedCfdiBlob`, y no depende de que exista una fila en `Invoice`.

#### Escenario: CFDI de nómina

- **WHEN** un CFDI tiene tipo `NOMINA` y una proyección `PayrollReceipt` relacionada con `Invoice` o `SatInvoice`.
- **THEN** aparece con origen `NOMINA`, conserva el UUID del comprobante y expone únicamente los campos de nómina autorizados para la conciliación.

### Requisito: Asociación por UUID

El sistema SHALL normalizar UUID con recorte y mayúsculas para asociar `SatMetadata` con cada fuente XML. La asociación SHALL ser independiente del origen y SHALL distinguir entre:

- Metadato con XML asociado.
- Metadato sin XML asociado.
- XML persistido sin metadato SAT.
- Registro de origen sin XML disponible.
- UUID duplicado o conflicto entre fuentes.

#### Escenario: UUID coincidente

- **WHEN** un UUID de `SatMetadata` coincide con un UUID de una fuente XML dentro del mismo tenant.
- **THEN** el registro se marca como conciliado y conserva ambos estados de origen.

#### Escenario: UUID no coincidente

- **WHEN** un UUID sólo existe en una de las fuentes.
- **THEN** el registro se incluye en la categoría correspondiente de faltante o sobrante y la respuesta no lo descarta silenciosamente.

### Requisito: Filtros consistentes

El sistema SHALL aplicar empresa, organización, RFC emisor/receptor, año, mes, tipo CFDI y estado SAT a todas las fuentes compatibles. La fecha principal de conciliación SHALL ser `fechaEmision`; para nómina se SHALL conservar además `fechaPago` como campo específico, sin alterar el significado del filtro principal.

#### Escenario: Consulta por RFC y periodo

- **WHEN** el usuario selecciona RFC `DMC750410C41`, año 2024 y diciembre.
- **THEN** los metadatos, emitidos, recibidos y nómina se consultan con el mismo rango inclusivo de fechas y la respuesta separa los conteos por origen.

#### Escenario: Tipo CFDI

- **WHEN** el usuario selecciona `NOMINA`, `INGRESO`, `EGRESO`, `PAGO` o `TRASLADO`.
- **THEN** cada fuente aplica su representación equivalente (`CfdiType`, `cfdiType` o `efectoComprobante`) y los resultados mantienen el valor normalizado.

### Requisito: Conciliación financiera y de conteos

El sistema SHALL calcular sin redondeo prematuro:

- Conteo de metadatos por origen.
- Conteo de XML disponibles por origen.
- Conteo conciliado, faltante y sobrante.
- Total de metadatos y total de XML cuando ambos valores existan.
- Diferencia absoluta y porcentaje de diferencia, con división segura cuando el denominador sea cero.
- Conteo de UUID duplicados y conflictos de clasificación.

#### Escenario: Totales con precisión

- **WHEN** existen importes decimales en metadatos y XML.
- **THEN** la API conserva precisión decimal suficiente para conciliación contable y la interfaz sólo formatea al presentar, sin convertir silenciosamente a enteros.

### Requisito: Seguridad y aislamiento

El sistema SHALL conservar la autorización actual por sesión, permiso fiscal, organización y empresa. Ninguna consulta SHALL permitir combinar metadatos de una organización con XML de otra aunque compartan UUID.

El sistema SHALL no devolver contenido XML, ciphertext, IV, auth tag, tokens, rutas físicas ni credenciales en listados, métricas, exportaciones o logs.

### Requisito: Rendimiento y paginación

El sistema SHALL estar preparado para 7 millones de registros históricos más 2 millones por año adicional. La lectura interactiva SHALL paginar en servidor y SHALL evitar cargar todos los blobs, descifrar XML, ejecutar `findMany` sin límite o construir en memoria la unión completa de las fuentes.

La estrategia SHALL cumplir:

- Consultas con predicados de organización/empresa, RFC, fecha y UUID antes de unir fuentes.
- Índices compuestos alineados con los filtros y el orden estable de la tabla.
- Paginación por cursor/keyset para navegación profunda; `OFFSET` sólo se permitirá en páginas pequeñas y justificadas.
- Selección explícita de columnas; nunca incluir `xmlContent`, ciphertext, IV, auth tag o blobs en listados.
- Conteos y totales mediante consultas agregadas o vistas/materializaciones incrementales, no recorriendo todas las filas para cada render.
- Conciliación por UUID en lotes acotados o mediante una vista de lectura indexada, evitando un `OR` masivo que fuerce un secuencial completo.
- Separación entre consulta de filas, métricas agregadas y exportación.
- Límite configurable de filas por página, con un máximo recomendado de 100 y un máximo absoluto de 200.

La exportación SHALL reutilizar los mismos filtros y reglas de conciliación que la consulta paginada. Para resultados grandes SHALL ejecutarse como trabajo asíncrono por lotes, con cursor, progreso, expiración y almacenamiento protegido; nunca deberá mantener millones de filas en memoria del proceso web.

#### Escenario: Consulta interactiva a escala histórica

- **WHEN** el usuario consulta un periodo sobre una base con al menos 7 millones de registros históricos.
- **THEN** la API devuelve sólo la página solicitada y sus agregados, sin transferir ni materializar el total de registros en el servidor web.

#### Escenario: Navegación profunda

- **WHEN** el usuario avanza a una página posterior en una consulta grande.
- **THEN** la API usa un cursor estable basado en fecha, UUID y origen, y no aumenta linealmente el tiempo por la cantidad de páginas omitidas.

#### Escenario: Crecimiento anual

- **WHEN** se agregan 2 millones de registros de un nuevo año.
- **THEN** los filtros por periodo utilizan particionado o índices por fecha cuando estén disponibles, y las métricas agregadas se actualizan incrementalmente o mediante refresh controlado sin bloquear las consultas de usuarios.

#### Escenario: Frontend con millones de registros

- **WHEN** la consulta contiene más registros que el límite de la página.
- **THEN** el frontend sólo renderiza las filas recibidas, conserva filtros y cursor, muestra conteos agregados y no intenta almacenar el dataset completo en estado, DOM o memoria del navegador.

### Requisito: Presupuesto de rendimiento y observabilidad

El sistema SHALL definir y medir estos presupuestos en un entorno representativo:

- P95 de la primera página y resumen agregado: menor a 900 ms sin incluir una exportación.
- P95 de una página posterior mediante cursor: menor a 900 ms.
- P95 de una consulta de un único mes con filtros de empresa/RFC: menor a 500 ms.
- Memoria del proceso web estable y sin crecimiento proporcional al total histórico durante consultas repetidas.
- Las consultas críticas SHALL validarse con `EXPLAIN (ANALYZE, BUFFERS)` y no deberán presentar secuencial completo sobre tablas históricas cuando exista un filtro indexable.

El sistema SHALL registrar métricas saneadas de duración, filas examinadas, filas devueltas, fuente consultada, uso de cursor y resultado de exportación, sin registrar XML ni datos fiscales innecesarios.

### Requisito: Compatibilidad de respuesta

El endpoint actual SHALL conservar sus campos existentes (`rows`, `totals`, paginación y filtros dinámicos). SHALL agregar de forma aditiva:

- `source` o `origin`.
- `xmlStorage`/indicador de blob sin datos sensibles.
- `reconciliationStatus`.
- `reconciliationSummary` por origen.
- `sourceCounts` y diferencias conciliadas.

La interfaz SHALL mostrar el origen con descripciones legibles: `Emitido`, `Recibido` y `Nómina`, sin mostrar IDs internos de base de datos.

## Requisitos modificados

### Requisito: Control Fiscal actual

La pantalla ya no SHALL interpretar `Invoice` como única fuente de XML. Deberá usar el servicio unificado para filas, totales, exportación, indicadores y detalle. Los filtros actuales y la paginación SHALL conservar su comportamiento visual y funcional.

## Requisitos eliminados

### Requisito: Cruce exclusivo contra `Invoice`

**Razón**: Excluye los CFDI recibidos almacenados en `ProviderUploadedCfdi` y produce falsos faltantes de XML.

**Migración**: Sustituirlo por el cruce multi-origen por UUID, manteniendo `Invoice` como una de las fuentes y no como la fuente única.

## Decisiones aprobadas

- Un mismo UUID presente en `Invoice` y `ProviderUploadedCfdi` SHALL mostrarse como una fila consolidada que conserva ambos orígenes. Sólo se marcará como `CONFLICTO` cuando los campos conciliables difieran.
- El filtro principal de nómina SHALL usar `fechaEmision`, y la interfaz/API SHALL ofrecer adicionalmente un rango opcional de `fechaPago`.
- Las exportaciones con más de 10,000 filas SHALL ejecutarse de forma asíncrona por lotes.

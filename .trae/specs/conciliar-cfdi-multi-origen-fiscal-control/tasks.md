# Tareas

- [x] Tarea 1: Definir el contrato normalizado de CFDI multi-origen.
  - [x] 1.1 Crear tipos compartidos para `origin`, `reconciliationStatus`, fila normalizada, conteos y resumen por origen.
  - [x] 1.2 Documentar el mapeo de campos entre `Invoice`, `ProviderUploadedCfdi`, `SatMetadata` y `PayrollReceipt`.
  - [x] 1.3 Resolver las decisiones pendientes sobre UUID duplicado y filtro opcional de `fechaPago` antes de implementar.

- [x] Tarea 2: Implementar el servicio de lectura multi-origen.
  - [x] 2.1 Crear un helper de filtros que traduzca RFC, fechas, tipo, estado, empresa y filtros de columnas a cada modelo.
  - [x] 2.2 Consultar `Invoice` para emitidos y CFDI de nómina con blob/proyecciones sin leer contenido XML.
  - [x] 2.3 Consultar `ProviderUploadedCfdi` y su existencia de blob para recibidos, restringiendo por organización y empresa receptora.
  - [x] 2.4 Normalizar UUID, fechas, tipos, estados y totales usando precisión decimal.
  - [x] 2.5 Resolver la asociación con `SatMetadata` y clasificar conciliado, faltante, sobrante, duplicado y conflicto.
  - [x] 2.6 Aplicar paginación estable y orden determinista después de la normalización, evitando `OFFSET` excesivo si la escala real lo requiere.
  - [x] 2.7 Diseñar la consulta para no unir conjuntos completos: filtrar y limitar cada fuente antes del cruce, o consumir una vista de lectura indexada/materializada.
  - [x] 2.8 Implementar cursores opacos y firmados o validados en servidor con las claves de orden `fechaEmision`, `uuid` y `origin`.

- [x] Tarea 3: Extender el endpoint de Fiscal Control.
  - [x] 3.1 Sustituir el conteo y cruce exclusivo contra `Invoice` por el servicio multi-origen.
  - [x] 3.2 Mantener autenticación, permiso fiscal, aislamiento de organización/empresa y validación de parámetros.
  - [x] 3.3 Agregar `sourceCounts`, `reconciliationSummary`, `source` y `reconciliationStatus` sin romper el contrato existente.
  - [x] 3.4 Agregar pruebas de RFC/periodo, cada origen, UUID coincidente/no coincidente, duplicados y empresa sin acceso.
  - [x] 3.5 Separar la respuesta de filas paginadas de los agregados por origen para evitar repetir conteos costosos por cada fila.
  - [x] 3.6 Definir límites estrictos de `pageSize` (por defecto 50, máximo 100 o 200 según medición) y rechazar tamaños arbitrarios.

- [x] Tarea 4: Alinear la exportación.
  - [x] 4.1 Reutilizar el mismo servicio y filtros del endpoint principal.
  - [x] 4.2 Exportar origen y estado de conciliación con etiquetas de negocio.
  - [x] 4.3 Excluir blobs, ciphertext, rutas internas e identificadores técnicos no destinados al usuario.
  - [x] 4.4 Validar límites de tamaño, precisión decimal y consistencia entre el total exportado y el total mostrado.
  - [x] 4.5 Implementar exportación asíncrona por lotes con cursor para resultados grandes, evitando `Promise.all` masivo y acumulación completa en memoria.
  - [x] 4.6 Definir retención, expiración, autorización de descarga y estado de progreso del archivo exportado.

- [x] Tarea 5: Actualizar la interfaz `/mass-downloads/fiscal-control`.
  - [x] 5.1 Agregar leyenda/filtro visible para `Emitido`, `Recibido` y `Nómina`.
  - [x] 5.2 Mostrar origen, estado de conciliación y disponibilidad XML en el detalle de registros.
  - [x] 5.3 Mostrar tarjetas separadas por origen y un resumen global de faltantes/sobrantes.
  - [x] 5.4 Mantener búsqueda por columnas, paginación, estado vacío y actualización de filtros.
  - [x] 5.5 Mostrar descripciones de negocio en lugar de UUIDs internos; conservar UUID CFDI cuando sea necesario para auditoría.
  - [x] 5.6 Mantener sólo la página actual en estado y presentar navegación por cursor, total aproximado/exacto según disponibilidad y resumen agregado separado.
  - [x] 5.7 Evitar gráficas alimentadas por filas detalladas; consumir series mensuales/agregadas desde un endpoint específico.

- [x] Tarea 6: Agregar índices o ajustes de esquema sólo con evidencia.
  - [x] 6.1 Medir `EXPLAIN ANALYZE` de las consultas multi-origen por empresa/RFC/fecha/UUID.
  - [x] 6.2 Crear migración únicamente para índices faltantes en `ProviderUploadedCfdi`, `Invoice` o `SatMetadata`.
  - [ ] 6.3 Validar que no se modifiquen ni borren datos existentes y que el almacenamiento cifrado permanezca intacto.
  - [ ] 6.4 Evaluar particionado por fecha y/o tenant para tablas históricas de mayor volumen, documentando una estrategia de migración y pruning.
  - [ ] 6.5 Evaluar índices compuestos por tenant/empresa/fecha, tenant/empresa/UUID y filtros de origen; evitar índices redundantes de alto costo de escritura.
  - [ ] 6.6 Evaluar una vista de conciliación incremental o tabla de proyección con refresh por lote para conteos y diferencias.

- [x] Tarea 7: Validación de escala, rendimiento y observabilidad.
  - [x] 7.1 Preparar dataset representativo con 7 millones históricos y una carga adicional de 2 millones para un año nuevo, distribuido por origen y tenant.
  - [x] 7.2 Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` sobre primera página, página profunda, conteos, resumen mensual y cruce por UUID.
  - [x] 7.3 Ejecutar pruebas de carga concurrente y comprobar P95/P99, memoria del proceso, conexiones y ausencia de secuenciales completos inesperados.
  - [x] 7.4 Validar que el crecimiento anual no invalide los índices, cursores, agregados ni tiempos objetivo.
  - [x] 7.5 Validar métricas saneadas de duración, filas examinadas, filas devueltas y exportación.

  Evidencia: base aislada `platfi_intelligence_perf` con 9,000,000 registros sintéticos; build de producción correcto; k6 con 100 VUs y 120 segundos sostenidos: P95 561.59 ms, P99 685.44 ms y 0% de errores.

- [x] Tarea 8: Validación funcional, seguridad y regresión.
  - [x] 8.1 Crear fixtures o datos controlados con los tres orígenes y casos de UUID coincidente, faltante, sobrante y duplicado.
  - [x] 8.2 Probar aislamiento multi-tenant y ausencia de contenido XML/ciphertext en respuestas y exportaciones.
  - [x] 8.3 Ejecutar pruebas unitarias del normalizador y pruebas de integración del endpoint/exportación.
  - [x] 8.4 Ejecutar lint, typecheck y pruebas enfocadas de Fiscal Control.
  - [x] 8.5 Validar manualmente diciembre 2024 para `DMC750410C41`, comparando metadatos contra emitidos, recibidos y nómina.
  - [x] 8.6 Actualizar `CHANGELOG.md` después de aprobar la implementación.

  Evidencia: fixtures de conciliación y almacenamiento cifrado cubren coincidencias, faltantes, sobrantes y conflictos; CSV de 1,189 filas sin contenido XML/ciphertext; en diciembre de 2024, el caso `DMC750410C41` consolidó 49 CFDI recibidos dentro de la primera página. La regresión final completó 55 pruebas focalizadas, `npx tsc --noEmit` y ESLint sin errores.

# Dependencias

- La Tarea 2 depende de la Tarea 1.
- La Tarea 3 depende de la Tarea 2.
- La Tarea 4 depende de la Tarea 2 y puede ejecutarse en paralelo con la Tarea 3.
- La Tarea 5 depende de la Tarea 3 y puede ejecutarse en paralelo con la Tarea 4.
- La Tarea 6 depende de la medición de la Tarea 2 y puede ejecutarse en paralelo con las Tareas 3 a 5.
- La Tarea 7 depende de las Tareas 2 a 6 y debe completarse antes de aprobar la solución para producción.
- La Tarea 8 depende de las Tareas 3, 4, 5 y 7.

# Tareas

- [x] Tarea 1: Definir el contrato y la consulta del resumen global.
  - [x] 1.1 Definir los conteos globales por origen y estado de conciliación, consolidados por UUID normalizado.
  - [x] 1.2 Reutilizar la semántica actual de filtros, organización, empresa y permisos para las cuatro fuentes.
  - [x] 1.3 Diseñar una agregación de PostgreSQL que una proyecciones mínimas de metadatos, emitidos, recibidos y nómina sin leer XML ni materializar filas detalladas.

- [x] Tarea 2: Implementar el agregado global en el servidor.
  - [x] 2.1 Extender el servicio de conciliación con una operación de resumen global independiente de la página y el cursor.
  - [x] 2.2 Clasificar globalmente los UUID como conciliados, metadato sin XML, XML sin metadato, XML no disponible y conflicto.
  - [x] 2.3 Actualizar la respuesta de la API para devolver el resumen global con filtros válidos.
  - [x] 2.4 Conservar la paginación y el detalle actual sin modificar la respuesta de filas.

- [x] Tarea 3: Actualizar la interfaz de Fiscal Control.
  - [x] 3.1 Renombrar la tarjeta a `Resumen de conciliación del rango`.
  - [x] 3.2 Consumir los conteos globales sin alterarlos al cambiar de página.
  - [x] 3.3 Conservar el estado vacío hasta seleccionar un rango de fechas válido.

- [x] Tarea 4: Validar exactitud, seguridad y rendimiento.
  - [x] 4.1 Agregar fixtures que cubran UUID compartidos entre fuentes, faltantes, XML no disponible y conflictos.
  - [x] 4.2 Probar filtros de fecha, RFC, origen y tipo, además de incluir organización y empresa como parámetros obligatorios de cada fuente.
  - [x] 4.3 Comparar los conteos globales con resultados controlados de todas las páginas.
  - [x] 4.4 Ejecutar la prueba de carga autenticada con 100 VUs contra el servidor de producción local.
  - [x] 4.5 Ejecutar TypeScript, ESLint y las pruebas focalizadas de Fiscal Control.

  Evidencia: `EXPLAIN (ANALYZE, BUFFERS)` diario ejecuta en 11.7 ms en PostgreSQL; la llamada extremo a extremo toma 222 ms para 2,129 UUID consolidados. La ejecución final de k6 contra `next start` completó 23,908 solicitudes en 2m25s, con 0% de errores, p90 de 175.29 ms y p95 de 195.58 ms.

- [x] Tarea 5: Optimizar el resumen global para rangos anuales de gran volumen.
  - [x] 5.1 Analizar el plan anual para identificar el costo dominante de consolidación por UUID.
  - [x] 5.2 Desactivar JIT sólo dentro de la transacción del agregado global, preservando exactitud, aislamiento y datos frescos sin aumentar memoria por sesión.
  - [x] 5.3 Repetir la medición anual con la función de aplicación.

  Evidencia: el rango anual de 779,214 UUID pasó de 7.64 s a 3.14 s. Se descartó una vista materializada porque requeriría una política adicional de refresco y podría mostrar una conciliación desactualizada después de importaciones.

- [x] Tarea 6: Corregir la paginación del detalle multi-origen para UUID con fechas distintas.
  - [x] 6.1 Canonicalizar a minúsculas el UUID del cursor para que la comparación keyset coincida con PostgreSQL.
  - [x] 6.2 Reemplazar el cursor único por una paginación consolidada que no descarte candidatos de fuentes con fechas distintas.
  - [x] 6.3 Agregar una prueba de regresión que recorra todas las páginas y coincida con el resumen global en ese escenario.

  Evidencia: el recorrido de 22 páginas recuperó 2,129 UUID únicos y coincidió exactamente con los conteos globales por origen y estado.

# Dependencias

- La Tarea 2 depende de la Tarea 1.
- La Tarea 3 depende de la Tarea 2.
- La Tarea 4 depende de las Tareas 2 y 3.
- La Tarea 5 depende de la evidencia de la Tarea 4.
- La Tarea 4.3 depende de la Tarea 6.

# Checklist de Pruebas: Monitor de Importación (`/dashboard/import-monitor`)

Este checklist debe ser completado por el usuario de pruebas. Marca con una 'X' dentro de los corchetes `[ ]` cuando hayas validado exitosamente cada punto.

## 1. Interfaz Principal y Datos en Tiempo Real
- [ ] La pantalla de "Monitor de integridad y timbrado de CFDI's" carga correctamente sin mostrar errores.
- [ ] La tarjeta de "CFDI Recibidos" muestra un número total visible.
- [ ] La tarjeta de "Velocidad de Proceso" muestra la cantidad de documentos procesados por segundo (`docs/s`).
- [ ] La tarjeta de "Corridas Activas" muestra un número.
- [ ] Si el número de Corridas Activas es mayor a 0, aparece un letrero verde parpadeante que dice "EN VIVO" en la parte superior.
- [ ] El botón de "Actualizar" recarga los números de la pantalla al hacerle clic.
- [ ] La barra de "Progreso General" se dibuja correctamente mostrando el porcentaje de avance (ej. 85.5%).
- [ ] Las tarjetas de "Procesados", "CFDI Emitidos", "CFDI Recibidos" y "Errores" muestran números coherentes.

## 2. Conciliación de Archivos (Control de Directorio)
- [ ] La sección "Cifras de Control de Directorio" está visible.
- [ ] El recuadro "XML en Directorio" muestra el total de archivos físicos encontrados.
- [ ] El recuadro "Registrados en Monitor" muestra la cantidad aceptada.
- [ ] El recuadro "Procesados" muestra la cantidad finalizada.
- [ ] El texto de "Brecha directorio - monitor" aparece en color **verde** si el número es 0 (cero).
- [ ] El texto de "Brecha directorio - monitor" aparece en color **naranja/ámbar** si el número es mayor a 0 (diferencia encontrada).
- [ ] El texto de "Brecha monitor - procesamiento" cambia de color (verde/naranja) dependiendo si hay diferencias.

## 3. Buscador y Filtros de Corridas
- [ ] Al escribir en la barra de búsqueda (por ejemplo, el ID de un lote) y dar Enter (o salir del campo), la tabla de abajo se actualiza mostrando solo coincidencias.
- [ ] El filtro de "Todos los estados" permite seleccionar un estatus específico (ej. "Completada" o "Fallida") y la tabla se actualiza.
- [ ] El filtro de "Todos los orígenes" funciona correctamente al seleccionar una opción (ej. "Portal de proveedores").
- [ ] Los botones rápidos de fecha ("Hoy", "Últimos 7 días", "Últimos 30 días", "Este mes") funcionan y cambian los resultados de la tabla.
- [ ] El botón "Limpiar filtros" borra cualquier búsqueda o fecha seleccionada y vuelve a mostrar toda la lista inicial.
- [ ] La tabla de corridas muestra correctamente las columnas: Run, Estatus, Inicio, Fin, Duración, Progreso y Documentos.
- [ ] Los botones de paginación ("Anterior" / "Siguiente") en la parte inferior de la tabla funcionan correctamente.

## 4. Detalle de Documentos (Ventana Grande / Drilldown)
- [ ] Al hacer clic en el botón "Ver Documentos" de cualquier corrida, se abre una ventana grande que cubre toda la pantalla.
- [ ] La ventana grande muestra correctamente los detalles del lote en la parte superior (Run ID, Estatus, Totales, Inicio, Fin).
- [ ] La tabla inferior dentro de la ventana muestra la lista de facturas (UUID, Clasificación, Estatus, Error).
- [ ] Al hacer clic en el botón "Solo errores", la tabla cambia y muestra únicamente las facturas que tuvieron fallas.
- [ ] El filtro de "Todos los estados del documento" permite filtrar facturas individuales.
- [ ] El filtro de "Todas las direcciones" permite ver solo "Emitido" o "Recibido".
- [ ] El botón "Limpiar" dentro de la ventana grande borra los filtros aplicados a los documentos.
- [ ] Se puede cerrar la ventana grande haciendo clic fuera de ella o usando la tecla `Esc`.

## 5. Descarga Segura de Reporte de Errores
- [ ] Al hacer clic en la tarjeta grande de "Errores" (en la pantalla principal), se abre la ventana de detalle de errores.
- [ ] La ventana de errores muestra una lista de las facturas que fallaron y el motivo.
- [ ] Al hacer clic en el botón de exportar o descargar (CSV), el navegador descarga un archivo a la computadora.
- [ ] Al abrir el archivo descargado en Excel o Google Sheets, las columnas (RFC Emisor, Receptor, Fechas, Motivo) se acomodan correctamente.
- [ ] Al revisar los motivos de error en Excel, no se ejecuta ninguna fórmula matemática automáticamente, incluso si el error contiene símbolos extraños.

## Notas Adicionales del Usuario de Pruebas
_Usa este espacio para anotar cualquier comportamiento extraño, lentitud en la pantalla, o errores visuales que no estén cubiertos en la lista anterior:_
- 
- 
- 

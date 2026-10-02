# Checklist de Pruebas: Monitor de Solicitudes (Descargas Masivas)

### 1. Comportamiento ante la Selección de Empresa
- [ ] Si no hay empresa seleccionada, se muestra el texto "Selecciona una empresa en el menú principal para comenzar".
- [ ] Si no hay empresa seleccionada, los botones "Actualizar" y "Buscar" están deshabilitados.
- [ ] Si hay empresa seleccionada, se carga automáticamente la tabla de solicitudes para el RFC de la empresa.

### 2. Tabla de Resultados (Data Grid)
- [ ] Si la API devuelve un arreglo vacío, se muestra el mensaje "No se encontraron solicitudes".
- [ ] El campo "Tipo Recuperación" muestra correctamente el texto ("Emitidos", "Recibidos" o "Por Folio").
- [ ] El campo "Rango Fechas" muestra el UUID si la solicitud fue `retrievalType: 'folio'`.
- [ ] El campo "Rango Fechas" muestra "Del: DD/MM/YYYY Al: DD/MM/YYYY" si la solicitud fue `retrievalType: 'emitidos'` o `'recibidos'`.
- [ ] El campo "Tipo" (Metadata/CFDI) se muestra correctamente como un Badge gris.
- [ ] El campo "Mensaje SAT" muestra el texto completo o un fallback seguro truncado ("Ver error en log" / "-").

### 3. Badges Visuales de Estatus
- [ ] Los estatus `SOLICITADO` y `PENDIENTE` renderizan un badge amarillo ("Solicitado").
- [ ] Los estatus `ACEPTADO`, `VERIFICADO`, `FINALIZADO` y `COMPLETADO` renderizan un badge verde ("Completado").
- [ ] El estatus `ERROR` renderiza un badge rojo ("Error").
- [ ] Cualquier otro estatus desconocido renderiza un badge outline por defecto.

### 4. Filtros y Botones de Acción
- [ ] Al llenar un campo de filtro (ej. Folio UUID) y hacer clic en "Buscar", se realiza una petición GET a la API adjuntando los query params correspondientes (ej. `?rfc=...&folio=...`).
- [ ] Al hacer clic en "Actualizar", la tabla entra en estado de carga (Spinner) y vuelve a solicitar los datos a la API.

### 5. Manejo de Errores
- [ ] Si la API responde con error (status no `ok`), se captura y se lanza un mensaje Toast de color rojo indicando "Error al cargar la información".
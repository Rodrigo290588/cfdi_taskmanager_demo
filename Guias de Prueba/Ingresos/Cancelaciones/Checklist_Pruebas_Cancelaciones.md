# ✅ Checklist de Pruebas: Módulo de Cancelaciones

Este documento sirve como lista de verificación directa para validar el módulo `/dashboard_fiscal/cancelaciones`. Cada punto está basado en la [Guía de Pruebas](Guia_Pruebas_Cancelaciones.md).

---

## 1. ⚙️ Pre-requisitos y Configuración Inicial
- [ ] **CH-CAN-01:** Verificar que si no hay empresa seleccionada, la pantalla muestre el aviso "Selecciona una empresa" y oculte la tabla.
- [ ] **CH-CAN-02:** Verificar que al dar clic en "Aplicar" sin haber seleccionado/llenado ningún filtro, la tabla permanezca vacía y muestre la alerta informativa "Selecciona al menos un filtro para consultar registros".

## 2. 🔍 Filtros Principales y Búsqueda
- [ ] **CH-CAN-03:** Validar que el filtro "Tipo CFDI" (INGRESO/PAGO) agregue correctamente el parámetro a la consulta.
- [ ] **CH-CAN-04:** Validar que el filtro "Estatus" interno (Activo/Cancelado) se envíe correctamente en la búsqueda.
- [ ] **CH-CAN-05:** Comprobar que la búsqueda envía SIEMPRE por debajo el parámetro `satStatus=CANCELADO` sin importar otros filtros.
- [ ] **CH-CAN-06:** Validar que los campos de "Fecha desde" y "Fecha hasta" limiten los resultados correctamente en la tabla.
- [ ] **CH-CAN-07:** Hacer clic en "Limpiar filtros" y comprobar que todos los inputs vuelven a su estado por defecto y la tabla se reinicia.

## 3. 📊 Interacción con la Tabla de Datos (Data Grid)
- [ ] **CH-CAN-08:** Escribir en un campo de "Filtrar..." (ej. en la columna RFC) y verificar que los datos mostrados se filtran en tiempo real.
- [ ] **CH-CAN-09:** Arrastrar una columna desde el encabezado hacia otra posición y confirmar que el orden cambia visualmente.
- [ ] **CH-CAN-10:** Dar clic en el botón "XML" (ícono de código) en la fila de un registro y verificar que inicie la descarga del archivo `.xml`.
- [ ] **CH-CAN-11:** Dar clic en el botón "PDF" y verificar que muestre el toast de "Generando PDF..." e intente abrir una nueva pestaña.
- [ ] **CH-CAN-12:** Validar que los botones de paginación "Anterior" y "Siguiente" estén deshabilitados en los extremos (página 1 o última página).

## 4. 🗂️ Importación de Layout (Masivo)
- [ ] **CH-CAN-13:** Abrir el modal dando clic en "Importación Layout".
- [ ] **CH-CAN-14:** Intentar seleccionar un archivo que no sea `.txt` y verificar que el sistema lo rechaza mostrando un mensaje de error ("Solo se permiten archivos .txt").
- [ ] **CH-CAN-15:** Seleccionar un archivo `.txt` válido, dar clic en "Procesar layout" y verificar que, tras la carga, aparezcan las 6 tarjetas de resumen (Procesados, Actualizados, Ignorados, etc.).
- [ ] **CH-CAN-16:** Verificar que debajo de las tarjetas se rendericen las pestañas con las tablas de resultados (Actualizados, Ignorados, No encontrados, Inválidos, No contemplados).
- [ ] **CH-CAN-17:** Dar clic en la pestaña "No contemplados" y verificar que el botón "Copiar registros no contemplados" copie efectivamente el contenido al portapapeles.

## 5. 💾 Exportaciones
- [ ] **CH-CAN-18:** Validar que los botones "Exportar CSV" y "Exportar Excel" estén **deshabilitados** si no hay resultados en la tabla.
- [ ] **CH-CAN-19:** Con resultados en la tabla, dar clic en "Exportar CSV" y confirmar que el archivo se descarga correctamente.
- [ ] **CH-CAN-20:** Con resultados en la tabla, dar clic en "Exportar Excel" y confirmar que se genera y descarga el archivo `.xls`.

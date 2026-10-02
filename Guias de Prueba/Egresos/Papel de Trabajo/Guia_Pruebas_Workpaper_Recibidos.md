# Guía de Pruebas: Papel de Trabajo de Proveedores (Egresos)
## Módulo: `/dashboard_recibidos/workpaper`

Esta guía describe cómo verificar paso a paso que el Papel de Trabajo de Proveedores funcione correctamente, abarcando desde la consulta de datos hasta las exportaciones y la persistencia de las preferencias del usuario. 

---

### Objetivo del Módulo
El Papel de Trabajo de Egresos permite a los usuarios buscar, filtrar y analizar a detalle todas las facturas recibidas de sus proveedores (gastos). También permite interactuar con una tabla de datos (Data Grid) personalizable, ver el contenido original (XML/PDF) de las facturas y realizar descargas masivas a Excel o ZIP.

---

### Sección 1: Selección de Empresa y Carga Inicial
**¿Qué vamos a probar?** Que el sistema cargue correctamente la lista de empresas y que al seleccionar una, se carguen los CFDI de los proveedores.

1. **Carga de empresas:** Al entrar a la página, el sistema debe mostrar una tarjeta con un selector de empresas. 
2. **Selección:** Selecciona una empresa del menú desplegable.
3. **Despliegue de resultados:** Asegúrate de que, tras la selección, el Data Grid inferior se llena con información de facturas recibidas.

---

### Sección 2: Uso de Filtros y Buscador
**¿Qué vamos a probar?** Que las herramientas de búsqueda y filtrado restrinjan correctamente los resultados.

1. **Búsqueda por UUID o RFC:**
   - Escribe un RFC de proveedor o el UUID (folio fiscal) de una factura en el campo de búsqueda de texto.
   - Presiona Enter o el botón "Filtrar".
   - Verifica que el Data Grid muestre solo la factura o facturas que coincidan.
2. **Filtro por Rango de Fechas:**
   - Abre el selector de fechas y elige un periodo específico (ej. "Últimos 30 días" o un mes en particular).
   - Haz clic en "Filtrar".
   - Verifica que la fecha de emisión de todas las facturas mostradas caiga dentro del rango seleccionado.
3. **Filtros por Estatus y Tipo:**
   - Cambia el "Estatus SAT" (Vigente / Cancelado).
   - Cambia el "Tipo de CFDI" (Ingreso, Egreso, Pago).
   - Haz clic en "Filtrar" y valida que los resultados correspondan estrictamente a lo elegido.

---

### Sección 3: Interacción con el Data Grid (Tabla de Datos)
**¿Qué vamos a probar?** Que el usuario pueda personalizar la tabla y que sus preferencias se guarden.

1. **Ocultar / Mostrar columnas:**
   - Haz clic en el botón de configuración de columnas (generalmente un ícono de engrane o "Columnas").
   - Desmarca algunas columnas (ej. Tipo, Moneda, Serie).
   - Verifica que desaparezcan inmediatamente de la tabla.
2. **Reordenar columnas:**
   - Arrastra el encabezado de una columna hacia la izquierda o la derecha.
   - Verifica que el orden cambie visualmente.
3. **Persistencia (Guardado automático):**
   - Recarga la página por completo (`F5` o `Ctrl + R`).
   - Verifica que el sistema haya "recordado" qué columnas ocultaste y en qué orden las dejaste (esto se guarda automáticamente en el perfil del usuario mediante la API `/api/user/profile`).

---

### Sección 4: Visualización de XML y PDF
**¿Qué vamos a probar?** Que el usuario pueda ver el contenido de un comprobante específico.

1. **Visor XML:**
   - En cualquier fila del Data Grid, busca el ícono de código o archivo bajo la columna de acciones.
   - Haz clic en "Ver XML".
   - Verifica que se abra una ventana (modal) mostrando el código fuente del comprobante original.
2. **Visor/Descarga PDF:**
   - Haz clic en "Ver PDF" o "Descargar PDF".
   - Verifica que se abra el archivo o inicie la descarga del documento PDF legible correspondiente a esa factura.

---

### Sección 5: Exportaciones Masivas
**¿Qué vamos a probar?** Que el sistema genere los reportes con toda la información filtrada.

1. **Exportar a Excel (CSV):**
   - Con datos en la pantalla (aplica algún filtro si lo deseas), haz clic en el botón "Exportar CSV".
   - Verifica que se descargue un archivo. Ábrelo en Excel y valida que contenga las mismas filas que veías en pantalla.
2. **Exportar a ZIP:**
   - Haz clic en el botón "Exportar ZIP".
   - El sistema debe procesar y descargar un archivo comprimido que contenga los archivos XML y PDF de los comprobantes listados. (Nota: Esto puede tardar unos segundos si hay muchos archivos).

---
*Fin de la Guía de Pruebas. Si todo lo anterior funciona como se describe, el módulo cumple con sus objetivos de negocio.*
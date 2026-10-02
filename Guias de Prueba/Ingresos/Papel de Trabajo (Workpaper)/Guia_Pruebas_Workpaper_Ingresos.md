# Guía de Pruebas: Papel de Trabajo (Workpaper) - Ingresos

**Ruta del módulo:** `/dashboard_fiscal/workpaper`

Este documento explica de forma detallada y en lenguaje no técnico cómo probar y validar todas las funciones del Papel de Trabajo (Workpaper) de facturas emitidas (Ingresos). 

---

## 1. Pre-requisitos (Configuración Inicial)

Antes de realizar cualquier prueba, el sistema requiere ciertos pasos básicos de seguridad y configuración.

- **Selección de Empresa:**
  - **Acción:** Ingresa al módulo sin seleccionar ninguna empresa en el menú lateral.
  - **Qué valida:** El sistema debe bloquear la consulta y mostrar un mensaje indicando: "Selecciona una empresa. Usa el combobox del sidebar para elegir la empresa y cargar la Hoja de Trabajo...".

- **Obligatoriedad del Filtro de Fechas:**
  - **Acción:** Selecciona una empresa, pero deja los campos "Fecha desde" y "Fecha hasta" vacíos. Haz clic en "Aplicar".
  - **Qué valida:** El sistema debe mostrar un error (Toast) diciendo "Selecciona Fecha Inicio y Fecha Fin antes de consultar" y no debe cargar información histórica.

- **Validación Lógica de Fechas:**
  - **Acción:** Selecciona una "Fecha desde" que sea **mayor** (posterior) a la "Fecha hasta" (Ej. Desde: 10/07/2026, Hasta: 01/07/2026).
  - **Qué valida:** El botón "Aplicar" debe deshabilitarse, y debe aparecer un texto rojo debajo indicando: "La fecha de inicio no puede ser mayor que la fecha final".

---

## 2. Validación de Filtros y Consultas (Backend/Frontend)

Una vez seleccionadas fechas válidas (ej. 01/07/2026 al 08/07/2026), se procede a validar la consulta a la base de datos.

- **Carga Inicial:**
  - **Acción:** Selecciona fechas válidas y haz clic en "Aplicar".
  - **Qué valida:** La tabla debe llenarse con registros, mostrando facturas de tipo I (Ingreso), P (Pago), E (Egreso) y T (Traslado) emitidas por la empresa en ese periodo. En el pie de la tabla debe aparecer el paginador (Ej. "Página 1 de X").

- **Filtro por Estatus (SAT):**
  - **Acción:** Cambia el filtro "Estatus" a "Vigente" y haz clic en "Aplicar".
  - **Qué valida:** Todos los registros en la columna "SAT" de la tabla deben decir "VIGENTE".
  - **Acción:** Cambia el filtro a "Cancelado" y haz clic en "Aplicar".
  - **Qué valida:** Todos los registros en la columna "SAT" deben decir "CANCELADO".

- **Búsqueda por Columnas:**
  - **Acción:** Escribe un texto en el buscador de la columna "Receptor" (ej. el nombre de un cliente) o en la columna "UUID".
  - **Qué valida:** El sistema debe recargar la página 1 y mostrar únicamente las facturas que coincidan con ese texto.

---

## 3. Comportamiento de la Tabla (Data Grid)

La tabla es altamente interactiva. Debemos probar que las funciones visuales operan correctamente.

- **Ocultar y Mostrar Columnas:**
  - **Acción:** Haz clic en el botón "Columnas" (icono de ojo).
  - **Qué valida:** Se despliega un panel con todas las columnas agrupadas (Comprobante, Emisor, Receptor, etc.).
  - **Acción:** Desmarca la casilla de "Uso CFDI" y marca "Moneda".
  - **Qué valida:** La columna "Uso CFDI" desaparece de la tabla instantáneamente y aparece "Moneda".

- **Vistas Rápidas (Botones en panel de columnas):**
  - **Acción:** Haz clic en "Vista básica".
  - **Qué valida:** La tabla se limpia y solo muestra las 11 columnas principales (RFC, Nombre, Serie, Folio, UUID, Totales).
  - **Acción:** Haz clic en "Mostrar todo".
  - **Qué valida:** Todas las columnas del sistema se activan.

- **Reordenamiento (Drag and Drop):**
  - **Acción:** Haz clic sostenido en el nombre de la columna "Total", arrástralo y suéltalo antes de "SubTotal".
  - **Qué valida:** La columna "Total" ahora debe aparecer a la izquierda de "SubTotal".

- **Totales al pie de página (Footer):**
  - **Acción:** Ve al final de la tabla de resultados.
  - **Qué valida:** Debe existir una fila en negritas que suma correctamente los montos de la página actual para las columnas: SubTotal, Descuento, Total, Total Impuestos Trasladados y Total Impuestos Retenidos.

- **Detalle de Conceptos (Tabla Anidada):**
  - **Acción:** En el panel de "Columnas", asegúrate de tener marcada la opción `<cfdi:Conceptos>`. 
  - **Acción:** En la tabla, haz clic en la flecha `>` a la izquierda de cualquier factura.
  - **Qué valida:** Se debe desplegar una tabla secundaria debajo de esa factura, mostrando el detalle de sus artículos (ClaveProdServ, Descripción, Valor Unitario, Importe, y desglose de Traslados/Retenciones si existen).

---

## 4. Acciones Individuales y Descargas

Prueba la descarga individual de documentos por cada fila de la tabla.

- **Descarga de XML Individual:**
  - **Acción:** Haz clic en el botón con icono de código (`</>`) en la columna "Acciones" de cualquier factura.
  - **Qué valida:** Se debe descargar automáticamente un archivo en tu computadora llamado `cfdi_[UUID].xml` que contiene el código real de la factura.

- **Generación de PDF Individual:**
  - **Acción:** Haz clic en el botón con icono de documento (hoja) en la columna "Acciones".
  - **Qué valida:** El sistema mostrará un aviso ("Generando PDF...") y abrirá una nueva pestaña en el navegador con la representación impresa del CFDI.

---

## 5. Exportaciones Masivas

Estas pruebas validan que el sistema pueda extraer la información en bloque. Para probar esto, es indispensable tener un filtro de fechas aplicado.

- **Exportación a CSV:**
  - **Acción:** Haz clic en el botón "Exportar CSV".
  - **Qué valida:** Se descarga un archivo `.csv`. Al abrirlo (en Excel o Bloc de Notas), debe contener exactamente las columnas que tienes visibles en tu pantalla en ese momento, todos los registros de todas las páginas, y una última fila con la palabra "TOTAL" sumando los montos.

- **Exportación a Excel:**
  - **Acción:** Haz clic en el botón "Exportar Excel".
  - **Qué valida:** Se descarga un archivo `.xls`. Al abrirlo en Excel, debe mostrar la misma información que el CSV, respetando las columnas visibles y con la fila de totales calculada.

- **Descarga Masiva de ZIP:**
  - **Acción:** En la tabla, marca la casilla de verificación (checkbox) a la izquierda de 2 o 3 facturas diferentes.
  - **Qué valida:** El botón "Descarga Zip" debe habilitarse y mostrar el número de facturas seleccionadas (Ej. "Descarga Zip (3)").
  - **Acción:** Haz clic en ese botón.
  - **Qué valida:** El botón cambiará a "Preparando Zip...". Al terminar, se descargará un archivo `.zip`. Al descomprimirlo, debe contener el XML y el PDF de cada una de las facturas que seleccionaste.

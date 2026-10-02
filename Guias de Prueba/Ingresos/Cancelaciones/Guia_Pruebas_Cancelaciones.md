# 📘 Guía de Pruebas: Módulo de Cancelaciones

**Ubicación del módulo:** `/dashboard_fiscal/cancelaciones`  
**Objetivo:** Validar la funcionalidad del panel de facturas canceladas, asegurando que los filtros, el data grid, la importación masiva de layouts (.txt) y las exportaciones funcionen correctamente.

---

## 1. ⚙️ Pre-requisitos y Configuración Inicial

Antes de poder visualizar los datos en el módulo de Cancelaciones, el sistema requiere una configuración mínima.

*   **Selección de Empresa:** Al ingresar al módulo, si no hay una empresa seleccionada en el menú lateral (sidebar), el sistema debe mostrar un mensaje pidiendo seleccionar una ("Selecciona una empresa").
*   **Filtros Obligatorios para Búsqueda:** Por seguridad y rendimiento, el sistema no carga todos los registros automáticamente. El usuario debe seleccionar al menos un filtro (por ejemplo, Fechas) y hacer clic en **"Aplicar"** para que los datos se muestren en la tabla. Si se presiona "Aplicar" sin ningún filtro, debe aparecer una alerta informativa.

## 2. 🔍 Filtros Principales y Búsqueda

El panel superior contiene filtros generales que afectan toda la consulta.

*   **Tipo de CFDI:** Permite filtrar por tipo de documento (`Todos`, `INGRESO`, `PAGO`).
*   **Estatus (Sistema):** Permite filtrar por el estatus interno (`Todos`, `Activo`, `Cancelado`).
*   **Estatus SAT (Fijo):** El módulo está diseñado para buscar exclusivamente documentos con estatus SAT igual a **CANCELADO**. Esto es transparente para el usuario.
*   **Fechas (Desde / Hasta):** Acota la búsqueda a un rango de fechas de emisión específico.
*   **Botón Limpiar Filtros:** Al hacer clic, todos los campos de búsqueda regresan a su estado original (vacíos o "Todos") y la tabla se limpia.

## 3. 📊 Interacción con la Tabla de Datos (Data Grid)

La tabla de datos donde se muestran los resultados tiene herramientas internas de filtrado y visualización.

*   **Filtros por Columna:** Debajo de los encabezados principales, cada columna tiene un pequeño cuadro de texto (`Filtrar...`). Escribir en este cuadro debe filtrar los registros en tiempo real en la pantalla (Ej. buscar un RFC específico).
*   **Arrastrar y Soltar (Drag & Drop):** El usuario puede hacer clic sobre el encabezado de una columna (ej. "UUID"), mantener presionado, y arrastrarlo hacia la izquierda o derecha para reordenar las columnas a su gusto.
*   **Acciones por Fila:**
    *   **Botón XML:** Descarga el archivo `.xml` original de la factura.
    *   **Botón PDF:** Abre una nueva pestaña para visualizar el PDF de la factura correspondiente.
*   **Paginación:** Si hay muchos resultados, el sistema debe mostrar controles en la parte inferior para avanzar o retroceder entre las páginas de resultados.

## 4. 🗂️ Importación de Layout (Masivo)

Esta es una de las funciones más críticas del módulo. Permite al usuario subir un archivo de texto (`.txt`) para actualizar masivamente el estado de múltiples facturas a CANCELADO en la base de datos.

*   **Apertura del Modal:** Al hacer clic en el botón "Importación Layout", se abre una ventana emergente.
*   **Validación de Archivo:** El sistema **sólo** debe permitir subir archivos con extensión `.txt`. Si se intenta subir otro tipo (ej. `.pdf` o `.xlsx`), el sistema lo rechaza y muestra un mensaje de error.
*   **Procesamiento:** Una vez cargado el `.txt`, se da clic en "Procesar layout". El sistema enviará la petición al servidor.
*   **Tarjetas de Resumen (KPIs del Layout):** Tras el procesamiento, deben aparecer 6 tarjetas indicando el resultado numérico:
    1.  Procesados
    2.  Actualizados (Verde)
    3.  Ignorados
    4.  No encontrados
    5.  Inválidos (Naranja)
    6.  No contemplados (Rojo)
*   **Pestañas de Detalle:** Debajo de las tarjetas, se muestran pestañas para ver exactamente qué UUIDs cayeron en cada categoría (Actualizados, Ignorados, etc.).
*   **Copiar Registros:** En la pestaña "No contemplados", debe existir un botón para "Copiar registros" que permite llevar el texto crudo al portapapeles para su revisión manual.

## 5. 💾 Exportaciones

Una vez que se han aplicado filtros y existen datos en la tabla, el usuario puede exportar los resultados. Si no hay datos, estos botones deben estar **deshabilitados**.

*   **Exportar CSV:** Descarga un archivo `.csv` con las columnas y el orden exacto que el usuario está visualizando en la pantalla en ese momento.
*   **Exportar Excel:** Descarga un archivo `.xls` (formato XML de Excel) con la información.

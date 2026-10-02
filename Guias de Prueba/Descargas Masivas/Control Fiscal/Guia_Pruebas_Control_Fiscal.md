# Guía de Pruebas: Control Fiscal (Descargas Masivas)

## Descripción General
Esta guía describe los escenarios de validación para el submódulo de **Control Fiscal** (`/mass-downloads/fiscal-control`). Este panel actúa como un auditor interno que contrasta la información del SAT (Metadatos) contra los archivos físicos descargados (XML). El objetivo es validar la correcta extracción de datos, el cálculo de indicadores (KPIs y Gráficas) y la interacción con el Data Grid personalizable.

## 1. Pruebas de Filtros y Autocompletado
- **Objetivo:** Verificar que los controles de búsqueda funcionen correctamente y asistan al usuario.
- **Escenarios:**
  - **Bloqueo sin Empresa:** Cargar la página sin empresa activa. Debe mostrar el mensaje "Selecciona una empresa" y ocultar los dashboards.
  - **Autocompletado de RFC:** Al escribir caracteres en el input "RFC", el sistema debe filtrar el arreglo de RFCs únicos detectados en la tabla (emisor o receptor) y desplegar un dropdown de sugerencias (máximo 10). Al hacer clic en una sugerencia, el input debe autocompletarse.

## 2. Pruebas de KPIs y Alerta de Discrepancia
- **Objetivo:** Asegurar que las tarjetas superiores realicen los cálculos matemáticos correctamente.
- **Escenarios:**
  - **Suma Básica:** Verificar que las tarjetas de "Registros en Metadatos" y "XML descargados" muestren las cantidades numéricas devueltas por la API con formato de separador de miles.
  - **Indicador de Brecha (Discrepancia):**
    - Si existe una diferencia detectada por la API (`discrepancyAlert = true`), la tarjeta debe agregar la clase CSS de borde rojo (`border-red-500`) y mostrar el Badge rojo indicando "Alerta de discrepancia: X% de diferencia".
    - Validar que el porcentaje global se muestre formateado a 2 decimales (`X.XX%`).

## 3. Pruebas de Renderizado de Gráficas (Recharts)
- **Objetivo:** Confirmar que los componentes de `recharts` se monten y muestren información basándose en la respuesta de la API.
- **Escenarios:**
  - **Gráfico de Pastel (Monitor de Cancelaciones):** Validar que se rendericen dos porciones (Vigentes en verde y Cancelados en rojo). Verificar que el monto total cancelado se formatee como moneda (`$XXX,XXX.XX`).
  - **Gráfico de Barras (Flujo Operativo):** Validar que las barras apiladas (Ingreso, Egreso, etc.) se pinten en el componente `BarChart` para representar la distribución mensual.

## 4. Pruebas de Data Grid, Columnas y Extracción de XML
- **Objetivo:** Garantizar que la tabla maestra es personalizable y procesa la información en crudo del XML de manera correcta.
- **Escenarios:**
  - **Extracción de XML (Regex):** Validar columnas que dependen directamente de la extracción textual del XML (como `SubTotal`, `Descuento`, `Total`, y atributos del nodo `<cfdi:Receptor>`). La extracción debe ignorar prefijos de namespace de manera segura.
  - **Panel de Columnas (Ocultar/Mostrar):** Al hacer clic en el botón "Columnas", debe desplegarse un panel con checkboxes organizados por grupo (`<cfdi:Comprobante>`, `<cfdi:Emisor>`, etc.). Desmarcar un checkbox debe ocultar la columna inmediatamente en la tabla.
  - **Totales de Footer:** Verificar que la última fila (TableFooter) ejecute la sumatoria matemática de todas las columnas monetarias visibles (Subtotal, Descuento, Total) basándose en las filas renderizadas en la página actual.

## 5. Reporte de Evidencias
Al ejecutar los scripts de Jest, los resultados deben quedar asentados en el archivo CSV de la carpeta correspondiente, documentando los casos exitosos y fallidos para el aseguramiento de calidad (QA).
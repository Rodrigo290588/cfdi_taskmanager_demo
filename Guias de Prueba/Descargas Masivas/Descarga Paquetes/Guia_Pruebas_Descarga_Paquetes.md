# Guía de Pruebas: Descarga de Paquetes (Descargas Masivas)

## Descripción General
Esta guía describe los escenarios de prueba para el submódulo de **Descarga de Paquetes** (`/mass-downloads/package-downloads`). El objetivo principal es validar que el sistema procesa correctamente las solicitudes aceptadas, calcula los KPIs (Tarjetas de progreso), y gestiona apropiadamente la interfaz de descarga de archivos ZIP entregados por el SAT.

## 1. Pruebas de Carga y Restricción por Empresa
- **Objetivo:** Garantizar que la consulta de paquetes ZIP es exclusiva de la empresa seleccionada en la sesión.
- **Escenarios:**
  - **Ausencia de Empresa:** Cargar el módulo sin una empresa activa. Validar que se muestre el mensaje restrictivo "Selecciona una empresa en el menú lateral..." y que no se envíen peticiones a la API.
  - **Presencia de Empresa:** Simular la selección de una empresa. Validar que la tabla y las tarjetas se rendericen e inicien la consulta de datos al backend.

## 2. Pruebas de Integración y Cálculo de KPIs (Dashboard)
- **Objetivo:** Comprobar que los indicadores superiores suman correctamente las cantidades devueltas por la base de datos.
- **Escenarios:**
  - **Suma de CFDI y Metadata:** Inyectar un arreglo con solicitudes mixtas (XML y Metadata). Verificar que las tarjetas "XML CFDI a descargar" y "Registros Metadata a descargar" sumen los totales independientemente.
  - **Barras de Progreso (Progress Bar):** Comprobar que la barra calcule correctamente el porcentaje (Descargados / Total * 100). En caso de 0 descargados, validar que la barra se muestre vacía (0%) y no cause errores de división por cero (`NaN`).

## 3. Pruebas de Renderizado de Tabla y Lógica Condicional
- **Objetivo:** Verificar que las filas de la tabla reflejen con precisión los estados y la disponibilidad de los paquetes.
- **Escenarios:**
  - **Mapeo de Fechas y Textos:** Validar que la columna Periodo formatee correctamente "MM/YYYY" (ej. 09/2023) agregando un "0" a la izquierda si el mes es de un dígito.
  - **Badges de Tipo de Archivo:** Comprobar que Metadata muestre un badge gris y CFDI uno azul.
  - **Botón de Descarga Condicional:** 
    - Si el estatus es `1` o `2` (No terminado), validar que el botón "Ver paquetes" **NO** esté presente.
    - Si el estatus es `3` (Completado), validar que el botón "Ver paquetes" aparezca en la celda final.

## 4. Pruebas de Modal de Descargas (Drawer) y Acciones
- **Objetivo:** Confirmar que el panel lateral de paquetes interactúa correctamente para solicitar la descarga de los archivos ZIP.
- **Escenarios:**
  - **Apertura del Panel:** Al hacer clic en "Ver paquetes", verificar que se despliegue el Drawer y se muestre la lista de los UUIDs de los paquetes (`paquetes`).
  - **Acción de Descarga y Prevención de Doble Clic:** Al presionar el botón de descargar de un archivo específico:
    - Se debe simular la creación de un tag `<a>` en el DOM para la descarga física.
    - El botón debe cambiar su estado a "cargando" (deshabilitado con spinner) temporalmente.
    - Se debe mostrar un Toast verde de confirmación "Descargando paquete...".
  - **Cierre del Panel:** Verificar que al hacer clic fuera del panel (overlay) o en el botón de cierre (✕), el Drawer desaparezca.

## 5. Reporte de Evidencias
Al ejecutar los scripts de Jest, los resultados deben quedar asentados en el archivo CSV de la carpeta correspondiente, documentando los casos exitosos y fallidos para el aseguramiento de calidad (QA).
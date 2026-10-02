# Guía de Pruebas: Monitor de Solicitudes (Descargas Masivas)

## Descripción General
Esta guía describe los escenarios de prueba para el submódulo de **Monitor de Solicitudes** (`/mass-downloads/requests/monitor`). El objetivo principal es validar que el sistema permita consultar correctamente el historial y estado de las peticiones al SAT, aplicando filtros, y reaccionando a la empresa seleccionada.

## 1. Pruebas de Carga y Autenticación de Empresa
- **Objetivo:** Asegurar que el sistema requiere una empresa para funcionar y carga los datos de forma automática.
- **Escenarios:**
  - **Sin Empresa:** Cargar el módulo sin una empresa activa en el sistema. Debe mostrar un mensaje de advertencia indicando "Selecciona una empresa en el menú principal para comenzar" y los botones deben estar deshabilitados.
  - **Con Empresa:** Al asignar una empresa activa (mockeando el localStorage), la página debe realizar la consulta al backend (API) de forma automática con el RFC correspondiente y habilitar los botones.

## 2. Pruebas de Renderizado de Tabla (Data Grid) y Estatus
- **Objetivo:** Verificar que la tabla muestra correctamente la información y aplica los estilos condicionales (badges).
- **Escenarios:**
  - **Sin Resultados:** Si el servidor devuelve un arreglo vacío, la tabla debe mostrar el mensaje "No se encontraron solicitudes".
  - **Mapeo de Datos:** Validar que los campos como "Fecha Solicitud", "Tipo", y "ID Paquete SAT" se muestren correctamente.
  - **Renderizado Dinámico de Rango/Folio:** 
    - Si la solicitud es "Por Folio", se debe mostrar el UUID.
    - Si es por "Emitidos" o "Recibidos", debe mostrar el texto "Del: [Fecha Inicio] Al: [Fecha Fin]".
  - **Badges de Estatus Visual:**
    - Verificar que los estados `SOLICITADO` y `PENDIENTE` rendericen una etiqueta amarilla.
    - Verificar que los estados `ACEPTADO`, `VERIFICADO`, `FINALIZADO` o `COMPLETADO` rendericen una etiqueta verde.
    - Verificar que el estado `ERROR` renderice una etiqueta roja.

## 3. Pruebas de Interacción y Botones
- **Objetivo:** Validar que los botones de acción ejecutan la consulta a la API con los parámetros correspondientes.
- **Escenarios:**
  - **Botón Actualizar (Refresh):** Al hacer clic, debe volver a disparar la consulta a la API con los filtros actuales y mostrar el estado de carga (`loading`).
  - **Botón Buscar:** Al llenar filtros (ej. Tipo de Solicitud, UUID) y hacer clic en buscar, se debe disparar la consulta a la API adjuntando los parámetros seleccionados en la URL (`URLSearchParams`).

## 4. Pruebas de Integración y Manejo de Errores de API
- **Objetivo:** Garantizar que el sistema maneje amigablemente las caídas o fallas del backend.
- **Escenarios:**
  - **Fallo de API (500):** Si la API responde con un error al intentar consultar las solicitudes, el sistema debe mostrar una notificación Toast roja indicando "Error al cargar la información".

## 5. Reporte de Evidencias
Al ejecutar los scripts de Jest, los resultados deben quedar asentados en el archivo CSV de la carpeta correspondiente, documentando los casos exitosos y fallidos para el aseguramiento de calidad (QA).
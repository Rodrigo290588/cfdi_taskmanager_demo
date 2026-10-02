# Guía de Pruebas: Verificación de Solicitudes SAT (Descargas Masivas)

## Descripción General
Esta guía detalla los escenarios de validación para el submódulo de **Verificación** (`/mass-downloads/verification`). El objetivo principal es asegurar que el sistema monitorice y renderice correctamente el estado de las peticiones que ya poseen un folio en el SAT, permitiendo a los usuarios visualizar los intentos de consulta y los próximos horarios de verificación.

## 1. Pruebas de Carga de Interfaz y Bloqueo de Acceso
- **Objetivo:** Garantizar que la consulta de solicitudes requiera forzosamente que una empresa esté seleccionada en el menú principal.
- **Escenarios:**
  - **Sin Empresa:** Acceder a la ruta sin información de empresa en el `localStorage`. Validar que el título y botón superior sigan existiendo, pero que la tabla y los filtros se reemplacen por la alerta: "Selecciona una empresa en el menú lateral para ver la información."
  - **Con Empresa:** Simular la existencia de una empresa y validar que los paneles de Filtros y Resultados se dibujen inmediatamente, disparando la petición a la API.

## 2. Pruebas de Filtrado Interno y Selectores
- **Objetivo:** Comprobar la lógica de filtrado de datos (tanto la regla estricta de negocio como los filtros del usuario).
- **Escenarios:**
  - **Exclusión de Peticiones sin ID SAT:** Inyectar una respuesta de la API que incluya peticiones con `satPackageId` nulo y otras con ID válido. Validar que la tabla **solo** dibuje aquellas que sí tienen un `satPackageId` asignado.
  - **Filtro de Estatus:** Modificar el filtro de "Estatus" (ej. cambiar a "En Proceso") y verificar que la tabla oculte las peticiones "Terminadas" o "Rechazadas", mostrando solo las coincidentes.

## 3. Pruebas de Renderizado de Tabla y Detalles Técnicos
- **Objetivo:** Verificar la correcta visualización de los datos técnicos de verificación, como fechas, intentos y bages de estatus.
- **Escenarios:**
  - **Mapeo General:** Validar el correcto volcado de la Fecha de Creación, RFC Solicitante, y el ID del paquete SAT.
  - **Columna de Próxima Verificación:** Comprobar que si la propiedad `nextCheck` tiene valor, se renderice un icono de reloj (`Clock`) junto a la fecha y hora. Si no tiene valor, que se muestre un simple guión (`-`).
  - **Columna de Paquetes:** Si la solicitud tiene el arreglo `packageIds` lleno (ej. con 2 elementos), debe aparecer el Badge indicando "2 Paquetes". Si está vacío, debe mostrar `-`.
  - **Columna de Intentos:** Asegurar que el número de `verificationAttempts` se imprime directamente en la celda.
  - **Badges Visuales de Estado:**
    - `TERMINADO`: Badge verde.
    - `EN_PROCESO`: Badge azul.
    - `ERROR` / `RECHAZADO`: Badge rojo.
    - `VENCIDO`: Badge gris.

## 4. Pruebas de Interacción del Botón Actualizar
- **Objetivo:** Validar que la acción manual del usuario refresca correctamente los datos.
- **Escenarios:**
  - **Actualizar Estado:** Al hacer clic en el botón superior derecho, el sistema debe cambiar el texto del botón a "Actualizando..." temporalmente, incluir la animación de spinner (`animate-spin`), y disparar la petición a la API de nuevo.

## 5. Reporte de Evidencias
Al ejecutar los scripts de Jest, los resultados deben quedar asentados en el archivo CSV de la carpeta correspondiente, documentando los casos exitosos y fallidos para el aseguramiento de calidad (QA).
# Guía de Pruebas: Módulo de Solicitudes de Descargas Masivas

## Descripción General
Esta guía describe los escenarios de prueba para el submódulo de **Solicitudes de Descargas Masivas** (`/mass-downloads/requests`). El objetivo principal es validar el correcto funcionamiento del formulario dinámico que permite a los usuarios realizar peticiones al SAT para la descarga masiva de comprobantes, asegurando que se respeten las reglas de negocio (formatos de UUID, obligatoriedad de fechas, límites del SAT) y la correcta captura de errores.

## 1. Pruebas de Interfaz de Usuario (UI) y Dinamismo
- **Objetivo:** Verificar que el formulario cambia su estructura dinámicamente según el tipo de solicitud.
- **Escenarios:**
  - Al cargar por defecto (Tipo: Emitidos), deben ser visibles los campos de fechas y ocultarse el de Folio UUID.
  - Al cambiar el Tipo de Solicitud a "Por Folio", el campo "Folio UUID" debe aparecer y los campos de fechas y tipo de comprobante deben desaparecer.

## 2. Pruebas de Validación de Errores (Zod)
- **Objetivo:** Confirmar que el sistema previene el envío de datos inválidos mediante alertas visuales en los campos correspondientes.
- **Escenarios:**
  - **Fechas Incompletas:** Intentar enviar una solicitud de tipo "Emitidos" o "Recibidos" sin definir Fecha Inicial o Final.
  - **Fechas Anteriores a 2011:** Intentar capturar una fecha con año inferior a 2011 y verificar el mensaje de error.
  - **Formato de UUID Incorrecto:** Seleccionar "Por Folio", ingresar un UUID con longitud menor a 36 caracteres o con formato inválido, y validar el rechazo de envío.

## 3. Pruebas de Integración con el Backend (Simulación SAT)
- **Objetivo:** Validar la interacción correcta del frontend con la API y el manejo de respuestas del servicio externo (SAT).
- **Escenarios:**
  - **Rechazo del SAT (Límites Alcanzados):** Simular una respuesta fallida de la API (`500` o `429` con un mensaje específico como "Límite de peticiones alcanzado en el SAT") y verificar que se muestra la notificación de error en rojo.
  - **Éxito (Happy Path):** Simular una respuesta exitosa con la creación del registro y la asignación del `satPackageId`. Confirmar que se muestra una notificación verde ("Solicitud registrada correctamente") incluyendo los IDs.

## 4. Pruebas de Flujo de Autenticación / Selección de Empresa
- **Objetivo:** Garantizar que el formulario toma automáticamente el RFC de la empresa actualmente seleccionada en el sistema.
- **Escenarios:**
  - Verificar que el campo "RFC Solicitante" esté bloqueado y tenga el valor correcto según el almacenamiento local.
  - Validar que al cambiar a "Emitidos", el RFC Solicitante se asigna también al RFC Emisor automáticamente.

## 5. Reporte de Evidencias
Al ejecutar los scripts de Jest, los resultados deben quedar asentados en el archivo CSV de la carpeta correspondiente, documentando los casos exitosos y fallidos para el aseguramiento de calidad (QA).
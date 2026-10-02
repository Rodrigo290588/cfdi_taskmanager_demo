# Checklist de Pruebas: Solicitudes de Descargas Masivas

### 1. Interfaz y Dinamismo del Formulario
- [ ] El título "Nueva Solicitud de Descarga" es visible.
- [ ] El selector de "Tipo de Solicitud" carga por defecto en "Emitidos".
- [ ] En "Emitidos" / "Recibidos", los campos "Fecha Inicial de Emisión" y "Fecha Final de Emisión" son visibles y obligatorios.
- [ ] En "Emitidos" / "Recibidos", el campo "Folio UUID" no es visible.
- [ ] Al seleccionar "Por Folio", el campo "Folio UUID" se muestra.
- [ ] Al seleccionar "Por Folio", los campos de fechas se ocultan.
- [ ] Al seleccionar "Por Folio", el campo "Tipo de Comprobante" se oculta.

### 2. Validaciones de Errores (Formulario y Zod)
- [ ] Intentar enviar solicitud "Emitidos" con fechas vacías muestra error de validación de fechas requeridas.
- [ ] Intentar enviar solicitud "Emitidos" con año de fecha menor a 2011 muestra error "La fecha debe ser a partir del año 2011".
- [ ] Intentar enviar solicitud "Por Folio" con un UUID incompleto (ej. 1234) muestra error "El folio debe tener un formato UUID válido".
- [ ] Intentar enviar solicitud "Por Folio" sin un UUID muestra error "El Folio es requerido".

### 3. Autocompletado y RFC de la Empresa
- [ ] El campo "RFC Solicitante" se autocompleta con la información de la empresa activa y está bloqueado.
- [ ] En "Emitidos", el campo "RFC Emisor (Yo)" se autocompleta y bloquea.
- [ ] En "Recibidos", el campo "RFC Receptor (Yo)" se autocompleta y bloquea.

### 4. Integración con Backend / API
- [ ] Cuando la API falla (ej. rechazo del SAT), se captura el error y se muestra una notificación toast roja con el mensaje devuelto por el servidor (ej. "Límite de peticiones alcanzado en el SAT").
- [ ] Cuando la API responde exitosamente, se muestra una notificación toast verde con el mensaje "Solicitud registrada correctamente" incluyendo los IDs internos y el paquete SAT.
- [ ] Tras un envío exitoso, el formulario se resetea limpiando sus valores (exceptuando la información persistente de la empresa).
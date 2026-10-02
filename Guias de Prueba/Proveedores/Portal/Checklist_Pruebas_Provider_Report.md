# Checklist de Pruebas: Portal de Proveedores
## Módulo: `/provider/cfdis-report`

Utiliza esta lista de verificación para asegurar que el portal de autoservicio de proveedores funcione correctamente tras cualquier actualización.

### 1. Carga de Archivos (Estructural)
- [ ] Subir un XML válido de forma individual y verificar que se procese.
- [ ] Subir un archivo `.zip` con varios XMLs válidos y verificar que se procesen todos.
- [ ] Intentar subir un PDF o TXT y verificar que el sistema lo rechace ("solo puedes cargar archivos XML o ZIP").
- [ ] Intentar subir un ZIP vacío o sin XMLs y verificar el rechazo.
- [ ] Intentar subir un XML alterado o incompleto y verificar el error de parseo.

### 2. Webservices (SAT y PAC) y Reglas de Negocio
- [ ] **Happy Path:** Subir un XML vigente y válido; verificar que pase la validación PAC, SAT y reglas internas.
- [ ] **Factura Cancelada:** Subir un XML cancelado en el SAT; verificar rechazo automático.
- [ ] **Factura Inexistente:** Subir un XML con UUID alterado; verificar rechazo por webservice del SAT ("No Encontrado").
- [ ] **Fallo PAC:** Subir XML que incumple estructura Anexo 20; verificar rechazo técnico.
- [ ] **RFC Emisor Incorrecto:** Subir XML con RFC emisor diferente al del usuario logueado; verificar rechazo.
- [ ] **RFC Receptor No Autorizado:** Subir XML dirigido a empresa no autorizada; verificar rechazo.
- [ ] **REP sin Factura:** Subir Complemento de Pago huérfano (sin XML de factura original en sistema); verificar rechazo.
- [ ] **Compliance:** Subir CFDI PUE con Forma de Pago 99; verificar rechazo por reglas de negocio.

### 3. Bloqueo Automático (Compliance de Pagos)
- [ ] (Simulación) Acceder con una cuenta bloqueada por falta de REP e intentar subir una factura normal; verificar que no se permita.
- [ ] Subir el REP faltante; verificar que la cuenta se desbloquee y permita subir facturas nuevamente.

### 4. Notificaciones
- [ ] Verificar la recepción de notificación de Aprobación (Webservice/Email) tras cargar un XML válido.
- [ ] Verificar la recepción de notificación de Rechazo tras cargar un XML inválido, incluyendo el motivo detallado.

### 5. Historial y Descargas
- [ ] Verificar que la tabla de historial muestre correctamente los CFDI aceptados.
- [ ] Botón "Ver XML": Verifica que el modal muestre el código fuente.
- [ ] Botón "Ver PDF": Verifica que genere o descargue el archivo correctamente.

---
**Firma de Validación:** ______________________  **Fecha:** _______________
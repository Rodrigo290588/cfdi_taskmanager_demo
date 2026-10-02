# Guía de Pruebas: Portal de Proveedores
## Módulo: `/provider/cfdis-report`

Esta guía describe cómo verificar exhaustivamente las funcionalidades del portal de autoservicio para proveedores, incluyendo la carga de facturas (XML/ZIP), la recepción de notificaciones de validación y la visualización del historial. Se incluyen los casos de éxito y los escenarios de error esperados.

---

### Objetivo del Módulo
Permitir a los proveedores cargar sus CFDI (Facturas de Ingreso y Complementos de Pago) directamente en el portal. El sistema validará su estructura (Anexo 20), su vigencia en el SAT, aplicará reglas de negocio (ej. RFC coincidente, cumplimiento de REP) y notificará al proveedor el resultado (Aceptado/Rechazado). Además, proporciona un historial de documentos cargados.

---

### Sección 1: Carga de Archivos y Validaciones Estructurales
**¿Qué vamos a probar?** Que el sistema procese archivos correctamente y rechace aquellos que no cumplen con los formatos permitidos.

1. **Carga Exitosa de XML Individual:**
   - Sube un archivo `.xml` de un CFDI válido (RFC Emisor coincide con el tuyo, RFC Receptor es de una empresa válida).
   - Verifica que el sistema procese el archivo y lo muestre en el reporte como "Aceptado".
2. **Carga Exitosa de ZIP:**
   - Sube un archivo `.zip` que contenga varios archivos `.xml` válidos.
   - Verifica que el sistema extraiga y procese todos los XML internos.
3. **Escenario de Error: Archivo No XML/ZIP:**
   - Intenta subir un archivo `.pdf` o `.txt`.
   - **Resultado Esperado:** El sistema muestra el error `"solo puedes cargar archivos XML o ZIP"`.
4. **Escenario de Error: ZIP Vacío o sin XMLs:**
   - Sube un archivo `.zip` que solo contenga PDFs.
   - **Resultado Esperado:** El sistema muestra el error `"el ZIP contiene archivos que no son XML. Deja solo CFDI en formato XML dentro del ZIP"`.
5. **Escenario de Error: XML Alterado o Dañado:**
   - Sube un `.xml` donde le falte la etiqueta de cierre (ej. falta `</cfdi:Comprobante>`).
   - **Resultado Esperado:** Error de parseo `"no fue posible procesar el XML. Verifica que el archivo no esté dañado"`.

---

### Sección 2: Conexión a Webservices (SAT y PAC) y Reglas de Negocio
**¿Qué vamos a probar?** Que el sistema se comunique correctamente con los webservices externos (SAT y PAC Factrónica) para validar la autenticidad y estado del documento, y que rechace los que incumplen reglas comerciales.

1. **Escenario de Éxito Total (Happy Path):**
   - Sube un XML de una factura real y reciente, correctamente timbrada, emitida por tu RFC y dirigida a la empresa receptora.
   - **Resultado Esperado:** 
     - Pasa la validación de estructura (Anexo 20) del PAC.
     - Pasa la validación del Webservice del SAT (Status: Vigente).
     - Pasa las reglas de negocio internas.
     - El archivo es "Aceptado", se agrega al historial y se envía la notificación de éxito.
2. **Escenario de Error: Validación SAT (Factura Cancelada):**
   - Sube un XML estructuralmente perfecto, pero que ya fue cancelado en el portal del SAT.
   - **Resultado Esperado:** El sistema contacta al webservice del SAT, detecta que el estatus es "Cancelado" y rechaza el documento con el mensaje correspondiente, evitando que se registre un gasto inválido.
3. **Escenario de Error: Validación SAT (Factura Inexistente / Apócrifa):**
   - Sube un XML donde se alteró intencionalmente el UUID o el Sello Digital antes de subirlo.
   - **Resultado Esperado:** El webservice del SAT responderá que el comprobante "No Encontrado" o "Inválido". El sistema rechaza la carga inmediatamente.
4. **Escenario de Error: Fallo en Validación PAC (Anexo 20):**
   - Sube un XML que, aunque es un XML válido, no cumple con los estándares técnicos del Anexo 20 (ej. le falta un nodo obligatorio según el esquema).
   - **Resultado Esperado:** El webservice del PAC (Factrónica) lo rechaza. El sistema muestra el error técnico devuelto por el PAC y detiene el proceso antes de consultar al SAT.
5. **Escenario de Error: RFC Emisor Incorrecto:**
    - Sube un XML válido ante el SAT, pero cuyo `Rfc` Emisor no sea el tuyo.
    - **Resultado Esperado:** Error `"el RFC emisor del XML no coincide con el RFC registrado para tu acceso"`.
 6. **Escenario de Error: RFC Receptor No Autorizado:**
    - Sube un XML emitido por ti, pero dirigido a una empresa que no es cliente tuyo en el sistema.
    - **Resultado Esperado:** Error `"el RFC receptor del XML no pertenece a ninguna empresa autorizada para tu acceso"`.
 7. **Escenario de Error: REP sin Factura Relacionada:**
    - Sube un Complemento de Pago (CFDI tipo 'P'), pero el sistema no tiene registrada la factura original a la que hace referencia (`IdDocumento`).
    - **Resultado Esperado:** Error `"No se encontró la factura [UUID] relacionada con uno de los REP cargados"`.
 8. **Escenario de Error: Reglas de Compliance (Forma 99 en PUE, ObjetoImp, RESICO):**
    - Si las reglas están activas, sube un CFDI PUE con Forma de Pago 99.
    - **Resultado Esperado:** Rechazo por regla de negocio (violación PUE vs Forma de pago).

---

### Sección 3: Bloqueo Automático (Compliance)
**¿Qué vamos a probar?** Que el proveedor no pueda subir nuevas facturas si debe Complementos de Pago atrasados.

1. **Simulación de Bloqueo:**
   - (Requiere configuración de QA): Configura al usuario de prueba como "Bloqueado" por falta de entrega de REP.
   - Intenta subir una Factura de Ingreso normal (`TipoDeComprobante="I"`).
   - **Resultado Esperado:** El sistema rechaza la carga indicando que la cuenta está bloqueada y debe regularizar sus Complementos de Pago.
2. **Regularización:**
   - Con la cuenta bloqueada, sube el Complemento de Pago (REP) faltante.
   - **Resultado Esperado:** El sistema permite la carga del REP y desbloquea la cuenta.

---

### Sección 4: Notificaciones (Webservice/Email)
**¿Qué vamos a probar?** Que el backend dispare las notificaciones correspondientes por cada archivo procesado.

1. **Notificación de Aprobación:**
   - Sube un XML válido.
   - Verifica (en los logs del sistema o servicio de correos) que se genera un evento con `status: 'APPROVED'` y los datos de validación (Anexo 20 OK, SAT OK).
2. **Notificación de Rechazo:**
   - Sube un XML inválido (ej. RFC incorrecto).
   - Verifica que se genera un evento con `status: 'REJECTED'` y el `rejectionReason` contiene la explicación detallada.

---

### Sección 5: Interacción con el Historial (Data Grid)
**¿Qué vamos a probar?** Que el proveedor pueda ver y descargar sus documentos previamente aceptados.

1. **Visualización de Tabla:**
   - Verifica que la tabla muestre las columnas correctas (UUID, Emisor, Fecha, Estatus de Pago, Total).
2. **Descarga de XML/PDF:**
   - Haz clic en el botón de acción para descargar el XML de una fila.
   - Verifica que se descargue el archivo correcto.
   - Haz clic en el botón para visualizar/descargar el PDF.
   - Verifica que se genere correctamente la representación impresa.

---
*Fin de la Guía de Pruebas. Cubriendo estos escenarios garantizamos que el portal es robusto ante errores de usuario y protege la integridad de la información.*
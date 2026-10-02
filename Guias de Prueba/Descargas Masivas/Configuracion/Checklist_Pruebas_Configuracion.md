# Checklist de Pruebas: Configuración de Descargas Masivas
## Módulo: `/mass-downloads`

Utiliza esta lista para verificar que el formulario de Configuración de Llaves Privadas funciona correctamente.

### 1. Validaciones de Interfaz y Campos
- [ ] Intentar enviar el formulario completamente vacío; verificar rechazo y mensaje de error.
- [ ] Llenar solo la contraseña y RFC e intentar enviar; verificar mensaje indicando archivos faltantes.
- [ ] Escribir una contraseña y probar el botón del "ojo"; verificar que muestre y oculte el texto correctamente.
- [ ] Subir un archivo `.key` válido; verificar que el recuadro cambie a verde y muestre el nombre del archivo.

### 2. Restricciones de Archivos (Errores)
- [ ] Intentar subir un `.pdf` en el campo `.key`; verificar mensaje de error inmediato y limpieza del campo.
- [ ] Intentar subir un `.pdf` en el campo `.cer`; verificar mensaje de error inmediato y limpieza del campo.

### 3. Conexión y Guardado (Servidor)
- [ ] **Error de Servidor:** Enviar el formulario completo pero con una contraseña incorrecta; verificar que se muestre el error devuelto por el servidor.
- [ ] **Éxito (Happy Path):** Enviar el formulario con datos y archivos correctos; verificar el mensaje de éxito ("Configuración guardada exitosamente") y que los campos se reinicien.

---
**Firma de Validación:** ______________________  **Fecha:** _______________
# Guía de Pruebas: Configuración de Descargas Masivas
## Módulo: `/mass-downloads` (PrivateKeyForm)

Esta guía detalla los pasos para validar el formulario de configuración de llaves privadas y certificados (FIEL), abarcando tanto el flujo exitoso como todas las validaciones de error.

---

### Sección 1: Interfaz y Validaciones de Campos Vacíos (Errores)
**Objetivo:** Verificar que el formulario no permita enviar datos incompletos.

1. **Escenario de Error: Envío en Blanco:**
   - Entra al submódulo de Configuración.
   - Sin llenar ningún campo, presiona el botón "Guardar Configuración".
   - **Resultado Esperado:** El sistema debe bloquear el envío y mostrar un mensaje de error (Toast) indicando que faltan campos (ej. "Favor de cargar su key, su certificado y su contraseña").
2. **Escenario de Error: Envío Parcial:**
   - Selecciona un RFC y escribe una contraseña, pero no subas los archivos.
   - Presiona "Guardar Configuración".
   - **Resultado Esperado:** El sistema debe mostrar un error indicando específicamente los archivos faltantes.

### Sección 2: Validación Estricta de Archivos (Errores)
**Objetivo:** Verificar que el sistema rechace archivos con extensiones incorrectas en el mismo instante en que el usuario intenta subirlos.

1. **Escenario de Error: Llave Privada Inválida (.pdf en lugar de .key):**
   - En el recuadro de "Carga de llave privada (.key)", intenta subir un archivo `.pdf` o `.txt`.
   - **Resultado Esperado:** El sistema debe limpiar la selección inmediatamente y mostrar el error `"El archivo debe tener extensión .key"`.
2. **Escenario de Error: Certificado Inválido (.pdf en lugar de .cer):**
   - En el recuadro de "Certificado (.cer)", intenta subir un archivo `.pdf`.
   - **Resultado Esperado:** El sistema debe limpiar la selección y mostrar el error `"El archivo debe tener extensión .cer"`.

### Sección 3: Interacción de UI (Happy Path UX)
**Objetivo:** Verificar la correcta retroalimentación visual.

1. **Visualización de Contraseña:**
   - Escribe "MiPassword123" en el campo de contraseña. Se verá como "•••••••••••••".
   - Haz clic en el ícono del "ojo" dentro del campo.
   - **Resultado Esperado:** El texto cambia a "MiPassword123" visible. Al volver a hacer clic, se oculta.
2. **Cambio de Estado al Subir Archivo:**
   - Sube un archivo válido `.key`.
   - **Resultado Esperado:** El recuadro gris cambia, muestra un ícono verde de éxito y el nombre del archivo cargado.

### Sección 4: Envío al Backend (Integración)
**Objetivo:** Verificar la comunicación con el servidor.

1. **Escenario de Error: Rechazo del Servidor (Credenciales Inválidas):**
   - Llena todos los campos con archivos `.key` y `.cer` válidos, pero escribe una contraseña equivocada (que no corresponda a la FIEL real).
   - Presiona "Guardar Configuración".
   - **Resultado Esperado:** El botón muestra un spinner "Guardando...". Luego, el servidor responde con error y el sistema muestra un Toast rojo indicando el fallo (ej. "Contraseña incorrecta" o "La llave no corresponde al certificado").
2. **Escenario de Éxito Total (Happy Path):**
   - Llena todos los campos con el RFC, `.key`, `.cer` y la contraseña correctos.
   - Presiona "Guardar Configuración".
   - **Resultado Esperado:** El sistema envía los datos (FormData), el servidor los valida exitosamente, se muestra un Toast verde `"Configuración guardada exitosamente"` y el formulario se limpia automáticamente.
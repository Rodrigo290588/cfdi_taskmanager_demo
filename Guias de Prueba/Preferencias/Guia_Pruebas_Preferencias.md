# Guía de Pruebas: Módulo de Preferencias del Sistema

**Módulo:** Preferencias
**Ruta de acceso:** `/preferences`
**Objetivo:** Validar que la configuración global de la plataforma (apariencia, región y seguridad de sesión) se muestre correctamente, cambie en tiempo real y se guarde de forma exitosa, aplicando las reglas de seguridad necesarias.

---

## 1. Seguridad y Control de Acceso
**Propósito:** Asegurar que solo el personal con permisos de administración pueda entrar y modificar estas configuraciones globales.

*   **Paso 1:** Iniciar sesión con un usuario que **no** tenga permisos para gestionar preferencias (por ejemplo, un perfil de solo lectura).
*   **Paso 2:** Intentar ingresar a la pantalla de preferencias.
*   **Resultado esperado:** El sistema debe denegar el acceso, impidiendo ver o cambiar cualquier configuración.
*   **Paso 3:** Iniciar sesión con un usuario que **sí** tenga los permisos correctos (Administrador) e ingresar a la pantalla.
*   **Resultado esperado:** La pantalla de preferencias debe cargar correctamente, mostrando las opciones divididas en pestañas.

## 2. Apariencia (Temas visuales)
**Propósito:** Confirmar que los cambios visuales reaccionen al instante.

*   **Paso 1:** Dentro de la pantalla, ir a la pestaña o sección de **Apariencia**.
*   **Paso 2:** Seleccionar la opción de **Modo Oscuro** (Dark Mode).
*   **Resultado esperado:** Toda la pantalla debe cambiar a tonos oscuros de forma inmediata.
*   **Paso 3:** Seleccionar la opción de **Modo Claro** (Light Mode).
*   **Resultado esperado:** La pantalla debe regresar inmediatamente a tonos claros (blanco/gris).

## 3. Configuración Regional
**Propósito:** Validar que los campos de idioma, moneda y zona horaria permitan escribir y seleccionarse adecuadamente.

*   **Paso 1:** Navegar a la sección de **Región** o configuración regional.
*   **Paso 2:** Cambiar el Idioma (ej. a "es-MX"), la Moneda (ej. a "MXN") y la Zona Horaria (ej. "America/Mexico_City").
*   **Paso 3:** Observar los campos modificados.
*   **Resultado esperado:** El sistema debe permitir ingresar los nuevos valores sin borrar el texto inesperadamente.

## 4. Seguridad de Sesión
**Propósito:** Comprobar que el sistema permita configurar el tiempo de inactividad de las sesiones.

*   **Paso 1:** Navegar a la sección de **Seguridad** o Sesión.
*   **Paso 2:** Localizar el campo de "Tiempo de expiración de sesión" e ingresar un número válido de minutos (por ejemplo, `30`).
*   **Resultado esperado:** El campo debe aceptar el número correctamente.

## 5. Guardado y Notificaciones de Éxito
**Propósito:** Asegurar que los cambios se guarden en la base de datos y el usuario reciba confirmación visual.

*   **Paso 1:** Después de haber realizado los cambios en Apariencia, Región y Seguridad (pasos anteriores), hacer clic en el botón **"Guardar Preferencias"**.
*   **Paso 2:** Observar el botón y la pantalla.
*   **Resultado esperado 1 (Carga):** El botón debe mostrar un ícono giratorio brevemente indicando que está trabajando.
*   **Resultado esperado 2 (Notificación):** Debe aparecer una alerta verde (Toast) en la pantalla con el mensaje indicando que las preferencias se actualizaron exitosamente.

## 6. Persistencia (Comprobación de que sí se guardó)
**Propósito:** Confirmar que los datos realmente se guardaron en el sistema y no se pierden al recargar.

*   **Paso 1:** Refrescar (F5) la página del navegador por completo.
*   **Paso 2:** Revisar nuevamente las pestañas de Región y Seguridad.
*   **Resultado esperado:** Los datos que ingresamos anteriormente (moneda "MXN", zona horaria, y los 30 minutos de sesión) deben seguir ahí, demostrando que se guardaron correctamente en la base de datos.

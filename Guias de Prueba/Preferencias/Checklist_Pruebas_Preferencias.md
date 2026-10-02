# Checklist de Pruebas: Módulo de Preferencias del Sistema

Este documento es una lista de verificación basada en la Guía de Pruebas del módulo `/preferences`. Su diseño permite que cualquier usuario valide que la configuración de la plataforma funciona como se espera, marcando cada casilla conforme avanza.

---

## 1. Seguridad y Control de Acceso
- [ ] **Acceso Denegado:** Al intentar ingresar con un usuario sin permisos administrativos, el sistema bloquea el acceso a la pantalla de preferencias.
- [ ] **Acceso Exitoso:** Al ingresar con un usuario Administrador, la pantalla de preferencias carga correctamente mostrando las pestañas de configuración.

## 2. Apariencia (Temas visuales)
- [ ] **Cambio a Modo Oscuro:** Al seleccionar la opción "Modo Oscuro" en la pestaña de apariencia, la pantalla cambia instantáneamente a tonos oscuros.
- [ ] **Cambio a Modo Claro:** Al seleccionar la opción "Modo Claro", la pantalla regresa inmediatamente a tonos claros (blanco/gris).

## 3. Configuración Regional
- [ ] **Captura de Idioma:** El sistema permite escribir y modificar el idioma (ej. "es-MX") sin borrar el texto inesperadamente.
- [ ] **Captura de Moneda:** El sistema permite escribir y modificar la moneda base (ej. "MXN").
- [ ] **Captura de Zona Horaria:** El sistema permite escribir y modificar la zona horaria (ej. "America/Mexico_City").

## 4. Seguridad de Sesión
- [ ] **Ajuste de Inactividad:** En la pestaña de seguridad, el sistema permite ingresar un número válido de minutos (ej. 30) en el campo de "Tiempo de expiración de sesión".

## 5. Guardado y Notificaciones de Éxito
- [ ] **Estado de Carga:** Al presionar el botón "Guardar Preferencias", aparece brevemente un ícono giratorio indicando que el sistema está trabajando.
- [ ] **Alerta de Éxito:** Tras guardar, aparece una notificación verde (Toast) confirmando que las preferencias se actualizaron correctamente.

## 6. Persistencia (Comprobación de que sí se guardó)
- [ ] **Mantenimiento de Datos:** Al recargar la página por completo (F5), los valores que se guardaron en los pasos anteriores (moneda, zona horaria, tiempo de sesión, etc.) siguen presentes en la pantalla, demostrando que se almacenaron correctamente en la base de datos.

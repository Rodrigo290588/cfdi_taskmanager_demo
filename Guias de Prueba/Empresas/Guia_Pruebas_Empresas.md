# Guía de Pruebas: Módulo de Empresas (`/companies`)

## 1. Objetivo
Asegurar que el módulo de "Empresas" funcione correctamente. Este módulo es el lugar donde registramos, buscamos y revisamos a las empresas (contribuyentes) con las que vamos a trabajar. Debemos comprobar que cada usuario vea solo lo que le corresponde, que las búsquedas funcionen bien y que el proceso para autorizar o rechazar una nueva empresa sea seguro y claro.

## 2. Lo que necesitas antes de empezar
- Tener acceso al sistema con dos tipos de cuentas diferentes (si es posible):
  - Una cuenta de **Administrador** (para ver todo y poder aprobar).
  - Una cuenta de **Usuario Normal** (para verificar que no pueda ver información que no le corresponde).
- Estar ubicado en el menú de "Empresas".

## 3. Casos de Prueba (Paso a Paso)

### Prueba 1: Revisar quién puede ver qué (Seguridad de Acceso)
- **¿Qué vamos a probar?:** Que la pantalla principal proteja la privacidad y solo muestre las empresas permitidas según el puesto de la persona.
- **Pasos:**
  1. Entra a la pantalla principal de "Empresas".
  2. Revisa la lista de empresas que aparecen en la tabla.
  3. **Lo que debe pasar:** 
     - Si entraste como *Administrador*, debes ver una lista completa con todas las empresas aprobadas de tu organización.
     - Si entraste como *Usuario Normal*, la lista debe ser mucho más pequeña, mostrando **solo** aquellas empresas a las que te han dado permiso explícito para trabajar.

### Prueba 2: Buscar empresas y usar filtros avanzados
- **¿Qué vamos a probar?:** Que podamos encontrar rápidamente una empresa usando diferentes criterios de búsqueda en la pantalla de "Búsqueda de Empresas".
- **Pasos:**
  1. Ve a la sección "Búsqueda de Empresas".
  2. Usa la barra de búsqueda para escribir el nombre o el RFC de una empresa que sepas que existe.
  3. Abre los filtros avanzados y selecciona un "Estado" (ej. Jalisco) o un "Régimen Fiscal".
  4. **Lo que debe pasar:**
     - La tabla de abajo debe actualizarse automáticamente.
     - Solo deben aparecer en la lista las empresas que coincidan exactamente con lo que escribiste y con los filtros que marcaste.
     - El botón de "Siguiente página" (si hay muchos resultados) debe funcionar correctamente.

### Prueba 3: Registrar una empresa nueva y validar campos obligatorios
- **¿Qué vamos a probar?:** Que el botón para registrar una empresa nueva funcione, pero que el sistema nos avise si olvidamos llenar información importante o si escribimos algo en formato incorrecto (como un RFC inválido o un correo mal escrito).
- **Pasos:**
  1. En la pantalla de búsqueda, haz clic en el botón "Nueva Empresa".
  2. Intenta guardar el formulario completamente en blanco haciendo clic en el botón de guardar.
  3. Ahora, llena los campos obligatorios (los que tienen asterisco `*`), pero comete un error a propósito: escribe un RFC de solo 5 letras o un correo que no tenga la arroba (`@`). Intenta guardar de nuevo.
  4. Finalmente, corrige los errores y llena todos los datos obligatorios (Nombre, RFC válido, Razón Social, Régimen Fiscal, etc.).
  5. Haz clic en guardar.
  6. **Lo que debe pasar:**
     - Al intentar guardar en blanco o con datos mal escritos, el sistema **no te debe dejar avanzar** y debe mostrar letras rojas o mensajes de alerta debajo de cada campo indicando qué falta o qué está mal escrito.
     - Al corregir los datos y guardar exitosamente, el formulario debe cerrarse y aparecer un mensaje de éxito ("Empresa creada").
     - La nueva empresa debe aparecer al principio de la lista.
     - En la columna de "Estatus", la nueva empresa debe decir claramente **"PENDIENTE"**.

### Prueba 4: Editar una empresa y validar datos incorrectos
- **¿Qué vamos a probar?:** Que al editar una empresa, podamos actualizar sus datos, pero que el sistema nos proteja si borramos información obligatoria o la escribimos mal.
- **Pasos:**
  1. En la lista de empresas, busca una que ya esté creada y entra a editarla (si el sistema tiene botón de edición).
  2. Borra la información de un campo obligatorio (como el Nombre o el RFC).
  3. Modifica el campo de "Teléfono" y ponle letras en lugar de números.
  4. Intenta guardar los cambios.
  5. **Lo que debe pasar:**
     - El sistema debe bloquear el guardado.
     - Debe aparecer un mensaje rojo en el campo que dejaste vacío diciendo que es obligatorio.
     - Debe aparecer un mensaje rojo en el campo del teléfono indicando que el formato es inválido (solo acepta números).

### Prueba 5: Aprobar una empresa
- **¿Qué vamos a probar?:** Que un supervisor pueda revisar la información de la empresa nueva y autorizarla para que empiece a operar.
- **Pasos:**
  1. Busca la empresa que acabas de crear (la que está en estatus Pendiente) y entra a su pantalla de revisión (Aprobar).
  2. Revisa que toda la información que capturaste aparezca correctamente en las tarjetas (Ubicación, Contacto, etc.).
  3. Haz clic en el botón verde "Aprobar Empresa".
  4. **Lo que debe pasar:**
     - El sistema debe mostrar un mensaje de éxito ("Empresa aprobada exitosamente").
     - Debes ser regresado a la pantalla de búsqueda.
     - Si buscas la empresa nuevamente, su estatus ahora debe decir **"APROBADO"**.

### Prueba 6: Rechazar una empresa (Forzar motivo)
- **¿Qué vamos a probar?:** Que si algo está mal, el supervisor pueda rechazar la empresa, pero el sistema lo **obligue** a explicar por qué.
- **Pasos:**
  1. Registra otra empresa de prueba y entra a su pantalla de revisión.
  2. Haz clic en el botón rojo "Rechazar Empresa".
  3. Aparecerá un cuadro de texto preguntando el motivo. Déjalo en blanco y haz clic en "Confirmar Rechazo".
  4. Ahora, escribe un motivo (ej. "El RFC capturado está incorrecto") y haz clic nuevamente en "Confirmar Rechazo".
  5. **Lo que debe pasar:**
     - Al intentarlo con el cuadro vacío, el sistema te debe detener y mostrar un error pidiendo que ingreses el motivo (no te dejará avanzar).
     - Al escribir el motivo y confirmar, el sistema debe mostrar un mensaje de éxito.
     - La empresa quedará guardada, pero con el estatus **"RECHAZADO"**.

### Prueba 7: Seguridad en el Sitio Web (Protección de enlaces)
- **¿Qué vamos a probar?:** Que el sistema nos proteja si alguien registra una página web falsa o maliciosa.
- **Pasos:**
  1. Registra una empresa de prueba, pero en el campo de "Sitio Web", en lugar de poner `www.google.com`, escribe un código falso como: `javascript:alert('Hola')`.
  2. Entra a la pantalla de revisión de esa empresa.
  3. Busca la sección de "Información de Contacto" donde debería aparecer el Sitio Web.
  4. **Lo que debe pasar:**
     - El sistema debe ser lo suficientemente inteligente para detectar que no es un enlace seguro (`http` o `https`) y **no debe mostrar ningún enlace** en la pantalla, protegiendo así a quien lo revise de darle clic por accidente.
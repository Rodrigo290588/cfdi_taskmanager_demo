# Guía de Pruebas: Alta Masiva de Usuarios (`/admin/users-bulk`)

## 1. Objetivo
Asegurar que la pantalla de Carga Masiva funcione correctamente. Debemos validar que el administrador pueda subir un archivo de texto, que el sistema bloquee archivos incorrectos (como imágenes o Excel) y que si el archivo tiene errores de captura, el sistema avise exactamente en qué fila está el problema.

## 2. Lo que necesitas antes de empezar
- Estar conectado con una cuenta de **Administrador**.
- Entrar a la sección de "Alta de Usuarios Layout" dentro del menú de Administración.
- Necesitarás tener guardados en tu computadora dos archivos de prueba (puedes crearlos en el Bloc de Notas):
  - **Archivo A (Incorrecto):** Un archivo con cualquier extensión que no sea `.txt` (por ejemplo, una foto `.jpg` o un archivo de Excel `.xlsx`).
  - **Archivo B (De Texto - con errores):** Un archivo `.txt` que tenga texto sin sentido adentro para forzar al sistema a que nos marque un error.

## 3. Casos de Prueba (Paso a Paso)

### Prueba 1: Bloqueo de Archivos Incorrectos (Ej. Excel o Imágenes)
- **¿Qué vamos a probar?:** Que el sistema solo acepte archivos de texto plano (.txt).
- **Pasos:**
  1. Haz clic en el botón "Seleccionar Archivo" (o en la caja grande punteada).
  2. Selecciona tu **Archivo A (Incorrecto)** (una foto, un PDF o un Excel).
  3. **Lo que debe pasar:** 
     - El sistema no debe cargar el archivo.
     - Debe aparecer un mensaje rojo de advertencia diciendo: *"Solo se permiten archivos de texto plano (.txt)"*.

### Prueba 2: Detección de Errores dentro del Archivo (Auditoría)
- **¿Qué vamos a probar?:** Que si subimos un archivo `.txt` pero la información está mal escrita, el sistema no mande invitaciones a medias y nos diga dónde nos equivocamos.
- **Pasos:**
  1. Haz clic de nuevo en "Seleccionar Archivo".
  2. Esta vez, selecciona tu **Archivo B (De Texto)** (el archivo `.txt` de prueba).
  3. Verás que en la caja punteada ahora aparece el nombre de tu archivo.
  4. Haz clic en el botón inferior "Cargar e Invitar Usuarios".
  5. **Lo que debe pasar:**
     - El botón debe decir "Procesando..." brevemente.
     - Luego, debe aparecer un recuadro rojo grande titulado "Se encontraron errores en el Layout".
     - Debajo, debe mostrarse una tabla indicando el número de la fila y el motivo exacto del rechazo (por ejemplo: formato incorrecto, falta el correo, etc.).

### Prueba 3: Simulación de Carga Exitosa
- **¿Qué vamos a probar?:** Que cuando se procesa un archivo perfecto, el sistema confirme el envío y limpie la pantalla.
- *(Nota para el probador: Como en este entorno de pruebas simularemos la conexión, al subir un archivo correcto veremos el comportamiento de éxito).*
- **Pasos:**
  1. *(El sistema de pruebas simulará subir un archivo perfecto).*
  2. Haz clic en el botón "Cargar e Invitar Usuarios".
  3. **Lo que debe pasar:**
     - La tabla roja de errores debe desaparecer (si estaba visible).
     - Debe aparecer un recuadro verde de "Proceso Completado".
     - El mensaje debe decir cuántos usuarios fueron invitados exitosamente.
     - La caja punteada debe vaciarse (volver a decir "Haz clic para seleccionar un archivo").

### Prueba 4: Seguridad y Privilegios (Simulación)
- **¿Qué vamos a probar?:** Que un empleado normal no pueda entrar a hacer cargas masivas.
- **Pasos:**
  1. Cierra tu sesión de administrador.
  2. Inicia sesión con una cuenta de Usuario Normal.
  3. Intenta entrar a la ruta de carga masiva de usuarios.
  4. **Lo que debe pasar:**
     - El sistema no debe mostrarte las instrucciones ni la caja para subir archivos.
     - Debe bloquearte y mostrar un mensaje de "Acceso Denegado".
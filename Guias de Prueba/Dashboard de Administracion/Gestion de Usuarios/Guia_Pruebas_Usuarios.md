# Guía de Pruebas: Gestión de Usuarios (`/admin/users`)

## 1. Objetivo
Asegurar que la pantalla de control de personal funcione correctamente. Debemos validar que el administrador pueda ver a los usuarios actuales, revisar a quiénes se les ha mandado invitación (pendientes), y poder editarlos, suspenderlos o eliminarlos sin que el sistema falle.

## 2. Lo que necesitas antes de empezar
- Estar conectado con una cuenta de **Administrador**.
- Entrar a la sección de "Usuarios" dentro del menú de Administración.

## 3. Casos de Prueba (Paso a Paso)

### Prueba 1: Revisar las Invitaciones Pendientes y Cancelarlas
- **¿Qué vamos a probar?:** Que la lista de personas que aún no aceptan su invitación se muestre bien y que el botón de borrar (papelera) funcione.
- **Pasos:**
  1. Busca la sección que dice "Invitaciones Pendientes".
  2. Localiza en la lista a un usuario invitado (debe tener un pequeño reloj que dice "Pendiente").
  3. Haz clic en el botón de la papelera (🗑️) junto a su nombre.
  4. Aparecerá un mensaje preguntando si estás seguro. Haz clic en "Eliminar".
  5. **Lo que debe pasar:** 
     - El sistema debe mostrar un mensaje verde diciendo que se eliminó correctamente.
     - La persona debe desaparecer de la lista de pendientes.

### Prueba 2: Activar y Suspender a un Usuario Actual
- **¿Qué vamos a probar?:** Que el interruptor de encendido/apagado pueda suspender a un trabajador temporalmente.
- **Pasos:**
  1. Baja hasta la sección que dice "Usuarios Actuales".
  2. Busca a un usuario que tenga el estado "Activo" (color verde).
  3. Haz clic en el interruptor (switch) que está a la derecha para apagarlo.
  4. Confirma en la ventana que aparece que deseas inactivarlo.
  5. **Lo que debe pasar:**
     - El sistema muestra un aviso de éxito.
     - La etiqueta del usuario debe cambiar de "Activo" a "Inactivo" (color gris).
     - (Puedes volver a presionar el interruptor para dejarlo activo de nuevo).

### Prueba 3: Editar Permisos y Empresas de un Usuario
- **¿Qué vamos a probar?:** Que podamos cambiarle el rol a una persona o darle acceso a más empresas mediante la ventana de edición.
- **Pasos:**
  1. En la lista de "Usuarios Actuales", haz clic en el botón del lápiz (✏️) junto a cualquier usuario.
  2. Se abrirá una ventana titulada "Editar Permisos de Usuario".
  3. Cambia su rol (por ejemplo, de Visualizador a Auditor) en el primer menú.
  4. Haz clic en el menú de "Empresas Asignadas" y marca/desmarca alguna casilla de las empresas disponibles.
  5. Haz clic en "Guardar Cambios".
  6. **Lo que debe pasar:**
     - El botón debe decir "Guardando..." momentáneamente (evitando doble clic).
     - La ventana se cerrará sola.
     - En la lista, verás que la etiqueta de rol del usuario cambió por la nueva que elegiste.

### Prueba 4: Eliminar Definitivamente a un Usuario Activo
- **¿Qué vamos a probar?:** Que el botón de borrar un usuario activo funcione y revoque sus accesos.
- **Pasos:**
  1. En la lista de "Usuarios Actuales", busca a un usuario que ya no necesite acceso.
  2. Haz clic en el botón de la papelera (🗑️) junto a su nombre.
  3. Lee el mensaje de advertencia y haz clic en "Eliminar" para confirmar.
  4. **Lo que debe pasar:**
     - El sistema muestra un aviso verde de "Usuario eliminado".
     - La persona desaparece por completo de la lista.

### Prueba 5: Seguridad y Privilegios (Simulación)
- **¿Qué vamos a probar?:** Que un empleado normal no pueda entrar a esta pantalla para darse permisos a sí mismo.
- **Pasos:**
  1. Cierra tu sesión de administrador.
  2. Inicia sesión con una cuenta de Usuario Normal.
  3. Intenta entrar a la ruta de administración de usuarios.
  4. **Lo que debe pasar:**
     - El sistema no debe cargar la lista. Debe bloquearte y mostrar un mensaje de "Acceso Denegado".
# Guía de Pruebas: Roles y Permisos (`/admin/roles`)

## 1. Objetivo
Asegurar que la pantalla de "Fábrica de Perfiles" funcione correctamente. Debemos validar que un administrador pueda crear un rol nuevo (con permisos específicos), editar un rol existente, eliminar roles que ya no se usen, y comprobar que el sistema bloquee a usuarios no autorizados.

## 2. Lo que necesitas antes de empezar
- Estar conectado con una cuenta de **Administrador**.
- Entrar a la sección de "Roles y Permisos" dentro del menú de Administración.

## 3. Casos de Prueba (Paso a Paso)

### Prueba 1: Crear un Nuevo Rol Personalizado
- **¿Qué vamos a probar?:** Que podamos crear un nuevo puesto de trabajo y decidir qué partes del sistema puede ver.
- **Pasos:**
  1. Haz clic en el botón superior derecho que dice **"Nuevo Rol"**.
  2. En la ventana que aparece, escribe un nombre (ej. "Auditor Jr.") en el campo de "Nombre del Rol".
  3. Desplázate hacia abajo en la ventana y apaga el interruptor principal de "CFDI Emitidos (Ingresos)".
  4. Haz clic en el botón "Crear Rol" en la parte inferior.
  5. **Lo que debe pasar:** 
     - El botón debe bloquearse mostrando un círculo de carga.
     - La ventana se cerrará sola y verás un mensaje verde de "Rol creado correctamente".
     - En tu pantalla aparecerá una nueva tarjeta con el nombre de tu rol y dirá "No" (en rojo) en la fila de Emisión.

### Prueba 2: Editar un Rol de Sistema (Permisos Granulares)
- **¿Qué vamos a probar?:** Que podamos hacer micro-ajustes a los roles que ya vienen de fábrica.
- **Pasos:**
  1. Busca la tarjeta del rol "Visualizador" (es un rol de sistema).
  2. Haz clic en el botón **"Configurar Permisos"** de esa tarjeta.
  3. En la ventana, notarás que no puedes cambiarle el nombre (es un rol protegido).
  4. Ve a la sección de "CFDI Recibidos (Egresos)".
  5. Asegúrate de que el interruptor principal esté encendido, y luego *apaga* el pequeño interruptor secundario que dice "Auditoría fiscal y detección de riesgos".
  6. Haz clic en "Actualizar Rol".
  7. **Lo que debe pasar:**
     - El sistema muestra el mensaje verde de "Rol actualizado correctamente".
     - Los cambios deben guardarse sin marcar ningún error.

### Prueba 3: Eliminar un Rol Personalizado
- **¿Qué vamos a probar?:** Que podamos borrar un rol que ya no sirve, y que el sistema nos pida confirmación antes de hacerlo.
- **Pasos:**
  1. Busca la tarjeta del rol que creaste en la Prueba 1 ("Auditor Jr.").
  2. Haz clic en el botón **"Eliminar"** (con el ícono de basurero).
  3. El sistema te lanzará una ventana o alerta preguntando: *"¿Está seguro que desea eliminar este rol?"*.
  4. Haz clic en "Aceptar" o "Eliminar" en la alerta.
  5. **Lo que debe pasar:**
     - Aparecerá un mensaje verde diciendo "Rol eliminado correctamente".
     - La tarjeta del rol "Auditor Jr." debe desaparecer de la pantalla.

### Prueba 4: Seguridad y Bloqueo Anti-Intrusos
- **¿Qué vamos a probar?:** Que un empleado normal no pueda entrar a crear o modificar roles.
- **Pasos:**
  1. Cierra tu sesión de administrador.
  2. Inicia sesión con una cuenta de Usuario Normal (Visualizador).
  3. Intenta entrar a la ruta de "Roles y Permisos".
  4. **Lo que debe pasar:**
     - El sistema no debe mostrarte ninguna tarjeta ni botón.
     - Debe bloquearte inmediatamente mostrando una pantalla de "Acceso Denegado".
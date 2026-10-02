# Guía de Pruebas: Perfiles y Roles (`/admin/profiles`)

## 1. Objetivo
Asegurar que la pantalla de asignación de roles funcione perfectamente. Debemos comprobar que un administrador pueda cambiar el rol general de un empleado, administrar a qué empresas específicas tiene acceso y asegurar que el sistema bloquee a cualquier usuario que intente entrar sin permisos.

## 2. Lo que necesitas antes de empezar
- Estar conectado con una cuenta de **Administrador**.
- Entrar a la sección de "Perfiles y Roles" dentro del menú de Administración.

## 3. Casos de Prueba (Paso a Paso)

### Prueba 1: Cambiar el Rol General de un Usuario
- **¿Qué vamos a probar?:** Que podamos subir o bajar el nivel de autoridad de una persona dentro de toda la plataforma.
- **Pasos:**
  1. En la lista de usuarios, busca a cualquier persona.
  2. Haz clic en el menú desplegable que está a la derecha de su nombre (el que dice "Seleccionar rol").
  3. Elige un rol diferente al que ya tiene (por ejemplo, cambiar de "Usuario" a "Administrador").
  4. **Lo que debe pasar:** 
     - El menú debe bloquearse por un segundo (para evitar doble clic).
     - El sistema debe mostrar un mensaje verde diciendo "Rol actualizado".
     - La pequeña etiqueta junto al nombre del usuario debe cambiar inmediatamente al nuevo rol que elegiste.

### Prueba 2: Administrar Accesos por Empresa (Micro-Gestión)
- **¿Qué vamos a probar?:** Que podamos decidir exactamente a qué empresas puede entrar una persona y qué puede hacer adentro de ellas.
- **Pasos:**
  1. En la misma lista de usuarios, busca a una persona y haz clic en su botón que dice **"Empresas"** (tiene el ícono de un edificio).
  2. Al hacer clic, se debe abrir un panel en la parte inferior de la pantalla titulado "Empresas asignadas".
  3. En este nuevo panel inferior, busca cualquier empresa de la lista y cambia su acceso en el menú desplegable (por ejemplo, ponlo en "Auditor" o "Sin acceso").
  4. Haz clic en el botón "Actualizar" que está justo al lado de ese menú.
  5. **Lo que debe pasar:**
     - El botón se desactiva brevemente y aparece un mensaje verde de "Acceso actualizado".
     - Al revisar al usuario en la lista de arriba, debes ver que le aparece una nueva etiqueta pequeñita con el nombre de la empresa y el rol que le acabas de dar.

### Prueba 3: Cierre del Panel de Empresas
- **¿Qué vamos a probar?:** Que el panel de empresas no se quede trabado y se pueda cerrar limpiamente.
- **Pasos:**
  1. Con el panel de "Empresas asignadas" abierto en la parte de abajo, vuelve a subir a la lista de usuarios.
  2. Haz clic nuevamente en el botón "Empresas" del mismo usuario que tenías seleccionado.
  3. **Lo que debe pasar:**
     - El panel de abajo ("Empresas asignadas") debe desaparecer completamente de la pantalla, dejando todo limpio.

### Prueba 4: Seguridad y Privilegios (Blindaje Anti-Intrusos)
- **¿Qué vamos a probar?:** Que el sistema es seguro y no deja que un empleado normal entre a esta pantalla para darse permisos a sí mismo.
- **Pasos:**
  1. Cierra tu sesión de administrador.
  2. Inicia sesión con una cuenta de Usuario Normal.
  3. Intenta entrar a la ruta de "Perfiles y Roles".
  4. **Lo que debe pasar:**
     - El sistema no debe cargar la lista de personal.
     - Debe bloquearte inmediatamente y mostrar un candado grande con el mensaje de "Acceso Denegado".
# Instrucciones para Ejecutar las Pruebas de Roles y Permisos

Este documento te guiará paso a paso para ejecutar el "robot de pruebas" (script automatizado) que valida la "Fábrica de Perfiles" (`/admin/roles`). 

## ¿Qué hace este robot de pruebas?
El script simulará ser un administrador configurando la plataforma y realizará las siguientes validaciones:
1. Intentará crear un "Nuevo Rol" apagando una de las opciones principales y guardándolo.
2. Abrirá un rol predeterminado de fábrica (Visualizador) y le modificará un permiso "pequeño" (granular) para asegurarse de que los cambios finos funcionen.
3. Probará el botón de eliminar y validará que el sistema pregunte "¿Estás seguro?" antes de borrarlo.
4. Se "disfrazará" de un empleado normal sin permisos para comprobar que la pantalla esté protegida y le muestre "Acceso Denegado".

*Nota: Por seguridad, el robot utiliza un "simulador de base de datos" (Mock). Esto significa que **ningún rol real de tu sistema será modificado ni eliminado** durante esta prueba.*

## Pasos para ejecutar la prueba

1. **Abre tu consola de comandos (Terminal):**
   - En tu editor de código (VS Code o Cursor), ve al menú superior, haz clic en **"Terminal"** y luego en **"New Terminal"** (Nueva Terminal).
   - Verás que se abre un recuadro negro en la parte inferior.

2. **Copia y pega el siguiente comando:**
   Selecciona todo el texto de la siguiente línea, cópialo, pégalo en el recuadro negro y presiona la tecla **Enter (Intro)**:

   ```bash
   npm run test "Guias de Prueba/Dashboard de Administracion/Roles y Permisos/admin_roles.test.tsx"
   ```

3. **Interpreta los resultados:**
   - Si al final ves letras verdes que dicen **`PASS`**, significa que el módulo de creación de roles es seguro y funcional.
   - Si llegaras a ver letras rojas con la palabra **`FAIL`**, significaría que algún componente de seguridad se rompió y un desarrollador debe revisarlo.
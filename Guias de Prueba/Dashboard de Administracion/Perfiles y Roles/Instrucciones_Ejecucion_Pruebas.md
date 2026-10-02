# Instrucciones para Ejecutar las Pruebas de Perfiles y Roles

Este documento te guiará paso a paso para ejecutar el "robot de pruebas" (script automatizado) que valida la pantalla de Perfiles y Roles (`/admin/profiles`). 

## ¿Qué hace este robot de pruebas?
El script simulará ser un usuario navegando por la pantalla y realizará las siguientes acciones:
1. Intentará cambiarle el rol principal a un empleado (validando que aparezca el mensaje de éxito).
2. Abrirá el panel especial de "Empresas" de un usuario, le cambiará el nivel de acceso (por ejemplo, a "Auditor") y guardará el cambio.
3. Comprobará que los botones de abrir y cerrar menús funcionen de forma fluida.
4. Simulará ser un usuario normal (sin permisos de Administrador) para asegurar que el candado de seguridad lo bloquee correctamente.

*Nota: Para mantener la seguridad, el robot utiliza un "simulador de base de datos" (Mock). Esto significa que **ningún usuario real de tu sistema será modificado ni eliminado**.*

## Pasos para ejecutar la prueba

1. **Abre tu consola de comandos (Terminal):**
   - En tu editor de código (VS Code o Cursor), ve al menú superior, haz clic en **"Terminal"** y luego en **"New Terminal"** (Nueva Terminal).
   - Verás que se abre un recuadro negro en la parte inferior.

2. **Copia y pega el siguiente comando:**
   Selecciona todo el texto de la siguiente línea, cópialo, pégalo en el recuadro negro y presiona la tecla **Enter (Intro)**:

   ```bash
   npm run test "Guias de Prueba/Dashboard de Administracion/Perfiles y Roles/admin_profiles.test.tsx"
   ```

3. **Interpreta los resultados:**
   - Si al final ves letras verdes que dicen **`PASS`**, significa que la pantalla de Perfiles y Roles es completamente segura y todos los botones funcionan a la perfección.
   - Si llegaras a ver letras rojas con la palabra **`FAIL`**, significaría que algún componente de seguridad se rompió y un desarrollador debe revisarlo.
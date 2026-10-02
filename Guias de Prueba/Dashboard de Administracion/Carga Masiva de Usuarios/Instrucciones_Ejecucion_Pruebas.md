# Instrucciones para Ejecutar las Pruebas de Carga Masiva

Este documento te guiará paso a paso para ejecutar el "robot de pruebas" (script) que valida la pantalla de Alta Masiva de Usuarios. No necesitas tener conocimientos de programación para hacerlo.

## ¿Qué significa "Evitar Simular" en este contexto?
Para hacer esta prueba lo más real posible, el script **crea archivos reales** (`.txt` y `.jpg`) dentro de la memoria de tu computadora durante la prueba. De esta forma, valida que la pantalla reaccione exactamente igual que si tú los hubieras arrastrado con el ratón. 
*(Nota: Lo único que sí mantenemos protegido es el botón de "Enviar al Servidor", para evitar que el sistema envíe cientos de correos de invitación reales o guarde basura en tu base de datos de producción).*

## Pasos para ejecutar la prueba

1. **Abre tu consola de comandos (Terminal):**
   - En tu editor de código (VS Code o Cursor), ve al menú superior, haz clic en **"Terminal"** y luego en **"New Terminal"** (Nueva Terminal).
   - Verás que se abre un recuadro negro en la parte de abajo.

2. **Copia y pega el siguiente comando:**
   Selecciona todo el texto de la siguiente línea, cópialo, pégalo en el recuadro negro y presiona la tecla **Enter (Intro)**:

   ```bash
   npm run test "Guias de Prueba/Dashboard de Administracion/Carga Masiva de Usuarios/admin_users_bulk.test.tsx"
   ```

3. **Espera unos segundos:**
   - Verás que empiezan a aparecer letras en la pantalla. El robot está abriendo la pantalla de carga masiva y subiendo los archivos de prueba por ti a toda velocidad.

4. **¿Cómo saber si todo salió bien?**
   - Si al final ves letras verdes que dicen **`PASS`**, significa que la pantalla de Carga Masiva es completamente segura, bloquea los errores y funciona perfectamente.
   - Si llegaras a ver letras rojas con la palabra **`FAIL`**, significaría que alguien modificó el sistema y rompió alguna de las reglas de seguridad.

¡Y eso es todo! Has ejecutado una prueba técnica avanzada de forma muy sencilla.
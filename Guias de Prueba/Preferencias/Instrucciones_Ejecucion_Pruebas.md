# Instrucciones para Ejecutar Pruebas: Módulo de Preferencias

Este documento explica de forma sencilla cómo ejecutar el script de pruebas automatizadas para el módulo de Preferencias. No es necesario tener conocimientos avanzados de programación, solo seguir estos pasos.

---

### ¿Qué hace este script?
El script es un "robot" que abre el sistema en segundo plano y simula ser un usuario real. Revisa automáticamente que:
1. La pantalla cargue correctamente.
2. Los botones de Modo Oscuro y Modo Claro funcionen.
3. Se pueda escribir correctamente el Idioma, Moneda y Zona Horaria.
4. Se pueda establecer el tiempo límite de sesión.
5. El botón de guardar envíe la información y muestre la notificación verde de éxito.

### Pasos para ejecutar la prueba

**Paso 1: Abrir la consola de comandos (Terminal)**
- Si estás en **VS Code** (el editor de código), ve al menú superior, selecciona **Terminal** y luego haz clic en **New Terminal** (Nueva Terminal).

**Paso 2: Escribir el comando de ejecución**
- En la ventana negra que se acaba de abrir (la terminal), copia y pega el siguiente texto exactamente como está:

```bash
npx jest "Guias de Prueba/Preferencias/preferencias.test.tsx"
```

- Luego, presiona la tecla **Enter** (Intro) en tu teclado.

**Paso 3: Leer los resultados**
- El robot comenzará a trabajar. Verás que la pantalla empieza a mostrar letras blancas o verdes. Esto tomará menos de 5 segundos.
- Si todo funciona correctamente, verás mensajes con la palabra **PASS** (en verde), indicando que todos los escenarios de prueba pasaron exitosamente.
- Si ves algún mensaje con la palabra **FAIL** (en rojo), significa que el robot detectó un problema en el sistema que los programadores deben revisar.
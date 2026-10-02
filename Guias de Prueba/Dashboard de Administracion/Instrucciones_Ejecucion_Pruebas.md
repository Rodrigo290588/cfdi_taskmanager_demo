# ¿Cómo ejecutar las pruebas automatizadas del Panel de Administración?

Este documento te guiará paso a paso para que puedas correr el robot de pruebas (script) que valida el Panel de Administración de forma automática. No necesitas conocimientos técnicos avanzados, solo seguir estas instrucciones.

## 1. Preparación
1. Abre tu programa de código (como Visual Studio Code).
2. Asegúrate de tener abierta la carpeta principal del proyecto (`cfdi_taskmanager_demo`).
3. Abre una **Terminal** o **Consola** nueva (puedes hacerlo en el menú superior: `Terminal` -> `New Terminal`).

## 2. Ejecutar la Prueba
Copia el siguiente comando, pégalo en tu terminal y presiona la tecla **Enter**:

```bash
npx jest "Guias de Prueba/Dashboard de Administracion/admin_dashboard.test.tsx"
```

El sistema empezará a descargar un entorno virtual (esto toma unos segundos) y verás cómo el robot simula a un usuario navegando por el sistema.

## 3. ¿Cómo leer los resultados?
Una vez que el robot termine (generalmente en menos de 5 segundos), te mostrará un resumen en pantalla:

- Si todo está correcto, verás la palabra **`PASS`** en letras verdes junto a cada uno de los 5 Casos de Prueba (Ej: *CP01: Bloquea a usuarios sin privilegios y permite a administradores*).
- Si algo llegara a fallar porque el sistema cambió, verás la palabra **`FAIL`** en letras rojas y un pequeño texto indicando qué prueba exacta no funcionó.

## ¿Qué hace exactamente este script?
Para que estés tranquilo, este script:
- No borra ni modifica ninguna empresa real.
- No envía correos electrónicos.
- Simula una red interna y cuentas falsas de "Administrador" y "Usuario Normal" para probar que la seguridad y la privacidad de los datos (ocultamiento de correos) funcionen tal como lo estipulamos en el checklist.

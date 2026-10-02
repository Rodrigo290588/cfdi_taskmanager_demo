# ¿Cómo ejecutar las pruebas automatizadas de Gestión de Usuarios?

Este instructivo te mostrará paso a paso cómo correr el robot de pruebas (script) que valida la sección de "Usuarios". No necesitas saber de programación, solo seguir estos pasos simples.

## 1. Preparación
1. Abre tu programa de edición (como Visual Studio Code).
2. Asegúrate de tener abierta la carpeta principal del proyecto (`cfdi_taskmanager_demo`).
3. Abre una **Terminal** o **Consola** nueva (menú superior: `Terminal` -> `New Terminal`).

## 2. Ejecutar la Prueba
Copia el siguiente comando, pégalo en tu terminal y presiona la tecla **Enter**:

```bash
npx jest "Guias de Prueba/Dashboard de Administracion/Gestion de Usuarios/admin_users.test.tsx"
```

El robot empezará a simular de forma invisible los clics en los botones de "Eliminar", "Editar" y los "Interruptores" de estado.

## 3. ¿Cómo leer los resultados?
En un par de segundos, el sistema te mostrará un pequeño reporte en pantalla:

- Si ves la palabra **`PASS`** en color verde junto a los 5 Casos de Prueba (Ej: *CP03: Abre modal de edición y permite guardar cambios*), significa que el sistema funciona a la perfección.
- Si ves la palabra **`FAIL`** en color rojo, significa que algo en el diseño de la página cambió y el robot no pudo completar la acción (por ejemplo, si alguien le cambió el nombre al botón de guardar).

## Nota de Tranquilidad
Este script de prueba utiliza "Mocks" (dobles de acción). Esto significa que **NO borra usuarios reales** y **NO modifica permisos de verdad**. Simplemente hace creer a la página que está conectada para validar que todos los botones y ventanas respondan como deben.

# Instrucciones Simples para Ejecutar las Pruebas Automatizadas

Este documento te guiará paso a paso para que puedas correr el "robot" (script automatizado) que verifica que el módulo de **Empresas** esté funcionando correctamente. 

No necesitas ser un experto en programación para hacerlo, solo sigue estos sencillos pasos:

## Paso 1: Abrir la consola de comandos (Terminal)
Necesitamos un lugar donde darle la instrucción a la computadora. 
1. Si estás usando el editor de código (como Visual Studio Code o Trae), ve al menú superior, busca la opción **"Terminal"** y haz clic en **"Nueva Terminal"**.
2. Se abrirá un cuadro de texto en la parte inferior de tu pantalla donde puedes escribir.

## Paso 2: Escribir la instrucción
En ese cuadro de texto, asegúrate de estar en la carpeta principal del proyecto (usualmente ya estás ahí por defecto).
Copia y pega exactamente el siguiente texto y luego presiona la tecla **Enter**:

```bash
npx jest "Guias de Prueba/Empresas/empresas.test.tsx"
```

## Paso 3: ¿Qué va a pasar?
Al presionar Enter, verás que la computadora empieza a trabajar. El "robot" abrirá las pantallas de forma invisible y hará clics a una velocidad muy rápida. Esto tomará solo un par de segundos.

Al terminar, te mostrará un resumen en la pantalla:
*   **Si ves letras verdes con la palabra `PASS` (Pasó):** ¡Felicidades! Significa que todas las pruebas pasaron con éxito y el sistema funciona exactamente como lo dice nuestro Checklist.
*   **Si ves letras rojas con la palabra `FAIL` (Falló):** Significa que el robot encontró un error. Te indicará exactamente en qué prueba falló para que el equipo de sistemas pueda revisarlo.

## Paso 4: Revisar el reporte guardado
Para que no tengas que memorizar lo que salió en la pantalla, el sistema ya tiene guardado un reporte tipo Excel (CSV) con el resultado de la última vez que corrimos las pruebas con éxito. 

Puedes encontrar este reporte en la misma carpeta, con el nombre:
`Evidencia_Resultados_Jest_2026-09-30.csv`

¡Y listo! Con esto puedes verificar en cualquier momento que el sistema siga funcionando perfectamente.
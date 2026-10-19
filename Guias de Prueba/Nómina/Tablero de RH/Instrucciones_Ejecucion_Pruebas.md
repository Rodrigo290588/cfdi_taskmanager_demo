# 🚀 Instrucciones para Ejecutar Pruebas Automatizadas

Si desea que la computadora revise automáticamente que el Tablero de RH funciona de manera correcta, siga estos sencillos pasos:

## Pasos para ejecutar

1. Abra una ventana de consola (Terminal).
2. Ejecute el siguiente comando y presione **Enter**:
   ```bash
   node ejecutar_pruebas.js
   ```
3. El sistema mostrará un menú numerado (Gestor de Pruebas Automatizadas).
4. Busque la opción correspondiente a **Tablero de RH** (por ejemplo, `tablero_rh.test.tsx`), escriba ese número y presione **Enter**.
5. Espere a que el proceso termine automáticamente.

## Resultados
Se generará un archivo Excel (formato CSV) en la carpeta principal de `Guias de Prueba`, con un nombre como `Evidencia_Resultados_tablero_rh_2026-10-08.csv`.

Puede abrir este documento para revisar las validaciones y confirmar que todos los puntos evaluados tengan el estado de EXITOSO.

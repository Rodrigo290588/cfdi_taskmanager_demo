# 🚀 Instrucciones para Ejecutar Pruebas Automatizadas

Si desea que la computadora revise automáticamente que todo el tablero de Nómina Fiscal funciona correctamente, puede seguir estos sencillos pasos. No necesita conocimientos técnicos de programación.

## Pasos para ejecutar

1. Abra una ventana de consola (Terminal) en el sistema.
2. Escriba el siguiente comando y presione la tecla **Enter**:
   ```bash
   node ejecutar_pruebas.js
   ```
3. Aparecerá un menú en pantalla (Gestor de Pruebas Automatizadas) preguntándole qué módulo desea probar.
4. Escriba el número correspondiente a **Nómina Fiscal** y presione **Enter**.
5. Espere unos segundos mientras el sistema hace las validaciones de manera automática.

## Resultados
Al finalizar, el sistema creará un archivo de Excel (formato CSV) en la carpeta `Guias de Prueba`. Este archivo se llamará algo similar a `Evidencia_Resultados_nomina_fiscal_2026-10-08.csv`.

Puede abrir este archivo para ver el reporte final, donde se indicará qué pruebas pasaron como EXITOSAS y cuáles fueron FALLIDAS.

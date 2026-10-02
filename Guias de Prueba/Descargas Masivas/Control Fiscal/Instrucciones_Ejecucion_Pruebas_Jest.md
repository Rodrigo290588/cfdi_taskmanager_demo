# Instrucciones de Ejecución de Pruebas: Control Fiscal

Este documento detalla los pasos para ejecutar la suite de pruebas automatizadas (Jest) para el submódulo de **Control Fiscal** (Dashboard analítico).

## Requisitos Previos
1. Node.js (v18 o superior).
2. Dependencias instaladas (`npm install`).
3. El entorno virtual de pruebas (JSDOM) configurado en el proyecto.

## Ejecución de Pruebas

Para correr el script automatizado, abre una terminal en la raíz del proyecto y ejecuta el siguiente comando:

```bash
npx jest "Guias de Prueba/Descargas Masivas/Control Fiscal/control_fiscal.test.tsx"
```

## Casos Evaluados
El script valida 4 escenarios principales de integración compleja:
1. **Renderizado Sin Empresa:** Verifica que los componentes analíticos permanezcan ocultos y se muestre la advertencia de requerir una empresa activa.
2. **Carga Inicial, KPIs y Alerta de Discrepancia:** Asegura que los indicadores numéricos se formanteen adecuadamente y, crucialmente, que la alerta de brecha dispare los bordes y el Badge rojo cuando `discrepancyAlert` es `true`.
3. **Autocompletado de RFCs:** Valida que el input reaccione a la escritura generando botones dinámicos en un panel flotante, autocompletando la barra de búsqueda al hacer clic.
4. **Interacción del Data Grid y Sumatorias:** Prueba la abstracción de datos en bruto del XML usando expresiones regulares (Regex) y valida el renderizado dinámico. Manipula el menú de Columnas apagando y encendiendo métricas para comprobar que el Footer calcula las sumas matemáticas exclusivamente con base en las celdas visibles.

## Evidencias
Al terminar, Jest desplegará un reporte en la terminal (PASS/FAIL). Los resultados se encuentran registrados en el archivo `Evidencia_Resultados_Jest_2026-09-29.csv` en esta misma carpeta.
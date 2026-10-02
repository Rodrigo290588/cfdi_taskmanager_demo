# Instrucciones de Ejecución de Pruebas: Verificación de Solicitudes SAT

Este documento detalla los pasos para ejecutar la suite de pruebas automatizadas (Jest) para el submódulo de **Verificación** (Monitor técnico).

## Requisitos Previos
1. Node.js (v18 o superior).
2. Dependencias instaladas (`npm install`).
3. El entorno virtual de pruebas (JSDOM) configurado en el proyecto.

## Ejecución de Pruebas

Para correr el script automatizado, abre una terminal en la raíz del proyecto y ejecuta el siguiente comando:

```bash
npx jest "Guias de Prueba/Descargas Masivas/Verificacion/verificacion.test.tsx"
```

## Casos Evaluados
El script valida 4 escenarios principales:
1. **Renderizado Sin Empresa:** Verifica que los filtros y la tabla permanezcan ocultos, mostrando la advertencia de requerir una empresa seleccionada.
2. **Carga Inicial y Filtrado de Peticiones sin ID:** Asegura que solo se dibujen las peticiones que ya cuenten con `satPackageId`, descartando aquellas en etapa prematura (como `SOLICITADO`). Valida el renderizado correcto de métricas como Intentos y el formato "N Paquetes".
3. **Filtro de Estatus de Usuario:** Simula el cambio en el menú desplegable para filtrar por "ERROR" o "VENCIDO" y verifica que el contenido de la tabla reaccione instantáneamente o muestre un estado vacío.
4. **Manejo de Errores de API:** Simula un error interno del servidor para comprobar que se notifica visualmente mediante un Toast de alerta.

## Evidencias
Al terminar, Jest desplegará un reporte en la terminal (PASS/FAIL). Los resultados se encuentran registrados en el archivo `Evidencia_Resultados_Jest_2026-09-29.csv` en esta misma carpeta.
# Instrucciones de Ejecución de Pruebas: Descarga de Paquetes

Este documento detalla los pasos para ejecutar la suite de pruebas automatizadas (Jest) para el submódulo de **Descarga de Paquetes**.

## Requisitos Previos
1. Node.js (v18 o superior).
2. Dependencias instaladas (`npm install`).
3. El entorno virtual de pruebas (JSDOM) configurado en el proyecto.

## Ejecución de Pruebas

Para correr el script automatizado, abre una terminal en la raíz del proyecto y ejecuta el siguiente comando:

```bash
npx jest "Guias de Prueba/Descargas Masivas/Descarga Paquetes/descarga_paquetes.test.tsx"
```

## Casos Evaluados
El script valida 3 escenarios principales:
1. **Renderizado Sin Empresa:** Verifica que si no hay empresa activa, la tabla y los KPIs se oculten, y se muestre un mensaje pidiendo seleccionar una empresa.
2. **Carga Inicial, KPIs y Tabla con Empresa Activa:** Verifica la visualización de datos devueltos por el backend, incluyendo el cálculo correcto de las métricas (CFDI vs Metadata) y el renderizado de los botones condicionales.
3. **Interacción con Panel Lateral (Drawer) y Descarga de ZIP:** Comprueba la apertura del panel, la visibilidad de los paquetes ZIP devueltos por el SAT, y simula la acción de descarga, asegurando que se construya el elemento `<a>` con la URL correcta y se disparen las notificaciones (Toast).

## Evidencias
Al terminar, Jest desplegará un reporte en la terminal (PASS/FAIL). Los resultados se encuentran registrados en el archivo `Evidencia_Resultados_Jest_2026-09-29.csv` en esta misma carpeta.
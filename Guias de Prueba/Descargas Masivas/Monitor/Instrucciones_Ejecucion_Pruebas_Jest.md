# Instrucciones de Ejecución de Pruebas: Monitor de Solicitudes

Este documento detalla los pasos para ejecutar la suite de pruebas automatizadas (Jest) para el submódulo de **Monitor de Solicitudes**.

## Requisitos Previos
1. Node.js (v18 o superior).
2. Dependencias instaladas (`npm install`).
3. El entorno virtual de pruebas (JSDOM) configurado en el proyecto.

## Ejecución de Pruebas

Para correr el script automatizado, abre una terminal en la raíz del proyecto y ejecuta el siguiente comando:

```bash
npx jest "Guias de Prueba/Descargas Masivas/Monitor/monitor_descargas.test.tsx"
```

## Casos Evaluados
El script valida 4 escenarios principales:
1. **Renderizado Sin Empresa:** Verifica que si no hay empresa activa, se muestran mensajes de advertencia y los controles se bloquean.
2. **Carga Inicial y Renderizado de Badges:** Almacena una empresa activa y simula la respuesta de la API, validando la visualización correcta de columnas (Fechas vs Folio) y etiquetas (Verde para completado, Rojo para error).
3. **Ejecución de Filtros y Botón Buscar:** Simula la escritura de un UUID en los filtros y la acción de buscar, garantizando que los parámetros se envían correctamente al backend.
4. **Manejo de Errores de API:** Simula una respuesta no exitosa del servidor y valida que se muestra un Toast rojo de error.

## Evidencias
Al terminar, Jest desplegará un reporte en la terminal (PASS/FAIL). Los resultados se encuentran registrados en el archivo `Evidencia_Resultados_Jest_2026-09-29.csv` en esta misma carpeta.
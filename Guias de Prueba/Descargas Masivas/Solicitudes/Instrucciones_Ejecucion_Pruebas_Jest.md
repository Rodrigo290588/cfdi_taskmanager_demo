# Instrucciones de Ejecución de Pruebas: Solicitudes de Descargas Masivas

Este documento detalla los pasos para ejecutar la suite de pruebas automatizadas (Jest) para el submódulo de **Solicitudes de Descargas Masivas**.

## Requisitos Previos
1. Node.js (v18 o superior).
2. Dependencias del proyecto instaladas (`npm install`).
3. El entorno virtual de pruebas (JSDOM) y las configuraciones de Jest (SWC) deben estar activos, los cuales ya se encuentran configurados en la raíz del proyecto.

## Ejecución de Pruebas

Para correr el script automatizado, abre una terminal en la raíz del proyecto y ejecuta el siguiente comando:

```bash
npx jest "Guias de Prueba/Descargas Masivas/Solicitudes/solicitudes_descargas.test.tsx"
```

## Casos Evaluados en la Suite
El script valida 5 escenarios principales que garantizan el correcto funcionamiento del formulario dinámico y las reglas de validación:
1. **Renderizado y Dinamismo de UI:** Verifica el comportamiento visual (ocultar/mostrar campos) al cambiar el tipo de solicitud.
2. **Escenario de Error - Fechas:** Comprueba la obligatoriedad y validación (mínimo año 2011) en el rango de fechas.
3. **Escenario de Error - UUID:** Comprueba la estructura estricta (formato y longitud) al ingresar un Folio.
4. **Escenario de Error - Rechazo del Backend:** Simula una respuesta fallida del SAT y verifica que se notifique al usuario (UI Toast de error).
5. **Escenario de Éxito - Happy Path:** Simula una solicitud aceptada y comprueba la confirmación de IDs recibidos en un Toast verde.

## Resultados y Evidencias
Al terminar, Jest desplegará un reporte en la terminal (PASS/FAIL).
Los resultados formales de estas pruebas han sido registrados y se adjuntan en el archivo `Evidencia_Resultados_Jest_2026-09-29.csv` que se encuentra en la misma carpeta.
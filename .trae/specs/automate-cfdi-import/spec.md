# Automate CFDI Import Spec

## Why
Actualmente, la importación de archivos XML (CFDI) descargados del SAT requiere un paso manual: el usuario debe descargar el archivo `.zip` resultante desde `/mass-downloads/package-downloads` y luego subirlo a través del módulo de carga (`/dashboard_fiscal/upload`). Este proceso es ineficiente y propenso a errores humanos, especialmente cuando se trata de volúmenes masivos de datos (Ingresos, Egresos y Nómina). Se requiere automatizar este flujo para que, al concluir la descarga del SAT, el sistema procese e importe los CFDI en segundo plano.

## What Changes
- Se automatizará la extracción e importación de CFDI directamente después de una descarga exitosa del SAT.
- Se implementará un procesamiento en segundo plano (vía BullMQ) para evitar bloqueos en el hilo principal de Node.js.
- Se explorará una arquitectura basada en Node.js (usando `unzipper` y procesamiento en stream) para mantener la homogeneidad del stack, reemplazando la necesidad del cliente Java (`cfdi-ingest.jar`), lo cual facilitará el mantenimiento, pero delegando la carga a workers asíncronos.
- **Fase 1 (Ingresos y Egresos):** Integración de la lógica de clasificación y guardado de facturas en la tabla `Invoice` y `ProviderUploadedCfdi`.
- **Fase 2 (Nómina):** Extracción detallada de recibos de nómina y automatización del refresco de vistas materializadas.
- **Fase 3 (UI):** Reflejo del progreso de importación en el monitor `/mass-downloads/package-downloads`.

## Impact
- Affected specs: Flujo de descargas masivas y procesamiento de CFDI.
- Affected code:
  - `src/workers/download.worker.ts`
  - `src/app/api/mass-downloads/package-downloads/route.ts`
  - `src/app/mass-downloads/package-downloads/page.tsx`
  - Servicios de importación y extracción de XML.

## ADDED Requirements
### Requirement: Importación Automática de CFDI
El sistema SHALL iniciar automáticamente el procesamiento de los XML contenidos en el archivo ZIP tan pronto como la descarga del SAT sea completada exitosamente.

#### Scenario: Success case
- **WHEN** el worker de descargas finaliza la obtención de un paquete tipo CFDI.
- **THEN** el sistema encola un trabajo de importación asíncrono, extrae los XML, clasifica los documentos (Ingreso, Egreso, Nómina), los guarda en la base de datos y actualiza el estado de la solicitud en la UI.
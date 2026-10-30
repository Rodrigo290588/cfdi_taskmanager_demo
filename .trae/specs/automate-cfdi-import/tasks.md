# Tasks

- [x] Task 1: Fase 1 - Arquitectura de Worker y CFDI de Ingresos/Egresos
  - [x] SubTask 1.1: Crear/Configurar una cola de BullMQ (`cfdi-import-queue`) dedicada a procesar ZIPs pesados de manera asíncrona.
  - [x] SubTask 1.2: Modificar `src/workers/download.worker.ts` para que, cuando se descargue un paquete de tipo `cfdi`, en lugar de solo guardarlo, inserte un trabajo en la cola de importación.
  - [x] SubTask 1.3: Desarrollar el procesador del worker utilizando streams (`unzipper`) y la lógica existente de `_createInvoiceFromXml` (adaptada para streams y ejecución en segundo plano) para procesar CFDIs de Ingresos y Egresos sin agotar la memoria.

- [x] Task 2: Fase 2 - Automatización de CFDI de Nómina
  - [x] SubTask 2.1: Integrar en el worker de importación la lógica especializada para extraer complementos de nómina (`PayrollReceipt`).
  - [x] SubTask 2.2: Al finalizar el procesamiento de un lote que contenga nómina, automatizar el disparo de las funciones de actualización de vistas materializadas (`refreshHrMaterializedViews` y `refreshDireccionMaterializedViews`).

- [x] Task 3: Fase 3 - Actualización de UI y Monitoreo
  - [x] SubTask 3.1: Actualizar el modelo de datos (si es necesario) o utilizar un campo existente para rastrear el progreso de la *importación* de los CFDI, no solo de la descarga.
  - [x] SubTask 3.2: Modificar la UI en `/mass-downloads/package-downloads` para mostrar el estado real de la importación (ej. "Procesando XMLs...", "Importado exitosamente") al usuario final.
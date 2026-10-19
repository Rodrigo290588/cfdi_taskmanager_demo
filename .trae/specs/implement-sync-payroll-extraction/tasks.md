# Tasks
- [x] Task 1: Crear función de parsing para el Complemento de Nómina.
  - [x] SubTask 1.1: Implementar lógica de extracción (ej. `parsePayrollFromXml`) en `src/lib/invoice-import.ts` (o en un archivo separado como `src/lib/payroll-import.ts` si es muy extensa) para extraer atributos de `<nomina12:Nomina>`, `<nomina12:Receptor>`, `<nomina12:Percepciones>`, y `<nomina12:Deducciones>`.
- [x] Task 2: Integrar el parsing síncrono en el flujo de importación de facturas.
  - [x] SubTask 2.1: Modificar `createInvoiceFromXml` en `src/lib/invoice-import.ts`.
  - [x] SubTask 2.2: Añadir la condición para ejecutar el parser de nómina si el comprobante es de tipo Nómina (`cfdiType === 'N'`).
  - [x] SubTask 2.3: Incluir la creación de `PayrollReceipt` y sus relaciones en la misma transacción de Prisma donde se crea la factura general (`tx.payrollReceipt.create`).
- [x] Task 3: Actualizar vistas materializadas.
  - [x] SubTask 3.1: Al finalizar la transacción de creación, ejecutar de manera segura `prisma.$executeRawUnsafe('SELECT refresh_hr_materialized_views(true);')` para que el Tablero de RH lea los nuevos datos insertados.

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
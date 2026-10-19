# Implement Sync Payroll Extraction Spec

## Why
Actualmente, el proceso de importación de facturas (vía `cfdi-ingest-1.0-SNAPSHOT.jar` o webservice) extrae correctamente la información general de los CFDI, pero ignora los detalles específicos del complemento de Nómina 1.2 (`<nomina12:Nomina>`). Esto causa que las facturas se guarden en la tabla `Invoice`, pero no se alimenten las tablas analíticas (`PayrollReceipt`, `PayrollReceptor`, etc.), dejando vacíos los tableros de Recursos Humanos que dependen de vistas materializadas.

## What Changes
- Implementar la extracción síncrona de datos de nómina durante el proceso de importación de XML.
- Modificar el flujo en `createInvoiceFromXml` para detectar si el CFDI es de tipo 'N' (Nómina).
- Parsear los nodos y atributos de `<nomina12:Nomina>` y guardarlos en `PayrollReceipt` y tablas relacionadas dentro de la misma transacción de base de datos.
- Invocar la función de actualización de vistas materializadas (`refresh_hr_materialized_views`) tras la importación exitosa de nóminas, asegurando que los tableros de RH reflejen los datos en tiempo real.

## Impact
- Affected specs: Importación de CFDI, Tablero RH.
- Affected code: 
  - `src/lib/invoice-import.ts` (principalmente `createInvoiceFromXml` y un nuevo parser de nómina).
  - Posible adición de una función helper `parsePayrollFromXml`.

## ADDED Requirements
### Requirement: Síncrona Extracción de Nómina
El sistema DEBE extraer e insertar los datos del complemento de Nómina en la tabla `PayrollReceipt` (y sus tablas hijas) en la misma transacción donde se crea la `Invoice` general, siempre y cuando el CFDI sea de tipo 'N'.

#### Scenario: Success case
- **WHEN** el webservice recibe un XML con `TipoDeComprobante="N"`.
- **THEN** se crea el registro en `Invoice`.
- **AND THEN** se crea el registro estructurado en `PayrollReceipt`, `PayrollReceptor`, `PayrollPercepcion`, `PayrollDeduccion`, etc.
- **AND THEN** se actualizan las vistas materializadas de RH.
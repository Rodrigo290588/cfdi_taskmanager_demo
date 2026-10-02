# Reporte Workpaper de Nómina Spec

## Why
El usuario requiere un reporte detallado (Workpaper) exclusivamente para los CFDI de tipo Nómina, accesible desde el menú lateral bajo la sección "Nómina". Este reporte debe mantener la robustez, funcionalidades de exportación, paginación y filtros dinámicos del reporte actual de ingresos (`/dashboard_fiscal/workpaper`), pero enfocado a los metadatos y complementos de nómina.

## What Changes
- Se agregará un nuevo botón/enlace en el componente `sidebar.tsx` como hijo del grupo "Nómina".
- Se creará la página `/dashboard/nomina/workpaper/page.tsx` clonando y adaptando la estructura y UI de `/dashboard_fiscal/workpaper/page.tsx`.
- Se implementarán filtros de búsqueda específicos en la UI que permitan filtrar por: **Fecha de Timbrado**, **Fecha de Pago**, **Departamento** y **Tipo de Nómina**.
- Se modificarán las columnas por defecto (`columnDefs`) para mostrar datos específicos del complemento `<nomina12:Nomina>` (ej. `NumEmpleado`, `RegistroPatronal`, `FechaPago`, `TotalPercepciones`, `TotalDeducciones`). Adicionalmente, el panel de configuración de columnas permitirá al usuario agregar o quitar dinámicamente cualquier campo que corresponda al complemento de nómina.
- Se ajustará la llamada a la API subyacente para forzar el filtrado exclusivo por tipo de comprobante Nómina (`cfdiType=NOMINA`).
- Se evaluará el endpoint de datos (ej. `/api/dashboard_fiscal/invoices` vs uno propio) para incluir validaciones de permisos (`NOMINA_VIEW_SALARIES`) y ocultar datos sensibles según el rol del usuario.

## Impact
- Affected specs: Tablero de Nómina, Permisos de visualización de salarios.
- Affected code: 
  - `src/components/layout/sidebar.tsx`
  - Nueva ruta: `src/app/dashboard/nomina/workpaper/page.tsx`

## ADDED Requirements
### Requirement: Reporte Workpaper de Nómina
El sistema SHALL proveer una tabla avanzada (Workpaper) para listar exclusivamente los CFDI de nómina, permitiendo personalizar columnas, aplicar filtros dinámicos, exportar a CSV/Excel y descargar XML/PDFs masivamente en un archivo ZIP.

### Requirement: Escalabilidad y Rendimiento para Altos Volúmenes
El reporte SHALL estar optimizado para manejar más de 5 millones de CFDI históricos y un volumen incremental de más de 1.5 millones de CFDI por año, garantizando tiempos de respuesta aceptables (paginación del lado del servidor, índices apropiados y carga diferida/optimizada para la exportación y visualización).

### Requirement: Generación de PDF Especializado para Nómina (Propuesta)
El PDF generado a partir de este reporte SHALL ser una propuesta de diseño especializado que contenga toda la información detallada del complemento de nómina (percepciones, deducciones, incapacidades, horas extras, etc.), a diferencia de un formato de factura genérico.

#### Scenario: Success case
- **WHEN** el usuario navega a la sección de Nómina y hace clic en el nuevo botón "Reporte de Nómina"
- **THEN** se muestra una tabla similar al Workpaper Fiscal, pero pre-filtrada para mostrar sólo CFDI de tipo `N` (Nómina).
- **AND** las columnas disponibles incluyen metadatos clave del complemento de nómina extraídos del XML.
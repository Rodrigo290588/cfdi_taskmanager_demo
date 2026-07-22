# Changelog

Este archivo documenta los cambios versionados relevantes de la aplicacion.

## v1.9.0 - 2026-07-21

### Resumen
- Se libero la minima viable de escalabilidad de ingresos, proyecciones de complementos CFDI y REP especializado para emitidos y recibidos.
- Se migraron los modulos clave del dashboard fiscal para consumir materializaciones y se cerraron sus validaciones funcionales y cruces SQL vs UI.

### Cambios Tecnicos
- Se agregaron tablas, migraciones y backfills para `invoice_blobs`, `invoice_issued_daily_summary`, proyecciones de complementos y `invoice_payment_complement_details`.
- Se incorporo una capa reusable de proyeccion de complementos CFDI para `workpaper` emitidos y recibidos, con soporte inicial para Pagos, Nomina, Carta Porte y Comercio Exterior.
- Se migraron `dashboard_fiscal`, `ingresos-parciales`, `ingresos_pendientes` e `ingresos_cobrados` para consumir primero la tabla especializada REP, manteniendo compatibilidad transicional con fallback XML.
- Se materializaron `paymentNodeIndex`, `baseP` e `importeP` para evitar duplicidad por nodos `Pago` y mejorar calculos de cobranza e IVA.
- Se corrigieron regresiones funcionales en filtros de fecha del dashboard fiscal, filtros REP y exposicion de `paymentXml` en `ingresos-parciales`, normalizacion de UUIDs en `ingresos_pendientes` y copy de `workpaper` recibidos.
- Se ajustaron componentes compartidos y UI para reducir ruido tecnico en consola/red y mejorar consistencia visual de los modulos validados.

### Validacion Y Documentacion
- Se documentaron la arquitectura, backfills, SQL de validacion, plan de pruebas, checklist de liberacion y columnas dinamicas de `workpaper`.
- Se ejecuto la validacion funcional completa de `dashboard_fiscal`, `ingresos-parciales`, `ingresos_pendientes`, `ingresos_cobrados`, `workpaper` emitidos y `workpaper` recibidos.
- Se completo la validacion cruzada SQL vs UI confirmando que los montos CRP e IVA cobrado no se inflan al agrupar por `payment_invoice_uuid + payment_node_index`.

## v1.8.1 - 2026-07-18

### Resumen
- Se agrego el archivo de changelog versionado en la raiz del proyecto.
- Se formalizo en `AGENTS.md` la regla obligatoria de actualizar `CHANGELOG.md` antes de cada `git push`.

### Cambios Tecnicos
- Se creo `CHANGELOG.md` como registro central de versiones, fecha y resumen de entregas.
- Se actualizo el flujo de versionamiento en `AGENTS.md` para exigir la actualizacion previa del changelog antes de commit, tag y push.

## v1.8.0 - 2026-07-18

### Resumen
- Se estabilizo el proyecto en dependencias, runtime y lint para mejorar la instalacion y la experiencia de desarrollo.
- Se corrigieron errores de monitoreo, abortos de requests, branding inconsistente y warnings visuales del frontend.

### Cambios Tecnicos
- Se actualizaron dependencias clave y configuraciones de npm para resolver conflictos, vulnerabilidades y problemas de compatibilidad.
- Se cambio la integracion de generacion de PDF a `puppeteer-core` con deteccion de navegadores locales.
- Se alineo Prisma y se corrigieron errores de inicializacion del cliente.
- Se agrego `react-is` para corregir la integracion de `recharts`.
- Se corrigio el endpoint de `Import Monitor` para usar el esquema real de Prisma.
- Se limpiaron errores y warnings de ESLint relacionados con hooks, React Compiler, `setState` en efectos y patrones de carga inicial.
- Se mitigaron `ERR_ABORTED` funcionales en requests de sesion, tenant, perfil y accesos.
- Se corrigieron warnings de `next/image` en login y registro.
- Se ajusto el sidebar para que no cubra el contenido al cargar en viewport no desktop.
- Se homologo el branding visible a `CFDI Task Manager`.

### Documentacion
- Se agrego la guia `docs/arquitectura/trae-reinstalacion-correcciones.md` para reaplicar correcciones base en futuras instalaciones.


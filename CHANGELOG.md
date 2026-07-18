# Changelog

Este archivo documenta los cambios versionados relevantes de la aplicacion.

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


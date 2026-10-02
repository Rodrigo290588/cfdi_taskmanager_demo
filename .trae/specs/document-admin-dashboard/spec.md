# Explicación de Funcionalidad: Admin Dashboard Spec

## Why
El usuario ha solicitado una explicación detallada de la funcionalidad del módulo `/admin/dashboard` (Panel de Administración) para comprender sus capacidades, medidas de seguridad, métricas clave y comportamiento general dentro del sistema.

## What Changes
- Creación de una especificación detallada que documenta la funcionalidad del Panel de Administración.
- Desglose de componentes: Seguridad, Indicadores Principales (KPIs), Pestañas de Navegación y Manejo de Errores.

## Impact
- Affected specs: N/A (Especificación de documentación y análisis)
- Affected code: `src/app/admin/dashboard/page.tsx` (Análisis de lectura)

## ADDED Requirements
### Requirement: Documentar Funcionalidad del Admin Dashboard
El sistema (a través de esta especificación) detalla el comportamiento del módulo `/admin/dashboard`:

#### 1. Seguridad y Privacidad Estricta
- **Acceso Restringido:** El módulo bloquea a cualquier usuario que no tenga el rol o los permisos de Administrador, mostrando una pantalla de "Acceso Denegado".
- **Protección de Datos Personales (PII):** Los correos electrónicos en la bitácora de actividad se muestran ofuscados (ej. `us***@***.com`) para evitar fugas de información.

#### 2. Tarjetas de Indicadores Principales (KPIs)
- **Total de Empresas:** Muestra el universo total de empresas registradas y el porcentaje de aprobación.
- **Pendientes:** Número de empresas que requieren revisión por parte de un administrador.
- **Aprobadas:** Empresas autorizadas para operar.
- **Total de Usuarios:** Cantidad de personas registradas en la plataforma.

#### 3. Pestañas de Información Detallada
- **Pestaña Resumen:** Exhibe dos listas (Top 10) con las industrias más comunes y los estados de la república con mayor registro.
- **Pestaña Empresas:** Lista de registros recientes con un botón de "revisión" (ojo) que se bloquea inteligentemente si la empresa ya fue aprobada.
- **Pestaña Actividad:** Bitácora de auditoría que registra "quién hizo qué y cuándo" dentro de la organización.

#### 4. Manejo de Errores y Actualización
- **Refresco en Vivo:** Botón superior para recargar los datos sin refrescar toda la página.
- **Tolerancia a Fallos:** En caso de pérdida de conexión o caída del servidor, el sistema presenta un mensaje amigable con un botón de "Reintentar" en lugar de mostrar una pantalla en blanco o errores técnicos.

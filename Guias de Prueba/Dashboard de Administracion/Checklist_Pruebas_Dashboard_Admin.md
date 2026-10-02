# Checklist de Pruebas: Panel de Administración (Centro de Control)

Este documento es una lista de verificación detallada basada en la Guía de Pruebas del módulo `/admin/dashboard`. Está diseñado para que cualquier persona pueda marcar cada punto tras validar que el sistema se comporta como se espera.

---

## 1. Seguridad y Control de Acceso (Privacidad)
- [ ] **Acceso Denegado (Zero Trust):** Al ingresar con un usuario que **no** es Administrador (ej. visualizador) e intentar ir a `/admin/dashboard`, el sistema bloquea la vista de inmediato.
- [ ] **Mensaje de Bloqueo:** La pantalla muestra claramente el mensaje "Acceso Denegado" con un ícono de candado, sin exponer ninguna métrica o dato del negocio.
- [ ] **Acceso Exitoso:** Al ingresar con un usuario que **sí** tiene permiso de "Administrador de Dashboard", la pantalla carga correctamente y muestra el título "Panel de Administración".

## 2. Indicadores Clave (Tarjetas de Resumen)
- [ ] **Tarjeta "Total Empresas":** Aparece en la parte superior y muestra el número global de empresas junto con su porcentaje de aprobación.
- [ ] **Tarjeta "Pendientes":** Aparece y muestra la cantidad correcta de empresas que están en espera de revisión.
- [ ] **Tarjeta "Aprobadas":** Aparece y muestra la cantidad de empresas que ya están activas en el sistema.
- [ ] **Tarjeta "Total Usuarios":** Aparece y muestra el total de personas (empleados, administradores, etc.) registradas.

## 3. Pestaña "Resumen" (Estadísticas Generales)
- [ ] **Top Industrias:** Al hacer clic en la pestaña "Resumen", se muestra correctamente una lista de los giros comerciales más frecuentes con su respectivo conteo.
- [ ] **Top Estados:** En la misma pestaña, se muestra una lista clara de los estados (ubicación) con más empresas registradas y su cantidad.

## 4. Pestaña "Empresas" (Bandeja de Aprobaciones)
- [ ] **Listado de Empresas:** Al hacer clic en la pestaña "Empresas", se muestra el historial reciente con el nombre, RFC, fecha y nombre de quién creó la empresa.
- [ ] **Etiquetas de Estado:** Cada empresa en la lista muestra correctamente su estado actual (Pendiente, Aprobado o Rechazado).
- [ ] **Botón Activo (Empresas Pendientes):** Para las empresas con estado "Pendiente", el botón de acción (ícono de ojo / visualizar) se encuentra **habilitado** (se puede hacer clic).
- [ ] **Botón Inactivo (Empresas Procesadas):** Para las empresas con estado "Aprobado" o "Rechazado", el botón de acción (ícono de ojo) se encuentra **deshabilitado** (no se puede hacer clic, evitando acciones duplicadas).

## 5. Pestaña "Actividad" (Bitácora y Protección de Privacidad)
- [ ] **Listado de Actividad:** Al hacer clic en la pestaña "Actividad", aparece un historial de las acciones recientes realizadas en el sistema (ej. aprobaciones de empresas).
- [ ] **Enmascaramiento de PII (Correos):** Al revisar los correos electrónicos de los usuarios que realizaron las acciones, estos **no se muestran completos** (se muestran ocultos parcialmente con asteriscos, por ejemplo: `ju********@em*******.com`).

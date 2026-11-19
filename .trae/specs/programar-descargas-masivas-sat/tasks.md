# Tareas

- [x] Tarea 1: Definir y migrar el modelo de rutinas y ejecuciones en Prisma.
  - [x] 1.1 Agregar modelos, estados, relaciones con organización, empresa y `MassDownloadRequest`, e índices para consultas multi-tenant.
  - [x] 1.2 Generar la migración sin modificar ni reemplazar los modelos de descarga existentes.
  - [x] 1.3 Validar la migración y el cliente Prisma en la base de pruebas.

- [x] Tarea 2: Implementar la validación y las operaciones protegidas de rutinas.
  - [x] 2.1 Crear esquemas Zod para alta, edición, filtros SAT, periodos dinámicos diarios/semanales/mensuales y personalizados, frecuencia, estado y almacenamiento opcional.
  - [x] 2.2 Implementar rutas/acciones para listar, crear, editar, pausar, reanudar y eliminar lógicamente una rutina.
  - [x] 2.3 Validar sesión, organización, empresa activa, permisos de descargas y credencial FIEL asociada en cada operación.
  - [x] 2.4 Agregar pruebas para validación, autorización, aislamiento de tenant y ciclo CRUD.

- [x] Tarea 3: Calendarizar y conectar las rutinas con los workers SAT existentes.
  - [x] 3.1 Agregar servicio de dominio para resolver día en curso/anterior, semana en curso/anterior, últimos siete días, periodos mensuales y fechas personalizadas en la zona horaria configurada.
  - [x] 3.2 Configurar BullMQ y un worker de rutinas que reconcilie programaciones activas al iniciar y evite ocurrencias duplicadas.
  - [x] 3.3 Crear una ocurrencia auditable y encolar la solicitud usando el flujo existente de `MassDownloadRequest`, solicitud, verificación, descarga y reintentos.
  - [x] 3.4 Persistir estados, `IdSolicitud`, paquetes y eventos saneados, y comprobar la actualización a `ERROR` ante fallos definitivos.
  - [x] 3.5 Agregar pruebas de fechas, idempotencia, pausa, reintentos y vinculación con la solicitud existente.
  - [x] 3.6 Implementar `src/lib/logger.ts` con eventos JSON y correlación; integrarlo en APIs y workers para registrar el ciclo de vida completo, redaccionar datos sensibles y comprobar que fallas de logging no alteren el flujo SAT.

- [x] Tarea 4: Añadir opciones seguras de almacenamiento sin alterar el comportamiento predeterminado.
  - [x] 4.1 Definir raíces autorizadas y destinos lógicos; mostrar identificadores/nombres en la interfaz sin revelar rutas físicas.
  - [x] 4.2 Validar autorización, canonicalización y contención de ruta en servidor; rechazar rutas absolutas, traversal, symlinks/junctions y destinos fuera de la raíz.
  - [x] 4.3 Integrar extracción y copia ZIP opcionales con permisos de mínimo privilegio, cifrado en reposo, escritura atómica, nombres seguros, cuotas y retención.
  - [x] 4.4 Validar entradas ZIP contra ZIP Slip, enlaces y bombas ZIP mediante límites configurables de tamaño, ratio y cantidad de entradas.
  - [x] 4.5 Probar persistencia predeterminada, extracción personalizada, respaldo, cifrado/permisos, rechazo de destinos inseguros y archivos ZIP maliciosos.

- [x] Tarea 5: Construir la interfaz tenant para configurar rutinas y consultar ejecuciones.
  - [x] 5.1 Añadir el enlace hijo en **Descargas masivas de CFDI**, respetando visibilidad y permisos existentes.
  - [x] 5.2 Crear formulario y listado CRUD con shadcn/ui, selección de empresa activa, filtros condicionales y validación Zod.
  - [x] 5.3 Crear monitor de historial con estado, solicitud SAT, paquetes, fechas y detalle de logs.
  - [x] 5.4 Validar navegación, estados vacíos, errores, actualización silenciosa y separación entre organizaciones/empresas.

- [x] Tarea 6: Cerrar regresión y documentar el cambio.
  - [x] 6.1 Ejecutar pruebas enfocadas de `mass_downloads` y las pruebas nuevas.
  - [x] 6.2 Ejecutar `npm run lint` y `npm run build`; corregir cualquier error o advertencia introducido.
  - [x] 6.3 Actualizar `CHANGELOG.md` sin alterar funcionalidades manuales existentes.

## Dependencias
- La Tarea 2 depende de la Tarea 1.
- La Tarea 3 depende de las Tareas 1 y 2.
- La Tarea 4 depende de la Tarea 3 y puede implementarse en paralelo con la Tarea 5 una vez acordada su interfaz de configuración.
- La Tarea 5 depende de la Tarea 2; el monitor completo depende además de la Tarea 3.
- La Tarea 6 depende de las Tareas 1 a 5.

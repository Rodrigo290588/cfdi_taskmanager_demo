# Módulo de Automatización y Calendarización de Descargas Masivas SAT

## Why
Las solicitudes masivas actuales se crean manualmente desde el tenant y ya cuentan con integración SAT, workers, reintentos y seguimiento de paquetes. Este módulo permitirá definir rutinas recurrentes y consultar su historial sin duplicar el flujo existente ni perder el aislamiento por organización y empresa.

## What Changes
- Agregar dentro del menú tenant **Descargas masivas de CFDI** una opción hija para administrar rutinas automatizadas y consultar sus ejecuciones.
- Crear, listar, editar, pausar, reanudar y eliminar rutinas; al eliminarlas se conservará el historial y se cancelarán futuras ejecuciones.
- Admitir solicitudes XML y Metadata, filtros SAT existentes y rangos dinámicos o personalizados.
- Calendarizar ejecuciones diarias, semanales y mensuales con hora y zona horaria explícitas.
- Ejecutar cada ocurrencia mediante BullMQ y los workers actuales de descarga/verificación/paquetes, reutilizando autenticación FIEL, protocolo SAT, límites y reintentos existentes.
- Registrar una ejecución auditable por ocurrencia y relacionarla con la solicitud SAT existente (`MassDownloadRequest`); evitar mantener dos fuentes de verdad para el estado SAT.
- Incluir formularios shadcn/ui validados con Zod, tabla de ejecuciones y detalle de eventos y errores.
- Permitir elegir opcionalmente una ubicación de extracción y una ubicación de respaldo ZIP dentro de rutas del servidor previamente autorizadas; la persistencia actual seguirá siendo el comportamiento predeterminado y no se cambiará para rutinas sin esas opciones.

## Impact
- Affected specs: Descargas masivas SAT; acceso multi-tenant; almacenamiento y procesamiento de paquetes.
- Affected code:
  - `src/components/layout/sidebar.tsx`
  - `src/app/mass-downloads/` y `src/app/api/mass-downloads/`
  - `src/components/mass-downloads/`
  - `src/workers/`, `src/scripts/start-worker.ts`, `src/lib/queue.ts`
  - `src/lib/sat-service.ts`, `src/workers/mass-download.worker.ts`, `src/workers/verification.worker.ts`, `src/workers/download.worker.ts`
  - `src/services/`
  - `src/lib/logger.ts`
  - `prisma/schema.prisma` y migración Prisma
  - `CHANGELOG.md`

## Estructura objetivo
- `src/app/mass-downloads/routines/page.tsx`: listado y configuración de rutinas.
- `src/app/mass-downloads/routines/executions/page.tsx`: monitor de ejecuciones.
- `src/app/api/mass-downloads/routines/route.ts`: listar y crear rutinas.
- `src/app/api/mass-downloads/routines/[routineId]/route.ts`: consultar, editar, pausar/reanudar y eliminar.
- `src/app/api/mass-downloads/routines/[routineId]/runs/route.ts`: historial y detalle de ejecuciones.
- `src/components/mass-downloads/routines/`: formulario, tabla, programación, filtros y detalle.
- `src/lib/validations/mass-download-routine.schema.ts`: esquemas Zod compartidos.
- `src/services/mass-download-routine.service.ts`: reglas de negocio, cálculo de ventanas de fecha e integración con las solicitudes existentes.
- `src/lib/logger.ts`: logger estructurado compartido para las rutas y workers del flujo de descargas.
- `src/workers/mass-download-routine.worker.ts`: procesamiento calendarizado y registro de resultados.
- `src/lib/queue.ts` y `src/scripts/start-worker.ts`: registro e inicio de la cola y worker.

## ADDED Requirements
### Requirement: Administración multi-tenant de rutinas
El sistema SHALL mostrar la administración de rutinas como opción hija de **Descargas masivas de CFDI** y limitar los datos a la organización y empresas a las que el usuario tenga acceso. La rutina SHALL asociarse a la empresa activa seleccionada en el tenant, conservar su `companyId` y RFC como referencia validada por el servidor, y usar las credenciales FIEL existentes asociadas a la organización y RFC. El RFC seleccionado en el tenant SHALL ser el valor inicial y el servidor SHALL volver a validar que la empresa, organización, acceso y credencial correspondan antes de guardar o ejecutar.

#### Scenario: Crear rutina para la empresa activa
- **WHEN** un usuario autorizado crea una rutina desde el tenant con una empresa activa seleccionada
- **THEN** el sistema guarda la rutina dentro de su organización, asocia la empresa y RFC validados y nunca acepta como confiable una organización o empresa enviada solo por el navegador

#### Scenario: Usuario sin acceso a la empresa o a las credenciales FIEL
- **WHEN** el usuario intenta guardar, modificar o ejecutar una rutina para una empresa o RFC no autorizado, o sin credencial activa correspondiente
- **THEN** la operación se rechaza sin encolar una solicitud al SAT ni revelar credenciales

### Requirement: Configuración y validación de rutinas
El sistema SHALL permitir configurar nombre, empresa/RFC, tipo XML o Metadata, dirección emitidos o recibidos, RFC emisor/receptor según aplique, tipo de comprobante, estado SAT, RFC a cuenta de terceros, complemento, periodo de descarga, programación, zona horaria, estado activo/pausado y opciones de almacenamiento. La creación y actualización SHALL usar un esquema Zod compartido entre interfaz y servidor, validar campos condicionales y rangos de fechas, y persistir filtros estructurados y tipados en Prisma.

#### Scenario: Guardar filtros condicionales válidos
- **WHEN** se configura una descarga de emitidos o recibidos con filtros de RFC aplicables y un periodo permitido
- **THEN** Zod acepta los valores válidos, omite o rechaza filtros incompatibles y la rutina conserva la configuración necesaria para recrear la solicitud

#### Scenario: Usar periodo dinámico diario o semanal
- **WHEN** el usuario selecciona un periodo diario o semanal dinámico (día en curso, día anterior, semana en curso, semana anterior o últimos siete días), o un periodo dinámico mensual
- **THEN** el worker calcula las fechas concretas al inicio de cada ocurrencia en la zona horaria de la rutina, aplica límites inclusivos coherentes con el servicio SAT y guarda el periodo resuelto con la ejecución

#### Scenario: Usar periodo personalizado
- **WHEN** el usuario selecciona fechas personalizadas
- **THEN** el sistema valida que ambas fechas sean válidas, que la fecha inicial no sea posterior a la final y registra las fechas exactas utilizadas en cada ejecución

#### Scenario: Programación mensual de varios días
- **WHEN** una rutina mensual define uno o varios días del mes y una hora
- **THEN** el scheduler genera solo las ocurrencias aplicables en esa zona horaria y no crea ejecuciones duplicadas al reconciliar la programación

### Requirement: Ejecución calendarizada y reutilización del flujo SAT
El sistema SHALL programar, suspender y reconciliar ocurrencias con BullMQ y un worker activo independientemente de la sesión del usuario. Cada ocurrencia SHALL encolar la solicitud mediante el flujo SAT ya implementado, creando o asociando el `MassDownloadRequest` existente y reutilizando su autenticación FIEL, `SolicitaDescarga`, verificaciones, descarga de paquetes, reintentos y límites de concurrencia. El sistema SHALL conservar la regla de atributos SOAP en orden alfabético, las fechas SAT existentes y el manejo de errores del worker. La creación/reintento SHALL ser idempotente por rutina y fecha/hora programada para evitar solicitudes duplicadas.

#### Scenario: Ocurrencia programada exitosa
- **WHEN** llega el horario de una rutina activa y la empresa, credencial y filtros siguen siendo válidos
- **THEN** BullMQ inicia el flujo existente de solicitud SAT, crea un registro de ejecución y relaciona la solicitud masiva resultante con ese registro

#### Scenario: Rutina pausada o configuración inválida
- **WHEN** el scheduler evalúa una rutina pausada o cuya empresa/credencial ya no sea válida
- **THEN** no se solicita descarga al SAT; las rutinas pausadas no producen nuevas ocurrencias y los errores de validación quedan registrados en el historial cuando correspondan

#### Scenario: Reintento y fallo final
- **WHEN** una comunicación SAT falla temporalmente o agota los reintentos configurados
- **THEN** el worker actual aplica su política de reintentos sin duplicar la solicitud lógica, actualiza el estado existente a `ERROR` al fallar definitivamente y registra el error saneado en la ejecución

### Requirement: Modelado y trazabilidad de ejecuciones
El sistema SHALL agregar modelos Prisma para la configuración de rutinas y su historial. El modelo de rutina SHALL incluir organización, empresa/RFC, filtros, programación, estado y opciones de almacenamiento con índices adecuados para listar por organización/empresa y localizar rutinas activas. El historial SHALL incluir rutina, fecha programada, inicio y fin, identificador `IdSolicitud` cuando exista, estado, conteo de paquetes, mensajes de error y relación opcional con `MassDownloadRequest`. El historial SHALL conservarse al eliminar una rutina y permitir consultar eventos de solicitud, verificación y descarga sin registrar contraseñas, llaves privadas, tokens ni XML sensibles.

#### Scenario: Auditoría de ocurrencia
- **WHEN** una ocurrencia inicia, solicita, verifica, descarga o falla
- **THEN** el sistema actualiza su historial con marca de tiempo, estado y detalles operativos saneados, manteniendo `MassDownloadRequest` como fuente de verdad del estado SAT

#### Scenario: Eliminar rutina
- **WHEN** un usuario autorizado elimina una rutina
- **THEN** el sistema desactiva futuras ejecuciones y conserva los registros de ejecución y su vínculo con las solicitudes históricas

### Requirement: Logging estructurado de solicitudes
El sistema SHALL implementar un logger estructurado compartido para las rutas API y los workers del flujo de descargas masivas, reemplazando los mensajes dispersos de ese flujo por eventos JSON consistentes enviados a stdout/stderr para que los recojan los logs del sistema (incluido PM2). Cada evento SHALL incluir fecha UTC, nivel, nombre de evento, servicio/worker y un identificador de correlación; SHALL incluir `routineId`, `runId`, `MassDownloadRequest.id`, `IdSolicitud` y `jobId` cuando estén disponibles. Se SHALL registrar el ciclo de vida completo de solicitudes manuales y calendarizadas: creación/cambios de rutina; disparo programado; validación; encolado; solicitudes SAT; verificaciones; reintentos; descargas y procesamiento de paquetes; almacenamiento; finalización y errores. Los logs operativos SHALL permitir correlacionar cada evento del sistema con el registro visible en el monitor sin sustituir el historial persistido en `DownloadLog`.

El logger SHALL utilizar niveles consistentes (`info`, `warn`, `error`) y campos tipados; SHALL sanear errores y mensajes externos, enmascarar RFC u otros datos fiscales cuando se incluyan, y SHALL excluir credenciales FIEL, contraseñas, llaves privadas, certificados, tokens, firmas, cuerpos SOAP/XML, contenido de CFDI, rutas físicas sensibles y datos personales innecesarios. Ningún valor recibido del SAT o del usuario SHALL escribirse directamente sin saneamiento. La falla del logger no SHALL provocar una solicitud duplicada ni detener o cambiar el procesamiento SAT; los errores del logger SHALL manejarse sin ocultar el resultado de la operación principal.

#### Scenario: Seguir una solicitud manual o calendarizada de extremo a extremo
- **WHEN** una solicitud manual o una rutina genera un proceso que pasa por solicitud, verificación, reintento, descarga y resultado terminal
- **THEN** los logs del sistema contienen eventos JSON correlacionables por identificadores estables y permiten reconstruir el orden, estado y duración de cada etapa

#### Scenario: Registrar fallo sin filtrar secretos
- **WHEN** el SAT, una cola o el almacenamiento devuelve un error
- **THEN** el logger registra nivel, etapa, código/mensaje saneado e identificadores de correlación, sin guardar tokens, credenciales, payloads SOAP/XML ni información fiscal sensible en claro

### Requirement: Almacenamiento opcional y compatible
El sistema SHALL conservar el almacenamiento actual como opción predeterminada y mantener intacta la persistencia existente en base de datos. Una rutina podrá habilitar ubicaciones distintas para archivos extraídos y respaldo ZIP bajo una raíz de almacenamiento configurada por un administrador del servidor. La interfaz SHALL presentar nombres lógicos de ubicaciones y no revelar rutas físicas; el cliente SHALL enviar identificadores de destino y componentes de ruta relativos, nunca una ruta física confiable. El servidor SHALL aplicar autorización por organización/empresa, canonicalizar la ruta y comprobar que permanezca dentro de la raíz autorizada antes de cada operación. SHALL rechazar rutas absolutas, traversal, separadores o prefijos de unidad inesperados, symlinks/junctions/reparse points que escapen de la raíz y cualquier intento de lectura o escritura fuera de los destinos permitidos.

Los destinos SHALL estar fuera del directorio público de la aplicación y protegidos con permisos de sistema operativo de mínimo privilegio para la cuenta del worker. Los archivos SHALL cifrarse en reposo mediante un volumen cifrado o almacenamiento cifrado gestionado por la aplicación. Las escrituras SHALL usar nombres generados por el servidor, creación segura y escritura atómica sin sobrescrituras no autorizadas; el sistema SHALL aplicar cuotas/límites de espacio y política de retención. La extracción de ZIP SHALL validar cada entrada para impedir ZIP Slip, enlaces y bombas ZIP mediante límites configurables de tamaño comprimido/descomprimido, cantidad de entradas y ratio de expansión. Los logs SHALL registrar identificadores de destino y resultados, nunca secretos, contenido XML ni rutas que permitan revelar información sensible. La configuración insegura o un destino no disponible SHALL fallar de forma cerrada y no SHALL degradarse a una ruta arbitraria.

#### Scenario: Sin rutas adicionales
- **WHEN** una rutina no habilita las opciones de ubicación personalizada
- **THEN** los paquetes se procesan y almacenan mediante el mecanismo ya existente, sin cambios al comportamiento actual

#### Scenario: Selección de carpeta bajo raíz aprobada
- **WHEN** un usuario autorizado explora y selecciona una carpeta para extracción o respaldo
- **THEN** el navegador usa el identificador lógico de destino y el servidor valida la ruta relativa canónica, mantiene el destino dentro de la raíz asignada y guarda solo la referencia mínima necesaria

#### Scenario: Intento de escape o archivo malicioso
- **WHEN** una solicitud intenta usar una ruta fuera de la raíz, un enlace que escape del destino o un ZIP con entradas traversal o límites de expansión excedidos
- **THEN** el sistema rechaza la operación, no lee ni escribe fuera del almacenamiento autorizado y registra un evento de seguridad saneado

#### Scenario: Destino sin protección requerida
- **WHEN** el destino configurado no cumple los permisos mínimos o no ofrece cifrado en reposo
- **THEN** el sistema impide habilitarlo para nuevas rutinas y presenta un error operativo sin exponer la ruta física

### Requirement: Administración y monitoreo de ejecuciones
El sistema SHALL ofrecer una pantalla responsive con formulario y listado de rutinas, y un monitor de ejecuciones recientes filtrado por la organización y empresa activas. El monitor SHALL mostrar nombre, empresa/RFC, tipo de solicitud, fechas efectivas, programación, estado, `IdSolicitud`, paquetes encontrados, inicio/fin y errores detallados saneados. Las acciones para editar, pausar, reanudar, eliminar y consultar detalle SHALL respetar permisos existentes del módulo y controles multi-tenant.

#### Scenario: Revisar ejecución reciente
- **WHEN** un usuario autorizado abre el monitor
- **THEN** ve solo ejecuciones accesibles de la empresa activa, sus estados actuales y los logs detallados disponibles

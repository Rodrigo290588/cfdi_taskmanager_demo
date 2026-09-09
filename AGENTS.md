# Contexto y Convenciones del Proyecto (Agent Instructions)

Este archivo define las reglas, tecnologías y estilo de programación del proyecto para mantener la consistencia en el código generado durante las sesiones de pair-programming.

## 🛠️ Stack Tecnológico
- **Framework:** Next.js (App Router)
- **Lenguaje:** TypeScript
- **Estilos:** Tailwind CSS
- **Componentes UI:** shadcn/ui (Radix UI) + Lucide React (Iconos)
- **Base de Datos / ORM:** Prisma
- **Formularios y Validación:** React Hook Form + Zod
- **Visualización de Datos:** Recharts
- **Utilidades adicionales:** `date-fns` (o manejo nativo de fechas), `uuid`, `puppeteer` (para generación de PDFs).

## ✍️ Estilo de Programación
- **Indentación:** 2 espacios.
- **Punto y coma (;):** Omitidos (estilo estándar sin semicolons), a menos que sea estrictamente necesario para evitar errores de sintaxis en TypeScript/JavaScript.
- **Comillas:** 
  - Simples (`'`) para strings en TypeScript/JavaScript.
  - Dobles (`"`) para atributos en JSX/TSX.
- **Nombrado:**
  - `camelCase` para variables, funciones e instancias.
  - `PascalCase` para componentes de React, tipos (Types) e interfaces.
  - Nombres descriptivos en inglés o español según el dominio (ej. `invoice` o `factura`, pero mantener consistencia local).
- **Estructura de Componentes:** Componentes funcionales (Functional Components) utilizando *early returns* para manejar errores o estados de carga.
- **Directivas:** Uso estricto de `'use client'` solo en la primera línea de los componentes que requieren estado local, efectos o interacción del DOM.

## 🏆 Reglas de Oro (Golden Rules)

Para evitar errores comunes y mantener la arquitectura sana, sigue siempre estas directivas:

1. **Validación Estricta (Zod First):**
   - Siempre valida los *payloads* de las APIs usando esquemas de Zod antes de procesar la lógica de negocio.
   - En el frontend, captura los errores de validación (`ZodError`) de manera controlada para mostrarlos en la UI sin romper la ejecución de la aplicación (evitando pantallas rojas de error).

2. **Reutilización de UI (shadcn/ui):**
   - Antes de crear un componente visual desde cero (botones, modales, inputs), verifica si ya existe en `src/components/ui/`.
   - Utiliza la clase utilitaria `cn()` (clsx + tailwind-merge) para combinar clases de Tailwind de forma segura.

3. **Manejo de Errores y Feedback:**
   - **Backend:** Las rutas de API (`route.ts`) deben usar bloques `try/catch` y devolver respuestas estructuradas: `NextResponse.json({ error: "Mensaje" }, { status: 400 | 500 })`.
   - **Frontend:** Informar al usuario del éxito o fracaso de las operaciones asíncronas usando `toast.success()` o `toast.error()` de la librería `sonner`.

4. **Acceso a Datos (Prisma):**
   - Evita hacer peticiones a la base de datos dentro de bucles (`N+1 query problem`). Utiliza transacciones (`prisma.$transaction`) o consultas agrupadas (`findMany`, `in`) cuando sea posible.

5. **Optimización de Renderizado:**
   - Para tablas de datos y reportes complejos, memoriza las configuraciones de columnas y datos derivados utilizando `useMemo` y `useCallback` para evitar re-renderizados innecesarios.
   - Controla el comportamiento asíncrono con estados `isLoading` o `isSubmitting` para deshabilitar botones y prevenir envíos dobles.

6. **Integraciones de Terceros (SAT) y XML:**
   - Cuando interactúes con WebServices externos (ej. SAT), maneja los tiempos de espera y prevé posibles fallos de conexión.
   - Provee siempre un mecanismo de *fallback* o mensaje amigable si el servicio de terceros no responde, permitiendo al usuario reintentar más tarde en un entorno local o de desarrollo.
   - **Parseo de XML:** Usa siempre expresiones regulares robustas. Considera que el SAT puede responder con atributos con espacios extra (ej. `Mensaje ="..."`) o agregar prefijos de namespaces aleatorios (ej. `<des:IdsPaquetes>`). Siempre utiliza `.trim()` para limpiar valores extraídos, el flag `/i` para case-insensitivity y considera espacios en blanco con `\s*`.
   - **Diccionarios de Códigos:** Siempre que el SAT devuelva códigos numéricos (ej. `CodEstatus`), traduce ese código a un mensaje amigable y descriptivo en la capa de servicio antes de enviarlo al Frontend.
   - **Endpoints y SOAPActions del SAT:** El WebService de descargas masivas tiene reglas estrictas de endpoint y cabeceras.
     - **Autenticación, Solicitud y Verificación:** Se usa el dominio con la palabra *solicitud* (`https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/`).
     - **Descarga Física:** Utiliza un dominio diferente SIN la palabra solicitud (`https://cfdidescargamasiva.clouda.sat.gob.mx/`). Usar el equivocado resulta en Error HTTP 404.
     - **Tipos de Petición:** El SAT requiere usar acciones específicas (`SolicitaDescargaEmitidos`, `SolicitaDescargaRecibidos`) tanto en la cabecera HTTP `SOAPAction` como en el nodo XML. Una acción genérica (`SolicitaDescarga`) resultará en un error HTTP 500 (ActionNotSupported).

7. **Procesamiento Masivo y Tareas Asíncronas:**
   - **NUNCA** realices operaciones de *polling* pesadas, peticiones a WebServices externos o validaciones masivas de forma síncrona bloqueando la respuesta HTTP (`NextResponse`).
   - Delega todo trabajo pesado, descargas masivas o verificaciones recurrentes a colas de trabajo en segundo plano utilizando **Redis + BullMQ** (ej. `src/workers`).
   - **Backoff Exponencial:** Para peticiones que requieren espera (como verificar si el SAT ya procesó una descarga masiva), NUNCA uses intervalos cortos fijos. Implementa algoritmos de Backoff Exponencial (ej. revisar a los 5m, luego 15m, luego 30m) para evitar sobrecargar los recursos del servidor y prevenir bloqueos por parte del SAT (como el Error 5004 temporal).
   - Limita siempre la concurrencia de los Workers (`concurrency: 5`) para asegurar la estabilidad del sistema bajo altas cargas de trabajo.
   - **Manejo de Memoria (Big Data):** Al procesar archivos extremadamente grandes (como el Metadata del SAT con +1 Millón de registros), **JAMÁS** uses funciones que carguen el archivo entero en memoria (ej. `fs.readFileSync` o métodos genéricos de parseo). 
     - **Regla Obligatoria:** Utiliza Node.js Streams (ej. `readline` sobre un `createReadStream`) para procesar el archivo línea por línea.
     - Inserta los datos en la base de datos usando agrupaciones por lotes (`chunks` de 5,000 registros usando `prisma.model.createMany`) para evitar agotar la RAM o colapsar el motor de base de datos.
     - Detecta dinámicamente los separadores de texto (`|` o `~`), ya que el formato de salida del SAT puede variar.

8. **Control de Versiones y Despliegues (GitHub):**
   - **Regla Obligatoria:** Cada vez que se finalice una característica importante y se suban los cambios a GitHub (`git push`), es estrictamente necesario **versionar** el listado de cambios.
   - **Archivo Obligatorio de Versionado:** Antes de crear el commit final y subir cambios, se debe actualizar el archivo raíz `CHANGELOG.md` con la **versión**, la **fecha** (`YYYY-MM-DD`) y un resumen claro de los cambios incluidos en esa entrega.
   - **Flujo Requerido:**
     1. `git add .`
     2. Actualizar `CHANGELOG.md` con versión, fecha y cambios de la entrega.
     3. `git commit -m "feat/fix: descripción clara de los cambios"`
     4. `git tag -a vX.X.X -m "Descripción de la versión"` (Usando Versionamiento Semántico: Mayor.Menor.Parche).
     5. `git push origin <rama>`
     6. `git push origin --tags`
   - Esto asegura que siempre haya una foto exacta del código (release/tag) correspondiente a las nuevas funcionalidades subidas.

9. **Patrón de Reportes Desglosados (Drilldown Popups):**
   - **Regla Obligatoria:** Cuando se implemente un desglose de datos (Drilldown) al hacer clic en una tarjeta o métrica, se debe seguir estrictamente este patrón de UI/UX y Funcionalidad:
     - **Pantalla Completa:** El Dialog (Modal) debe abarcar el 100% de la pantalla para maximizar el área de datos usando las clases `!max-w-[100vw] !w-screen !max-h-screen !h-screen border-0 rounded-none m-0 inset-0 translate-x-0 translate-y-0`.
     - **Resumen Superior:** El encabezado debe mostrar claramente qué filtros originaron esa consulta (ej. Empresa, Rango de Fechas exacto de la base de datos) y un desglose de la sumatoria principal (ej. PUE vs CRP).
     - **Tabla y Scroll:** La tabla debe estar envuelta en un contenedor con `flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full` para garantizar que el scroll horizontal siempre se mantenga fijo en la base del monitor y no se pierda al bajar los registros.
     - **Filtros por Columna:** Debajo de los títulos (`TableHeader`), debe existir una segunda fila (`TableRow`) que contenga un `<Input>` por cada columna. Esto debe filtrar en tiempo real (usando `useMemo` y `.toLowerCase().includes()`) los datos en memoria (`drilldownData`).
     - **Columnas Comunes:** El campo UUID siempre debe ir con tipografía `font-mono`. Si hay un UUID Relacionado, debe truncarse con `max-w-[120px] truncate` y mostrar su valor completo al hacer hover (`title="..."`). Separar el Folio de la Serie en dos columnas distintas.
     - **Exportación y Totales:** La fila de "Total" y la función de "Exportar a Excel (CSV)" **solo deben considerar los registros actualmente visibles/filtrados** (`filteredDrilldownData`). El CSV debe inyectar el BOM UTF-8 (`\uFEFF`) antes del contenido para evitar problemas de codificación de caracteres especiales (acentos, ñ) al abrirse en Microsoft Excel.
   - **Nota de Escalabilidad:** Si el drilldown puede manejar grandes volúmenes de registros, aplicar adicionalmente la regla de **Workpapers y Drilldowns de Alto Volumen** para batching backend, paginación visual, limpieza de estado y liberación de memoria al cerrar.

10. **Gestión Dinámica de Permisos (Roles Personalizados):**
    - **Regla Obligatoria:** Cada vez que se desarrolle un nuevo módulo, pantalla o funcionalidad principal en el sistema, esta debe ser registrada obligatoriamente en el sistema de Roles y Permisos.
    - Se debe actualizar el esquema de `granularPermissions` (JSON) en Prisma y agregar el *Switch* correspondiente en la interfaz de creación/edición de roles (`/admin/roles`) para que los administradores puedan habilitar o deshabilitar dicha funcionalidad a los usuarios.

11. **Compilación Segura (Build Process):**
    - **Regla Obligatoria:** Cada vez que se necesite realizar la verificación de compilación del código (`npm run build`), el agente **SOLO debe recordarle al usuario** que ejecute el comando de manera manual desde su terminal. El agente NO debe intentar ejecutar o detener procesos de compilación por sí mismo.
   
12. **Arquitectura de Datos Escalable y Segura (CFDI Big Data):**
    - **Regla Obligatoria:** Todo nuevo desarrollo que persista, consulte o explote CFDI debe diseñarse considerando desde el inicio que el sistema procesará **más de 1 millón de CFDI por año**.
    - **Separación de Responsabilidades:** No mezclar en una misma tabla, salvo necesidad transicional justificada, datos operativos/analíticos con blobs pesados o contenido sensible. Los XML cifrados, archivos grandes o payloads voluminosos deben almacenarse en tablas hijas o estructuras separadas del modelo analítico principal.
    - **OLTP vs Analítica:** Los dashboards, KPIs, reportes agregados y estadísticas **no deben** calcularse leyendo masivamente documentos crudos en tiempo real si existe riesgo de crecimiento. Deben preferirse tablas resumen, agregaciones incrementales, vistas materializadas o estrategias equivalentes.
    - **Índices por Patrón de Consulta:** Todo diseño nuevo debe definir índices compuestos basados en filtros reales de negocio (`organizationId`, empresa, RFC, fechas, estatus, tipo de CFDI, etc.), evitando depender solo de índices de una sola columna.
    - **Columnas de Alta Cardinalidad y Estados:** Los campos críticos de búsqueda y clasificación deben modelarse de forma consistente, preferentemente con enums, catálogos controlados o restricciones equivalentes para evitar degradación por datos sucios.
    - **Migraciones Seguras por Etapas:** Cuando se rediseñe una tabla crítica, se debe seguir un enfoque por fases: compatibilidad transicional, backfill histórico, validación funcional, limpieza lógica y solo al final eliminación física del legado.
    - **Seguridad del XML:** El resguardo de XML y datos sensibles debe mantenerse cifrado y desacoplado del acceso analítico. Nunca exponer XML completo al frontend salvo mediante rutas server-side autorizadas.
    - **Escalabilidad Futura:** Antes de implementar nuevos módulos fiscales o reportes masivos, evaluar siempre si corresponde particionamiento, tablas resumen adicionales, workers de sincronización o procesos batch para evitar cuellos de botella futuros.

13. **Separación de Runtime Entre Next y Procesos en Segundo Plano:**
   - **Regla Obligatoria:** Los helpers compartidos en `src/lib` y `src/services` deben ser reutilizables desde rutas Next, workers BullMQ, scripts operativos y procesos ejecutados con Node.js o `tsx`.
   - **Prohibición Explícita:** No colocar `import 'server-only'` dentro de módulos compartidos que puedan ser consumidos por workers, scripts o servicios reutilizables. Ese marcador debe reservarse para archivos realmente exclusivos del runtime de Next.js.
   - **Ubicación Correcta de Barreras de Framework:** Las restricciones específicas de Next.js deben vivir en el borde de entrada del framework, por ejemplo en `route.ts`, `page.tsx`, server actions o wrappers delgados creados específicamente para Next.
   - **Patrón Requerido:** La lógica de negocio, integración SAT, cifrado, parseo XML, sincronizaciones, cálculos analíticos y utilidades reutilizables deben permanecer desacopladas de marcadores exclusivos del framework.
   - **Validación Obligatoria:** Antes de introducir un helper server-side nuevo o reutilizar uno existente, validar explícitamente si también será consumido por workers o scripts. Si la respuesta es sí, ese helper no debe depender de `server-only`.
   - **Criterio de Diseño:** Si se requiere una protección específica para Next.js, crear un wrapper delgado cercano a la ruta o página y mantener el núcleo reusable libre de dependencias del framework.

14. **Alta Correcta de Nuevos Servicios Externos y M2M:**
   - **Regla Obligatoria:** Cada vez que se agregue un servicio nuevo bajo rutas externas o M2M (por ejemplo `src/app/api/external/**`), se debe configurar también su paso por `src/proxy.ts` cuando la autenticación real ocurra dentro del propio `route.ts` mediante Bearer token, API key o validación equivalente. Si no se registra en el proxy, la primera prueba puede fallar con `401 Unauthorized` antes de llegar al handler real.
   - **Scopes y Variables de Entorno:** Todo nuevo servicio M2M debe registrar desde el inicio su scope exacto en el código y en `.env.local` dentro de `M2M_OAUTH_CLIENTS_JSON`, respetando literalmente el nombre definido en el backend (por ejemplo `cfdi.import` con punto, no variantes como `cfdi-import`).
   - **Checklist Mínimo de Primera Prueba:** Antes de ejecutar la primera prueba manual o en Postman, validar explícitamente:
     1. que la ruta esté permitida en `src/proxy.ts` cuando aplique
     2. que el scope exista en `.env.local` o en `machine_clients`
     3. que la colección o cliente de prueba use ese mismo scope sin variaciones
     4. que la aplicación se reinicie después de modificar `.env.local`
   - **Criterio de Entrega:** Un servicio nuevo no debe considerarse listo para prueba si sólo existe el `route.ts`; también debe quedar alineado el proxy, las credenciales/scopes M2M y la colección de prueba asociada cuando corresponda.

15. **Monitores Operativos e Indicadores en Tiempo Real:**
   - **Regla Obligatoria:** Los monitores operativos (ej. importación, sincronizaciones, colas, sesiones) deben separar claramente:
     1. filtros capturados por el usuario
     2. filtros realmente aplicados a la consulta
     3. estado visual derivado de la consulta activa
   - **Prohibición Explícita:** No hacer `setState` síncrono dentro de `useEffect` únicamente para resetear métricas visuales si ese reset puede ligarse a la firma real de la consulta.
   - **Patrón Requerido:** Reiniciar velocidades, acumulados temporales o referencias (`refs`) solo cuando cambie efectivamente la consulta activa o la respuesta consumida.
   - **Criterio de UX:** Los monitores con auto-refresh o recarga manual deben evitar parpadeos, resets falsos y cálculos duplicados al cambiar filtros.
   - **Validación Obligatoria:** Si una ruta existente devuelve `404` inesperado en desarrollo, antes de modificar la implementación validar si el proceso `next dev` está en estado inconsistente y reiniciar la aplicación si aplica.

16. **Clientes Externos de Ingesta y Binarios Versionados:**
   - **Regla Obligatoria:** Cuando se modifique la lógica de un cliente externo compilado (ej. `java-client`), no se debe asumir que el binario en `target/` refleja el código fuente actual.
   - **Regla Obligatoria de Recompilación Explícita (y Notificación al Usuario):** Cualquier cambio que altere el comportamiento de validación, autorización, transformación o rechazo de documentos que el `java-client` envía, **OBLIGA** a:
     1. Recompilar el JAR con `mvn clean package` en `java-client/` (y confirmar que `BUILD SUCCESS`) ANTES de que el usuario realice la primera prueba con la nueva lógica.
     2. **Notificar al usuario en la respuesta final del agente**, al finalizar cada sesión de cambios relevantes, un texto explícito del tipo: "🔔 Se modificó [componente] que impacta al flujo que consume el `java-client`. Es OBLIGATORIO recompilar el JAR ejecutando: `cd java-client && mvn clean package`. Reutilizar el `.jar` anterior causa que siga ejecutando la versión vieja de la lógica de negocio."
     3. Enumerar en la misma notificación los módulos TOCADOS que disparan la recompilación (ej: `src/lib/provider-cfdi-report.ts`, `src/lib/provider-business-rules.ts`, `src/app/api/external/**`, `src/proxy.ts`, scopes M2M en `.env.local`, validaciones `providerBusinessRule*`, esquemas de Zod de importación M2M, reglas SAT/XML).
   - **Ámbitos TOCADOS que DISPARAN recompilación obligatoria (lista no exhaustiva):**
     * `src/lib/provider-cfdi-report.ts` / `provider-business-rules.ts`: nuevas reglas de validación CFDI (PUE vs 99, RESICO, ObjetoImp vs IVA, Retenciones vs Traslados, TipoFactor Exento, Importe = Base × TasaOCuota, estructura de nodos Traslados/Retenciones por ObjetoImp).
     * `src/app/api/external/**` / `src/app/api/provider/**`: handlers que son invocados por el `java-client` (M2M / upload de CFDI / reportes / create import run).
     * `src/proxy.ts`: rutas, whitelists o scopes M2M usados por el `java-client`.
     * `M2M_OAUTH_CLIENTS_JSON` / `.env.local` / scopes nuevos (ej: `cfdi.import`).
     * Cualquier cambio en Zod schemas (`schemas/*.ts`) que validan el payload de entrada del JAR.
   - **Criterio de Entrega:** Todo cambio en `App.java` o en la lógica de envío, reintentos, partición de lotes o autenticación requiere recompilación explícita del artefacto (`mvn clean package`) antes de validar comportamiento.
   - **Batching Obligatorio:** Los clientes de ingesta masiva deben dividir lotes por tamaño real de payload además de conteo de archivos, evitando requests que puedan disparar `413 Payload Too Large`.
   - **Política de Reintentos:** No reintentar errores `4xx` salvo `429`. Los errores `413` deben resolverse reduciendo automáticamente el tamaño del lote.
   - **Persistencia Operativa:** Mantener mecanismos idempotentes de progreso (ej. `progress.log`) para evitar reprocesar archivos ya enviados correctamente.
   - **Checklist Mínimo de Primera Prueba después de un cambio:** Antes de que el usuario ejecute el JAR por 1a vez tras un cambio de lógica, el agente DEBE confirmar explícitamente en texto: (1) `mvn clean package BUILD SUCCESS`, (2) reinicio de `next dev` (si cambió código Next / routes M2M), (3) rutas permitidas en `src/proxy.ts`, (4) scopes M2M alineados con `.env.local`, (5) que el comando java apunte a la ruta de `target/cfdi-ingest-1.0-SNAPSHOT.jar` NUEVA y no a una copia anterior en otra carpeta.

17. **Dashboards Fiscales y Carga Escalonada:**
   - **Regla Obligatoria:** Ningún dashboard fiscal o analítico debe cargar por defecto el acumulado histórico completo al abrirse.
   - **Patrón Requerido:** El usuario debe definir explícitamente un periodo mediante `Fecha Inicio` y `Fecha Fin` antes de consultar KPIs, gráficas o reportes.
   - **Carga en Dos Fases:** Cuando el dashboard tenga métricas costosas, la API debe permitir una carga ligera inicial (ej. `includeHeavyMetrics=false`) y una hidratación detallada posterior en segundo plano.
   - **OLTP vs XML:** Está prohibido calcular KPIs masivos filtrando directamente `xmlContent` en consultas SQL/Prisma cuando existan blobs cifrados o el volumen pueda crecer.
   - **Patrón Requerido para XML:** Leer XML solo del lado servidor, preferentemente desde tablas desacopladas (ej. `InvoiceBlob`), descifrarlo de forma controlada y procesarlo por lotes (`cursor + take`).
   - **Fallback Analítico:** Siempre que exista tabla resumen o agregado incremental, debe preferirse para la carga inicial del dashboard.

18. **Workpapers y Drilldowns de Alto Volumen:**
   - **Regla Obligatoria:** Todo workpaper debe entrar en estado vacío y no consultar datos hasta que el usuario aplique un rango completo de fechas.
   - **Separación de Estado:** Distinguir siempre entre filtros capturados en pantalla y filtros efectivamente aplicados a la consulta.
   - **Drilldowns Masivos:** Los endpoints de drilldown con potencial de miles de registros deben procesarse por lotes (`cursor + take`) y nunca materializar de golpe todo el universo si eso compromete memoria o tiempo de respuesta.
   - **Renderizado Frontend:** Los drilldowns deben paginar o limitar visualmente la cantidad de filas renderizadas simultáneamente.
   - **Ciclo de Vida del Modal:** Al cerrar un drilldown se deben limpiar filtros, rows y estado de carga, y desmontar el contenido del dialog para liberar memoria y reducir lentitud al reabrir.
   - **Consistencia Funcional:** Totales, exportaciones y conteos deben operar sobre los registros visibles o filtrados, no sobre el arreglo bruto original cuando exista paginación o filtros en memoria.

## ✅ Checklist Obligatorio para Nuevos Desarrollos

Cada vez que se implemente un nuevo módulo, API, dashboard, reporte, worker o proceso masivo relacionado con CFDI, el diseño y la implementación deben validar explícitamente esta checklist:

1. **Checklist de Datos y Persistencia:**
   - ¿La solución distingue claramente entre datos operativos, datos analíticos y blobs pesados/sensibles?
   - ¿Los XML, archivos grandes o payloads sensibles quedan cifrados y fuera del modelo analítico principal?
   - ¿Las columnas críticas de búsqueda, filtros y estados están normalizadas y controladas?

2. **Checklist de Escalabilidad:**
   - ¿La solución soporta el crecimiento esperado de **más de 1 millón de CFDI por año** sin depender de lecturas completas de tablas transaccionales?
   - ¿Los dashboards o KPIs usan resúmenes, agregaciones incrementales, vistas materializadas o estrategias equivalentes en lugar de calcular todo sobre documentos crudos?
   - ¿Se evaluó si el caso requiere particionamiento, tablas resumen o procesos batch?

3. **Checklist de Consultas e Índices:**
   - ¿Se definieron índices compuestos basados en los filtros reales del negocio?
   - ¿Se evitó depender únicamente de índices de una sola columna?
   - ¿Se evitó cualquier patrón `N+1` o lectura masiva innecesaria desde Prisma o SQL?

4. **Checklist de Migraciones y Evolución:**
   - ¿La migración está diseñada por etapas seguras cuando se toca una tabla crítica?
   - ¿Existe plan de backfill histórico si se crea una tabla nueva o resumen analítico?
   - ¿Se contempló validación funcional antes de eliminar legado físico?

5. **Checklist de Seguridad:**
   - ¿Los datos sensibles quedan cifrados o protegidos por acceso server-side?
   - ¿Los logs y auditorías evitan exponer secretos, tokens, contraseñas o XML completos?
   - ¿Las rutas de descarga o consulta sensible validan permisos y contexto organizacional?

6. **Checklist de Procesamiento Masivo:**
   - ¿El trabajo pesado fue movido a workers o procesos asíncronos cuando aplica?
   - ¿Se evitó cargar archivos completos en memoria si el volumen puede crecer significativamente?
   - ¿Se definieron límites de concurrencia, chunking o streaming donde sea necesario?

7. **Checklist de Entrega Técnica:**
   - ¿Se actualizó la documentación técnica o arquitectónica si el cambio modifica el modelo de datos?
   - ¿Se dejó documentado el procedimiento manual de migración, backfill, regeneración de Prisma y validación?
   - ¿Se registró la nueva funcionalidad en permisos/roles si impacta módulos de usuario?
   - ¿Los helpers compartidos que viven en `src/lib` o `src/services` permanecen desacoplados de marcadores exclusivos de Next.js cuando también serán usados por workers o scripts?
   - ¿Si se creó un servicio externo o M2M, quedaron alineados `src/proxy.ts`, `.env.local`/`M2M_OAUTH_CLIENTS_JSON`, scopes y colección de prueba antes de la primera validación?

8. **Checklist de Dashboards, Drilldowns y Workpapers:**
   - ¿El módulo evita cargar automáticamente todo el histórico al entrar?
   - ¿Existe separación entre filtros capturados y filtros aplicados?
   - ¿La carga pesada está diferida o escalonada cuando aplica?
   - ¿Los drilldowns de alto volumen usan batching en backend?
   - ¿El modal limpia estado y libera memoria al cerrarse?
   - ¿El workpaper entra vacío hasta que el usuario defina un periodo?

**Regla Obligatoria de Aplicación:**
- Esta checklist debe considerarse parte del diseño por defecto en todo desarrollo nuevo del proyecto.
- Si una implementación decide no aplicar uno de estos puntos, debe existir una justificación técnica explícita y documentada dentro de la solución o su documentación asociada.

## 🛡️ 19. Workflow Estándar de Detección, Remediación y Pruebas de Vulnerabilidades (SAST / DAST)

**Regla Obligatoria de Aplicación:**  
Cada vez que el usuario solicite: *"realizar análisis de vulnerabilidades en módulo X"*, *"aplicar parches de seguridad del reporte Y"*, *"pentest Auth/Dashboard/CFDI"*, o cualquier combinación de Detección + Remediación + Pruebas + PDF documental, el agente **DEBE** seguir estrictamente este workflow de 4 FASES + 1 FASE EXTRA (por elección del usuario). Se debe **DETENER y esperar confirmación** entre FASE 1 y el resto. Prohibido saltarse etapas.

---

### 19.1 FASE 0 (Pre-Solicitud) · Generación del Reporte de Vulnerabilidades Detectadas (HTML + PDF)

Si el usuario pide *"haz un análisis SAST / pentest / auditoría de seguridad del módulo X"* y **NO** existe aún un reporte previo (HTML/PDF en `reports/`), el agente **antes de cualquier remediación** debe generar y presentar al usuario los 2 entregables de detección:

1. **Entregable 0-A · Reporte SAST (HTML + PDF) en `reports/`:**
   - **Formato obligatorio de naming:** `reports/sast-<modulo>_report_<YYYYMMDD_HHMM>.html` y su `.pdf` equivalente (mismo basename, mismo contenido). Usar `puppeteer-core` exactamente igual que en `src/lib/cfdi-pdf.ts` para no duplicar configuración de navegador.
   - **Estructura obligatoria de cada finding del reporte SAST:**
     - `ID` (ej: `AUTH-001`, `ADMIN-003`, `CFDI-007`)
     - `Categoría OWASP Top 10 2021` (ej: A01:2021 Broken Access Control)
     - `Severidad` (Crítico / Alto / Medio / Bajo) + Badge color
     - `Archivo · Línea exacta` (monospace)
     - `Descripción del Riesgo` (impacto de negocio, no solo técnico)
     - `Ejemplo de Exploit / Proof of Concept` (en bloque `<pre>` rojo `exploit`)
     - `Código Corregido Sugerido` (en bloque `<pre>` verde `fixed`)
   - **Metadata del reporte (Portada obligatoria):** Scope del análisis, framework, fecha emisión, estándar OWASP Top 10 2021, resumen por severidad (Crítico / Alto / Medio / Bajo / Total), TOC con links a cada finding.
2. **Entregable 0-B · Mensaje de Confirmación:** Detener la ejecución y preguntar al usuario: *"¿Deseas proceder a aplicar las correcciones del reporte? Requiere 2 FASES adicionales obligatorias: FASE 1 Auditoría Insumos y FASE 2 Remediación + Tests. ¿Confirmas?"*

**Si YA existe el reporte SAST (caso más frecuente):** Saltar directamente a la FASE 1, no regenerar detección a menos que el usuario lo pida explícitamente.

---

### 19.2 FASE 1 (Obligatoria) · Auditoría de Insumos / Prerrequisitos (4 Grupos)

**Regla Obligatoria:** El agente **DEBE** presentar al usuario una encuesta estructurada por Grupos antes de escribir código de remediación. **NO** aplicar parches hasta que el usuario responda y confirme. Usar `AskUserQuestion` con 1-4 preguntas por bloque si aplica.

#### Grupo 1 · Variables de Entorno (`.env.*`)

El agente debe validar y preguntar o generar (según elección):

| # | Insumo | Pregunta al Usuario / Acción Automatizada |
|---|---|---|
| 1.1 | `.env.test` aislado para DB + Redis + NEXTAUTH_SECRET mínima longitud 32 chars + TEST_* fixtures | ¿Usuario genera `.env.test` manual? · O Agente genera plantilla segura con defaults (elección usuario)? Si no existe, agente generará `DATABASE_URL` a Postgres TEST puerto 5434 o similar aislado. |
| 1.2 | `.env.example` requerido para dotenv-safe | ¿Existe `.env.example` con todas las vars del proyecto? Si NO y el usuario eligió dotenv-safe en testing framework, cambiar a `dotenv` puro + fallback seguros. |

#### Grupo 2 · Entorno e Infraestructura (Docker, Redis, Postgres)

| # | Insumo | Pregunta al Usuario |
|---|---|---|
| 2.1 | Servicio Postgres-TEST aislado (puerto distinto al DEV) + volumen persistente | ¿Usuario crea servicio en `docker-compose.yml` manualmente? · O Agente lo agrega (elección usuario)? Healthcheck `pg_isready`. Nombre de servicio: `postgres-test`. Puerto ejemplo: `5434:5432`. DB name: `<proyecto>_TEST_<MODULO>`. |
| 2.2 | `prisma migrate deploy` sobre Postgres-TEST después de levantarlo | ¿Usuario ejecuta migraciones manual? · O Agente incluye paso script `npm run db:test:migrate` en su automatización de FASE 2? |
| 2.3 | `prisma db seed` fixtures determinísticas para Tests (orgs, users, members con IDs fijos) | ¿Usuario escribe fixtures seed? · O Agente los escribe (FASE 2)? ¿Ambos? |

#### Grupo 3 · Dependencias de Software / Framework de Testing

| # | Insumo | Pregunta al Usuario |
|---|---|---|
| 3.1 | Runner Tests: **Jest + ts-jest** vs **Vitest** | ¿Usuario prefiere Jest (ts-jest) o Vitest (preferencia explícita)? Por defecto proyecto usa Jest + ts-jest (CommonJS `jest.config.js` + `setupTests.ts`). |
| 3.2 | DevDeps: jest, ts-jest, @types/jest, supertest (integración HTTP), @types/supertest, cross-env, dotenv, tsx | ¿Usuario instala deps manual? · O Agente instala con npm add -D? Default: Agente instala. |

#### Grupo 4 · Datos / Payloads de Prueba

| # | Insumo | Acción |
|---|---|---|
| 4.1 | Carpeta fixtures: `tests/<modulo>/fixtures/payloads.ts` con `PAYLOAD-001 … PAYLOAD-NNN` de cada vector ataque | ¿Usuario provee payloads? · O Agente genera payloads base: Open-Redirects, Overposting, Weak Passwords, SQLi/XSS, Invalid JWTs, Bad Host, Slug Colisiones (proporciona lista 8-10 payloads). |
| 4.2 | `tests/setupTests.ts` con fallbacks seguros (NEXTAUTH_SECRET ≥ 32 chars, NEXTAUTH_URL, PUBLIC_HOSTS_ALLOWLIST, silenciar console.error/warn con flag TESTS_VERBOSE) | ¿Usuario escribe setupTests manual? · O Agente genera. |

**Cierre FASE 1:** El agente **DEBE** esperar las respuestas, generar un Plan Ajustado, y volver a preguntar: *"He resumido tus elecciones en este Plan, ¿confirmamos que se procede a FASE 1-EXTRA + FASE 2?". Si usuario responde "Encárgate tú" → aplicar defaults seguros automáticamente.*

---

### 19.3 FASE 1-EXTRA (Intermedia, por elecciones FASE 1) · Setup Completo de Entorno Testing

Si en FASE 1 el usuario dispone que el agente lo haga, ejecutar los siguientes sub-pasos **antes** de tocar lógica de remediación:

1. **1-EXTRA 1 · Archivos de configuración:** Crear `.env.test`, `jest.config.js` (CommonJS, NO `jest.config.ts` para evitar ESM `__dirname is not defined`), `tests/setupTests.ts`, carpeta `tests/<modulo>/fixtures/` con `payloads.ts`.
2. **1-EXTRA 2 · docker-compose.yml:** Agregar servicio `postgres-test` (puerto aislado, healthcheck, volumen `postgres_test_data`) + `redis` (si aplica).
3. **1-EXTRA 3 · package.json scripts:** Agregar SIEMPRE este bloque estándar (reemplazar `<modulo>` = auth/admin/cfdi):
   ```json
   "test":               "cross-env NODE_ENV=test jest --passWithNoTests",
   "test:<modulo>":      "cross-env NODE_ENV=test jest tests/<modulo> --runInBand --passWithNoTests",
   "test:<modulo>:coverage": "cross-env NODE_ENV=test jest tests/<modulo> --runInBand --coverage --passWithNoTests",
   "test:ci":            "cross-env NODE_ENV=test jest --ci --forceExit --passWithNoTests",
   "db:test:up":         "docker compose up -d postgres-test redis",
   "db:test:migrate":    "cross-env-shell NODE_ENV=test npx prisma migrate deploy",
   "db:test:seed":       "cross-env-shell NODE_ENV=test npx tsx scripts/seed-sast-fixtures.mts",
   "db:test:nuke":       "docker compose stop postgres-test && docker compose rm -f postgres-test && docker volume rm <vol_name>_postgres_test_data 2>$null; exit 0",
   "report:<modulo>:remediation": "cross-env NODE_ENV=production npx tsx reports/generate-remediation-<modulo>-pdf.ts"
   ```
4. **1-EXTRA 4 · Parche de Migraciones Históricas Prisma (Obligatorio si Prisma falla con 42703 / 42P01 / P3018):**
   Si al ejecutar `prisma migrate deploy` hay checksums rotos por falta de columnas/tablas antiguas: NO renombrar ni reordenar migrations existentes. Usar bloques seguros compatibles con checksum actual:
   ```sql
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='<table>' AND column_name='<columna>') THEN
       CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xxx ON "<table>" ("<columna>");
     END IF;
   END $$;
   ```
5. **1-EXTRA 5 · Levantamiento y Seed:** Ejecutar `npm run db:test:up` (esperar healthcheck healthy) → `db:test:migrate` exit 0 → `db:test:seed` exit 0.

---

### 19.4 FASE 2 (Post Confirmación) · Remediación + Security Tests

Se divide en 4 sub-pasos A → D. No saltarse. Si A usa helpers, deben estar centralizados, no copiados 12 veces en cada handler.

#### FASE 2-A · Helpers de Seguridad Compartidos (Centralizar, NO duplicar)

Crear / expandir archivos helpers reutilizables en `src/lib/`:

| Helper (archivo) | Propósito | Valores por Defecto / Reglas |
|---|---|---|
| `src/lib/security.ts` | `safeRedirectUrl(raw, fallback)` · `getRealClientIp(req)` (X-Forwarded-For right-to-left + trusted proxy allowlist + private/reserved IPs skip) · `isPrivateOrReservedIp()` · `parseCsvAllowlist()` · `getPublicHostsAllowlist()` · `getTrustedProxyIps()` · `getAuthSecretOrThrow()` (≥ 32 chars, **SIN fallback hardcodeado**) · `fingerprint(value)` (SHA-256 slice primeros 16 bytes hex / 32 chars, usado solo para correlación, nunca imprimir valor real de token/secret en logs) | `safeRedirectUrl()` mínimo 9 defensas: length ≤ 2048, chars control / CRLF / `\` / `%0a` `%0d` `%2e%2e` bloqueados, schemes peligrosos `javascript: data: vbscript: file:` bloqueados, URLs absolutas host contra allowlist, `//` protocol-relative deny, `/+/` normalize, regex `../`, stack walking clean pathname. |
| `src/lib/auth-config.ts` (o `<modulo>-config.ts`) | Constantes de seguridad: `PASSWORD_BCRYPT_ROUNDS = 12` (OWASP ≥ 12), default rate-limit windows, defaults allowlist | **Nunca** usar literales `10` `12` inline en cada handler, usar siempre la constante importada, incluso en "bcrypt dummy timing-safe" de providers. |
| `src/lib/rate-limit.ts` | `rateLimit(key, { intervalMs, max })` windowed counter en memoria. Exportar `clearRateLimit()` helper para resets entre tests. | Firma genérica, drop-in reemplazable por Redis backend en FASE 3 sin cambiar consumers. |
| `src/schemas/<modulo>.ts` | Zod schemas. Siempre `z.strictObject()` **NUNCA** `z.object()` sin `.strict()` → evita Overposting / Prototype Pollution edge. min/max password alineados NIST 2024: `min(12) / max(128) + 4 reglas de complejidad`. |

#### FASE 2-B · Aplicación de N Parches (Uno por Finding)

Por cada finding del reporte SAST, modificar archivos afectados. **Checklist obligatorio cierre del parche:**

1. ✅ **Severidad Pre vs Post documentada** (Crítico → Ninguno, p. ej.) en notas internas / comentarios de commit.
2. ✅ **ID Finding** aparece al inicio de cada bloque modificado en comentario corto `// AUTH-011 · IDOR cross member.userId`:
3. ✅ **Sin hardcodeados** (fallback secrets, tokens literales `secret`, `admin123`).
4. ✅ **Rate-Limit + Size Limits + Content-Type checks** en endpoints públicos sin auth: `415`, `413`, `429 Retry-After` lo más temprano posible (short-circuit antes de bcrypt / lógica).
5. ✅ **Transacciones Prisma $transaction + updateMany** para inválidas de tokens, claim invites, actualizaciones estado-sensitive. **NO** `find + update` secuencial si hay potencial race-claim / double-claim.
6. ✅ **Mapa errores HTTP semánticos:** 400 (validación), 401 (auth), 403 (forbid), 404 (not found), 409 (conflict), 410 (gone / expired), 413, 415, 429. Nunca responder todo `500` cuando es error cliente.
7. ✅ **Logging seguro:** catch blocks NO swallow vacío `catch(e){}`. Registrar `console.error/warn` + códigos `err.code/err.name`, usar `fingerprint()` para valores sensibles, **jamás** loggear `clientSecret`, `NEXTAUTH_SECRET`, tokens completos, contraseñas o XML completos.
8. ✅ **Cross-Check AGENTS Regla 14 (M2M External Services):** Si se modifica `src/app/api/external/**` o `src/app/api/provider/**` → `src/proxy.ts` whitelist + scopes `M2M_OAUTH_CLIENTS_JSON` alineados.
9. ✅ **Cross-Check AGENTS Regla 16 (java-client):** Si se modifica `src/lib/provider-cfdi-report.ts`, `provider-business-rules.ts`, `src/app/api/external/**`, `src/app/api/provider/**`, `src/proxy.ts`, `schemas/*.ts`, scopes M2M → AGENTE **DEBE** notificar en cierre de sesión:
   > 🔔 Se modificaron módulos que impactan al flujo que consume el `java-client`. Es OBLIGATORIO recompilar el JAR ejecutando: `cd java-client && mvn clean package`. Checklist adicional: restart next dev, proxy whitelist alineado, scopes .env.local.
10. ✅ **Permisos (AGENTS 10):** Si el parche introduce pantalla/módulo/funcionalidad principal nueva → agregar Switch correspondiente en `/admin/roles` granularPermissions JSON Prisma.

#### FASE 2-C · Creación de Security Unit Tests + Tests de Anti-Regresión

Patrón estricto naming de archivos en carpeta `tests/<modulo>/`:

```
tests/<modulo>/
├── fixtures/
│   └── payloads.ts               # <MODULO>-PAYLOAD-001 ... <MODULO>-PAYLOAD-NNN
├── <id1-id2-id3>-<tema-1>.test.ts         # ej: auth-002-005-007-security-helpers.test.ts
├── <id4>-<tema-2>.test.ts                 # ej: auth-004-password-validator.test.ts
├── ...
└── <idN>-integration.test.ts   # Opcional (supertest E2E / FASE 3 opcional)
```

- Cada finding del reporte SAST **DEBE** tener al menos 1 test anti-regresión que demuestre que el vector ataque original **ahora falla** (contrario al comportamiento vulnerable previo). Ej: vulnerabilidad era "response incluye clientSecret", test hace `expect(body).not.toContain("clientSecret")`.
- **Assert estricto sobre output vulnerable original:** cuando sea posible usar regex, JSON.stringify includes, `.statusCode === 409`, etc.
- **Jest coverageThreshold:** Empezar solo con `global` (lines / stmts ≥ 30%, functions ≥ 40%, branches ≥ 30%). **NO** usar thresholds individuales por path absoluto `./src/lib/security.ts` al principio; Jest v29/v30 a veces no matchea paths internos y produce exit code = 1 pese a tests PASSED. Si se desean granular, ajustar paths a formato que sí aparece en coverage summary (p. ej. `lib/security.ts` SIN `./src/`).
- `jest.config.js` keys: `setupFiles: ['<rootDir>/tests/setupTests.ts']`, **NO** `setupFilesAfterSetup` (typo). Si hay hooks globales (`beforeAll`), deben vivir en archivos `setupFilesAfterEach` o dentro de propios `*.test.ts`, NO en `setupFiles` (ejecuta antes que globals Jest existan).
- `--runInBand` obligatorio en módulo DB-interactivo para evitar transacciones colisionando entre procesos workers paralelos Jest.

#### FASE 2-D · Ejecución Batería Tests y Reporte PASSED / FAILED + Cobertura

1. Ejecutar `npm run test:<modulo>:coverage`.
2. Presentar al usuario resultado en este formato EXACTO, alineando con Coverage Summary:
   ```
   Test Suites:  X passed, X total
   Tests:        Y passed, Y total
   Snapshots:    Z total
   Time:         T s

   Coverage Summary (Global):
     Statements : X.X% (a/b)  [threshold 30%]
     Branches   : X.X% (a/b)  [threshold 30%]
     Functions  : X.X% (a/b)  [threshold 40%]
     Lines      : X.X% (a/b)  [threshold 30%]

   Módulos destacados (≥ 80% lines):
     schemas/auth.ts 100%
     security.ts 97.61%
     password-validator.ts 95.83%
   ```
3. Si `exit code 0` → avanzar FASE 3 Reportes PDF. Si exit code ≠ 0, iterar parches hasta PASSED.

---

### 19.5 FASE 3 (Obligatoria) · Generación Documentación en PDF (Reporte Ejecutivo de Remediación)

1. **Crear script TS en `reports/generate-remediation-<modulo>-pdf.ts`**:
   - Reusar **idéntico** patrón `getBrowser()` + `resolveBrowserExecutablePath()` de [`src/lib/cfdi-pdf.ts`](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/cfdi-pdf.ts). Misma listas de rutas Chrome/Edge por plataforma, mismo `--no-sandbox --disable-setuid-sandbox`.
   - **Array de datos fuerte tipado `Finding[]`** con 12+ campos: `id, owasp, title, severity, fileLine, description, patch, filesChanged{name,lines?}, tests{suite,result,count?,payloads?,observations?}, residualSeverity, status`.
   - **Estructura secciones obligatorias del PDF:**
     1. **Portada verde Remediación** (título, fecha, scope, status 12/12 Remediados, KPI severidad pre vs post).
     2. **Resumen Ejecutivo KPI** (5 tarjetas Crítico/Alto/Medio/Bajo/PASSED + 4 KPIs Coverage).
     3. **Matriz de Remediación N × 7** (ID · Severidad · Título · Archivo · Riesgo Residual · Status · Tests N/M).
     4. **N Finding Cards individuales**: Severidad badge Pre + Post, Bloque rojo "ANTES", Bloque verde "DESPUÉS Parche", Archivos modificados, Tabla tests Suite/Status/Payloads/Observaciones.
     5. **Testing Section** (Suites listadas 1x1, Totales PASSED, Coverage Table por módulo).
     6. **Conclusiones + Roadmap Próximos Pasos FASE 3 (opcional: E2E, Redis rate-limit, DAST ZAP, Secrets Scanning)**.
   - **Header/Footer PDF puppeteer obligatorios:** `headerTemplate` título del reporte, `footerTemplate` página `pageNumber / totalPages` + clasificación "Confidencial · Interno". Márgenes arriba/abajo de 60px/40px mínimo para evitar overlap header/footer con contenido A4.
   - **Archivos output:** Siempre `.html` + `.pdf` mismo basename en `reports/remediation-report-<modulo>_<YYYYMMDD>.{html,pdf}`.
2. **Agregar script `report:<modulo>:remediation` en package.json** (descrito en 19.3.3).
3. **Ejecutar y Notificar rutas absolutas al usuario:**
   ```
   📁 Entregables listos (carpeta reports/):
   ✅ remediation-report-auth_YYYYMMDD.pdf (Oficial)
   ✅ remediation-report-auth_YYYYMMDD.html (Preview navegador)
   ✅ generate-remediation-auth-pdf.ts (Editable)
   ✅ npm run report:auth:remediation (Re-generar)
   ```
4. **Regla AGENTS 8 Cross-Check (CHANGELOG):** Si el usuario va a subir cambios al repo con git push, **antes** del commit recordarle: actualizar `CHANGELOG.md` con versión, fecha, listado fixes de vulnerabilidades (`fix(auth): AUTH-001 remove clientSecret response`, etc.), `git tag -a vX.X.X`, y aplicar versionamiento semántico.

---

### 19.6 Checklist Obligatorio de Cierre (remediación 100% exitosa)

Antes de dar por cerrado el ciclo completo el agente debe validar **TODOS** los checks:

| Paso | Verificación |
|---|---|
| ✅ | Reporte SAST de detección original en `reports/sast-<modulo>_*.html` + `.pdf` (caso FASE 0 aplicada) |
| ✅ | `.env.test` + `jest.config.js` + `tests/setupTests.ts` existan |
| ✅ | `docker ps` muestra `postgres-test` healthy en puerto aislado |
| ✅ | `prisma migrate deploy` DB TEST exit 0 (migraciones legacy patches DO $$ aplicados si requeridos) |
| ✅ | Seed fixtures exit 0 |
| ✅ | Helpers centralizados: `src/lib/security.ts`, `<modulo>-config.ts` con constantes (no literales inline) |
| ✅ | 100% N Findings del reporte tienen correspondencia en código + tests anti-regresión |
| ✅ | `npm run test:<modulo>:coverage` = **exit code 0**, todas suites PASSED |
| ✅ | Coverage Global promedio ≥ 30% threshold |
| ✅ | `reports/generate-remediation-<modulo>-pdf.ts` existe + corre sin errores |
| ✅ | Archivo final `reports/remediation-report-<modulo>_YYYYMMDD.pdf` existe y no es 0 bytes |
| ✅ | Notificación Regla 16 compilación `java-client` si aplica (cambios en M2M/provider) |
| ✅ | Recordatorio Regla 11 `npm run build` (usuario ejecuta manual) + Recordatorio Regla 8 CHANGELOG.md/versionamiento (si aplica) |

---

## 🏗️ 20. Patrones de Arquitectura Obligatorios para /api/invoices (CFDI PDF)
> Derivados del ciclo SAST INV-001..INV-014 (14 findings: 3C / 5A / 4M / 2B).
> Estas reglas refuerzan la separación responsabilidades multi-tenant, whitelist crypto AEAD, concurrency segura Puppeteer, rate-limit bypass prevention y dev mode hardening.

### 20.1 BOLA Cross-org → InvoiceBlob scope obligatorio
- **Regla Obligatoria:** Cualquier helper que recupere blob XML cifrado (ej. `getInvoiceXmlRecordById`) **DEBE** recibir `organizationId` como segundo parámetro obligatorio (signature `fn(invoiceId: string, organizationId: string)`). Nunca debe aceptarse `invoiceId` aislado.
- La consulta Prisma al modelo de factura **DEBE** JOINear `fiscalEntity { organizationId }` y hacer un `strict assert` post-lookup (`targetInvoiceOrgId === callerOrgId`). La aserción fallida debe lanzar error genérico (no revelar existencia UUID cross-tenant).
- Si hay fallback sobre `SatInvoice`, **DEBE** hacerse lookup doble: SatInvoice.fiscalEntityId → luego FiscalEntity.organizationId → comparar con targetOrg ANTES de entregar xmlContent al handler.

### 20.2 Crypto InvoiceBlob → whitelist AEAD + authTag obligatorio
- **Regla Obligatoria:** El algoritmo de cifrado almacenado en la BD **DEBE** validarse contra un Set whitelist (`INVOICE_CIPHER_WHITELIST = Set(['aes-256-gcm', 'aes-128-gcm'])`). Cualquier valor fuera (ECB, CBC, CTR, XTS, string vacío, typo case) → error inmediato.
- El campo `authTag` **NUNCA** puede ser `empty`/`null`; cualquier flujo de descifrado que omita authTag es inválido (Padding Oracle prevention).
- Normalización de algoritmo: `.toLowerCase().trim()` ANTES de membership check para evitar bypasses case/whitespace.

### 20.3 Puppeteer PDF → Concurrency ≤5 + Browser TTL 12h
- **Regla Obligatoria:** Todos los `browser.newPage()` / `page.pdf()` **DEBEN** envolverse en un semaphore global de concurrency máximo = `INVOICE_PDF_MAX_CONCURRENT_PAGES` (default 5, overrideable por env). NUNCA abrir tabs ilimitados (1000 requests = OOM 8GB).
- Helper `createSemaphore(n)` zero-dep (no p-limit): si `maxConcurrent < 1` throw.
- Browser cache TTL máximo 12 horas: cada llamada `getBrowserInstance()` compara edad y hace `.close()` limpio si se excedió, evitando procesos zombis Chrome/Chromium en BullMQ/workers.

### 20.4 Rate Limit → SIEMPRE `await`; Next 15 BodyInit → Uint8Array.from
- **Regla Obligatoria:** Invocaciones a `rateLimitByUserId(...)` **DEBEN** llevar `await` antes. Cualquier `void rateLimitByUserId` / Promise fire-and-forget constituye bypass 100% del límite.
- Wrap en try/catch separado para no alterar otros 404/403 timing pad.
- **Compatibilidad Next.js 15:** `new NextResponse(pdfBuffer)` NO acepta `Buffer` como BodyInit. Siempre `Uint8Array.from(pdfBuffer)` como primer argumento; aplica a todas las rutas PDF: `/api/invoices/[id]/pdf`, `/dashboard_recibidos/workpaper/pdf`, `/provider/cfdis-report/pdf`.

### 20.5 Dev `?file=` → default OFF + permission gate CFDI_VIEW_PDF + basename ext check final
- **Regla Obligatoria:** Variable env `INVOICE_PDF_ENABLE_FILE_PARAM_IN_DEV` = **`false`** por omisión. Cualquier entorno DEV que quiera habilitarla debe activarla explícitamente.
- Cuando `enable=true`, **antes de `resolveDevXmlFileSafe`** se **DEBE** correr `hasPermission(session.user.id, targetOrg, 'CFDI_VIEW_PDF')` (viewer/auditor sin permiso nunca puede cargar file= incluso en dev).
- Resolver path con `path.resolve(SAFE_BASE_DIR, raw)` primero, luego extraer `path.basename(resolved)` → comprobar **solamente sobre basename final** que termine `.xml` (nunca sobre raw query string con `.xml` en el medio: `report/.tmp.xml.zip` debe ser rechazado).
- Path traversal defense: comparar `normalizedCandidate.startsWith(normalizedBase + '/')` post resolve.

### 20.6 HTTP Response Splitting → sanitizePdfFilename 6 defensas
- **Regla Obligatoria:** Secuencia exacta: (1) strip %XX url-encoded ANTES de reemplazar `%` con underscore, (2) drop null/cr/lf literales, (3) `[^\w.\-]` → underscore, (4) blacklist regex: `set-cookie`, `content-type`, `content-disposition`, `mime-version`, `x-*` → `_REDACT_`, (5) length ≤ 64 chars, (6) `Content-Disposition` dual RFC 6266: `filename=${JSON.stringify(safe)}; filename*=UTF-8''${encodeURIComponent(safe)}`.

---

### 20.7 Mapping Cross-check con reglas AGENTS oro
| Regla INV derivada | Regla Oro AGENTS impactada |
| --- | --- |
| 20.1 InvoiceBlob org scope mandatory | Regla 12 (Separación datos sensibles / OLTP), Regla 10 (Roles permisos) |
| 20.2 Crypto AEAD whitelist | Regla 12 (Seguridad XML), Regla 13 (Helpers compartidos same runtime) |
| 20.3 Puppeteer ≤5 tabs + TTL | Regla 7 (Workers BullMQ concurrency limit) |
| 20.4 await rateLimit + Uint8Array Next15 | Regla 11 (Build), Regla 13 (Runtime helpers compartidos) |
| 20.5 dev file= OFF + permission gate | Regla 10 (Permisos granulares / dev NO excepción) |
| 20.6 Splitting 6 defensas | Regla 3 (Safe errors + fingerprint 32 safe logs) |

---

## 🏗️ 21. Patrones de Seguridad Cross-Check Obligatorios para /api/mass-downloads (Descargas Masivas SAT / FIEL)
> Derivados del ciclo SAST MD-001..MD-014 (14 findings: 3C / 7A / 3M / 1B).
> Estas reglas refuerzan multi-tenant scope BOLA 2-step, CSV/DDE injection protection, AES-GCM fail-closed, BullMQ async 202, Redis no-defaults, safeErrSummary PII zero-leaks y permisos 3 args.

### 21.1 hasPermission signature exactamente 3 args (NO 4to argumento role manual)
- **Regla Obligatoria:** Cualquier invocación de `hasPermission()` en rutas `/api/mass-downloads/**` **DEBE** usar la firma exacta `hasPermission(user: SessionUser, permission: Permission, organizationId?: string)` — máximo 3 argumentos.
- El 4to argumento `role` está **PROHIBIDO** por diseño: la función `hasPermission` busca `member.role` internamente dentro de `user.memberships` find `organizationId === targetOrgId && status === APPROVED`. Pasar role manual genera role-forge IDOR.
- Permisos obligatorios para rutas mass:
  - `CFDI_REQUEST_MASSIVE` (Solicitudes SAT): POST `/mass-downloads/requests`
  - `CFDI_DOWNLOAD_MASSIVE` (Descarga ZIPs): GET `/mass-downloads/package-downloads`
  - `CFDI_FIEL_CREDENTIALS` (Alta FIEL): POST `/mass-downloads/credentials`
  - `DASHBOARD_FISCAL_VIEW` + `DASHBOARD_FISCAL_EXPORT` (Panel + CSV): `fiscal-control` + `fiscal-control/export`

### 21.2 Zod strictBody + UUID RFC 4122 estricto en POST handlers
- **Regla Obligatoria:** Todos los esquemas Zod de body en POST `/mass-downloads/**` **DEBEN** usar `z.strictObject()` (nunca `z.object()` sin strict) para prevenir Overposting / Prototype Pollution (MD-003).
- UUID regex **OBLIGATORIO** RFC 4122 (5 grupos hex separados por guion, estricto):
  ```ts
  export const UUID_RFC4122 = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
  ```
- **PROHIBIDO** usar UUIDs de formato propietario 28 chars `cmnntrppk000502gcp93ketfx` en parámetros que aceptan UUID V4. El esquema Zod debe **RECHAZARLOS** con `ZodError invalid_string`.

### 21.3 Resolver Company.organizationId → patrón 2-step obligatorio (FiscalEntity + CompanyAccess fallback)
- **Regla Obligatoria:** El modelo Prisma `Company` **NO TIENE** scalar field `organizationId` ni `fiscalEntityId`. Cualquier lookup scope tenant que use `company.{rfc,id}` **DEBE** resolver la organización con este patrón exacto:
  1. **Paso 1 (preferido):** `FiscalEntity.findFirst({ where: { rfc: company.rfc, isActive: true }, select: { organizationId: true } })` → `targetOrgId`
  2. **Fallback Paso 2:** `CompanyAccess.findFirst({ where: { companyId: company.id }, select: { organizationId: true } })` → `targetOrgId`
  3. **Validación Final BOLA:** `targetOrgId ∈ orgIdsAllowed` (Set de `user.memberships[APPROVED].organizationId`). Si `false` → HTTP 403 genérico (no revelar existencia cross-tenant).
- **PROHIBIDO:** `where: { organizationId: xxx }` directamente sobre tabla `Company` (el campo no existe → SQL error o leak).

### 21.4 CSV Export: max 100_000 rows + DDE 2-phase + UTF-8 BOM \uFEFF
- **Regla Obligatoria:** Límite duro `MASS_DOWNLOADS_EXPORT_CSV_MAX_ROWS = 100_000` (env override). Si `rows.length > max` → error 413 Payload Too Large, generar particiones o reducir rango de fechas.
- **Secuencia OBLIGATORIA escapeCsvValue() (DDE luego CSV):**
  1. **Fase 1 (DDE Prevention, SIEMPRE PRIMERO):** Si el string empieza por regex `/^[=+@\t\r-]/` → prepend `'` (apóstrofo literal Excel NO es comilla). `+IMAGE(cmd.exe /c calc)` → `'+IMAGE(...)`
  2. **Fase 2 (CSV Quoting):** Si el valor contiene `,` o `"` o `\n` o `\r` → encapsular en `double-quote` `"..."` y escapar cada `"` interno → `""`
- **UTF-8 BOM OBLIGATORIO:** Buffer CSV SIEMPRE empieza por `\uFEFF` (2 bytes U+FEFF) para que Microsoft Excel Spanish Latam interprete correctamente acentos, ñ, y símbolos monetarios $/MxN.
- **PROHIBIDO:** `JSON.stringify(cell)` como quoting CSV (escapa incorrectamente comas internas, rompe DDE fase 1 si empieza por `=+`).

### 21.5 Crypto Whitelist INVOICE_CIPHER_WHITELIST + Fail-Closed sin fallback insecure
- **Regla Obligatoria:** Whitelist Set AEAD-only en `src/lib/encryption.ts`:
  ```ts
  export const INVOICE_CIPHER_WHITELIST: ReadonlySet<string> = new Set(['aes-256-gcm', 'aes-128-gcm'])
  ```
- Validación algoritmo: `(algorithm||'').toString().trim().toLowerCase()` ANTES `Set.has()` (case + whitespace bypass prevention).
- Length asserts AES-GCM: `ivLength = 12 bytes (96 bits, NIST standard)`; `authTagLength = 16 bytes (128 bits)`; NO aceptar longitudes menores (forja authTag).
- **Fail-Closed PRODUCCIÓN:** `if (NODE_ENV === 'production' && !DATA_ENCRYPTION_KEY) throw FATAL` (MD-007). **PROHIBIDO ABSOLUTAMENTE** fallback hardcodeado `dev-insecure-key-do-not-use-in-prod` 16 bytes como default.
- Enforce 32 bytes (AES-256) por defecto: env `DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES=true` default, key length `!==32` → `throw assertValidEncryptionKeyLength`.

### 21.6 BullMQ queue Redis: Fail-Closed, NO default localhost:6379 authless
- **Regla Obligatoria:** Puerto Redis validado estrictamente por `validateRedisPort(raw)`:
  - `raw === undefined | null | ''` → throw inmediato (Missing Port).
  - `Number(raw)`: `!isFinite || !isInteger || <1 || >65535` → `throw Error('[Queue Fail-Closed] REDIS_PORT must be integer 1-65535; got: ' + raw)`.
  - **PROHIBIDO:** default fallthrough `6379` (security anti-pattern connection authless abierta por defecto).
- **Require Auth Producción:** `MASS_DOWNLOADS_REDIS_REQUIRE_AUTH=true || NODE_ENV===production` IMPLICA: `REDIS_PASSWORD` exista O `REDIS_URL` contenga `user:pass@` o `:password@` antes del host. Si no se cumple → `throw` FATAL antes de `new Queue(...)`.

### 21.7 SAT descarga masiva: BullMQ asíncrono HTTP 202 Accepted <50ms (NO sync 90s)
- **Regla Obligatoria:** Ruta `POST /mass-downloads/requests` (Solicitudes SAT) **NUNCA** invoca `SATClient.SolicitaDescargaMasiva()` de forma síncrona (tarda 45-90s, bloquea Node event loop, 504 Gateway Timeout nginx default 60s upstream).
- Handler SECUENCIA OBLIGATORIA:
  1. Parse + Zod strictBody validación → `targetOrgId` (2-step pattern 21.3).
  2. `hasPermission(user, Permission.CFDI_REQUEST_MASSIVE, targetOrgId)` 3 args.
  3. `prisma.massDownloadRequest.create({ data: { status: SOLICITADO, jobId, companyId, ... } })` (DB record).
  4. `queue.add('init-mass-download-request', payload, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: 10, jobId })`.
  5. Responder **HTTP 202 Accepted** `{ requestId: record.id, jobId, status: 'SOLICITADO', acceptedAt: ISO }` en <50ms.
- **Compensatorio Fail-Safe:** Si `queue.add()` lanza excepción → actualizar record DB a `status: FALLIDO_COLA, errorMessage: queue-fail + fingerprint` y enqueue delayed 30s job en `massVerificationQueue` fallback retry.

### 21.8 safeErrSummary: PII 3-layer redact + fp32 msgHash 32 chars (discriminante .name)
- **Regla Obligatoria:** Cualquier `catch(e)` en `/api/mass-downloads/**` que responda HTTP 500 **DEBE** usar `safeErrSummary(e)` y **JAMÁS** exponer `e.message | e.stack` crudos al cliente. Funciones en `src/lib/security.ts`:
  1. `REDACT_SECRETS` regex: `/(secret|token|password|apikey|api_key|client_secret|fiel)=[^\s&"'`)]{4,}/gi` → `${name}=[REDACTED]`
  2. `REDACT_IP_RFC1918` regex: IPs `10.x.x.x | 172.(16-31).x.x | 192.168.x.x | 127.0.0.1 | ::1 | localhost` → `[REDACTED-IP]` (SAT internal gateways 172.16 no leak)
  3. `REDACT_PATHS` regex: `C:\\ | C:\\\\ | /app/ | /src/ | node_modules | private-server | sat-ws | \.ts:\d+ | \.js:\d+` → `[REDACTED-PATH]`
- **fp32 msgHash correlación id:** `fingerprint(e.message + '|' + (e.stack||'').slice(0,120)).slice(0, 32)` = 32 chars hex, NO leak info sensible pero permite correlacionar log server ← response cliente.
- **TypeScript Discriminated Union:** `safeErrSummary(e)` retorna shape `{ name: SafeErrorSummaryName; msgHash: string; friendly: string; ... }` → **usa `name` campo discriminante, NUNCA `.category`** (rompió tests MD-004/010, `s.name` narrowing).

---

### 21.9 Mapping Cross-check con reglas AGENTS oro
| Regla MD derivada | Regla Oro AGENTS impactada |
| --- | --- |
| 21.1 hasPermission 3 args (MD-001/002/006) | Regla 10 (Permisos granulares), Regla 1 (Zod) |
| 21.2 Zod strictBody + RFC4122 UUID (MD-003/009) | Regla 1 (Zod First Strict) |
| 21.3 2-step Company orgId resolver (MD-001/002 BOLA) | Regla 12 (Big Data OLTP/Desacoplado), Regla 4 (Prisma N+1) |
| 21.4 CSV DDE 2-phase + UTF-8 BOM (MD-005/011) | Regla 9 (Drilldowns CSV BOM) |
| 21.5 Crypto AEAD Whitelist + Fail-Closed (MD-007) | Regla 12 (Seguridad XML Cifrado) |
| 21.6 Redis No-Default queue (MD-013) | Regla 7 (BullMQ Workers Concurrency 5) |
| 21.7 SAT BullMQ Async 202 Accepted (MD-012) | Regla 7 (Tareas Asíncronas BullMQ + Backoff Exp) |
| 21.8 safeErrSummary PII redact (MD-010/014) | Regla 3 (Errores Estructurados + fingerprint) |

---

## 🏗️ 22. PRODUCTION_DEPLOY_GA_AUTH · Reglas OBLIGATORIAS para salir a Producción (Auth Trust Host Safe)
> **Origen RC**: Ciclo 2026-09-01 RC "Sin empresas en button sidebar" tras login exitoso → logs server confirmaron `[auth][error] UntrustedHost: Host must be trusted. URL was: http://localhost:3000/api/auth/session` → `auth()` retorna `null` → `/api/user/company-access 401` → sidebar `setFiscalEntities([])`.
> **Resolución aplicada**: 2 puertas de cálculo separadas (DEV permisivo para localhost / IPs locales; PRODUCCIÓN estrictamente allowlist-only).
> **Registro detallado**: Ver `project_memory.md` sección `Deploy GA · Checklist AUTH & Trusted Host`.

### 22.1 Regla Obligatoria · NODE_ENV Gate en ambos configs Auth
**NUNCA** hacer cálculo `trustHost = true || NODE_ENV !== 'production'` unificado. Siempre **puerta separada**:
- [`auth.ts L251-L272`](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/auth.ts#L251-L272) factory dinámico: `if (isProd) trustHost = strictlyTrusted else trustHost = strictlyTrusted || isLocalDevHost || AUTH_TRUST_HOST`.
- [`.env.example`](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/.env.example) sección 2 `FEATURE_STRICT_AUTH_TRUST=1` (GA) O `=0` (DEV).

### 22.2 Regla Obligatoria · auth-middleware.ts NO usar factory dinámico `NextAuth(request => {...})`
**PROHIBICIÓN ABSOLUTA**: Declarar `export const authMiddleware = NextAuth(request => {...})` en [auth-middleware.ts](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/auth-middleware.ts) **ROMPE** [proxy.ts L83](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/proxy.ts#L83) `export const proxy = authMiddleware(onRequest)` con error runtime:
```
Error: The Proxy file "/proxy" must export a function named `proxy` or a default function.
```
**Formato correcto obligatorio**: [auth-middleware.ts L66-L70](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/auth-middleware.ts#L66-L70) `NextAuth({ ... trustHost: _trustHostValue ... })` objeto literal, donde `_trustHostValue = envTrustHost()` (cálculo top-level sincrónico basado en ENVs sin request).

### 22.3 Regla Obligatoria · Cookies Secure flag en PROD
**Paridad obligatoria** en ambos lugares auth:
1. `src/lib/auth.ts L58 authOptionsBase.useSecureCookies = NODE_ENV === "production"`.
2. `src/auth-middleware.ts L70 = useSecureCookies: _isProdRuntime`.

Sesión en PROD se llama `__Secure-authjs.session-token` (con prefijo `__Secure-`). Si aparece sin prefijo en PROD → NODE_ENV no está seteado o está roto el build.

### 22.4 Regla Obligatoria · Auth Secrets MATCH
- `AUTH_SECRET === NEXTAUTH_SECRET` en todas las capas (dev/test/prod). Si difieren: cada request alterna secret de desencriptación de cookie → session = null intermitente → login roto 50% requests.
- Longitud mínima: 32 chars (recomendado ≥ 64 chars hex).

### 22.5 Regla Obligatoria · PUBLIC_HOSTS_ALLOWLIST en PROD
Regla de oro: PROD nunca debe depender de AUTH_TRUST_HOST=true.
- DEV: `PUBLIC_HOSTS_ALLOWLIST` localhost/127/10.x está OK.
- PROD: Listado **SOLO** hosts públicos reales (app.tu-dominio.com, api.tu-dominio.com, túnel QA si aplica). SIN localhost, SIN 127.0.0.1, SIN RFC1918 privadas.
- Si el deploy está detrás de ALB / Cloudflare / nginx: **asegurarse** que el header `X-Forwarded-Host` se propague y coincida con dominios reales del allowlist. Hosts tipo `internal.k8s.svc.cluster.local` NO deben estar.

### 22.6 Kill-Switch Inmediato (Host Allowlist mal poblado)
Si después del deploy GA aparece UntrustedHost (session = null para todos los usuarios, 401 en /api/user/company-access):
1. Emergencia: setear `AUTH_TRUST_HOST=true` temporal, reiniciar pods `npm run start`.
2. Fix: Levantar log request headers entrantes `req.headers.get('host')` y `x-forwarded-host`, agregar los hosts reales a PUBLIC_HOSTS_ALLOWLIST.
3. Rollback kill-switch: a las 24h quitar `AUTH_TRUST_HOST` (borrar variable o set false).
4. Refuerzo: set `FEATURE_STRICT_AUTH_TRUST=1` (impide que alguien en el futuro vuelva a activar bypasses sin tocar allowlist).

### 22.7 Checklist mínimo pasos GA deploy
1. Secret Manager set correctamente (AUTH/NEXTAUTH iguales, DB SSL, Redis TLS).
2. `PUBLIC_HOSTS_ALLOWLIST` sin hosts locales; `FEATURE_STRICT_AUTH_TRUST=1`.
3. `npm run build` exit 0; Proxy muestra `✔ Proxy (Middleware)`.
4. Smoke post-deploy:
   - Login Credentials Provider y Google.
   - F12 Cookies: `__Secure-authjs.session-token` Secure=YES.
   - Button sidebar empresas: `/api/user/company-access` status **200**, **no 401**, **no UntrustedHost**.
   - `/companies` carga cards; `/dashboard/rh` autoselecciona tenant sin pantalla vacía.
5. Burp/curl: forzar `Host: evil.com` → response no firma cookie nueva, no devuelve 200 /api/user/company-access.

### 22.8 Archivos cruzados referencia obligatoria cierre deploy
| # | Archivo · Líneas clave | Propósito |
|---|---|---|
| 1 | [auth.ts L34-L53](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/auth.ts#L34-L53) | isHostTrustedStrict (cálculo strict central) |
| 2 | [auth.ts L251-L272](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/auth.ts#L251-L272) | NextAuth factory NODE_ENV gate strict=true solo PROD |
| 3 | [auth-middleware.ts L31-L70](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/auth-middleware.ts#L31-L70) | envTrustHost() + NextAuth({...}) objeto literal (SIN factory dinámico para no romper proxy) |
| 4 | [proxy.ts L1-L91](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/proxy.ts#L1-L91) | triple export proxy/middleware/default |
| 5 | [security.ts L22-L28](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/security.ts#L22-L28) | getPublicHostsAllowlist parse CSV |
| 6 | [.gitignore L33-L36](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/.gitignore#L33-L36) | .env* protegidos; solo !.env.example / !.env.test commiteables |
| 7 | [.env.example](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/.env.example) | plantilla pública 8 secciones SIN secrets |

---

## 🛡️ 23. Confirmación EXPLÍCITA para Borrado / Limpieza de Datos en Cualquier Base de Datos (DEV / TEST / STAGING / PROD)

> **Regla Obligatoria de Gobierno de Datos:** Todo cambio que implique **borrar, truncar, resetear, perder o sobrescribir datos** de una base de datos del proyecto requiere **confirmación EXPLÍCITA del usuario responsable** **ANTES** de ejecutar **cualquier** comando o script destructivo. No existen excepciones por "urgencias", "pruebas rápidas", "data loss aceptado implícito" o "todos los datos son de demo".
>
> Esta regla aplica a **todos los ambientes** (DEV, TEST, STAGING, PROD). Incluso si la base DEV solo tiene datos ficticios o de prueba, **aún así** se requiere la confirmación por escrito para generar hábito operativo y evitar que el comportamiento se normalice en entornos productivos.

### 23.1 Ámbitos que DISPARAN la regla (lista NO exhaustiva)

La confirmación explícita es obligatoria cuando el agente tenga que ejecutar, sugerir o preparar cualquiera de las siguientes operaciones:

| Grupo | Operaciones Destructivas | Ejemplos Concretos |
|---|---|---|
| 🗑️ **Borrado total de datos de la BD** | `prisma migrate reset`, `prisma migrate reset --force`, `DROP SCHEMA`, `DROP DATABASE`, reinicio de volúmenes Postgres, `docker volume rm` de Postgres/Redis con datos persistentes. | `npx prisma migrate reset --force` |
| 🔥 **Eliminación selectiva masiva** | SQL `TRUNCATE`, `DELETE FROM` sin `WHERE` o con `WHERE` que afecte toda la tabla, `prisma.model.deleteMany({})` vacío o de scope global. | `await prisma.user.deleteMany({})` · `TRUNCATE public.invoices, public.payroll_receipts RESTART IDENTITY;` |
| ⚠️ **Operaciones con data loss potencial** | `prisma db push --accept-data-loss`, `ALTER TABLE ... DROP COLUMN` sin etapa backfill previa, `--force` en migraciones, `prisma migrate resolve --rolled-back` múltiples en cadena sin validación. | `npx prisma db push --accept-data-loss` |
| 🔁 **Sobrescritura de datos existentes** | Cualquier `pg_restore --clean`, importe masivo CSV/XML que haga `INSERT ON CONFLICT DO UPDATE` sobre registros existentes, seed que usa `createMany` duplicado sin upsert. | `pg_restore --clean --dbname=platfi_intelligence_demo` |
| 💾 **Acciones administrativas de reinicio de esquema** | `prisma migrate diff + db execute` destructivo, `pg_resetwal`, recreación de constraints PK/FK sin previa exportación, borrado de índices / vistas materializadas útiles sin reemplazo validado. | `DROP MATERIALIZED VIEW mv_fiscal_conciliacion_mensual;` sin CREATE posterior |

### 23.2 Formato OBLIGATORIO de Confirmación (NO se aceptan respuestas cortas ambiguas)

Antes de ejecutar **cualquier** operación destructiva, el agente **DEBE** presentar al usuario **en texto claro** los 5 acápites siguientes y esperar su **respuesta explícita por escrito** (una aseveración corta como "Sí, procede" **NO es suficiente**):

```
⚠️  SOLICITUD DE CONFIRMACIÓN EXPLÍCITA — OPERACIÓN DESTRUCTIVA SOBRE BASE DE DATOS

  1. Ambiente afectado : (DEV / TEST / STAGING / PROD)
  2. Base de datos     : (nombre DB, p. ej. platfi_intelligence_demo)
  3. Operación a realizar : (nombre comando o acción exacta, 1 línea)
  4. Qué datos SE PERDERÁN : (listado explícito tablas / scope · p. ej. users, companies,
                                invoices, payroll_receipts, todas las filas)
  5. Existe backup ANTES de ejecutar? : (SÍ / NO · ubicación backups/dev/...)

  Para CONFIRMAR y proceder, responde EXACTAMENTE con 3 frases, cada una en su propia línea:

     ACEPTO_EXPRESAMENTE_EL_BORRADO_DE_DATOS_EN_[NOMBRE_DB]
     HE_LEIDO_QUE_ESTA_OPERACION_NO_ES_REVERSIBLE_SIN_BACKUP
     AUTORIZO_AL_AGENTE_A_EJECUTAR_LA_OPERACION_[NOMBRE_OPERACION]
```

El agente **DEBE** bloquear la ejecución hasta que reciba las 3 frases completas. Si el usuario responde cualquier variante abreviada, debe volver a presentar la solicitud y explicar: *"Para proceder necesito las 3 frases de confirmación exactas; tu respuesta no cumple el formato AGENTS Regla 23.2"*.

### 23.3 Las 3 Puertas OBLIGATORIAS (Protección Cumulativa · NO se salta ninguna)

Incluso **después** de recibir la confirmación escrita, el agente **DEBE** ejecutar **forzosamente** los siguientes pasos en estricto orden. Si cualquiera falla, ABORTA:

1. **⛨ Puerta 1 · Backup inmediato OBLIGATORIO:**
   - Si el ambiente es DEV → ejecutar **antes de nada**: `npm run db:backup -- -Tag "ANTES_[OPERACION]_[FECHA_HORA]"`
   - Si el ambiente es TEST / STAGING / PROD → validar que exista un snapshot/backup realizado en las últimas 24 horas y **nombrar el archivo exacto** o ID del snapshot al usuario. En caso de no existir, **ABORTAR**.
   - Registro obligatorio: imprimir al usuario el nombre exacto del .dump / snapshot y su ruta absoluta antes de continuar.

2. **⛨ Puerta 2 · Ejecutar el comando DESTRUCTIVO (Reset/TRUNCATE/DELETE/etc.):**
   - Usar siempre el wrapper oficial `npm run reset:db:safe` para operaciones de tipo "reset completo" en DEV (no comandos `prisma migrate reset` a pelo).
   - Si la operación es un SQL custom (TRUNCATE/DROP): envolver en `BEGIN; ...; COMMIT;` con `SAVEPOINT` de seguridad intermedio para poder `ROLLBACK` si algo sale mal en la misma sesión.
   - Prohibido flags `--yes`, `-y`, o flags de "autoacepto" en comandos destructivos a menos que el usuario lo haya añadido en su confirmación explícita.

3. **⛨ Puerta 3 · Repoblamiento / Cross-check post-operación:**
   - Si la operación borró todo → ejecutar **automáticamente** el seed correspondiente:
     - DEV con data demo → `npm run seed:dev` (onboarding + 500 CFDIs + refresh MVs).
     - DEV sin data demo → `npm run onboarding:full` (solo estructura + usuario inicial).
     - TEST → `npm run db:test:seed` fixtures.
   - Cross-check obligatorio: imprimir al usuario **al menos 4 conteos** de tablas críticas para que confirme visualmente que quedó correcto:
     ```
     users = 2, companies = 7, members_approved = 2, mv_fiscal_conciliacion_mensual rows = NNN
     ```
   - Si los conteos difieren del esperado (p. ej. users = 0 cuando debería ser 2) → notificar y ofrecer rollback inmediato con `npm run db:restore`.

### 23.4 Prevención de "Error de Músculo" (Muscle Memory)

- **PROHIBICIÓN EXPLÍCITA:** El agente **NO DEBE** ejecutar operaciones destructivas en la misma respuesta que diagnostica un error o presenta un plan. La secuencia debe ser SIEMPRE: (1) Diagnóstico → (2) Plan de fix (incluye la confirmación 23.2) → (3) **ESPERAR** confirmación → (4) Puerta 1 Backup → (5) Puerta 2 Ejecución → (6) Puerta 3 Repoblamiento.
- **Prohibido** concatenar en una sola sesión "backup + reset + seed" sin el artefacto de confirmación escrito, por mucha urgencia que exprese el usuario (si realmente hay urgencia, le tomará ≤ 30 segundos escribir las 3 frases).
- **Aplicación a Pruebas/Tests:** Incluso si la operación se realiza sobre la base de datos de TEST (puerto 5434) o si los datos son fixtures descartables, se sigue la misma regla para generar el hábito y prevenir que un typo de puerto (`5434` → `5433`) borre DEV sin aviso.

---

## 🏗️ 24. Entrega Oficial de Base de Datos Vacía para Salida a Producción

> **Regla Obligatoria:** Cuando el usuario exprese frases como *"voy a salir a producción"*, *"necesito la DB vacía para PRD"*, *"entregar base limpia"*, *"inicializar prod sin datos demo"* o equivalentes, el agente **DEBE** seguir estrictamente el siguiente procedimiento estandarizado y **NO** debe "vaciar tablas manualmente" ni hacer DELETE/TRUNCATE ad-hoc sin artefacto de entrega. El producto final de esta regla es **un script oficial y una documentación de firma** que el usuario puede archivar para auditaría / QA sign-off.

### 24.1 Alcance y Definición: "Base de Datos Vacía de Producción"

Se considera "base vacía lista para PROD" a una base de datos PostgreSQL que cumple TODAS estas condiciones:
1. **Estructura 100% alineada al `prisma/schema.prisma`**: 35+ migraciones Prisma aplicadas, `_prisma_migrations` consistente, sin desvíos de schemas entre DEV y PRD.
2. **Índices, Constraints, Vistas y Funciones Operativas**:
   - MV `mv_fiscal_conciliacion_mensual` creada (sin datos), UNIQUE INDEX + índice compuesto INCLUDE(18).
   - 4 Partial Indexes del hardening fiscal aplicados.
   - 6 MVs RH + función `refresh_hr_materialized_views(boolean)` compilada.
3. **Datos MÍNIMOS requeridos (≠ datos demo)**:
   - ✅ 1 Super Administrador (contraseña que el usuario DEFINA en ese momento, NUNCA usar `Admin_Itcomplements_Demo_2026!`).
   - ✅ 1 Organización (vacía, sin nombre "Demo", sin onboarding completado por defecto).
   - ✅ Roles RBAC mínimos (`SUPER_ADMIN`, `ADMIN`, `MEMBER`, `VIEWER`) enums Prisma.
   - ✅ Tabla `granularPermissions` con switches poblados por módulo (pero 0 empresas, 0 usuarios miembros, 0 CFDIs).
4. **PROHIBICIÓN ESTRICTA (NO puede contener la base PRD inicial):**
   - ❌ 0 filas de CFDIs / facturas / nóminas demo.
   - ❌ 0 empresas seed de los 7 RFCs target.
   - ❌ 0 usuarios adicionales (solo el Super Admin inicial de PROD).
   - ❌ 0 registros `payroll_*`, `invoices`, `sat_invoices`, `import_runs` o `mass_downloads` demo.
   - ❌ Contraseñas literales / tokens / secrets hardcodeados en migraciones o seed.

### 24.2 Procedimiento de 7 Pasos (Cadena de Custodia / Firma por Ambiente)

El agente **DEBE** ejecutar y documentar estos pasos en orden cuando llegue el momento:

```
Fase A · Preparación (1-4):
 1. Tomar snapshot FINAL del estado de DEV que se desea reflejar en PRD:
     npm run db:backup -- -Tag "FINAL_DEV_PRE_PRD_DEPLOY_YYYYMMDD"

 2. Validar migraciones:
     NODE_ENV=production npx prisma migrate deploy  contra una DB PRD vacía (template0),
     asegurando: "All migrations applied successfully" + 0 warnings P3008/P3018.

 3. Aplicar scripts SQL NO-migraciones (MV fiscal + hardening):
     scripts/sql/20260902203000_mv_fiscal_conciliacion_mensual.sql
     scripts/sql/20260902203100_fiscal_hardening_scale.sql

 4. Cross-check Estructura (ANTES de insertar datos mínimos):
     ✅ 12 tablas public.payroll_* existentes en information_schema.tables
     ✅ MV mv_fiscal_conciliacion_mensual + 2 índices (to_regclass)
     ✅ 6 MVs RH + función refresh_hr_materialized_views
     ✅ Todas las constraints FK/PK definidas en schema.prisma

Fase B · Inicialización Mínima (5):
 5. Ejecutar seed "PROD MÍNIMO" (NO ejecutar npm run seed:dev ni seed 500 CFDIs):
       scripts/seed-production-minimal.mts  (véase 24.3)
    Este seed DEBE pedirle al usuario en tiempo real:
       - Nombre de la organización real de PROD
       - Email real del Super Admin inicial
       - Password TEMPORAL (que debe ser cambiada en el primer login)
       - Opcionalmente: Nombre / RFC / CIF de la primera empresa a incorporar (se crea en status DRAFT)

 6. Cross-check Mínimos Seguridad:
      users = 1 (el Super Admin PRD)
      organizations = 1 (nombre real del cliente/grupo)
      companies = 0 ó 1 DRAFT (si se agregó la primera empresa)
      members_approved = 1
      invoices + payroll_receipts + payroll_receptors = 0 C/U
      accounts tipo credentials = 1 (solo admin PRD)
      sessions = 0

Fase C · Entregables y Firma (6-7):
 7. Generar en reports/ los 4 artefactos de firma obligatorios:
       reports/prd-db-init-YYYYMMDD/
         ├─ 01_Resumen_Entrega_BD_Vacia_PROD.html          (Resumen ejecutivo no técnico)
         ├─ 02_Inventario_Estructura_Tablas_MV_PROD.csv    (1 fila por tabla/índice/MV)
         ├─ 03_Matriz_Riesgos_Residuales_QA_Sign_Off.html  (Riesgos residuales post-entrega)
         └─ 04_Checklist_QA_Sign_Off_PROD.csv              (Checklist de aprobación QA + Director)
```

### 24.3 Script Oficial: `scripts/seed-production-minimal.mts`

Cuando se solicite la entrega de DB vacía, el agente **DEBE** crear (o actualizar, si ya existe) este script con las siguientes invariantes:

- **No importa módulos de seeds DEV** (no puede reutilizar el arreglo de 7 RFCs demo ni las contraseñas literales del entorno DEV).
- Solicita 3 inputs al usuario al ejecutar (ya sea por prompt o por flags): `--org-name`, `--admin-email`, `--admin-password-temp`.
- Aplica validaciones rigurosas:
  - Contraseña ≥ 16 chars, 4 clases (mayúscula, minúscula, dígito, símbolo).
  - Email del admin **NO coincida** con `admin@itcomplements.com` o `rtorreh@itcomplements.com` (usuarios demo).
  - Nombre organización **NO sea** `Grupo Demo ITComplements` o similares.
- Usa **transacción atómica** (`prisma.$transaction`) para que si algo falla no queden organizaciones huérfanas.
- Registra en `audit_logs` o tabla equivalente el evento con: `event = 'DB_PROD_INITIALIZED'`, actor, timestamp, hash SHA-256 del script ejecutado.

### 24.4 Check de Seguridad Anti-Escapes de Datos

Como parte del paso 6 de la regla, el agente **DEBE** ejecutar y reportar los resultados de estas 4 queries de auditoría sobre la base PRD:

```sql
-- A) Total de datos demo residuales DEV que se habrían colado
SELECT 'DEMO_DATA_USERS'  AS esc, COUNT(*) AS c FROM public.users  WHERE email IN ('admin@itcomplements.com','rtorreh@itcomplements.com');
SELECT 'DEMO_DATA_COMP'   AS esc, COUNT(*) AS c FROM public.companies WHERE rfc IN ('ODE8604257UA','NMP7502257ZA','QA2414521FJW','QA27383427M8','QA27301176NC','QB2983782QT1','QB26123630CU');
SELECT 'DEMO_DATA_CFDIS'  AS esc, COUNT(*) AS c FROM public.payroll_receipts WHERE source = 'SEED_DEMO_500_CFDIS_V1';
SELECT 'DEMO_DATA_INVOICES'  AS esc, COUNT(*) AS c FROM public.invoices WHERE source ILIKE '%demo%';
```

Cada query debe devolver **COUNT = 0**. De haber cualquier fila >0, se reporta como **NO APTO PARA PRODUCCIÓN** y se limpia (con la confirmación obligatoria de la Regla 23.2 por ser una operación borrado selectivo).

### 24.5 Rollback del Paso de Entrega

Si durante el cross-check final se detectan datos demo residuales o estructura inconsistente:
1. **NO hay que borrar tablas individualmente con TRUNCATE.**
2. Se recomienza la cadena desde el paso 2 (deploy migraciones) contra una DB PRD **nueva, recién creada desde `template0`** para asegurar pureza.
3. Si el entorno PRD es gestionado (AWS RDS, GCP Cloud SQL, Azure PostgreSQL), se emite además una instrucción de revocar conexiones superuser/owner no autorizadas y activar `rds.restrict_password_profiles` o política equivalente.

---



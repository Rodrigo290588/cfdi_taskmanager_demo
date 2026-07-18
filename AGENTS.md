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

**Regla Obligatoria de Aplicación:**
- Esta checklist debe considerarse parte del diseño por defecto en todo desarrollo nuevo del proyecto.
- Si una implementación decide no aplicar uno de estos puntos, debe existir una justificación técnica explícita y documentada dentro de la solución o su documentación asociada.
   

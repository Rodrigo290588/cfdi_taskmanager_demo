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
   - **Flujo Requerido:**
     1. `git add .`
     2. `git commit -m "feat/fix: descripción clara de los cambios"`
     3. `git tag -a vX.X.X -m "Descripción de la versión"` (Usando Versionamiento Semántico: Mayor.Menor.Parche).
     4. `git push origin <rama>`
     5. `git push origin --tags`
   - Esto asegura que siempre haya una foto exacta del código (release/tag) correspondiente a las nuevas funcionalidades subidas.

9. **Patrón de Reportes Desglosados (Drilldown Popups):**
   - **Regla Obligatoria:** Cuando se implemente un desglose de datos (Drilldown) al hacer clic en una tarjeta o métrica, se debe seguir estrictamente este patrón de UI/UX y Funcionalidad:
     - **Pantalla Completa:** El Dialog (Modal) debe abarcar el 100% de la pantalla para maximizar el área de datos usando las clases `!max-w-[100vw] !w-screen !max-h-screen !h-screen border-0 rounded-none m-0 inset-0 translate-x-0 translate-y-0`.
     - **Resumen Superior:** El encabezado debe mostrar claramente qué filtros originaron esa consulta (ej. Empresa, Rango de Fechas exacto de la base de datos) y un desglose de la sumatoria principal (ej. PUE vs CRP).
     - **Tabla y Scroll:** La tabla debe estar envuelta en un contenedor con `flex-1 min-h-0 overflow-hidden flex flex-col [&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full` para garantizar que el scroll horizontal siempre se mantenga fijo en la base del monitor y no se pierda al bajar los registros.
     - **Filtros por Columna:** Debajo de los títulos (`TableHeader`), debe existir una segunda fila (`TableRow`) que contenga un `<Input>` por cada columna. Esto debe filtrar en tiempo real (usando `useMemo` y `.toLowerCase().includes()`) los datos en memoria (`drilldownData`).
     - **Columnas Comunes:** El campo UUID siempre debe ir con tipografía `font-mono`. Si hay un UUID Relacionado, debe truncarse con `max-w-[120px] truncate` y mostrar su valor completo al hacer hover (`title="..."`). Separar el Folio de la Serie en dos columnas distintas.
     - **Exportación y Totales:** La fila de "Total" y la función de "Exportar a Excel (CSV)" **solo deben considerar los registros actualmente visibles/filtrados** (`filteredDrilldownData`). El CSV debe inyectar el BOM UTF-8 (`\uFEFF`) antes del contenido para evitar problemas de codificación de caracteres especiales (acentos, ñ) al abrirse en Microsoft Excel.
   

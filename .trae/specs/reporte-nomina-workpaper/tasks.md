# Tasks
- [x] Task 1: Actualizar navegación en Sidebar
  - [x] SubTask 1.1: Modificar `src/components/layout/sidebar.tsx` para agregar el sub-menú "Reporte de Nómina" bajo el menú principal "Nómina".
- [x] Task 2: Crear la página del Reporte de Nómina (Workpaper)
  - [x] SubTask 2.1: Crear el directorio y archivo de ruta para el reporte (ej. `src/app/dashboard/nomina/workpaper/page.tsx`).
  - [x] SubTask 2.2: Implementar la vista base copiando la lógica de `/dashboard_fiscal/workpaper/page.tsx`.
- [x] Task 3: Adaptar columnas y filtros al contexto de Nómina
  - [x] SubTask 3.1: Configurar la llamada a la API (fetch) dentro de la vista para enviar explícitamente el parámetro `cfdiType=NOMINA`.
  - [x] SubTask 3.2: Implementar en la interfaz y en la consulta backend los filtros específicos solicitados: **Fecha de Timbrado**, **Fecha de Pago**, **Departamento** y **Tipo de Nómina**.
  - [x] SubTask 3.3: Definir exhaustivamente las columnas específicas de nómina en `columnDefs` (ej. `NumEmpleado`, `FechaPago`, `TotalPercepciones`, `TotalDeducciones`, etc.) y remover las que no apliquen.
  - [x] SubTask 3.4: Configurar el panel de "Columnas visibles" para que el usuario pueda agregar o quitar (ocultar/mostrar) libremente los campos del complemento de nómina según sus necesidades.
  - [x] SubTask 3.5: Adaptar las utilerías de extracción de atributos XML locales de la página para parsear el nodo `<nomina12:Nomina>` y sus subnodos si no están disponibles a través de `projection`.
- [x] Task 4: Revisión de Permisos y Datos Sensibles
  - [x] SubTask 4.1: Asegurar que se respeta la lógica de enmascaramiento de salarios para roles `VIEWER` sin permiso `NOMINA_VIEW_SALARIES` (podría requerir adaptar el endpoint `/api/dashboard_fiscal/invoices` o usar `/api/dashboard_nomina/invoices` si se extienden sus capacidades).
- [x] Task 5: Optimización de Rendimiento y Escalabilidad (5M+ registros)
  - [x] SubTask 5.1: Asegurar que la consulta a base de datos aplique correctamente la paginación del lado del servidor sin extraer `xmlContent` innecesario a menos que se expanda la fila.
  - [x] SubTask 5.2: Optimizar la lógica de filtros y búsquedas dinámicas para hacer uso de índices de base de datos o el campo JSONB de proyecciones (`complementIndex`, `complementAttributes`), evitando decodificaciones de XML al vuelo para listados masivos.
  - [x] SubTask 5.3: Adaptar o validar que las exportaciones masivas (CSV, Excel) manejen eficientemente el uso de memoria (streams o lotes) al enfrentarse a un gran número de CFDI seleccionados.
- [x] Task 6: Generación de PDF Especializado (Propuesta de Nómina)
  - [x] SubTask 6.1: Crear un layout o plantilla PDF específica para nómina que renderice toda la información detallada del complemento de nómina (percepciones, deducciones, incapacidades, etc.).
  - [x] SubTask 6.2: Adaptar el endpoint de generación de PDF o crear uno nuevo (ej. `/api/dashboard/nomina/invoices/[id]/pdf`) para que retorne esta propuesta de diseño en lugar del formato de factura estándar.

# Task Dependencies
- Task 2 depende de Task 1.
- Task 3 depende de Task 2.
- Task 4 depende de Task 3.
# Guía de Pruebas E2E: Automatización de Descargas Masivas SAT

**Objetivo:** Validar de principio a fin que la solicitud, descarga e importación automática de CFDI desde el SAT se realice correctamente, y que los resultados se visualicen de forma unificada en el Monitor de Importaciones.

**Requisitos Previos:**
- Asegurarse de haber reiniciado el servidor y los workers (`npm run dev` / cola de BullMQ) para tomar los cambios más recientes.
- Contar con credenciales de la empresa (FIEL/Contraseña) configuradas correctamente en el sistema.

---

## Escenario 1: Solicitud de CFDI Emitidos

### Paso 1.1: Creación de la Solicitud
1. Navegar a **Solicitud de Descargas** (`/mass-downloads/requests`).
2. En "Tipo de Solicitud", seleccionar **CFDI**.
3. *Validación UI:* Confirmar que el campo "Estado del Comprobante" se bloquea automáticamente en **"Vigente"**.
4. En "Tipo de Recuperación", seleccionar **Emitidos**.
5. Definir un rango de fechas con comprobantes conocidos (ej. mes actual).
6. Clic en "Solicitar".
7. *Resultado Esperado:* Aparece mensaje de éxito indicando que el proceso comenzó en segundo plano.

### Paso 1.2: Monitoreo de Solicitud (SAT)
1. Navegar a **Monitor de Solicitudes** (`/mass-downloads/requests/monitor`).
2. Localizar la solicitud recién creada.
3. *Validación:* El estatus debe avanzar de "Pendiente" a "Aceptada" y luego a "Terminada".
4. Una vez terminada, el sistema descargará el ZIP y el estatus interno cambiará a "Completado".

### Paso 1.3: Validación de Importación
1. Navegar a **Monitor de Importaciones** (`/dashboard/import-monitor`).
2. Localizar el registro más reciente correspondiente a la descarga del SAT.
3. *Validación:* El registro debe mostrar el "Total de Documentos", los "Exitosos" y los "Con Errores".
4. Clic en **"Ver Detalles"**.
5. *Validación:* La tabla debe mostrar **únicamente los documentos que tuvieron errores**, con un motivo claro (ej. "Comprobante duplicado").

---

## Escenario 2: Solicitud de CFDI Recibidos (Proveedores)

### Paso 2.1: Creación de la Solicitud
1. Navegar a **Solicitud de Descargas** (`/mass-downloads/requests`).
2. En "Tipo de Solicitud", seleccionar **CFDI**.
3. En "Tipo de Recuperación", seleccionar **Recibidos**.
4. Seleccionar un rango de fechas válido.
5. Clic en "Solicitar".

### Paso 2.2: Monitoreo y Procesamiento
1. En el **Monitor de Solicitudes**, esperar a que el paquete pase a estado "Completado".
2. *Nota técnica (invisible al usuario):* El sistema extraerá el ZIP y pasará los XML por las reglas de validación del portal de proveedores.

### Paso 2.3: Validación de Tableros y Monitor
1. Navegar al **Monitor de Importaciones** (`/dashboard/import-monitor`).
2. Revisar los detalles de la carga. Si hubo errores (ej. "RFC emisor no registrado como proveedor"), deben aparecer listados de forma clara y sin tecnicismos.
3. Navegar a los tableros de proveedores/recibidos (`/dashboard_recibidos` o equivalente).
4. *Validación Final:* Los comprobantes que se importaron de forma exitosa (Exitosos en el monitor) **deben verse reflejados inmediatamente** en las métricas y reportes del tablero.

---

## Lista de Verificación (Checklist) Detallada

### Preparación del Entorno
- [ ] Se reinició el servidor de la aplicación (ej. `npm run dev`) para cargar los últimos cambios.
- [ ] Se reinició el proceso en segundo plano (cola de BullMQ / worker).
- [ ] Se cuenta con las credenciales de la empresa (FIEL/Contraseña) configuradas correctamente en el sistema.

### Interfaz de Usuario (UI) y Validaciones
- [ ] En la pantalla de Solicitud, al seleccionar "CFDI" en Tipo de Solicitud, el campo "Estado del Comprobante" cambia a "Vigente".
- [ ] El campo "Estado del Comprobante" queda bloqueado (no permite edición) al seleccionar "CFDI".
- [ ] Al seleccionar el Tipo de Recuperación "Recibidos", la solicitud se envía sin generar errores de validación de RFC solicitante.

### Comunicación con el SAT
- [ ] La solicitud de descargas se envía exitosamente sin devolver el error "XML Mal Formado".
- [ ] La solicitud no devuelve el error "301 (Se recibió una solicitud vacía)".
- [ ] La solicitud no devuelve el error "[a:ActionNotSupported] (Acción no soportada)".
- [ ] El Monitor de Solicitudes muestra el avance correcto de los estatus ("Pendiente" -> "Aceptada" -> "Terminada").

### Procesamiento Automático (Workers)
- [ ] Una vez terminada la petición en el SAT, el paquete ZIP se descarga automáticamente en segundo plano.
- [ ] El paquete ZIP se descomprime y procesa de forma automática sin intervención manual.

### Integración con Monitor de Importaciones
- [ ] Al terminar el procesamiento, se crea **una única fila** en el Monitor de Importaciones (`/dashboard/import-monitor`) correspondiente a la descarga del paquete.
- [ ] El registro en el monitor refleja de forma correcta los totales consolidados (Total de Documentos, Exitosos, Con Errores).
- [ ] Al hacer clic en "Ver Detalles" del registro en el monitor, la tabla muestra **exclusivamente los documentos que no se cargaron** (excepciones).
- [ ] El motivo de rechazo en los detalles de error se muestra en lenguaje claro y comprensible (sin tecnicismos de código).

### Impacto en el Sistema
- [ ] **Flujo de Emitidos:** Los CFDI emitidos válidos se importan exitosamente sin generar errores, omitiendo automáticamente los duplicados.
- [ ] **Flujo de Recibidos:** Los CFDI recibidos se validan contra el portal de proveedores (validación de RFC emisor, etc.).
- [ ] Los CFDI recibidos importados exitosamente **se reflejan de forma inmediata** en los reportes, papeles de trabajo y tableros de `/dashboard_recibidos` o `/dashboard/rh`.
- [ ] Las métricas y gráficas de los tableros analíticos se actualizan correctamente tras la inserción automática.
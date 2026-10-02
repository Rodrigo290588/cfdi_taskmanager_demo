# Checklist de Pruebas: Verificación de Solicitudes SAT (Descargas Masivas)

### 1. Control de Acceso por Empresa
- [ ] Si el sistema no detecta una empresa activa, se oculta la tabla y los filtros, y se muestra el mensaje "Selecciona una empresa en el menú lateral para ver la información".
- [ ] Si se detecta una empresa, la tabla y los filtros se dibujan y el sistema realiza automáticamente el fetch a la API.

### 2. Filtrado de Datos (API y Cliente)
- [ ] El sistema descarta automáticamente las solicitudes devueltas por la API cuyo `satPackageId` sea nulo (no se muestran en la tabla).
- [ ] Al seleccionar un estatus específico en el filtro superior (ej. `EN_PROCESO`), la tabla actualiza su contenido descartando las filas que no coincidan.
- [ ] Si al aplicar un filtro la tabla queda vacía, se muestra el mensaje central "No hay solicitudes para verificar".

### 3. Visualización y Badges de la Tabla
- [ ] La columna "Tipo Archivo" distingue visualmente si la solicitud es de `Metadata` (Gris) o `CFDI` (Azul).
- [ ] La columna "Estatus" aplica el color correcto:
  - [ ] Verde para `TERMINADO` o `COMPLETADO`.
  - [ ] Azul para `EN_PROCESO`.
  - [ ] Amarillo para `SOLICITADO`.
  - [ ] Rojo para `ERROR` o `RECHAZADO`.
  - [ ] Gris para `VENCIDO`.
- [ ] La columna "Fecha de petición" muestra una fecha sólo si el estatus es `TERMINADO`, de lo contrario muestra un guión (`-`).
- [ ] La columna "Intentos" refleja correctamente el valor numérico de la propiedad `verificationAttempts`.
- [ ] La columna "Próxima Verificación" muestra un ícono de reloj junto a la fecha si `nextCheck` existe, o un guión (`-`) si es nulo.
- [ ] La columna "Paquetes" muestra un Badge con el texto "N Paquetes" si `packageIds` contiene elementos, o un guión (`-`) si está vacío.

### 4. Funciones de Recarga
- [ ] El botón superior "Actualizar Estado" dispara la recarga de datos al hacer clic.
- [ ] Mientras ocurre la recarga, el texto del botón cambia a "Actualizando..." y su icono (RefreshCw) empieza a girar.
- [ ] Si la petición a la API falla (código 500), el sistema lanza una notificación Toast de color rojo indicando "Error al cargar la información".
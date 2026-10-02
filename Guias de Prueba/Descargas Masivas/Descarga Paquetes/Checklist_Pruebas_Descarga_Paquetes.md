# Checklist de Pruebas: Descarga de Paquetes (Descargas Masivas)

### 1. Control de Autenticación por Empresa
- [ ] Si no hay empresa seleccionada, la pantalla oculta los KPIs y la tabla, mostrando únicamente un mensaje que pide seleccionar una empresa.
- [ ] Si hay empresa seleccionada, el sistema inicia automáticamente la solicitud GET a `/api/mass-downloads/package-downloads`.

### 2. Tarjetas de Resumen (Dashboard KPIs)
- [ ] La tarjeta "XML CFDI a descargar" suma correctamente la propiedad `totalXml` de las solicitudes de tipo `cfdi`.
- [ ] La tarjeta "XML CFDI descargados" suma correctamente la propiedad `descargadosXml` de las solicitudes de tipo `cfdi`.
- [ ] La barra de progreso de CFDI refleja el porcentaje correcto matemáticamente y no falla si el total es cero (muestra 0%).
- [ ] La tarjeta "Registros Metadata a descargar" suma correctamente la propiedad `totalXml` de las solicitudes de tipo `metadata`.
- [ ] La tarjeta "Registros Metadata importados" suma correctamente la propiedad `descargadosXml` de las solicitudes de tipo `metadata`.
- [ ] La barra de progreso de Metadata refleja el porcentaje correcto matemáticamente.

### 3. Tabla de Solicitudes
- [ ] Si la API responde con un arreglo vacío, se despliega el mensaje "No hay solicitudes de descarga de paquetes".
- [ ] La columna "Periodo" formatea el mes con un "0" a la izquierda si aplica (ej. `09/2023`).
- [ ] La columna "Tipo Archivo" muestra "Metadata" en gris o "CFDI" en azul dependiendo de `requestType`.
- [ ] El Badge de Estatus cambia de color según el código (Amarillo=1, Azul=2, Verde=3).
- [ ] La columna "Progreso" muestra un Progress Bar que se ajusta a 10%, 50% o 100% dependiendo de la respuesta del servidor.
- [ ] El botón "Ver paquetes" **sólo** es visible cuando el `estado_code` de la solicitud es exactamente `3`.

### 4. Panel de Descargas (Drawer)
- [ ] Hacer clic en "Ver paquetes" oscurece el fondo y abre el panel lateral (Drawer) con la información de la solicitud (RFC, ID, y lista de ZIPs).
- [ ] El panel muestra un listado con los nombres de todos los archivos ZIP disponibles en el arreglo `paquetes`.
- [ ] Al hacer clic en el botón de descarga (icono de nube) de un archivo:
  - [ ] Se lanza una notificación Toast verde indicando "Descargando paquete...".
  - [ ] El botón deshabilita su clic y reemplaza la nube por un Spinner giratorio temporalmente (2 segundos).
  - [ ] Se anexa temporalmente un tag `<a>` al DOM para disparar la descarga en el navegador apuntando al endpoint correspondiente.
- [ ] Hacer clic fuera del panel (en la zona oscura) o en el botón "✕" cierra exitosamente el panel lateral.
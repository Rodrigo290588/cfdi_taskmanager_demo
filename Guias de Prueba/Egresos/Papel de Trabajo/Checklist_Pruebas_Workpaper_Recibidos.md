# Checklist de Pruebas: Papel de Trabajo de Proveedores (Egresos)
## Módulo: `/dashboard_recibidos/workpaper`

Utiliza esta lista de verificación (checklist) para asegurar que el módulo funciona correctamente tras cualquier actualización. Marca cada casilla [ ] conforme valides la funcionalidad en el sistema.

### 1. Carga Inicial y Selección de Empresa
- [ ] La pantalla carga sin mostrar errores en consola o alertas rojas.
- [ ] La tarjeta "Selecciona una empresa" está visible.
- [ ] El selector de empresas contiene las opciones asignadas al usuario.
- [ ] Al seleccionar una empresa, la tabla (Data Grid) se despliega o actualiza su información.

### 2. Filtros y Buscador
- [ ] Búsqueda por texto: Ingresar un RFC válido o UUID filtra correctamente la tabla.
- [ ] Selector de Fechas: Al seleccionar un rango (ej. Últimos 7 días) y hacer clic en "Filtrar", solo se muestran CFDI de esa fecha de emisión.
- [ ] Estatus SAT: Filtrar por "Vigente" o "Cancelado" actualiza la tabla correctamente.
- [ ] Tipo de CFDI: Filtrar por "Ingreso", "Egreso" o "Pago" funciona adecuadamente.

### 3. Data Grid (Tabla Interactiva)
- [ ] El paginador funciona (Permite avanzar a la página 2, 3, etc. y cambiar filas por página).
- [ ] Ocultar columnas: Desmarcar columnas desde el menú de configuración las oculta inmediatamente.
- [ ] Reordenar columnas: Es posible arrastrar y soltar los encabezados para cambiar su orden.
- [ ] Persistencia de preferencias: Al recargar la página (F5), el orden y visibilidad de las columnas se mantiene igual que antes de recargar.

### 4. Visores de CFDI (Acciones por Fila)
- [ ] Botón "XML": Al hacer clic, se abre un modal con el código fuente XML del comprobante seleccionado.
- [ ] Botón "PDF": Al hacer clic, se abre o descarga correctamente el PDF asociado al comprobante.
- [ ] El modal del XML se puede cerrar sin problemas mediante la "X" o haciendo clic fuera de él.

### 5. Exportaciones Masivas
- [ ] Botón "Exportar CSV": Descarga un archivo con extensión `.csv`.
- [ ] El archivo CSV contiene las mismas columnas e información filtrada que se ve en la pantalla (respetando los filtros activos).
- [ ] Botón "Exportar ZIP": Inicia la descarga de un archivo comprimido `.zip`.
- [ ] El archivo ZIP contiene documentos PDF y/o XML correspondientes a los comprobantes listados.

---
**Firma de Validación:** ______________________  **Fecha:** _______________
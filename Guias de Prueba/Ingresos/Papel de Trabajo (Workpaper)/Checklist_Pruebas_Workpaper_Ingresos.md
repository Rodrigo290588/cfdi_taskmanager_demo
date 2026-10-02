# Checklist de Pruebas: Papel de Trabajo (Workpaper) - Ingresos

**Módulo:** `/dashboard_fiscal/workpaper`  
**Fecha de ejecución:** ___/___/202__  
**Ejecutado por:** ___________________________  

Marque con una 'X' o palomita `[x]` cada casilla una vez que la prueba se haya realizado exitosamente.

---

### 1. Pre-requisitos y Seguridad ⚙️
- [ ] **Selección de Empresa:** Verifiqué que si entro al módulo sin elegir empresa en el sidebar, el sistema muestra un mensaje pidiendo seleccionar una, y no muestra datos ajenos.
- [ ] **Filtros Vacíos:** Verifiqué que al dar clic en "Aplicar" con las fechas vacías, me muestra una alerta de error (Toast) pidiendo las fechas.
- [ ] **Fechas Incongruentes:** Verifiqué que si pongo una fecha de inicio mayor a la fecha fin, el botón "Aplicar" se deshabilita y sale un mensaje rojo de advertencia.

---

### 2. Filtros y Consultas 🔍
- [ ] **Carga Exitosa:** Ingresé un rango de fechas válido, di clic en "Aplicar" y la tabla se llenó de registros (I, E, P, T). El paginador funciona correctamente.
- [ ] **Filtro Estatus VIGENTE:** Cambié el select a "Vigente", apliqué el filtro y verifiqué que la columna "SAT" solo muestra facturas vigentes.
- [ ] **Filtro Estatus CANCELADO:** Cambié el select a "Cancelado", apliqué el filtro y verifiqué que la columna "SAT" solo muestra facturas canceladas.
- [ ] **Buscador (Columnas):** Escribí un texto en el buscador de la columna Receptor/UUID y verifiqué que la tabla filtre correctamente y regrese a la página 1.

---

### 3. Data Grid (Tabla Interactiva) 📊
- [ ] **Reordenar Columnas:** Arrastré el encabezado de una columna (ej. Total) y la solté antes de otra (ej. SubTotal). Confirmé que se quedó en su nuevo lugar.
- [ ] **Panel de Columnas (Mostrar/Ocultar):** Abrí el panel "Columnas" (icono de ojo), desmarqué una columna y verifiqué que desapareciera de la tabla.
- [ ] **Vistas Rápidas:** Probé el botón "Vista básica" y el botón "Mostrar todo" del panel, confirmando que la tabla se limpia o se satura de columnas respectivamente.
- [ ] **Totales Inferiores:** Fui al fondo de la tabla y verifiqué que exista una fila en negritas sumando matemáticamente las columnas numéricas (SubTotal, Descuento, Total, Impuestos).
- [ ] **Detalle de Conceptos:** Hice clic en la flecha `>` a la izquierda de una factura y verifiqué que se despliega una tabla interna con el detalle de artículos (ClaveProdServ, Descripción, Importes).

---

### 4. Acciones Individuales 📄
- [ ] **Descarga XML:** Hice clic en el botón de código (`</>`) en la fila de una factura y verifiqué que se descarga un archivo `.xml`.
- [ ] **Visualizar PDF:** Hice clic en el botón de documento (hoja) en la fila de una factura, vi la alerta "Generando PDF..." y verifiqué que el PDF se abre en una nueva pestaña.

---

### 5. Exportaciones Masivas 📥
- [ ] **Exportar CSV:** Hice clic en "Exportar CSV" y verifiqué que el archivo descargado tiene las mismas columnas que veo en pantalla y una fila de totales al final.
- [ ] **Exportar Excel:** Hice clic en "Exportar Excel" y verifiqué que el archivo `.xls` descargado tiene la misma estructura de columnas y totales que el CSV.
- [ ] **Descarga ZIP (Selección):** Seleccioné las casillas de 3 facturas diferentes, verifiqué que el botón dice "Descarga Zip (3)", hice clic y comprobé que el `.zip` descargado contiene los XML y PDF de esas 3 facturas.

---

**Observaciones o comentarios adicionales:**
_____________________________________________________________________________________
_____________________________________________________________________________________
_____________________________________________________________________________________

**Firma de conformidad:** ___________________________

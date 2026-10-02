# Checklist de Pruebas: Control Fiscal (Descargas Masivas)

### 1. Control de Acceso y Filtros
- [ ] Si no hay empresa activa, el dashboard completo se oculta y pide seleccionar una empresa.
- [ ] Si hay empresa activa, el sistema hace fetch a `/api/mass-downloads/fiscal-control` automáticamente.
- [ ] Al escribir en el input "RFC", se despliega un panel flotante con sugerencias si hay coincidencias en los datos cargados.
- [ ] Al hacer clic en una sugerencia de RFC, el input se autocompleta con ese valor.

### 2. Panel de Indicadores (KPIs) y Alertas
- [ ] La tarjeta "Registros en Metadatos" refleja el valor numérico devuelto por la API formateado con comas (ej. 1,500).
- [ ] La tarjeta "XML descargados" refleja su respectivo valor numérico formateado.
- [ ] La tarjeta "Indicador de brecha" muestra el porcentaje de integridad con 2 decimales (ej. 98.50%).
- [ ] Si `discrepancyAlert` es `true` en la respuesta de la API:
  - [ ] La tarjeta agrega un borde rojo.
  - [ ] Se despliega un Badge rojo indicando "Alerta de discrepancia: X% de diferencia".
- [ ] Si `discrepancyAlert` es `false`, el Badge rojo no debe existir y el borde debe ser el estándar.

### 3. Gráficas (Recharts)
- [ ] El "Monitor de Estatus de Cancelación" renderiza correctamente el monto total cancelado con formato de moneda.
- [ ] La gráfica de "Distribución por Efecto" carga y renderiza las barras apiladas (Ingreso, Egreso, etc.).

### 4. Data Grid y Preferencias de Columnas
- [ ] La tabla extrae exitosamente los montos (SubTotal, Total, etc.) desde la propiedad `xmlContent` mediante Regex si está disponible.
- [ ] Al dar clic en el botón "Columnas" (con ícono de ojo), se despliega el panel de opciones de columnas.
- [ ] Al desmarcar un checkbox en el panel de columnas, la columna correspondiente desaparece instantáneamente de la tabla.
- [ ] Al dar clic en "Vista básica" o "Mostrar todo", los checkboxes reaccionan de manera acorde y se dispara la función de persistencia (`persistVisibleColumns`).
- [ ] El pie de tabla (TableFooter) realiza y muestra la sumatoria correcta de las columnas monetarias visibles basándose en los registros en pantalla.
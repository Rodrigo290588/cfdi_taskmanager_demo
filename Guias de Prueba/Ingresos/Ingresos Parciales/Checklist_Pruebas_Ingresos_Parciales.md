# ✅ Checklist de Pruebas: Módulo de Ingresos Parciales (Pagos PPD)

**Módulo:** Ingresos Cobrados / No Cobrados (`/dashboard_fiscal/ingresos-parciales`)  
**Fecha de Ejecución:** ____/____/202__  
**Responsable QA:** ___________________________  
**Empresa Seleccionada:** ___________________________ (RFC: ____________)  

> **Instrucción:** Marque con una "X" la casilla `[ ]` correspondiente cuando la prueba sea ejecutada exitosamente. Si alguna prueba falla, déjela en blanco y anote el detalle en la sección de Observaciones al final del documento.

---

### 1. ⚙️ Pre-requisitos y Configuración Inicial
- [ ] La empresa seleccionada en el menú lateral aplica correctamente para el tablero.
- [ ] La interfaz bloquea la carga de datos si no se seleccionan la **Fecha de Inicio** y **Fecha de Fin**.
- [ ] El botón "Aplicar filtros" ejecuta la búsqueda y renderiza los datos en pantalla al proporcionar fechas válidas.

### 2. 💳 Validación de Tarjetas (KPIs)
- [ ] **Ingresos Pendientes de Cobro:** Refleja el Saldo Insoluto real (no muestra números negativos).
- [ ] **Ingresos Cobrados (CRP):** Muestra exactamente la sumatoria de los abonos (Complementos de Pago) del periodo.
- [ ] **Notas de Crédito Aplicadas:** Refleja únicamente los montos de facturas de Egreso relacionadas a las facturas PPD.
- [ ] **Monto por Cobrar (Bruto):** Suma correctamente el atributo Total histórico de las facturas PPD emitidas.
- [ ] **Métricas Secundarias:** Los conteos numéricos (Facturas PPD, Pendientes y Liquidadas) tienen sentido matemático y lógico.

### 3. 🔍 Interactividad y Filtros de la Tabla (Data Grid)
- [ ] **Filtro Fecha Pago (REP):** Al aplicarlo, la tabla y los KPIs reflejan únicamente las facturas que tuvieron abonos en ese lapso.
- [ ] **Filtro Monedas:** Al seleccionar "USD", la tabla oculta los pesos mexicanos (MXN) y muestra solo dólares.
- [ ] **Filtro Escenario "No cobradas":** Muestra únicamente facturas donde la columna Total Pagado es cero ($0.00).
- [ ] **Filtro Escenario "Parcialmente cobradas":** Muestra facturas con pagos registrados, pero cuyo Saldo por cobrar es mayor a cero.
- [ ] **Filtro Escenario "Totalmente cobradas":** Muestra facturas con estatus de pago completado y saldo en cero ($0.00).
- [ ] **Buscador UUID (En Columna):** Filtra en tiempo real (sin recargar) los registros al teclear los últimos 4 dígitos.
- [ ] **Buscador Receptor (En Columna):** Filtra correctamente por RFC o Nombre de cliente.

### 4. 🗂️ Desglose de Pagos (Drilldown)
- [ ] Al hacer clic en la flecha `>` de una factura, se expande la sub-tabla de "Desglose de Pagos (REPs)".
- [ ] La suma de "Monto Pagado" en los renglones hijos coincide exactamente con la columna "Total Pagado" del renglón padre.
- [ ] Al hacer clic en el botón "XML" de un REP, se despliega exitosamente el código del complemento de pago.

### 5. 💾 Exportaciones y Descargas Masivas
- [ ] **Descargar ZIP:** El botón de acción individual descarga un `.zip` con el nombre correcto y contiene los XML de la factura madre y todos sus pagos.
- [ ] **Descarga Masiva a Excel:** El botón superior "Descargar Reporte" genera un `.xls` que respeta los filtros aplicados en pantalla.
- [ ] **Consistencia en Excel:** Las filas inferiores del archivo Excel contienen sumatorias precisas bajo la etiqueta "TOTAL".

---

### 📝 Observaciones y Reporte de Fallos
*(Escriba aquí cualquier error encontrado, comportamiento inesperado o duda surgida durante la prueba)*
- 
- 
- 

---
**Firma de Conformidad:** _______________________

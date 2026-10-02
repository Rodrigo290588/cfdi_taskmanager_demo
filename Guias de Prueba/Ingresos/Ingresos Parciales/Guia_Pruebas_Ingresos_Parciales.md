# 🚀 Guía de Pruebas: Módulo de Ingresos Parciales (Pagos PPD)

Este documento detalla paso a paso las validaciones manuales que un usuario o analista de QA debe realizar sobre el módulo **"Ingresos Cobrados / No Cobrados"** (`/dashboard_fiscal/ingresos-parciales`). El objetivo es garantizar que la información financiera concuerde con las reglas fiscales establecidas.

---

## 📌 1. Pre-requisitos (Configuración Inicial)

Antes de comenzar a probar los cálculos, asegúrese de tener un entorno limpio y preparado:
1. **Seleccionar Empresa**: Verifique en la barra lateral (Sidebar) que tiene seleccionada la empresa `Empresa Test` con RFC `XAXX010101000` (o la que le asigne su líder de pruebas).
2. **Navegación**: Ingrese al menú lateral y haga clic en **Dashboard Fiscal** > **Ingresos Parciales**.
3. **Filtro de Fechas Obligatorio**: 
   - Busque la sección **Fecha Emisión (Factura)** en la parte superior.
   - Establezca **Fecha Inicio** y **Fecha Fin**.
   - Presione el botón **"Aplicar filtros"**.
   - *Nota*: Si no ingresa ambas fechas, el sistema no debería mostrar información y el botón de Aplicar estará deshabilitado.

---

## 📊 2. Validación de Tarjetas (KPIs) - Reglas de Negocio

Una vez aplicado el filtro de fechas, valide que los recuadros superiores (Tarjetas) muestren los cálculos correctos según las siguientes reglas:

### A) Ingresos Pendientes de Cobro
- **Descripción**: Muestra el total de dinero que aún no le pagan.
- **Regla Fiscal**: Debe sumar el `saldoInsoluto` de todas las facturas a crédito (PPD) después de restar los pagos (CRP) y Notas de Crédito aplicadas.
- **Prueba**: Compare este número con su reporte contable de cuentas por cobrar para el mismo periodo. No debe ser negativo.

### B) Ingresos Cobrados (CRP)
- **Descripción**: Muestra cuánto dinero ha entrado al banco por abonos a facturas de crédito.
- **Regla Fiscal**: Suma todos los pagos registrados (`impPagado`) en los Complementos de Recepción de Pago (CRP) relacionados a las facturas filtradas.
- **Prueba**: Verifique que los pagos reflejados correspondan solo a los recibos de pago emitidos para estas facturas.

### C) Notas de Crédito Aplicadas
- **Descripción**: Muestra descuentos o cancelaciones parciales.
- **Regla Fiscal**: Suma el valor de todos los comprobantes de tipo `EGRESO` que estén relacionados a las facturas PPD del periodo.
- **Prueba**: Compruebe que solo se cuenten las Notas de Crédito que afecten facturas a crédito.

### D) Monto por Cobrar (Bruto)
- **Descripción**: El total histórico emitido a crédito antes de cualquier abono.
- **Regla Fiscal**: Es la suma del atributo `Total` de todas las facturas PPD filtradas.

### E) Métricas Secundarias (Conteo de facturas)
Valide que las siguientes tarjetas de conteo tengan sentido lógico:
- **Facturas PPD del periodo**: Total de facturas devueltas por la consulta.
- **Facturas Pendientes**: Número de facturas cuyo Saldo Insoluto es mayor a $0.01.
- **Facturas Liquidadas**: Número de facturas cuyo Saldo Insoluto es igual a cero (totalmente pagadas).
- **Saldo por cobrar (ref. MXN)**: Equivalente en pesos mexicanos del total adeudado, útil si maneja facturas en USD o EUR.

---

## 🔍 3. Interactividad y Filtros de la Tabla (Data Grid)

La tabla central muestra el detalle de cada factura. Realice las siguientes pruebas:

### Filtros Avanzados (Parte Superior)
1. **Fecha Pago (REP)**: Ingrese un rango de fechas y verifique que la tabla y KPIs se actualicen mostrando solo facturas que tuvieron abonos en ese periodo.
2. **Monedas**: Filtre por "USD" en Moneda Factura. Valide que solo aparezcan facturas en dólares.
3. **Escenario de Cobro**: 
   - Seleccione **"No cobradas"**: Valide que la columna "Total Pagado" sea cero.
   - Seleccione **"Parcialmente cobradas"**: Valide que tengan abonos pero el "Saldo por cobrar" sea mayor a cero.
   - Seleccione **"Totalmente cobradas"**: Valide que el estatus sea "Pagado" y el saldo sea cero.

### Filtros de Columnas (Dentro de la Tabla)
Debajo de cada título de columna hay una caja de texto.
1. **Filtro de UUID**: Escriba los últimos 4 dígitos de un UUID conocido. La tabla debe reducirse al instante (sin recargar la página) a esa factura.
2. **Filtro de Cliente / RFC**: Escriba "Público" o un RFC. Valide que coincida con los datos mostrados.
3. **Filtro Numérico (Total)**: Escriba un monto (ej. `116.00`). La tabla debe filtrar las facturas que contengan ese número en su Total Original.

---

## 🗂️ 4. Desglose de Pagos (Drilldown)

Las facturas en la tabla tienen un botón `>` a la izquierda.
1. Haga clic en la flecha `>` de una factura que tenga estatus **"Pagado"** o saldo parcialmente cobrado.
2. Se desplegará una sub-tabla llamada **"Desglose de Pagos (REPs)"**.
3. **Validación**: Compruebe que la suma de la columna "Monto Pagado" de esta sub-tabla sea igual a la columna "Total Pagado" de la fila principal.
4. Haga clic en el botón de la columna **XML**. Se abrirá una ventana mostrando el código fuente del Complemento de Pago.

---

## 💾 5. Exportaciones y Descargas

Ponga a prueba la capacidad del sistema para extraer información masiva:

### A) Descargar ZIP (Factura + Pagos)
1. En la columna de Acciones (derecha), haga clic en el botón con el ícono de descarga.
2. Se debe descargar automáticamente un archivo ZIP con el nombre `CFDIs_PPD_[UUID].zip`.
3. Descomprima el archivo y valide que contiene el XML de la factura original y los XMLs de todos sus pagos relacionados.

### B) Exportación Masiva a Excel
1. Haga clic en el botón azul **"Descargar Reporte"** en la parte superior derecha de la tabla.
2. Se descargará un archivo `.xls`.
3. Ábralo en Excel y valide:
   - Que las filas mostradas respeten los filtros aplicados en pantalla.
   - Que la fila final contenga las sumatorias correctas bajo la etiqueta **"TOTAL"**.
   - Que si una factura tiene 3 pagos, aparezcan filas detalladas (repetidas) para cada pago en el Excel.

---
*Nota para QA: Esta guía es el documento base. Cualquier discrepancia encontrada debe reportarse indicando el paso exacto que falló.*
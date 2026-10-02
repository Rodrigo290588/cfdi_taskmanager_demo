# Guía de Pruebas: Tablero de Ingresos (Dashboard Fiscal)

**Objetivo de este documento:**  
Proveer un manual detallado, estructurado y en lenguaje no técnico para validar el correcto funcionamiento matemático, visual y de reglas de negocio del **Tablero de Ingresos** (`/dashboard_fiscal`). Esta guía servirá como referencia oficial para sesiones de demostración y auditorías de calidad.

---

## 📋 1. Preparación de la Prueba (Pre-requisitos)

Antes de validar cualquier tarjeta o cálculo, asegúrese de cumplir con los siguientes pasos:
1. **Acceso al sistema:** Iniciar sesión con una cuenta que tenga permisos de visualización del Dashboard Fiscal.
2. **Selección de Empresa:** Elegir una empresa válida desde el menú desplegable superior.
3. **Filtro de Fechas:** Seleccionar estrictamente un rango de fechas. (Ejemplo sugerido: **01/07/2026 al 08/07/2026**). 
   * *Nota técnica:* El sistema utiliza la Zona Horaria Local (`America/Mexico_City`) y sincroniza los límites exactos desde las `00:00:00` del primer día hasta las `23:59:59` del último día.
4. **Vista Inicial:** Si no se selecciona un rango de fechas, los desgloses detallados (Drilldowns) no deben abrirse (se deben mantener bloqueados para evitar cargar historiales completos).

---

## 📊 2. Validación de Tarjetas (KPIs) - Reglas de Negocio

A continuación, se detalla cómo probar cada una de las tarjetas principales. Se describe la regla de negocio que debe cumplirse y cómo el usuario puede validar que el número sea correcto.

### 2.1. CFDI de Ingresos
- **Regla de negocio:** Suma total del atributo `Total` de todos los XML (CFDI) que sean estrictamente de tipo **I (INGRESO)** y que su estado ante el SAT sea **VIGENTE**.
- **Cómo probarlo:** 
  1. Identifique en su ERP o base de datos las facturas emitidas en el rango de fechas seleccionado.
  2. Descarte cualquier factura cancelada y cualquier comprobante de Egreso (Notas de crédito) o Pago (CRP).
  3. Sume el total de las facturas restantes. El monto debe coincidir exactamente con esta tarjeta.

### 2.2. Cancelaciones de Ingresos
- **Regla de negocio:** Suma total del atributo `Total` de todos los CFDI tipo **I (INGRESO)** cuyo estado ante el SAT sea **CANCELADO**.
- **Cómo probarlo:** Sume exclusivamente el total de las facturas que fueron canceladas en ese rango de fechas. No deben incluirse notas de crédito canceladas.

### 2.3. Ingresos Nominativos
- **Regla de negocio:** Facturas emitidas a clientes específicos (con RFC válido). 
- **Exclusiones:** Se excluye al "Público en General" (RFC `XAXX010101000` o `XEXX010101000`) y facturas marcadas como globales (`Global=true`).
- **Base de cálculo:** Se calcula usando el atributo `SubTotal` (antes de impuestos y descuentos).
- **Cómo probarlo:** Haga clic en la tarjeta. Se abrirá una ventana (Drilldown). La suma de los subtotales de la lista mostrada debe coincidir centavo a centavo con el número de la tarjeta.

### 2.4. Ingresos Globales
- **Regla de negocio:** Ventas agrupadas al Público en General (RFC `XAXX010101000`) que contienen el nodo especial `cfdi:InformacionGlobal`.
- **Base de cálculo:** Atributo `SubTotal`.
- **Cómo probarlo:** Al abrir el Drilldown, solo deben aparecer facturas genéricas de fin de día/mes. La suma de sus subtotales debe cuadrar con la tarjeta.

### 2.5. Ingresos Individuales
- **Regla de negocio:** Ventas individuales a Público en General (RFC genérico) que **no** fueron agrupadas en una factura global (no contienen el nodo `cfdi:InformacionGlobal`).
- **Base de cálculo:** Atributo `SubTotal`.
- **Cómo probarlo:** Valide en el Drilldown que las facturas listadas correspondan a tickets individuales facturados a RFC genérico.

### 2.6. Ingresos Brutos
- **Regla de negocio:** Es la suma pura de los 3 tipos de ingresos anteriores: `Ingresos Nominativos + Ingresos Globales + Ingresos Individuales`.
- **Cómo probarlo:** Sume manualmente con calculadora el valor de las tres tarjetas mencionadas. El resultado debe ser matemáticamente exacto al mostrado en "Ingresos Brutos".

### 2.7. Descuentos y Bonificaciones
- **Regla de negocio:** Suma del atributo `Descuento` aplicado directamente dentro del nodo comprobante de las facturas de INGRESO vigentes.
- **Exclusiones:** No incluye devoluciones mediante Notas de Crédito.
- **Cómo probarlo:** Haga clic en la tarjeta para ver el desglose. El sistema solo listará facturas que tengan un monto mayor a cero en su nodo de descuento.

### 2.8. Notas de Crédito
- **Regla de negocio:** Comprobantes de tipo **E (EGRESO)** vigentes que están relacionados a una factura de ingreso.
- **Base de cálculo:** Suma del atributo `SubTotal` de dichas notas.
- **Cómo probarlo:** El Drilldown mostrará el listado de las devoluciones o bonificaciones formalizadas con XML de Egreso.

### 2.9. Ingresos Netos Reales
- **Regla de negocio:** Refleja el ingreso real de la empresa restando las deducciones. 
- **Fórmula:** `Ingresos Brutos - Descuentos y Bonificaciones - Notas de Crédito`.
- **Cómo probarlo:** Utilice los montos mostrados en el dashboard y aplique la fórmula anterior con calculadora. Debe cuadrar al 100%.

### 2.10. Ingresos Cobrados (Flujo Total)
- **Regla de negocio:** Representa el dinero real que entró a la cuenta bancaria. 
- **Fórmula:** `(Facturas de INGRESO con método PUE) + (Monto pagado en Complementos de Pago CRP)`.
- **Cómo probarlo:** Identifique el total de facturas pagadas de contado (PUE) y sume los importes exactos depositados registrados en los complementos de pago.

### 2.11. Ingresos Pendientes de Cobro
- **Regla de negocio:** Saldo insoluto (lo que deben los clientes).
- **Fórmula:** `(Total Facturas INGRESO método PPD) - (Pagos CRP aplicados a esas facturas) - (Notas de Crédito relacionadas)`.
- **Cómo probarlo:** El monto nunca debe ser negativo (está topado a $0.00 en caso de discrepancias). Revise la cartera de crédito en su ERP; los montos de PPD vigentes menos lo ya cobrado deben reflejar este número.

### 2.12. Impuesto Trasladado IVA
- **Regla de negocio:** Suma pura del IVA desglosado (Impuesto 002) en todas las facturas de INGRESO VIGENTES (suma de tasas 16% y 8%).
- **Cómo probarlo:** Esta es una métrica de facturación, no de flujo de efectivo. Representa el IVA total emitido.

### 2.13. IVA Cobrado Total
- **Regla de negocio:** El IVA que realmente se cobró y que se debe declarar.
- **Fórmula:** `(IVA al 100% de facturas PUE) + (Proporción de IVA cobrado en las parcialidades CRP)`.
- **Cómo probarlo:** Si un cliente pagó el 50% de una factura, esta tarjeta solo suma el 50% del IVA de esa factura, garantizando exactitud financiera.

### 2.14. Impuestos Retenidos
- **Regla de negocio:** Suma de todas las retenciones realizadas a la empresa en facturas de INGRESO VIGENTES.
- **Fórmula:** `ISR Retenido (001) + IVA Retenido (002) + IEPS Retenido (003)`.
- **Cómo probarlo:** Revise los nodos de retenciones en sus XML emitidos. La sumatoria debe reflejarse en esta tarjeta.

---

## 🔍 3. Pruebas de Interfaz y Comportamiento (Frontend)

Durante la demostración, el usuario interactuará con el tablero. Verifique los siguientes comportamientos de protección implementados:

1. **Bloqueo de Drilldowns en Cero ($0.00):**
   - **Acción:** Haga clic en cualquier tarjeta (ej. Notas de Crédito, Ingresos Individuales) que muestre un valor exacto de `$0.00`.
   - **Resultado esperado:** El sistema **no debe hacer nada**. La ventana modal detallada (Drilldown) NO debe abrirse. Esto evita mostrar listados históricos que no corresponden al filtro actual.
2. **Apertura correcta de Drilldowns (Valores > 0):**
   - **Acción:** Haga clic en una tarjeta con valor mayor a cero.
   - **Resultado esperado:** Se abre la ventana modal. La sumatoria de la columna principal en el reporte debe coincidir con el valor de la tarjeta clickeada.
3. **Restricción sin filtro de fecha:**
   - **Acción:** Quite el filtro de fechas en la barra superior e intente abrir un Drilldown.
   - **Resultado esperado:** El reporte debe aparecer vacío, solicitando al usuario que defina un rango de fechas para proteger el rendimiento de la base de datos.

---

## 📈 4. Validación de Gráficas

Las gráficas del dashboard presentan distribuciones visuales de los comprobantes. Todas ellas dependen directamente del rango de fechas seleccionado y aplican a la empresa en contexto.

### 4.1. CFDI de Ingresos por mes (Gráfica de Barras Mixta)
- **Descripción:** Muestra la evolución mensual de los comprobantes emitidos.
- **Qué valida:** 
  - Las barras moradas (`Cantidad de CFDIs`) representan el conteo total de documentos generados en ese mes.
  - La línea roja (`Monto Total`) representa la sumatoria del atributo `Total` de dichos comprobantes.
- **Cómo probarlo:** Seleccione un rango de fechas que abarque varios meses. Identifique en su ERP cuántos comprobantes se emitieron en un mes específico y compárelo contra el valor de la barra morada. Haga lo mismo con el total facturado mensual y la línea roja.

### 4.2. CFDI Vigentes vs Cancelados (Gráfica de Barras Agrupadas)
- **Descripción:** Compara el volumen de comprobantes válidos frente a los cancelados, agrupados por su origen (Emitidos o Recibidos).
- **Qué valida:** El estado actual (`satStatus`) de los documentos.
- **Cómo probarlo:** Posicione el cursor sobre las barras de un origen (ej. "Emitidos"). La sumatoria de la barra azul ("Vigentes") y la gris ("Cancelados") debe ser igual al total de comprobantes emitidos en el rango de fechas consultado.

### 4.3. CFDI por Tipo (Gráfica de Barras Simple)
- **Descripción:** Clasifica todos los comprobantes emitidos/recibidos en el periodo según su tipo fiscal.
- **Qué valida:** Tipos de comprobante: Ingreso (`I`), Egreso (`E`), Traslado (`T`), Pago (`P`), Nómina (`N`).
- **Cómo probarlo:** Posicione el cursor sobre la barra "Ingreso" o "I". El número de CFDIs listados debe corresponder al volumen de facturas de venta o notas de cargo generadas en ese periodo.

### 4.4. Métodos de Pago (Gráfica de Pastel / Donut)
- **Descripción:** Distribución porcentual de las modalidades de pago registradas en las facturas de tipo **INGRESO**.
- **Qué valida:** La proporción de facturas emitidas bajo los métodos:
  - **PUE:** Pago en una sola exhibición.
  - **PPD:** Pago en parcialidades o diferido.
- **Cómo probarlo:** Al pasar el cursor sobre la rebanada, el globo informativo mostrará el conteo total de facturas emitidas bajo ese método, el porcentaje que representa sobre el total, y el monto sumado. La suma de todas las rebanadas debe ser igual al conteo total de facturas de tipo INGRESO vigentes.

---
*Documento generado y auditado por el equipo de calidad técnica.*
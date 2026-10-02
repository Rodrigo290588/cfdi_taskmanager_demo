# ✅ Checklist de Pruebas: Tablero de Ingresos

Este documento es una lista de verificación rápida (Checklist) para asegurar la calidad y exactitud del Tablero de Ingresos. Puede ser utilizado por el equipo de QA o por usuarios finales durante las sesiones de prueba o demostración.

---

## 1. ⚙️ Pre-requisitos (Configuración Inicial)

- [ ] **Acceso y Selección:** Ingresé al módulo `/dashboard_fiscal` y seleccioné una empresa válida desde el menú superior.
- [ ] **Filtro de Fechas (Activo):** Seleccioné un rango de fechas específico (ej. del 01/07 al 08/07).
- [ ] **Filtro de Fechas (Vacío):** Verifiqué que si borro las fechas, los detalles (Drilldowns) no se abren, para proteger el sistema.

---

## 2. 💳 Validación de Tarjetas (KPIs)

*Compare los resultados mostrados en cada tarjeta con la información de su ERP o base de datos.*

- [ ] **CFDI de Ingresos:** El monto total coincide exactamente con la suma de las facturas de venta (tipo Ingreso) vigentes.
- [ ] **Cancelaciones de Ingresos:** El monto coincide con la suma exclusiva de facturas de Ingreso canceladas (sin incluir notas de crédito canceladas).
- [ ] **Ingresos Nominativos:** El desglose (Drilldown) cuadra con facturas a clientes con RFC específico (excluyendo Público en General).
- [ ] **Ingresos Globales:** El desglose cuadra con facturas de Público en General agrupadas (contienen el nodo `InformacionGlobal`).
- [ ] **Ingresos Individuales:** El desglose cuadra con tickets individuales a Público en General (sin nodo global).
- [ ] **Ingresos Brutos:** Verifiqué con calculadora que: `Nominativos + Globales + Individuales = Ingresos Brutos`.
- [ ] **Descuentos y Bonificaciones:** El monto refleja solo los descuentos aplicados directamente dentro del XML (sin contar devoluciones externas).
- [ ] **Notas de Crédito:** El desglose cuadra con la suma de comprobantes tipo Egreso vigentes.
- [ ] **Ingresos Netos Reales:** Verifiqué con calculadora que: `Ingresos Brutos - Descuentos - Notas de Crédito = Ingresos Netos Reales`.
- [ ] **Ingresos Cobrados (Flujo Total):** El monto equivale al dinero real depositado: Facturas de contado (PUE) + Pagos recibidos en parcialidades (CRP).
- [ ] **Ingresos Pendientes de Cobro:** El saldo insoluto cuadra con la cartera vencida de facturas a crédito (PPD), menos los pagos y notas de crédito aplicadas a ellas. Verifiqué que el monto nunca sea negativo.
- [ ] **Impuesto Trasladado IVA:** La suma del IVA (tasas 16% y 8%) en facturas de INGRESO cuadra con esta tarjeta.
- [ ] **IVA Cobrado Total:** El IVA coincide con las facturas de contado (PUE) más la proporción exacta del IVA en los pagos parciales (CRP).
- [ ] **Impuestos Retenidos:** La suma de retenciones (ISR + IVA + IEPS) cuadra con el historial de los XML de Ingreso emitidos.

---

## 3. 🖱️ Interfaz y Experiencia de Usuario (Frontend)

- [ ] **Bloqueo en Ceros ($0.00):** Hice clic en tarjetas que muestran un valor exacto de `$0.00` y comprobé que la ventana de detalle (Drilldown) **NO** se abre.
- [ ] **Apertura de Drilldown (> $0.00):** Hice clic en tarjetas con valor mayor a cero y comprobé que la ventana se abre correctamente.
- [ ] **Cuadre de Totales en Drilldown:** Verifiqué que la sumatoria mostrada dentro de la ventana del reporte (Drilldown) coincide centavo a centavo con el valor de la tarjeta clickeada.

---

## 4. 📈 Validación de Gráficas

- [ ] **CFDI de Ingresos por mes:** La barra morada (cantidad de facturas) y la línea roja (monto) coinciden con mis cortes mensuales.
- [ ] **CFDI Vigentes vs Cancelados:** La suma de la barra azul (Vigentes) y la barra gris (Cancelados) equivale al total de documentos emitidos/recibidos en el mes seleccionado.
- [ ] **CFDI por Tipo:** La barra "I" (Ingreso) coincide con el total de facturas emitidas. Las barras de Egresos, Pagos o Nóminas tienen sentido según la operación.
- [ ] **Métodos de Pago:** El gráfico de pastel divide correctamente las facturas de Ingreso entre aquellas pagadas de contado (PUE) y a crédito (PPD). La suma de ambas rebanadas coincide con el total de facturas de ingreso vigentes.

---
*Firma de Validación (QA / Usuario):* ___________________________  
*Fecha de Validación:* ___________________________
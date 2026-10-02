# ✅ Checklist de Pruebas: Tablero de Egresos

Basado en la Guía de Pruebas del módulo `/dashboard_recibidos`.

---

## 1. ⚙️ Pre-requisitos y Filtros
- [ ] **CH-REC-01:** Verificar que el tablero carga con todas las tarjetas en `$0.00` o en estado vacío si no se selecciona un rango de fechas inicial.
- [ ] **CH-REC-02:** Verificar que al seleccionar fechas (ej. 01/07/2026 al 31/07/2026) y dar clic en "Consultar", el sistema carga la información real (Heavy Metrics).

## 2. 💳 Resumen de Egresos
- [ ] **CH-REC-03:** Tarjeta "Gasto Bruto Comercial": Validar que sume el `SubTotal` de facturas tipo `I` (Ingreso) vigentes del periodo.
- [ ] **CH-REC-04:** Tarjeta "Notas de Crédito Aplicadas": Validar que sume el `SubTotal` de facturas tipo `E` (Egreso) vigentes.
- [ ] **CH-REC-05:** Tarjeta "Gastos Netos Totales": Confirmar la resta matemática (Bruto - Notas de Crédito).

## 3. ⚖️ Resumen de Impuestos
- [ ] **CH-REC-06:** Tarjeta "IVA Acreditable Desglosado": Comprobar la suma del impuesto 002 extraída del nodo de Traslados.
- [ ] **CH-REC-07:** Tarjeta "Total Retenciones": Comprobar la suma de impuestos extraídos del nodo Retenciones.
- [ ] **CH-REC-08:** Abrir el Drilldown ("Ver detalle") de ambas tarjetas y validar que la tabla lista los CFDI correspondientes y permite exportar a CSV.

## 4. 💰 Resumen de Pagos y Saldos
- [ ] **CH-REC-09:** Tarjeta "Total Pagado en el Periodo": Verificar suma (PUE del periodo + Pagos REP del periodo).
- [ ] **CH-REC-10:** Tarjeta "Total Pendiente de Pago": Verificar que refleje el Saldo Insoluto real de facturas PPD vigentes.
- [ ] **CH-REC-11:** Tarjeta "Saldo Vencido (Aging)": Validar que los montos se distribuyan en los buckets correctos (0-30, 31-60, etc.) calculados desde la Fecha de Emisión.
- [ ] **CH-REC-12:** Abrir los Drilldowns de estas tres tarjetas, probar los filtros internos de las tablas y descargar el CSV de saldos.

## 5. 🚨 Auditoría Fiscal y Riesgos
- [ ] **CH-REC-13:** Tarjeta "Riesgo EFOS": Confirmar que identifica a proveedores del art. 69-B. (El monto debe estar en rojo si es > 0).
- [ ] **CH-REC-14:** Tarjeta "Cancelaciones Post-Carga": Confirmar que detecta discrepancias de estatus SAT posterior a la descarga.
- [ ] **CH-REC-15:** Abrir el Drilldown de Riesgo EFOS y comprobar la descarga de la evidencia en CSV.

## 6. 🛡️ Coherencia y Reglas de Negocio
- [ ] **CH-REC-16:** Tarjeta "Facturas PUE con Forma 99": Validar que cuente correctamente los CFDI con esta inconsistencia.
- [ ] **CH-REC-17:** Tarjeta "Retención RESICO sin 1.25%": Validar la detección de emisores régimen 626 sin retención.
- [ ] **CH-REC-18:** Tarjeta "Inconsistencia ObjetoImp vs IVA": Validar detección de errores entre el atributo ObjetoImp y los nodos de impuestos.
- [ ] **CH-REC-19:** Abrir los Drilldowns de Reglas de Negocio y verificar su funcionamiento y exportación.

## 7. 📈 Gráficas y Top 5
- [ ] **CH-REC-20:** Gráfica "Egresos por Mes": Verificar que se renderizan las barras y la línea de tendencia.
- [ ] **CH-REC-21:** Gráfica "Métodos de Pago": Verificar distribución de pastel (PUE vs PPD).
- [ ] **CH-REC-22:** Tablas "Top 5 Proveedores": Confirmar que se listan los RFC correctos en orden descendente.
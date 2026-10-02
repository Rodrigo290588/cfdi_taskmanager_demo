# 📘 Guía de Pruebas: Tablero de Egresos

**Ubicación del módulo:** `/dashboard_recibidos`  
**Objetivo:** Validar los cálculos, métricas (KPIs), gráficas y desgloses (Drilldowns) del tablero de facturas recibidas (gastos y compras de la empresa).

---

## 1. ⚙️ Pre-requisitos y Filtros de Búsqueda
- **Selección de Empresa:** Es obligatorio tener una empresa seleccionada en el sidebar.
- **Filtro de Fechas:** Para ver datos (Heavy Metrics), el usuario debe seleccionar obligatoriamente un rango de fechas (Fecha Inicio y Fecha Fin) y presionar "Consultar".
- **Sin filtros:** Si no se aplican fechas, el tablero muestra "0" o estados vacíos para evitar sobrecargar el servidor (Summary Metrics).

## 2. 💳 Sección: Resumen de Egresos
1. **Gasto Bruto Comercial:** Suma del atributo `SubTotal` de los CFDI tipo Ingreso (`I`) VIGENTES emitidos en el rango de fechas, donde la empresa es el RECEPTOR.
2. **Notas de Crédito Aplicadas:** Suma del atributo `SubTotal` de los CFDI tipo Egreso (`E`) VIGENTES recibidos en el rango de fechas.
3. **Gastos Netos Totales:** Resta simple: `(Gasto Bruto Comercial) - (Notas de Crédito Aplicadas)`.

## 3. ⚖️ Sección: Resumen de Impuestos
1. **IVA Acreditable (Desglosado):** Suma del IVA trasladado (generalmente tasas 16% y 8%) extraído directamente del nodo global de `<cfdi:Impuestos><cfdi:Traslados>` en facturas de Gasto. **Nota:** Se basa en fecha de emisión, no en fecha de pago. *Tiene un botón "Ver Detalle" que abre una tabla con el listado de las facturas que componen la suma.*
2. **Total Retenciones (ISR, IVA, IEPS):** Suma del total de impuestos retenidos extraído del nodo global `<cfdi:Impuestos><cfdi:Retenciones>`. *Tiene un botón "Ver Detalle" que desglosa la retención por factura.*

## 4. 💰 Sección: Resumen de Pagos y Saldos
1. **Total Pagado en el Periodo:** Suma de todas las facturas `PUE` emitidas en el rango, MÁS la suma del atributo `ImpPagado` de los abonos (REP) cuya *fecha de pago real* caiga dentro del rango seleccionado. *Botón "Ver Detalle" muestra los pagos.*
2. **Total Pendiente de Pago:** Suma del *Saldo Insoluto* actual de todas las facturas `PPD` VIGENTES. *Botón "Ver Detalle" abre la tabla de saldos.*
3. **Saldo Vencido (Aging):** Toma el Total Pendiente de Pago y lo agrupa en 4 cubetas según los días transcurridos desde su Fecha de Emisión hasta el día de hoy:
   - 0 a 30 días
   - 31 a 60 días
   - 61 a 90 días
   - Más de 90 días
   *Botón "Ver Detalle" abre la tabla de cartera vencida.*

## 5. 🚨 Sección: Auditoría Fiscal y Riesgos (Listas Negras)
1. **Riesgo EFOS (Artículo 69-B):** Detecta facturas VIGENTES emitidas por proveedores que se encuentren en la lista negra del SAT (Definitivos, Presuntos, etc.). Si el valor es mayor a $0, se resalta en rojo. *Botón "Ver Detalle" muestra el listado para descargar en CSV.*
2. **Cancelaciones Post-Carga:** Detecta CFDI que el sistema originalmente descargó o recibió como VIGENTES, pero que tras una sincronización posterior con el SAT, resultaron estar CANCELADOS. *Botón "Ver Detalle" muestra las alertas.*

## 6. 🛡️ Sección: Coherencia y Reglas de Negocio
1. **Facturas PUE con Forma de Pago 99:** Detecta comprobantes emitidos con Método de Pago `PUE` (Pago en una sola exhibición) pero con Forma de Pago `99` (Por definir). Esto es una inconsistencia del Anexo 20 del SAT.
2. **Retención RESICO sin 1.25%:** Detecta emisores que tributan bajo el Régimen Simplificado de Confianza (626) y que emitieron una factura sin la retención obligatoria de ISR del 1.25% (o con un monto incorrecto).
3. **Inconsistencia ObjetoImp vs IVA:** Detecta incongruencias entre el atributo `ObjetoImp` y el nodo de impuestos. (Ejemplo: `ObjetoImp="02"` pero sin nodo de IVA, o `ObjetoImp="01"` y trae nodo de IVA).

## 7. 📈 Sección: Gráficas de Análisis
1. **Gráfica de Egresos por Mes (Mensual):** Muestra barras combinadas. Una barra es la Cantidad de CFDI (eje Y izquierdo) y la línea es el Monto Total (eje Y derecho) a través del tiempo.
2. **Gráfica de Métodos de Pago:** Gráfico de pastel (Doughnut) que muestra la distribución porcentual entre PUE y PPD.
3. **Tablas Top 5:**
   - **Top 5 Proveedores (Por Gasto):** Lista a los RFC emisores a los que más se les compró en el periodo.
   - **Top 5 Proveedores (Por Riesgo EFOS):** Lista a los proveedores en lista negra con mayor monto emitido.
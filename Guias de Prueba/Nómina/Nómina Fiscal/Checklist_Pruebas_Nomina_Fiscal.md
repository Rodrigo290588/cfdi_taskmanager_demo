# ✅ Checklist de Pruebas: Nómina Fiscal

Este documento contiene la lista de verificaciones para el tablero de Nómina Fiscal, diseñado para que cualquier usuario de negocio pueda confirmar que la información mostrada es correcta y cuadra con los registros.

## 1. ⚙️ Pre-requisitos (Configuración Inicial)
- [ ] Ingresar al sistema y seleccionar una empresa válida.
- [ ] Seleccionar una fecha de inicio y una fecha de fin en los filtros de la parte superior.
- [ ] Hacer clic en el botón "Filtrar".
- [ ] Verificar que el tablero cargue la información y muestre números en lugar de quedarse en blanco.

## 2. 💳 Validación de Tarjetas de Resumen
- [ ] **Total de Recibos de Nómina**: Verificar que se muestre la cantidad total de recibos de nómina emitidos en el periodo seleccionado.
- [ ] **Sueldos y Salarios**: Comprobar que los montos reflejen el total de percepciones (gravado y exento).
- [ ] **Total de Retenciones (ISR)**: Confirmar que la suma del impuesto retenido coincida con los pagos realizados.
- [ ] **Deducciones y Cuotas a Terceros**: Validar que los montos descontados a los empleados cuadren con los registros de la empresa.
- [ ] **Horas Extras**: Revisar que el pago por horas dobles y triples esté correctamente reflejado.

## 3. 🖱️ Interfaz y Experiencia de Usuario
- [ ] Hacer clic en una tarjeta de resumen que tenga un valor mayor a cero y verificar que se abra una ventana con el detalle de los recibos.
- [ ] Hacer clic en una tarjeta con valor de cero ($0.00) y comprobar que no haga nada (no debe abrir una ventana vacía).
- [ ] Pasar el ratón sobre las gráficas y verificar que los recuadros de información floten hacia un lado sin tapar el centro de la gráfica.

## 4. 📈 Validación de Gráficas
- [ ] **Tendencia Mensual**: Comprobar que la gráfica de barras o líneas muestre la evolución de la nómina mes a mes.
- [ ] **Composición de Percepciones**: Verificar que la gráfica redonda (dona) incluya los porcentajes claramente visibles dentro de cada segmento.
- [ ] **Recibos Vigentes vs Cancelados**: Validar que los recibos cancelados se muestren en un color distinto y estén separados de los vigentes.

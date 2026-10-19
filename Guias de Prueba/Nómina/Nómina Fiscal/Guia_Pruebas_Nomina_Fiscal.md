# 📘 Guía de Pruebas: Nómina Fiscal

Esta guía le ayudará a validar el funcionamiento del tablero de Nómina Fiscal paso a paso, asegurando que los cálculos y la visualización sean correctos.

## Objetivo
Asegurar que los recibos de nómina emitidos por la empresa se procesen correctamente y que los totales de percepciones, deducciones e impuestos retenidos cuadren a la perfección con los registros de recursos humanos y contabilidad.

## Pasos para realizar la prueba manual

### Paso 1: Filtros de Fecha
1. Entre a la sección de Nómina y seleccione el tablero "Nómina Fiscal".
2. Note que el tablero inicialmente debe estar vacío (en ceros).
3. Seleccione un rango de fechas en el que sepa que hubo pago de nómina.
4. Presione el botón "Filtrar".
5. Verifique que los números exactos aparezcan en las tarjetas superiores.

### Paso 2: Revisión de Totales
1. Revise la tarjeta "Total de Recibos". Debe coincidir con la cantidad de recibos emitidos a sus empleados en esas fechas.
2. Revise la tarjeta "ISR Retenido". Este número debe coincidir con el monto a declarar al SAT por concepto de sueldos y salarios.
3. Observe que los montos se muestran con sus decimales exactos, sin redondeos que puedan causar diferencias contables.

### Paso 3: Ventanas de Detalle (Drilldown)
1. Haga clic sobre la tarjeta de "ISR Retenido".
2. Se abrirá una ventana con el detalle de cada recibo que compone ese total.
3. Compruebe que la lista no contiene códigos internos del sistema, sino información clara del empleado y el monto.
4. Cierre la ventana.
5. Si alguna tarjeta tiene un valor de $0.00, haga clic en ella y asegúrese de que no ocurra nada.

### Paso 4: Gráficas y Visualización
1. Baje a la sección de gráficas.
2. En la gráfica de dona (Composición), verifique que los porcentajes se encuentren dentro de los segmentos de color.
3. Pase el cursor sobre la gráfica y confirme que el cuadro de información aparece a un lado, sin tapar la gráfica.
4. En las gráficas de meses o años, verifique que los años estén indicados claramente (por ejemplo, "Año 2026").

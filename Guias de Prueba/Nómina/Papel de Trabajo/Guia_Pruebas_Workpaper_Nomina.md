# 📘 Guía de Pruebas: Papel de Trabajo de Nómina

Esta guía explica cómo validar la información de la sábana analítica de recibos de nómina (Papel de Trabajo).

## Objetivo
Asegurar que la tabla extrae y muestra correctamente la información de todos los recibos emitidos, garantizando la precisión matemática y una buena legibilidad.

## Pasos de Validación Manual

### Paso 1: Configurar la Búsqueda
1. Abra el módulo "Papel de Trabajo de Nómina".
2. Ingrese un periodo de tiempo.
3. Pulse "Filtrar" y espere a que la tabla se llene de información.

### Paso 2: Análisis de Datos en la Tabla
1. Busque un recibo de un empleado específico.
2. Verifique la columna de "Percepciones" y asegúrese de que muestra los centavos de forma exacta.
3. Confirme que las deducciones y los impuestos retenidos cuadran con el recibo original.
4. Verifique que no exista ninguna columna nombrada de forma extraña o técnica (como `id`, `xml_data`, etc.).

### Paso 3: Revisión Visual y Exportación
1. Asegúrese de que las celdas de la tabla sean de un tamaño ajustado para aprovechar bien el espacio de la pantalla.
2. Si cuenta con botones de exportación, haga una descarga y valide que el documento generado contiene las mismas columnas mostradas en pantalla y no altera los montos.

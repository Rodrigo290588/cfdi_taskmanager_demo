# 📘 Guía de Pruebas: Tablero de RH

Esta guía detalla cómo probar la funcionalidad del Tablero Analítico de Recursos Humanos.

## Objetivo
Validar que la sincronización automática de los recibos de nómina alimente correctamente el tablero de RH, reflejando fielmente la plantilla, la rotación, las incapacidades y los beneficios otorgados a los empleados.

## Pasos de Validación Manual

### Paso 1: Filtros de Análisis
1. Abra el tablero de RH.
2. Note que los filtros de fecha deben iniciar vacíos y el tablero en ceros.
3. Ingrese fechas válidas y pruebe seleccionar un "Tipo de Nómina" específico.
4. Haga clic en Filtrar y compruebe que los resultados cambian según la selección.

### Paso 2: Análisis de Plantilla y Rotación
1. Verifique el KPI de "Total de Empleados".
2. Revise el KPI de "Rotación (Turnover)". Pase el cursor sobre el KPI para ver el recuadro de información (tooltip) y confirmar que la fórmula de cálculo explicada tiene sentido.
3. Haga clic para abrir el detalle y compruebe que no se muestran IDs técnicos (claves de sistema), garantizando la seguridad de la información.

### Paso 3: Incapacidades y Beneficios
1. Localice la tarjeta de Incapacidades. Verifique que los días descontados cuadren con sus registros del IMSS.
2. Localice la tarjeta de Beneficios.
3. Asegúrese de que todos los conceptos mostrados incluyan el texto descriptivo oficial del SAT, no solo la clave numérica.

### Paso 4: Revisión Visual
1. Desplácese hacia abajo para ver las gráficas de tendencia.
2. Asegúrese de que la visualización tenga un diseño claro (vertical), sin amontonar la información.
3. Confirme que las leyendas indiquen dinámicamente el año (ej. "Año 2025" vs "Año 2026") y no textos genéricos.

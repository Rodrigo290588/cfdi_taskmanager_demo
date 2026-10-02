# Guía de Pruebas: Monitor de Importación (`/dashboard/import-monitor`)

## 1. Objetivo
Asegurar que la pantalla de "Monitor de integridad y timbrado de CFDI's" funcione correctamente. Esta pantalla es el panel principal donde podemos ver en tiempo real cómo el sistema está recibiendo, leyendo y guardando las facturas (CFDIs). Debemos comprobar que los números cuadren, que las búsquedas funcionen, que podamos ver el detalle de cada documento y que los reportes de errores se descarguen de forma segura.

## 2. Lo que necesitas antes de empezar
- Tener acceso al sistema con una cuenta que tenga permisos para ver el menú "Dashboard".
- Asegurarte de que el sistema tiene datos de prueba cargados (facturas recientes y algunas corridas de importación).
- Un programa para abrir archivos de Excel o CSV (como Microsoft Excel o Google Sheets) para revisar las descargas.

## 3. Casos de Prueba (Paso a Paso)

### Prueba 1: Revisar que los números se actualicen en tiempo real
- **¿Qué vamos a probar?:** Que la pantalla principal muestre los totales de facturas correctamente y nos avise cuando está trabajando en ese momento.
- **Pasos:**
  1. Entra a la pantalla del "Monitor de integridad y timbrado de CFDI's".
  2. Observa las tres tarjetas principales arriba ("CFDI Recibidos", "Velocidad de Proceso" y "Corridas Activas").
  3. **Lo que debe pasar:** 
     - Los números deben aparecer claramente.
     - Si el sistema está procesando facturas en ese momento (Corridas Activas es mayor a cero), debe aparecer un letrero verde que parpadea diciendo "EN VIVO" junto al botón de actualizar.
     - La barra de "Progreso General" debe llenarse mostrando el porcentaje de avance.

### Prueba 2: Verificar la conciliación de archivos (Control de Directorio)
- **¿Qué vamos a probar?:** Que el sistema nos avise si hay diferencias entre los archivos físicos que le dimos y los que realmente logró registrar en la base de datos.
- **Pasos:**
  1. En la misma pantalla, busca la sección "Cifras de Control de Directorio".
  2. Revisa los recuadros de "XML en Directorio", "Registrados" y "Procesados".
  3. Observa los textos en la parte de abajo de esos recuadros que dicen "Brecha directorio - monitor".
  4. **Lo que debe pasar:**
     - Si los números cuadran perfectamente, el texto de la brecha debe estar en color **verde** (indicando que todo está bien).
     - Si falta algún documento por procesar, el texto de la brecha debe cambiar a color **naranja/ámbar** para llamar nuestra atención.

### Prueba 3: Buscar y filtrar procesos (Corridas)
- **¿Qué vamos a probar?:** Que podamos encontrar un grupo de facturas específico usando los buscadores y las fechas.
- **Pasos:**
  1. Baja a la sección "Corridas".
  2. Escribe una palabra clave en la barra de búsqueda (por ejemplo, el ID de un lote que conozcas).
  3. Haz clic en el botón de "Últimos 7 días".
  4. **Lo que debe pasar:**
     - La tabla de abajo debe actualizarse automáticamente.
     - Solo deben aparecer en la lista las importaciones que se hicieron en la última semana y que coincidan con lo que escribiste en el buscador.

### Prueba 4: Ver el detalle de los documentos (Drilldown)
- **¿Qué vamos a probar?:** Que podamos abrir el detalle de una importación y ver la lista exacta de facturas que entraron en ese momento.
- **Pasos:**
  1. En la tabla de Corridas, elige cualquier fila y haz clic en el botón "Ver Documentos".
  2. Se abrirá una ventana grande que cubre toda la pantalla.
  3. Dentro de esa ventana, haz clic en el botón "Solo errores".
  4. **Lo que debe pasar:**
     - La ventana grande debe mostrar un resumen en la parte de arriba con los datos de esa corrida.
     - La tabla de abajo debe cambiar y mostrar **únicamente** las facturas que tuvieron algún problema, ocultando las que fueron exitosas.

### Prueba 5: Descargar el reporte de errores de forma segura
- **¿Qué vamos a probar?:** Que al descargar la lista de facturas con errores, el archivo de Excel sea seguro de abrir y la información esté correcta.
- **Pasos:**
  1. Cierra la ventana grande si la tienes abierta para volver a la pantalla principal.
  2. En la parte de arriba, busca la tarjeta que dice "Errores" y haz clic en ella.
  3. Se abrirá una ventana con la lista total de errores. Haz clic en el botón para descargar o exportar (Exportar CSV).
  4. Abre el archivo descargado en Excel.
  5. **Lo que debe pasar:**
     - El archivo debe descargarse en tu computadora.
     - Al abrirlo en Excel, la información (como el RFC o el motivo del error) debe leerse claramente. No deben ejecutarse fórmulas extrañas, incluso si algún mensaje de error empieza con signos de igual (`=`) o suma (`+`).
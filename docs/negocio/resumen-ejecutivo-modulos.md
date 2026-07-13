# Documento Ejecutivo de Funcionalidades del Sistema

## Objetivo

Este documento resume, en lenguaje ejecutivo, las funcionalidades actualmente disponibles en el sistema para los modulos de:

1. Ingresos
2. Egresos
3. Descargas Masivas

El objetivo es ofrecer una vista clara del valor operativo y fiscal que hoy aporta la plataforma, asi como del estado funcional real de cada modulo.

## Resumen Ejecutivo General

El sistema ya cuenta con tres bloques funcionales maduros:

- **Ingresos**, orientado al analisis fiscal, cobranza, conciliacion y explotacion detallada de CFDI emitidos.
- **Egresos**, orientado al control de CFDI recibidos, portal de proveedores, validaciones preventivas, pagos, saldos y auditoria fiscal.
- **Descargas Masivas**, orientado a la automatizacion de solicitudes SAT, verificacion asincrona, descarga de paquetes y explotacion de metadata.

En conjunto, la plataforma cubre procesos clave de:

- recepcion y resguardo de CFDI
- validacion fiscal y operativa
- monitoreo y auditoria
- reporteo ejecutivo y analitico
- exportacion de informacion para trabajo contable y fiscal

---

## 1. Modulo de Ingresos

### Objetivo de negocio

Permitir el control integral de CFDI emitidos para analizar ventas, ingresos cobrados y pendientes, cancelaciones, comportamiento por cliente y explotacion fiscal detallada.

### Funcionalidades principales

- **Dashboard fiscal ejecutivo**
  - Muestra KPIs de ingresos brutos, ingresos netos, ingresos cobrados, ingresos pendientes, cancelaciones, IVA cobrado, IVA pendiente y retenciones.
  - Presenta una vista ejecutiva del comportamiento de los CFDI emitidos en un rango de fechas.

- **Analitica visual**
  - Incluye graficas de ingresos por mes, estatus de CFDI, metodos de pago, top clientes y top productos.
  - Facilita lectura rapida de tendencia comercial y fiscal.

- **Drilldowns operativos**
  - Cada tarjeta relevante puede abrir reportes detallados en pantalla completa.
  - Se pueden revisar ingresos cobrados, pendientes, nominativos, globales, individuales, descuentos y notas de credito.
  - Los drilldowns cuentan con filtros por columna y exportacion del subconjunto visible.

- **Reporte detallado de ingresos / workpaper**
  - Permite consultar CFDI emitidos con filtros avanzados.
  - Soporta columnas configurables, reordenamiento y expansion de conceptos.
  - Permite trabajar el detalle del CFDI desde una vista analitica y exportable.

- **Exportaciones y descargas**
  - Exportacion a CSV y Excel.
  - Descarga de XML y PDF por documento.
  - Descarga ZIP de CFDI seleccionados.

- **Ingresos parcialmente cobrados**
  - Analiza facturas PPD y cruza la informacion contra REPs.
  - Calcula total pagado, saldo insoluto y estatus de cobranza.
  - Facilita control de cuentas por cobrar y conciliacion fiscal.

- **Modulo de cancelaciones**
  - Lista CFDI cancelados con filtros especializados.
  - Permite consulta, exportacion y descarga documental.

- **Monitor operativo de emision API**
  - Existe un monitor tecnico para revisar volumen de solicitudes, errores, tiempos de respuesta y trazabilidad de logs.
  - Su valor principal es de supervision operativa y soporte.

### Valor para la direccion

- Provee visibilidad ejecutiva del ingreso facturado y cobrado.
- Mejora el control de cobranza y pendientes fiscales.
- Facilita auditoria de ventas, descuentos, notas de credito y cancelaciones.
- Reduce tiempo de analisis por concentrar KPIs, detalle y exportaciones en un mismo modulo.

### Estado actual

- **Estado funcional:** Maduro y utilizable en operacion.
- **Fortaleza principal:** Analitica, reporteo y exportacion.
- **Observacion:** El monitor API existe, pero no forma parte del flujo principal visible del menu actual.

---

## 2. Modulo de Egresos

### Objetivo de negocio

Permitir el control y explotacion de CFDI recibidos de proveedores, incluyendo validaciones de recepcion, analisis de gasto, impuestos acreditables, pagos, saldos, riesgos fiscales y trazabilidad documental.

### Funcionalidades principales

- **Tablero de egresos**
  - Consolida la operacion de CFDI recibidos en un dashboard ejecutivo.
  - Enfoca la experiencia en gasto, impuestos, pagos, auditoria y coherencia fiscal.

- **Resumen de Egresos del Periodo**
  - Gasto Bruto Comercial
  - Devoluciones y Descuentos
  - Total de Gastos Netos
  - Facilita lectura rapida del impacto economico del periodo.

- **Resumen de Impuestos del Periodo**
  - IVA acreditable
  - Retenciones del periodo
  - Incluye desglose por tasa y tipo de impuesto para fines fiscales.

- **Resumen de Pagos y Saldos**
  - Total pagado en el periodo
  - Saldo pendiente de pago
  - Antiguedad de saldos
  - Conciliacion entre CFDI PUE, CFDI PPD y REPs.

- **Auditoria fiscal y riesgos**
  - Identificacion de riesgo EFOS / 69-B.
  - Alertas de cancelacion post-carga.
  - Apoya control preventivo sobre deducibilidad y riesgo documental.

- **Coherencia de datos y reglas de negocio**
  - Detecta inconsistencias fiscales y operativas dentro de los CFDI recibidos.
  - Genera visibilidad analitica sobre incumplimientos de reglas clave.

- **Drilldowns full-screen**
  - Cada bloque principal abre reportes detallados en pantalla completa.
  - Incluye filtros por columna y exportacion CSV basada en los registros visibles.

- **Workpaper de egresos**
  - Permite revisar CFDI de proveedores con filtros avanzados.
  - Incluye columnas configurables, expansion de conceptos y descargas documentales.
  - Opera como vista detallada para revision contable y fiscal.

- **Resguardo seguro de informacion**
  - Los XML se almacenan cifrados y desacoplados del modelo analitico principal.
  - El dashboard explota resumenes y estructuras preparadas para evitar dependencia total del XML crudo en cada consulta.

### Valor para la direccion

- Aporta control ejecutivo del gasto y sus implicaciones fiscales.
- Mejora la visibilidad de IVA acreditable, retenciones y pasivos pendientes.
- Permite identificar riesgos con proveedores antes de afectar deduccion o cumplimiento.
- Facilita trabajo de tesoreria, contabilidad y auditoria desde un mismo frente operativo.

### Estado actual

- **Estado funcional:** Maduro y con fuerte orientacion operativa.
- **Fortaleza principal:** Integracion entre analitica, validacion, pagos y riesgo fiscal.
- **Observacion:** El workpaper aun conserva algunos textos heredados de "Reporte de Ingresos", aunque funcionalmente opera sobre egresos.

---

## 2.1 Portal de Proveedores y Validaciones

### Objetivo de negocio

Permitir que el proveedor cargue CFDI de forma controlada, validada y auditable, evitando errores de recepcion, documentos inconsistentes o informacion que comprometa el cumplimiento fiscal del cliente.

### Funcionalidades principales

- **Portal de carga de CFDI**
  - El proveedor puede cargar archivos XML y ZIP.
  - El sistema procesa cargas masivas y registra el resultado por archivo.

- **Validacion de identidad del proveedor**
  - El RFC emisor del XML debe coincidir con el proveedor autenticado.
  - Evita que un proveedor cargue CFDI ajenos.

- **Validacion de receptor autorizado**
  - El CFDI debe estar dirigido a una empresa receptora permitida dentro de la organizacion.
  - Evita recepcion incorrecta o fuera de contexto organizacional.

- **Validacion estructural y documental**
  - Se rechazan archivos con formato invalido, ZIP vacios o documentos sin la estructura requerida.
  - Se exige UUID timbrado, RFCs presentes y consistencia minima del CFDI.

- **Validacion fiscal externa**
  - Se ejecuta validacion tipo Anexo 20.
  - Se consulta estatus SAT antes de aceptar el CFDI.

- **Control de duplicados**
  - Se evita ingreso repetido del mismo UUID.
  - Tambien se controla consistencia en cargas donde existen REPs relacionados.

- **Gestion de errores y rechazados**
  - El proveedor puede consultar archivos rechazados.
  - El sistema muestra motivo, detalle tecnico, accion correctiva y responsable sugerido.

- **Reporte del proveedor**
  - Vista tabular de CFDI aceptados.
  - KPIs de facturas visibles, total pagado y saldo por cobrar.
  - Expansion de REPs relacionados.
  - Descarga de XML y PDF.

- **Bitacora y auditoria**
  - El sistema registra eventos de importacion, cambios relevantes y acciones automticas de bloqueo o desbloqueo.

- **Bloqueo preventivo por incumplimiento**
  - Si una factura se marca como pagada sin REP y vence el plazo esperado, se puede bloquear la recepcion futura de nuevos CFDI del proveedor hasta regularizar la situacion.

### Reglas de negocio actualmente implementadas

- **PUE vs FormaPago 99**
  - Detecta o rechaza CFDI donde MetodoPago es PUE y FormaPago es 99.

- **RESICO sin retencion ISR 0.012500**
  - Detecta o rechaza CFDI de emisores RESICO a persona moral sin la retencion requerida.

- **ObjetoImp vs IVA trasladado**
  - Detecta o rechaza inconsistencias entre el objeto de impuesto y la existencia de IVA trasladado.

### Valor para la direccion

- Reduce errores de recepcion documental desde el origen.
- Disminuye carga operativa del area contable.
- Previene riesgos fiscales por CFDI mal emitidos, duplicados o sin soporte correcto.
- Aumenta trazabilidad y disciplina documental con proveedores.

### Estado actual

- **Estado funcional:** Implementado y operativo.
- **Fortaleza principal:** Validacion preventiva real en backend.
- **Observacion:** Algunas vistas del portal todavia muestran elementos de UI como "Proximamente", aunque las reglas ya se aplican efectivamente al procesar archivos.

---

## 3. Modulo de Descargas Masivas

### Objetivo de negocio

Automatizar la solicitud, seguimiento y descarga de informacion del SAT para reducir trabajo manual, mejorar trazabilidad y habilitar explotacion posterior de metadata y paquetes descargados.

### Funcionalidades principales

- **Gestion de credenciales SAT**
  - Carga de archivos `.cer`, `.key` y contrasena.
  - Validacion de correspondencia entre certificado, llave y RFC.
  - Resguardo cifrado de informacion sensible.

- **Solicitud de descargas masivas**
  - Soporta solicitudes de CFDI emitidos, recibidos y por folio.
  - Permite filtros por UUID, RFC, tipo de comprobante, estatus, tercero, complemento y fechas.

- **Verificacion asincrona**
  - El sistema consulta el estatus de las solicitudes de forma automatica.
  - Usa workers y colas para evitar bloquear la operacion del usuario.
  - Maneja reintentos con backoff progresivo.

- **Persistencia de estatus**
  - Guarda solicitud, intentos de verificacion, mensajes SAT, paquetes disponibles y siguiente revision.
  - Permite trazabilidad operativa del ciclo de descarga.

- **Descarga de paquetes ZIP**
  - Descarga paquetes usando el endpoint correcto del SAT.
  - Guarda los archivos en almacenamiento local para explotacion posterior.

- **Procesamiento masivo de metadata**
  - Si la descarga corresponde a metadata, el sistema procesa archivos TXT por streaming.
  - Inserta la informacion por lotes en base de datos para soportar volumen alto.

- **Monitores y paneles**
  - Monitor de solicitudes
  - Monitor de verificacion
  - Monitor de paquetes descargados
  - Panel fiscal de control basado en metadata descargada

- **Base para explotacion fiscal**
  - La metadata descargada se puede cruzar con otros datos del sistema para revisar completitud, cancelaciones y conciliacion documental.

### Valor para la direccion

- Reduce dependencia de descargas manuales desde el portal SAT.
- Mejora trazabilidad y control del proceso de recuperacion documental.
- Permite operar descargas a escala con seguimiento automatizado.
- Fortalece la base de informacion para analisis fiscal y conciliacion posterior.

### Estado actual

- **Estado funcional:** Implementado en el flujo principal de solicitud, verificacion y descarga.
- **Fortaleza principal:** Automatizacion SAT con workers y control de estatus.
- **Observacion:** Existe un frente paralelo tipo "SAT portal/sincronizaciones" que todavia opera de forma parcial o demo y no representa una sincronizacion productiva completa de todos los CFDI hacia los modelos analiticos internos.

---

## Beneficios Ejecutivos Globales

- **Control documental**
  - El sistema centraliza CFDI emitidos, recibidos y descargados desde SAT.

- **Cumplimiento fiscal**
  - Integra validaciones, alertas, conciliacion y monitoreo sobre documentos con impacto tributario.

- **Productividad operativa**
  - Reduce trabajo manual mediante filtros, drilldowns, workpapers, exportaciones y automatizaciones.

- **Trazabilidad**
  - Mantiene evidencia operativa sobre cargas, cambios, validaciones y procesos asincronos.

- **Escalabilidad funcional**
  - Ya existe una separacion razonable entre datos operativos, analiticos y blobs XML cifrados, lo que ayuda a soportar crecimiento futuro.

---

## Observaciones Ejecutivas Finales

- El sistema ya cuenta con una base funcional robusta para operacion fiscal y documental.
- Los modulos mas maduros a nivel de valor de negocio visible son **Ingresos** y **Egresos**.
- **Descargas Masivas** ya resuelve el flujo critico de SAT, aunque todavia existe espacio para consolidar completamente la parte de sincronizacion analitica unificada.
- El **portal de proveedores** ya no debe verse como un componente accesorio: hoy es una pieza central de control preventivo, calidad documental y cumplimiento.

## Recomendacion de uso de este documento

Este documento puede utilizarse como:

- base para presentacion ejecutiva
- insumo para propuesta comercial o demo
- resumen funcional para direccion
- punto de partida para roadmap de fortalecimiento

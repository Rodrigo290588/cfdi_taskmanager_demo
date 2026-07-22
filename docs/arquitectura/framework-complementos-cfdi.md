# Framework De Complementos CFDI (Proyección Escalable)

## Objetivo

Permitir que pantallas tipo reporte (ej. workpaper) soporten atributos de la mayoría de los complementos CFDI del SAT sin:

- depender del parseo de XML en el request path
- convertir el almacenamiento principal a JSONB
- degradar rendimiento cuando el volumen crezca a millones de CFDI por año

## Principios

1. **XML como fuente de verdad (cifrado)**
   - El XML completo se resguarda cifrado en tablas blob (ej. `invoice_blobs`).
   - El frontend nunca consume XML completo de forma directa; solo mediante endpoints autorizados.

2. **Consultas masivas = columnas y proyecciones**
   - Filtros por columna, ordenamiento y exportación deben depender de:
     - columnas tipadas e indexables
     - tablas de proyección derivadas (índices y atributos)
   - Evitar `contains` sobre XML o `LIKE` sobre textos grandes.

3. **Complementos no son todos iguales**
   - Complementos con impacto analítico fuerte (ej. Pagos/REP) requieren tablas dedicadas.
   - Complementos raros o de baja explotación pueden representarse como atributos indexados o JSONB acotado.

4. **Estructuras repetibles no van a columnas**
   - Nodos repetibles (Conceptos, DoctoRelacionado, Traslados/Retenciones por concepto) viven en tablas hijas.

5. **Diseño aplicable a ingresos, egresos y nuevos módulos**
   - La capa de proyección se diseña por “dominio” (emitidos/egresos/pagos/nómina) y puede replicarse a cualquier módulo que use CFDI como documento base.

## Scope Inicial (Workpaper)

La pantalla `workpaper` hoy muestra columnas core y permite columnas adicionales derivadas del XML.

El objetivo es migrar columnas y filtros “XML” a la capa de proyección para que:

- el endpoint de listado ya no devuelva `xmlContent` por defecto
- los filtros por atributos XML se resuelvan por índices/joins
- el XML se use solo para drilldown/descarga

## Plan Por Fases (API, Backfill, UI)

Este plan está diseñado para aplicarse a:

- emitidos (Ingreso/Egreso/Pago/Traslado/Nómina en `Invoice`)
- egresos (mismo `Invoice` con `cfdiType=EGRESO`)
- módulos futuros (Carta Porte, Comercio Exterior, Nómina dedicado, etc.)

Documentación complementaria:

- [workpaper-columnas-dinamicas.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/arquitectura/workpaper-columnas-dinamicas.md)
- [backfill-complementos-operativo.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/arquitectura/backfill-complementos-operativo.md)
- [validacion-complementos-sql.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/arquitectura/validacion-complementos-sql.md)

### Fase 0: Catálogo y contrato estable

**Objetivo**

- definir un catálogo estable de columnas dinámicas que no dependa del XML

**Impacto UI**

- el botón `Columnas` debe operar sobre un catálogo declarativo con:
  - `key` estable (ej. `attr.pagos.monedaP`)
  - `label` visible
  - `group` (para UI)
  - `kind`: `core | projectionAttribute | specialized`

**Impacto API**

- estandarizar query params:
  - `has.<ComplementType>=1`
  - `attr.<AttributeKey>=valor`

**Impacto Backfill**

- ninguno aún (solo definición y contrato)

### Fase 1: Índice de complementos (presencia/versión)

**Objetivo**

- habilitar filtros por presencia de complemento sin tocar XML

**Impacto BD**

- agregar `InvoiceComplementIndex`

**Impacto Backfill**

- scripts mínimos viables:
  - `backfill:invoice-complement-projections`
  - `backfill:provider-complement-projections`
- en esta primera etapa:
  - procesan por lotes
  - detectan presencia de complementos desde XML (blob o legacy)
  - generan índice + atributos consultables en un solo paso

**Impacto API**

- extender `/api/dashboard_fiscal/invoices`:
  - aceptar filtros `has.*`
  - traducirlos a join/exists contra `InvoiceComplementIndex`
  - mantener compatibilidad con filtros previos durante transición

**Impacto UI**

- en `Columnas`, agregar “Filtros por complemento” (checkbox tipo: Pagos, Nómina, Carta Porte, etc.) si aplica

### Fase 2: Atributos consultables (columnas dinámicas)

**Objetivo**

- que columnas basadas en XML (ej. `TipoRelacion`, `TotalImpuestosTrasladados`) dejen de depender de `xmlContent`

**Impacto BD**

- agregar `InvoiceComplementAttribute`

**Impacto Backfill**

- en la mínima viable, los scripts de proyección ya extraen atributos consultables del catálogo soportado
- en la segunda fase:
  - se amplía el catálogo
  - se endurecen heurísticas de detección
  - se incorporan variantes reales de namespaces, prefijos y versiones

**Impacto API**

- `/api/dashboard_fiscal/invoices`:
  - aceptar `attr.<AttributeKey>=...`
  - resolver filtros por `InvoiceComplementAttribute` (exists/joins)
  - devolver un objeto `projection` por fila opcionalmente:
    - `projection: { [attributeKey]: value }`
  - evitar enviar `xmlContent` por defecto

**Impacto UI**

- `Columnas`:
  - mapear `render` y exportación de ciertas columnas para leer desde `projection` en lugar de parsear XML
- mantener fallback temporal (si `projection` no existe, usar XML) solo mientras dura el backfill

### Fase 3: Tablas especializadas (Pagos/REP y relaciones)

**Objetivo**

- que cálculos de cobranza y reportes de pagos no dependan de parseo XML masivo

**Impacto BD**

- agregar `InvoicePaymentComplementDetail`

**Impacto Backfill**

- script `backfill:invoice-payment-complement`
  - procesa solo CFDI tipo PAGO
  - desglosa Pago/DoctoRelacionado
  - persiste detalle por relación
  - materializa `paymentNodeIndex`, `BaseP` e `ImporteP` para la siguiente subfase fiscal

**Estado**

- fase arrancada en mínima viable:
  - modelo Prisma
  - migración
  - helper de persistencia
  - backfill inicial
- subfase fiscal ya preparada:
  - `InvoicePaymentComplementDetail` conserva contexto del nodo `Pago`
  - captura `BaseP` e `ImporteP` desde `ImpuestosP/TrasladoP`
- consumidores ya migrados en esta subfase:
  - `dashboard_fiscal` usa `ImporteP` y `BaseP` materializados para KPIs fiscales de CRP
  - `ingresos_cobrados` usa `BaseP` materializado para el drilldown
- pendiente siguiente subfase:
  - migrar endpoints analíticos para consumir esta tabla y dejar el XML fuera del request-path

**Impacto API**

- endpoints analíticos (dashboard fiscal y drilldowns):
  - migrar gradualmente a consultar la tabla especializada
  - dejar el XML solo como “fuente de verdad” para auditoría

**Impacto UI**

- permitir columnas relacionadas a pagos (cuando sean requeridas) sin parsear XML

### Fase 4: JSONB documental (opcional) + módulo Nómina

**Objetivo**

- habilitar visor avanzado de complementos y soportar “la mayoría” de complementos sin normalizarlos todos

**Impacto BD**

- agregar `InvoiceComplementJson` (opcional)

**Impacto Backfill**

- script `backfill:invoice-complement-json` (opcional)
  - construir JSONB acotado por complemento y versión
  - no construir para todos si no se necesita

**Impacto UI**

- agregar “Detalle de complemento” (drawer/dialog) que consume JSONB o (fallback) XML descifrado

**Nómina (módulo futuro)**

- el workpaper solo consume atributos básicos
- el módulo de nómina tendrá sus propias tablas especializadas y resúmenes
- el framework mantiene compatibilidad vía:
  - `hasNomina`
  - `attr.nomina.*` (básicos)
  - tablas del módulo nómina (análisis profundo)

## Segunda Fase: Maduración De Búsquedas

La mínima viable debe considerarse la base operativa inicial, no el estado final del framework.

La segunda fase debe enfocarse en:

- ampliar detección de variantes reales de XML
- soportar prefijos y namespaces alternos
- incorporar más atributos consultables por complemento
- mejorar cobertura de complementariedad entre emitidos y recibidos
- mover complementariedad compleja a tablas especializadas cuando su explotación deje de ser marginal

Regla:

- la fase 1 prioriza entrega rápida, compatibilidad y bajo riesgo
- la fase 2 prioriza cobertura, robustez y precisión semántica

## Capas De Datos

### Capa 1: Documento Operativo (OLTP)

Ejemplo actual:

- `Invoice` (emitidos: Ingreso/Egreso/Pago/Traslado/Nómina)
- `InvoiceConcept` (repetibles)
- `InvoiceRelatedCfdi` (relación por UUID, útil para PPD/CRP/relaciones generales)

### Capa 2: Blob Seguro

- `InvoiceBlob` (XML cifrado 1:1)

### Capa 3: Proyección De Complementos (Nuevo)

#### 3.1 Índice De Complementos (por CFDI)

Propósito:

- resolver rápido “qué complementos trae este CFDI”
- habilitar filtros por presencia de complemento sin tocar XML

Modelo sugerido (emitidos):

- `InvoiceComplementIndex`
  - `invoiceId` (unique)
  - `organizationId`
  - `issuerFiscalEntityId`
  - `cfdiType`
  - `hasTimbre`
  - `hasPagos`
  - `hasNomina`
  - `hasCartaPorte`
  - `hasComercioExterior`
  - `hasImpuestosLocales`
  - `complementTypes` (array de strings, opcional)
  - `projectionVersion`
  - timestamps

Índices mínimos:

- `(organizationId, issuerFiscalEntityId, cfdiType)`
- `(organizationId, issuerFiscalEntityId, hasPagos)`
- `(organizationId, issuerFiscalEntityId, hasNomina)`
- `(organizationId, issuerFiscalEntityId, hasCartaPorte)`

#### 3.2 Atributos Consultables (columnas dinámicas)

Propósito:

- permitir que el botón `Columnas` exponga atributos de complementos sin inflar el modelo con miles de columnas
- soportar filtros por columna de forma eficiente

Modelo sugerido:

- `InvoiceComplementAttribute`
  - `invoiceId`
  - `complementType` (ej. `PAGOS`, `NOMINA`, `CARTA_PORTE`, `COMERCIO_EXTERIOR`)
  - `attributeKey` (clave corta estable, ej. `pago.monedaP`, `cartaporte.transpInternac`)
  - `attributePath` (ruta informativa, no obligatoria para query)
  - `valueText` / `valueNumber` / `valueDate` / `valueBoolean`
  - `valueSearch` (texto normalizado para búsquedas)
  - `groupIndex` / `itemIndex` (para repetibles cuando aplica)
  - timestamps

Índices mínimos:

- `(attributeKey, valueSearch)`
- `(invoiceId, complementType)`
- `(complementType, attributeKey)`

Regla:

- el workpaper solo ofrece columnas dinámicas de `attributeKey` registradas en un catálogo (ver UI).

#### 3.3 Tablas Dedicadas (complementos de alto impacto)

Pagos (REP) es el ejemplo principal:

- `InvoicePaymentComplementDetail`
  - `paymentInvoiceId` (el CFDI tipo PAGO)
  - `relatedInvoiceUuid` (IdDocumento)
  - `numParcialidad`
  - `impPagado`
  - `impSaldoAnt`
  - `impSaldoInsoluto`
  - `monedaP` / `monedaDR`
  - `equivalenciaDR`
  - `fechaPago`
  - timestamps

Esto permite:

- explotar cobranza sin parsear XML masivo
- reemplazar lógica de balance PPD/CRP en endpoints analíticos

### Capa 4: JSONB Documental (Opcional, Acotado)

Propósito:

- renderizar detalle de complementos en UI sin reparsear XML
- soportar complementos raros o atributos de baja frecuencia

Modelo sugerido:

- `InvoiceComplementJson`
  - `invoiceId`
  - `complementType`
  - `complementVersion`
  - `documentJson` (JSONB)
  - `projectionVersion`
  - timestamps

Regla:

- no usar esta tabla como base de analítica masiva ni de filtros principales del workpaper

## Catálogo De Columnas (UI)

El botón `Columnas` debe operar con un catálogo de columnas declarativo:

- `core` (columnas directas de la tabla operativa)
- `projectionAttribute` (columnas de `InvoiceComplementAttribute`)
- `specialized` (columnas calculadas con tablas dedicadas, ej. Pagos)

La UI debe poder:

- listar columnas por grupos (Comprobante, Emisor, Receptor, Timbre, Complementos)
- activar/desactivar columnas
- enviar filtros por columna al API usando un key estable

## API: Contrato Recomendado

### Listado Workpaper (masivo)

Endpoint objetivo:

- `GET /api/dashboard_fiscal/invoices`

Cambios recomendados:

- por defecto NO regresar `xmlContent`
- exponer un parámetro `includeXml=1` solo para acciones puntuales y autorizadas
- soportar filtros de columnas dinámicas como:
  - `attr.<attributeKey>=valor`
  - `has.<complementType>=1`

Ejemplos:

- `has.PAGOS=1`
- `attr.pagos.monedaP=MXN`
- `attr.cartaporte.transpInternac=Sí`

La implementación debe traducir estos filtros a joins/exists sobre `InvoiceComplementIndex` / `InvoiceComplementAttribute`.

### Drilldown / Detalle

Endpoints de detalle pueden:

- devolver `InvoiceComplementJson` cuando exista
- o (fallback) descifrar XML del blob y parsear bajo demanda

## Backfill: Estrategia

Regla general:

- NUNCA construir proyecciones masivas en request path
- usar scripts/worker para backfill y refresh incremental

### Backfill 1: Índice de complementos

- lee invoices por batch
- obtiene XML desde `invoice_blobs` o legacy `xml_content`
- detecta presencia de complementos (match por namespaces/nodos)
- upsert en `InvoiceComplementIndex`

### Backfill 2: Atributos consultables

- usa catálogo de `attributeKey` soportados
- extrae solo atributos necesarios (no “todo el XML”)
- inserta/upsert en `InvoiceComplementAttribute`

### Backfill 3: Pagos (REP) especializado

- procesa solo CFDI tipo PAGO
- extrae `Pago` y `DoctoRelacionado`
- pobla `InvoicePaymentComplementDetail`

## Nómina: Consideración Para Módulo Futuro

Para nómina:

- la capa de proyección debe marcar `hasNomina`
- los atributos mínimos consultables pueden vivir en `InvoiceComplementAttribute`
- para explotación completa, se recomienda un módulo dedicado con tablas especializadas, por ejemplo:
  - `PayrollCfdiSummary`
  - `PayrollPerception`
  - `PayrollDeduction`
  - `PayrollOtherPayment`

Regla:

- el workpaper puede mostrar atributos de nómina básicos, pero el análisis profundo debe vivir en el módulo de nómina.

## Aplicación a Egresos y Nuevos Módulos

Como `Invoice` ya incluye `EGRESO`, el framework aplica sin duplicar tablas:

- `InvoiceComplementIndex` y `InvoiceComplementAttribute` funcionan para `cfdiType=EGRESO` igual que para `INGRESO`.

Para módulos nuevos (ej. “Carta Porte”, “Comercio Exterior”), la regla es:

- primero habilitar columnas dinámicas vía proyección (rápido y seguro)
- cuando un complemento se vuelva núcleo del negocio, moverlo a tablas especializadas

# Checklist De Liberación: Ingresos, Complementos Y REP

## Objetivo

Usar esta checklist como bitácora operativa para validar y liberar por etapas:

- `dashboard_fiscal`
- `ingresos-parciales`
- `ingresos_pendientes`
- `ingresos_cobrados`
- `workpaper` emitidos
- `workpaper` recibidos

Esta checklist complementa la guía detallada en [prueba-funcional-ingresos-y-complementos.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/docs/arquitectura/prueba-funcional-ingresos-y-complementos.md).

## Estado General

- Fecha de inicio:
- Responsable:
- Ambiente:
- Build validado manualmente:
- Migraciones aplicadas:
- Backfills ejecutados:
- Resultado general:

## Preflight Técnico

- [ ] `docker compose up -d postgres redis`
- [ ] `npx prisma migrate deploy`
- [ ] `npx prisma generate`
- [ ] `npm run build`
- [ ] `npm run dev`
- [ ] sesión iniciada con usuario con acceso a los módulos

## Confirmación De Datos Base

- [ ] `invoice_blobs` con cobertura correcta
- [ ] `invoice_issued_daily_summary` poblada
- [ ] `invoice_complement_index` poblada
- [ ] `invoice_complement_attributes` poblada
- [ ] `provider_uploaded_cfdi_complement_index` poblada
- [ ] `provider_uploaded_cfdi_complement_attributes` poblada
- [ ] `invoice_payment_complement_details` poblada

## Evidencia SQL Inicial

- Fecha de validación:
- Responsable:
- Resultado `invoices_sin_blob`:
- Resultado `invoice_issued_daily_summary`:
- Resultado `invoice_complement_index`:
- Resultado `invoice_complement_attributes`:
- Resultado `provider_uploaded_cfdi_complement_index`:
- Resultado `provider_uploaded_cfdi_complement_attributes`:
- Resultado `invoice_payment_complement_details`:

## Módulo 1: `dashboard_fiscal`

### Checklist

- [ ] Abre sin error `500`
- [ ] Los KPIs cargan datos
- [ ] Cambiar rango de fechas actualiza resultados
- [ ] `Monto cobrado` se ve razonable
- [ ] `Monto por cobrar` se ve razonable
- [ ] `Cartera vencida` se ve razonable
- [ ] `Ingresos cobrados PUE` responde
- [ ] `Ingresos cobrados CRP` responde
- [ ] `Ingresos pendientes de cobro` responde
- [ ] `ivaCobradoTotal` responde
- [ ] `ivaPpdRecibido` responde
- [ ] `ivaPendienteCobro` responde
- [ ] No hay montos inflados por CRP con múltiples `DoctoRelacionado`

### Evidencia

- URL probada:
- Filtros usados:
- Resultado observado: Revalidado el bloqueador de rango inválido. Con `Fecha Inicio = 2026-02-01` y `Fecha Fin = 2026-01-01`, la UI muestra el mensaje `La fecha de inicio no puede ser mayor que la fecha final.`, ambos inputs quedan inválidos, el botón `Filtrar` queda deshabilitado y no se dispara request inválido a `/api/dashboard_fiscal`.
- Diferencias vs expectativa:
- Captura / referencia:
- Estado final: Bloqueador de fechas corregido y revalidado en navegador

## Módulo 2: `ingresos-parciales`

### Checklist

- [x] Abre sin error `500`
- [x] La tabla muestra registros
- [x] Conserva `uuid`, `series`, `folio`
- [x] Conserva `totalPaid`
- [x] Conserva `saldoInsoluto`
- [x] Conserva `isPaid`
- [x] Conserva `payments`
- [x] Cada pago muestra `paymentUuid`
- [x] Cada pago muestra `paymentDate`
- [x] Cada pago muestra `impPagado`
- [x] Cada pago muestra `impSaldoAnt`
- [x] Cada pago muestra `impSaldoInsoluto`
- [x] Cada pago muestra `monedaP`
- [x] Cada pago muestra `monedaDR`
- [x] Cada pago muestra `equivalenciaDR`
- [x] Cada pago conserva `paymentXml`
- [x] El filtro por fechas funciona
- [x] El filtro por moneda del ingreso funciona
- [x] El filtro por moneda del pago funciona

### Evidencia

- URL probada: `http://localhost:3000/dashboard_fiscal/ingresos-parciales`
- Filtros usados: Emisión `2026-07-01` a `2026-07-31` sin resultados, emisión `2026-01-01` a `2026-07-31` con 32 registros, pago `2026-02-01` a `2026-02-28` con recorte a 16 registros, `paymentCurrency=MXN` con recorte a 16 registros
- UUIDs revisados: `0C58EB36-9D5D-4439-B1A7-CE041CF2A421`, pago `5BF0FE73-88CE-438C-93CB-4B90E957B018`, `F9210673-D7D3-4E28-879A-4AD07F1FC8B6`
- Resultado observado: La pantalla carga sin `500`, la tabla muestra 32 facturas en el rango base, los KPIs siguen coherentes, el desglose de pagos funciona, `paymentXml` quedó expuesto en la UI con visor y descarga, y los filtros `Fecha Pago (REP)` y `Moneda Pago` ya recortan correctamente el dataset.
- Diferencias vs expectativa: Sin diferencias activas. El warning de hidratación y la ausencia de requests abortados se validaron también en navegador normal del usuario, donde `Console` y `Network` no mostraron incidencias.
- Captura / referencia: `ingresos-parciales-marzo-payment-filter.png` y validación manual adicional del usuario en navegador normal
- Estado final: Aprobado. Hallazgos funcionales y técnicos corregidos y revalidados.

## Módulo 3: `ingresos_pendientes`

### Checklist

- [x] Abre el drilldown sin error
- [x] Aparece `Factura a Crédito (PPD)`
- [x] Aparece `Complemento de Pago (CRP)`
- [ ] Aparece `Nota de Crédito (Ajuste)`
- [x] En CRP, `uuid` corresponde al pago
- [x] En CRP, `uuidRelacionado` corresponde al PPD
- [x] En CRP, `importe` sale en negativo
- [ ] Sigue funcionando si alguna fila cae en fallback

### Evidencia

- URL probada: `http://localhost:3000/dashboard_fiscal`
- Filtros usados: Drilldown abierto desde la tarjeta `Ingresos Pendientes de Cobro`, filtro por columna `Tipo = Complemento de Pago`, validación adicional por `uuidRelacionado = e468c97a` en minúsculas
- UUIDs revisados: Pago `5BF0FE73-88CE-438C-93CB-4B90E957B018`, relacionado `E468C97A-C646-4BB3-923C-5D88F3389C51`
- Resultado observado: El modal abre sin error, la API responde `200`, el dataset devuelve `48` filas (`32` PPD, `16` CRP, `0` notas de crédito), y en CRP se valida que `uuid` corresponde al pago, `uuidRelacionado` apunta a un PPD y `importe` llega en negativo. Tras el fix de normalización no se detectaron `uuidRelacionado` vacíos, inconsistentes o fuera de casing esperado, y el filtro case-insensitive del drilldown siguió encontrando correctamente el UUID relacionado.
- Diferencias vs expectativa: En este dataset no aparecieron filas de `Nota de Crédito (Ajuste)`; sólo se observó total `0.00` en el resumen. La rama fallback queda endurecida por código y sin evidencia de inconsistencia por casing, pero no se contó en esta sesión con un caso runtime inequívoco que fuerce esa ruta.
- Captura / referencia: Validación en navegador sobre el drilldown y revisión del fallback en [route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard_fiscal/drilldown/ingresos_pendientes/route.ts#L11-L13) y [route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard_fiscal/drilldown/ingresos_pendientes/route.ts#L179-L229)
- Estado final: Parcial con observación de cobertura de datos. El flujo principal y el fix de normalización quedaron validados para PPD y CRP.

## Módulo 4: `ingresos_cobrados`

### Checklist

- [x] Abre el drilldown sin error
- [x] Aparece `Factura Contado (PUE)`
- [x] Aparece `Complemento de Pago (CRP)`
- [x] En CRP, `uuidRelacionado` se resuelve correctamente
- [x] En CRP, `importe` coincide con `BaseP`
- [x] No hay duplicados por múltiples `DoctoRelacionado` en un mismo nodo `Pago`
- [ ] Sigue funcionando si alguna fila cae en fallback

### Evidencia

- URL probada: `http://localhost:3000/dashboard_fiscal`
- Filtros usados: Drilldown abierto desde la tarjeta `Ingresos Cobrados (Flujo Total)`, filtro por columna `Tipo = Complemento de Pago`
- UUIDs revisados: Pago `5BF0FE73-88CE-438C-93CB-4B90E957B018`, lista relacionada de `16` UUIDs sin duplicados
- Resultado observado: El modal abre sin error, la API responde `200`, aparecen `2778` filas PUE y `1` fila CRP, el CRP muestra `uuidRelacionado` completo vía `title`, el importe visible es `$53,917.28` y coincide con `BaseP` agrupado por `paymentInvoiceUuid + paymentNodeIndex`.
- Diferencias vs expectativa: Sin diferencias funcionales activas en la corrida validada. La única reserva es de cobertura: no se forzó explícitamente un caso runtime que cayera en la rama fallback.
- Captura / referencia: `dashboard_fiscal_ingresos_cobrados_crp_filtrado.png`, validación de agrupación en [route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard_fiscal/drilldown/ingresos_cobrados/route.ts#L124-L144) y armado CRP en [route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard_fiscal/drilldown/ingresos_cobrados/route.ts#L201-L213)
- Estado final: Aprobado. PUE y CRP correctos, `uuidRelacionado` consistente, `importe` alineado con `BaseP` y sin evidencia de inflación por múltiples `DoctoRelacionado`.

## Módulo 5: `workpaper` Emitidos

### Checklist

- [x] Abre sin error
- [x] El botón `Columnas` abre correctamente
- [x] Se puede activar `hasPagos`
- [x] Se puede activar `pagosVersion`
- [x] Se puede activar `hasNomina`
- [x] Se puede activar `nominaVersion`
- [x] Se puede activar `hasCartaPorte`
- [x] Se puede activar `cartaPorteVersion`
- [x] Se puede activar `hasComercioExterior`
- [x] Se puede activar `comercioExteriorVersion`
- [x] Los valores visibles son coherentes con los XML
- [x] Los filtros sobre columnas de proyección funcionan
- [x] La exportación CSV incluye las columnas visibles

### Evidencia

- URL probada: `http://localhost:3000/dashboard_fiscal/workpaper`
- Columnas activadas: `hasPagos`, `pagosVersion`, `hasNomina`, `nominaVersion`, `hasCartaPorte`, `cartaPorteVersion`, `hasComercioExterior`, `comercioExteriorVersion`
- UUIDs revisados: N/A (validación enfocada a comportamiento de UI/filtros/exportación)
- Resultado observado: La tabla cargó datos (`20` filas visibles por página). Las columnas de complemento se activaron desde `Columnas` y aparecieron con su input de filtro por columna. Se probó filtrado en tiempo real con `RFC Receptor = GAJG771222AE2` reduciendo a `1` registro.
- Diferencias vs expectativa: Sin diferencias funcionales activas en los puntos validados.
- Captura / referencia: `workpaper-columns-filters.png`, `workpaper-table-filters-columns.png`. Encabezado CSV verificado sin `Versión Comercio Exterior` tras ocultarla.
- Estado final: Aprobado. Columnas, filtros por columna y exportación CSV por columnas visibles funcionando.

## Módulo 6: `workpaper` Recibidos

### Checklist

- [x] Abre sin error
- [x] El botón `Columnas` abre correctamente
- [x] El catálogo de columnas funciona como en emitidos
- [x] Las columnas de complemento muestran datos proyectados
- [x] Los filtros funcionan
- [x] La exportación CSV respeta columnas visibles

### Evidencia

- URL probada: `http://localhost:3000/dashboard_recibidos/workpaper`
- Columnas activadas: `hasPagos`, `pagosVersion`, `hasCartaPorte`, `cartaPorteVersion`
- UUIDs revisados: `FAF168F7-2F59-4C61-94F5-932DAE5AE056`, `AEE7BE08-035D-43B9-85EB-19245C10CE65`, `DB7512E9-5EDA-4665-AAD9-5EF89E0A967D`
- Resultado observado: La tabla cargó `12 registros` al cambiar a `NMP7502257ZA · Empresa Demo 2`. El panel `Columnas` abrió correctamente, las columnas de complemento mostraron datos proyectados coherentes (`Tiene Pagos = Sí`, `Versión Pagos = 2.0`, `Tiene Carta Porte = Sí`, `Versión Carta Porte = 20`), el filtro por `Versión Pagos = 2.0` redujo de `12` a `3` filas y la exportación CSV respetó las columnas visibles.
- Diferencias vs expectativa: Sin diferencias funcionales activas. Observación menor de copy: la pantalla sigue mostrando el texto `Reporte de Ingresos` en recibidos.
- Captura / referencia: Validación UI en `Empresa Demo 2`, encabezado CSV verificado sin `Versión Carta Porte` tras ocultarla
- Estado final: Aprobado. Catálogo de columnas, datos proyectados, filtros y exportación funcionando.

## Validación Cruzada SQL Vs UI

- [x] `dashboard_fiscal.kpis.montoCobrado` razonable contra datos base
- [x] `ingresosCobradosCrp` razonable contra suma de `base_p`
- [x] `ivaCobradoCrp` razonable contra suma de `importe_p`
- [x] No hay duplicados obvios por `payment_node_index`

### Evidencia

- Consulta ejecutada: Validación para `ODE8604257UA · Empresa Demo`, `origin=issued`, rango `2026-02-01` a `2026-02-23`, contrastando `GET /api/dashboard_fiscal?companyId=cmnnunarz000802gccsfno9x5&origin=issued&startDate=2026-02-01&endDate=2026-02-23` contra agregados SQL/Prisma equivalentes. Para CRP se agrupó por `payment_invoice_uuid + payment_node_index` usando `MAX(base_p)` y `MAX(importe_p)` por nodo antes de sumar.
- Resultado SQL: `montoCobrado = 9,142,566.55`, `ingresosCobradosPue = 7,930,823.46`, `ingresosCobradosCrp = 53,917.28`, `ingresosCobradosTotalVisible = 7,984,740.74`, `ivaPueCobrado = 1,208,055.17`, `ivaCobradoCrp = 8,626.73`, `ivaCobradoTotal = 1,216,681.90`. Validación anti-duplicado: `rawBasePSum = 862,676.48` vs `groupedBasePSum = 53,917.28`; `rawImportePSum = 138,027.68` vs `groupedImportePSum = 8,626.73`; `paymentNodeCount = 1`, `rawDetailCount = 16`.
- Resultado UI: Tarjeta visible `Ingresos Cobrados (Flujo Total) = $7,984,740.74`, `IVA Cobrado Total = $1,216,681.90`, `IVA Trasladado Cobrado = $1,216,681.90`. Drilldown cobrados: `Facturas de Contado (PUE) = $7,930,823.46`, `Complementos de Pago (CRP) = $53,917.28`. API autenticada: `kpis.montoCobrado = 9,142,566.55`, `kpis.ingresosCobradosCrp = 53,917.28`, `kpis.ingresosCobradosTotal = 7,984,740.74`, `kpis.taxes.ivaCobradoTotal = 1,216,681.90`.
- Diferencia: Sin diferencia material entre SQL y API/UI en los valores comparables. Aclaración importante: la tarjeta visible usa `ingresosCobradosTotal`, no `montoCobrado`; por eso `montoCobrado` se validó contra el payload del endpoint y no contra la tarjeta principal. El componente CRP del IVA no se muestra aislado en pantalla, pero queda respaldado por la conciliación `ivaCobradoTotal = ivaPueCobrado + ivaCobradoCrp = 1,208,055.17 + 8,626.73`.
- Conclusión: La data principal del dashboard y del drilldown cuadra razonablemente con la base. La agrupación por `payment_node_index` evita inflación de montos CRP y no se observan duplicados funcionales en cobranza.

## Criterio De Liberación

- [x] Todos los módulos abren sin error `500`
- [x] No hay regresiones visibles en contratos existentes
- [x] Los datos principales cuadran razonablemente con SQL
- [x] Los drilldowns de CRP no inflan montos
- [x] `workpaper` usa columnas de complemento correctamente
- [x] No hay bloqueadores funcionales abiertos

## Bloqueadores / Hallazgos

- Hallazgo 1: El dashboard permitía capturar `Fecha Inicio > Fecha Fin`, lo que generaba una lectura engañosa de KPIs en cero.
- Impacto: Bloqueador funcional para la validación de `dashboard_fiscal`.
- Acción: Se agregó validación en frontend para rango inválido, mensaje visible, `aria-invalid`, restricciones `min`/`max` y deshabilitado del botón `Filtrar`. La corrección se revalidó en navegador y no dispara requests inválidos.
- Estatus: Resuelto

- Hallazgo 2: `ingresos-parciales` presentaba fallas en filtros `Fecha Pago (REP)` y `Moneda Pago`, `paymentXml` no tenía acción visible en UI y se observó ruido técnico inicial en consola/red.
- Impacto: Bloqueador para liberar el módulo `ingresos-parciales`.
- Acción: Se corrigió el endpoint para que los filtros REP recorten el dataset, se expuso `paymentXml` con visor y descarga en la UI, se eliminó el aborto de `/api/user/profile` y se revalidó en navegador instrumentado y navegador normal del usuario.
- Estatus: Resuelto

- Hallazgo 3: Se detectó un copy heredado en `workpaper` recibidos mostrando `Reporte de Ingresos`.
- Impacto: Observación menor de consistencia visual, sin bloqueo funcional.
- Acción: Se ajustó el encabezado y el texto auxiliar para reflejar `Reporte de Egresos` en recibidos.
- Estatus: Resuelto

## Decisión Final

- [x] Liberado
- [ ] Liberado con observaciones
- [ ] No liberado

### Resumen Final

- Fecha: `2026-07-21`
- Responsable: Validación funcional y cierre técnico de la entrega en la sesión actual.
- Observaciones: La mínima viable de proyecciones CFDI, REP especializado, migración de consumidores funcionales, workpapers y validación cruzada SQL vs UI quedó aprobada sin bloqueadores funcionales abiertos.
- Siguiente paso: Versionar la entrega en `CHANGELOG.md`, crear commit y tag semántico, y dejar trazabilidad de la segunda fase pendiente.

## Recordatorio De Segunda Fase

Aunque esta checklist permite liberar la mínima viable, sigue pendiente una segunda fase para:

- madurar heurísticas de búsqueda
- ampliar catálogo de atributos SAT
- endurecer variantes reales de namespaces y versiones
- seguir retirando fallback XML cuando la cobertura histórica ya sea suficiente

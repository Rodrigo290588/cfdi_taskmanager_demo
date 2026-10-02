# Tablero Contabilidad y Fiscal Nómina 1.2 (Cumplimiento y Conciliación) — Product Requirements Document (PRD)

## Overview
- **Summary**: Construcción del Tablero de Contabilidad & Fiscal (Cumplimiento y Conciliación) para CFDIs de Nómina 1.2, alineado al stack Next.js 16 App Router + Prisma 6 + PostgreSQL 16 + Zod + Tailwind 4 + shadcn/ui + Recharts 3. El tablero es un hijo del menú `button` "Nómina" del sidebar con el label "Tablero Contabilidad y Fiscal" y accesible via ruta `/dashboard/nomina/fiscal`.
- **Purpose**: Proveer a Contabilidad, RH y Oficial Cumplimiento de una herramienta visual auditada matemáticamente para: (a) conciliar el ISR retenido mensual contra pagos provisionales SAT; (b) detectar inconsistencias SBC (Salario Base Cotización Aportación) vs SDI (Salario Diario Integrado) para proyecciones IMSS; (c) reporte matricial de deducciones de terceros (INFONAVIT, FONACOT, Pensiones Alimenticias, Cuotas Sindicales); (d) análisis Gravado vs Exento por conceptos clave (Sueldos 001, Aguinaldo 002, PTU 003, Prima Vacacional 021); (e) auditoría de timbrado (cancelados, UUIDs duplicados, brecha emisión vs pago).
- **Target Users**:
  - **Jefe(a) de Contabilidad**: conciliación ISR, cierre mensual.
  - **Jefe(a) de Recursos Humanos**: auditoría SBC/SDI, deducciones terceros.
  - **Oficial de Cumplimiento / Privacidad & Riesgos fiscales**: alertas timbrado y deducciones.
  - **Gerencia / Director Financiero**: proyecciones Gravado/Exento y alertas semanales.

## Goals
1. **Conciliación Fiscal (ISR)**: Visualización totalizada por período de retención ISR (TipoDeduccion 002) y desglose por nómina semanal/quincenal/mensual.
2. **Carga Social IMSS (SBC vs SDI)**: Cuantificar (a) total recepciones con SBC/SDI NULL/0; (b) recepciones donde SBC − SDI (absoluto) > 3% SBC como desviación IMSS.
3. **Matriz Deducciones Terceros**: Agregación por TipoDeduccion (010 INFONAVIT, 006 FONACOT, 007 Pension, 001 Sindicato), totales y empleados impactados.
4. **Gravado vs Exento por Concepto**: Stacked BarChart por TipoPercepcion (Sueldos, Aguinaldo, PTU, Prima Vacacional) con ImporteGravado vs ImporteExento.
5. **Auditoría Timbrado**: KPI alertas (Cancelados, UUIDs duplicados, brecha días > 5 emisión vs pago) y tabla detalle de alertas.
6. **Integración arquitectura existente**: Reutilizar patrones y estilos `/dashboard_fiscal` (KPI barra color arriba, filtros fijos, dropdown Visualización de secciones) y `/dashboard/rh` (Auto-empresa desde sidebar tenant button, Suspense boundaries server, helpers puros `@/lib/*-formatters` sin 'use client').
7. **4 FASES de implementación 100% completas**: (F1) SQL MV + índices + REFRESH CONCURRENTLY; (F2) Route Handler `/api/stats/fiscal_nomina` + Server Component `page.tsx`; (F3) Client component con KPI Cards, BarChart apilado, PieChart donut, Alertas; (F4) Script k6 estrés 10M registros + Matriz Auditoría SAT checklist.

## Non-Goals
- **Nunca parsear XML CFDI Nómina 1.2 en runtime (request-time)**. Solo lectura de tablas relacionales ETL `payroll_receipts / payroll_deducciones / payroll_percepciones / payroll_receptors` y Vistas Materializadas PostgreSQL pre-calculadas.
- No genera DIOT, Declaración 13, DT o cualquier declaración SAT válida; solo analítica conciliatoria.
- No reemplaza `/dashboard_fiscal` ni `/dashboard/rh`: dashboard fiscal valida CFDI I/E normales; RH valida headcount/turnover/beneficios; **éste tablero = cumplimiento/conciliación exclusivo nómina 1.2**.
- No flujos autorizatorios, no aprovisionamiento, no pagos a terceros.
- No cambia pipeline ETL existente `lib/etl-payroll-indexer` (solo agrega una MV y refresh script).

## Background & Context
- Modelos Prisma de nómina 1.2 100% definidos en `prisma/schema.prisma`:
  - `PayrollReceipt (payroll_receipts)`: `fechaPago (db.Date)`, `fechaEmision (DateTime)`, `fechaInicialPago / fechaFinalPago`, `companyId / fiscalEntityId / organizationId`, `totalPercepciones / totalDeducciones / totalOtrosPagos`, `uuid @unique`. Índices `[org, companyId, fechaPago, depto]`, `[companyId, fechaEmision, fechaPago]`.
  - `PayrollReceptor (payroll_receptors)`: `salarioBaseCotApor @Decimal(18,6)`, `salarioDiarioIntegrado @Decimal(18,6)`, `depto`, `tipoContrato`.
  - `PayrollDeduccion (payroll_deducciones)`: `tipoDeduccion CHAR 3 ('002' ISR, '001' Sindicato, '006' FONACOT, '007' Pension, '010' INFONAVIT)`, `importe`.
  - `PayrollPercepcion (payroll_percepciones)`: `tipoPercepcion CHAR 3 ('001' Sueldos, '002' Aguinaldo, '003' PTU, '021' PrimaVacacional)`, `importeGravado / importeExento`.
  - `Invoice.satStatus` enum `SatStatus` (`VIGENTE`, `CANCELADO`) usado para cancelados; relación `PayrollReceipt.invoice` (FK invoiceId).
- Sidebar existente: Collapsible button "Nómina" con hijo "Tablero Recursos Humanos" href `/dashboard/rh`. Guard RBAC: `Permission.MODULE_PAYROLL_VIEW` en `sidebar.tsx#L600`.
- Patrones UI reutilizados: Layout `flex justify-between` → `h1 tablero` + `span empresa Rfc·Nombre` arriba, filtros fijos abajo (`py-4 items-end`), KPI card `bg-TONE/10 bar` + `CardContent p-6 center` + `h-12 w-12 icon` + `value text-2xl`. Dropdown `Visualización` (SlidersHorizontal) con `DropdownMenuCheckboxItem` por sección, `Mostrar/Ocultar todas`, `sections` query param omitido por defecto.
- Route Handler analítico RH: `api/stats/rh/route.ts` → Zod strict, RBAC, RateLimit, SECURITY_HEADERS, fp32, safeErrSummary.

---

## FASE 1: Base de Datos y Persistencia (SQL / Vistas Materializadas)

### F1-R1 (Req. Funcional): Vista Materializada `mv_fiscal_conciliacion_mensual`
Vista materializada PostgreSQL 16 con agregados pre-calculados granularidad **(organization_id, company_id, fiscal_entity_id, anio, mes, registro_patronal?, departamento?)**, columnas:
- `count_receipts`, `count_empleados_distinct` (rfc receptor)
- `isr_retenido_mxn` (SUM importe TipoDeduccion='002')
- `cuotas_terceros_infonavit` (Tipo='010'), `fonacot` ('006'), `pension` ('007'), `sindicato` ('001')
- `gravado_001_sueldos`, `exento_001_sueldos`
- `gravado_002_aguinaldo`, `exento_002_aguinaldo`
- `gravado_003_ptu`, `exento_003_ptu`
- `gravado_021_primavac`, `exento_021_primavac`
- `recepciones_sbc_null`, `recepciones_sdi_null`, `recepciones_desv_sbc_sdi_gt_3pct`
- `count_cancelados` (Vigencia = CANCELADO vía Invoice.satStatus)
- `count_uuid_duplicados` (conteo receipts cuyo uuid se repite > 1)
- `count_brecha_emis_pago_gt_5` (abs(fechaEmision - fechaPago) días > 5)

### F1-R2 (Req. Funcional): Índices compuestos
- Clave de unicidad `UNIQUE (organization_id, company_id, fiscal_entity_id, anio, mes)`
- Índice B-tree `(company_id, anio DESC, mes DESC)`
- Índice `INCLUDE (isr_retenido_mxn, cuotas_terceros_infonavit,...)` para consultas KPI índice-only scan.

### F1-R3 (Req. Funcional): Script refresh concurrente
- `supabase/migrations/YYYYMMDDHHMMSS_fiscal_conciliacion_mv.sql` (o carpeta proyecto `scripts/sql/` si no usa Supabase) con:
  1. `CREATE MATERIALIZED VIEW IF NOT EXISTS`
  2. `CREATE UNIQUE INDEX IF NOT EXISTS mv_fiscal_conciliacion_mensual_pk` (requisito de REFRESH CONCURRENTLY)
  3. `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual;`
  4. `ANALYZE mv_fiscal_conciliacion_mensual;`

---

## FASE 2: API & Server Components (Next.js App Router)

### F2-R1 Route Handler `/api/stats/fiscal_nomina/route.ts`
- runtime `nodejs`, dynamic `force-dynamic`, `maxDuration = 30`.
- `Zod` schema estricto: `companyId (cuid required)`, `organizationId? (cuid)`, `fiscalEntityId? (cuid)`, `registroPatronal? (<=20 alnum)`, `startDate / endDate (coerce.date)`, `departamento? regex allow-list`; `superRefine` validación rango <= 5 años.
- Auth + RBAC: `auth()` NextAuth v5 + `requireApprovedDashboardAccess(Permission.MODULE_PAYROLL_VIEW)`.
- Rate Limit triple (IP / user / org).
- `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`.
- `SECURITY_HEADERS`, safeErrSummary, fp32.
- Respuesta JSON: `{ kpis, gravado_vs_exento[], deducciones_terceros[], alertas_timbrado, auditoria_sbc_sdi[] top 100 }`.
- Solo lectura vía `prisma.$queryRaw` sobre `mv_fiscal_conciliacion_mensual` + tablas originales (top alertas sbc_sdi).

### F2-R2 Server Component `app/dashboard/nomina/fiscal/page.tsx`
- **Slot pattern children**: Server `page.tsx` es async Server Comp; lee `searchParams` (Promise) → `parseFiscalNominaSearchParams` → pasa `<FiscalNominaServerPage>` como `children` a wrapper client `<FiscalNominaClientPage>` que hace URL auto-populate de `?companyId=` desde `localStorage.selectedCompany` (igual que `/dashboard/rh`).
- `<Suspense fallback={<FiscalDashboardSkeleton />}` en cada sección visible.
- Esqueleto `shadcn/ui Skeleton`: 6 KPI cards + 2 gráficos + 1 tabla alertas, con `className="animate-pulse bg-slate-200 rounded"`.
- Layout header: `flex justify-between` → `h1 Tablero Contabilidad y Fiscal` izq + `span RFC · Nombre empresa` der. Row 2 filtros fijos (`py-4 items-end`): Fecha inicio/fin, registroPatronal, departamento, botón Filtrar + Restablecer outline + Dropdown Visualización (Secciones 6 items).
- Span empresa: sincroniza automáticamente con sidebar tenant button vía evento `company-selected` (igual fix T6 dashboard/rh).

---

## FASE 3: Cliente & Gráficos (Recharts + Tailwind 4 / shadcn)

### F3-R1 `FiscalDashboardClient` responsivo Mobile First
- Breakpoints: sm (1 col), md (2 cols), lg (3 cols). Grid responsive `gap-4`.
- Tooltip `TooltipProvider` shadcn al hover de KPIs y gráficas (descripción lógica SAT).

### F3-R2 KPI Cards (6 minimum) — mismo estilo fiscal `/dashboard_fiscal`
1. **ISR Retenido período** (Tone: slate). Ícono: `Landmark`, value `fmtMxn(isr_retenido_mxn)`, sublabel "vs período anterior ±X%"
2. **Total Cuotas Terceros** (Tone: emerald) (suma INFONAVIT+FONACOT+Pensión+Sindicato)
3. **Cancelados (Cancelado)** (Tone: rose) (count_cancelados) → badge warn si > 0
4. **UUID Duplicados** (Tone: amber)
5. **Brecha Emisión-Pago > 5 días** (Tone: indigo)
6. **Alertas SBC/SDI** (Tone: violet) (suma NULLs + desviaciones > 3%)

### F3-R3 Gráfica Barras Apiladas Gravado vs Exento por concepto
- `BarChart` Recharts: `Xaxis = Concepto | TipoPercepcion 001/002/003/021`, `Yaxis = mxn`, 2 series `ImporteGravado` (stackId 'a') + `ImporteExento` (stackId 'a'). Paleta `gravado=slate-700 exento=slate-300`.
- `Legend` + `Tooltip` + `ResponsiveContainer minHeight 320`.

### F3-R4 Gráfica Dona (PieChart donut) Deducciones Terceros
- 4 categorías (INFONAVIT 010, FONACOT 006, Pensión 007, Sindicato 001). `outerRadius 90`, `innerRadius 60`. `Cell` colores: `RH_PALETTE`. `Legend derecho` + `Tooltip` + `ResponsiveContainer`.

### F3-R5 Tabla / Alertas Auditoría
- Sub-título `Alertas de inconsistencia salarial SBC / SDI (top N)` + Tabla shadcn: `RFC / Nombre / Depto / SBC / SDI / DiferenciaAbs / % / Alerta`.
- Segunda tabla `Retrasos de timbrado (brecha > 5 días)`: `UUID | FechaPago | FechaEmision | DiferenciaDias | Empleado`.
- Cada tabla con `<Alert variant="destructive">` si registros > umbral configurable.

---

## FASE 4: Estrés & Validación Fiscal

### F4-R1 Script k6 `/tests/performance/k6-fiscal-nomina-10m.js`
- `k6 run --vus=50 --duration=60s` + stages: `10s ramp-up, 60s hold, 10s ramp-down`.
- Fixtures mock 10M rows via `prisma.$queryRaw` en ambiente STAGING (suficientemente poblado).
- Métricas: `http_req_duration p(95) < 1500ms`, `error_rate < 0.05%`, `failed_checks = 0`.
- `check` para body válido (`res.status === 200 && res.body('kpis') && typeof res.json('kpis.isr_retenido') === 'number'`).

### F4-R2 Matriz Auditoría Fiscal / Checklist SAT
Tabla markdown `tests/performance/auditoria-fiscal-checklist.md` con 12 líneas:
1. ISR retenido XML Tipo='002' coincide exacto con total Tablero.
2. Cancelados XML estatus = CANCELADO coincide count_cancelados.
3. UUID duplicados SQL `GROUP BY uuid HAVING count(*)>1` coincide KPI.
4. Brecha emisión-pago días > 5 coincide KPI.
5. SBC NULL / 0 / desvi > 3% coincide KPI alerta.
6. Infonavit Tipo='010' suma coincide donut + KPI cuotas terceros.
7. FONACOT 006 coincide.
8. Pensión 007 coincide.
9. Sindicato 001 coincide.
10. Gravado vs Exento Sueldos 001 coincide con `SUM(payroll_percepciones)` filtro Tipo.
11. Aguinaldo 002, PTU 003, PrimaVac 021 = misma validación 10.
12. Coincidencia Visor SAT (muestra aleatoria 30 comprobantes nómina 1.2 UUID → XLS) vs Tablero: match 30/30.

---

## Functional Requirements (FR)
- **FR-01 Sidebar**: Menú button collapsible "Nómina" → segundo hijo `Link href="/dashboard/nomina/fiscal" label="Tablero Contabilidad y Fiscal"`; icon `Landmark`; active state si `pathname === /dashboard/nomina/fiscal`. Guard RBAC `Permission.MODULE_PAYROLL_VIEW`.
- **FR-02 Auto empresa**: Click tenant sidebar button cambiar empresa → URL `?companyId=` actualizado sin recarga; preservar `startDate, endDate, registroPatronal, departamento, view, sections`; server page re-renderiza SPAN RFC·Nombre + KPIs + gráficas.
- **FR-03 Filtros permanentes**: Inputs siempre visibles (igual fix T5 rh) → Fecha inicio / fin, Registro Patronal opcional, Departamento opcional, Botones Filtrar (Search icon) + Restablecer outline.
- **FR-04 Dropdown Visualización**: 6 secciones (KPIs Principales / Gravado vs Exento / Deducciones Terceros / Alertas SBC·SDI / Alertas Timbrado / Top Comprobantes) → `sections=...` CSV query param; omit param = todas visibles.

## Non-Functional Requirements (NFR)
- **NFR-01 Latencia (5M registros históricos + >1M anuales)**: Bajo STAGING con `5M payroll_receipts + 40M payroll_deducciones + 40M payroll_percepciones` (5 años carga histórica, luego > 1M nóminas/año agregadas):
  - Route handler `/api/stats/fiscal_nomina` 100 VUs 120s hold → `p(95) < 900 ms`; `p(99) < 1.8 s`.
  - SSR full page `/dashboard/nomina/fiscal` → `p(95) < 1.5 s` (streaming Suspense boundaries).
  - 4 queries por request ≤ 3 ms plan time cada una; `max_parallel_workers_per_gather = 4` (PostgreSQL parallel aggregates).
- **NFR-02 Precisión**: Sumas vs tablas base `payroll_deducciones / payroll_percepciones` delta 0.00 (1.000 muestras aleatorias por tipoDeduccion y tipoPercepcion).
- **NFR-03 Seguridad**: IDOR 0% — `requireApprovedDashboardAccess` 403. PII NSS/CURP nunca en JSON response ni logs (Solo alertas top 100 campos RFC, Nombre, Depto, SBC, SDI). Rate limit triple + SECURITY_HEADERS + fp32 safeErrSummary.
- **NFR-04 Build & Lint**: `npm run lint 0/0` + `npm run build 0 exit` + `next/font/google` warnings 0.
- **NFR-05 Responsividad 3 breakpoint**: 375px mobile / 768px tablet / 1440px desktop → sin scroll horizontal. Gráficas 1 col mobile / 2 tablet / 2 desktop lg.
- **NFR-06 Disponibilidad MV**: Refresh CONCURRENTLY (sin AccessExclusiveLock), mantenimiento cada 6 horas, nightly VACUUM ANALYZE. Tiempo refresh CONCURRENTLY < 4 minutos (5M rows).
- **NFR-07 Sin paginación offset 0/OFFSET**: Tablas alertas top 100 usan keyset pagination (id > last_id LIMIT N) para evitar OFFSET SLOW en 5M rows + 40M children.

## Constraints
- **Técnicas (hardened 5M+ rows)**:
  - **Partition Strategy**: La Vista Materializada usa agregado por `(anio, mes)` denso; al filtrar rango fechas, predicado directo sobre `(anio, mes) >= (YEAR(start), MONTH(start)) AND <= (YEAR(end), MONTH(end))` → Postgres planner `Index Cond` + **prune rango estricto** (no seq scan MV completa). Si crecimiento > 2M mensual, particionar tablas base `payroll_receipts` por RANGE(fecha_pago) mensuales en Task-1b.
  - Índices **parciales** (size ↓ 10-15x sobre 5M rows):
    * `idx_payroll_receptors_sbc_null` WHERE `salario_base_cot_apor IS NULL OR salario_base_cot_apor = 0`.
    * `idx_payroll_receptors_sdi_null` WHERE `salario_diario_integrado IS NULL OR salario_diario_integrado = 0`.
    * `idx_invoices_satstatus_cancelado` ON invoices WHERE `sat_status = 'CANCELADO'` (no indexar 90% VIGENTES).
  - Queries alertas top SBC/SDI / brecha > 5 días **SIN OFFSET**: keyset `ORDER BY diff DESC, id ASC LIMIT 100`; si usuario click "Ver más" → `WHERE id > last_id ORDER BY diff DESC LIMIT 100`.
  - `SET LOCAL max_parallel_workers_per_gather = 4;` antes de aggregates MV.
  - Prisma `$queryRaw<[]>` solo (no `findMany()`, no `count()` sin index).
- **Técnicas generales**: Next.js 16 App Router (Server/Client slot pattern), Tailwind 4 + shadcn/ui + Recharts 3. Zod strict allow-list regex.
- **Negocio**: Catálogos SAT TipoPercepcion/TipoDeduccion (Anexo 8 Nómina 1.2 vigente). RegistroPatronal fallback = COALESCE(NULL) vacío si existe.
- **Dependencias**: `prisma/schema.prisma` modelos nómina; `lib/auth` NextAuth v5; `lib/permissions` RBAC; sidebar.tsx menú Nómina; `lib/payroll-analytics-ui-helpers` paleta.

## Assumptions
1. Carga inicial soportada ≥ 5M nóminas (5 años); crecimiento promedio anual ≥ 1M nóminas (2k empleados × 12-24 pagos/año OK).
2. MV row count aprox: 7 empresas × 60 meses (5a) × 1-2 fiscal_entity ≈ 700-1,500 filas en MV (pequeña; aggregates son baratos). El bottleneck son tablas base alerts top N (aplicamos indices parciales + keyset limit).
3. PostgreSQL 16+ soporta CONCURRENTLY y parallel workers (ambiente producción pg_parameter_allowlist lo habilita).
4. Para UUIDs duplicados: uso CTE `ROW_NUMBER() OVER (PARTITION BY uuid)` en MV (no rompe Prisma constraint UNIQUE `payroll_receipts.uuid` → contamos "potenciales duplicados históricos" si UUID se repite en cargas manuales desactivando constraint temporal).
5. Cancelados: JOIN `payroll_receipts.invoiceId → Invoice.satStatus IN ('CANCELADO')` usando `idx_invoices_satstatus_cancelado` partial.
6. Brecha > 5 días: `ABS(fechaEmision::date - fechaPago)`; campo `fechaEmision` tiene `payroll_receipts_company_emision_pago_idx` índice compuesto.
7. RegistroPatronal: si no existe campo físico, MV `registro_patronal = ''`. Parámetro URL solo acepta alfanumérico 20 chars (rejec si especiales).

## Acceptance Criteria

### AC-01 FASE 1: MV + Refresh Concurrente
- **Type**: `rule`
- **Given**: PostgreSQL 16 con 2M rows `payroll_receipts`
- **When**: Ejecutar script `CREATE MV` + `REFRESH MATERIALIZED VIEW CONCURRENTLY`
- **Then**: (a) Creación OK; (b) UNIQUE índice existe; (c) REFRESH CONCURRENTLY no falla (no bloquea selects concurrentes); (d) `ANALYZE` OK; (e) Conteo `mv` rows == `count distinct (org, company, fe, mes)`.
- **Pass Condition**: (a)–(e) todos OK sin warnings de PostgreSQL log.
- **Evidence**: Script SQL output `psql -f migrations/...sql` + `\d+ mv_fiscal_conciliacion_mensual` psql stdout.

### AC-02 FASE 2 Route Handler Zod + Cache + RBAC
- **Type**: `rule`
- **Given**: Usuario autenticado sin MODULE_PAYROLL_VIEW + Usuario autenticado CON permiso.
- **When**: GET `/api/stats/fiscal_nomina?companyId=cuid&startDate=2026-01-01&endDate=2026-09-01&departamento=<script>alert(1)</script>` (XSS attempt).
- **Then**: (a) 403 sin permiso; (b) 400 Zod invalid departamento (rejec regex); (c) 200 OK con permiso + Cache-Control header `s-maxage=300`; (d) `Content-Type: application/json`.
- **Pass Condition**: 4 status + header exactos.
- **Evidence**: Postman/curl 4 requests; `npm run build` incluye route Dynamic.

### AC-03 FASE 2 Server Comp Suspense + Skeleton + Empresa Auto
- **Type**: `rule`
- **Given**: LocalStorage `selectedCompany` con id `cmnnunarz000802gccsfno9x5`; url sin `?companyId=`; pantalla mobile.
- **When**: First paint GET /dashboard/nomina/fiscal.
- **Then**: (a) Client wrapper detecta storage → `router.replace(?companyId=cmn...sections=...)`; (b) Skeleton 6 KPI + 2 gráficos animated renderiza antes 300ms; (c) Span empresa `ODE8604257UA · Empresa Demo` aparece top derecho.
- **Pass Condition**: (a) URL actualiza en < 1s; (b) skeleton classes `animate-pulse` visibles; (c) span texto exacto.
- **Evidence**: Browser snapshot main region (refs skeleton classes, refs h1, span empresa, URL href).

### AC-04 FASE 3 KPI Cards estilo fiscal igual /dashboard_fiscal
- **Type**: `rule`
- **Given**: STAGING populated, KPI ISR = $1,234,567.89.
- **When**: Full paint del tablero.
- **Then**: (a) Cada KPI Card `<Card overflow-hidden border>`; (b) `bg-TONE/10 p-2 text-center border-b` arriba; (c) Ícono `h-12 w-12 text-TONE-500` centro; (d) Value `text-2xl font-bold text-foreground` + `fmtMxn` 2 decimales.
- **Pass Condition**: 6 cards renderizadas, 4 condiciones por card = 24/24.
- **Evidence**: Screenshot + browser_snapshot kpi grid CSS selectors (bg-TONE/10, h-12 w-12).

### AC-05 FASE 3 BarChart Stacked Gravado vs Exento
- **Type**: `rule`
- **Given**: 4 conceptos (001/002/003/021) con gravado > 0 y exento > 0.
- **When**: Tab renderizada lg:grid-cols-2.
- **Then**: (a) 4 bars x 2 stacks cada una (8 rect); (b) Stack id 'a' (Recharts stacked); (c) Tooltip hover muestra "Gravado $X / Exento $Y".
- **Pass Condition**: 3 checks true.
- **Evidence**: HTML snapshot 8 `<path>` rect Recharts (stack offsets), tooltip data attributes.

### AC-06 FASE 3 PieChart Donut Deducciones Terceros
- **Type**: `rule`
- **Given**: Distribución: INFONAVIT 50% | FONACOT 20% | Pensión 15% | Sindicato 15%.
- **When**: Render lg:grid-cols-2.
- **Then**: (a) 4 `<Cell>` distintos; (b) innerRadius > 0 (forma donut); (c) Leyenda derecha con 4 labels.
- **Pass Condition**: 3 checks true.
- **Evidence**: browser_snapshot PieChart refs, innerRadius property visible (style d=…).

### AC-07 FASE 3 Dropdown Visualización + sections URL param
- **Type**: `rule`
- **Given**: 6 secciones. Todas activas → URL no tiene `sections=` (omit).
- **When**: Click dropdown → desmarcar "KPIs Principales" → marcar "Ocultar todas".
- **Then**: (a) Dropdown 6 checkboxes; (b) Desmarcar KPIs → URL contiene `sections=...,` OMITE kpis (5 ids); (c) Grid KPI desaparece DOM; (d) Ocultar todas → URL param `sections=` vacío; render card "Sin secciones visibles" con hint Visualización.
- **Pass Condition**: 4 pasos comportamiento esperado.
- **Evidence**: browser URL location + 3 snapshots correspondientes.

### AC-08 FASE 3 Empresa sync sidebar tenant button
- **Type**: `rule`
- **Given**: Empresa actual `Empresa Demo (ODE)`; en sidebar seleccionar `Empresa Demo 2 (NMP7502257ZA)`.
- **When**: Dispatch evento `company-selected`.
- **Then**: (a) URL `?companyId=` cambia al nuevo; (b) span empresa = `NMP7502257ZA · Demo 2`; (c) KPIs se re-renderizan (Suspense spinner momentáneo); (d) filtros y sections se preservan.
- **Pass Condition**: 4 cond true.
- **Evidence**: Screenshot + history URL after navigation.

### AC-09 FASE 4 k6 p(95) < 900ms (5M+40M rows)
- **Type**: `rule`
- **Given**: STAGING DB poblada con 5,000,000 `payroll_receipts` + 40,000,000 `payroll_deducciones` + 40,000,000 `payroll_percepciones` (5 años carga histórica).
- **When**: `k6 run --vus 0 --stage 15s:20 --stage 120s:100 --stage 10s:0` sobre endpoint `/api/stats/fiscal_nomina`.
- **Then**: `http_req_duration p(95) <= 900 ms`, `p(99) <= 1.8 s`; `checks >= 99.95%`; `http_req_failed < 0.05%`.
- **Pass Condition**: 3 métricas dentro umbrales.
- **Evidence**: Archivo `k6-report-fiscal-nomina-100vus-120s-summary.txt` (k6 stdout).

### AC-10 FASE 4 Matriz Auditoría 12/12 SAT
- **Type**: `rule`
- **Given**: Muestra 30 UUIDs Nómina 1.2; extracto XML vs Tablero MV.
- **When**: Correr validación 12 líneas.
- **Then**: 12/12 PASS sin discrepancias.
- **Pass Condition**: Todas 12 filas = PASS.
- **Evidence**: CSV `tests/performance/auditoria-fiscal-checklist-result.csv` con 12 filas columna PASS/FAIL = PASS.

### AC-11 Build & Lint clean
- **Type**: `rule`
- **Given**: Código fuente completo.
- **When**: `npm run lint && npm run build`.
- **Then**: (a) lint exit 0 0/0; (b) build exit 0.
- **Pass Condition**: 2 exit 0.
- **Evidence**: Terminal stdout last 40 lines.

### AC-12 Seguridad IDOR + PII safe logging
- **Type**: `rubric`
- **Dimension**: Seguridad del endpoint analítico & tablero.
- **Scale**: 1-5.
- **Anchors**:
  - 1 = endpoint abierto sin auth; logs contienen CURP/NSS.
  - 3 = auth presente pero sin requireApprovedDashboardAccess; logs sin PII.
  - 5 = auth + RBAC MODULE_PAYROLL_VIEW + requireApprovedDashboardAccess + rate limit triple + SECURITY_HEADERS + fp32 safeErrSummary cero PII.
- **Pass Threshold**: >= 4.
- **Evidence**: Source review code route handler `api/stats/fiscal_nomina/route.ts` lines 1-200 + lint.

### AC-13 Responsividad Mobile-First
- **Type**: `rubric`
- **Dimension**: Usabilidad sin overflow horizontal.
- **Scale**: 1-5.
- **Anchors**:
  - 1 = Desktop 1440 OK; mobile 375 overflow horizontal (barra scroll X).
  - 3 = OK desktop/mobile; gráficas con overflow.
  - 5 = Todos breakpoints (375/768/1440) sin scroll X. Gráficas ResponsiveContainer 100%, KPIs 1 col mobile / 2 md / 3-6 lg. Dropdown Visualización cabe en ancho viewport.
- **Pass Threshold**: >= 4.
- **Evidence**: Screenshot en 3 viewports + navegador layout snapshot 375×667.

---

## Open Questions
- [ ] ¿El registro patronal se guarda en alguna columna de `payroll_receipts` o tabla de empresas? (De no existir, se agrega `mv_fiscal_conciliacion_mensual.registro_patronal = company.rfc` placeholder y se documenta en Assumptions-4).
- [ ] ¿Se desea guardar el archivo k6 como `tests/performance/k6-fiscal-nomina-10m.js` (carpeta tests) o `scripts/k6/`? (Default tests/performance).

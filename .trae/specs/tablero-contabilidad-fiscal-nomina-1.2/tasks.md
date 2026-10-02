# Tablero Contabilidad y Fiscal Nómina 1.2 — Implementation Plan (Tasks)

## Task 1: FASE 1 — SQL MV `mv_fiscal_conciliacion_mensual` + índices + script refresh concurrente
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None (bloquea todo: F2 necesita la MV)
- **Description**:
  - Crear carpeta `scripts/sql/` si no existe.
  - Crear script `scripts/sql/YYYYMMDDHHMMSS_mv_fiscal_conciliacion_mensual.sql` con:
    1. `DROP MATERIALIZED VIEW IF EXISTS mv_fiscal_conciliacion_mensual;`
    2. `CREATE MATERIALIZED VIEW mv_fiscal_conciliacion_mensual AS SELECT ... GROUP BY organization_id, company_id, fiscal_entity_id, anio = EXTRACT(YEAR from fechaPago), mes = EXTRACT(MONTH from fechaPago);`
       - Predicado GROUP dense `anio, mes` para prune eficiente de rango; NO agrupar por `fecha_pago`.
    3. Columnas: `count_receipts, count_empleados_distinct, isr_retenido_mxn, cuotas_infonavit (010), fonacot (006), pension_alimenticia (007), cuota_sindical (001); gravado/exento 001/002/003/021; recepciones_sbc_null, sdi_null, desv_sbc_sdi_gt_3pct; count_cancelados, count_uuid_duplicados, count_brecha_5dias`.
       - Cancelados: `COUNT(*) FILTER (WHERE inv.sat_status = 'CANCELADO')` vía JOIN `invoices` (aprovechar índice parcial cancelado).
       - UUID Duplicados: CTE `count(*) OVER (PARTITION BY pr.uuid) > 1` count de receipt.
    4. `CREATE UNIQUE INDEX mv_fiscal_conciliacion_uk ON mv_fiscal_conciliacion_mensual (organization_id, company_id, fiscal_entity_id, anio, mes);`
    5. `CREATE INDEX mv_fiscal_conciliacion_company_fecha_idx ON mv_fiscal_conciliacion_mensual (company_id, anio DESC, mes DESC) INCLUDE (isr_retenido_mxn, cuotas_infonavit, cuotas_fonacot, cuotas_pension, cuotas_sindicato, gravado_001_sueldos, exento_001_sueldos, count_cancelados, count_uuid_duplicados, count_brecha_5dias, recepciones_desv_sbc_sdi_gt_3pct, recepciones_sbc_null, recepciones_sdi_null, gravado_002_aguinaldo, exento_002_aguinaldo, gravado_003_ptu, exento_003_ptu, gravado_021_primavac, exento_021_primavac);` (ÍNDICE ONLY SCAN → no heap access 95% consultas KPI).
    6. Bloque II: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual;`
    7. `VACUUM ANALYZE mv_fiscal_conciliacion_mensual;`
  - Validar DDL en ambiente test DB (schema Prisma refleja tablas `payroll_receipts / payroll_receptors / payroll_deducciones / payroll_percepciones / invoices`).
- **Acceptance Criteria Addressed**: AC-01, AC-02, AC-09 (latencia <900ms requerirá index-only scan y prune anio/mes), NFR-01 / NFR-06.
- **Test Requirements**:
  - `rule` TR-1.1: DDL script corre sin errores en PostgreSQL test local (`psql -f` exit 0) y no pide AccessExclusiveLock en MV (sólo SHARE UPDATE EXCLUSIVE).
  - `rule` TR-1.2: `\d mv_fiscal_conciliacion_mensual` psql muestra columnas (>= 23) y UNIQUE constraint + compound index with INCLUDE (ver `\di mv_fiscal_conciliacion_company_fecha_idx`).
  - `rule` TR-1.3: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual` termina < 4 min en 5M rows; postgres log concurrent start/complete.
  - `rule` TR-1.4: Conteo MV rows = `COUNT (DISTINCT (org, company, fe, anio, mes))` payroll_receipts. Delta = 0.
  - `rule` TR-1.5: `isr_retenido_mxn` MV = query base `SUM(pd.importe) WHERE tipo_deduccion='002' AND (anio,mes) between ()` → **delta 0.00**.
  - `rubric` TR-1.6: *Plan EXPLAIN* sobre query MV `SELECT sum(isr_retenido_mxn) FROM mv WHERE company_id=$1 AND anio=2026 AND mes between 1 and 9`. Scale 1-5. 1=Seq Scan full MV; 3=Index Scan sin Include (Heap access); 5=Index Only Scan con Incl (Heap fetches = 0) + prune condicional exacto. Pass >= 5 (obligatorio para cumplir 900 ms p95 en 100 VUs).
- **Notes**: Si RegistroPatronal no existe en tablas, incluirlo como `registro_patronal = COALESCE(NULL, '')::text`.

## Task 1b: FASE 1 Hardening Performance (índices parciales tablas base + keyset pagination + pg_cron refresh MV)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (MV creada)
- **Description**:
  1. **Índices parciales** sobre tablas base (evitan índices enormes 5M+40M rows, reducen tamaño 10-15x):
     - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_receptors_sbc_null ON payroll_receptors (payroll_receipt_id) WHERE salario_base_cot_apor IS NULL OR salario_base_cot_apor = 0;`
     - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_receptors_sdi_null ON payroll_receptors (payroll_receipt_id) WHERE salario_diario_integrado IS NULL OR salario_diario_integrado = 0;`
     - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_satstatus_cancelado ON invoices (id, uuid) WHERE sat_status = 'CANCELADO';`
     - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_receipts_brecha_gt5 ON payroll_receipts (company_id, fecha_pago) WHERE ABS(fecha_emision::date - fecha_pago) > 5;`
  2. **Keyset pagination helper** en `lib/postgres-keyset-pagination.ts`: `buildKeysetWhere<T>(cursor: T | null, order: Array<[column, 'asc'|'desc']>)` → retorna fragmento SQL `(col1, col2) > (?, ?)` (row-values idiom Postgres). Tablas alertas top 100 usan `ORDER BY diff DESC, id ASC LIMIT 100`; "Ver más" = `WHERE (diff, id) < (last_diff, last_id) ORDER BY diff DESC, id ASC LIMIT 100` (nunca OFFSET).
  3. **pg_cron / programación refresh MV**:
     - `scripts/sql/YYYYMMDDHHMMSS_pg_cron_refresh_mv_fiscal.sql`:
       ```sql
       SELECT cron.schedule('refresh-fiscal-conciliacion-mv', '0 */6 * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual; ANALYZE mv_fiscal_conciliacion_mensual$$);
       SELECT cron.schedule('vacuum-analyze-fiscal-base-tables', '15 3 * * *', $$VACUUM ANALYZE payroll_receipts; VACUUM ANALYZE payroll_deducciones; VACUUM ANALYZE payroll_percepciones; VACUUM ANALYZE payroll_receptors$$);
       ```
  4. **Parallel workers hint**: Antes de aggregate queries MV `SET LOCAL max_parallel_workers_per_gather = 4; SET LOCAL parallel_setup_cost = 0; SET LOCAL parallel_tuple_cost = 0;` para 5M+ rows activar parallel aggregates.
- **Acceptance Criteria Addressed**: AC-09 (p95 < 900 ms), NFR-01, NFR-06, NFR-07.
- **Test Requirements**:
  - `rule` TR-1b.1: Índices parciales creados CONCURRENTLY sin locks (psql log). Size índice SBC_null < 10MB en 1M receptors (no 500MB full index).
  - `rule` TR-1b.2: Keyset paginado `EXPLAIN` = Index Scan condición row-values (no `OFFSET 10000`). Tiempo query Top 100 alertas SBC desviaciones en 5M registros + 2M receptors → p95 < 200 ms.
  - `rule` TR-1b.3: `SELECT cron.job_run_details('refresh-fiscal-conciliacion-mv')` return 1 entry exit_code = 0 en test cron.
  - `rubric` TR-1b.4: *Escalamiento futuro > 2M nóminas/mes*: Partition strategy opcional `payroll_receipts RANGE (fecha_pago) PARTITION BY RANGE (fecha_pago)` mensuales `payroll_receipts_p2026_09`. Scale 1-5. 1=Ninguna strategy; 3=Documentada; 5=Script SQL `CREATE TABLE ... PARTITION BY RANGE` + ATTACH PARTITION opcional (desactivado por default; habilita flag PG_PARTITION). Pass >= 4.

## Task 2: FASE 2 — URL helpers, Zod params, parser searchParams + formatters puros
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (solo logical; opcional independiente si tipos ya están listos)
- **Description**:
  - Crear `src/lib/fiscal-nomina-dashboard-url.ts` con:
    1. Type `FiscalNominaSectionId = 'kpis' | 'gravado_exento' | 'deducciones_terceros' | 'alertas_sbc_sdi' | 'alertas_timbrado' | 'top_comprobantes'` (6 secciones).
    2. Const `FISCAL_NOMINA_SECTIONS: {id:FiscalNominaSectionId, label:string}[] as const`
    3. Type `FiscalNominaDashboardSearchParams = { companyId?:string|null; organizationId?:string|null; fiscalEntityId?:string|null; startDate?:string|null; endDate?:string|null; departamento?:string|null; registroPatronal?:string|null; sections?:string|null; }`
    4. `parseFiscalNominaSearchParams(raw) → { companyId, startDateISO, endDateISO, depto, registroPatronal, sections: FiscalNominaSectionId[] }` (regex allow-list departamento, registroPatronal alfanumérico <= 20).
    5. `buildFiscalNominaDashboardUrl(pathname: '/dashboard/nomina/fiscal', params) → string`
  - Crear `src/lib/fiscal-nomina-formatters.ts` (helpers puros SIN 'use client'): `fmtMxn`, `fmtNum`, `fmtPct`, `fmtDateEs`, `fmtDiasDiferencia`. Re-exportar después en `_components/fiscal-nomina-shared.tsx`.
  - Agregar `RH_PALETTE` reutilizar o nueva `FISCAL_NOM_PALETTE` con 6 colores.
- **Acceptance Criteria Addressed**: AC-03, AC-04, AC-07, AC-08
- **Test Requirements**:
  - `rule` TR-2.1: `parseFiscalNominaSearchParams('?sections=kpis,deducciones_terceros,invalid123')` retorna `sections=[kpis, deducciones_terceros]` (3ro invalid rechazado; no default 6).
  - `rule` TR-2.2: `parseFiscalNominaSearchParams('?departamento=<img src=x>')` retorna `departamento=''` (regex rejec).
  - `rule` TR-2.3: `buildFiscalNominaDashboardUrl('/dashboard/nomina/fiscal', { companyId:'cmn...', sections: FISCAL_NOMINA_SECTIONS.map(s=>s.id) })` retorna URL SIN `?sections=` (omit default todas).
  - `rule` TR-2.4: `fmtMxn(1234567.89)` = `$1,234,567.89` es-ES; `fmtPct(0.034)` = `3.4%`; `fmtDiasDiferencia(6.2)` = `6 días`.
  - `rubric` TR-2.5: *Pureza helpers*; scale 1-5; anchors 1=helpers usan 'use client' → fallan en Server; 3=funcionan pero usan global.Date sin pure; 5=helpers puros 100% (sin dependencias side-effect) → usables desde Server y Client sin warning. Pass Threshold >= 4.
- **Notes**: Mantener paridad con `rh-dashboard-url.ts` y `rh-formatters.ts` (mismos nombres helpers).

## Task 3: FASE 2 — Route Handler `/api/stats/fiscal_nomina/route.ts` Zod + RBAC + Cache-Control + hardening escala 5M rows
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (MV), Task 1b (parallel workers hint + keyset), Task 2 (tipos params + parser)
- **Description**:
  - Ubicación: `src/app/api/stats/fiscal_nomina/route.ts`
  - `export const runtime='nodejs'; dynamic='force-dynamic'; maxDuration=30; revalidate=0`
  - Imports auth, prisma, z, rateLimit, requireApprovedDashboardAccess, Permission.MODULE_PAYROLL_VIEW, SECURITY_HEADERS, safeErrSummary, fp32.
  - `Zod schema`: `{ companyId: cuid, organizationId?, fiscalEntityId?, startDate: coerce.date, endDate: coerce.date, departamento?: string max 80 regex allow, registroPatronal?: string max 20 alphanum } superRefine rango <= 5 años`.
  - `GET handler`:
    1. Auth + RBAC + rateLimit triple.
    2. Zod safe parse → 400.
    3. **(Hardening escala)** SET LOCAL parallel workers antes de aggregate queries:
       ```ts
       await prisma.$executeRaw`SET LOCAL max_parallel_workers_per_gather = 4;`
       await prisma.$executeRaw`SET LOCAL parallel_setup_cost = 0;`
       await prisma.$executeRaw`SET LOCAL parallel_tuple_cost = 0;`
       ```
    4. Derivar `anio_mes_start = (start.year, start.month)` y `anio_mes_end` → predicado MV `(anio, mes) >= (row($1,$2)) AND (anio, mes) <= (row($3,$4))` row-values para prune estricto sin seq scan.
    5. **Queries $queryRaw**:
       - (a) KPI aggregate `SUM()` de todas las columnas KPI → `kpis` (usa Index Only Scan por INCLUDE).
       - (b) Gravado vs Exento por (anio, mes) ordenado.
       - (c) Auditoría SBC/SDI top 100: **SIN OFFSET**, keyset `ORDER BY ABS(salarioBaseCotApor - salarioDiarioIntegrado) DESC, pr.id ASC LIMIT 100` + optional cursor `WHERE (ABS(...), pr.id) < ($lastDiff, $lastId)`.
       - (d) Brecha >5 días top 100: `WHERE fechaEmision - fechaPago > 5` (usa índice parcial `idx_payroll_receipts_brecha_gt5`).
    6. `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`; SECURITY_HEADERS.
    7. Response JSON: `{ success:true, data:{ kpis, gravado_vs_exento:[], deducciones_terceros:[...], alertas_timbrado:{cancelados, duplicados, brecha_gt_5}, auditoria_sbc_sdi:[], alertas_brecha_emis_pago:[], sbc_sdi_cursor_next:{diff,id} | null } }`
- **Acceptance Criteria Addressed**: AC-02, AC-09 (p95 900ms), AC-12 (seguridad).
- **Test Requirements**:
  - `rule` TR-3.1: `GET /api/stats/fiscal_nomina?companyId=INVALID&startDate=A` → 400 Zod error JSON.
  - `rule` TR-3.2: Sin auth → 401; sin permiso → 403 requireApprovedDashboardAccess.
  - `rule` TR-3.3: status 200; headers `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`.
  - `rule` TR-3.4: Precisión data.kpis.isr_retenido_mxn = `SUM(payroll_deducciones.importe where tipo_deduccion='002')` raw direct. Delta ≤ 0.01 MXN.
  - `rule` TR-3.5: **EXPLAIN query MV**: `Index Only Scan` (no Seq Scan, no Index Scan with Heap Fetch). `Rows Heap Fetches = 0` en plan output.
  - `rule` TR-3.6: Alertas top 100 SBC/SDI: SQL NO contain `OFFSET` keyword (grep query string).
  - `rubric` TR-3.7: Arquitectura clean handler. Scale 1-5; 1=handler >600 lines; 5=handler <140 lines; helpers `extractKpisFromMvRows`, `withParallelWorkers(prisma, fn)` en `lib/fiscal-nomina-analytics-service.ts`. Pass >= 4.

## Task 4: FASE 2 — Server page `app/dashboard/nomina/fiscal/page.tsx` (Entry) + slot pattern client wrapper
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2 (URL parser), Task 3 (endpoint opcional; server se trae datos via prisma directa en su Server async).
- **Description**:
  - Crear ruta: `src/app/dashboard/nomina/fiscal/page.tsx`
  - `export const dynamic='force-dynamic'`
  - Server page (`page.tsx`) lee `searchParams: Promise<...>` → llama `parseFiscalNominaSearchParams(Object.fromEntries(new URLSearchParams(searchParams).entries()))` → obtiene `filters: ResolvedFiscalNominaFilters`.
  - Slot pattern children (igual `/dashboard/rh`): Server ejecuta `<FiscalNominaServerPage initialFilters={filters} />` → se lo pasa como `children` a wrapper client `<FiscalNominaClientPage initialFilters={filters}>{children}</FiscalNominaClientPage>`.
  - `<FiscalNominaServerPage>`:
    - Trae empresa vía `prisma.company.findUnique({id:filters.companyId})` → `companyRfc/companyDisplayName` para `span` top.
    - Opcional (Server-side streaming `<Suspense>`): 6 secciones condicionales `filters.sections.includes(sectionId) && <Suspense fallback={<SkeletonGroup/>}><KpiCardFiscal/> etc`.
    - Layout header rows: Row 1 `flex justify-between` → `h1 Tablero Contabilidad y Fiscal` + summary xs (Período · Registro Patronal · Depto · Vista · 6/6 secciones) + span empresa der. Row 2 filtros `<FiscalNominaFilterBar/>`. Row 3 Kpis lg:grid-cols-6. Row 4 2col BarChart + PieChart. Row 5 1col tablas alertas.
  - `<FiscalNominaClientPage>` (`'use client'`): Lee `localStorage.selectedCompany`, evento `company-selected` → `populateFromStorage({force: true/false})` con `router.replace(buildFiscalNominaDashboardUrl('/dashboard/nomina/fiscal', {preservar start/end/departamento/registroPatronal/sections}))` igual fix T6 rh-client-page.
  - `FiscalDashboardSkeleton`: 6 cards skeleton + 2 gráficos skeleton + 1 tabla skeleton, clases `animate-pulse rounded bg-slate-200/70 h-16 w-full` etc.
- **Acceptance Criteria Addressed**: AC-03 (Suspense/Skeleton/Auto empresa), AC-08 (empresa sync), AC-13 (responsividad), AC-11 (build/lint clean).
- **Test Requirements**:
  - `rule` TR-4.1: Ruta `/dashboard/nomina/fiscal` responde HTTP 200 (build route list).
  - `rule` TR-4.2: Sin `?companyId=` en URL y `localStorage.selectedCompany` con empresa válida → < 1s router.replace a `?companyId=...` (sin refresh).
  - `rule` TR-4.3: 0 warnings "Attempted to call XXX from server but on client" (en dev terminal consola).
  - `rule` TR-4.4: Cada sección visible tiene `<Suspense>` padre y su skeleton se renderiza mientras datos llegan (DOM `<Suspense fallback>` class `animate-pulse` presente al menos 100ms).
  - `rubric` TR-4.5: *Clarity de Server/Client Boundary*. Scale 1-5. 1=Server imports 'use client' components con useEffect; 3=slot pattern pero children dentro componente sin Suspense; 5=slot pattern strict (FiscalNominaServerPage 100% async sin 'use client'; FiscalNominaClientPage 100% wrapper sin async; formatters lib SIN use client). Pass >= 4.
- **Notes**: La Server Page se comunica con Prisma directa; el Route Handler `/api/stats/fiscal_nomina` queda para integraciones externas.

## Task 5: FASE 2-3 — `FiscalNominaFilterBar` (filtros fijos permanentes + Dropdown Visualización)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2 (FiscalNominaSectionId/parse/build URL), Task 4 (FiscalNominaServerPage recibe el filter bar en layout).
- **Description**:
  - Ubicación `src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-filter-bar.tsx`
  - `'use client'`, React Hook Form + Zod schema igual endpoint (`fiscalNominaFilterSchema = z.object({ startDate: z.coerce.date, endDate ..., departamento, registroPatronal })`).
  - Form: 4 inputs grid `max-w-sm gap-1.5 items-center Label/Input`:
    1. Fecha inicio (type=date)
    2. Fecha fin (type=date)
    3. Registro Patronal (Input opcional placeholder `Y-AAA-999999` ≤20 alfanum)
    4. Departamento (opcional regex allow)
  - Botones `items-end gap-2`:
    - `Filtrar` (variant=default, icon=Search, submit)
    - `Restablecer` (variant=outline, icon=RefreshCcw, reset)
    - DropdownMenu `Visualización` (variant=outline, icon=SlidersHorizontal):
      - Items: `Mostrar todas`, `Ocultar todas`, `Divider` + 6 `DropdownMenuCheckboxItem` (ids `kpis` / `gravado_exento` / `deducciones_terceros` / `alertas_sbc_sdi` / `alertas_timbrado` / `top_comprobantes`).
      - Click checkbox: aplicar `sectionsOverride` a `router.replace()` SIN recarga.
  - Al submit handler onSubmit → `router.replace(buildFiscalNominaDashboardUrl('/dashboard/nomina/fiscal', {...data, sections: visibleSections.length===6?'':visibleSections.join(',')}))`.
  - Quitar wrapper `Card` de filtro (filtros planos igual rh-filter-bar post T5).
- **Acceptance Criteria Addressed**: AC-04 (Kpi cards dependen filtros), AC-07 (Dropdown secciones sections URL), AC-11.
- **Test Requirements**:
  - `rule` TR-5.1: 4 inputs + botones renderizados sin click "Filtros" (siempre visibles; no CollapsibleTrigger).
  - `rule` TR-5.2: Toggle checkbox `KPIs Principales` OFF → URL `?sections=gravado_exento,deducciones_terceros,alertas_sbc_sdi,alertas_timbrado,top_comprobantes` (omite kpis). Grid KPI desaparece en DOM.
  - `rule` TR-5.3: Click "Ocultar todas" → `?sections=` vacío. Server renderiza `<Card> Sin secciones visibles. Usa el botón Visualización para activar secciones. </Card>`.
  - `rule` TR-5.4: RegistroPatronal `"!!!<>"` → Zod regex rejec; form no submit, `error message`.
  - `rubric` TR-5.5: *UX mobile filtros stack vertical* Scale 1-5; 1=overflowX auto aparece; 3=sm:flex-row OK desktop mobile overflow; 5=grid cols-1 sm:cols-2 lg:cols-4 inputs Label arriba → mobile 1 col perfect sin scroll X. Pass >= 4.

## Task 6: FASE 3 — `_components/fiscal-nomina-shared.tsx` KpiCardFiscal + ChartCard + re-exports compat
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2 (formatters), Task 4 (Server usa KpiCard en kpis 6 secciones)
- **Description**:
  - Ubicación `src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-shared.tsx`
  - `'use client'`
  - Re-exports desde libs (compat panels futuros): `fmtMxn, fmtNum, fmtPct, fmtDateEs, fmtDiasDiferencia` (desde `@/lib/fiscal-nomina-formatters`). Exportar `FISCAL_NOM_PALETTE`.
  - `KpiCardFiscal` igual fiscal `/dashboard_fiscal`:
    - `<Card overflow-hidden border border-border hover:shadow-md transition-shadow>`
    - `bg-TONE/10 p-2 text-center border-b border-border` (title bar arriba)
    - `h3 font-bold text-base TONE_COLOR leading-tight flex items-center justify-center`
    - `<CardContent className="p-6 flex-col items-center justify-center space-y-2">`
    - Ícono `h-12 w-12 text-TONE-500` (grande).
    - Value `text-2xl font-bold text-foreground`.
    - Sub-tendencia (badge trend up/down/flat optional).
  - `ChartCard(props: { title, subtitle?, right?, children, className, minHeight?, badge?, footer? })` wrapper CardHeader/CardContent p-4.
  - `FiscalNomEmptyState(icon, title, subtitle, hint)`.
  - Trend badge opcional.
- **Acceptance Criteria Addressed**: AC-04 (Kpi layout), AC-11 (build lint clean), AC-13 (responsividad).
- **Test Requirements**:
  - `rule` TR-6.1: 6 KpiCards con 6 tone distintos (slate/emerald/rose/amber/indigo/violet) render → title bar color `bg-TONE/10` se diferencia (6 class bg distintos presentes).
  - `rule` TR-6.2: 6 icon classes `h-12 w-12 text-TONE-500` no son `h-4 w-4` (se confirma con CSS selector match).
  - `rule` TR-6.3: `fmtMxn` exportado usable desde panels `import {fmtMxn} from './fiscal-nomina-shared'` → build exit 0 sin missing exports.
  - `rule` TR-6.4: `ChartCard` acepta `footer` (igual fiscal-beneficios legacy compat cuando lleguemos top comprobantes).

## Task 7: FASE 3 — 6 KPI Cards top section (ISR retenido / Cuotas Terceros / Cancelados / Duplicados / Brecha 5d / Alertas SBC-SDI)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6 (KpiCardFiscal), Task 4 (Server trae data vía prisma directa)
- **Description**:
  - Server `<FiscalNominaServerPage>` define componente async `<KpisSection>` que trae aggregates (similar route handler pero server rendered).
  - Grid: `<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">` (paridad fiscal 6 cols).
  - KPI 1 `ISR Retenido período` (Tone: slate). Icon: Landmark. Value = `fmtMxn(kpis.isr_retenido_mxn)`. Sublabel: `Sum TipoDeduccion 002`.
  - KPI 2 `Total Cuotas Terceros` (emerald). Icon: Users2. Suma `infonavit+fonacot+pension+sindicato`.
  - KPI 3 `Cancelados` (rose). Icon FileX. Value `count_cancelados`. Badge rojo si > 0.
  - KPI 4 `UUID Duplicados` (amber). Icon CopySlash. Value `count_duplicados`.
  - KPI 5 `Retrasos timbrado > 5 días` (indigo). Icon Clock12. Value `count_brecha_5dias`.
  - KPI 6 `Alertas SBC / SDI` (violet). Icon AlertTriangle. Suma: `recepciones_sbc_null + recepciones_sdi_null + recepciones_desv_sbc_sdi_gt_3pct`.
- **Acceptance Criteria Addressed**: AC-04 (KPI layout match fiscal), AC-11, AC-13.
- **Test Requirements**:
  - `rule` TR-7.1: Grid class `md:grid-cols-2 lg:grid-cols-6` presente en DOM (responsive breakpoint correcto).
  - `rule` TR-7.2: Screenshot pixel-compare con dashboard_fiscal → barra title, icon grande, value text-2xl están en misma posición vertical/horizontal.
  - `rule` TR-7.3: `KPI Cancelados` > 0 → Badge variant `destructive` visible (DOM class `bg-destructive` exists). Si 0 → no Badge.

## Task 8: FASE 3 — Gráfica Bar Stacked Gravado vs Exento por TipoPercepcion (Recharts)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6 (ChartCard), Task 4 (FiscalNominaServerPage trae rows gravado_vs_exento[]).
- **Description**:
  - Server `<GravadoVsExentoSection>` suspenso → pasa data a Client wrapper `<GravadoVsExentoChart rows=[] />`.
  - Agrupación por concepto (4 filas): `Sueldos (001)`, `Aguinaldo (002)`, `PTU (003)`, `Prima Vacacional (021)`. Cada fila `{concepto, importeGravado, importeExento}`.
  - `<BarChart data={data} stackOffset="expand? NO: stackOffset none stackId a">`:
    - XAxis: dataKey='concepto'
    - YAxis: `tickFormatter = fmtMxn`
    - `<Bar dataKey="importeGravado" stackId="a" fill="slate-700" name="Gravado" />`
    - `<Bar dataKey="importeExento" stackId="a" fill="slate-300" name="Exento" />`
    - `<Tooltip formatter={(v) => fmtMxn(Number(v))} />`
    - `<Legend verticalAlign="top" />`
    - `ResponsiveContainer width 100% minHeight 340`.
  - `<Card footer={<p className="text-xs text-muted-foreground">Lógica SAT: Percepciones con tipoPercepcion = 001 Sueldos base, 002 Decimocuarto, 003 PTU, 021 Prima vacacional — tomadas de payroll_percepciones XML attribute ImporteGravado / ImporteExento</p>}/>`
- **Acceptance Criteria Addressed**: AC-05, AC-13.
- **Test Requirements**:
  - `rule` TR-8.1: 4 Bar stacks × 2 bars = 8 `<rect/>` (class Recharts) renderizados.
  - `rule` TR-8.2: Stack ID 'a' → visualmente bars son ADITIVAS (no overlap). Altura bar = Grav+Exent = total percepciones concepto.
  - `rule` TR-8.3: Datos data === `SUM(importe_gravado) / SUM(importe_exento) from payroll_percepciones where tipo_percepcion IN ('001','002','003','021') GROUP BY tipo_percepcion` (4 filas). Delta ≤ 0.01 MXN.
  - `rubric` TR-8.4: *Accesibilidad gráficos*. Scale 1-5. 1=sin aria labels, sin leyenda; 3=legend + tooltip; 5=Cada Bar `<g>` con `aria-label` ($concepto Gravado X, Exento Y). Keyboard Tab accede Legend items. Pass >= 3.

## Task 9: FASE 3 — PieChart Donut Distrib. Deducciones Terceros (INFONAVIT/FONACOT/Pensión/Sindical)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6 (ChartCard + RH_PALETTE), Task 4 (data kpis deducciones terceros).
- **Description**:
  - Client component `DeduccionesTercerosDonut({ data: {categoria: 'INFONAVIT' | ..., importe, tipo: string}[] })`.
  - `<PieChart>`:
    - `<Pie data={data} dataKey="importe" nameKey="categoria" outerRadius={90} innerRadius={60} paddingAngle={3} label={(entry) => entry.categoria}>`.
    - `<Cell fill=FISCAL_NOM_PALETTE[i]>` 4 colores.
    - `<Tooltip formatter = fmtMxn />`
    - `<Legend layout="vertical" align="right" verticalAlign="middle" />`
  - `ChartCard title="Distribución Deducciones Terceros" subtitle="Agrupación por tipoDeduccion SAT"`.
- **Acceptance Criteria Addressed**: AC-06, AC-13.
- **Test Requirements**:
  - `rule` TR-9.1: innerRadius > 0 (forma donut, no pie sólido; visual shape donut OK).
  - `rule` TR-9.2: `data[*].importe.reduce = kpis.cuotas_terceros_total` (TR-7.2 value KPI 2). Delta 0.00.
  - `rule` TR-9.3: 4 categorías etiquetas (4 labels distintos, 4 colores distintos fill, 4 legend items).

## Task 10: FASE 3 — Tablas Alertas Auditoría (SBC/SDI inconsistentes + Brecha timbrado)
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 6 (FiscalNomEmptyState), Task 4 (auditoria_sbc_sdi[], alertas_brecha_emis_pago[]).
- **Description**:
  - Tabla 1 `Alertas Inconsistencia Salarial (SBC / SDI) top 100 desviaciones`. Columnas: `RFC, Nombre Empleado, Departamento, SBC, SDI, Dif. $, Dif. %, Alerta`. Filas estilos: NULL → text-destructive; diff > 3% → row bg-rose-50; diff ≤ 3% → default.
  - Tabla 2 `Retrasos de timbrado (Brecha > 5 días)`: `UUID, FechaPago, FechaEmisión, DifDías, Empleado`. Tooltip click UUID → open `/invoices/[id]/pdf` link.
  - Si registros = 0, render `FiscalNomEmptyState`.
- **Acceptance Criteria Addressed**: AC-04 (KPIs 6 = sum alertas), AC-11, AC-13.
- **Test Requirements**:
  - `rule` TR-10.1: Si total filas > 0, KPI-6 Alertas SBC/SDI `value = count(tabla1 rows con SBC_null OR SDI_null OR diff>3%)`. Igualdad exacta.
  - `rule` TR-10.2: Brecha días `count_brecha_5dias (KPI5) = count(tabla2 rows)`. Exacto.
  - `rule` TR-10.3: Tabla columna `Dif. %` formateada con `fmtPct(val * 0.01)`.
  - `rubric` TR-10.4: *Legibilidad tablas en mobile*. Scale 1-5. 1=columnas overflow; 3=overflowX auto con sticky header; 5=campo clave visible (Empleado/Alerta/UUID) y cols resto horizontal scroll. Pass >= 4.

## Task 11: Sidebar Nómina button: agregar hijo "Tablero Contabilidad y Fiscal" (ruta /dashboard/nomina/fiscal)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4 (ruta creada)
- **Description**:
  - `sidebar.tsx` L600-L628 (CollapsibleTrigger Nómina). CollapsibleContent ya contiene `/dashboard/rh` Tablero Recursos Humanos.
  - Agregar 2do `<Link href="/dashboard/nomina/fiscal">`:
    - Icon: `Landmark`.
    - Label: `Tablero Contabilidad y Fiscal`.
    - Active state: `pathname === '/dashboard/nomina/fiscal' || pathname.startsWith('/dashboard/nomina/fiscal/')`.
  - Misma className `flex items-center space-x-3 rounded-full px-4 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white; active: bg-white/10 text-white`.
  - Dentro del mismo `hasPermission(Permission.MODULE_PAYROLL_VIEW)` guard L600 (no doble guard).
- **Acceptance Criteria Addressed**: FR-01, AC-11, AC-12 (permisos guard).
- **Test Requirements**:
  - `rule` TR-11.1: Build success route `/dashboard/nomina/fiscal` existe.
  - `rule` TR-11.2: En `/dashboard/nomina/fiscal`, Nómina button → expand → hijo "Tablero Contabilidad y Fiscal" tiene `bg-white/10 text-white` (active state).
  - `rule` TR-11.3: Usuario SIN MODULE_PAYROLL_VIEW → Collapsible Nómina NO renderiza (display none).
  - `rule` TR-11.4: Click en hijo → navigation `<Link>` NO full reload (history popstate, soft router replace).

## Task 12: `npm run lint` 0/0 + `npm run build` 0 exit code (Fase 2-3 integration)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
- **Description**:
  - Fix cualquier error tipo TS, unused imports, missing exports, `react-hooks/set-state-in-effect` (usar setTimeout(fn, 0) + clearTimeout pattern rh-filter-bar).
  - Eliminar warnings `@typescript-eslint/no-unused-vars` y reglas custom.
- **Acceptance Criteria Addressed**: AC-11.
- **Test Requirements**:
  - `rule` TR-12.1: `npm run lint` stdout last line: `0 errors 0 warnings`; exit 0.
  - `rule` TR-12.2: `npm run build` stdout last lines: Routes `/dashboard/nomina/fiscal` Dynamic (server) λ; exit 0.
  - `rule` TR-12.3: No warnings de Next.js build "Fast refresh will lose local state" (no circular imports entre components fiscal-nomina).

## Task 13: FASE 4 — Script k6 stress test endpoint 5M+ registros p(95) < 900ms (100 VUs 120s)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (endpoint listo), Task 1b (hardening performance), Task 12 (build clean)
- **Description**:
  - Ubicación: `tests/performance/k6-fiscal-nomina-5M-100vus-120s.js`
  - Imports: `import http from 'k6/http'; import { check, sleep } from 'k6'; import { Rate, Trend } from 'k6/metrics';`
  - `export const options = `
    ```js
    {
      scenarios: {
        load: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '15s', target: 20 },
            { duration: '120s', target: 100 },
            { duration: '10s', target: 0 },
          ],
          gracefulRampDown: '30s',
        },
      },
      thresholds: {
        http_req_duration: ['p(95)<900', 'p(99)<1800', 'avg<450'],
        checks: ['rate>0.9995'],
        http_req_failed: ['rate<0.0005'],
      },
      ext: {
        loadimpact: { projectID: __ENV.LOADIMPACT_PROJECT_ID || null, distribution: { label: 'Local' } },
      },
      userAgent: 'k6-cfdi-taskmanager-fiscal-nomina-loadtest/1.0',
    }
    ```
  - Setup data: `COMPANY_ID = __ENV.COMPANY_ID || 'cmnnunarz000802gccsfno9x5'`; `BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'`; `AUTH_TOKEN = __ENV.AUTH_COOKIE`.
  - Request: `http.get(\`\${BASE_URL}/api/stats/fiscal_nomina?companyId=\${COMPANY_ID}&startDate=2025-01-01&endDate=2026-12-31\`, { headers: { Cookie: `next-auth.session-token=\${AUTH_TOKEN}`, Accept: 'application/json' }, tags: { name: 'FiscalNominaStats' } })`
  - `check(res, { 'status is 200': (r) => r.status === 200, 'kpi ISR number': (r) => { try { return typeof JSON.parse(r.body).data.kpis?.isr_retenido_mxn === 'number'; } catch { return false; } }, 'body has auditoria_sbc_sdi array': (r) => Array.isArray(JSON.parse(r.body)?.data?.auditoria_sbc_sdi) && JSON.parse(r.body).data.auditoria_sbc_sdi.length <= 101 })`
  - `sleep(Math.random() * 0.2 + 0.05)` para simular usuario real.
- **Acceptance Criteria Addressed**: AC-09 (p95 < 900ms), NFR-01 (latencia 5M rows).
- **Test Requirements**:
  - `rule` TR-13.1: `k6 inspect tests/performance/k6-fiscal-nomina-5M-100vus-120s.js --execution-requirements` exit code 0 (script sintaxis OK).
  - `rule` TR-13.2: Bajo staging 5M payroll_receipts + 40M children rows, `k6 run --out json=k6-report-fiscal-nomina-100vus-120s.json` output summary `http_req_duration p(95) ≤ 900ms`, `p(99) ≤ 1800ms`, `checks ≥ 99.95%`, `http_req_failed < 0.05%`.
  - `rule` TR-13.3: No errors `502/504/500` > 0.01% throughput. Server process Node no excede memoria <4GB (pm2 monit).
  - `rubric` TR-13.4: *Forma del load profile*. Scale 1-5. 1=Steps abruptos (errores timeout ramp). 3=Rampa smooth 15s/120s/10s pero sin gracefulRampDown. 5=staged ramping-vus + gracefulRampDown 30s. Pass >= 5 (obligatorio para reproducir carga "empresa 1M anuales").

## Task 14: FASE 4 — Matriz Auditoría SAT checklist 12 líneas (conciliación)
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 1 (MV data source veraz), Task 4 (Kpis & tablas)
- **Description**:
  - Ubicación `tests/performance/auditoria-fiscal-nomina-checklist.md` (tabla 4 cols: `# | Concepto SAT | Validación | Resultado | Notas`).
  - 12 filas AC-10 (ISR, Cancelados, Duplicados, Brecha, SBC 3 alertas, 4 deducc terceros, 4 gravado/exento conceptos, visor SAT muestra 30 UUIDs).
  - Columna Resultado = `PASS / FAIL / PEND`.
  - Anexar `tests/performance/auditoria-fiscal-nomina-checklist-results.csv` (template vacío).
- **Acceptance Criteria Addressed**: AC-10.
- **Test Requirements**:
  - `rule` TR-14.1: 12 filas definidas.
  - `rule` TR-14.2: Cada validación describe (a) query SQL fuente; (b) script Node/Python comparación; (c) umbral delta = 0.00 MXN.
  - `rule` TR-14.3: CSV template coincide 12 rows × 4 cols.

## Task 15: Smoke navegación final usuario + validación UI screenshot
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 11 (sidebar), Task 12 (build/lint clean).
- **Description**:
  - Incógnito → login `admin@itcomplements.com` password → sidebar expandir Nómina → 2 hijos: Tablero Recursos Humanos + **Tablero Contabilidad y Fiscal**.
  - Click → 200; empresa auto-seleccionada; filtros permanentes; KPI 6 cards visible; Dropdown Visualización desmarca KPIs → URL cambia y desaparece.
  - Toggle empresa sidebar tenant → URL `?companyId=` cambia y SPAN RFC·Nombre se actualiza.
- **Acceptance Criteria Addressed**: AC-07, AC-08, AC-13.
- **Test Requirements**:
  - `rule` TR-15.1: Screenshot 3 capturas (Inicio, Filtros + 6 KPIs, toggle OFF KPIs = 0 grid).
  - `rule` TR-15.2: URL cambio toggle 6 secciones + cambio empresa = soft nav (no reload F5).
  - `rubric` TR-15.3: *Homogeneidad estética con dashboard_fiscal*. Scale 1-5. 1=diferente layout; 3=mismos colores distinto grid; 5=title bar misma altura, icono mismo tamaño, value misma font-size, misma separación py-4 filtros, misma disposición título empresa justify-between. Pass >= 4.

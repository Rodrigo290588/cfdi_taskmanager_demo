# Tablero RH Directivo (C-Level / Estratégico) - Product Requirements Document

## Overview
- **Summary**: Construcción del Tablero de Dirección General (C-Level / Estratégico) para métricas de Costo de Nómina y análisis financiero ejecutivo sobre CFDIs de Nómina 1.2 SAT México. Alineado al stack Next.js 16 App Router (Server Components + Streaming) + Prisma 6 + PostgreSQL 16 + Zod + Tailwind 4 + shadcn/ui + Recharts 3. Accesible vía ruta `/dashboard/direccion` como hijo del menú "Nómina" del sidebar.
- **Purpose**: Proveer a Dirección General (CEO), Director Financiero (CFO), Vicepresidencia de RH y Comité Ejecutivo de una herramienta visual C-Level con métricas agregadas de alto nivel para toma de decisiones estratégicas: (a) Costo Total de Nómina consolidado (Percepciones Brutas + Carga Patronal IMSS/Infonavit Estimada + ISN estatal); (b) Evolución histórica Costo Laboral (tendencia mes-a-mes, YoY); (c) Costo Promedio por Empleado; (d) Desviación Presupuestal por Departamento/Centro de Costos; (e) Impacto Financiero: Gasto Fijo (Sueldos) vs Gasto Variable (Comisiones, Bonos, Horas Extra, Aguinaldo).
- **Target Users**:
  - **CEO / Dirección General**: Visión ejecutiva global del costo laboral y su evolución.
  - **CFO / Director Financiero**: Presupuestación, desviaciones, impacto financiero de nómina vs operación.
  - **VP / Director de RH**: Costo por empleado, distribución fijo/variable, análisis por departamento.
  - **Comité Ejecutivo**: Reportes mensuales/trimestrales consolidados para board meeting.

## Goals
1. **Costo Total Nómina Consolidado (Carga Laboral)**: Calcular en tiempo real el costo total integrado: Percepciones Brutas (`TotalPercepciones`) + Carga Patronal Estimada (IMSS ~28% + INFONAVIT 5% sobre `SBC * NumDiasPagados`) + ISN Estatal (2%-3% paramétrico según `ClaveEntFed`).
2. **Nómina como % de Operación (Tendencia Histórica)**: Visualización gráfica LineChart/AreaChart de evolución mes-a-mes con comparativa YoY (año contra año) sobre costo total acumulado.
3. **Costo Promedio por Empleado**: KPI = Costo Total Nómina período / Conteo Distintivo Empleados Activos (CURP/NumEmpleado únicos).
4. **Desviación Presupuestal por Departamento**: Comparativa BarChart/Tabla entre Presupuesto Autorizado (entidad presupuestos) vs Costo Real Ejecutado agrupado por `Departamento`.
5. **Impacto Financiero Fijo vs Variable**: PieChart/BarChart de distribución: Fijo = `TipoPercepcion = '001'` Sueldos; Variable = Tipos `019` (Horas Extra), `028` (Comisiones), `038` (Bonos), `002` (Aguinaldo), `003` (PTU), `021` (Prima Vacacional).
6. **SLA Rendimiento C-Level**: Tiempo de carga inicial < 1.5s sobre 10M+ CFDIs históricos (5 años). Latencia endpoint `p(95) < 1500ms` en 50 VUs concurrentes.
7. **Integración con Arquitectura Existente**: Reutilizar patrones Server Components/Suspense de `/dashboard/nomina/fiscal` y `/dashboard/rh`; hardening 7-capas endpoint (RateLimit × 3 + Auth + Zod + RBAC + Keyset + Cache-Control).

## Non-Goals
- **Nunca parsear XML CFDI 1.2 en runtime-request-time**. Solo lectura de tablas ETL `payroll_receipts / payroll_percepciones / payroll_receptors / payroll_deducciones` y Vistas Materializadas PostgreSQL pre-calculadas.
- No genera DIOT, Declaración Anual 13, DT, IMSS-IDI o declaraciones SAT válidas; solo analítica estratégica.
- No reemplaza `/dashboard/rh` (Headcount/Turnover/Beneficios táctico) ni `/dashboard/nomina/fiscal` (Cumplimiento/Conciliación fiscal). **Éste tablero = Visión C-Level / Estratégico de costo laboral**.
- No implementa flujos autorizatorios, workflow de aprobación presupuestal, ni pagos a terceros.
- No modifica pipeline ETL `lib/etl-payroll-indexer` existente; solo agrega 1 MV + script refresh + nueva entidad opcional `BudgetDepartment`.
- No exporta reportes PDF/XLSX en esta versión (MVP); solo gráficas + tablas HTML (punto extensión post-MVP).

## Background & Context
### Modelos Prisma y Tablas Base (ya existentes 100%)
- **`PayrollReceipt (payroll_receipts)`**: `fechaPago @db.Date`, `fechaEmision DateTime`, `companyId / fiscalEntityId / organizationId`, `totalPercepciones / totalDeducciones / totalOtrosPagos @Decimal(18,6)`, `numDiasPagados`, `departamento`. Índices `[org, companyId, fechaPago, depto]`, `[companyId, fechaPago]`.
- **`PayrollReceptor (payroll_receptors)`**: `salarioBaseCotApor (SBC)`, `salarioDiarioIntegrado (SDI)`, `numEmpleado`, `curp`, `departamento`, `claveEntFed` (Clave Entidad Federativa SAT para ISN).
- **`PayrollPercepcion (payroll_percepciones)`**: `tipoPercepcion CHAR(3)`, `concepto`, `importeGravado / importeExento`. Clasificación SAT: `001`=Sueldos (Fijo); `002`=Aguinaldo, `003`=PTU, `019`=Horas Extra, `021`=Prima Vacacional, `028`=Comisiones, `038`=Bonos de productividad (Variables).
- **`Company (companies)`**: `id (cuid)`, `rfc`, `businessName`, `name` (para span empresa header).
- **`Invoice (invoices)`**: `satStatus enum (VIGENTE, CANCELADO)` (para excluir cancelados del costo real).

### Vistas Materializadas Predecesoras (reusar lógica SQL)
- `mv_hr_headcount_costo_kpis`: Template SQL para GROUP BY dense `(org, company, fe, depto, DATE_TRUNC month fecha_pago)` → reusar estructura CTE.
- `mv_fiscal_conciliacion_mensual`: Template Índices UNIQUE + INCLUDE, `REFRESH CONCURRENTLY`, row-values `ROW(anio, mes)` prune.

### Patrones Arquitecturales (Estrictamente Reusar)
- **UI**: Layout `flex justify-between` (h1 Tablero izq + span RFC·Empresa der); filtros py-4 items-end; KPI cards tone bar; Dropdown Visualización `sections[]` query param; Suspense boundaries por sección; Skeleton shadcn.
- **API Endpoint**: `api/stats/*/route.ts` template: runtime=nodejs, dynamic=force-dynamic, Zod strict, RBAC `requireApprovedDashboardAccess(MODULE_PAYROLL_VIEW)`, RateLimit triple (IP/user/org), `SECURITY_HEADERS`, `fp32`, `safeErrSummary`, `SET LOCAL parallel workers`, `Cache-Control public, s-maxage=300`.
- **URL/Formatters**: `lib/*-dashboard-url.ts` parse/build; `lib/*-formatters.ts` helpers puros (fmtMxn, fmtNum, fmtPct, fmtDateEs) SIN 'use client'.
- **Sidebar**: Menú button collapsible "Nómina" → agregar 3er hijo `Link href="/dashboard/direccion" label="Tablero RH Directivo"` (icon `Building2`); guard RBAC `Permission.MODULE_PAYROLL_VIEW`.

### Parámetros Financieros Paramétricos (Configurables por Empresa/EntFed)
- **Carga Patronal Estimada IMSS**: `SBC * NumDiasPagados * 0.3040` (28% IMSS cuota patronal + 2.4% INFONAVIT = 30.4% sobre SBC diario; ~parámetro global `CARGA_PATRONAL_DEFAULT = 0.304`).
- **ISN Estatal (% sobre Percepciones Gravables)**: Lookup table por `ClaveEntFed` SAT (Aguascalientes=0.025, CDMX=0.03, Nuevo León=0.02, etc.). Default fallback `ISN_DEFAULT = 0.025` (2.5%) si `ClaveEntFed` NULL.

---

## FASE 1: Arquitectura de Datos y Persistencia (SQL / Vistas Materializadas)

### F1-R1: Vista Materializada `mv_direccion_costo_ejecutivo_mensual`
Granularidad densa **(organization_id, company_id, fiscal_entity_id, anio, mes, departamento)** para prune eficiente. Columnas calculadas:
| Columna | Origen / Fórmula |
|---|---|
| `organization_id, company_id, fiscal_entity_id` | FK a tablas dim |
| `anio INT, mes INT` | `EXTRACT(YEAR/MONTH FROM pr.fecha_pago)` |
| `departamento TEXT` | `COALESCE(prre.departamento, pr.departamento, 'Sin Departamento')` |
| `count_recibos INT` | `COUNT(DISTINCT pr.id)` excluyendo `Invoice.satStatus='CANCELADO'` |
| `count_empleados_unicos INT` | `COUNT(DISTINCT COALESCE(prre.curp, prre.num_empleado, prre.rfc))` |
| `percepciones_brutas_mxn NUMERIC(18,6)` | `SUM(pr.total_percepciones)` solo VIGENTES |
| `sbc_sumado_mxn NUMERIC(18,6)` | `SUM(prre.salario_base_cot_apor * pr.num_dias_pagados)` base carga patronal |
| `carga_patronal_estimada_mxn NUMERIC(18,6)` | `sbc_sumado_mxn * 0.304` (param) |
| `isn_estimado_mxn NUMERIC(18,6)` | `percepciones_brutas_mxn * CASE clave_ent_fed WHEN '01' THEN 0.02 WHEN '09' THEN 0.03 ... ELSE 0.025 END` |
| `costo_total_nomina_mxn NUMERIC(18,6)` | `percepciones_brutas + carga_patronal_estimada + isn_estimado` |
| `costo_fijo_mxn NUMERIC(18,6)` | `SUM(pp.importe_gravado + pp.importe_exento) WHERE pp.tipo_percepcion = '001'` |
| `costo_variable_mxn NUMERIC(18,6)` | `SUM(pp...) WHERE tipo IN ('002','003','019','021','028','038')` |
| `sueldos_001 NUMERIC`, `aguinaldo_002`, `ptu_003`, `horas_extra_019`, `prima_vac_021`, `comisiones_028`, `bonos_038` | Desglose individual variable para drilldown |

### F1-R2: Índices Compuestos y Optimización
- **Clave UNIQUE**: `UNIQUE (organization_id, company_id, fiscal_entity_id, anio, mes, departamento)` → requisito `REFRESH CONCURRENTLY`.
- **Índice Covering KPI (Index Only Scan)**: `CREATE INDEX ... ON mv (company_id, anio DESC, mes DESC) INCLUDE (costo_total_nomina_mxn, percepciones_brutas_mxn, carga_patronal_estimada_mxn, isn_estimado_mxn, costo_fijo_mxn, costo_variable_mxn, count_empleados_unicos, count_recibos, sueldos_001, aguinaldo_002, ptu_003, horas_extra_019, prima_vac_021, comisiones_028, bonos_038)`.
- **Índice Departamento**: `(company_id, departamento, anio DESC, mes DESC)` → queries desviación presupuestal.

### F1-R3: Función Refresh Concurrente + Entidad Presupuestos
- Función SQL `refresh_direccion_materialized_views(p_concurrent BOOLEAN DEFAULT FALSE) OUT p_updated_at TIMESTAMPTZ`: ejecuta `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_direccion_costo_ejecutivo_mensual; ANALYZE mv;`.
- **Opcional MVP**: Entidad Prisma `BudgetDepartment` (si no existe aún): `{ id cuid PK, companyId, departamento, anio INT, mes INT, presupuesto_autorizado NUMERIC(18,6), created_at, updated_at }` → FK `Company`. Índice `UNIQUE(companyId, departamento, anio, mes)`.
- Si entidad presupuestos no se implementa en MVP: columna `presupuesto_autorizado = NULL` → KPI Desviación Presupuestal muestra "Sin dato presupuestal" badge.

---

## FASE 2: API & Server Components (Next.js App Router)

### F2-R1: Route Handler `/api/stats/direccion/route.ts`
- **Configuración**: `runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=30`, `revalidate=0`.
- **Zod Schema Estricto**:
  ```
  { companyId: cuid required, organizationId?: cuid|null, fiscalEntityId?: cuid|null,
    startDate: coerce.date, endDate: coerce.date, departamento?: string regex allow 80ch,
    anioComparativo?: number [2000..2100] nullable }
  superRefine: rango <= 5 años (366*5 días); endDate >= startDate.
  ```
- **Hardening 7 Capas**:
  1. RateLimit IP (60 req/min)
  2. Auth NextAuth v5 `auth()`
  3. RateLimit User (30 req/min)
  4. Zod strict parse → 400
  5. RBAC `requireApprovedDashboardAccess(Permission.MODULE_PAYROLL_VIEW)` → 403
  6. RateLimit Org (180 req/min)
  7. SET LOCAL parallel_workers_per_gather=4 + row-values prune `ROW(anio,mes)`
- **Cache**: `Cache-Control: public, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600`; `SECURITY_HEADERS`.
- **Response JSON**: `{ ok:true, generatedAt, scope:{orgId,companyId,fiscalEntityId,filters:{...}}, kpis:{costoTotal, costoPromedioEmpleado, pctNominaVariable, desviacionPresupuestalGlobal,...}, tendenciaHistorica:[{anio,mes,costoTotal,costoYoY?}], composicionFijoVariable:{fijo,variable,desglose[]}, desviacionPorDepartamento:[{departamento,presupuestoAutorizado,costoReal,desviacionAbs,desviacionPct}] }`.
- **Error Handling**: `fp32` fingerprint + `safeErrSummary` → `correlationId` al cliente; stack NUNCA al cliente.

### F2-R2: Server Component `app/dashboard/direccion/page.tsx`
- **Slot Pattern** (igual fiscal/rh): `page.tsx` async Server → `parseDireccionSearchParams(searchParams)` → `<DireccionServerPage initialFilters>` pasa como `children` a wrapper client `<DireccionClientPage initialFilters>{children}</DireccionClientPage>`.
- **`DireccionServerPage`** (100% Server, sin 'use client'):
  - Resuelve empresa `prisma.company.findUnique` → `companyRfc / companyDisplayName` span top.
  - Filtros permanentes: `startDate (default -12m startOfMonth)`, `endDate (default endOfMonth today)`, `departamento`, `anioComparativo` (default año anterior).
  - Layout: Row 1 h1 Tablero RH Directivo + summary (Período · 4/4 secciones) + span empresa. Row 2 filtros py-4 items-end. Row 3 KPI Cards lg:grid-cols-4. Row 4 1col AreaChart Tendencia Histórica full-width. Row 5 lg:grid-cols-2 PieChart Composición + Tabla Desviación Presupuestal.
  - Suspense boundaries por sección: cada grid section wrappeado en `<Suspense fallback={<SkeletonGroup />}>`.
- **`DireccionClientPage`** ('use client'): Sync `localStorage.selectedCompany` → evento `company-selected` → `router.replace(buildDireccionDashboardUrl(...))` preservando filtros (start/end/depto/anioComparativo/sections).

---

## FASE 3: Componentes UI Responsivos (Tailwind 4 + shadcn/ui + Recharts 3)

### F3-R1: `DireccionDashboardClient` Mobile First → Ultra-Wide
- **Grid Breakpoints**: `sm: 1col`, `md: 2col`, `lg: 4col KPIs + 2col charts`, `xl: charts full-width`. Gap uniforme `gap-4`.
- `TooltipProvider` shadcn global; tooltips en KPIs, gráficas, tablas (descripción lógica financiera: "Costo Total = Percepciones Brutas + Carga Patronal 30.4% SBC + ISN 2.5%").

### F3-R2: KPI Cards Ejecutivas (4 minimum)
| KPI | Tone | Icon | Value | Sub | Trend |
|---|---|---|---|---|---|
| Costo Total de Nómina | slate-900 | `Landmark` | `fmtMxn(costo_total_nomina)` | "Percepciones + Carga Patronal + ISN" | ↑/↓ vs período anterior YoY |
| Costo Promedio / Empleado | blue-700 | `UsersRound` | `fmtMxn(costo_promedio_empleado)` | `fmtNum(empleados_unicos,0) personas` | ↑/↓ costo/empleado |
| % Nómina Variable | amber-600 | `TrendingUp/Down` | `fmtPct(pct_variable)` | Fijo `fmtMxn` · Variable `fmtMxn` | Desviación vs benchmark 20% |
| Desviación Presupuestal Global | emerald/rose | `Target` | `fmtPct(desviacion_pct)` | Autorizado `fmtMxn` · Ejecutado `fmtMxn` | Badge "Dentro/ Fuera de Presupuesto" si dato |

### F3-R3: Gráfica Tendencia Histórica (AreaChart full-width)
- `AreaChart Recharts`: Xaxis = `MMM/YY` (date-fns es-ES locale); 2 series: (a) `costo_total_actual` relleno azul-500 alpha 0.6; (b) `costo_total_yoy` (año comparativo) linea punteada slate-400.
- `Yaxis = fmtMxn compacto ($1.2M, $5.8M)`; `Legend superior` + `Tooltip detallado (Mes · Actual · YoY · Diferencia Abs/%)`; `ResponsiveContainer minHeight 380`.
- Switcher superior: Toggle "Mensual / Trimestral / Anual" → `view query param`; agregación granularidad sobre MV.

### F3-R4: Gráfica Composición Fijo vs Variable
- **Opción Desktop**: `PieChart donut` outerRadius 120 innerRadius 80; 2 cells: Fijo=slate-800, Variable=amber-500; centro texto `pct_variable` bold. `Legend derecho detallado` con valores.
- **Opción Mobile**: `BarChart stacked horizontal` 2 series por claridad.
- **Tabla Desglose Variable** bajo el gráfico: 6 filas (Sueldos 001 · Aguinaldo 002 · PTU 003 · H.Extra 019 · Prima Vac 021 · Comisiones 028 · Bonos 038) con `importe_mxn, pct_total`; orden descendente monto.

### F3-R5: Tabla Desviación Presupuestal por Departamento
- shadcn `Table` con columnas: `Departamento | Presupuesto Autorizado | Costo Real Ejecutado | Desviación Abs | Desviación % | Status`.
- Status badge: `|desviacion_pct| ≤ 5%` → Emerald "En línea"; `5-10%` → Amber "Atención"; `>10%` → Rose "Fuera de Presupuesto". Row highlight rose si >10%.
- Si entidad `BudgetDepartment` sin datos o NULL: `<Alert variant="default">Sin datos de presupuesto cargados. Mostrando solo costo real por departamento.</Alert>`.

---

## FASE 4: Pruebas Estrés y Validación Financiera

### F4-R1: Script k6 `tests/performance/direccion-dashboard-load.js`
- Escenario 50 VUs / 60s stages: `10s ramp-up, 60s hold, 10s ramp-down`.
- Fixtures: endpoint `GET /api/stats/direccion?companyId=TEST_COMPANY&startDate=2023-01-01&endDate=2026-08-31&anioComparativo=2025` (DB staging poblada ≥ 5M CFDIs).
- **SLA Checks**:
  - `http_req_duration p(95) < 1500ms`
  - `http_req_duration p(99) < 3000ms`
  - `error_rate < 0.1%`
  - `checks: res.status === 200 && res.json('ok') === true && typeof res.json('kpis.costoTotalNominaMxn') === 'number'` → 100% pass.
- Threshold k6 abort if `http_req_duration{type:GET}>1500ms` > 5% early fail.

### F4-R2: Checklist Auditoría Financiera / Matriz C-Level (12 puntos)
1. Percepciones Brutas MV = `SUM(pr.totalPercepciones) WHERE Invoice.satStatus='VIGENTE'` raw → delta 0.00 MXN.
2. Carga Patronal Estimada = `SUM(prre.SBC × pr.NumDiasPagados) × 0.304` → delta ≤ 0.01%.
3. ISN Estimado = `SUM percep × CASE clave_ent_fed` → match exacto cálculo manual 10 registros muestra.
4. Costo Total Nómina = Percep Brutas + Carga Patronal + ISN → delta 0.00.
5. Conteo Empleados Únicos (CURP/NumEmpleado/RFC) = `COUNT DISTINCT COALESCE(curp,num_emp,rfc)` raw → delta 0.
6. Costo Promedio/Empleado = Costo Total / #Empleados → match fórmula.
7. Costo Fijo = SUM Percepcion Tipo 001 → delta 0.00.
8. Costo Variable = SUM Tipos (002, 003, 019, 021, 028, 038) → delta 0.00.
9. % Variable = Variable / (Fijo+Variable) → match porcentaje 2 decimales.
10. Tendencia Histórica Ene-Dic 2025 = Suma 12 filas MV 2025 → match total anual.
11. YoY comparativo Ene 2025 vs Ene 2024 = filas MV anio,mes exactas → delta.
12. Auditoría SAT Visor: Muestra 30 UUIDs nómina aleatorios → XLS vs Tablero: Suma Percepciones 30/30 match.

---

## Functional Requirements (FR)
- **FR-01 Sidebar**: Menú "Nómina" collapsible → 3er hijo `Link href="/dashboard/direccion" label="Tablero RH Directivo"`; icon `Building2` lucide; active state match pathname. RBAC guard `Permission.MODULE_PAYROLL_VIEW`.
- **FR-02 Auto-Empresa**: Click tenant sidebar button "Cambiar empresa" → URL `?companyId=` actualizado `router.replace` (sin refresh); preservar `startDate,endDate,departamento,anioComparativo,view,sections`.
- **FR-03 Filtros Permanentes**: Inputs fechas (start/end), Departamento dropdown, Año Comparativo (año anterior default), Botones: Filtrar + Restablecer outline.
- **FR-04 Dropdown Visualización**: 4 secciones: `kpis`, `tendencia_historica`, `composicion_fijo_variable`, `desviacion_presupuestal` → `sections= CSV query param`; omit = todas visibles.
- **FR-05 Sincronización Empresa**: Span `RFC · Nombre Empresa` sincroniza desde sidebar evento `company-selected` (par fix T6 rh).
- **FR-06 Presupuestos**: Si `BudgetDepartment` no tiene registros para período, Tabla Desviación muestra badge "Sin presupuesto" sin romper UI; columnas Presupuesto Autorizado = `N/A`.
- **FR-07 Exportación Link**: Footer con link `<a target="_blank">` hacia endpoint API stats para auditoría (igual dashboard/rh footer).

## Non-Functional Requirements (NFR)
- **NFR-01 Rendimiento**: Tiempo First Paint / First Contentful Paint < 1.5s; endpoint `p(95) ≤ 1500ms` en 50 VUs / 5M rows.
- **NFR-02 Seguridad**: Hardening 7-capas endpoint; sin stack traces cliente; SECURITY_HEADERS; correlationId fp32; Zod regex allow-list departamento; IDOR protection `requireApprovedDashboardAccess` scopes companyId.
- **NFR-03 Responsividad**: Mobile (≤640px) 1col charts stacked, tablet (768px) 2col, desktop ≥1280px 4col KPIs + 2col charts + full-width tendencia.
- **NFR-04 Accesibilidad**: ARIA labels gráficas; `role="img"` Recharts; contrast ratio WCAG AA 4.5:1 texto/fondo; keyboard nav Tab por sección.
- **NFR-05 Build/Lint**: `pnpm build` exit 0 sin warnings TS/ESLint; SonarQube: `String.replaceAll` (S6541), helpers responsabilidad única (S4144/S3776), `Readonly` props (S6759), `export...from` (S2324).
- **NFR-06 Escalabilidad**: MV soporta ≥ 10M CFDIs (5 años); `REFRESH CONCURRENTLY` < 5min; Index Only Scan covering KPI queries (Heap Fetches = 0).
- **NFR-07 Disponibilidad**: `stale-while-revalidate` + `stale-if-error` cache headers; fail-soft server page (Card amber "modo seguro" si MV no refrescada).
- **NFR-08 Auditoría**: Todo endpoint loguea `[DIRECCION_STATS_200/400/401/403/500]` fingerprint fp32 para correlación.

## Constraints
- **Técnicas**: Stack obligatorio Next.js 16 App Router / Prisma 6 / PostgreSQL 16 / Zod / Tailwind 4 / shadcn/ui / Recharts 3 / date-fns es-ES. No agregar librerías nuevas (no Chart.js, no D3, no AntD).
- **Hardening**: Endpoints SIEMPRE con triple Rate Limit, Zod strict, RBAC `requireApprovedDashboardAccess(Permission.MODULE_PAYROLL_VIEW)`, SECURITY_HEADERS.
- **ID Regex**: Validación IDs `DRILLDOWN_ID_REGEX = /^[A-Za-z0-9_-]{8,40}$/` donde aplica.
- **Git**: Carpetas `reports/`, `tmp/`, `bin/` EXCLUIDAS permanentemente .gitignore (nunca commitear).
- **CSV UTF-8 BOM**: Si exportación se implementara post-MVP, usar BOM para Excel.
- **Negocio**: Presupuesto Autorizado = entidad opcional; no bloquear MVP si falta tabla presupuestos. Carga Patronal e ISN = paramétricos configurables, no hardcode final.

## Dependencies
- `Prisma Client 6` (tipos `PayrollReceipt, PayrollPercepcion, PayrollReceptor, Company, Member, CustomRole, Permission`).
- `@/lib/auth` (NextAuth v5), `@/lib/permissions` (Permission enum, enrichUserWithMemberships, requireApprovedDashboardAccess).
- `@/lib/rate-limit` (triple rate limit), `@/lib/security` (getRealClientIp, safeErrSummary), `@/lib/monitor-security-helpers` (fp32).
- `@/lib/prisma` (singleton client), `@/lib/org-dashboard-helpers` (SECURITY_HEADERS).
- `date-fns` + `date-fns/locale/es`. Ya existen.
- `lucide-react` icons: Building2, Landmark, UsersRound, TrendingUp, TrendingDown, Target, ArrowUpRight, ArrowDownRight, SlidersHorizontal (Visualización).

## Assumptions
1. Entidad `BudgetDepartment` no existe en schema actual; MVP implementa columna opcional NULL o tabla temporal mock con datos cero si no existe. Post-MVP entidad real con seed.
2. Parámetros Carga Patronal (30.4%) e ISN (2.5% default) se configuran por `Organization.systemSettings JSON`; si no hay dato, usar default hardcodeado con comentario TODO: refactor a settings UI.
3. Cancelados = `Invoice.satStatus = 'CANCELADO'` ya existe relación `PayrollReceipt.invoiceId`; filtro WHERE aplicado en MV para excluir cancelados del costo real.
4. Multi-tenancy: `requireApprovedDashboardAccess` retorna `organizationId` scoped; queries MV siempre filtran `organization_id`.
5. Vista materializada no afecta ETL existente (solo agrega load REFRESH asíncrono post-ETL).
6. DB puerto 5433 `platfi_intelligence_demo` conexión existente via `DATABASE_URL`.
7. Recharts `AreaChart` `connectNulls={true}` para meses sin datos (gap cero).

---

## Acceptance Criteria

### AC-1: Vista Materializada y Datos Coinciden Raw
- **Type**: `rule`
- **Given**: MV `mv_direccion_costo_ejecutivo_mensual` creada, índices UNIQUE + covering creados.
- **When**: Ejecutar `SELECT SUM(costo_total_nomina_mxn) FROM mv WHERE company_id=$1 AND anio=2026 AND mes BETWEEN 1 AND 6` y `SELECT (SUM pr.totalPercepciones × ISN × CargaPatronal) raw query`.
- **Then**: Ambos resultados numéricos coinciden.
- **Pass Condition**: Delta absoluto ≤ `0.05 MXN` (redondeo 2 decimales).
- **Evidence**: Script SQL comparación output guardado.

### AC-2: Rendimiento Endpoint 50 VUs p95 < 1500ms
- **Type**: `rule`
- **Given**: DB staging ≥ 5M CFDIs; endpoint `/api/stats/direccion` publicado.
- **When**: Ejecutar `k6 run tests/performance/direccion-dashboard-load.js` (50 VUs / 60s).
- **Then**: SLA métricas cumplen.
- **Pass Condition**: `http_req_duration p(95) < 1500ms` AND `p(99) < 3000ms` AND `error_rate < 0.1%` AND `checks === 100%`.
- **Evidence**: k6 summary.json thresholds all "ok: true".

### AC-3: UI KPI Cards y Gráficas Renderizan Sin Error
- **Type**: `rule`
- **Given**: Empresa con ≥ 1000 CFDIs en período.
- **When**: Navegar `/dashboard/direccion?companyId=XXX` desde navegador Chrome.
- **Then**: 4 KPIs con valores; AreaChart tendencia (24 meses visible mínimo); PieChart donut + tabla 7 filas variable; Tabla Desviación Presupuestal con 5+ departamentos.
- **Pass Condition**: 0 console error JS; 0 next dev console "Attempted to call from server/client boundary"; todos elementos renderizados ≤ 1.5s.
- **Evidence**: Screenshot del tablero completo (lighthouse LCP).

### AC-4: Seguridad Endpoint (Auth/RBAC/RateLimit)
- **Type**: `rule`
- **Given**: Endpoint publicado.
- **When**: (a) GET sin token cookie → 401; (b) GET con usuario sin `MODULE_PAYROLL_VIEW` → 403; (c) 70 requests/min desde misma IP → 429 RATE_LIMITED_IP; (d) GET `companyId` usuario NO tiene member access → 403 requireApprovedDashboardAccess.
- **Then**: Todos escenarios HTTP status esperado.
- **Pass Condition**: 4/4 tests pass. Response JSON contiene `{ok:false, error:...}`.
- **Evidence**: Postman collection output o curl commands outputs.

### AC-5: Zod Validación Paramétrica Estricta
- **Type**: `rule`
- **Given**: Endpoint.
- **When**: (a) `startDate='A'` → Zod coerce fail; (b) `companyId='INVALID_NOT_CUID'` → Zod fail; (c) `endDate < startDate` → superRefine fail; (d) `rango = 6 años` → >1825 días fail.
- **Then**: Response status 400 `{ok:false, error:'INVALID_PARAMS', issues:...}`.
- **Pass Condition**: 4/4 invalid params retorna 400. Ningún caso pasa filtro a Prisma query.
- **Evidence**: Snippet response JSON + server log `[DIRECCION_STATS_400]`.

### AC-6: Cálculo Fijo vs Variable y Porcentajes
- **Type**: `rule`
- **Given**: KPI % Nómina Variable visible.
- **When**: Sumar (Fijo + Variable) manualmente desde datos brutos período.
- **Then**: `% Variable = Variable / (Fijo + Variable) * 100`; KPI redondeado 1 decimal exacto.
- **Pass Condition**: Delta 0.1% entre calculo manual vs tablero.
- **Evidence**: Spreadsheet muestra fórmula y match.

### AC-7: Responsividad Mobile / Tablet / Desktop
- **Type**: `rubric`
- **Dimension**: Mobile First fidelity y breakpoints.
- **Scale**: 1-5
- **Anchors**: 1 = Desktop-only, charts overflow horizontal mobile, scroll x necesario; 3 = Tablet 768px OK, mobile ≤640px charts pequeños pero legibles; 5 = Mobile ≤640px 1col stacking limpio, KPIs 2×2 grid, charts no overflow, texto legible ≥12px font, touch targets ≥48×48px. Tablet 768px: 2col charts, KPIs 2×2. Desktop XL: KPIs 4col, Tendencia full-width 1col, Composición + Desviación 2col.
- **Pass Threshold**: ≥ 4
- **Evidence**: Screenshots 3 resoluciones (Chrome DevTools device emulator 375px iPad 768px Desktop 1440px).

### AC-8: Cache-Control y SWR Headers
- **Type**: `rule`
- **Given**: Respuesta 200 endpoint.
- **When**: Inspeccionar Response Headers en Network DevTools.
- **Then**: `Cache-Control: public, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600`; `Vercel-CDN-Cache-Control: public`; `CDN-Cache-Control: public`; SECURITY_HEADERS (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Content-Security-Policy default-src 'self').
- **Pass Condition**: Todos headers presentes; valores exactos.
- **Evidence**: Headers captura PNG o curl -i output.

### AC-9: Build y Lint Clean
- **Type**: `rule`
- **Given**: Branch feature/* con todos cambios.
- **When**: Ejecutar `pnpm build` (Next turbopack) y `pnpm lint` (ESLint config actual).
- **Then**: Build exit 0; 0 TS errors `tsc --noEmit`; 0 ESLint errors; 0 warnings "Failed prop type" runtime; SonarQube reglas S6541/S4144/S3776/S6759/S2324 sin new issues.
- **Pass Condition**: 0 build / 0 lint / 0 tsc errors.
- **Evidence**: Build log último bloque `✓ Compiled successfully`.

### AC-10: Auditoría Financiera 12-Puntos Checklist
- **Type**: `rubric`
- **Dimension**: Cobertura y cumplimiento checklist F4-R2.
- **Scale**: 1-5
- **Anchors**: 1 = 3-5 puntos validados; datos no coinciden en KPIs clave; 3 = 7-9 puntos validados; delta ≤ 0.1% en KPIs sensibles (ISR/CargaPatronal); 5 = 12/12 puntos validados PASS; delta 0.00 en Percepciones y Costo Total; muestra sat 30 UUIDs 30/30 match.
- **Pass Threshold**: ≥ 4
- **Evidence**: Archivo `tests/performance/direccion-auditoria-financiera-checklist.md` con 12 filas marcadas PASS/Fail y evidencia por punto.

### AC-11: Suspense y Skeletons Streaming
- **Type**: `rule`
- **Given**: Dev mode Next; Slow 3G Network throttle DevTools.
- **When**: Refresh página `/dashboard/direccion`.
- **Then**: (1) Skeleton KPIs 4 cards visibles ~0-400ms; (2) Tendencia AreaChart skeleton 280px height ~0-700ms; (3) Composición + Desviación skeletons apilados; (4) Skeletons desaparecen progresivamente cuando datos llegan; no FOUC flash un-styled.
- **Pass Condition**: Skeleton classes `animate-pulse` visible en Network waterfall; datos reemplazan sin layout shift ≥ 0.05 CLS.
- **Evidence**: Performance trace Chrome; screenshots middle-streaming.

### AC-12: Sidebar Navigation y Active State
- **Type**: `rule`
- **Given**: Usuario logueado con `MODULE_PAYROLL_VIEW=true`.
- **When**: Sidebar expandido → menú Nómina collapsible → 3 items visibles: (1) Tablero Recursos Humanos `/dashboard/rh`; (2) Tablero Contabilidad y Fiscal `/dashboard/nomina/fiscal`; (3) Tablero RH Directivo `/dashboard/direccion`.
- **Then**: Click item 3 → navega `/dashboard/direccion`; item active `bg-slate-100 text-slate-900`; URL match; breadcrumb correcto.
- **Pass Condition**: 3 items renderizados; active state correcto; navigation sin recarga full-page.
- **Evidence**: Screenshot sidebar + URL bar pathname.

---

## Open Questions (Preguntas Abiertas al Stakeholder)
- [ ] **OP-1 BudgetDepartment**: ¿Implementamos entidad Prisma `BudgetDepartment` real en esta versión, o MVP muestra solo costo real con badge "Sin presupuesto"? Impacto: +1 modelo + seed script + UI upload/carga presupuestos.
- [ ] **OP-2 Paramétricos CargaPatronal/ISN**: ¿Settings UI en `Organization.systemSettings` JSON editable por Admin (nuevo endpoint PUT /api/organization/settings/nomina), o hardcode MVP y UI post-MVP? Impacto: +1 route handler + settings page form.
- [ ] **OP-3 Comparativa Operación**: ¿KPI "Nómina como % de Operación" requiere entidad `OperationalRevenue` (ingresos/gastos operativos mensuales) o placeholder "Pendiente integración ERP"? Impacto: +1 modelo opcional + línea adicional AreaChart.
- [ ] **OP-4 Exportar CSV/PDF**: ¿MVP requiere exportar reporte ejecutivo PDF/CSV (Botón Descarga), o solo vista HTML en este phase? Impacto: +300-500 LOC (jspdf/html2canvas) si PDF.

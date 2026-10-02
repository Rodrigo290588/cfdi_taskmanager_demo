# Tablero RH Directivo (C-Level / Estratégico) — Implementation Plan (Tasks)

---

## FASE 1: Arquitectura de Datos y Persistencia (SQL / Vistas Materializadas)

---

## Task 1: FASE 1a — Vista Materializada `mv_direccion_costo_ejecutivo_mensual` + Índices + Refresh Function
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None (bloquea Tasks 3–9; sin MV no hay datos)
- **Description**:
  1. Crear carpeta `scripts/sql/` si no existe.
  2. Crear script `scripts/sql/YYYYMMDDHHMMSS_mv_direccion_costo_ejecutivo_mensual.sql` con:
     - **DROP / CREATE MV**: `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_direccion_costo_ejecutivo_mensual AS SELECT ...`
       - **CTE `base`**: JOIN `payroll_receipts pr` × `payroll_receptors prre` ON `prre.payroll_receipt_id = pr.id`; LEFT JOIN `invoices inv` ON `pr.invoiceId = inv.id` (filtro `inv.sat_status <> 'CANCELADO'` o `inv.sat_status IS NULL` para SAT no sincronizado).
       - **GROUP BY dense**: `pr.organization_id, pr.company_id, pr.fiscal_entity_id, EXTRACT(YEAR FROM pr.fecha_pago)::INT AS anio, EXTRACT(MONTH FROM pr.fecha_pago)::INT AS mes, COALESCE(prre.departamento, pr.departamento, 'Sin Departamento') AS departamento`.
       - **Columnas calculadas**:
         - `count_recibos = COUNT(DISTINCT pr.id)::INT`
         - `count_empleados_unicos = COUNT(DISTINCT COALESCE(NULLIF(prre.curp,''), NULLIF(prre.num_empleado,''), prre.rfc))::INT`
         - `percepciones_brutas_mxn = COALESCE(SUM(pr.total_percepciones), 0)::NUMERIC(18,6)`
         - `sbc_sumado_mxn = COALESCE(SUM(prre.salario_base_cot_apor * pr.num_dias_pagados), 0)::NUMERIC(18,6)`
         - `carga_patronal_estimada_mxn = (COALESCE(SUM(prre.salario_base_cot_apor * pr.num_dias_pagados), 0) * 0.304)::NUMERIC(18,6)` (param 30.4% = IMSS ~28% + INFONAVIT ~2.4%)
         - `isn_estimado_mxn`: Subquery CASE por `prre.clave_ent_fed` → `'01'=AGS 2.5%, '02'=BC 2%, '03'=BCS 2%, '04'=CAMP 3%, '05'=COAH 2%, '06'=COL 2.5%, '07'=CHIS 2%, '08'=CHIH 2%, '09'=CDMX 3%, '10'=DGO 2%, '11'=GTO 2.5%, '12'=GRO 2%, '13'=HGO 2%, '14'=JAL 2%, '15'=MEX 2%, '16'=MICH 2%, '17'=MOR 2%, '18'=NAY 2%, '19'=NL 2%, '20'=OAX 3%, '21'=PUE 2.5%, '22'=QRO 2%, '23'=QROO 2%, '24'=SLP 2.5%, '25'=SIN 2%, '26'=SON 2%, '27'=TAB 2%, '28'=TAMPS 2%, '29'=TLAX 2%, '30'=VER 2.5%, '31'=YUC 2%, '32'=ZAC 2%, 'NULL'=DEFAULT 2.5%`. Formula: `percepciones_brutas × isn_pct` → `NUMERIC(18,6)`.
         - `costo_total_nomina_mxn = (percepciones_brutas + carga_patronal_estimada + isn_estimado)::NUMERIC(18,6)`
         - `costo_fijo_mxn`: CTE separado JOIN `payroll_percepciones pp WHERE tipo_percepcion='001'`; `SUM(pp.importe_gravado + pp.importe_exento)` por (org,company,fe,anio,mes,depto).
         - `costo_variable_mxn`: Misma CTE `WHERE tipo_percepcion IN ('002','003','019','021','028','038')`; suma gravado+exento.
         - Desglose individual: `sueldos_001, aguinaldo_002, ptu_003, horas_extra_019, prima_vac_021, comisiones_028, bonos_038` (cada una `SUM gravado+exento` FILTER tipo correspondiente).
     - **WITH DATA** al final.
     - **3 Índices Post-Create**:
       1. `CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_direccion_pk ON mv_direccion_costo_ejecutivo_mensual (organization_id, company_id, fiscal_entity_id, anio, mes, departamento);` (requisito REFRESH CONCURRENTLY).
       2. `CREATE INDEX IF NOT EXISTS idx_mv_direccion_company_covering ON mv_direccion_costo_ejecutivo_mensual (company_id, anio DESC, mes DESC) INCLUDE (costo_total_nomina_mxn, percepciones_brutas_mxn, carga_patronal_estimada_mxn, isn_estimado_mxn, costo_fijo_mxn, costo_variable_mxn, count_empleados_unicos, count_recibos, sueldos_001, aguinaldo_002, ptu_003, horas_extra_019, prima_vac_021, comisiones_028, bonos_038, departamento);` → Index Only Scan KPI queries.
       3. `CREATE INDEX IF NOT EXISTS idx_mv_direccion_company_depto ON mv_direccion_costo_ejecutivo_mensual (company_id, departamento, anio DESC, mes DESC);` → queries desviación presupuestal.
     - **Función Helper**: `CREATE OR REPLACE FUNCTION refresh_direccion_materialized_views(IN p_concurrent BOOLEAN DEFAULT FALSE, OUT p_updated_at TIMESTAMPTZ) LANGUAGE plpgsql AS $$ BEGIN IF p_concurrent THEN REFRESH MATERIALIZED VIEW CONCURRENTLY mv_direccion_costo_ejecutivo_mensual; ELSE REFRESH MATERIALIZED VIEW mv_direccion_costo_ejecutivo_mensual; END IF; ANALYZE mv_direccion_costo_ejecutivo_mensual; p_updated_at := NOW(); END; $$;`
     - **Prueba manual**: `SELECT refresh_direccion_materialized_views(p_concurrent => TRUE);` (exit 0).
  3. Validar DDL en DB test puerto 5433 `platfi_intelligence_demo`.
- **Acceptance Criteria Addressed**: AC-1 (delta costo total = 0.05 MXN), NFR-01 (rendimiento Index Only Scan), NFR-06 (escalabilidad 10M rows).
- **Test Requirements**:
  - `rule` TR-1.1: DDL script corre sin errores (`psql -U postgres -p 5433 -d platfi_intelligence_demo -f scripts/sql/XXX_mv_direccion_*.sql` exit 0).
  - `rule` TR-1.2: `\d mv_direccion_costo_ejecutivo_mensual` psql muestra ≥ 22 columnas. `\di idx_mv_direccion_*` muestra 3 índices creados incluyendo UNIQUE.
  - `rule` TR-1.3: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_direccion_costo_ejecutivo_mensual` termina < 3min en ≥500K registros payroll_receipts existentes.
  - `rule` TR-1.4: Conteo filas MV = `COUNT DISTINCT(org,company,fe,anio,mes,depto)` de la raw query. Delta = 0.
  - `rule` TR-1.5: Muestra 10 recibos periodo `2026-01` empresa `X`; `SUM(pr.totalPercepciones)` raw = `SUM(mv.percepciones_brutas_mxn)` MV. Delta ≤ `0.05 MXN`.
  - `rubric` TR-1.6: *EXPLAIN Query KPI*. Ejecutar `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT SUM(costo_total_nomina_mxn) FROM mv_direccion_costo_ejecutivo_mensual WHERE company_id='cuid_test' AND anio=2026 AND mes BETWEEN 1 AND 6;`. Scale 1-5: 1=Seq Scan full MV (Heap Fetches > 10K); 3=Index Scan With Heap Fetch (Include parcial); 5=**Index Only Scan** con `Heap Fetches: 0` y `Index Cond: company_id + anio + mes` exact (prune perfecto). Pass ≥ 5.
- **Notes**: Si `clave_ent_fed` NULL 30%+ registros demo, fallback ISN_DEFAULT 2.5% correctamente aplicado sin error SQL.

---

## Task 1b: FASE 1b — (Opcional) Entidad Prisma `BudgetDepartment` + Índice Único
- **Status**: `pending`
- **Priority**: medium (bloquea solo Task 9 Desviación Presupuestal data; si se cancela Task usa NULL/mensaje)
- **Depends On**: Task 1 (MV creada; datos reales costo por departamento disponibles)
- **Requires User Approval**: Sí (Open Question OP-1 del spec.md)
- **Description**:
  1. Agregar a `prisma/schema.prisma` modelo:
     ```
     model BudgetDepartment {
       id                    String   @id @default(cuid())
       organizationId        String   @map("organization_id")
       companyId             String   @map("company_id")
       departamento          String   @map("departamento")
       anio                  Int      @map("anio")
       mes                   Int      @map("mes")
       presupuestoAutorizado Decimal  @map("presupuesto_autorizado") @db.Decimal(18, 6) @default(0)
       createdAt             DateTime @default(now()) @map("created_at")
       updatedAt             DateTime @updatedAt @map("updated_at")
       organization          Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
       company               Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)

       @@unique([companyId, departamento, anio, mes], map: "budget_dept_unique_period")
       @@index([companyId, anio, mes], map: "budget_dept_period_idx")
       @@map("budget_departments")
     }
     ```
  2. Ejecutar `pnpm prisma migrate dev --name add_budget_department` (crea migration SQL auto).
  3. Crear `scripts/seed-budget-mvp.ts`: 5 departamentos demo ("Administración","Ventas","Operaciones","Finanzas","RH") × 12 meses 2026 × presupuesto autorizado = $1.5M a $5M por mes por departamento (suficiente para UI).
- **Acceptance Criteria Addressed**: FR-06 (presupuestos NULL gracefull si no hay dato), AC-10 (checklist punto desviación presupuestal).
- **Test Requirements**:
  - `rule` TR-1b.1: Modelo compila `pnpm prisma generate` sin warnings.
  - `rule` TR-1b.2: Migration SQL ejecuta exit 0; `\d budget_departments` psql columnas presentes.
  - `rule` TR-1b.3: Seed script exit 0; `SELECT COUNT(*) FROM budget_departments` = 60 filas (5 deptos × 12 meses).
  - `rule` TR-1b.4: Constraint UNIQUE evita duplicados: INSERT dos veces mismo (companyId,depto,anio=2026,mes=1) → error Postgres unique violation (no 500, Prisma P2002 manejado).
- **Notes**: Si Open Question OP-1 = No; cancelar task aprobación usuario → Tabla Desviación Presupuestal muestra "Sin presupuesto autorizado" badge (todas columnas Autorizadas = N/A).

---

## FASE 2: API & Server Components (Next.js App Router)

---

## Task 2: FASE 2a — URL Helpers + Zod Params Schema + Formatters Puros (sin 'use client')
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None (lógica pura; puede paralelizar con Task 1 MV)
- **Description**:
  1. Crear `src/lib/direccion-dashboard-url.ts` con:
     - Type `DireccionSectionId = 'kpis' | 'tendencia_historica' | 'composicion_fijo_variable' | 'desviacion_presupuestal'` (4 secciones).
     - `DIRECCION_SECTIONS: readonly {id:DireccionSectionId, label:string, description:string}[] as const` = `[{id:'kpis',label:'KPIs Ejecutivos'},{id:'tendencia_historica',label:'Tendencia Histórica y YoY'},{id:'composicion_fijo_variable',label:'Composición Fijo/Variable'},{id:'desviacion_presupuestal',label:'Desviación Presupuestal'}]`.
     - `DIRECCION_ALLOW_DEPARTAMENTO = new RegExp('^[A-Za-z0-9 ÑñáéíóúÁÉÍÓÚÜü.,_/-]{1,80}$')` (regex allow-list).
     - Type `DireccionDashboardSearchParams = { companyId?:string|null; organizationId?:string|null; fiscalEntityId?:string|null; startDate?:string|null; endDate?:string|null; departamento?:string|null; anioComparativo?:number|string|null; view?:string|null; sections?:string|null; }`.
     - `parseDireccionSearchParams(raw: DireccionDashboardSearchParams | Record<string, unknown> | URLSearchParams)`: Valida regex departamento; `sections` CSV valida IDs contra `DIRECCION_SECTIONS` (inválidos se dropean silenciosamente); `anioComparativo` entero 2000–2100; fechas YYYY-MM-DD longitud 10.
     - `buildDireccionDashboardUrl(pathname: '/dashboard/direccion'|'/api/stats/direccion', params: Partial<DireccionDashboardSearchParams> & {companyId?:string})`: Omite `sections` si 4/4 (default todas); incluye resto params.
  2. Crear `src/lib/direccion-formatters.ts` helpers puros SIN 'use client':
     - `fmtMxn(n: number|string|Decimal|null|undefined): string` = `new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:0,maximumFractionDigits:0}).format(Number(n ?? 0))` → compacto para KPIs.
     - `fmtMxnFull(n)` = 2 decimales para tablas.
     - `fmtNum(n:number, decimals:number=0): string` = `Intl.NumberFormat('es-MX',{maximumFractionDigits:decimals}).format(Number(n??0))`.
     - `fmtPct(n:number, decimals:number=1): string` = `${fmtNum((Number(n??0))*100, decimals)}%` si n<1 o `${fmtNum(n,decimals)}%` si n≥1.
     - `fmtDateEs(isoDate:string|Date, format:'short'|'month'|'full'='short'): string` = date-fns `format(parseISO(...), 'dd/MM/yyyy' | 'MMM/yy' | 'MMMM yyyy', {locale: es})`.
     - `trendIcon(pct:number): 'up'|'down'|'flat'` = `pct>0.001?'up':pct<-0.001?'down':'flat'`.
     - `trendDeltaPct(actual:number, anterior:number): {direction, pct, deltaAbs}` (si anterior=0 retorna null).
  3. Re-exportar en `src/lib/index.ts` si aplica barril `export * from './direccion-dashboard-url'; export * from './direccion-formatters';` (S2324 SonarQube).
- **Acceptance Criteria Addressed**: FR-03, FR-04, AC-11, NFR-05 (SonarQube S6541/S4144/S6759).
- **Test Requirements**:
  - `rule` TR-2.1: `parseDireccionSearchParams('?sections=kpis,INVALID,desviacion_presupuestal,XSS<img>')` → `sections=['kpis','desviacion_presupuestal']` (drop 2 inválidos).
  - `rule` TR-2.2: `parseDireccionSearchParams('?departamento=<script>alert(1)</script>')` → `departamento=''` o undefined (regex block).
  - `rule` TR-2.3: `buildDireccionDashboardUrl('/dashboard/direccion',{companyId:'cmn_abc',startDate:'2026-01-01',endDate:'2026-08-31',sections:['kpis','tendencia_historica','composicion_fijo_variable','desviacion_presupuestal']})` → URL SIN `?sections=` (omit default todas).
  - `rule` TR-2.4: `fmtMxn(1_250_890.45)` = `$1,250,890` ó `$1,250,890.45` full; `fmtPct(0.184)` = `18.4%`; `fmtDateEs('2026-08-15','month')` = `ago/26`.
  - `rubric` TR-2.5: *Pureza helpers*. Scale 1-5: 1=Importan 'use client' ó window/localStorage; 3=Usan Date global sin pure; 5=100% puros (idempotentes, sin side-effect). Pass ≥ 4.

---

## Task 3: FASE 2b — Service Prisma `payroll-analytics-service` Extensión (Consultas MV + Presupuestos)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (MV SQL definida), Task 2 (tipos params/formatters)
- **Description**:
  1. Agregar a `src/lib/payroll-analytics-service.ts` nuevas funciones (o nuevo archivo `src/lib/direccion-analytics-service.ts` si el primero excede 500 LOC) con exports barril:
     - **Types**: `DireccionCostoMensualRow = {organization_id?:string; company_id:string; fiscal_entity_id?:string; anio:number; mes:number; departamento?:string; count_recibos:number; count_empleados_unicos:number; percepciones_brutas_mxn:number; sbc_sumado_mxn:number; carga_patronal_estimada_mxn:number; isn_estimado_mxn:number; costo_total_nomina_mxn:number; costo_fijo_mxn:number; costo_variable_mxn:number; sueldos_001:number; aguinaldo_002:number; ptu_003:number; horas_extra_019:number; prima_vac_021:number; comisiones_028:number; bonos_038:number}`.
     - Type `DireccionBudgetRow = {departamento:string; presupuesto_autorizado:number; costo_real_ejecutado:number; desviacion_abs:number; desviacion_pct:number; status_badge:'EN_LINEA'|'ATENCION'|'FUERA_DE_PRESUPUESTO'}`.
     - Function `setParallelWorkersDireccion(prisma: PrismaClient)`: wrapper `SET LOCAL max_parallel_workers_per_gather = 4; parallel_setup_cost = 0; parallel_tuple_cost = 0`.
     - Function `fetchDireccionKpisAggregates({companyId, fiscalEntityId, startDate, endDate, departamento}): Promise<{costoTotalNominaMxn:number; percepcionesBrutas:number; cargaPatronalEstimada:number; isnEstimado:number; costoFijo:number; costoVariable:number; empleadosUnicos:number; countRecibos:number; desgloseFijoVariable:{sueldos001,aguinaldo002,ptu003,horasExtra019,primaVac021,comisiones028,bonos038}[]}>`:
       - Deriva `(sY,sM) = startYear,startMonth` y `(eY,eM)`.
       - `SELECT SUM(costo_total_nomina_mxn) etc FROM mv_direccion_costo_ejecutivo_mensual WHERE company_id=$1 AND (anio,mes) >= ROW($2,$3) AND (anio,mes) <= ROW($4,$5) AND ($6::text IS NULL OR departamento = $6) AND ($7::text IS NULL OR fiscal_entity_id = $7)` → row-values prune.
     - Function `fetchDireccionTendenciaHistorica({companyId, startDate, endDate, anioComparativo, view='monthly'}): Promise<{anio:number; mes:number; mesLabel:string; costoActual:number; costoYoY:number|null; diffAbsYoY:number|null; diffPctYoY:number|null}[]>`:
       - Query MV rows período actual; período YoY = mismo rango `anioComparativo = startDate.year - 1` default.
       - VIEW = 'quarterly': GROUP BY (anio, CEIL(mes/3) AS quarter); VIEW='yearly': GROUP BY anio.
     - Function `fetchDireccionDesviacionPresupuestal({companyId, startDate, endDate, departamento, anio, mes}): Promise<DireccionBudgetRow[]>`:
       - LEFT JOIN `mv_direccion_costo_ejecutivo_mensual mv` × `budget_departments bd` ON `mv.company_id=bd.company_id AND mv.departamento=bd.departamento AND mv.anio=bd.anio AND mv.mes=bd.mes`.
       - Agrupa por departamento; `costo_real = SUM(mv.costo_total_nomina_mxn)`; `presupuesto = SUM(bd.presupuesto_autorizado)`; `desviacion = real - presupuesto`; `pct = IF(presupuesto>0, desviacion/presupuesto, 0)`.
       - Status badge: `abs(pct)<=0.05 → EN_LINEA; >0.05 <=0.10 → ATENCION; >0.10 → FUERA_DE_PRESUPUESTO`.
- **Acceptance Criteria Addressed**: AC-1 (delta match), AC-6 (pct variable exacto), NFR-01 (row-values prune).
- **Test Requirements**:
  - `rule` TR-3.1: `setParallelWorkersDireccion(prisma)` ejecuta exit 0; query posterior log Postgres `max_parallel_workers_per_gather=4` en `SHOW max_parallel_workers_per_gather` durante transacción.
  - `rule` TR-3.2: `fetchDireccionKpisAggregates` empresa demo período `2026-01-01..2026-06-30`. Resultado `costoTotalNominaMxn = percepcionesBrutas + cargaPatronalEstimada + isnEstimado` → delta ≤ 0.01 MXN.
  - `rule` TR-3.3: `fetchDireccionTendenciaHistorica` view='monthly' retorna 24 filas (12 actual + 12 YoY) o menos si faltan datos históricos; view='quarterly' retorna 8 filas (4 actual + 4 YoY).
  - `rule` TR-3.4: `fetchDireccionDesviacionPresupuestal` con BudgetDepartment seed 60 filas: fila "Ventas" enero `costo_real` = MV suma enero; `presupuesto` = seed value; `pct = (real-autorizado)/autorizado` exacto 2 decimales.
  - `rubric` TR-3.5: *Clean helpers*. Scale 1-5: 1=Functions >200LOC monolíticas; 3=Funciones separadas sin shared types; 5=SRP (una función un agregado), tipos definidos con Readonly, sin duplicación. Pass ≥ 4.
- **Notes**: S6541 SonarQube: Usar `String.replaceAll()` en vez de regex `/g` cuando aplica.

---

## Task 4: FASE 2c — Route Handler `/api/stats/direccion/route.ts` (Hardening 7 Capas)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (MV), Task 2 (Zod/URL helpers), Task 3 (analytics service)
- **Description**:
  1. Crear `src/app/api/stats/direccion/route.ts` (~140–200 LOC máx). Top exports:
     ```ts
     export const runtime = 'nodejs';
     export const dynamic = 'force-dynamic';
     export const maxDuration = 30;
     export const revalidate = 0;
     ```
  2. Imports: `NextRequest/NextResponse`, `auth()`, `prisma`, `SystemRole`, `Permission/enrichUserWithMemberships/hasPermission/requireApprovedDashboardAccess`, `rateLimit`, `getRealClientIp/safeErrSummary`, `SECURITY_HEADERS`, `fp32`, `z`, `setParallelWorkersDireccion/fetchDireccionKpisAggregates/fetchDireccionTendenciaHistorica/fetchDireccionDesviacionPresupuestal`, `DIRECCION_ALLOW_DEPARTAMENTO` regex.
  3. **Zod Schema**:
     ```ts
     const DireccionStatsParams = z.object({
       companyId: z.string().cuid().min(1),
       organizationId: z.string().cuid().nullable().optional(),
       fiscalEntityId: z.string().cuid().nullable().optional(),
       startDate: z.coerce.date(),
       endDate: z.coerce.date(),
       departamento: z.string().regex(DIRECCION_ALLOW_DEPARTAMENTO).max(80).nullable().optional(),
       anioComparativo: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
       view: z.enum(['monthly','quarterly','yearly']).default('monthly').optional(),
     }).superRefine((v,c) => { if (v.endDate < v.startDate) c.addIssue({...}); const diffDays = (v.endDate - v.startDate)/86_400_000; if (diffDays > 366*5) c.addIssue({...}); });
     ```
  4. **Handler GET**:
     - **Capa 1 RL-IP**: `rateLimit(direccion-stats-ip:$ip, 60/min)` → 429 RATE_LIMITED_IP con Retry-After header.
     - **Capa 2 Auth**: `auth()` → 401 UNAUTHENTICATED.
     - **Capa 3 RL-User**: `rateLimit(direccion-stats-user:$userId, 30/min)` → 429 RATE_LIMITED_USER.
     - **Capa 4 Zod**: `safeParse` → 400 INVALID_PARAMS con `issues: flatten()`.
     - **Capa 5 RBAC**: `enrichUserWithMemberships` → `hasPermission(MODULE_PAYROLL_VIEW)` → 403 FORBIDDEN_PAYROLL_VIEW. `requireApprovedDashboardAccess` → ctx scoped.
     - **Capa 6 RL-Org**: `rateLimit(direccion-stats-org:$ctx.organizationId, 180/min)` → 429 RATE_LIMITED_ORG.
     - **Capa 7 Parallel + Row-Values**: `await setParallelWorkersDireccion(prisma)`. Ejecuta 3 queries paralelo `Promise.all`:
       - (a) `kpis = fetchDireccionKpisAggregates`
       - (b) `tendencia = fetchDireccionTendenciaHistorica`
       - (c) `desviacionDepto = fetchDireccionDesviacionPresupuestal`
       - Computa **KPI Cards aggregates finales**: `costoPromedioEmpleado = kpis.empleadosUnicos > 0 ? (kpis.costoTotalNominaMxn / kpis.empleadosUnicos) : 0`; `pctNominaVariable = (kpis.costoFijo+kpis.costoVariable) > 0 ? (kpis.costoVariable / (kpis.costoFijo+kpis.costoVariable)) : 0`; `desviacionGlobal = SUM desviacionDepto total`.
  5. **Response 200 JSON**: `{ ok:true, generatedAt:new Date().toISOString(), scope:{organizationId, companyId, fiscalEntityId:safeFiscalEntityId, memberRole, filters:{...}}, kpis:{costoTotalNominaMxn, percepcionesBrutas, cargaPatronalEstimada, isnEstimado, costoPromedioEmpleado, pctNominaVariable, empleadosUnicos, countRecibos, desviacionPresupuestalGlobal}, tendenciaHistorica:[...], composicionFijoVariable:{costoFijo, costoVariable, pctFijo, pctVariable, desgloseFijoVariable:[...]}, desviacionPorDepartamento:[...] }`.
  6. **Response Headers**: `Cache-Control: public, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600` + `CDN-Cache-Control: public` + `Vercel-CDN-Cache-Control: public` + `SECURITY_HEADERS` (X-Frame, X-Content-Type, Referrer-Policy, Permissions-Policy, CSP default-src 'self').
  7. **Catch 500**: `fp32` fingerprint `{msg, stack[0:256], t}` → console.error `[DIRECCION_STATS_500] {fp, summary}`. Mapeo nombres FORBIDDEN/MISSING/Zod/INVALID_ a 400/403. Retorna `{ok:false, error, correlationId, helpText}`.
- **Acceptance Criteria Addressed**: AC-4, AC-5, AC-8, FR-07, NFR-01 (rendimiento), NFR-02 (seguridad 7 capas).
- **Test Requirements**:
  - `rule` TR-4.1: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/stats/direccion?companyId=INVALID_NOT_CUID` → 400. Body `{"ok":false,"error":"INVALID_PARAMS"}`.
  - `rule` TR-4.2: Sin cookie auth → 401 UNAUTHENTICATED. User sin permiso MODULE_PAYROLL_VIEW → 403 FORBIDDEN_PAYROLL_VIEW.
  - `rule` TR-4.3: 65 requests/min 1 IP última request → 429 header `Retry-After` presente.
  - `rule` TR-4.4: Response headers = `cache-control: public, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600` (case-insensitive). `vercel-cdn-cache-control` = `public`.
  - `rule` TR-4.5: `kpis.costoTotalNominaMxn == kpis.percepcionesBrutas + kpis.cargaPatronalEstimada + kpis.isnEstimado` (asserción JS delta ≤ 0.05).
  - `rule` TR-4.6: Handler source `grep -iE "OFFSET"` → 0 resultados (ninguna paginación OFFSET; keyset implícito por rango anio/mes).
  - `rubric` TR-4.7: *Handler Size y Clean Code*. Scale 1-5: 1= >300LOC sin helpers; 3= 200-250LOC helpers parciales; 5= 150-200LOC handlers SRP, helpers externalizados en analytics-service. Pass ≥ 4.

---

## Task 5: FASE 2d — Server Page Entry `app/dashboard/direccion/page.tsx` + Slot Pattern (Server/Client Wrapper)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2 (URL/formatters), Task 4 (endpoint opcional; server usa Prisma directa)
- **Description**:
  1. Crear `src/app/dashboard/direccion/page.tsx` (`export const dynamic='force-dynamic'`).
     - **Promise searchParams Next 16**: `export default async function DireccionPage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) { const sp = await searchParams; const initialFilters = parseDireccionSearchParams(sp); return <DireccionClientPage initialFilters={initialFilters}><DireccionServerPage initialFilters={initialFilters} /></DireccionClientPage>; }`
  2. Crear `src/app/dashboard/direccion/direccion-server-page.tsx` (Server Component 100% async; sin 'use client'):
     - Función `resolveFilters` default dates: `defaultStartIso = formatISO(subMonths(startOfMonth(today), 12), {representation:'date'})` (12 meses atrás); `defaultEndIso = formatISO(endOfMonth(today), {representation:'date'})`.
     - `_resolveFiltersAndSafeBar` = mismo patrón fiscal-nomina-server-page: validar fechas, companyId, sections (drop invalidos), hasCompany boolean.
     - `_resolveCompanyDisplay(hasCompany, companyId)` = `prisma.company.findUnique({select:{rfc,businessName,name}})` → span top.
     - Layout JSX:
       ```
       <ProtectedRoute>
         <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
           {/* ROW 1 */}
           <div className="flex items-center justify-between space-y-2">
             <div>
               <h1 className="text-3xl font-bold tracking-tight">Tablero RH Directivo</h1>
               <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                 <span>Período dd/MM/yyyy — dd/MM/yyyy</span>
                 <span>·</span>
                 <span>Vista Mensual/Trimestral/Anual</span>
                 <span>·</span>
                 <span>{sections.length}/4 secciones</span>
               </div>
             </div>
             <div className="flex items-center space-x-2">
               <span className="text-sm text-muted-foreground">RFC · Nombre Empresa</span>
             </div>
           </div>
           {/* ROW 2 FILTROS */}
           <div className="flex flex-col sm:flex-row gap-4 py-4 items-end">
             <DireccionFilterBar filters={safeFiltersForFilterBar} />
           </div>
           {/* SIN EMPRESA */}
           {!hasCompany ? <Card>...</Card> : (
             <>
               {/* ROW 3 KPIs lg:grid-cols-4 */}
               {sections.includes('kpis') && <Suspense fallback={<DireccionKpiGridSkeleton />}><DireccionKpisSection filters={resolved} /></Suspense>}
               {/* ROW 4 TENDENCIA FULL WIDTH */}
               {sections.includes('tendencia_historica') && <Suspense fallback={<ChartPlaceholder label="Tendencia Histórica y YoY" />}><DireccionTendenciaSection filters={resolved} /></Suspense>}
               {/* ROW 5 COMPOSICION + DESVIACION 2cols lg */}
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                 {sections.includes('composicion_fijo_variable') && <Suspense fallback={<ChartPlaceholder label="Composición Fijo / Variable" />}><DireccionComposicionSection filters={resolved} /></Suspense>}
                 {sections.includes('desviacion_presupuestal') && <Suspense fallback={<DesviacionPresupuestalSkeleton />}><DireccionDesviacionSection filters={resolved} /></Suspense>}
               </div>
               {/* FOOTER LINK API */}
               <footer className="pt-4 text-xs text-slate-500 border-t border-slate-200">
                 <a href={buildDireccionDashboardUrl('/api/stats/direccion', resolved)} target="_blank" rel="noreferrer" className="underline hover:text-blue-600">Auditar datos JSON endpoint</a>
               </footer>
             </>
           )}
         </div>
       </ProtectedRoute>
       ```
     - Funciones async por sección dentro del mismo archivo: `DireccionKpisSection`, `DireccionTendenciaSection`, `DireccionComposicionSection`, `DireccionDesviacionSection` (Server Components que llaman `fetchDireccionKpisAggregates` etc. directamente; reutilizan datos del servicio).
     - **Fail Soft**: Try/catch por sub-sección. Error = `<Card border-amber-200 bg-amber-50>Modo seguro: KPI Tendencia no disponible.</Card>` (sin crash 500 completo).
  3. Crear `src/app/dashboard/direccion/direccion-client-page.tsx` ('use client' wrapper):
     - Mismo patrón `rh-client-page.tsx` / `fiscal-nomina-client-page.tsx`:
       - `useEffect` on mount → `populateFromStorage({force:true})`: lee `localStorage.getItem('selectedCompanyId')`, si existe y URL sin `?companyId=` → `router.replace(buildDireccionDashboardUrl('/dashboard/direccion', {preservar startDate,endDate,departamento,anioComparativo,view,sections,companyId: stored}))`.
       - `window.addEventListener('company-selected', handler)`: sidebar dispara evento `CustomEvent('company-selected',{detail:{companyId}})` → router.replace preservando params.
       - Renderiza `{children}` (slot Server Component).
- **Acceptance Criteria Addressed**: AC-3 (UI render), AC-11 (Suspense/Skeletons streaming), FR-02 (auto empresa), FR-05 (span sync), NFR-07 (fail-soft amber).
- **Test Requirements**:
  - `rule` TR-5.1: `pnpm build` route list incluye `/dashboard/direccion` (GET 200).
  - `rule` TR-5.2: Sin `?companyId=` y `localStorage.selectedCompanyId = 'cuid_empresa_valida'` → `router.replace` < 1s ejecutado; URL final contiene `?companyId=cuid_empresa_valida`.
  - `rule` TR-5.3: DevTools Console Next: 0 warnings "Attempted to call XXX from server but XXX is client-only". 0 hydration mismatch warnings.
  - `rule` TR-5.4: Chrome DevTools Performance 4x Slowdown + Suspense boundary visible: Skeleton classes `animate-pulse` renderizan durante ≥50ms antes de reemplazar con datos reales. No Cumulative Layout Shift > 0.05.
  - `rubric` TR-5.5: *Server/Client Boundary Claridad*. Scale 1-5: 1=Server usa 'use client' components con useState; 3=Slot pattern pero Suspense boundaries no por sección; 5=100% estricto: Server 100% sin 'use client', Client wrapper solo router/storage/event listeners, 4 secciones con Suspense individual + skeleton fail-soft. Pass ≥ 4.
- **Notes**: Si archivo supera 500 LOC, separar sub-sections a `_components/direccion-kpis-section.tsx` etc. (Server Components separados).

---

## FASE 3: Componentes UI Responsivos (Tailwind 4 + shadcn/ui + Recharts 3)

---

## Task 6: FASE 3a — `DireccionFilterBar` (Filtros Permanentes + Dropdown Visualización)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2 (parse/build URL), Task 5 (Server page recibe el filter bar en layout)
- **Description**:
  1. Crear `src/app/dashboard/direccion/_components/direccion-filter-bar.tsx` ('use client').
  2. React Hook Form + Zod `direccionFilterSchema = z.object({ startDate: z.coerce.date, endDate: z.coerce.date, departamento: z.string().regex(DIRECCION_ALLOW_DEPARTAMENTO).max(80).nullable().optional(), anioComparativo: z.coerce.number().int().min(2000).max(2100).nullable().optional(), view: z.enum(['monthly','quarterly','yearly']).default('monthly') })`.
  3. Layout form grid `gap-3 items-end` sm:flex-row:
     - Input Date `Fecha Inicio` (default -12 meses)
     - Input Date `Fecha Fin` (default hoy endOfMonth)
     - Input Text `Departamento` (opcional placeholder 'Todos los departamentos')
     - Select/Combobox shadcn `Año Comparativo (YoY)`: options [año_anterior, año_anterior-1, año_anterior-2] + placeholder 'Año anterior'
     - Select shadcn `Vista`: `Mensual / Trimestral / Anual` → enum view
     - Dropdown `Visualización` (SlidersHorizontal icon): `DropdownMenuCheckboxItem` × 4 secciones (KPI Ejecutivos, Tendencia, Composición, Desviación) + items `Mostrar todas / Ocultar todas`.
     - Botones finales gap-2: `Search icon Botón Filtrar` (submit form), `RefreshCw icon Botón Restablecer outline-sm`.
  4. On submit válido: `router.replace(buildDireccionDashboardUrl('/dashboard/direccion', {...current, ...formValues, sections: checkedSectionIds}))`.
  5. On Restablecer: `router.replace('/dashboard/direccion?companyId=XXX')` (drop filtros).
- **Acceptance Criteria Addressed**: FR-03, FR-04, NFR-03 (responsive).
- **Test Requirements**:
  - `rule` TR-6.1: Cambiar fecha inicio a `2026-01-01` fin `2026-06-30` click Filtrar → URL actualizado `?startDate=2026-01-01&endDate=2026-06-30`; sin refresh full-page (SPA).
  - `rule` TR-6.2: Dropdown Visualización des-check "Tendencia Histórica" y "Desviación Presupuestal" → URL `?sections=kpis,composicion_fijo_variable`; 2 secciones visibles solo.
  - `rule` TR-6.3: Input departamento valor `Finanzas*&copy;` → regex bloquea; Zod error message "Departamento contiene caracteres inválidos" visible.
  - `rule` TR-6.4: Mobile 375px: filtros stackeados 1col; inputs ancho full; touch targets altura ≥48px sin overlap botones.
- **Notes**: Readonly props componentes = `type DireccionFilterBarProps = Readonly<{filters: ...}>` (SonarQube S6759).

---

## Task 7: FASE 3b — KPI Cards Ejecutivas (4 Cards + Tones + Trend Indicators)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (kpis aggregates), Task 2 (formatters), Task 5 (Server KPI section)
- **Description**:
  1. Crear `src/app/dashboard/direccion/_components/direccion-kpis-section.tsx` (Server Component export async `DireccionKpisSection`).
     - Dentro: fetch aggregates `fetchDireccionKpisAggregates`; periodo anterior = misma duración -12 meses (YoY base) usando misma función startDate anterior.
     - Cálculo tendencias: `trendCostoTotal = trendDeltaPct(actual.costoTotal, anterior.costoTotal)`.
  2. Crear `_components/direccion-shared.tsx` (o reusar rh-shared si aplica) → `KpiCardDireccion` ('use client' small wrapper):
     - Props: `title, value: string, subtext?: string, icon: ReactNode, tone: 'slate'|'blue'|'amber'|'emerald'|'rose', trendDirection?:'up'|'down'|'flat', trendDelta?: string|null, trendLabel?: string|null`.
     - JSX: `<Card className="relative overflow-hidden"><div className="absolute inset-x-0 top-0 h-1.5 bg-TONE-500" /><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-5"><div><CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{title}</CardTitle></div><div className="h-10 w-10 rounded-full bg-TONE-50 flex items-center justify-center">{icon}</div></CardHeader><CardContent className="pb-5 pt-1"><div className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">{value}</div>{subtext && <div className="text-xs text-muted-foreground mt-1">{subtext}</div>}{trendDelta && <div className="flex items-center gap-1 mt-2 text-xs"><ArrowUpRight/DownRight/Minus className="h-3 w-3 text-TONE-600" /><span className="text-TONE-700 font-medium">{trendDelta}</span>{trendLabel && <span className="text-muted-foreground">· {trendLabel}</span>}</div>}</CardContent></Card>`.
  3. 4 KPI Cards order:
     | # | Título | Tone | Icon | Value | Trend |
     |-|-|-|-|-|-|
     | 1 | Costo Total de Nómina | slate-900 | Landmark | `fmtMxn(costoTotal)` | Δ YoY % vs año anterior |
     | 2 | Costo Promedio / Empleado | blue-700 | UsersRound | `fmtMxn(costoPromedioEmpleado)` | Sub `fmtNum(empleados) headcount` + Δ costo/empleado YoY |
     | 3 | % Nómina Variable | amber-600 | PieChart | `fmtPct(pctVariable)` | Sub Fijo `fmtMxn(costoFijo)` · Variable `fmtMxn(costoVariable)` + Δ vs benchmark 20% ref |
     | 4 | Desviación Presupuestal Global | emerald ó rose según | Target | `fmtPct(desviacionPct)` + `+/- fmtMxn(desviacionAbs)` | Sub `Autorizado fmtMxn` · `Ejecutado fmtMxn` + Badge `Dentro Presupuesto / Fuera` |
  4. Grid wrapper: `<div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">`.
- **Acceptance Criteria Addressed**: AC-3, AC-6, NFR-03 (grid breakpoints).
- **Test Requirements**:
  - `rule` TR-7.1: Desktop 1440px: 4 cards en fila; 768px tablet: 3 cols; 640px mobile: 2 cols (no overflow).
  - `rule` TR-7.2: Costo Total = Percep + CargaPatronal + ISN → `fmtMxn` correcto; coincidencia exacta valor numérico.
  - `rule` TR-7.3: % Variable = variable / (fijo+variable) × 100 → redondeo 1 decimal exacto contra calculo spreadsheet.
  - `rule` TR-7.4: Tooltip shadcn `TooltipProvider` → hover KPI Costo Total muestra tooltip "Incluye Percepciones Brutas (SAT TotalPercepciones) + Carga Patronal estimada (30.4% IMSS/Infonavit sobre SBC×Días) + ISN estatal paramétrico".
  - `rubric` TR-7.5: *Accesibilidad*. Scale 1-5: 1=Sin aria labels; 3= aria-label básico; 5= role="region" aria-labelledby="kpi-costo-total-title" por card, contrast ratio texto principal/fondo ≥ WCAG AA 4.5:1 (slate-900 sobre blanco = ok), keyboard focus ring visible en tabulación. Pass ≥ 4.

---

## Task 8: FASE 3c — Gráfica Tendencia Histórica AreaChart Full-Width + Toggle Vista
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (fetch tendencia), Task 2 (formatters), Task 5 (Server Tendencia section)
- **Description**:
  1. Crear `_components/direccion-tendencia-chart.tsx` ('use client' Recharts wrapper).
     - Props Readonly: `rows: ReadonlyArray<{mesLabel:string; costoActual:number; costoYoY:number|null}>; view: 'monthly'|'quarterly'|'yearly'`.
     - Paleta colores: Actual `#1e3a8a` (blue-900) area fill `#1e3a8a33` opacity; YoY `#94a3b8` (slate-400) línea dashed strokeDasharray "5 5".
     - `ResponsiveContainer width="100%" minHeight={380} maxHeight={480}`.
     - Ejes: `XAxis dataKey="mesLabel" tick={{fontSize:11}}`; `YAxis tickFormatter={v => fmtMxn(v)}`; `Tooltip content={<CustomTooltipDireccion />}` customizado muestra Mes · Actual `$1.2M` · YoY (año X) `$1.0M` · Diff `$200K (+20%)`.
     - `Legend wrapperStyle={{fontSize:12}} items={[{value:'Costo Período Actual', type:'rect', color:'#1e3a8a'},{value:'Comparativo YoY', type:'line', color:'#94a3b8'}]}`.
     - `AreaChart connectNulls`; `CartesianGrid strokeDasharray "3 3" opacity 0.3`.
  2. Toggle Vista (Mensual/Trimestral/Anual) sobre CardHeader `shadcn Tabs` o `SegmentedControl shadcn-like` (3 botones outline-sm). Sync con `view` query param; cambiar vista = `router.replace` actualizando view sin romper filtros.
  3. Server wrapper `DireccionTendenciaSection` en `direccion-server-page.tsx`: pasa `rows` a componente client.
- **Acceptance Criteria Addressed**: AC-3 (render chart), NFR-03 (responsive).
- **Test Requirements**:
  - `rule` TR-8.1: Mobile 375px: YAxis oculta tick labels largos; XAxis rota 45°; scroll horizontal NUNCA (ResponsiveContainer ajusta).
  - `rule` TR-8.2: Toggle "Trimestral" → URL `?view=quarterly`; datos agrupados 4 quarters por año visible; línea actual 4 puntos; YoY 4 puntos.
  - `rule` TR-8.3: Tooltip hover punto "Ene 26" → valores correctos: `costoActual` = enero 2026 MV; `costoYoY` = enero 2025 MV si dato; si faltara dato = "Sin dato YoY".
  - `rubric` TR-8.4: *Chart UX & Performance*. Scale 1-5: 1=Re-renderiza en cada mouse move, lag 200ms+ hover; 3=Tooltip OK pero default legend/tick styles feos; 5=Animación suave enter (animate=true duration 300), colores corporate, tooltip custom sin lag, resize window 1280→768→375 sin overflow ni layout shift. Pass ≥ 4.

---

## Task 9: FASE 3d — Composición Fijo vs Variable (PieChart Donut) + Tabla Desglose 7 Rubros
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (desglose fijo/variable), Task 7 (KpiCardDireccion reusar), Task 5 (Server section)
- **Description**:
  1. Crear `_components/direccion-composicion-fv.tsx` ('use client').
     - **Desktop**: `PieChart` donut outerRadius=120 innerRadius=80 width="100%" height={320}. 2 Cells: Fijo `#1e293b` (slate-800), Variable `#f59e0b` (amber-500). Centro `<text x="50%" y="50%" textAnchor="middle" className="fill-slate-900 font-bold text-xl">` → `{pctVariable}`.
     - **Mobile < 768px**: `BarChart horizontal stacked` (1 fila, 2 segmentos) para legibilidad (media query CSS).
     - Leyenda derecha detallada: `<div className="space-y-1 text-sm">` → 2 filas: `Costo Fijo · fmtMxn(costoFijo) · fmtPct(pctFijo)` (dot slate-800); `Costo Variable · fmtMxn(costoVariable) · fmtPct(pctVariable)` (dot amber-500).
  2. Tabla desglose bajo el gráfico (dentro mismo Card shadcn `<Card>` bajo `<CardContent>`):
     - Columnas: `Concepto SAT · Código Tipo · Importe MXN · % Costo Total · Tendencia`
     - 7 filas: (1) Sueldos Base 001 · (2) Aguinaldo 002 · (3) PTU 003 · (4) Horas Extra 019 · (5) Prima Vacacional 021 · (6) Comisiones 028 · (7) Bonos de Productividad 038.
     - Filas orden descendente por `importe_mxn` (Sueldos siempre primero; luego variables por monto).
     - % Total = `importe / (fijo+variable) * 100`; barra progress `<div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{width: pct}}/>`
     - Trend: flecha up/down vs mismo período YoY si dato disponible.
- **Acceptance Criteria Addressed**: AC-6 (pct exacto), F3-R4 prompt.
- **Test Requirements**:
  - `rule` TR-9.1: Suma tabla 7 filas `Importe` = `Costo Fijo + Costo Variable` KPI Card 3; delta ≤ 0.05 MXN.
  - `rule` TR-9.2: Donut centro `% Variable` igual al KPI Card 3 valor; delta ≤ 0.1%.
  - `rule` TR-9.3: Mobile ≤640px: PieChart reemplazado por BarChart stacked horizontal (no donut pequeña ilegible).
  - `rule` TR-9.4: Row hover highlight; Tooltip "Código SAT TipoPercepcion 001 = Sueldos y Salarios (catálogo oficial SAT Anexo 8)".

---

## Task 10: FASE 3e — Tabla Desviación Presupuestal por Departamento + Badges Status
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (fetch desviación), Task 1b (BudgetDepartment si aprobado), Task 5 (Server section)
- **Description**:
  1. Crear `_components/direccion-desviacion-presupuestal.tsx` ('use client').
     - Card shadcn con `CardHeader` título `<div className="flex items-center justify-between"><div><CardTitle>Desviación Presupuestal por Departamento</CardTitle><CardDescription>Ejecutado real vs Presupuesto autorizado período</CardDescription></div>{hasPresupuestos && <Badge variant="outline" className="text-xs">{deptos.length} departamentos</Badge>}</div>`.
     - Alerta shadcn si `BudgetDepartment` sin registros período: `<Alert variant="default" className="mb-3"><AlertCircle className="h-4 w-4" /><AlertTitle>Sin presupuesto autorizado cargado</AlertTitle><AlertDescription>Mostrando solo costo real ejecutado por departamento. Columna Presupuesto = N/A. Contacta Finanzas para cargar el presupuesto del período.</AlertDescription></Alert>`.
     - Tabla shadcn columns:
       | Columna | Componente |
       |-|-|
       | Departamento | `<span className="font-medium text-slate-900">{depto}</span>` |
       | Presupuesto Autorizado | `hasPresupuestos ? fmtMxnFull(autorizado) : <span className="text-slate-400 italic">N/A</span>` |
       | Costo Real Ejecutado | `fmtMxnFull(real)` |
       | Desviación Abs | `fmtMxnFull(diff)` color rose si diff>0, emerald si diff≤0 |
       | Desviación % | `fmtPct(pct,1)` mismo color |
       | Status | Badge: `EN_LINEA` Emerald variant="outline" ; `ATENCION` Amber ; `FUERA_DE_PRESUPUESTO` Rose variant="destructive" |
     - Filas orden `ORDER BY ABS(desviacion_pct) DESC` (peores desviaciones arriba).
     - Row className condicional: `FUERA_DE_PRESUPUESTO` → `bg-rose-50/60 hover:bg-rose-50`.
     - Tabla pie: `ScrollArea shadcn` vertical; sticky thead `bg-white sticky top-0`.
- **Acceptance Criteria Addressed**: FR-06, F3-R5 prompt.
- **Test Requirements**:
  - `rule` TR-10.1: 5 departamentos seed; "Ventas" enero `autorizado=$2M` y `real=$2,250,000` → Desviación `+$250,000` / `+12.5%` → Badge `FUERA_DE_PRESUPUESTO` rose-destructive. Row bg-rose-50.
  - `rule` TR-10.2: Task 1b cancelada (BudgetDepartment = N/A) → `<Alert>` SIN presupuesto visible; columna Autorizada todo `N/A italic`; no JS errors undefined.
  - `rule` TR-10.3: Ordenar 5 filas: top 1 peor desviación (abs pct) → fila 1 correcta.
  - `rubric` TR-10.4: *Data Density & UX*. Scale 1-5: 1=Columnas anchas, solo 3 visibles móvil; 3=Scroll horizontal OK pero sin sticky header; 5=sticky header, badges colores semaforo consistente, hover info tooltips, móvil 375px 4 cols + colapsada Status, compact padding 12px rows. Pass ≥ 4.

---

## Task 11: FASE 3f — Sidebar Navigation Item (Nómina → 3er Hijo "Tablero RH Directivo")
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 5 (ruta `/dashboard/direccion` existe)
- **Description**:
  1. Encontrar `src/components/sidebar.tsx` o donde se define menú Nómina collapsible (grep patterns existentes `Tablero Recursos Humanos / Tablero Contabilidad y Fiscal`).
  2. Agregar 3er item dentro `<Collapsible trigger="Nómina" icon="Briefcase">`:
     ```tsx
     <SidebarLink
       href="/dashboard/direccion"
       icon={<Building2 className="h-4 w-4 mr-2" />}
       label="Tablero RH Directivo"
       activeMatchers={['/dashboard/direccion']}
       permissionGuard={Permission.MODULE_PAYROLL_VIEW}
     />
     ```
  3. Asegurar active state: `pathname === '/dashboard/direccion'` → link `bg-slate-100 text-slate-900 font-medium` (mismo pattern que los otros 2).
  4. Breadcrumb: Agregar entrada `Dashboard > Nómina > Tablero RH Directivo` si aplicación tiene `<Breadcrumb shadcn>` componente.
- **Acceptance Criteria Addressed**: FR-01, AC-12.
- **Test Requirements**:
  - `rule` TR-11.1: Sidebar expandido, usuario con `MODULE_PAYROLL_VIEW=true` → 3 links hijos visibles: RH, Contabilidad/Fiscal, Directivo.
  - `rule` TR-11.2: Click Tablero RH Directivo → navegación SPA sin recarga; URL `/dashboard/direccion`; active state aplicado (bg-slate-100).
  - `rule` TR-11.3: Usuario viewer sin `MODULE_PAYROLL_VIEW=false` → 0 links de Nómina visibles (guard RBAC).

---

## FASE 4: Pruebas Estrés y Validación Financiera

---

## Task 12: FASE 4a — Script k6 Estrés `tests/performance/direccion-dashboard-load.js`
- **Status**: `completed`
- **Priority**: medium (bloquea solo evidencia AC-2; no bloquea funcionalidad)
- **Depends On**: Task 4 (endpoint publicado)
- **Prerrequisito**: k6 instalado global `choco install k6` o `winget install k6` o `pnpm add -D k6`.
- **Description**:
  1. Crear `tests/performance/direccion-dashboard-load.js` (≈120 LOC):
     - Import k6/http, k6/metrics Trend, checks.
     - Opciones: `stages: [{duration:'10s', target:10},{duration:'60s', target:50},{duration:'10s', target:0}]`; `thresholds: { http_req_duration: ['p(95)<1500','p(99)<3000'], http_req_failed: ['rate<0.001'], checks: ['rate==1.00'] }`; `abortOnFail: true` si p(95) > 1500ms por 10s.
     - Setup: Login en ambiente staging; obtener cookie session (`__Secure-next-auth.session-token`). O endpoint hardening endpoint desactivar auth para STAGING stress test con token service-to-service interno (no usar usuario real).
     - Default function VU: Iterar rango `[cuid_empresa_1, cuid_empresa_2]` × rangos fechas `[2023-01/2026-08 (5 años), 2025-01/2026-08 (20 meses)]`; params `departamento=null, anioComparativo=anio_anterior-1`.
     - Checks: `res.status === 200`, `typeof res.json().kpis?.costoTotalNominaMxn === 'number'`, `res.json().ok === true`, `Number(res.headers['Content-Length']) > 500` (payload no vacío).
     - Custom metric `direccion_kpi_query_ms = new Trend('direccion_kpi_duration')` + `console.log` p(50)/p(95) final summary.
  2. Ejecutar `k6 run tests/performance/direccion-dashboard-load.js --out json=tests/performance/k6-report-direccion.json`; guardar reporte `k6-summary-direccion.txt`.
- **Acceptance Criteria Addressed**: AC-2 (SLA 50 VUs p95 <1500ms), NFR-01.
- **Test Requirements**:
  - `rule` TR-12.1: k6 exit code = 0 (todos thresholds PASS). Summary muestra `http_req_duration.............: p(95)=1240ms p(99)=2650ms` (ejemplo valores).
  - `rule` TR-12.2: Checks rate 100.00% (checks passed / total checks).
  - `rule` TR-12.3: Failed requests rate `http_req_failed < 0.001` (< 0.1%).
  - `rubric` TR-12.4: *Realismo Prueba*. Scale 1-5: 1=Solo 1 empresa misma query repetida; 3=2 empresas 2 rangos; 5=5 empresas × 3 rangos fechas × 2 departamentos distintos; distribución uniforme (simula usuarios C-Level concurrentes empresas diferentes). Pass ≥ 4.

---

## Task 13: FASE 4b — Checklist Auditoría Financiera `tests/performance/direccion-auditoria-financiera-checklist.md`
- **Status**: `pending`
- **Priority**: medium (bloquea AC-10 rubric)
- **Depends On**: Task 1 (MV datos), Task 3 (service aggregates), Task 12 (script k6 opcional)
- **Description**:
  Crear archivo 12 líneas checklist (matches spec F4-R2) con columnas: `# | Concepto | Método Validación (SQL / Manual / SAT Visor) | Resultado | PASS / FAIL | Evidencia (ruta archivo / hash)`.
  1. Percepciones Brutas MV match raw query `SUM(pr.totalPercepciones) WHERE sat_status <> 'CANCELADO'`
  2. Carga Patronal = `SUM(SBC × NumDiasPagados) × 30.4%` (10 muestras aleatorias 1% cada una)
  3. ISN Estimado = `CASE clave_ent_fed × percepciones_brutas` (muestra 5 entidades federativas distintas)
  4. Costo Total = Percep Brutas + CargaPatronal + ISN → suma exacta
  5. Empleados Únicos = COUNT DISTINCT COALESCE(curp,num_emp,rfc) → delta 0
  6. Costo Promedio / Empleado = Costo Total / #Empleados → match fórmula
  7. Costo Fijo Tipo 001 = SUM percepciones tipo='001' gravado+exento → delta 0
  8. Costo Variable 6 tipos = 002/003/019/021/028/038 sum = MV.costo_variable_mxn → delta 0
  9. % Variable = Variable / (Fijo + Variable) × 100 → match porcentaje 1 decimal
  10. Tendencia 2025 anual = Suma 12 filas MV anio=2025 → 0 delta
  11. YoY Ene 2026 vs Ene 2025 = (valor2026-valor2025)/valor2025 = KPI Trend Δ YoY
  12. Muestra SAT Visor 30 UUIDs aleatorios: XLSX exportación vs Percepciones Brutas del período = 30/30 match.
- **Acceptance Criteria Addressed**: AC-10 (rubric checklist 12/12 PASS).
- **Test Requirements**:
  - `rule` TR-13.1: Todas las líneas 1–12 marcadas PASS.
  - `rule` TR-13.2: Columna "Evidencia" contiene hash fp32 o ruta SQL script reproducible por cada línea.
  - `rubric` TR-13.3: *Profundidad Auditoría*. Scale 1-5: 1=Solo queries rápidos; 3=Incluye datos SAT muestra 10 UUIDs; 5=30 UUIDs SAT Visor cross-match, cálculo carga patronal 30.4% vs IMSS tabulador oficial, 5 entidades federativas ISN distintas cada una validada con Ley Hacienda ISN estatal actual. Pass ≥ 4.

---

## Tareas Transversales / Post-Implementación

---

## Task 14: Post Build Validation + SonarQube Deuda Técnica + CHANGELOG
- **Status**: `pending`
- **Priority**: high (bloquea release; debe pasar antes de merge)
- **Depends On**: Tasks 1–13 completadas (o canceladas con aprobación)
- **Description**:
  1. `pnpm tsc --noEmit` (0 TypeScript errors).
  2. `pnpm lint` (0 ESLint errors/warnings críticos; warnings permitidos si aprobados).
  3. `pnpm build` → Next Turbopack `✓ Compiled successfully`.
  4. SonarQube (si pipeline): Nuevo code smell S4144/S3776 (duplicación/complejidad) = 0 new; helpers extraídos responsabilidad única si una función > 50 LOC compleja.
  5. `CHANGELOG.md` agregar entrada versión siguiente (ej: `## v1.19.0 — Tablero RH Directivo`) con Fecha; bullets: Novedad (Nuevo Tablero Directivo ruta `/dashboard/direccion` · 4 KPI ejecutivos · Tendencia YoY AreaChart · Composición Fijo/Variable · Desviación Presupuestal), Rendimiento (Vista Materializada MV + Index Only Scan), Seguridad (Endpoint 7-capas hardening), Nota (BudgetDepartment opcional).
  6. `.gitignore` confirmar folders `reports/ tmp/ bin/` excluidos si existen.
- **Acceptance Criteria Addressed**: AC-9 (build/lint clean), NFR-05, NFR-02.
- **Test Requirements**:
  - `rule` TR-14.1: `pnpm build` exit 0; terminal output final contiene `Route (app) /dashboard/direccion ├─ GET /dashboard/direccion` lista.
  - `rule` TR-14.2: `pnpm lint` output contiene `0 errors`.
  - `rule` TR-14.3: CHANGELOG.md entrada `v1.19.0 Tablero RH Directivo` visible; bullets 5 puntos mínimos.
  - `rubric` TR-14.4: *Calidad Código Sonar*. Scale 1-5: 1=5+ new smells "extract function" / "duplicate block"; 3=1–2 smells bajos; 5=0 new code smells (helpers separados, Readonly props, S6541 replaceAll, S2324 export...from barril files). Pass ≥ 5.

---

## Matriz Prioridades / Bloqueos (Resumen Ejecutivo)

| Fase | Task ID | Descripción Corta | Prioridad | Bloquea |
|---|---|---|---|---|
| F1 | 1 | MV `mv_direccion_costo_ejecutivo_mensual` + índices + REFRESH function | **high** | 3,4,5,7,8,9,10,13 |
| F1 | 1b | Entidad `BudgetDepartment` + seed | medium | 10, 13 (OP-1) |
| F2 | 2 | URL helpers + Zod schema + formatters puros | **high** | 3,4,5,6 |
| F2 | 3 | Service Prisma `direccion-analytics-service` | **high** | 4,5,7,8,9,10 |
| F2 | 4 | Route Handler `/api/stats/direccion` 7 capas | **high** | 12, 13 |
| F2 | 5 | Server Page `page.tsx` + slot pattern | **high** | 6,7,8,9,10,11 |
| F3 | 6 | `DireccionFilterBar` filtros + Visualización dropdown | **high** | 6,7,8,9,10 |
| F3 | 7 | KPI Cards Ejecutivas (4 cards) | **high** | UI MVP |
| F3 | 8 | AreaChart Tendencia Histórica Full-Width | **high** | UI MVP |
| F3 | 9 | Composición Fijo/Variable Donut + Tabla 7 Rubros | **high** | UI MVP |
| F3 | 10 | Tabla Desviación Presupuestal + Badges semáforo | **high** | UI MVP |
| F3 | 11 | Sidebar item Tablero Directivo + active state | **high** | Acceso navegación |
| F4 | 12 | Script k6 estrés 50VUs/60s SLA p95<1500ms | medium | Evidencia AC-2 |
| F4 | 13 | Checklist Auditoría Financiera 12 puntos | medium | Evidencia AC-10 |
| Post | 14 | Build/Lint/TS clean + CHANGELOG + Sonar | **high** | Merge / Release |

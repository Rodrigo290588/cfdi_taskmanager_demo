# KPI2 Cuotas de Terceros · Drilldown Fase A Análisis + Plan 5 Fases (Tablero Contabilidad y Fiscal Nómina 1.2)

## Resumen Coloquial (analogía oficina SAT)
Imagínate el **KPI1 ISR Retenido** = gavetón azul con tickets de retención al SAT (`tipo 002`), el **KPI2 Cuotas de Terceros** = **4 gavetones de colores** donde guardas los tickets de deducciones que NO van al SAT sino a terceros oficiales:
- Gaveta 🔴 `001` Sindicato (cuotas sindicales)
- Gaveta 🟡 `006` FONACOT (créditos INFONAVIT-FONACOT)
- Gaveta 🟢 `007` Pensión Alimenticia (descuentos por pensión a ex-cónyuges / dependientes)
- Gaveta 🔵 `010` INFONAVIT (créditos de vivienda)

Hoy esa tarjeta KPI2 **sólo muestra el TOTAL sumado de las 4 gavetas** (`fmtMxn(cuotasTerceros)`) en el mostrador, pero **no hay "Ver detalle"** para abrir cada ticket individual: ¿Qué tipo de deducción? ¿Qué empleado? ¿Qué RFC? ¿Qué CFDI? ¿Qué concepto SAT? ¿Cuánto $ exacto?

Este plan agrega el trigger overlay transparente "Abrir reporte de Cuotas de Terceros" (misma mecánica 1:1 KPI1 ISR que ya probaste 100% OK en smoke test). Cierra el círculo del **Grid 6 KPIs Nómina Fiscal = 6/6 drilldowns interactivos**.

---

## 1. Repository Research (Conclusiones)

### 1.1 UI Actual (Estado HOY antes del cambio):
- **Ubicación tarjeta KPI2:** [fiscal-nomina-kpis-section.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-kpis-section.tsx#L190-L196) (fila 1 columna 2 del grid 6 cols, inmediatamente a la derecha de KPI1 ISR).
- **Cálculo tarjeta HOY:** `cuotasTerceros = k.cuotas_sindicato + k.cuotas_fonacot + k.cuotas_pension + k.cuotas_infonavit` (líneas [L149-L150](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-kpis-section.tsx#L149-L150)). Datos vienen del agregado mensual `mv_fiscal_conciliacion_mensual`.
- **Campos tarjeta:** `title="Cuotas Terceros"` · `tone="emerald"` · `icon <Users2 h-12 w-12 />` · `value={fmtMxn(cuotasTerceros)}` · `sublabel="INFONAVIT · FONACOT · Pensión · Sindicato"`.
- **⚠ FALTANTE HOY:** La tarjeta KPI2 **NO** tiene wrapper `<div className="relative">` ni trigger overlay `<KpiXxxTriggerClient />` (a diferencia de KPI1 ISR L180-L189 que SÍ lo tiene). → este es el patrón que copiamos (0 cambios visuales overlay transparente).

### 1.2 Arquitectura Drilldown Piloto (KPI1 ISR Retenido 100% OK) — Reutilizable 99%:
Toda la infraestructura **ya está lista**, no reinventamos rueda (mismo patrón 5 KPIs anteriores):
1. **Client Shell Contextual:** [fiscal-nomina-shared.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-shared.tsx#L186-L275)
   - **5 Contexts React** existentes: Cancelados / UuidDuplicados / RetrasosTimbrado / AlertasSbcSdi / **IsrRetenido** (5to agregado Fase C KPI1).
   - 5 `useState` boolean open, 5 `useCallback` openXxx, 5 useMemo ctxValue Providers.
   - 5 `<Dialog />` montados condicionalmente después de `{props.children}` (total 5).
   - 5 Triggers overlay `absolute inset-0 z-10` button invisible sobre tarjeta, todos usan helper `_KpiDrilldownTriggerBase()` (Paquete 39).
2. **Endpoints API (GET Read-Only / SELECT):** [isr_retenido/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard/nomina/fiscal/drilldown/isr_retenido/route.ts) (patrón más actual, Paquete 37 refactor helpers DRY)
   - **7 capas hardening estrictas:** Rate Limit IP 60/min → NextAuth v5 → Rate Limit User 40/min → Zod strict validation + regex ID allowlist + refine date range ≤ 5 años → RBAC `MODULE_PAYROLL_VIEW` + `requireApprovedDashboardAccess` → Rate Limit Org 180/min → SQL Keyset pagination SIN OFFSET.
   - **Fail-Soft Pattern:** todo `try/catch` + correlationId `fp32` + headers `SECURITY_HEADERS` + helpers `_mapErrNameToHttp` / `_errJson` / `_rl429` (Paquete 37).
   - **Salida Sanitizada:** 100% campos se pasan por `safeNum` / `safeIso` / `safeStr` / `safeStrOrNull` → NO serialize bigint/Decimal/nullish coalesce crash.
3. **Dialog UI Componentes:** [drilldown-dialog-isr-retenido-nom.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/drilldown-dialog-isr-retenido-nom.tsx) (último dialog implementado, Paquete 38 Sonar arreglado replaceAll + coerce DRY)
   - Full Screen Dialog, Heading Empresa RFC + Periodo + **Totales Servidor** (conteo rows / Σ importe cuota / Σ neto CFDI / Σ CFDIs afectados).
   - Tabla sticky headers: 21 columnas + 21 inputs filtro por columna + Fila Suma Total Filtrado dinámico useMemo.
   - Paginación cliente 200/page `ISR_DRILLDOWN_PAGE_SIZE` (igual al resto).
   - Botón Export CSV: filename `{KPI}_Nomina_{RFC}_{startDate}_{endDate}.csv` + codificación **UTF-8 BOM** + escape comillas Excel compatible.

### 1.3 Schema DB SAT Nómina 12 para KPI2 Cuotas Terceros (4 tipos SAT 001/006/007/010):
Confirmado en modelo Prisma [schema.prisma L1325-L1340](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/prisma/schema.prisma#L1325-L1340) y en agregado mensual `mv_fiscal_conciliacion_mensual` ded_agg L48-L59 SQL:
```sql
-- 1 FILA = 1 DEDUCCION DE TIPO TERCERO (001/006/007/010) x EMPLEADO x CFDI
-- Un mismo CFDI puede tener varias filas aquí (ej: 001 Sindicato + 010 INFONAVIT simultaneos = 2 rows drilldown)
SELECT pd.id                              AS deduccion_id,             -- ← CURSOR KEYSET pagination PK
       pd.tipo_deduccion                  AS tipo_deduccion,          -- ← CHAR(3) FILTRO IN ('001','006','007','010')
       pd.clave                           AS clave_deduccion,         -- Alias OBLIGATORIO (Prisma PayrollDeduccion @map="clave" - NO clave_deduccion RC bug fix KPI1 Paquete37)
       pd.concepto                        AS concepto_deduccion,
       pd.importe                         AS importe_cuota_mxn,        -- NUMERIC(18,6) $ cuota descontada
       pr.id                              AS receipt_id,
       pr.invoice_id                      AS invoice_id,
       pr.uuid                            AS uuid,
       pr.serie                           AS serie,
       pr.folio                           AS folio,
       pr.tipo_nomina                     AS tipo_nomina,
       pr.fecha_emision                   AS fecha_emision,
       pr.fecha_pago                      AS fecha_pago,
       pr.total_percepciones              AS total_percepciones,
       pr.total_deducciones               AS total_deducciones,
       pr.total_otros_pagos               AS total_otros_pagos,
       pr.total_neto                      AS total_neto,
       inv.sat_status                     AS sat_status,
       inv.pdf_url                        AS pdf_url,
       prr.rfc                            AS empleado_rfc,
       prr.nombre                         AS empleado_nombre,
       prr.curp                           AS empleado_curp,
       prr.num_empleado                   AS empleado_num,
       COALESCE(prr.departamento, pr.departamento) AS departamento    -- FALLBACK dual (PayrollReceptor > PayrollReceipt) helper _resolveDualDepartamento
  FROM payroll_deducciones  pd
  JOIN payroll_receipts     pr  ON pr.id = pd.payroll_receipt_id
  LEFT JOIN invoices        inv ON inv.id = pr.invoice_id
  LEFT JOIN payroll_receptors prr ON prr.payroll_receipt_id = pr.id
 WHERE pr.company_id          = ${companyId}::text
   AND pr.fecha_pago          BETWEEN ${startDate} AND ${endDate}
   AND pd.tipo_deduccion      IN ('001','006','007','010')   -- ← FILTRO KPI2 CUOTAS TERCEROS (4 tipos SAT)
   AND (${cursorId}::text IS NULL OR pd.id > ${cursorId}::text)  -- ← KEYSET SIN OFFSET (pd.id PK)
 ORDER BY pd.id ASC
 FETCH FIRST ${limit} + 1 ROWS ONLY;
```
- **Llave de auditoría SAT** (validación Fase E5):
  ```
  SUM(rows[].importeCuotaMxn rango fechas empresa X)
    === al centavo
  mv_fiscal_conciliacion_mensual.cuotas_sindicato + cuotas_fonacot + cuotas_pension + cuotas_infonavit
  ```
  Diferencia de redondeo ≤ $0.02 MXN permitida.

### 1.4 Mapeo Humano Tipo Deducción (Para UI Dialog / Filtros / Leyendas CSV):
```ts
// Constante reusable en route.ts + Dialog UI (evita strings duplicados SQ S4144)
const CUOTA_TIPO_LABEL: Record<'001'|'006'|'007'|'010', string> = {
  '001': 'Sindicato · SAT 001',
  '006': 'FONACOT · SAT 006',
  '007': 'Pensión Alimenticia · SAT 007',
  '010': 'INFONAVIT · SAT 010',
} as const;
```

---

## 2. Fases del Workflow PEDIDO15 (1 Fase = 1 APROBACIÓN EXPLÍCITA POR ESCRITO ANTES de avanzar)

| Fase | Nombre corto | ¿Qué entrega exactamente? | Nivel riesgo |
|---|---|---|---|
| **A · ACTUAL** | **Análisis + Plan** (esta hoja) | Definir 4 tipos SAT, endpoint shape, 22 columnas tabla, 6to Context, 6to Dialog, Wrap KPI2. | ✅ **NINGUNO** (solo docs) |
| **B · SIGUIENTE (pend user)** | **Endpoint drilldown Cuotas Terceros** | Nuevo folder `/api/dashboard/nomina/fiscal/drilldown/cuotas_terceros/route.ts` 100% pattern `isr_retenido route.ts` Paquete37 (helpers DRY `_safeAsRecord` / `_resolveDualDepartamento` / `_rl429` / `_summarizeXxx`). Zod strict, 7 capas, $queryRaw keyset IN (4 tipos), totals servidor 4 métricas (count / Σ cuota / Σ neto / Σ CFDIs). | **BAJO** (solo SELECT; 100% pattern existente KPI1) |
| **C · (pend B ok)** | **6to Client Context Shell + 6to Trigger** | `fiscal-nomina-shared.tsx`: Agregar `CuotasTercerosDrilldownCtx` (6to Context) + useState drilldownCuotasTercerosOpen + useCallback openCuotasTerceros + Provider **POR DENTRO del árbol** del 5to IsrRetenidoCtx (0 regresiones 5 KPIs). Montar 6to Dialog `<DrilldownDialogCuotasTercerosNom />`. Exportar `KpiCuotasTercerosTriggerClient` (reutiliza `_KpiDrilldownTriggerBase` Paquete39). | **BAJO** (pattern 5/5 existentes. Cambio nesting 0 afecta KPI1-6). |
| **D · (pend C ok)** | **UI Dialog Drilldown Cuotas Terceros** | Nuevo `drilldown-dialog-cuotas-terceros-nom.tsx` clone pattern `drilldown-dialog-isr-retenido-nom.tsx`. Cambios clave: (a) Const `ENDPOINT = '/drilldown/cuotas_terceros'`. (b) 22 cols = 21 cols ISR + 1 columna nueva **"Categoría Cuota"** (badge color por tipo: Sindicato rojo, FONACOT ámbar, Pensión verde, INFONAVIT azul). (c) Totales Filtrado Σ Importe Cuota MXN por categoría. (d) Filtrado adicional por tipo deducción 001/006/007/010 (dropdown único sobre 21 filtros texto). (e) CSV filename = `Cuotas_Terceros_Nomina_{RFC}_{ts}.csv`. | **MEDIO** (clone 565 líneas dialog ISR → 2 ajustes estructurales: col badge categoría + dropdown tipo). Mantiene helpers Paquete38 DRY `_isrCoerceToString` / replaceAll comillas CSV. |
| **E · (pend D ok)** | **Wrap KPI2 Card + Validación Final** | `fiscal-nomina-kpis-section.tsx` L190: envolver tarjeta KPI2 Cuotas Terceros `<div className="relative">{ KpiCardFiscal ... }<KpiCuotasTercerosTriggerClient /></div>` (MISMO píxel pattern KPI1 ISR L180-L189). Pipeline: GetDiags 0 → build0 → Smoke Browser click KPI2 abre dialog HTTP 200 → Regresión Smoke 5 KPIs KPI1/KPI3/KPI4/KPI5/KPI6 siguen OK console 0 errores. | **BAJO** (1 wrapper div + 1 overlay button transparente z-10) |

---

## 3. Files and Modules (Exactamente qué archivos tocamos POR FASE)

| # | Archivo | Cambio esperado por Fase | Tamaño aprox |
|---|---------|--------------------------|--------------|
| 1 | `src/app/api/dashboard/nomina/fiscal/drilldown/cuotas_terceros/route.ts` **NUEVO** | **FASE B:** Clone exacto pattern `isr_retenido/route.ts` Paquete37 refactor 9 helpers DRY. Cambios únicos: (a) Const `CUOTAS_PAGE_SIZE = DRILLDOWN_DEFAULT_PAGE_SIZE`. (b) Zod `DrilldownCuotasTercerosParams` (mismo shape ISR, 0 cambios). (c) SQL WHERE `pd.tipo_deduccion IN ('001','006','007','010')` (en vez de `= '002'`). (d) Helper `_parseCuotaRow(r)` (mismo shape 22 cols que endpoint `CuotasTercerosRow` = `{ deduccionId, tipoDeduccion, categoriaLabel, claveDeduccion, conceptoDeduccion, importeCuotaMxn, ...21 campos igual ISR}`). (e) Helper `_summarizeCuotas` = Σ importeCuotaMxn / Σ neto CFDI / Σ rows / Σ CFDIs únicos (Set invoiceId). | ~400 líneas (igual route ISR post Paquete37) |
| 2 | `src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-shared.tsx` **EXISTENTE** | **FASE C:** (a) `CuotasTercerosDrilldownCtx = createContext<{open: KpiDrilldownOpenFn}|null>(null);` 6to Context L191 inmediatamente después IsrRetenidoDrilldownCtx. (b) useState L206 `drilldownCuotasTercerosOpen` después drilldownIsrRetenidoOpen. (c) useCallback L212 `openCuotasTerceros` después openIsrRetenido. (d) useMemo ctxValueCuotasTerceros después de ctxValueIsrRetenido L216. (e) **Provider nesting 6to nivel:** `<CuotasTercerosDrilldownCtx.Provider value={ctxValueCuotasTerceros}>` va **POR DENTRO** del árbol de `<IsrRetenidoDrilldownCtx.Provider>` (linea 222 después IsrRetenidoProvider, cierre 269 inmediatamente antes cierre IsrRetenidoProvider). (f) Mount 6to Dialog: `<DrilldownDialogCuotasTercerosNom ... props companyId companyRfc startDate endDate />` inmediatamente después L268 DrilldownDialogIsrRetenidoNom. (g) Export `KpiCuotasTercerosTriggerClient = (props) => { ctx = useContext(CuotasTercerosDrilldownCtx); return _KpiDrilldownTriggerBase(ctx, {...props, defaultAriaLabel: "Abrir reporte de Cuotas de Terceros de nómina"}); }` pattern exacto KpiIsrRetenidoTriggerClient L330-L333. **0 cambios en los 5 Context/Dialog/Trigger anteriores existentes.** | +60 líneas (igual +70 KPI1 Fase C, DRY helper base) |
| 3 | `src/app/dashboard/nomina/fiscal/_components/drilldown-dialog-cuotas-terceros-nom.tsx` **NUEVO** | **FASE D:** Clone pattern `drilldown-dialog-isr-retenido-nom.tsx` 565 líneas post-Paquete38 (replaceAll + DRY _isrCoerceToString). Cambios específicos Cuotas: (a) Props Named `CuotasTercerosNomDialogProps extends Readonly<DrilldownBaseDialogNomProps>` (BaseDialogProps = { open, onOpenChange, companyId, ... }). (b) type `CuotasTercerosRow = 22 cols` = shape endpoint B. (c) Nuevas constantes `CUOTA_BADGE_TONE: Record<tipo, ToneId>` y `CUOTA_CATEGORY_LABEL` para la columna "Categoría Cuota" Badge. (d) 1 fila `<Tr className="bg-slate-50/70">` adicional antes sticky-header: dropdown select `Tipo de Cuota` con opciones `Todas / 001 Sindicato / 006 FONACOT / 007 Pensión / 010 INFONAVIT` que filtra por tipoDeduccion. (e) Totales servidor Footer: `Conteo cuotas: X · Σ Importe Cuota Total: fmtMxn · Σ Neto CFDI: fmtMxn · CFDIs afectados: countCfdAfectados`. (f) Filtro total Filas useMemo: separa `sumaCuotasPorCategoria` 4 acumuladores visible en header dialog. (g) CSV Export headers = 22 cols + renombra columna `tipoDeduccion` como "Tipo Deduccion SAT (001/006/007/010)" en header plano CSV. | ~585 líneas (565 base ISR + ~20 dropdown tipo + badge categoría) |
| 4 | `src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-kpis-section.tsx` **EXISTENTE** | **FASE E:** 2 cambios exactos. (1) Import L17: agregar `KpiCuotasTercerosTriggerClient` al set de imports de fiscal-nomina-shared. (2) KPI2 Cuotas Terceros L190-L196: ENVOLVER existing `<KpiCardFiscal title="Cuotas Terceros" tone="emerald" icon={<Users2/>} value={fmtMxn(cuotasTerceros)} sublabel="INFONAVIT·FONACOT·Pensión·Sindicato"/>` DENTRO de `<div className="relative">{/* KPI2 card intacto */}<KpiCuotasTercerosTriggerClient /></div>`. **0 cambios internos a la tarjeta.** | +4 líneas wrapper (mismo píxel KPI1 ISR L180-L189) |
| 5 | `src/lib/fiscal-nomina-drilldown-helpers.ts` **EXISTENTE** | **NINGÚN CAMBIO** (ya tiene safe helpers, constants, DRILLDOWN_DEFAULT_PAGE_SIZE 500, regex ID allowlist). Si SQ pide algo mínimo: agregar sin impacto. | ~0 líneas |
| 6 | `src/app/dashboard/nomina/fiscal/fiscal-nomina-server-page.tsx` **EXISTENTE** | **NINGÚN CAMBIO** (KpiDrilldownShellNomina ya envuelve Row 3 KpisSectionSuspensed; props companyId/companyRfc/startDate/endDate fluyen automáticamente a los 6 Dialogs incluyendo el nuevo CuotasTerceros). | 0 líneas |

---

## 4. Implementation Steps (Order de Dependencia)

1. **Fase B Endpoint:**
   1.1 Crear carpeta `src/app/api/dashboard/nomina/fiscal/drilldown/cuotas_terceros/`.
   1.2 Copiar structure 1:1 de `isr_retenido/route.ts` (Paquete 37 refactor 9 helpers DRY).
   1.3 Cambios mínimos: prefijo RL keys `fn-drillcuotas-ip/user/org`, SQL `IN (4 tipos SAT)` en vez de `= '002'`, `alias importeCuotaMxn` en vez de `importeIsrMxn`.
   1.4 `_parseCuotaRow(r)` + `_summarizeCuotas(data)` reemplazan `_parseIsrRow` / `_summarizeIsr`.
   1.5 Pipeline GetDiags 0 + build 0 + curl HTTP 401 unauth correcto.
2. **Fase C Context Shell:**
   2.1 `shared.tsx`: 6to Context + useState + useCallback + useMemo Provider.
   2.2 **Import 6to Dialog:** línea L20 inmediatamente después `DrilldownDialogIsrRetenidoNom`.
   2.3 **Nesting Provider** POR DENTRO de IsrRetenidoCtx (0 afecta KPI1-6).
   2.4 **Mount Dialog** L268 después Dialog ISR.
   2.5 Export 6to Trigger L333.
   2.6 Pipeline GetDiags 0 + build 0.
3. **Fase D Dialog UI:**
   3.1 Nuevo archivo. Clone dialog ISR 565 líneas.
   3.2 Cambiar `ISR_DRILLDOWN_PAGE_SIZE` → `CUOTAS_DRILLDOWN_PAGE_SIZE = 200`.
   3.3 Agregar `CUOTA_CATEGORY_LABEL` + `CUOTA_BADGE_TONE` constantes.
   3.4 Columna nueva sticky #2 "Categoría Cuota" con Badge color (antes de Clave/Concepto).
   3.5 Row filtro adicional dropdown tipo deducción 001/006/007/010 sobre sticky headers.
   3.6 Totales Σ por categoría en Header (4 badge color).
   3.7 Pipeline GetDiags 0 + build 0.
4. **Fase E Wrap + Smoke Pipeline:**
   4.1 Import KpiCuotasTercerosTriggerClient L17.
   4.2 Wrapper div relative + Trigger sobre KPI2 L190.
   4.3 **(OBLIGATORIO PEDIDO15)** GetDiags 0 + build 0 + curl endpoint 200 rows empty + Smoke Browser click KPI2 → dialog abre → network request OK → empty state totales servidor render OK → console 0 JS errores.
   4.4 **(OBLIGATORIO)** Regresión Smoke 5 KPIs: KPI1 ISR / KPI3 Cancelados / KPI4 UUID Dup / KPI5 Retrasos / KPI6 Alertas SBC → todos abren Dialog OK, console 0 errores.

---

## 5. Dependencies and Considerations

### ⛔ LO QUE NUNCA TOCAMOS (RESTRICCIONES BINDING Workflow PEDIDO15 + AGENTS.md + Hard Constraints project_memory.md)
1. **NO TOCAR:** 5 endpoints drilldown existentes (cancelados/uuid_dup/retrasos_timbrado/alertas_sbc_sdi/**isr_retenido**).
2. **NO TOCAR:** 5 Contexts/UseStates/UseCallbacks/UseMemo Providers existentes shared.tsx (L186-L216). Solo agregamos 6to al final DENTRO del árbol.
3. **NO TOCAR:** 5 Dialogs montados existentes L224-L268. Solo agregamos 6to Dialog inmediatamente después L268.
4. **NO TOCAR:** 5 Triggers Client exportados L310-L333. Solo agregamos 6to Trigger después L333.
5. **NO TOCAR:** Lógica KPI2 tarjeta kpis-section.tsx (0 cambios fmtMxn(cuotasTerceros) / tone emerald / icon Users2 / sublabel).
6. **NO TOCAR:** Fail-Closed Redis queue.ts MD-013 AGENTS.md (ya arreglado, sin relación).
7. **NO OFFSET pagination:** 100% Keyset `pd.id > cursorId ASC`.
8. **NO Decimals/BigInt sin safeNum:** 100% sanitización por safe helpers.

### 🟢 Dependencias Positivas (Ya existen, no hay que instalar NADA)
- Safe helpers DRY existentes: `fiscal-nomina-drilldown-helpers.ts` (safeNum, safeStrOrNull, refineDateRange).
- Route helpers Paquete37 DRY pattern: `_safeAsRecord`, `_resolveDualDepartamento`, `_rl429`, `_errJson`, `_rawFromSearchParams`, `_pageInfoFromRows<TId>`, `_parseIsrRow`, `_summarizeIsr`, `_mapErrNameToHttp`. Los renombramos en nuevo archivo con prefijo cuotas o reutilizamos sin copy duplicado (opción B mejor: renombrar y no romper imports ISR → keep igual en route cuotas con nombre propio).
- Helpers UI Shared: `_KpiDrilldownTriggerBase` + `_onKeyDownEnterSpace` (Paquete39) reutilizan 1:1.
- Dialog helpers Paquete38 DRY: `_isrCoerceToString` (reutilizar o renombrar genérico `_coerceDialogToString` en Dialog Cuotas sin tocar ISR → opción por default: mantener nombre en ISR, crear helper genérico `_coerceToString` en cuotas para 0 duplicación Sonar S4144).
- NextAuth v5, Zod strict, rateLimit 3 niveles, prisma.$queryRaw typed, requireApprovedDashboardAccess, `MODULE_PAYROLL_VIEW`, SECURITY_HEADERS, fp32 correlationId: todo ya está listo.

---

## 6. Validation (Por Fase + Final Pipeline)

| Fase | Validación OBLIGATORIA POR ESCRITO para pasar a siguiente |
|---|---|
| **Fase B Endpoint** | (1) GetDiagnostics uri route.ts → []. (2) `npm run build` exit code 0. (3) `curl` endpoint sin cookie → HTTP 401 JSON `{ ok:false, error:"UNAUTHENTICATED" }`. (4) Runtime smoke Dev server con sesión → HTTP 200 empty state JSON shape `{ ok:true, pageInfo:{hasNextPage:false,nextCursorId:null}, totals:{countRetenciones:0, sumaImporteCuotaMxn:0, ...} }`. (5) Validación auditoría SQL: `SUM(pd.importe WHERE tipo IN ('001','006','007','010')) rango fechas = al centavo mv.cuotas_sindicato+fonacot+pension+infonavit` ($0.02 diff permitido). |
| **Fase C Shell** | GetDiagnostics shared.tsx 0 warnings · build exit code 0. Verificar en TS Type Hover 6to Context Provider: `CuotasTercerosDrilldownCtx` type assignability `{ open: KpiDrilldownOpenFn } | null` 100% OK. |
| **Fase D Dialog** | (1) GetDiagnostics dialog file → []. (2) build exit code 0. (3) Sonar Quality Gate: Cognitive ≤15 (split helpers), Readonly Props wrapper S6759, replaceAll comillas CSV S6541, DRY coerce S4144, 0 branches idénticos S2758. |
| **Fase E Wrap + Final Smoke Pipeline** | (1) GetDiags 0 TODOS los 28 archivos módulo nómina. (2) build exit 0 80/80 SSG. (3) **Smoke Integrated Browser User Session** rtorreh@itcomplements (MEMBER 7 empresas): Click KPI2 Cuotas Terceros → Dialog abre Loading → EmptyState muestra "Conteo servidor: 0 cuotas · Σ Importe Cuota Total: $0.00 · Σ Neto CFDI: $0.00 · CFDIs afectados: 0" + Network request /drilldown/cuotas_tercero HTTP 200. (4) Console Browser: **0 JS errores globales**. (5) **Regresión Smoke 5 KPIs (KPI1 ISR / KPI3 Cancelados / KPI4 UUID / KPI5 Retrasos / KPI6 Alertas)** → TODOS abren dialog OK. (6) Dropdown Tipo Cuota 001/006/007/010 funciona filtra rows correctamente (si seed demo datos reales). |

---

## 7. Risks y Handling

| # | Riesgo | Nivel | ¿Cómo lo evitamos? |
|---|---|---|---|
| R1 | SQL alias `clave_deduccion` RC bug KPI1 (columna DB = clave no clave_deduccion) | BAJO | Usar `pd.clave AS clave_deduccion` 1:1 igual fix Paquete37 KPI1 ISR route.ts. Runtime smoke B4 confirma no 500. |
| R2 | Nesting 6to Provider por FUERA de árbol 5to → Regresión KPI1 ISR no abre dialog | MEDIO | **Clone EXACT pattern L218-L270 KPI1:** `<IsrRetenidoCtx.Provider> ... children ... <Dialog ISR /> <DIALOG CUOTAS TEREROS NUEVO /> </IsrCtx>`. El 6to Provider CuotasTerceros va **DENTRO** del IsrRetenido Provider, envolviendo a { children } + <DialogIsr/> + <DialogCuotas/>. Smoke test Fase E4 KPI1 ISR abre = confirma nesting OK. |
| R3 | Keyset pagination falla (cursorId null o no coincide regex allowlist) | BAJO | Zod DRILLDOWN_ID_REGEX /^[A-Za-z0-9_-]{8,40}$/ exactamente igual KPI1. ORDER BY pd.id ASC FETCH FIRST limit+1. Helper `_pageInfoFromRows<TId = 'deduccion_id'>` generic reutilizado pattern. |
| R4 | Sonar Quality Gate rojo en route.ts (S3776 Cognitive >15 / S4144 rate limit 6 copias / S3358 ternarias anidadas) | BAJO | **100% Clone pattern route ISR Retenido PAQUETE37** (ya es Sonar GREEN helpers DRY). 9 helpers separados: GET function simplificada ~130 líneas decision count ≤15. |
| R5 | Dropdown Tipo Cuota 001/006/007/010 no filtra rows (cerrado = sin seed demo datos = difícil probar) | BAJO | Smoke Test Fase E6 SI TENEMOS SEED DEMO: valida con datos reales Sindicato + INFONAVIT. Si NO tenemos seed demo: usar fallback filtro por input texto columna "Tipo Deduccion SAT" que SÍ existe = siempre filtra. Dropdown es mejora UX adicional. |
| R6 | CSV Export Category Label "Categoría Cuota" sale como [object Object] (S6551 typeof) | BAJO | Helper `_coerceToString(v)` Paquete38 DRY pattern: `typeof v === 'string' ? v : switch (vtype) { number → String ... date → fmtDateEs ... }`. 100% safe. |

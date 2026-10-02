# KPI1 ISR Retenido · Drilldown Fase A Análisis + Plan 5 Fases (Tablero Contabilidad y Fiscal Nómina 1.2)

## Resumen Coloquial (analogía oficina SAT)
Imagínate el **KPI3 Cancelados** = gaveta de archivos tachados con sello CANCELADO ✗, el **KPI1 ISR Retenido** = gaveta de **tickets de retención de impuestos** (gavetones azules con sello 002 SAT donde cada empleado le descontaron ISR de su sueldo quincenal). Ahora esa gaveta **sólo muestra el TOTAL $0.00** en el mostrador (tarjeta KPI), pero **no hay "Ver detalle"** para sacar cada ticket individual: ¿qué empleado? ¿qué RFC? ¿qué fecha pago? ¿qué CFDI? ¿cuánto ISR exacto? Este plan agrega el trigger overlay "Abrir reporte de ISR retenido" (misma mecánica KPI3 Cancelados que ya probaste 100% OK en Smoke Test Opción B).

## 1. Repository Research (Conclusiones)

### 1.1 UI Actual (Estado HOY antes del cambio):
- **Ubicación tarjeta KPI1:** [fiscal-nomina-kpis-section.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-kpis-section.tsx#L180-L186) (fila 1 del grid 6 cols).
- **Campos tarjeta:** title="ISR Retenido" · tone="slate" · icon Landmark · value=`fmtMxn(k.isr_retenido_mxn)` (desde vista materializada `mv_fiscal_conciliacion_mensual`) · sublabel="TipoDeduccion SAT · 002".
- **⚠ FALTANTE HOY:** La tarjeta KPI1 **NO** tiene wrapper `<div className="relative">` ni trigger overlay `<KpiXxxTriggerClient />` (a diferencia de KPI3 Cancelados L194-L208 que sí tienen). → este es el patrón que copiamos para el drilldown.

### 1.2 Arquitectura Drilldown Piloto (KPI3 Cancelados 100% OK) — Reutilizable 99%:
Toda la infraestructura **ya está lista**, no reinventamos rueda:
1. **Client Shell Contextual:** [fiscal-nomina-shared.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-shared.tsx#L139-L207)
   - 4 Contexts React (`CanceladosDrilldownCtx`, `UuidDuplicadosDrilldownCtx`, `RetrasosTimbradoDrilldownCtx`, `AlertasSbcSdiDrilldownCtx`).
   - 4 `useState` boolean open, 4 `useCallback` openXxx.
   - 4 `<Dialog />` montados condicionalmente después de `{props.children}`.
   - 4 Triggers overlay `absolute inset-0 z-10` (button invisible sobre la card).
2. **Endpoints API (GET Read-Only / SELECT):** [cancelados/route.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/api/dashboard/nomina/fiscal/drilldown/cancelados/route.ts)
   - **7 capas hardening:** rate limit IP (60/min) → NextAuth v5 autenticación → rate limit user (40/min) → Zod strict validation + regex ID allowlist + refine date range max días → RBAC MODULE_PAYROLL_VIEW + requireApprovedDashboardAccess → rate limit org (180/min) → Keyset pagination SIN OFFSET (cursorId).
   - **Fail-soft:** total try/catch con correlationId `fp32` + headers SECURITY_HEADERS.
   - **Salida:** 100% `safeNum` / `safeIso` / `safeStr` → NO serialize bigint / Decimal / nullish coalesce crash.
3. **Dialog UI Componentes:** [drilldown-dialog-cancelados-nom.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/drilldown-dialog-cancelados-nom.tsx)
   - Full Screen Dialog, header empresa RFC + periodo, Totales servidor (conteo / Σ percep / Σ deducc / Σ neto), Tabla sticky 14 columnas filtros input por columna, Fila suma Total Filtrado dinámico, Paginación cliente 200/page `DRILLDOWN_DEFAULT_PAGE_SIZE`, Botón Export CSV + metadata filename empresa+periodo.
4. **Montaje Shell Server Page:** [fiscal-nomina-server-page.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/fiscal-nomina-server-page.tsx) Row 3 `KpisSectionSuspensed` envuelto dentro `<KpiDrilldownShellNomina>`.

### 1.3 Schema DB SAT Nómina 12 para ISR Retenido (TipoDeduccion = '002'):
Confirmado en vista materializada `mv_fiscal_conciliacion_mensual` ded_agg L48-L59 [20260902203000_mv_fiscal_conciliacion_mensual.sql](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/scripts/sql/20260902203000_mv_fiscal_conciliacion_mensual.sql#L48-L59) y en server page [fiscal-nomina-server-page.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/fiscal-nomina-server-page.tsx#L441-L453):
```sql
-- JOIN payroll_deducciones (deducciones SAT nómina 12) con payroll_receipts (recibo por CFDI)
SELECT pd.id,                           -- ← CURSOR KEYSET pagination (1 row = 1 deduccion 002 por empleado por CFDI)
       pd.payroll_receipt_id,           -- FK → pr.id
       pd.tipo_deduccion,               -- CHAR(3) = '002' ISR RETENIDO SAT
       pd.importe,                      -- NUMERIC(18,6) cuanto $ se le retuvo al empleado
       pr.id AS receipt_id, pr.invoice_id, pr.uuid, pr.serie, pr.folio,
       pr.tipo_nomina, pr.fecha_emision, pr.fecha_pago,
       pr.total_percepciones, pr.total_deducciones, pr.total_otros_pagos, pr.total_neto,
       inv.sat_status, inv.pdf_url,
       prr.rfc AS empleado_rfc, prr.nombre AS empleado_nombre,
       prr.curp AS empleado_curp, prr.num_empleado, prr.departamento
  FROM payroll_deducciones pd
  JOIN payroll_receipts   pr  ON pr.id = pd.payroll_receipt_id
  LEFT JOIN invoices      inv ON inv.id = pr.invoice_id
  LEFT JOIN payroll_receptors prr ON prr.payroll_receipt_id = pr.id
 WHERE pr.company_id = $1
   AND pr.fecha_pago BETWEEN $2 AND $3
   AND pd.tipo_deduccion = '002'       -- ← FILTRO KPI1 ISR Retenido
   AND (${cursorId} IS NULL OR pd.id > ${cursorId}::text)  -- ← KEYSET SIN OFFSET (pd.id pk row)
 ORDER BY pd.id ASC
 FETCH FIRST ${N}+1 ROWS ONLY;
```
- 1 fila = **1 retención de ISR (002) por empleado por CFDI de nómina**. Si un CFDI de nómina tiene otra deducción (INFONAVIT '010') NO aparece en este drilldown (sólo `pd.tipo_deduccion='002'`).
- Validación auditoria checklist SAT [auditoria-fiscal-nomina-checklist.md](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/tests/performance/auditoria-fiscal-nomina-checklist.md#L30): `SUM(pd.importe WHERE tipo='002') === k.isr_retenido_mxn` al centavo ($0.02 diff redondeo permitido).

---

## 2. Fases del Workflow PEDIDO15 (1 Fase = 1 aprobación POR ESCRITO antes de pasar a la siguiente)

| Fase | Nombre corto | ¿Qué entrega? | Nivel riesgo |
|---|---|---|---|
| **A** · ACTUAL | **Análisis + Plan** (esta hoja) | Definir exactamente qué cambiamos / qué NO tocamos / response shape endpoint / columnas tabla | ✔ NINGUNO (solo docs) |
| **B** · SIGUIENTE (pend aprob usuario) | **Endpoint drilldown ISR Retenido** | Nuevo folder `/api/dashboard/nomina/fiscal/drilldown/isr_retenido/route.ts` (pattern KPI3 cancelados), Zod schema, $queryRaw KEYSET, Shape endpoint `IsrRow` 18 campos, 7 capas hardening, fail-soft, CSV export fields | BAJO (solo SELECT; 100% pattern existente) |
| **C** | **Client Context Shell + Trigger KPI1** | [shared.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-shared.tsx) 5to `IsrRetenidoDrilldownCtx` + 5to `useState` + 5to Provider + 5to Dialog mount + nuevo `KpiIsrRetenidoTriggerClient` overlay button | BAJO (pattern 4/4 existentes) |
| **D** | **UI Dialog Drilldown** | Nuevo `drilldown-dialog-isr-retenido-nom.tsx` (clone pattern KPI3 cancelados): 18 columnas (14 base + 4 ISR deduccion), filtros, totales filtrado, paginación cliente 200/page, Export CSV filename isr_retenido_RFC_empresa_periodo.csv | MEDIO (clone 800 líneas → cambiar columnas + shape endpoint → filtros ISR conceptos/clave) |
| **E** | **Wrap KPI1 Card + Validación Final** | [kpis-section.tsx](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-kpis-section.tsx#L180-L186): envolver KPI1 `<div className="relative">` + `<KpiIsrRetenidoTriggerClient />`. Run `npm run lint 0` + `npm run build 0` + smoke test browser (click KPI1 abre dialog, endpoint HTTP 200, 0 console errors, empty state visible) | BAJO (patrón KPI3/KPI4/KPI5/KPI6) |

---

## 3. Files and Modules (Exactamente qué archivos tocamos por Fase)

| # | Archivo | Cambio esperado por fase | Tamaño |
|---|---------|--------------------------|--------|
| 1 | `src/app/api/dashboard/nomina/fiscal/drilldown/isr_retenido/route.ts` **(NUEVO)** | **FASE B:** Endpoint GET GET-only pattern cancelados route.ts. Zod `DrilldownIsrRetenidoParams = z.object({ companyId, startDate, endDate, cursorId, limit })`. 7 capas hardening (IP/user/org rate limit + auth + Zod + RBAC + org). $queryRaw tabla payroll_deducciones `tipo_deduccion='002'` KEYSET pd.id cursor. Shape endpoint: `{ ok: boolean, rows: IsrRow[], nextCursorId: string|null, totalServidorConteo?: number, totalesServidor?: { Σ Importe ISR: number, Neto CFDI sum: number, CFDIs afectados: number } }`. | ~380 líneas (igual cancelados route) |
| 2 | `src/lib/fiscal-nomina-drilldown-helpers.ts` **(EXISTENTE)** | **FASE B NO TOCAR.** Ya tiene safe helpers + formatZodIssuesSafe + refineDateRange + constants DRILLDOWN_DEFAULT_PAGE_SIZE. Si falta constante 1 sola: agregar `DRILLDOWN_ISR_PAGE_SIZE = DRILLDOWN_DEFAULT_PAGE_SIZE` (ningún cambio estructural). | ~0 líneas |
| 3 | `src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-shared.tsx` **(EXISTENTE)** | **FASE C:** (a) Agregar `IsrRetenidoDrilldownCtx = createContext<{ open: () => void } | null>(null);` (L142 después de AlertasCtx). (b) Agregar `useState drilldownIsrRetenidoOpen, setDrilldownIsrRetenidoOpen` (L155 después 4 states). (c) Agregar `useCallback openIsrRetenido = useCallback(() => setDrilldownIsrRetenidoOpen(true), []);` (L159). (d) Agregar 1 nivel más Provider wrap `IsrRetenidoDrilldownCtx.Provider value={{ open: openIsrRetenido }}` por dentro del árbol (L164 por dentro AlertasCtx). (e) Montar 5to Dialog después de DrilldownDialogAlertasSbcSdiNom L202: `<DrilldownDialogIsrRetenidoNom ...props />`. (f) Exportar function `KpiIsrRetenidoTriggerClient` (igual L209 Cancelados: same pattern button overlay absolute z-10 aria-label default="Abrir reporte de ISR retenido de nómina"). | +70 líneas pattern cancelados trigger |
| 4 | `src/app/dashboard/nomina/fiscal/_components/drilldown-dialog-isr-retenido-nom.tsx` **(NUEVO)** | **FASE D:** Clone pattern drilldown-dialog-cancelados-nom.tsx, reemplazar: (a) Props Readonly + useCallback import. (b) `const ENDPOINT = '/api/dashboard/nomina/fiscal/drilldown/isr_retenido'` const. (c) `type IsrRow = shape endpoint B IsrRow` (18 cols). (d) Columnas tabla: 14 base Cancelados (sin SatStatus Badge color → reemplazar SatStatus por ISR 4 cols: ID Deducción, Tipo Deducción 002, Clave SAT Deducción, Concepto Deducción, Importe ISR MXN). (e) Fila Total Filtrado: `Σ Importe ISR Filtrado` + `Σ Neto CFDI Filtrado` + `Conteo Filas Filtradas`. (f) CSV export: filename `isr_retenido_${companyRfc}_${startDate}_${endDate}.csv` headers ISO 8859-1 BOM Excel (pattern existente). | ~820 líneas (igual pattern dialog cancelados) |
| 5 | `src/app/dashboard/nomina/fiscal/_components/fiscal-nomina-kpis-section.tsx` **(EXISTENTE)** | **FASE E:** Cambiar L180-186 KPI1 ISR Retenido = envolver `<div className="relative">{ KpiCardFiscal ... } <KpiIsrRetenidoTriggerClient /></div>` (MISMA estructura exacta KPI3 Cancelados L194-L208). **NO CAMBIAR:** value fmtMxn(k.isr_retenido_mxn), sublabel TipoDeduccion SAT · 002, tone slate, icon Landmark. | +4 líneas wrapper = 0 cambios visibles UI overlay transparente |
| 6 | `src/app/dashboard/nomina/fiscal/fiscal-nomina-server-page.tsx` **(EXISTENTE)** | **FASE C NO TOCAR.** KpiDrilldownShellNomina ya envuelve Row 3 KpisSectionSuspensed. Los props companyId, startDate, endDate pasan automáticamente a los 5 Dialogs incluyendo el nuevo IsrRetenido. | 0 líneas |

---

## 4. Implementation Steps (Order de Dependencia)

1. **Fase B Endpoint:** Crear carpeta `drilldown/isr_retenido/` → route.ts. Copy-paste structure cancelados route.ts. Cambios: nombre rate limit keys `fn-drillisr-ip`, `fn-drillisr-user`, `fn-drillisr-org`. Zod schema igual cancelados params. SQL $queryRaw: `FROM payroll_deducciones pd` JOIN `payroll_receipts pr` LEFT JOIN `invoices inv` LEFT JOIN `payroll_receptors prr` WHERE `tipo_deduccion = '002'` AND companyId + fecha_pago range. ORDER BY `pd.id ASC` FETCH FIRST limit+1. `IsrRow` 18 campos safe parse safeNum/safeIso/safeStr/safeStrOrNull (fail-soft). Return `{ ok:true, rows, nextCursorId: (len>limit ? rows[limit].deduccionId : null), totalServidor: { ... } }`.
2. **Fase C Context Shell:** En shared.tsx: 5to Context + useState + useCallback + 5to Provider wrap dentro árbol 4 existentes. 5to Dialog mount. Export KpiIsrRetenidoTriggerClient button overlay (aria-label default "Abrir reporte de ISR retenido de nómina").
3. **Fase D Dialog UI:** Nuevo archivo drilldown-dialog-isr-retenido-nom.tsx. Clone pattern cancelados dialog. Columnas 18. Filtros input texto sticky 18 cols. useEffect cuando open=true → fetch endpoint. Paginación cliente 200/page. Botón Exportar CSV con filename correcto. Readonly props wrapper.
4. **Fase E Wrap KPI1:** En kpis-section.tsx, envolver KPI1 `<div className="relative">` + trigger overlay.
5. **Fase E Pipeline Validación:** `npm run lint 0` → `npm run build 0` → GetDiagnostics 0 → Smoke test browser click KPI1 → Dialog abre, endpoint HTTP 200, 0 console errors (sólo INFO), empty state visible.

---

## 5. Dependencies and Considerations

### ⛔ LO QUE NUNCA TOCAMOS (RESTRICCIONES BINDING PEDIDO 15 + AGENTS.md)
1. **NO TOCAR restricción Fail-Closed Redis queue.ts MD-013 AGENTS.md** (estaba relacionado sólo npm run worker:verify que ya arreglamos).
2. **NO TOCAR LÓGICA DE NEGOCIO EXISTENTE:** NO cambiar `mv_fiscal_conciliacion_mensual` SQL, NO cambiar KPI1 tarjeta value/sub-label/icon/tone, NO cambiar endpoints KPI3-6, NO cambiar 4 contexts existentes ni 4 Dialogs existentes ni 4 triggers existentes.
3. **NO CAMBIAR COMPORTAMIENTO UI VISIBLE:** Overlay button transparente z-10 = píxel por píxel idéntico a HOY. Solo cuando el usuario hace click en la tarjeta KPI1 se abre Dialog (mismo comportamiento KPI3 Cancelados).
4. **NO Manejar DECIMAL/BigInt serializados:** 100% IsrRow fields number plain / ISO string / null (safe helpers existentes).
5. **NO OFFSET pagination:** 100% KEYSET `pd.id > cursorId` (performance millones deducciones).

### 🟢 Dependencias Positivas (existen ya, no hay instalar nada)
- safe helpers ya en [fiscal-nomina-drilldown-helpers.ts](file:///c:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/src/lib/fiscal-nomina-drilldown-helpers.ts) (safeNum, safeIso, safeStr, refineDateRange, DRILLDOWN_DEFAULT_PAGE_SIZE).
- Zod + rate limit + prisma.$queryRaw + NextAuth v5 + requireApprovedDashboardAccess / MODULE_PAYROLL_VIEW ya importados en cancelados route.ts → copy-paste.
- Pattern CSV Export BOM Excel ya en 4 dialogs existentes (UTF-8 BOM / ISO 8859-1 encoding).
- Pattern Dialog UI Sticky table + filtros + pag client ya existe (Shadcn Dialog + Table + Pag + Button + Badge components UI).

---

## 6. Validation (Por Fase + Final)

| Fase | Validación OBLIGATORIA |
|---|---|
| Fase B Endpoint | (1) Build 0 / Lint 0. (2) Unit quick: `curl "http://localhost:3000/api/dashboard/nomina/fiscal/drilldown/isr_retenido?companyId=cmtm8jg7j00002qdwcvbvztgh&startDate=2026-06-01&endDate=2026-09-30"` HTTP 200 ok=true rows=[] empty state. (3) Suma auditoria: `SUM(rows[].importeIsr)` al centavo === `mv_fiscal_conciliacion_mensual.isr_retenido_mxn` rango fechas (≤ $0.02 MXN diff redondeo). |
| Fase C Shell | `GetDiagnostics 0` sobre shared.tsx → NO TypeScript assignability Context/Provider types. |
| Fase D Dialog | `npm run lint 0` + `GetDiagnostics 0` (anti [object Object] S6551 / Cognitive ≤15 S3776 / Readonly props S6759 / todos patrones 36 paquetes Sonar existentes). |
| Fase E Wrap + Smoke Pipeline | (1) lint 0. (2) build 0. (3) Integrated Browser click tarjeta ISR Retenido → Dialog abre heading "Reporte · ISR Retenido de Nómina", request `/drilldown/isr_retenido` presente network, 0 console errors/warnings. (4) 4 KPIs drilldown KPI3/KPI4/KPI5/KPI6 siguen OK (no regresiones). |

---

## 7. Risks y Handling

| # | Riesgo | Nivel | ¿Cómo lo evitamos? |
|---|---|---|---|
| R1 | Shape IsrRow concepto/clave `null` (si columns no existen en `payroll_deducciones`) | BAJO | `safeStrOrNull` + mostrar columna "N/D" en tabla; si en runtime runtime query SQL lanza error column not exists → catch fail-soft total + `ok=false error=INVALID_SQL_COLUMN` y pedir team dev agregar columna sin romper UI. |
| R2 | Keyset pagination cursor row NULL (si pd.id UUID no serial?) | BAJO | Zod regex allowlist `DRILLDOWN_ID_REGEX` = [0-9a-zA-Z_$-] 1-64 chars + safe parse query + ORDER BY ASC, si cursor no existe devolver rows desde principio sin crash. |
| R3 | 5to Context Provider → olvidar wrap order y dialog no abre (prop open/onOpenChange undefined) | MEDIO | Clone exact pattern L161-L205 AlertasCtx → agregar 5to IsrCtx POR DENTRO del árbol AlertasCtx. Props open/onOpenChange = drilldownIsrRetenidoOpen / setDrilldownIsrRetenidoOpen. Smoke test Fase E click = dialog abre. |
| R4 | Regresión KPI3-6 al agregar 5to Provider (cambio nesting Context) | MEDIO | **NO CAMBIAR los 4 Contexts/CALLBACKS existentes orden**. Sólo envuelve Isr Provider POR DENTRO (más profundo) que Alertas. Post-validación: Smoke test 4 KPIs KPI3-6 siguen OK (Opción B repetido). |
| R5 | Regresión Sonar Quality Gate (warnings Cognitive >15 / [object Object] / Identical branches) | BAJO | **Clone pattern 100%** KPI3 Cancelados (ya pasó calidad Sonar P1-P36), cambiar solo nombres endpoint y cols tabla. Dialog Cognitive Split 2 helpers + orquestador ≤8 decisiones (pattern P29/P30 RH helpers). |

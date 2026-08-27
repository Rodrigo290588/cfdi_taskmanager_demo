# 🚨 RUNBOOK · ROLLBACK SAST TESTS · Base de Datos + Filesystem

> **Propósito:** Documento operativo de **Emergencia + Prevención** para volver la BD + sistema a su estado `pre-test SAST-API 2026-08-13T23:31:02Z` (checkpoint) si alguna batería de ataques tiene éxito y muta/corrompe datos de manera no deseada.  
> **Dueño del Runbook:** QA Engine TRAE + Operaciones BD (Rodrigo Torre).  
> **Última actualización:** `2026-08-13`.

---

## 🎯 Principio de Diseño · 3 Niveles (Escalación Progresiva)

| NIVEL | Nombre | Caso de Uso | Cuándo usarlo | Tiempo estimado de recuperación | Riesgo |
|-------|--------|-------------|---------------|----------------------------------|--------|
| 🟢 **NIVEL 1** | **Rollback Incremental (SOLO objetos seed SAST + post-checkpoint)** | Un ataque tuvo éxito creando nuevos registros (ej. FIEL credenciales maliciosas, Invoices vía IDOR, MDRs, logos, AuditLog) pero **NO modificó datos productivos existentes**. | Post-ejecución de cada sub-batería (API-00, API-01, API-08, etc.). Entre corridas Newman. | **~1 minuto** | Bajo · No toca datos productivos (rtorreh, pnajera, ODE8604257UA, empresas existentes). |
| 🟡 **NIVEL 2** | **Rollback por Campos Modificados + Filesystem Restore** | Un ataque sobrescribió valores **en filas existentes productivas** (ej. `Company.logo`, `FiscalEntity.businessName`, `Organization.logo`, `Member.role = 'ADMIN'`) pero **no borró filas**. | Si NIVEL 1 dejó residuos en UPDATEs o si un ataque de privilegio cambió roles/statuts. | **~3–5 minutos** | Medio · Toca UPDATEs en filas productivas. Necesita snapshot SQL nativo o UPDATE desde snapshot. |
| 🔴 **NIVEL 3** | **Full Restore del Snapshot** | Hubo **DELETEs de filas productivas**, corrupción de relaciones, o NIVEL 1+2 no alcanzaron. | Caso extremo: ataque DROP TABLE / TRUNCATE exitoso (improbable en app layer) o fallo del engine durante restore. | **~10–20 minutos** | Alto · Irreversible sin backup adicional. **Tomar snapshot adicional ANTES de ejecutar NIVEL 3**. |

---

## 🔐 0 · Pre-requisitos OBLIGATORIOS (hacerlo AHORA, no cuando pase el incendio)

Ejecuta estos pasos **antes de iniciar la batería SAST**. Si no los haces, el rollback NIVEL 3.b (nativo PostgreSQL) no estará disponible.

### 🧪 0.1 Verificar salud del checkpoint actual

```powershell
# 1) Existe snapshot JSON?
Test-Path "reports\db-backups\db-snapshot-sast-pre-tests_2026-08-13T23-31-02.json" | Should -Be $true

# 2) Existen backups nativos de PG (los encontramos en BackUp/)
Get-ChildItem BackUp\*.sql, BackUp\*.backup, BackUp\docker_migration_backup\*.backup -ErrorAction SilentlyContinue | Select-Object FullName, Length
```

Resultado esperado en este entorno:
```
BackUp\backup_full.sql                                   (dump SQL completo pre-existente)
Backup.sql                                               (backup manual)
Cfdi_Taskmanager.backup                                  (formato pg_restore custom)
BackUp\docker_migration_backup\platfi_intelligence_demo.backup
```

### 🧪 0.2 Backup adicional INMEDIATO antes de arrancar tests (HAZLO AHORA — 1 minuto)

**No uses el mismo snapshot de pre-tests. Crea uno nuevo de "pre-batería-actual"**:

```powershell
# OPCIÓN RÁPIDA: Script Prisma JSON snapshot (misma lógica que el original)
npx tsx scripts\create-db-snapshot.mts

# OPCIÓN RECOMENDADA NATIVE PG: pg_dump (si está instalado PostgreSQL o Docker)
# Reemplaza credenciales por tu DATABASE_URL del .env:
# pg_dump -U postgres -d cfdi_taskmanager_demo -Fc -Z9 -f "reports\db-backups\pg-native-pre-sast-bateria-$(Get-Date -Format yyyyMMddTHHmmss).backup"
```

Guarda el nombre del archivo resultante en este bloque:
```
[ ] Snapshot ADICIONAL pre-batería creado en: reports/db-backups/_______________________.json
[ ] Snapshot NATIVO PG creado (si aplica):    reports/db-backups/_______________________.backup
```

### 🧪 0.3 Backup Filesystem de uploads (logos / avatares)

Los ataques de API-10 (PATCH logo) modifican archivos físicos en `public/uploads/`. **Backupear la carpeta entera**:

```powershell
$ts = Get-Date -Format "yyyyMMddTHHmmss"
$dst = "BackUp\uploads-pre-sast-bateria-$ts"
Copy-Item -Recurse -Force public\uploads $dst
Write-Host "Backup uploads OK:" (Get-ChildItem -Recurse $dst | Measure-Object Length -Sum).Sum "bytes en" (Get-ChildItem -Recurse $dst | Measure-Object).Count "archivos"
```

Destino registrado: `BackUp/uploads-pre-sast-bateria-__________/`

### 🧪 0.4 Confirmar DATABASE_URL

```powershell
# Ver .env (sin exponer password completo)
Select-String -Path .env -Pattern "^DATABASE_URL=" | ForEach-Object { $_.Line -replace ":[^:/]+@", ":***@" }
```

### 🧪 0.5 Guardar timestamp de checkpoint oficial en variable

```sql
-- Ejecutar en psql / DBeaver / TablePlus
SET app.sast_checkpoint_ts = '2026-08-13 23:31:02.000+00';
SELECT current_setting('app.sast_checkpoint_ts', true) AS checkpoint_ts;
```

---

## 🟢 NIVEL 1 · Rollback Incremental (Script Prisma · ~1 min)

**Recomendado usar después de cada corrida Newman / sub-batería.** Solo toca los objetos creados por el seed SAST y los registros mutados DESPUÉS del checkpoint.

### ⚙️ Objetos que ELIMINA / modifica

| Objeto | ID / RFC / UUID / Rango de fecha | ¿Toca datos productivos (rtorreh, pnajera, ODE8604257UA, empresas existentes)? |
|--------|-----------------------------------|-------------------------------------------------------------------------------|
| `MassDownloadRequest` | IDs seed `mdr-sast-org-a-prop-001`, `mdr-sast-org-b-aje-001` + todos los `createdAt >= checkpoint` | ❌ No. |
| `SatCredential` | `createdBy contains 'seed-sast'` OR `updatedAt >= checkpoint` | ❌ No (las credenciales FIEL de producción no tienen createdBy='seed-sast'). |
| `Invoice` + `InvoiceBlob` | UUIDs seed `0001, 0002` + `createdAt >= checkpoint`. `InvoiceBlob` se borra en `ON DELETE CASCADE`. | ❌ No (rfc ODE8604257UA empresas productivas NO creadas >= checkpoint). |
| `ImportRun` + `ImportDirectorySession` | `createdAt >= checkpoint` | ❌ No. |
| `CompanyAccess` → `Company` (solo seed RFCS) | `QA2190188S3Z`, `QB2306260K5Y` | ❌ No (RFCS exclusivos de seed, no son rfc de la empresa real). |
| `FiscalEntity` (solo seed) | RFC `QBB7223997V9` | ❌ No (`ODE8604257UA` se conserva intacta). |
| `Member` → `User` (solo emails seed) | `sa-sast@itcomplements.com`, `audit-sast@itcomplements.com`, `other-sast@itcomplements.com` | ❌ No (`rtorreh@itcomplements.com` y `pnajera@itcomplements.com` NO en lista). |
| `AuditLog` | `timestamp >= checkpoint` | ⚠️ Parcial · borra logs de después del checkpoint. Si en el interín hubo acciones productivas del equipo, también se pierden. **Riesgo bajo.** |

### ▶️ Comandos de ejecución

```powershell
# Paso 1: DRY-RUN (OBLIGATORIO · ¡sin cambios en BD!) - ver qué se borraría
npx tsx scripts\rollback-sast-incremental.mts --dry-run

# Paso 2: Ejecutar con cambios (solo si dry-run muestra valores coherentes)
npx tsx scripts\rollback-sast-incremental.mts

# Paso 3: Reiniciar next dev para limpiar el Rate-Limit store (en memoria) + Prisma cache query
# (En PowerShell donde corre next dev: Ctrl+C, luego)
npm run dev
```

### ✅ Validación Post-NIVEL 1

El script NIVEL 1 hace su propia validación automática (10 checks). Si todos pasan, haz además:

```powershell
# Login smoke test manual con ambos usuarios reales
#  - rtorreh@itcomplements.com / Holamundo1?  -> 200 OK, dashboard carga
#  - pnajera@itcomplements.com  / holamundo   -> 200 OK
#  - URL http://localhost:3000/auth/signin
```

---

## 🟡 NIVEL 2 · Rollback de Campos Modificados (Updates + Filesystem)

### 🧠 Escenario típico que lo requiere

- **Ataque IDOR PATCH /api/fiscal-entities/:fe_ajena_id** · El atacante logró sobrescribir `businessName`, `taxRegime`, `postalCode`, `logo` de una **FiscalEntity productiva** (ej. `ODE8604257UA`) — en vez de solo crear registros.
- **Ataque logo path-traversal** logró subir un archivo a `public/uploads/` con nombre conflictivo o sobrescribir un logo existente.
- **Privilege Escalation** cambió `member.role = 'ADMIN'` o `granularPermissions = { ... }` en usuarios productivos.

### 🛠️ 2.1 Restaurar Campos desde Snapshot JSON (UPDATE / UPSERT)

No hay script automatizado (riesgo de UPDATE masivo sin confirmación). **Hacerlo manualmente por 3 filas típicas**:

```sql
-- ====================================================
-- NIVEL 2.a · RESTAURAR valores de tablas productivas
-- Usar el snapshot JSON como fuente (abrirlo, buscar la fila por RFC/ID).
-- ====================================================

BEGIN;

-- 1) FiscalEntity productiva: RFC = ODE8604257UA (FE Org-A productiva)
UPDATE fiscal_entities
SET business_name  = (SELECT snapshot_val FROM (VALUES ('Empresa Demo')) s(snapshot_val)),
    tax_regime     = '601',
    postal_code    = '11520',
    is_active      = true,
    updated_at     = CURRENT_TIMESTAMP
WHERE rfc = 'ODE8604257UA';

-- 2) Company productiva: rfc = ODE8604257UA (si aplica al modelo Company no FiscalEntity)
UPDATE companies
SET name            = (SELECT snapshot_val FROM (VALUES ('OPTICAS DEVLYN')) s(snapshot_val)),
    business_name   = 'OPTICAS DEVLYN SA DE CV',
    status          = 'APPROVED',
    updated_at      = CURRENT_TIMESTAMP
WHERE rfc = 'ODE8604257UA';

-- 3) Membership de rtorreh Org-A: role=ADMIN, status=APPROVED (por si ataque de priv escal)
UPDATE members
SET role    = 'ADMIN',
    status  = 'APPROVED',
    granular_permissions = '{}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE email = 'rtorreh@itcomplements.com')
  AND organization_id = 'cmnntrppk000502gcp93ketfx';

-- 4) Membership de pnajera Org-B
UPDATE members
SET role    = 'ADMIN',
    status  = 'APPROVED',
    granular_permissions = '{}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE email = 'pnajera@itcomplements.com')
  AND organization_id = 'cmipiwlqk000mvyvtc22tnlrb';

COMMIT;
```

### 🛠️ 2.2 Restaurar Filesystem (carpeta uploads)

```powershell
# Copia overwriting de todo public/uploads desde el backup 0.3
Remove-Item -Recurse -Force public\uploads -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force BackUp\uploads-pre-sast-bateria-________ public\uploads
```

### 🛠️ 2.3 Resetear Redis (BullMQ jobs corruptos / Rate-Limit Redis)

```powershell
# Solo si RL está configurado con Redis o hay jobs en colas corruptos:
# redis-cli.exe FLUSHDB   (limpia todo Redis)
# Alternativa más segura (solo colas SAST):
$redisClient = [StackExchange.Redis.ConnectionMultiplexer]::Connect("localhost:6379")
$db = $redisClient.GetDatabase(0)
# Borrar prefijos rate-limit:* y bull:masive-downloads:*
```

### ✅ Validación Post-NIVEL 2

```
[ ] Login OK para rtorreh / pnajera
[ ] Dashboard Fiscal muestra datos productivos (Dashboard cards) sin NaN
[ ] Página /companies lista la compañía ODE8604257UA con nombre original
[ ] Logo de tenant / company visualiza la imagen original (no placeholder roto)
[ ] GET /api/auth/session devuelve org correcta y role correcto.
```

---

## 🔴 NIVEL 3 · Full Restore (Escalación Máxima)

**⚠️ Sólo usar si NIVEL 1 + NIVEL 2 no resolvieron el problema (hubo DELETEs masivos o corrupción de integridad referencial).**

### 🔴 3.a · Restore desde snapshot Prisma JSON (script)

**Ventaja**: No requiere `pg_dump` instalado. Usa el JSON de 85 MB generado por `create-db-snapshot.mts`.
**Limitación**: Prisma `deleteMany({})` no es TRUNCATE; tarda más en tablas grandes (~30k invoices tarda 30s). Decimal fields son recreados como `Prisma.Decimal`.

```powershell
# DRY-RUN obligatorio para confirmar orden de tablas y conteos
npx tsx scripts\restore-db-snapshot-full.mts --dry-run

# Ejecutar. El snapshot se toma por default del archivo pre-SAST, o sobreescribes:
# $env:SAST_SNAPSHOT_PATH="reports\db-backups\TU-SNAPSHOT-ADICIONAL.json"
npx tsx scripts\restore-db-snapshot-full.mts
```

### 🔴 3.b · Restore Nativo PostgreSQL (pg_restore) — RECOMENDADO SI DISPONIBLE

```powershell
# 1) Localizar el backup .backup custom más reciente:
#    BackUp\docker_migration_backup\platfi_intelligence_demo.backup
#    Cfdi_Taskmanager.backup

# 2) Cerrar conexiones activas (IMPORTANTE · bloquea next dev si está escribiendo)
#    (Primero detén next dev y worker con Ctrl+C)

# 3) pg_restore en modo clean (sobrescribe)
# pg_restore -U postgres -d cfdi_taskmanager_demo --clean --if-exists --jobs=4 BackUp\docker_migration_backup\platfi_intelligence_demo.backup
```

### 🔴 3.c · Post-Common (después de 3.a o 3.b)

```powershell
# A) ¡Regenerar Prisma Client! (por si hubo drift de schema)
npx prisma generate

# B) Migrate deploy para asegurar que el restore no esté detrás en migrations
npx prisma migrate deploy

# C) Si se usó NIVEL 3.a JSON: Re-ejecutar seed SAST para volver a tener IDs deterministas si quieres repetir batería
npx tsx scripts\seed-sast-fixtures.mts

# D) Restore uploads (como NIVEL 2.2) + Reiniciar servicios
Remove-Item -Recurse -Force public\uploads
Copy-Item -Recurse BackUp\uploads-pre-sast-bateria-________ public\uploads
npm run dev
```

---

## 📋 Checklist maestro · Protocolo completo Pre / Post batería

### 🚦 ANTES de iniciar la primera sub-batería

```
PRE-01 [ ] Crear snapshot adicional PRE-BATERIA (create-db-snapshot.mts)
PRE-02 [ ] Backupear public/uploads/ a BackUp/uploads-pre-sast-bateria-<ts>/
PRE-03 [ ] Verificar que next dev esté en localhost:3000 y saludable (GET /api/health)
PRE-04 [ ] Verificar Redis activo (ping localhost:6379 PONG) y BullMQ worker si se prueba MDR async
PRE-05 [ ] Tener Postman collection importada y variables cargadas (0 auth tokens sin caducidad)
PRE-06 [ ] Definir ventana: "Si pasa >30 min sin commit a Newman, hacemos NIVEL 1 para no arrastrar residuos"
```

### 🚦 DESPUÉS de cada sub-batería (API-00, API-01, API-02, …)

```
SUB-01 [ ] Ejecutar NIVEL 1 dry-run y validar conteos esperados
SUB-02 [ ] Si no hubo 403/404 esperados, marcar el finding y NO limpiar aún (para evidencia)
SUB-03 [ ] Ejecutar NIVEL 1 (real) para limpiar residuos antes de entrar al siguiente endpoint
SUB-04 [ ] Reiniciar next dev si hubo rate-limit hits
```

### 🚦 FINAL de batería completa (Newman All Tests passed o todos los findings documentados)

```
FIN-01 [ ] Ejecutar NIVEL 1 dry-run, confirmar 0 filas residuales
FIN-02 [ ] Correr validación manual: login con usuarios reales, dashboard, invoices list, companies list
FIN-03 [ ] Documentar en reports/sast-tests/<fecha>/EXECUTION-SUMMARY.md cuántas veces se usó NIVEL 1/2/3
FIN-04 [ ] Borrar snapshots temporales adicionales si todo está OK (conservar el checkpoint pre-SAST original por 30 días)
FIN-05 [ ] Hacer commit de SAST findings al changelog / reporte y cerrar el ciclo.
```

---

## 🚨 Árbol de decisión · ¿Qué nivel uso?

```
¿Hubo algún ataque con éxito (escape / datos leak / privilegio escalado)?
├─ NO →  Sigue a la siguiente sub-batería. Usa NIVEL 1 entre corridas para limpiar residuos normales (AuditLogs, ImportRuns temporales).
└─ SÍ →  ¿El daño fue INSERCIONES de nuevas filas solamente?
         ├─ SÍ →  NIVEL 1 · rollback-sast-incremental.mts → FIN (si validación pasa)
         └─ NO →  ¿El daño fue UPDATES de filas productivas (name/logo/role)?
                  ├─ SÍ →  NIVEL 2 (SQL UPDATEs manuales + restore filesystem uploads) → FIN
                  └─ NO →  ¿Hubo DELETEs / TRUNCATE / corrupción FKs?
                           ├─ SÍ →  NIVEL 3.a o 3.b (FULL RESTORE) → Post-Common
                           └─ No sé →  Empieza por NIVEL 1, sube de nivel si la validación post-rollback NO pasa.
```

---

## 🧷 Referencias / Archivos usados

| Recurso | Ruta |
|---------|------|
| Snapshot pre-SAST default JSON | [reports/db-backups/db-snapshot-sast-pre-tests_2026-08-13T23-31-02.json](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/reports/db-backups/db-snapshot-sast-pre-tests_2026-08-13T23-31-02.json) |
| IDs semilla SAST (para NIVEL 1) | [reports/SAST-SEED-IDS.json](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/reports/SAST-SEED-IDS.json) |
| Script NIVEL 1 | [scripts/rollback-sast-incremental.mts](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/scripts/rollback-sast-incremental.mts) |
| Script NIVEL 3.a (full JSON) | [scripts/restore-db-snapshot-full.mts](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/scripts/restore-db-snapshot-full.mts) |
| Script generar snapshot nuevo | [scripts/create-db-snapshot.mts](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/scripts/create-db-snapshot.mts) |
| Script recrear scoping data (post rollback para repetir tests) | [scripts/seed-sast-fixtures.mts](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/scripts/seed-sast-fixtures.mts) |
| Carpeta backups nativos PG | `BackUp/` (raíz proyecto) · `backup_full.sql`, `Cfdi_Taskmanager.backup`, `docker_migration_backup/*` |
| Carpeta uploads (filesystem) | `public/uploads/` · `company-logos/`, `logos/`, `avatars/` |
| Colección Postman para smoketest | [CFDI-TaskManager-SAST.postman_collection.json](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/CFDI-TaskManager-SAST.postman_collection.json) |
| Checklist preflight SAST | [reports/SAST-API-CHECKS-PREFLIGHT-20260813.md](file:///C:/ITC_IA/cfditaskmanager_demo/cfdi_taskmanager_demo/reports/SAST-API-CHECKS-PREFLIGHT-20260813.md) |

---

**Fin del RUNBOOK.**  
⚠️ **Regla de oro**: Siempre ejecuta `--dry-run` primero. Siempre haz un snapshot adicional antes de cada NIVEL 2 o NIVEL 3. Nunca saltes de nivel sin pasar por la validación del nivel inferior primero.

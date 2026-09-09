#requires -Version 5.1
<#
.SYNOPSIS
  BARRERA 1c — Restaura un snapshot de respaldo (.dump) sobre la base DEV (dev-itc:5433).
  ¡¡ATENCIÓN!! ESTA OPERACIÓN BORRA Y SUSTITUYE COMPLETAMENTE LA BASE DE DATOS DE DEV.
  Asegúrate de que eliges el archivo correcto antes de confirmar.

.DESCRIPCIÓN (no técnico)
  1) Lista los últimos 10 backups disponibles en carpeta backups/dev/.
  2) Si NO le pasas -File, selecciona el más reciente automáticamente (con confirmación).
  3) Sube el archivo .dump dentro del contenedor Docker dev-itc.
  4) Usa pg_restore con las banderas --clean --if-exists: borra todo lo actual y
     restaura la foto (tablas, filas, vistas materializadas, índices, funciones).
  5) Al final, corre ANALYZE para que Postgres actualice sus estadísticas
     (las consultas del tablero fiscal/RH van más rápido).
  6) Muestra un resumen + conteo de usuarios y empresas restaurados para cross-check.

.EJEMPLOS
  .\scripts\db-dev-restore.ps1                              # = elije ÚLTIMO backup (pide confirmación)
  .\scripts\db-dev-restore.ps1 -AutoConfirm                  # ÚLTIMO + NO pide confirmación (para pipelines)
  .\scripts\db-dev-restore.ps1 -File "20260903_1845_platfi_intelligence_demo.dump"
  .\scripts\db-dev-restore.ps1 -File "20260903_1845_platfi_intelligence_demo.dump" -AutoConfirm
#>
[CmdletBinding()]
param(
  [string] $File = "",
  [switch] $AutoConfirm,
  [string] $ContainerName = "dev-itc",
  [string] $DbUser        = "postgres",
  [string] $DbPass        = "postgres",
  [string] $DbName        = "platfi_intelligence_demo"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupDir   = Join-Path $ProjectRoot "backups\dev"

if (-not (Test-Path $BackupDir)) {
  throw "No existe carpeta backups/dev/ — parece que no has tomado ningún backup todavía. Corre primero scripts\db-dev-snapshot.ps1."
}

# --- Paso 1: Identificar archivo .dump a restaurar
$available = Get-ChildItem -Path $BackupDir -Filter "*.dump" | Sort-Object LastWriteTime -Descending
if (-not $available -or $available.Count -eq 0) {
  throw "No hay archivos .dump en $BackupDir. Genera un backup primero."
}
Write-Host ""
Write-Host "==========================================================="
Write-Host " RESTAURAR BACKUP SOBRE BASE DE DATOS DESARROLLO (DEV)"
Write-Host " ⚠️  BORRARÁ COMPLETAMENTE EL ESTADO ACTUAL DE LA DB DEV"
Write-Host "==========================================================="
Write-Host ""
Write-Host "Backups disponibles (últimos 10):"
$available | Select-Object -First 10 | Format-Table -AutoSize -Property @(
  @{N="Índice"; E={ $available.IndexOf($_)+1 }},
  @{N="Fecha/hora"; E={ $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss") }},
  @{N="Nombre"; E={ $_.Name }},
  @{N="Tamaño KB"; E={ [math]::Round($_.Length/1KB,2) }}
) | Out-String -Stream | ForEach-Object { Write-Host "  $_" }

if ($File) {
  $filePath = Join-Path $BackupDir $File
  if (-not (Test-Path $filePath)) { throw "No existe el archivo $filePath" }
} else {
  $filePath = $available[0].FullName
  Write-Host ""
  Write-Host "👉 Sin -File: eligiendo automáticamente el backup MÁS RECIENTE = $($available[0].Name)"
}
$fileName = Split-Path -Leaf $filePath
$fileSize = [math]::Round((Get-Item $filePath).Length / 1KB, 2)

# --- Paso 2: Confirmación doble antes de borrar la DEV
Write-Host ""
Write-Host "Archivo a restaurar: $fileName  ($fileSize KB)"
Write-Host "Base de datos DESTINO: $DbName  (contenedor Docker $ContainerName)"
Write-Host ""
if (-not $AutoConfirm) {
  $ans = Read-Host "Escribe 'RESTORE_$DbName' y pulsa ENTER para CONFIRMAR (cualquier otro texto cancela)"
  if ($ans -ne "RESTORE_$DbName") {
    Write-Host "❌ Restauración cancelada por el usuario."
    exit 0
  }
}

# --- Paso 3: Verificar contenedor corriendo
$running = docker inspect --format '{{.State.Running}}' $ContainerName 2>&1
if ($LASTEXITCODE -ne 0 -or $running -ne "true") {
  throw "Contenedor '$ContainerName' NO está corriendo. docker start $ContainerName y vuelve a intentar."
}

# --- Paso 4: Subir archivo al contenedor
$ContainerTmp = "/tmp/restore_$fileName"
Write-Host "[1/5] 🚛 Copiando backup al contenedor..."
docker cp $filePath "$($ContainerName):$ContainerTmp" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker cp falló al subir el backup." }
Write-Host "[1/5] ✅ Backup cargado en contenedor."

# --- Paso 5: pg_restore --clean --if-exists (destructivo sobre db DESTINO)
$EnvPass = "PGPASSWORD=$DbPass"
Write-Host "[2/5] 🔥 pg_restore --clean --if-exists  (sobre $DbName)..."
docker exec -it $ContainerName sh -lc `
  "$EnvPass pg_restore -U $DbUser -d $DbName --clean --if-exists --no-owner --no-privileges -Fc $ContainerTmp" 2>&1 |
  Out-String -Stream | ForEach-Object { Write-Host "       $_" }
if ($LASTEXITCODE -ne 0) {
  Write-Warning "pg_restore reportó warnings (exit=$LASTEXITCODE). Revisa las líneas de arriba; los Warnings sobre objetos que no existen en --clean son NORMALES."
}
Write-Host "[2/5] ✅ pg_restore finalizado."

# --- Paso 6: ANALYZE para estadísticas de query planner
Write-Host "[3/5] 📊 ANALYZE todas las tablas..."
docker exec -it $ContainerName sh -lc "$EnvPass psql -U $DbUser -d $DbName -c 'ANALYZE;'" 2>&1 | Out-Null
Write-Host "[3/5] ✅ ANALYZE completado."

# --- Paso 7: Limpieza archivo temporal
docker exec -it $ContainerName sh -lc "rm -f $ContainerTmp" 2>&1 | Out-Null
Write-Host "[4/5] ✅ Archivo temporal en contenedor eliminado."

# --- Paso 8: Verificación cross-check
Write-Host "[5/5] 🔍 Verificación post-restauración (conteos rápidos):"
$checksSql = @'
  SELECT 'users_restored'       AS c, COUNT(*)::TEXT AS v FROM public.users;
  SELECT 'companies_restored'   AS c, COUNT(*)::TEXT AS v FROM public.companies;
  SELECT 'members_restored'     AS c, COUNT(*)::TEXT AS v FROM public.members WHERE status='APPROVED';
  SELECT 'mv_fiscal_exists'     AS c, COALESCE(to_regclass('public.mv_fiscal_conciliacion_mensual')::TEXT, 'NO') AS v;
  SELECT 'mv_hr_count'          AS c, COUNT(*)::TEXT AS v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='m' AND c.relname LIKE 'mv_hr_%';
'@
$checksFile = Join-Path $env:TEMP "dev_restore_check_$(Get-Date -Format 'yyyyMMddHHmmss').sql"
Set-Content -Path $checksFile -Value $checksSql -Encoding UTF8
$containerChecks = "/tmp/check_restore.sql"
docker cp $checksFile "$($ContainerName):$containerChecks" 2>&1 | Out-Null
docker exec -it $ContainerName sh -lc "$EnvPass psql -U $DbUser -d $DbName -f $containerChecks" 2>&1 |
  Out-String -Stream | ForEach-Object { Write-Host "       $_" }
Remove-Item $checksFile -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "============================================================"
Write-Host " ✅ Restauración completada: $fileName"
Write-Host " ============================================================"
Write-Host " * Base DEV ahora refleja el estado del backup seleccionado."
Write-Host " * Si los datos son muy antiguos, recuerda reingestar nuevos CFDIs o corre npm run seed:dev."
Write-Host " * Prueba login con admin@itcomplements.com o rtorreh@itcomplements.com."
Write-Host "============================================================"

#requires -Version 5.1
<#
.SYNOPSIS
  BARRERA 1a — Respaldo lógico completo (pg_dump -Fc) de la base de datos DEV (dev-itc : 5433).
  Se ejecuta manualmente antes de operaciones destructivas, o automáticamente cada 24 hrs
  mediante Tarea Programada de Windows (ver db-dev-install-scheduled-backup.ps1).

.DESCRIPCIÓN (no técnico)
  1) Se conecta al PostgreSQL DEV que corre dentro del contenedor Docker "dev-itc".
  2) Crea una carpeta backups/dev/ en el root del proyecto (si no existe).
  3) Ejecuta pg_dump para sacar una foto comprimida 1:1 de TODAS las tablas (users, companies,
     payroll_receipts, mv_fiscal*, mv_hr*, etc.) y nombra el archivo con fecha-hora.
  4) Borra automáticamente los backups de más de 14 días (retención configurable).
  5) Imprime un resumen con tamaño del archivo, nombre y fecha para que quede evidencia.

.EJEMPLOS
  .\scripts\db-dev-snapshot.ps1                         # Backup normal con retención 14 días
  .\scripts\db-dev-snapshot.ps1 -RetentionDays 30       # Retención 30 días (por si sales de vacaciones)
  .\scripts\db-dev-snapshot.ps1 -Tag "antes-de-reset"   # Agrega un sufijo descriptivo al nombre
#>

[CmdletBinding()]
param(
  [int]   $RetentionDays = 14,
  [string]$Tag = "",
  [string]$ContainerName = "dev-itc",
  [string]$DbUser        = "postgres",
  [string]$DbPass        = "postgres",
  [string]$DbName        = "platfi_intelligence_demo"
)

$ErrorActionPreference = "Stop"
$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$BackupDir    = Join-Path $ProjectRoot "backups\dev"
$Timestamp    = Get-Date -Format "yyyyMMdd_HHmmss"
$TagPart      = if ($Tag) { "_$Tag" } else { "" }
$DumpFileName = "$($Timestamp)_$($DbName)$TagPart.dump"
$DumpPath     = Join-Path $BackupDir $DumpFileName
$ContainerTmp = "/tmp/$DumpFileName"

Write-Host "============================================================"
Write-Host " BACKUP BASE DE DATOS DESARROLLO (DEV — Docker $ContainerName)"
Write-Host "============================================================"
Write-Host "Proyecto         : $ProjectRoot"
Write-Host "Carpeta respaldos: $BackupDir"
Write-Host "Base de datos    : $DbName"
Write-Host "Retención días   : $RetentionDays"
if ($Tag) { Write-Host "Etiqueta (tag)   : $Tag" }
Write-Host ""

# --- Paso 1: Asegurar carpeta de respaldos local
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
Write-Host "[1/6] ✅ Carpeta respaldos lista."

# --- Paso 2: Verificar contenedor Docker corriendo
$dockerPs = docker inspect --format '{{.State.Running}}' $ContainerName 2>&1
if ($LASTEXITCODE -ne 0 -or $dockerPs -ne "true") {
  throw "Contenedor Docker '$ContainerName' NO está corriendo. Inícialo con: docker start $ContainerName"
}
Write-Host "[2/6] ✅ Contenedor Docker $ContainerName activo."

# --- Paso 3: Ejecutar pg_dump (formato comprimido custom = ideal para pg_restore selectivo)
$EnvPass = "PGPASSWORD=$DbPass"
Write-Host "[3/6] 🔥 Ejecutando pg_dump dentro del contenedor..."
docker exec -it $ContainerName sh -lc `
  "$EnvPass pg_dump -U $DbUser -d $DbName -Fc -Z 9 -f $ContainerTmp" 2>&1 | Out-String -Stream | ForEach-Object { Write-Host "       $_" }
if ($LASTEXITCODE -ne 0) { throw "pg_dump falló con exit=$LASTEXITCODE" }
Write-Host "[3/6] ✅ pg_dump completado dentro del contenedor ($ContainerTmp)."

# --- Paso 4: Copiar backup de container a carpeta local del proyecto
docker cp "$($ContainerName):$ContainerTmp" $DumpPath 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker cp falló al traer el backup al host." }
$DumpSize = [math]::Round((Get-Item $DumpPath).Length / 1KB, 2)
Write-Host "[4/6] ✅ Respaldo copiado a host: $DumpFileName  (tamaño: $DumpSize KB)."

# --- Paso 5: Limpiar respaldo dentro del contenedor para no ocupar espacio
docker exec -it $ContainerName sh -lc "rm -f $ContainerTmp" 2>&1 | Out-Null
Write-Host "[5/6] ✅ Archivo temporal dentro del contenedor eliminado."

# --- Paso 6: Retención — borrar archivos > $RetentionDays
$cutoff = (Get-Date).AddDays(-$RetentionDays)
$toDelete = Get-ChildItem -Path $BackupDir -Filter "*.dump" | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($toDelete) {
  $toDelete | ForEach-Object {
    Write-Host "       🗑️  Retención: borrando backup antiguo  $($_.Name)  ($($_.LastWriteTime))"
    Remove-Item $_.FullName -Force
  }
  Write-Host "[6/6] ✅ Retención aplicada: $($toDelete.Count) archivo(s) antiguo(s) eliminados."
} else {
  Write-Host "[6/6] ✅ Retención aplicada: sin archivos que eliminar."
}

Write-Host ""
Write-Host "============================[ RESUMEN ]==========================="
Write-Host " Archivo   : $DumpFileName"
Write-Host " Ubicación : $DumpPath"
Write-Host " Tamaño    : $DumpSize KB"
Write-Host " Fecha/hora: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host " Para restaurar: .\scripts\db-dev-restore.ps1 -File '$DumpFileName'"
Write-Host "=================================================================="

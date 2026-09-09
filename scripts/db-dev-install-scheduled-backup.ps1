#requires -Version 5.1 -RunAsAdministrator
<#
.SYNOPSIS
  BARRERA 1b (instalación one-time) — Crea una Tarea Programada de Windows
  que ejecuta el backup de la base de datos DEV cada 24 horas a las 03:00 AM,
  sin necesidad de que nadie esté loggeado.

.DESCRIPCIÓN (no técnico)
  Tienes que ejecutar ESTE SCRIPT UNA SOLA VEZ (como Administrador) y ya olvidas
  del backup: todas las madrugadas a las 3 AM Windows le dice a Docker:
  "toma foto de la base DEV, guardala en backups/dev/ y borra las fotos > 14 días".
  No necesita que abras la terminal ni que prendas el servidor de Node;
  solo necesita que Docker Desktop esté corriendo (lo normal en tu equipo).

.SI QUIERES PERSONALIZAR
  Cambia $StartHour = "03:00" por la hora que prefieras (ej: "22:00" = 10 PM).

.VERIFICAR QUE QUEDÓ BIEN
  1) Abrir "Programador de tareas" (taskschd.msc) → carpeta \ITComplements\
  2) Debe aparecer: "Backup Dev Platfi Intelligence (cada 24h 03AM)"
  3) Darle clic derecho → Ejecutar para probar one-shot sin esperar a medianoche.
#>
[CmdletBinding()]
param(
  [string]$StartHour = "03:00",
  [string]$TaskName  = "Backup Dev Platfi Intelligence (cada 24h 03AM)",
  [string]$TaskPath  = "\ITComplements\"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath  = Join-Path $ProjectRoot "scripts\db-dev-snapshot.ps1"
$LogDir      = Join-Path $ProjectRoot "backups\dev\logs"
$LogPath     = Join-Path $LogDir     "backup-scheduled-run.log"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

if (-not (Test-Path $ScriptPath)) {
  throw "No encontré $ScriptPath. Asegúrate de correr este script desde el root del proyecto."
}

$action  = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$ScriptPath`" >> `"$LogPath`" 2>&1" `
  -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $StartHour
$trigger.Repetition.Interval = "P1D"   # Periodo de repetición = 1 día

$principal = New-ScheduledTaskPrincipal -UserId "$($env:USERDOMAIN)\$($env:USERNAME)" -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun:$false `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5) `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName -TaskPath $TaskPath `
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Backup diario 03:00 AM DB DEV (platfi_intelligence_demo Docker dev-itc). Retención configurable en db-dev-snapshot.ps1 (default 14 días)." `
  -Force | Out-Null

Write-Host ""
Write-Host "==========================================================="
Write-Host "  ✅  TAREA PROGRAMADA INSTALADA (cada 24h a las $StartHour)"
Write-Host "==========================================================="
Write-Host "  Nombre tarea : $TaskName"
Write-Host "  Carpeta      : $TaskPath  (en Programador de tareas)"
Write-Host "  Ejecuta      : $ScriptPath"
Write-Host "  Log salida   : $LogPath"
Write-Host ""
Write-Host "  👉  Probar HOY (no esperar a medianoche):"
Write-Host '       Get-ScheduledTask -TaskPath "'"$TaskPath"'" -TaskName "'"$TaskName"'" | Start-ScheduledTask'
Write-Host "  👉  Ver el resultado inmediatamente:"
Write-Host "       Get-Content '$LogPath' -Tail 30"
Write-Host "  👉  Desinstalar la tarea si lo necesitas:"
Write-Host '       Unregister-ScheduledTask -TaskPath "'"$TaskPath"'" -TaskName "'"$TaskName"'" -Confirm:$false'
Write-Host ""

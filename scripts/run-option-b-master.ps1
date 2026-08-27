$ErrorActionPreference = 'Stop'
$rep = "reports\sast-tests"
if (!(Test-Path $rep)) { New-Item -ItemType Directory -Path $rep -Force | Out-Null }
$ts = Get-Date -Format "yyyyMMddTHHmmss"
$logFile = Join-Path $rep ("opcion-B-master-$ts.log")
Start-Transcript -Path $logFile -Force | Out-Null

Write-Host ""
Write-Host "==================================== OPCION B - MAESTRO ====================================" -ForegroundColor Cyan
Write-Host "  PASO 1/3: Correr OPCION-A (Smoke Happy-Path baseline feliz)" -ForegroundColor Cyan
Write-Host "  PASO 2/3: Rollback NIVEL 1 (incremental post-checkpoint + seed IDs)" -ForegroundColor Cyan
Write-Host "  PASO 3/3: Re-seed fixtures SAST limpios (estado baseline exacto)" -ForegroundColor Cyan
Write-Host "============================================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[PASO 1/3] Ejecutando OPCION-A: run-option-a-happy.ps1 ..." -ForegroundColor Magenta
$aStart = Get-Date
& powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-option-a-happy.ps1"
$aExit = $LASTEXITCODE
$aDur = (Get-Date) - $aStart
Write-Host ("  OPCION-A finalizada. ExitCode={0}. Duracion={1:mm}m {1:ss}s." -f $aExit, $aDur) -ForegroundColor $(if ($aExit -eq 0) {'Green'} else {'Yellow'})
Write-Host ""

Write-Host "[PASO 2/3] Rollback NIVEL 1 incremental: rollback-sast-incremental.mts --dry-run=false ..." -ForegroundColor Magenta
$rbStart = Get-Date
Push-Location $PSScriptRoot\..
try {
  & npx --yes tsx scripts\rollback-sast-incremental.mts --dry-run=false 2>&1 | Tee-Object -Variable rbOut
  $rbExit = $LASTEXITCODE
} finally {
  Pop-Location
}
$rbDur = (Get-Date) - $rbStart
Write-Host ("  Rollback finalizado. ExitCode={0}. Duracion={1:mm}m {1:ss}s." -f $rbExit, $rbDur) -ForegroundColor $(if ($rbExit -eq 0) {'Green'} else {'Yellow'})
Write-Host ""

Write-Host "[PASO 3/3] Re-seed SAST fixtures limpios: seed-sast-fixtures.mts ..." -ForegroundColor Magenta
$sdStart = Get-Date
Push-Location $PSScriptRoot\..
try {
  & npx --yes tsx scripts\seed-sast-fixtures.mts 2>&1 | Tee-Object -Variable sdOut
  $sdExit = $LASTEXITCODE
} finally {
  Pop-Location
}
$sdDur = (Get-Date) - $sdStart
Write-Host ("  Seed finalizado. ExitCode={0}. Duracion={1:mm}m {1:ss}s." -f $sdExit, $sdDur) -ForegroundColor $(if ($sdExit -eq 0) {'Green'} else {'Yellow'})
Write-Host ""

Write-Host "==================================== RESUMEN OPCION B ====================================" -ForegroundColor Cyan
$okB = 0
if ($aExit -eq 0)  { Write-Host "  [PASS] PASO 1 - OPCION-A Smoke Happy-Path" -ForegroundColor Green; $okB++ }
else { Write-Host "  [FAIL] PASO 1 - OPCION-A (Exit=$aExit)" -ForegroundColor Yellow }
if ($rbExit -eq 0) { Write-Host "  [PASS] PASO 2 - Rollback NIVEL 1 incremental" -ForegroundColor Green; $okB++ }
else { Write-Host "  [FAIL] PASO 2 - Rollback (Exit=$rbExit)" -ForegroundColor Yellow }
if ($sdExit -eq 0) { Write-Host "  [PASS] PASO 3 - Re-seed SAST fixtures" -ForegroundColor Green; $okB++ }
else { Write-Host "  [FAIL] PASO 3 - Seed (Exit=$sdExit)" -ForegroundColor Yellow }
Write-Host ("  OPCION B OK: {0} / 3 pasos." -f $okB) -ForegroundColor $(if ($okB -eq 3) {'Green'} else {'Yellow'})
Write-Host ""
Write-Host ("  Log maestro OPCION-B: {0}" -f $logFile) -ForegroundColor Gray
Write-Host "  SIGUIENTE: Estado baseline limpio y determinista listo para OPCION-C (ataques SAST)." -ForegroundColor Cyan
Stop-Transcript | Out-Null
exit (3 - $okB)

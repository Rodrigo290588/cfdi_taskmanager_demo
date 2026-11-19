[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

function Get-ExistingEncryptionKeys {
  param(
    [string[]]$EnvironmentFiles,
    [string]$VariableName
  )

  $values = [System.Collections.Generic.List[string]]::new()
  $variablePattern = '(?m)^\s*(?:export\s+)?' + [regex]::Escape($VariableName) + '\s*=(.*)$'

  foreach ($file in $EnvironmentFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      continue
    }

    $content = [System.IO.File]::ReadAllText($file)
    foreach ($match in [regex]::Matches($content, $variablePattern)) {
      $value = $match.Groups[1].Value.Trim().Trim('"').Trim("'")
      if ($value) {
        $values.Add($value)
      }
    }
  }

  foreach ($scope in @('Process', 'User', 'Machine')) {
    $value = [Environment]::GetEnvironmentVariable($VariableName, $scope)
    if ($value) {
      $values.Add($value)
    }
  }

  return $values
}

function Add-Pm2EnvironmentMapping {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$AppName,
    [string]$VariableName
  )

  $namePattern = '^\s*name\s*:\s*["'']' + [regex]::Escape($AppName) + '["'']\s*,?\s*$'
  $appIndex = -1
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match $namePattern) {
      $appIndex = $index
      break
    }
  }

  if ($appIndex -lt 0) {
    throw "No se encontró la aplicación PM2 '$AppName' en ecosystem.config.js."
  }

  $envStart = -1
  $nextAppIndex = $Lines.Count
  for ($index = $appIndex + 1; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match '^\s*name\s*:') {
      $nextAppIndex = $index
      break
    }
    if ($Lines[$index] -match '^\s*env\s*:\s*\{\s*,?\s*$') {
      $envStart = $index
      break
    }
  }

  if ($envStart -lt 0 -or $envStart -ge $nextAppIndex) {
    throw "No se encontró un bloque env simple para '$AppName'; no se modificó ecosystem.config.js."
  }

  $envIndent = [regex]::Match($Lines[$envStart], '^\s*').Value
  $closePattern = '^' + [regex]::Escape($envIndent) + '\},?\s*$'
  $envEnd = -1
  for ($index = $envStart + 1; $index -lt $nextAppIndex; $index++) {
    if ($Lines[$index] -match $closePattern) {
      $envEnd = $index
      break
    }
    if ($Lines[$index].Contains('{') -or $Lines[$index].Contains('}')) {
      throw "El bloque env de '$AppName' contiene una estructura no reconocida; no se modificó."
    }
  }

  if ($envEnd -lt 0) {
    throw "No se pudo localizar el cierre del bloque env de '$AppName'."
  }

  $mappingIndex = -1
  for ($index = $envStart + 1; $index -lt $envEnd; $index++) {
    if ($Lines[$index] -match ('^\s*' + [regex]::Escape($VariableName) + '\s*:')) {
      $mappingIndex = $index
      if ($Lines[$index] -notmatch ('process\.env\.' + [regex]::Escape($VariableName))) {
        throw "Ya existe $VariableName en el bloque env de '$AppName'; revísalo manualmente."
      }
      break
    }
  }

  for ($index = $envStart + 1; $index -lt $envEnd; $index++) {
    if ($Lines[$index] -match '^\s*[A-Za-z_$][\w$]*\s*:' -and $Lines[$index].TrimEnd() -notmatch ',\s*$') {
      $Lines[$index] += ','
    }
  }

  if ($mappingIndex -lt 0) {
    $mapping = $envIndent + '  ' + $VariableName + ': process.env.' + $VariableName + ','
    $Lines.Insert($envEnd, $mapping)
  }
}

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$envPath = Join-Path $resolvedRoot '.env'
$ecosystemPath = Join-Path $resolvedRoot 'ecosystem.config.js'

if (-not (Test-Path -LiteralPath $ecosystemPath -PathType Leaf)) {
  throw "No se encontró ecosystem.config.js en '$resolvedRoot'. Ejecuta el script dentro del proyecto de producción o indica -ProjectRoot."
}

$environmentFiles = @(
  (Join-Path $resolvedRoot '.env'),
  (Join-Path $resolvedRoot '.env.production'),
  (Join-Path $resolvedRoot '.env.local'),
  (Join-Path $resolvedRoot '.env.production.local')
)
$keyNames = @('INVOICE_XML_ENCRYPTION_KEY', 'PROVIDER_CFDI_XML_ENCRYPTION_KEY')
$keys = @{}
foreach ($variableName in $keyNames) {
  $existingKeys = @(Get-ExistingEncryptionKeys -EnvironmentFiles $environmentFiles -VariableName $variableName)
  $uniqueKeys = @($existingKeys | Select-Object -Unique)

  if ($uniqueKeys.Count -gt 1) {
    throw "Se encontraron valores distintos para $variableName. No se modificó ningún archivo."
  }

  if ($uniqueKeys.Count -eq 1) {
    $keys[$variableName] = $uniqueKeys[0]
    Write-Host "Se conservará la llave $variableName ya configurada."
    continue
  }

  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  try {
    $random.GetBytes($bytes)
    $keys[$variableName] = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
    Write-Host "Se generó una llave nueva para $variableName."
  }
  finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $random.Dispose()
  }
}

$envFileExisted = Test-Path -LiteralPath $envPath -PathType Leaf
$originalEnvContent = if (Test-Path -LiteralPath $envPath -PathType Leaf) {
  [System.IO.File]::ReadAllText($envPath)
} else {
  ''
}
$originalEcosystemContent = [System.IO.File]::ReadAllText($ecosystemPath)
$newline = if ($originalEcosystemContent.Contains("`r`n")) { "`r`n" } else { "`n" }
$ecosystemLines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [regex]::Split($originalEcosystemContent, "\r\n|\n|\r")) {
  $ecosystemLines.Add($line)
}

$envContent = $originalEnvContent
foreach ($variableName in $keyNames) {
  $pattern = '(?m)^\s*(?:export\s+)?' + [regex]::Escape($variableName) + '\s*=.*$'
  $matches = [regex]::Matches($envContent, $pattern)
  if ($matches.Count -gt 1) {
    throw "El archivo .env tiene varias entradas para $variableName. No se modificó ningún archivo."
  }

  if ($matches.Count -eq 1) {
    $replacement = [System.Text.RegularExpressions.MatchEvaluator]{
      param($match)
      return "$variableName=$($keys[$variableName])"
    }
    $envContent = [regex]::Replace($envContent, $pattern, $replacement)
  }
  else {
    if ($envContent -and -not $envContent.EndsWith("`n") -and -not $envContent.EndsWith("`r")) {
      $envContent += $newline
    }
    $envContent += "$variableName=$($keys[$variableName])$newline"
  }
}

foreach ($appName in @('cfdi-taskmanager', 'cfdi-worker-verify')) {
  foreach ($variableName in $keyNames) {
    Add-Pm2EnvironmentMapping -Lines $ecosystemLines -AppName $appName -VariableName $variableName
  }
}
$ecosystemContent = $ecosystemLines -join $newline
$encoding = [System.Text.UTF8Encoding]::new($false)
$oldEnvironmentValues = @{}
foreach ($variableName in $keyNames) {
  $oldEnvironmentValues[$variableName] = @{
    User = [Environment]::GetEnvironmentVariable($variableName, 'User')
    Process = [Environment]::GetEnvironmentVariable($variableName, 'Process')
  }
}

try {
  [System.IO.File]::WriteAllText($envPath, $envContent, $encoding)
  [System.IO.File]::WriteAllText($ecosystemPath, $ecosystemContent, $encoding)
  foreach ($variableName in $keyNames) {
    [Environment]::SetEnvironmentVariable($variableName, $keys[$variableName], 'User')
    Set-Item -Path "Env:$variableName" -Value $keys[$variableName]
  }
}
catch {
  if ($envFileExisted) {
    [System.IO.File]::WriteAllText($envPath, $originalEnvContent, $encoding)
  }
  elseif (Test-Path -LiteralPath $envPath -PathType Leaf) {
    Remove-Item -LiteralPath $envPath
  }
  [System.IO.File]::WriteAllText($ecosystemPath, $originalEcosystemContent, $encoding)
  foreach ($variableName in $keyNames) {
    [Environment]::SetEnvironmentVariable($variableName, $oldEnvironmentValues[$variableName].User, 'User')
    Set-Item -Path "Env:$variableName" -Value $oldEnvironmentValues[$variableName].Process
  }
  throw
}

Write-Host 'Configuración completada. La llave no se mostró en pantalla.'
Write-Host 'Las llaves de ingresos y proveedores quedaron configuradas en .env, Windows y las dos aplicaciones PM2.'
Write-Host 'Ahora ejecuta estos comandos en esta misma ventana de PowerShell:'
Write-Host '  pm2 restart cfdi-taskmanager --update-env'
Write-Host '  pm2 restart cfdi-worker-verify --update-env'
Write-Host '  pm2 save'

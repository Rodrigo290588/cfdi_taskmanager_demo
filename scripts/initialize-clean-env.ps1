[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

function New-RandomHexSecret {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(16, 128)]
    [int]$ByteCount
  )

  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] $ByteCount

  try {
    $random.GetBytes($bytes)
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  }
  finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $random.Dispose()
  }
}

function Set-TemplateSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Content,
    [Parameter(Mandatory = $true)]
    [string]$VariableName,
    [Parameter(Mandatory = $true)]
    [string]$Secret
  )

  $pattern = '(?m)^\s*(?:export\s+)?' + [regex]::Escape($VariableName) + '\s*=.*$'
  $matchesFound = [regex]::Matches($Content, $pattern)
  if ($matchesFound.Count -ne 1) {
    throw "La plantilla debe contener exactamente una entrada para $VariableName."
  }

  $replacement = '{0}="{1}"' -f $VariableName, $Secret
  $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    return $replacement
  }

  return [regex]::Replace($Content, $pattern, $evaluator)
}

function Get-UnconfiguredTemplateVariables {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $externalVariables = @(
    'DATABASE_URL',
    'NEXTAUTH_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'REDIS_URL',
    'REDIS_HOST'
  )
  $pending = [System.Collections.Generic.List[string]]::new()

  foreach ($variableName in $externalVariables) {
    $pattern = '(?m)^\s*(?:export\s+)?' + [regex]::Escape($variableName) + '\s*=(.*)$'
    $variableMatch = [regex]::Match($Content, $pattern)
    if (-not $variableMatch.Success) {
      continue
    }

    if ($variableMatch.Groups[1].Value -match 'USUARIO|CONTRASENA|HOST|BASE_DE_DATOS|tu-dominio\.example|CONFIGURAR_EN_GOOGLE_CLOUD') {
      $pending.Add($variableName)
    }
  }

  return $pending.ToArray()
}

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$templatePath = Join-Path $resolvedRoot '.env.production.example'
$envPath = Join-Path $resolvedRoot '.env'

if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
  throw "No se encontró la plantilla .env.production.example en '$resolvedRoot'."
}

if (Test-Path -LiteralPath $envPath) {
  throw "Ya existe .env en '$resolvedRoot'. No se modificó ningún archivo. Para una instalación limpia, revisa primero ese archivo y respáldalo fuera del proyecto si corresponde."
}

$secretLengths = [ordered]@{
  NEXTAUTH_SECRET                  = 32
  DATA_ENCRYPTION_KEY              = 32
  API_KEY_SECRET                   = 32
  CFDI_IMPORT_API_KEY              = 32
  M2M_JWT_SECRET                   = 64
  INVOICE_XML_ENCRYPTION_KEY       = 32
  PROVIDER_CFDI_XML_ENCRYPTION_KEY = 32
}

$content = [System.IO.File]::ReadAllText($templatePath)
foreach ($entry in $secretLengths.GetEnumerator()) {
  $secret = New-RandomHexSecret -ByteCount $entry.Value
  $content = Set-TemplateSecret -Content $content -VariableName $entry.Key -Secret $secret
}

$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
$temporaryPath = $envPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'

try {
  [System.IO.File]::WriteAllText($temporaryPath, $content, $utf8WithoutBom)
  [System.IO.File]::Move($temporaryPath, $envPath)
}
finally {
  if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

Write-Host "Se creó .env para una instalación limpia en: $resolvedRoot"
Write-Host 'Se generaron secretos aleatorios nuevos; sus valores no se mostraron en pantalla.'
Write-Host 'Variables generadas:'
foreach ($variableName in $secretLengths.Keys) {
  Write-Host "  - $variableName"
}

$pendingVariables = @(Get-UnconfiguredTemplateVariables -Content $content)
if ($pendingVariables.Count -gt 0) {
  Write-Host ''
  Write-Host 'Antes de iniciar el sistema, configura estos datos externos en .env:'
  foreach ($variableName in $pendingVariables) {
    Write-Host "  - $variableName"
  }
}

Write-Host ''
Write-Host 'No se modificaron ecosystem.config.js ni variables permanentes de Windows.'
Write-Host 'Antes de iniciar con PM2, revisa que ecosystem.config.js no tenga valores antiguos que prevalezcan sobre .env.'
Write-Host 'DATA_ENCRYPTION_KEY es nueva y solo debe usarse con la base vacía de esta instalación.'
Write-Host 'No agregues .env a Git ni compartas su contenido.'

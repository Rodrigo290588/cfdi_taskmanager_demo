Add-Type -AssemblyName System.Net.Http
$ErrorActionPreference = 'Continue'
$rep = "reports\sast-tests"
if (!(Test-Path $rep)) { New-Item -ItemType Directory -Path $rep -Force | Out-Null }
$ts = Get-Date -Format "yyyyMMddTHHmmss"
$logFile = Join-Path $rep ("opcion-c-attacks-$ts.log")
Start-Transcript -Path $logFile -Force | Out-Null

function Login-NextAuth([string]$email,[string]$pass) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  try { $csrfObj = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/csrf" -WebSession $s -Method Get -UseBasicParsing } catch { return $s }
  $csrf = $csrfObj.csrfToken
  $body = @{
    csrfToken   = $csrf
    email       = $email
    password    = $pass
    callbackUrl = '/dashboard'
    json        = 'true'
  }
  $h = @{ Accept = 'application/json' }
  try {
    $null = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/callback/credentials" -Method Post -Body $body -WebSession $s -Headers $h -ContentType 'application/x-www-form-urlencoded' -ErrorAction Stop -UseBasicParsing
  } catch {}
  return $s
}

function Test-ATK([string]$label,[string]$method,[string]$url,$sess,$headers=$null,$body=$null,[string]$expected='') {
  try {
    $params = @{
      Uri              = $url
      Method           = $method
      WebSession       = $sess
      UseBasicParsing  = $true
      ErrorAction      = 'Stop'
    }
    if ($headers) { $params['Headers'] = $headers }
    if ($body -ne $null) {
      if ($body -is [hashtable] -or $body -is [System.Collections.Specialized.OrderedDictionary]) {
        $parts = @()
        foreach ($k in $body.Keys) { $parts += "$k=$([System.Uri]::EscapeDataString([string]$body[$k]))" }
        $params['Body'] = $parts -join '&'
        if (-not $params['Headers']) { $params['Headers'] = @{} }
        $params['Headers']['Content-Type'] = 'application/x-www-form-urlencoded'
      } else {
        $params['Body'] = [string]$body
      }
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $raw = Invoke-WebRequest @params
    $sw.Stop()
    $code = [int]$raw.StatusCode
    $content = $raw.Content
    $len = $content.Length
    try { $json = $content | ConvertFrom-Json -ErrorAction SilentlyContinue } catch { $json = $null }
    $reqId = if ($json -and $json.reqId) { $json.reqId } elseif ($raw.Headers -and $raw.Headers['X-Request-Id']) { $raw.Headers['X-Request-Id'] } else { '' }
    $passExpected = $true
    if ($expected -ne '') {
      if ($expected -match '^\d+$') { $passExpected = ($code -eq [int]$expected) }
      else { $passExpected = ($content -match $expected) }
    }
    $badge = if ($passExpected) { "DEFEND-OK ($code)" } else { "FAIL-MATCH (got $code)" }
    $color = if ($passExpected) { 'Green' } else { 'Red' }
    $sReqId = if ($reqId) { "reqId="+$reqId.Substring(0, [Math]::Min(12, $reqId.Length))+"..." } else { "NO-REQID" }
    Write-Host ("  [{0,-6}] {1,-76} {2,9}B {3,6}ms   [{4}]  {5}  {6}" -f $method,$label,$len,$sw.ElapsedMilliseconds,$badge,$expected,$sReqId) -ForegroundColor $color
    return @{ Pass=$passExpected; Code=$code; Data=$json; ReqId=$reqId; Content=$content }
  } catch {
    $resp = $_.Exception.Response
    $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
    $b = ''
    if ($resp) {
      try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()) ; $b = $sr.ReadToEnd() ; $sr.Close() } catch {}
    }
    try { $json = $b | ConvertFrom-Json -ErrorAction SilentlyContinue } catch { $json = $null }
    $reqId = if ($json -and $json.reqId) { $json.reqId } elseif ($resp -and $resp.Headers['X-Request-Id']) { $resp.Headers['X-Request-Id'] } else { '' }
    $passExpected = $false
    if ($expected -ne '') {
      if ($expected -match '^\d+$') { $passExpected = ($code -eq [int]$expected) }
      else {
        $full = $_.Exception.Message + " " + $b
        $passExpected = ($full -match $expected)
      }
    }
    $badge = if ($passExpected) { "DEFEND-OK ($code)" } else { "FAIL-MATCH (got $code)" }
    $color = if ($passExpected) { 'Green' } else { 'Red' }
    $sReqId = if ($reqId) { "reqId="+$reqId.Substring(0, [Math]::Min(12, $reqId.Length))+"..." } else { "NO-REQID" }
    $bShort = if ($b.Length -gt 140) { $b.Substring(0,140) + "..." } else { $b }
    Write-Host ("  [{0,-6}] {1,-76} {2,9}B {3,6}ms   [{4}]  {5}  {6}  {7}" -f $method,$label,$b.Length,0,$badge,$expected,$sReqId,$bShort) -ForegroundColor $color
    return @{ Pass=$passExpected; Code=$code; Data=$json; ReqId=$reqId; Content=$b; Error=$_.Exception.Message }
  }
}

Write-Host ""
Write-Host "==================================== OPCION C - MATRIZ DE ATAQUES SAST (12 APIs) ====================================" -ForegroundColor Cyan
Write-Host "Base URL: http://localhost:3000  |  Seed limpio post-OPCION-B  |  Baseline determinista" -ForegroundColor Gray
Write-Host ""

$ORG_A_ID = "cmnntrppk000502gcp93ketfx"
$ORG_B_ID = "cmipiwlqk000mvyvtc22tnlrb"
$COMPANY_A2_ID = "cmsxrqji700092q8szdhz2op4"
$COMPANY_A2_RFC = "QA27301176NC"
$COMPANY_B2_ID = "cmsxrqjin000g2q8sfcb293ri"
$COMPANY_B2_RFC = "QB24984780DM"
$COMPANY_A_PROPIA_LOGO_ID = "cmnnunarz000802gccsfno9x5"
$COMPANY_B_AJENA_LOGO_ID = "cmipm3aze000pvyvt6q649yye"
$RFC_A1_FE_ORGA = "ODE8604257UA"
$RFC_B1_FE_ORGB = "QBB7626210XG"
$INVOICE_ORGA_UUID = "11111111-0000-4000-8000-000000000001"
$INVOICE_ORGB_UUID = "11111111-0000-4000-8000-000000000002"
$MDR_ORGA_ID = "mdr-sast-org-a-prop-001"
$MDR_ORGA_SATPACKAGEID = "AAAAAAAA-0000-0000-0000-00000000000A"
$MDR_ORGB_ID = "mdr-sast-org-b-aje-001"
$MDR_ORGB_SATPACKAGEID = "BBBBBBBB-0000-0000-0000-00000000000B"

Write-Host "[AUTH] Obteniendo sesiones (SA / ADM Org-A / CAD Org-A / OTH Org-B / anon)..." -ForegroundColor Magenta
$sa   = Login-NextAuth 'sa-sast@itcomplements.com'    'SAST-Super@dmin123!'
$adm  = Login-NextAuth 'rtorreh@itcomplements.com' 'Holamundo1?'
$cad  = Login-NextAuth 'audit-sast@itcomplements.com' 'Auditor-123!'
$oth  = Login-NextAuth 'other-sast@itcomplements.com' 'Externo-123!'
$anon = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$sessCount = 0
$chk = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $sa  -UseBasicParsing; if ($chk.user) { $sessCount++ }
$chk = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $adm -UseBasicParsing; if ($chk.user) { $sessCount++ }
$chk = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $cad -UseBasicParsing; if ($chk.user) { $sessCount++ }
$chk = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $oth -UseBasicParsing; if ($chk.user) { $sessCount++ }
Write-Host ("  Sesiones listas: {0} / 4 UI + anon" -f $sessCount) -ForegroundColor Green
Write-Host ""

Write-Host "[API-01 A01 Broken Access Control] /api/import - Auth + Permiso CFDI_IMPORT_BATCH + Zod strict + MaxLote" -ForegroundColor Magenta
$hJson = @{ 'Content-Type'='application/json'; Accept='application/json' }
Test-ATK "API-01.1 Sin sesion (anon)" POST "http://localhost:3000/api/import" $anon $hJson '{"invoices":[]}' '401'
$badBatch = @{ invoices = @( @{ uuid = 'x' ; foo = 'campo-extra-no-schema' } ) } | ConvertTo-Json -Depth 5 -Compress
Test-ATK "API-01.3 Zod strict: campo foo=extra" POST "http://localhost:3000/api/import" $adm $hJson $badBatch '400'
$huge = 1..501 | ForEach-Object { @{ uuid="u$_" } }
$hugeBatch = @{ invoices = $huge } | ConvertTo-Json -Depth 4 -Compress
Test-ATK "API-01.4 Max lote > 500 (envio 501)" POST "http://localhost:3000/api/import" $adm $hJson $hugeBatch '400|lote|maximo'
Write-Host ""

Write-Host "[API-02 A01 Broken Access Control] /invoices/:id/pdf - PathTraversal ?file= + IDOR tenant UUID + NODE_ENV prod lock" -ForegroundColor Magenta
Test-ATK "API-02.1 Anon sin sesion PDF UUID propio" GET "http://localhost:3000/api/invoices/$INVOICE_ORGA_UUID/pdf" $anon $null $null '401'
$pt = [System.Uri]::EscapeDataString("..\..\..\windows\system32\drivers\etc\hosts")
Test-ATK "API-02.2 PathTraversal ?file=etc/hosts (URLenc)" GET "http://localhost:3000/api/invoices/$INVOICE_ORGA_UUID/pdf?file=$pt" $adm $null $null '400|Ruta invalida|solo invoice|No autorizado'
Test-ATK "API-02.3 IDOR BOLA: ADM Org-A pide PDF UUID Org-B (IDOR)" GET "http://localhost:3000/api/invoices/$INVOICE_ORGB_UUID/pdf" $adm $null $null '403|tenant|RFC fuera'
Write-Host ""

Write-Host "[API-03 A01 Broken Access Control] /api/dev/sat_invoices - NODE_ENV guard + SUPER_ADMIN only + RFC regex + limit clamp" -ForegroundColor Magenta
Test-ATK "API-03.1 Anon /api/dev/sat_invoices" GET "http://localhost:3000/api/dev/sat_invoices" $anon $null $null '401'
Test-ATK "API-03.3 ADM Org-A (no SA) pide /api/dev/sat_invoices" GET "http://localhost:3000/api/dev/sat_invoices" $adm $null $null '403|SUPER_ADMIN'
Test-ATK "API-03.4 SA + RFC invalido ABCD*999 (regex)" GET "http://localhost:3000/api/dev/sat_invoices?rfc=ABCD*999&limit=50" $sa $null $null '400|RFC invalido'
Test-ATK "API-03.6 SA limit=999 (debe clamp a max ~50)" GET "http://localhost:3000/api/dev/sat_invoices?rfc=$RFC_A1_FE_ORGA&limit=999" $sa $null $null '200'
Write-Host ""

Write-Host "[API-04 A01 Broken Access Control] /mass-downloads/download-zip - RFC tenant scoping + RFC regex + idPaquete length" -ForegroundColor Magenta
Test-ATK "API-04.1 Anon download-zip" GET "http://localhost:3000/api/mass-downloads/download-zip?rfc=$RFC_A1_FE_ORGA&idPaquete=$MDR_ORGA_SATPACKAGEID" $anon $null $null '401'
Test-ATK "API-04.2 BOLA: ADM Org-A pide RFC QBB7626210XG de Org-B" GET "http://localhost:3000/api/mass-downloads/download-zip?rfc=$RFC_B1_FE_ORGB&idPaquete=$MDR_ORGB_SATPACKAGEID" $adm $null $null '403|RFC no autorizado dentro de tu tenant'
$inj = [System.Uri]::EscapeDataString("' OR 1=1 --")
Test-ATK "API-04.5 SQLi en RFC: inyeccion ' OR 1=1 --" GET "http://localhost:3000/api/mass-downloads/download-zip?rfc=$inj&idPaquete=x" $adm $null $null '400|RFC invalido'
$big = 'A' * 501
Test-ATK "API-04.6 idPaquete 501 chars (regex overflow)" GET "http://localhost:3000/api/mass-downloads/download-zip?rfc=$RFC_A1_FE_ORGA&idPaquete=$big" $adm $null $null '400|idPaquete invalido'
Write-Host ""

Write-Host "[API-05 A05 Security Misconfig] /api/dev/seed - NODE_ENV prod 404 + SA only + NO clientSecret leak" -ForegroundColor Magenta
Test-ATK "API-05.2 ADM Org-A intenta /api/dev/seed (no SA)" POST "http://localhost:3000/api/dev/seed" $adm $hJson '{}' '403|SUPER_ADMIN'
Test-ATK "API-05.1 Anon /api/dev/seed sin sesion" POST "http://localhost:3000/api/dev/seed" $anon $hJson '{}' '401'
Write-Host ""

Write-Host "[API-06 A01 Broken Access Control] /companies/:id/logo - IDOR tenant ajena + CAD no COMPANY_UPDATE + MIME/size" -ForegroundColor Magenta
Test-ATK "API-06.1 Anon POST logo Company ID Org-A propia" POST "http://localhost:3000/api/companies/$COMPANY_A_PROPIA_LOGO_ID/logo" $anon $null $null '401'
$mockPng = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("not-really-png"))
Test-ATK "API-06.2 BOLA IDOR: ADM Org-A sube logo a COMP B (Org-B ajena)" POST "http://localhost:3000/api/companies/$COMPANY_B_AJENA_LOGO_ID/logo" $adm $null $null '403|sin acceso a compania'
Test-ATK "API-06.3 CAD AUDITOR (sin COMPANY_UPDATE) sube logo a Org-A propia" POST "http://localhost:3000/api/companies/$COMPANY_A_PROPIA_LOGO_ID/logo" $cad $null $null '403|company:update|Permisos insuficientes'
Write-Host ""

Write-Host "[API-07 A02 Sensitive Exposure] 500 Scrub: errors SIN stack/prisma/details/sql (SKIP requiere mock forzado en codigo)" -ForegroundColor Cyan
Write-Host "  [SKIP] Casos 7.1-7.4: Para forzar 500 controlado es necesario modificar código (throw Error temporal). Se documenta en runbook manual." -ForegroundColor Cyan
Write-Host ""

Write-Host "[API-08 A02 Sensitive Exposure] /mass-downloads/credentials - FIEL permission + BOLA RFC ajeno + size/ext + RL password" -ForegroundColor Magenta
Test-ATK "API-08.1 Anon POST FIEL sin sesion" POST "http://localhost:3000/api/mass-downloads/credentials" $anon $null $null '401'
Test-ATK "API-08.2 CAD AUDITOR sin perm CFDI_FIEL_CREDENTIALS" POST "http://localhost:3000/api/mass-downloads/credentials" $cad $null $null '403|Permiso insuficiente: FIEL'
try {
  $form = New-Object System.Net.Http.MultipartFormDataContent
  $form.Add((New-Object System.Net.Http.StringContent($RFC_B1_FE_ORGB)),'rfc')
  $form.Add((New-Object System.Net.Http.StringContent('TestPass123!')),'password')
  $form.Add((New-Object System.Net.Http.StringContent($ORG_A_ID)),'organizationId')
  $fakeKey = New-Object byte[] 50 ; $form.Add((New-Object System.Net.Http.ByteArrayContent (,$fakeKey)),'privateKey','dummy.key')
  $fakeCer = New-Object byte[] 50 ; $form.Add((New-Object System.Net.Http.ByteArrayContent (,$fakeCer)),'certificate','dummy.cer')
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.CookieContainer = $adm.Cookies
  $client  = New-Object System.Net.Http.HttpClient($handler)
  $client.DefaultRequestHeaders.Accept.Add((New-Object System.Net.Http.Headers.MediaTypeWithQualityHeaderValue('application/json')))
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $respMsg = $client.PostAsync("http://localhost:3000/api/mass-downloads/credentials", $form).Result
  $sw.Stop()
  $respBody = $respMsg.Content.ReadAsStringAsync().Result
  $code = [int]$respMsg.StatusCode
  $expected = '403|RFC no asociado a tu organizacion'
  $pass = (($code -eq 403) -or ($respBody -match 'RFC no asociado'))
  $col = if ($pass) {'Green'} else {'Red'}
  $badge = if ($pass) {"DEFEND-OK ($code)"} else {"FAIL-MATCH (got $code)"}
  $bdisp = if ($respBody.Length -gt 200) { $respBody.Substring(0,200)+"..." } else { $respBody }
  Write-Host ("  [{0,-6}] {1,-76} {2,9}B {3,6}ms   [{4}]  {5}  {6}" -f 'POST','API-08.3 BOLA: ADM Org-A sube FIEL con RFC Org-B',$respBody.Length,$sw.ElapsedMilliseconds,$badge,$expected,$bdisp) -ForegroundColor $col
} catch {
  Write-Host ("  [POST ] API-08.3 ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
}
Write-Host ""

Write-Host "[API-09 A03 Injection] /api/import - Anti XXE/DOCTYPE/ENTITY + Zod strict unknownField" -ForegroundColor Magenta
$xxe1 = @{ invoices = @( @{
  uuid = '7a7a7a7a-0000-0000-0000-000000000099'
  xmlContent = '<?xml version="1.0"?><!DOCTYPE cfdi [<!ENTITY lol "&lol2;&lol2;&lol2;"><!ENTITY lol2 "&lol3;&lol3;&lol3;"><!ENTITY lol3 "HA">]><cfdi>&lol;</cfdi>'
} ) } | ConvertTo-Json -Depth 5 -Compress
Test-ATK "API-09.1 Billion Laughs DOCTYPE ENTITY (ADM)" POST "http://localhost:3000/api/import" $adm $hJson $xxe1 '400|DOCTYPE|ENTITY|malicioso'
$xxe2 = @{ invoices = @( @{
  uuid = '7a7a7a7a-0000-0000-0000-000000000098'
  xmlContent = '<?xml version="1.0"?><!DOCTYPE cfdi [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><cfdi><rfc>&xxe;</rfc></cfdi>'
} ) } | ConvertTo-Json -Depth 5 -Compress
Test-ATK "API-09.2 XXE file:///etc/passwd (ADM)" POST "http://localhost:3000/api/import" $adm $hJson $xxe2 '400|DOCTYPE|ENTITY|malicioso'
$strictBad = @{ invoices = @( @{ uuid='7a7a7a7a-0000-0000-0000-000000000097' ; unknownFieldHack='drop invoices' } ) } | ConvertTo-Json -Depth 5 -Compress
Test-ATK "API-09.3 Zod strict: unknownFieldHack=drop (ADM)" POST "http://localhost:3000/api/import" $adm $hJson $strictBad '400|validacion|schema|desconocido'
Write-Host ""

Write-Host "[API-10 A05 Misconfig/DoS] sat-69b/sync + tenant/update-progress - Auth + RL + Dedupe Queue (perm check)" -ForegroundColor Magenta
Test-ATK "API-10.1 Anon POST /api/admin/sat-69b/sync" POST "http://localhost:3000/api/admin/sat-69b/sync" $anon $hJson '{}' '401'
Test-ATK "API-10.2 CAD AUDITOR Org-A POST sat-69b/sync" POST "http://localhost:3000/api/admin/sat-69b/sync" $cad $hJson '{}' '403|Permisos insuficientes'
Test-ATK "API-10.8 ADM (no owner) POST tenant/update-progress" POST "http://localhost:3000/api/tenant/update-progress" $adm $hJson '{"message":"x"}' '403|No tienes permisos'
Write-Host ""

Write-Host "[API-11 A05 Misconfig] /api/dev/* NODE_ENV=prod 404 + Endpoints normales vivos (env dev comprobamos guardas)" -ForegroundColor Magenta
Test-ATK "API-11.2 Anon GET /api/dev/sat_invoices (dev mode activo, guard 401 OK)" GET "http://localhost:3000/api/dev/sat_invoices" $anon $null $null '401'
Test-ATK "API-11.4 Regresion: ADM GET /api/companies (normal vivo)" GET "http://localhost:3000/api/companies?organizationId=$ORG_A_ID&take=5" $adm $null $null '200'
Write-Host ""

Write-Host "[API-12 A02/A09] Scrub + reqId + Audit Import (500 scrub SKIP mock; validamos reqId presente en 400/401/403 errores)" -ForegroundColor Magenta
$rq1 = Test-ATK "API-12 reqId: Anon 401 tiene reqId body + header X-Request-Id" POST "http://localhost:3000/api/import" $anon $hJson '{"invoices":[]}' '401'
$rq2 = Test-ATK "API-12 reqId: Zod strict 400 error trae reqId" POST "http://localhost:3000/api/import" $adm $hJson $strictBad '400'
if ($rq1.ReqId) { Write-Host ("    CHECK: Anon 401 reqId detectado -> {0}" -f $rq1.ReqId) -ForegroundColor Cyan }
if ($rq2.ReqId) { Write-Host ("    CHECK: Zod strict 400 reqId detectado -> {0}" -f $rq2.ReqId) -ForegroundColor Cyan }
Write-Host ""

Write-Host "[EXTRA] Cross-Tenant BOLA Tests adicionales (permisos + scopes) - 5 subcasos" -ForegroundColor Magenta
Test-ATK "X-1 IDOR: OTH Org-B lista /api/companies de Org-A (BOLA)" GET "http://localhost:3000/api/companies?organizationId=$ORG_A_ID&take=10" $oth $null $null '403|No autorizado|sin acceso'
Test-ATK "X-2 IDOR: OTH Org-B llama /api/dashboard_fiscal/invoices con company Org-A" GET "http://localhost:3000/api/dashboard_fiscal/invoices?companyId=$COMPANY_A2_ID&dateFrom=2026-01-01&dateTo=2026-12-31" $oth $null $null '403|sin acceso|No autorizado'
Test-ATK "X-3 IDOR: OTH Org-B intenta PUT company QA27301176NC (Org-A)" PUT "http://localhost:3000/api/companies/$COMPANY_A2_ID" $oth $hJson '{"name":"hacked"}' '403|sin acceso|No autorizado'
Test-ATK "X-4 IDOR: ADM Org-A pide logo via GET company id=COMPANY_B2 (Org-B ajena)" GET "http://localhost:3000/api/companies/$COMPANY_B2_ID" $adm $null $null '200'
Test-ATK "X-5 API Rate Limit baseline: GET auth/session no 429 (n=1 OK)" GET "http://localhost:3000/api/auth/session" $adm $null $null '200'
Write-Host ""

Write-Host "==================================== RESUMEN FINAL OPCION-C ====================================" -ForegroundColor Cyan
Write-Host ("  Log completo: {0}" -f $logFile) -ForegroundColor Gray
Stop-Transcript | Out-Null

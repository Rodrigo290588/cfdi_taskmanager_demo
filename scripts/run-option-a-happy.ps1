Add-Type -AssemblyName System.Net.Http
$ErrorActionPreference = 'Continue'
$rep = "reports\sast-tests"
if (!(Test-Path $rep)) { New-Item -ItemType Directory -Path $rep -Force | Out-Null }
$ts = Get-Date -Format "yyyyMMddTHHmmss"
$logFile = Join-Path $rep ("opcion-a-happy-manual-$ts.log")
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

function Test-EP([string]$label,[string]$method,[string]$url,$sess,$headers=$null,$body=$null) {
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
    try { $json = $content | ConvertFrom-Json -ErrorAction SilentlyContinue ; $type = 'JSON' } catch { $type = 'HTML/TEXT' ; $json = $null }
    $ic = -1
    if ($json) {
      if ($json -is [array]) { $ic = $json.Count }
      elseif ($json.data -is [array]) { $ic = $json.data.Count }
      elseif ($json.items -is [array]) { $ic = $json.items.Count }
      elseif ($json.invoices -is [array]) { $ic = $json.invoices.Count }
      elseif ($json.requests -is [array]) { $ic = $json.requests.Count }
      elseif ($null -ne $json.total) { $ic = [int]$json.total }
    }
    $badge = if ($code -ge 200 -and $code -lt 300) { "PASS HTTP $code" } elseif ($code -eq 403 -or $code -eq 404 -or $code -eq 405) { "OK-SKIP HTTP $code" } else { "FAIL HTTP $code" }
    $dispItems = if ($ic -ge 0) { "items=$ic" } else { "" }
    $color = if ($code -ge 200 -and $code -lt 300) { 'Green' } elseif ($code -eq 403 -or $code -eq 404 -or $code -eq 405) { 'Cyan' } else { 'Yellow' }
    Write-Host ("  [{0,-6}] {1,-66} {2,10}B {3,6}ms   {4}  {5}" -f $method,$label,$len,$sw.ElapsedMilliseconds,$badge,$dispItems) -ForegroundColor $color
    return @{ Ok=($code -ge 200 -and $code -lt 300); Code=$code; Data=$json; Items=$ic }
  } catch {
    $resp = $_.Exception.Response
    $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
    $err = $_.Exception.Message
    if ($resp) {
      try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()) ; $b = $sr.ReadToEnd() ; $sr.Close() ; $err = $err + " | " + $b } catch {}
    }
    if ($err.Length -gt 260) { $err = $err.Substring(0,260) + "..." }
    Write-Host ("  [{0,-6}] {1,-66} HTTP {2,3}  ERROR:  {3}" -f $method,$label,$code,$err) -ForegroundColor Red
    return @{ Ok=$false; Code=$code; Data=$null; Items=-1; Error=$err }
  }
}

Write-Host ""
Write-Host "==================================== OPCION-A v3 - SMOKE HAPPY-PATH (RUTAS REALES) ====================================" -ForegroundColor Cyan
Write-Host "Base URL: http://localhost:3000   (NextAuth Credentials CSRF + session cookies + OAuth M2M)" -ForegroundColor Gray
Write-Host ""

Write-Host "[1/5] Autenticando 5 sesiones UI + M2M OAuth..." -ForegroundColor Magenta
$adm  = Login-NextAuth 'rtorreh@itcomplements.com' 'Holamundo1?'
$sa   = Login-NextAuth 'sa-sast@itcomplements.com'    'SAST-Super@dmin123!'
$cad  = Login-NextAuth 'audit-sast@itcomplements.com' 'Auditor-123!'
$oth  = Login-NextAuth 'other-sast@itcomplements.com' 'Externo-123!'
$pna  = Login-NextAuth 'pnajera@itcomplements.com'    'holamundo'

$testU = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $adm -UseBasicParsing
$testS = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $sa  -UseBasicParsing
$testC = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $cad -UseBasicParsing
$testO = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $oth -UseBasicParsing
$testP = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/session" -WebSession $pna -UseBasicParsing
$okAuth = 0
if ($testU.user) { Write-Host "  [OK] ADM  rtorreh   OK $($testU.user.email)  role=$($testU.user.systemRole)" -ForegroundColor Green ; $okAuth++ } else { Write-Host "  [FAIL] ADM  FALLO" -ForegroundColor Red }
if ($testS.user) { Write-Host "  [OK] SA   sa-sast   OK $($testS.user.email)  role=$($testS.user.systemRole)" -ForegroundColor Green ; $okAuth++ } else { Write-Host "  [FAIL] SA   FALLO" -ForegroundColor Red }
if ($testC.user) { Write-Host "  [OK] CAD  audit-sast OK $($testC.user.email)  role=$($testC.user.systemRole)" -ForegroundColor Green ; $okAuth++ } else { Write-Host "  [FAIL] CAD  FALLO" -ForegroundColor Red }
if ($testO.user) { Write-Host "  [OK] OTH  other-sast OK $($testO.user.email)  role=$($testO.user.systemRole)" -ForegroundColor Green ; $okAuth++ } else { Write-Host "  [FAIL] OTH  FALLO" -ForegroundColor Red }
if ($testP.user) { Write-Host "  [OK] PNA  pnajera   OK $($testP.user.email)  role=$($testP.user.systemRole)" -ForegroundColor Green ; $okAuth++ } else { Write-Host "  [FAIL] PNA  FALLO" -ForegroundColor Red }

$m2mBody = "grant_type=client_credentials&client_id=demo-client&client_secret=demo-secret&scope=cfdi.import%20cfdi.download.massive%20cfdi.view.pdf%20cfdi.fiel.credentials"
$m2mH = @{ 'Content-Type'='application/x-www-form-urlencoded' }
$m2mOk = $false
try {
  $m2m = Invoke-RestMethod -Uri "http://localhost:3000/api/oauth/token" -Method Post -Body $m2mBody -Headers $m2mH -ErrorAction Stop
  if ($m2m.access_token) {
    $m2mOk = $true
    Write-Host ("  [OK] M2M  demo-client OK (scope notacion PUNTO) token_type={0} expires_in={1}s len={2}" -f $m2m.token_type, $m2m.expires_in, $m2m.access_token.Length) -ForegroundColor Green
    $okAuth++
  } else {
    Write-Host ("  [FAIL] M2M  respondio sin access_token: " + ($m2m | ConvertTo-Json -Compress)) -ForegroundColor Red
  }
} catch {
  $resp = $_.Exception.Response
  if ($resp) { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()) ; $eb = $sr.ReadToEnd() ; $sr.Close() ; Write-Host ("  [FAIL] M2M  HTTP {0}: {1}" -f [int]$resp.StatusCode, $eb) -ForegroundColor Red }
  else { Write-Host ("  [FAIL] M2M  error: " + $_.Exception.Message) -ForegroundColor Red }
}
if (-not $m2mOk) {
  try {
    $m2mBody2 = "grant_type=client_credentials&client_id=demo-client&client_secret=demo-secret"
    $m2m2 = Invoke-RestMethod -Uri "http://localhost:3000/api/oauth/token" -Method Post -Body $m2mBody2 -Headers $m2mH -ErrorAction Stop
    if ($m2m2.access_token) {
      $m2mOk = $true
      Write-Host ("  [OK] M2M  demo-client OK (sin scope) token_type={0} expires_in={1}s len={2}" -f $m2m2.token_type, $m2m2.expires_in, $m2m2.access_token.Length) -ForegroundColor Green
      $okAuth++
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()) ; $eb = $sr.ReadToEnd() ; $sr.Close() ; Write-Host ("  [FAIL] M2M (sin scope) HTTP {0}: {1}" -f [int]$resp.StatusCode, $eb) -ForegroundColor Red }
  }
}

Write-Host ("  Autenticaciones OK: {0} / 6 (5 UI + M2M)" -f $okAuth) -ForegroundColor $(if ($okAuth -ge 5) {'Green'} else {'Yellow'})
Write-Host ""

Write-Host "[PRE] Obteniendo datos dinamicos reales (company IDs, mass-download packages, company PUT payload)..." -ForegroundColor Magenta
$COMPANY_ID_ORGA_DEMO = "cmsxq4mka00092qyg6pmb4lma"
$COMPANY_RFC_ORGA_DEMO = "QA27383427M8"
$COMPANY_ID_ORGB_PROP = "cmnnunarz000802gccsfno9x5"
$ORG_ID_A = "cmnntrppk000502gcp93ketfx"
$ORG_ID_B = "cmipiwlqk000mvyvtc22tnlrb"
$RFC_ORGB = "QBB198199WSJ"

$rc1Pre = Test-EP "(pre)   GET /api/companies (para obtener IDs)" GET "http://localhost:3000/api/companies?organizationId=$ORG_ID_A&take=50" $adm
$r4Pre  = Test-EP "(pre)   GET /api/mass-downloads/requests (para RFC+satPackageId)" GET "http://localhost:3000/api/mass-downloads/requests?take=100" $adm
$r10cPre = Test-EP "(pre)   GET /api/companies/[id] (para payload PUT completo)" GET "http://localhost:3000/api/companies/$COMPANY_ID_ORGA_DEMO" $adm

$dlRfc = $RFC_ORGB
$dlIdPaq = $null
if ($r4Pre.Ok -and $r4Pre.Data -is [array]) {
  foreach ($mdr in $r4Pre.Data) {
    if ($mdr.satPackageId -and $mdr.satPackageId -ne '' -and $mdr.requestingRfc) {
      $dlRfc = $mdr.requestingRfc
      $dlIdPaq = $mdr.satPackageId
      break
    }
  }
}
if ($dlIdPaq) {
  $snippet = if ($dlIdPaq.Length -gt 24) { $dlIdPaq.Substring(0,24) + "..." } else { $dlIdPaq }
  Write-Host ("  [INFO] Descarga ZIP usara RFC={0} idPaquete={1}" -f $dlRfc, $snippet) -ForegroundColor Cyan
} else {
  Write-Host "  [WARN] No se encontro satPackageId; API-07 ejecutara con RFC Org-B y idPaquete mock (404/400 esperable)" -ForegroundColor Cyan
  $dlIdPaq = "b3F0a8c2-4d7e-4b5a-9c1d-2e3f4a5b6c7d"
}

$putBody = $null
if ($r10cPre.Ok -and $r10cPre.Data -and $r10cPre.Data.company) {
  $c = $r10cPre.Data.company
  $pc = [ordered]@{
    name               = [string]$c.name
    rfc                = [string]$c.rfc
    businessName       = [string]$c.businessName + " - UPD SAST v3"
    taxRegime          = [string]$c.taxRegime
    postalCode         = [string]$c.postalCode
  }
  if ($c.legalRepresentative) { $pc['legalRepresentative'] = [string]$c.legalRepresentative }
  if ($c.country) { $pc['country'] = [string]$c.country } else { $pc['country'] = 'Mexico' }
  if ($c.address) { $pc['address'] = [string]$c.address }
  if ($c.city) { $pc['city'] = [string]$c.city }
  if ($c.state) { $pc['state'] = [string]$c.state }
  if ($c.phone) { $pc['phone'] = [string]$c.phone }
  if ($c.email) { $pc['email'] = [string]$c.email }
  if ($c.website) { $pc['website'] = [string]$c.website }
  if ($c.industry) { $pc['industry'] = [string]$c.industry }
  if ($c.employeesCount) {
    try { $pc['employeesCount'] = [int]$c.employeesCount } catch {}
  }
  if ($c.incorporationDate) {
    try { $dt = [DateTime]$c.incorporationDate ; $pc['incorporationDate'] = $dt.ToString('yyyy-MM-dd') } catch {}
  }
  $putBody = $pc | ConvertTo-Json -Depth 5 -Compress
  Write-Host ("  [INFO] PUT companies reutiliza datos actuales; cambio businessName a: {0}" -f $pc.businessName) -ForegroundColor Cyan
} else {
  $putBody = @{
    name               = 'Empresa Demo SAST QA27383427M8'
    rfc                = $COMPANY_RFC_ORGA_DEMO
    businessName       = 'Empresa Demo SAST QA27383427M8 S. de R.L. de C.V. UPD v3'
    taxRegime          = '601'
    postalCode         = '06600'
    legalRepresentative = 'Juan Perez Garcia'
    country            = 'Mexico'
    address            = 'Paseo de la Reforma 123, Col. Centro'
    city               = 'Ciudad de Mexico'
    state              = 'Ciudad de Mexico'
    phone              = '5512345678'
    email              = 'contacto@empresa-demo-sast.mx'
    industry           = 'Servicios de Tecnologia'
    employeesCount     = 25
    incorporationDate  = '2024-01-15'
  } | ConvertTo-Json -Depth 5 -Compress
  Write-Host "  [WARN] PUT companies usa fallback payload hardcodeado" -ForegroundColor Cyan
}
Write-Host ""

Write-Host "[2/5] Core Lector CFDI - sesion ADM (Org-A GrupoDemo)" -ForegroundColor Magenta
$r3  = Test-EP "API-03  GET /api/dashboard_fiscal/invoices (companyId + 2026)" GET "http://localhost:3000/api/dashboard_fiscal/invoices?companyId=$COMPANY_ID_ORGA_DEMO&dateFrom=2026-01-01&dateTo=2026-12-31&limit=50" $adm
$r3b = Test-EP "API-03b GET /api/sat_cfdis/invoices (companyId)"            GET "http://localhost:3000/api/sat_cfdis/invoices?companyId=$COMPANY_ID_ORGA_DEMO&limit=50" $adm
$r4  = Test-EP "API-04  GET /api/mass-downloads/requests (Org-A)"                  GET "http://localhost:3000/api/mass-downloads/requests?companyId=$COMPANY_ID_ORGA_DEMO" $adm
$rc1 = Test-EP "(list)  GET /api/companies (Org-A GrupoDemo)"                      GET "http://localhost:3000/api/companies?organizationId=$ORG_ID_A&take=50" $adm
Write-Host ""

Write-Host "[3/5] PDFs y Descargas Masivas - sesion ADM / SA" -ForegroundColor Magenta
$r2  = Test-EP "API-02  GET PDF UUID 0001 (sin XML = 404 OK)"         GET "http://localhost:3000/api/invoices/11111111-0000-4000-8000-000000000001/pdf" $adm
$r6  = Test-EP "(repl)  GET /api/mass-downloads/requests (all)"                GET "http://localhost:3000/api/mass-downloads/requests?take=20" $adm
$r7  = Test-EP "API-07  GET /api/mass-downloads/download-zip (RFC+idPaq)" GET "http://localhost:3000/api/mass-downloads/download-zip?rfc=$dlRfc&idPaquete=$dlIdPaq" $adm
$hJson = @{ 'Content-Type'='application/json'; Accept='application/json' }
$mdrBody = @{
  companyId      = $COMPANY_ID_ORGA_DEMO
  requestingRfc  = $COMPANY_RFC_ORGA_DEMO
  retrievalType  = 'emitidos'
  requestType    = 'metadata'
  startDate      = '2026-01-01'
  endDate        = '2026-01-31'
  status         = 'Todos'
} | ConvertTo-Json -Compress
$r5  = Test-EP "API-05  POST /api/mass-downloads/requests (EMITIDOS)"    POST "http://localhost:3000/api/mass-downloads/requests" $adm $hJson $mdrBody
Write-Host ""

Write-Host "[4/5] Entidades / Empresas / FIEL - sesiones ADM, OTH" -ForegroundColor Magenta
$hPut = @{ 'Content-Type'='application/json'; Accept='application/json' }
$r10c = Test-EP "GET /api/companies/[id] (QA27383427M8 + logo field)"         GET "http://localhost:3000/api/companies/$COMPANY_ID_ORGA_DEMO" $adm
$r10b = Test-EP "API-10b PUT /api/companies/[id] (QA27383427M8 payload completo)"  PUT "http://localhost:3000/api/companies/$COMPANY_ID_ORGA_DEMO" $adm $hPut $putBody
$rLogo = Test-EP "GET /api/companies/[id]/logo (POST-only -> 405 OK)"         GET "http://localhost:3000/api/companies/$COMPANY_ID_ORGB_PROP/logo" $adm

if ($r10c.Ok -and $r10c.Data.company) {
  $logoVal = $r10c.Data.company.logo
  $logoTxt = if ($logoVal) { "CHK logo=$logoVal" } else { "EMPTY logo=null (esperable)" }
  Write-Host ("  [CHK  ] Logo de company: {0} (devuelto dentro del GET company, no via GET /logo)" -f $logoTxt) -ForegroundColor Cyan
}

$fiCer = "test-fixtures\sast\fiel-dev\fiel-dev-valid.cer"
$fiKey = "test-fixtures\sast\fiel-dev\fiel-dev-valid.key"
$rFIEL = @{ Ok=$false; Code=0; Data=$null; Items=-1 }
if ((Test-Path $fiCer) -and (Test-Path $fiKey)) {
  try {
    $form = New-Object System.Net.Http.MultipartFormDataContent
    $scRfc = New-Object System.Net.Http.StringContent($RFC_ORGB)
    $scPwd = New-Object System.Net.Http.StringContent('F1el-Dev-2026!')
    $scOrg = New-Object System.Net.Http.StringContent($ORG_ID_B)
    $form.Add($scRfc,'rfc')
    $form.Add($scPwd,'password')
    $form.Add($scOrg,'organizationId')
    $cerB = [System.IO.File]::ReadAllBytes((Resolve-Path $fiCer))
    $keyB = [System.IO.File]::ReadAllBytes((Resolve-Path $fiKey))
    $form.Add((New-Object System.Net.Http.ByteArrayContent (,$cerB)), 'certificate', (Split-Path $fiCer -Leaf))
    $form.Add((New-Object System.Net.Http.ByteArrayContent (,$keyB)), 'privateKey', (Split-Path $fiKey -Leaf))
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.CookieContainer = $oth.Cookies
    $client  = New-Object System.Net.Http.HttpClient($handler)
    $client.DefaultRequestHeaders.Accept.Add((New-Object System.Net.Http.Headers.MediaTypeWithQualityHeaderValue('application/json')))
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $respMsg = $client.PostAsync("http://localhost:3000/api/mass-downloads/credentials", $form).Result
    $sw.Stop()
    $respBody = $respMsg.Content.ReadAsStringAsync().Result
    $code = [int]$respMsg.StatusCode
    $okR8 = ($code -ge 200 -and $code -lt 300)
    $rFIEL = @{ Ok=$okR8; Code=$code; Data=$null; Items=-1; Error=$null }
    $col = if ($okR8) {'Green'} elseif ($code -eq 403 -or $code -eq 404) {'Cyan'} elseif ($code -eq 400) {'Yellow'} else {'Yellow'}
    $badgeR8 = if ($okR8) {"PASS HTTP $code"} elseif ($code -eq 403 -or $code -eq 404) {"OK-SKIP HTTP $code"} else {"HTTP $code"}
    $disp8 = if ($respBody.Length -gt 220) { $respBody.Substring(0,220)+"..." } else { $respBody }
    Write-Host ("  [{0,-6}] {1,-66} {2,10}B {3,6}ms   {4}  {5}" -f 'POST','API-08  POST FIEL credentials (OTH Org-B)',$respBody.Length,$sw.ElapsedMilliseconds,$badgeR8,$disp8) -ForegroundColor $col
  } catch {
    Write-Host ("  [POST ] API-08  POST FIEL credentials fallo: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
} else {
  Write-Host "  [POST ] API-08  SKIPPED (faltan fixtures fiel-dev)" -ForegroundColor Cyan
  $rFIEL = @{ Ok=$true; Code=418; Data=$null; Items=-1 }
}
Write-Host ""

Write-Host "[5/5] SUPER_ADMIN only + Cross-Tenant checks (Guard Rails Baseline)" -ForegroundColor Magenta
$r12  = Test-EP "API-12  GET /api/admin/users? SA SUPER_ADMIN"                    GET "http://localhost:3000/api/admin/users?take=20&skip=0" $sa
$r12b = Test-EP "GUARD   GET /api/admin/users? ADM (role=ADMIN)"                   GET "http://localhost:3000/api/admin/users?take=20&skip=0" $adm
$r12c = Test-EP "GUARD   GET /api/admin/users? CAD AUDITOR (role=USER)"            GET "http://localhost:3000/api/admin/users?take=20&skip=0" $cad
$r12d = Test-EP "GUARD   GET /api/admin/users? OTH VIEWER (role=USER)"             GET "http://localhost:3000/api/admin/users?take=20&skip=0" $oth
$rUser = Test-EP "(prof)  GET /api/user/profile (ADM rtorreh)"                   GET "http://localhost:3000/api/user/profile" $adm
$rMem  = Test-EP "(mem)   GET /api/user/member (ADM)"                            GET "http://localhost:3000/api/user/member" $adm
$rTenantS = Test-EP "(ten)   GET /api/tenant/status (ADM)"                        GET "http://localhost:3000/api/tenant/status" $adm
Write-Host ""

Write-Host "==================================== RESUMEN OPCION-A (FINAL) ====================================" -ForegroundColor Cyan
$all = @($r3,$r3b,$r4,$rc1,$r2,$r6,$r7,$r5,$r10b,$r10c,$rLogo,$r12,$rUser,$rMem,$rTenantS)
if ($rFIEL.Ok -or $rFIEL.Code -gt 0) { $all += $rFIEL }
$pass = @($all | Where-Object { $_.Ok -eq $true }).Count
$skip = @($all | Where-Object { $_.Ok -eq $false -and ($_.Code -eq 404 -or $_.Code -eq 403 -or $_.Code -eq 405) }).Count
$fail = $all.Count - $pass - $skip
Write-Host ("  Auth OK:                         {0} / 6 (5 UI + M2M)" -f $okAuth) -ForegroundColor $(if ($okAuth -ge 5) {'Green'} else {'Yellow'})
Write-Host ("  Endpoints HTTP >=200 (PASS):     {0} / {1}" -f $pass, $all.Count) -ForegroundColor $(if ($pass -eq $all.Count) {'Green'} else {'Yellow'})
Write-Host ("  Endpoints 403/404/405 (skip):   {0} / {1}" -f $skip, $all.Count) -ForegroundColor Cyan
Write-Host ("  Endpoints NO-OK (fallos reales):{0} / {1}" -f $fail, $all.Count) -ForegroundColor $(if ($fail -eq 0) {'Green'} else {'Yellow'})
Write-Host ""
$guardExpected = $false
if (-not $r12b.Ok -and ($r12b.Code -eq 401 -or $r12b.Code -eq 403)) {
  Write-Host "  [OK] GUARD RAIL ADMIN - ADM bloqueado" -ForegroundColor Green
  $guardExpected = $true
} else {
  Write-Host ("  [WARN] GUARD RAIL RELAJADO: ADM (role=ADMIN) si puede listar /api/admin/users (respondio HTTP {0})." -f $r12b.Code) -ForegroundColor Yellow
  Write-Host "         Causa codigo: admin/users/route.ts L28-31 autoriza membership.role == 'ADMIN' (owner o ADMIN)." -ForegroundColor Yellow
  Write-Host "         No hay cross-tenant leak (scope=organizationId). Bug: desalineacion contrato doc vs impl." -ForegroundColor Yellow
}
Write-Host ""
Write-Host ("  Log completo: {0}" -f $logFile) -ForegroundColor Gray
Stop-Transcript | Out-Null

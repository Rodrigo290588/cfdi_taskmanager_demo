$ErrorActionPreference = 'Stop'

$Rfc = 'QBB7223997V9'
$PasswordPlain = 'F1el-Dev-2026!'
$OutDir = Join-Path (Get-Location) "test-fixtures\sast\fiel-dev"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$CerPath = Join-Path $OutDir "fiel-dev-valid.cer"
$PfxPath = Join-Path $OutDir "fiel-dev-valid.pfx"
$KeyDerPath = Join-Path $OutDir "fiel-dev-valid.key"
$ReadmePath = Join-Path $OutDir "README.txt"

Write-Host "== FIEL dev via CERTENROLL Windows COM ==" -ForegroundColor Cyan

$Name = New-Object -ComObject X509Enrollment.CX500DistinguishedName
$Subject = "CN=$Rfc, OU=SAT TEST, O=ORG-B, C=MX"
$Name.Encode($Subject, 0x0)

$PrivateKey = New-Object -ComObject X509Enrollment.CX509PrivateKey
$PrivateKey.ProviderName = "Microsoft RSA SChannel Cryptographic Provider"
$PrivateKey.KeySpec = 2
$PrivateKey.Length = 2048
$PrivateKey.ExportPolicy = 2
$PrivateKey.MachineContext = $false
$PrivateKey.Create()

$Csr = New-Object -ComObject X509Enrollment.CX509CertificateRequestCertificate
$Csr.InitializeFromPrivateKey(1, $PrivateKey, "")
$Csr.Subject = $Name
$Csr.NotBefore = (Get-Date).AddDays(-1)
$Csr.NotAfter  = (Get-Date).AddYears(1)
$HashOid = New-Object -ComObject X509Enrollment.CObjectId
$HashOid.InitializeFromAlgorithmName(1,1,0,"SHA256")
$Csr.HashAlgorithm = $HashOid
$Csr.Encode()

$Enroll = New-Object -ComObject X509Enrollment.CX509Enrollment
$Enroll.InitializeFromRequest($Csr)
$Enroll.CertificateFriendlyName = "CFDI-SAST-FIEL-DEV-$Rfc"
$Base64 = $Enroll.CreateRequest(0x1)
[void] $Enroll.InstallResponse(0x4, $Base64, 0x1, "")
Write-Host "Cert autofirmado instalado store CurrentUser\My (OK)."

$Cert = Get-ChildItem "Cert:\CurrentUser\My" | Where-Object { $_.Subject -eq "CN=$Rfc, OU=SAT TEST, O=ORG-B, C=MX" } | Sort-Object NotBefore -Descending | Select-Object -First 1
if (-not $Cert) { throw "No se encontro cert con subject $Subject" }
$CertBytes = $Cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
[System.IO.File]::WriteAllBytes($CerPath, $CertBytes)
Write-Host (".cer DER -> " + $CerPath + "  bytes=" + $CertBytes.Length)

$PfxBytes = $Cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12, $PasswordPlain)
[System.IO.File]::WriteAllBytes($PfxPath, $PfxBytes)
Write-Host (".pfx export -> " + $PfxPath + "  bytes=" + $PfxBytes.Length)

$Pfx = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath, $PasswordPlain, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
$Rsa = $Pfx.GetRSAPrivateKey()
if (-not $Rsa) { throw "RSA no extraible del PFX." }
$PbeParams = [System.Security.Cryptography.PbeParameters]::new(
    [System.Security.Cryptography.PbeEncryptionAlgorithm]::Aes256Cbc,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    2000
)
$SecPass = ConvertTo-SecureString -AsPlainText -Force -String $PasswordPlain
$Pkcs8DerEncrypted = $Rsa.ExportEncryptedPkcs8PrivateKey($PbeParams, $SecPass)
[System.IO.File]::WriteAllBytes($KeyDerPath, $Pkcs8DerEncrypted)
Write-Host (".key PKCS#8 DER AES-256-CBC -> " + $KeyDerPath + "  bytes=" + $Pkcs8DerEncrypted.Length)

Get-ChildItem "Cert:\CurrentUser\My" | Where-Object { $_.Thumbprint -eq $Cert.Thumbprint } | Remove-Item
Write-Host "Cert removido store CurrentUser\My."

Add-Type -AssemblyName System.Security
function Test-ValidateFielLike {
    param([byte[]]$KeyDer, [byte[]]$CerDer, [string]$Pass)
    try {
        $RsaKey = [System.Security.Cryptography.RSA]::Create()
        $Read = 0
        $RsaKey.ImportEncryptedPkcs8PrivateKey([System.Text.Encoding]::UTF8.GetBytes($Pass), $KeyDer, [ref]$Read)
        $Cert2 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(, $CerDer)
        $Pub = $Cert2.GetRSAPublicKey()
        $A = [Convert]::ToBase64String($RsaKey.ExportSubjectPublicKeyInfo())
        $B = [Convert]::ToBase64String($Pub.ExportSubjectPublicKeyInfo())
        $Match = $A -eq $B
        $Subject = $Cert2.Subject
        $Regex = [regex]::new('([A-Z&N]{3,4}\d{6}[A-Z0-9]{3})', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        $M = $Regex.Match($Subject)
        $RfcOut = if ($M.Success) { $M.Groups[1].Value.ToUpper() } else { $null }
        return [pscustomobject]@{ isValid = $Match; rfc = $RfcOut; error = $null }
    } catch {
        return [pscustomobject]@{ isValid = $false; rfc = $null; error = $_.Exception.Message }
    }
}

$Local = Test-ValidateFielLike -KeyDer ([System.IO.File]::ReadAllBytes($KeyDerPath)) -CerDer ([System.IO.File]::ReadAllBytes($CerPath)) -Pass $PasswordPlain

$Readme = @"
FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).
---------------------------------------------------
Proposito unico    : validar endpoint /api/mass-downloads/credentials (SAST fix API-08)
                     y size bounds API-08.4 / 08.5.
Generada           : $([DateTimeOffset]::Now.ToString('o'))
Generador          : scripts/generate-fiel-dev.ps1 (Windows CERTENROLL COM)

RFC detectado regex subject : $($Local.rfc)
Password archivo .key       : $PasswordPlain

Archivos:
  .cer  (DER publico)                       : $CerPath   ($($CertBytes.Length) bytes)
  .key  (PKCS#8 DER AES-256-CBC cifrado)    : $KeyDerPath ($($Pkcs8DerEncrypted.Length) bytes)
  .pfx  (exportable backup)                 : $PfxPath    ($($PfxBytes.Length) bytes)

Checks src/lib/fiel-validation.ts satisfechos:
  createPrivateKey(.key DER PKCS8 + pass)  = OK
  new X509Certificate(.cer)                = OK
  x509.publicKey == derivedPublicKey       = $($Local.isValid)
  regex RFC en subject coincide            = $($Local.rfc -eq $Rfc)  (RFC esperado: $Rfc)

Contratos POST /mass-downloads/credentials:
  rfc           = $Rfc
  password      = $PasswordPlain
  privateKey    = fiel-dev-valid.key
  certificate   = fiel-dev-valid.cer
  organizationId= ORG-A-ID (Grupo Demo)

Casos que se prueban con esta base:
  API-08.1 happy path                                  200/201 + AuditLog
  API-08.2 password incorrecta (misma FIEL, pass malo) 400
  API-08.4 .key 32KB (este .key + padding ceros)       413
  API-08.5 .cer 16KB                                    413
  API-08.6 RFC ajeno a tenant (U-OTH)                  403/404
"@
[System.IO.File]::WriteAllText($ReadmePath, $Readme, [System.Text.Encoding]::UTF8)

Write-Host ""
Write-Host "=== OK FIEL DEV LISTA ===" -ForegroundColor Green
Write-Host ("  RFC       : " + $Rfc)
Write-Host ("  PASS      : " + $PasswordPlain)
Write-Host ("  isValid   : " + $Local.isValid + "   RFC detectado: " + $Local.rfc)
Write-Host ("  .cer path : " + $CerPath)
Write-Host ("  .key path : " + $KeyDerPath)
Write-Host ("  README    : " + $ReadmePath)

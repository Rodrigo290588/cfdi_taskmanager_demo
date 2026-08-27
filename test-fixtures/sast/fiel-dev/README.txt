FIEL DE PRUEBA (autofirmada, NO VALIDA ANTE EL SAT).
Generador        : scripts/generate-fiel-dev-opensslfiles.mts  (openssl=C:\Program Files\Git\usr\bin\openssl.exe)
Generada         : 2026-08-13T23:47:29.855Z
RFC embebido     : QBB7223997V9
Password .key    : F1el-Dev-2026!
Cert Subject     : C=MX · O=ORG-B SAST PRUEBAS · OU=SAT TEST · CN=QBB7223997V9

Archivos finales (entregar a Postman / UI):
  .cer X.509 (DER)  : C:\ITC_IA\cfditaskmanager_demo\cfdi_taskmanager_demo\test-fixtures\sast\fiel-dev\fiel-dev-valid.cer  (909 bytes)
  .key PKCS#8 DER AES-256-CBC cifrado                     : C:\ITC_IA\cfditaskmanager_demo\cfdi_taskmanager_demo\test-fixtures\sast\fiel-dev\fiel-dev-valid.key  (1337 bytes)

Contrato validateFiel (src/lib/fiel-validation.ts) 1:1:
  createPrivateKey(der/pkcs8/pass) = OK
  new X509Certificate(.cer)       = OK
  x509.publicKey === derivedPK    = true
  regex RFC en subject            = MATCH (QBB7223997V9)

FormData para POST /api/mass-downloads/credentials (API-08.1 happy-path):
  rfc            = QBB7223997V9
  password       = F1el-Dev-2026!
  organizationId = cmnntrppk000502gcp93ketfx  (Grupo Demo / Org-A)
  privateKey     = C:\ITC_IA\cfditaskmanager_demo\cfdi_taskmanager_demo\test-fixtures\sast\fiel-dev\fiel-dev-valid.key
  certificate    = C:\ITC_IA\cfditaskmanager_demo\cfdi_taskmanager_demo\test-fixtures\sast\fiel-dev\fiel-dev-valid.cer

Casos negativos derivados:
  API-08.2 password incorrecto : password = "wrong-pass-123"
  API-08.4 .key > 8192 bytes   : payload-08-key-32KB.key
  API-08.5 .cer > 10240 bytes  : payload-08-cer-16KB.cer
  API-08.6 tenant mismatch     : U-OTH auth + orgId Org-A
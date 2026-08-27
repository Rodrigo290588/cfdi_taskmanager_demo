# Plan de Pruebas — Parches SAST `sast-api-report_20260812T193` (API-01 … API-12)

> Fecha de generación: 2026-08-12  
> Versión del plan: 1.0  
> Reemplaza / complementa a pruebas manuales previas del flujo SAT / Importación / FIEL.

## 1. Resumen de los 12 fixes aplicados

| ID      | Severidad | Archivo(s) y líneas afectadas                                                                 | Categoría OWASP 2021           |
| ------- | --------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| API-01  | Crítico   | `src/app/api/import/route.ts` (todo el handler)                                               | A01 Broken Access Control      |
| API-02  | Crítico   | `src/app/api/invoices/[id]/pdf/route.ts` (todo el handler)                                   | A01 Broken Access Control      |
| API-03  | Crítico   | `src/app/api/dev/sat_invoices/route.ts` + `src/lib/dev-endpoint-guard.ts`                    | A01 Broken Access Control      |
| API-04  | Crítico   | `src/app/api/mass-downloads/download-zip/route.ts` (scoping RFC)                              | A01 Broken Access Control      |
| API-05  | Crítico   | `src/app/api/dev/seed/route.ts` + `src/lib/dev-endpoint-guard.ts`                            | A05 Security Misconfig         |
| API-06  | Alto      | `src/app/api/companies/[id]/logo/route.ts`                                                    | A01 Broken Access Control      |
| API-07  | Alto      | `src/app/api/mass-downloads/download-zip/route.ts` + `src/app/api/companies/tenant/route.ts` | A02 Sensitive Exposure         |
| API-08  | Alto      | `src/app/api/mass-downloads/credentials/route.ts` (FIEL)                                     | A02 Sensitive Exposure         |
| API-09  | Alto      | `src/app/api/import/route.ts` (Zod strict + Anti-DOCTYPE)                                    | A03 Injection / XXE            |
| API-10  | Medio     | `src/app/api/admin/sat-69b/sync/route.ts` + `src/app/api/tenant/update-progress/route.ts`    | A05 Security Misconfig / DoS   |
| API-11  | Medio     | `src/lib/dev-endpoint-guard.ts` (helpers)                                                    | A05 Security Misconfig         |
| API-12  | Medio     | `src/app/api/import/route.ts` (error scrub + reqId + audit)                                  | A09 Logging / A02 Exposure     |

---

## 2. Pre-requisitos del entorno de prueba

Antes de correr los casos:

1. `NODE_ENV=development` en local; asegurar que al simular `NODE_ENV=production` los endpoints `/api/dev/*` retornan 404.
2. Usuarios con distintos `systemRole` + `member.role`:
   - U-SA: Usuario con `systemRole=SUPER_ADMIN` + membrecía APPROVED en Org-A.
   - U-ADM: `systemRole=USER`, member.role=`ADMIN` en Org-A.
   - U-CAD: `systemRole=COMPANY_ADMIN`, member.role=`AUDITOR` en Org-A (sin COMPANY_UPDATE / CFDI_FIEL_CREDENTIALS).
   - U-OTH: usuario con membrecía APPROVED **solo en Org-B** (para escenarios cross-tenant).
3. RFCs semilla:
   - RFC-A1: registrado en `FiscalEntity` (activado) de Org-A.
   - RFC-A2: registrado en `Company` (con `CompanyAccess`) de Org-A.
   - RFC-B1: pertenece a Org-B (FiscalEntity activo).
4. Credenciales FIEL válidas (archivos `.key` + `.cer` + `password` que validan).
5. Batch mínimo de 2 CFDI en XML para el caso API-09.
6. Herramienta: **Postman / curl**, con colección de cookies/sesión activa para cada usuario.
7. En cada solicitud, capturar `status`, `headers['X-Request-Id']`, `body.error`, `body.reqId`.

---

## 3. Casos de prueba por fix (12 + regresiones asociadas)

### 3.1 Caso 1 — API-01: Autenticación + Permiso `CFDI_IMPORT_BATCH` en `/api/import`

**Objetivo:** confirmar que solo usuarios autenticados, con membrecía APPROVED, con permiso `CFDI_IMPORT_BATCH`, pueden importar CFDI vía batch.

| #    | Dato de prueba                                                                                                     | Expected Status | Expected Body                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| 1.1  | `POST /api/import` **sin sesión** (sin `next-auth.session-token`).                                                 | 401             | `{ error: 'No autorizado', reqId }`                                           |
| 1.2  | Sesión usuario `U-CAD` (rol AUDITOR, sin CFDI_IMPORT_BATCH).                                                       | 403             | `{ error: /Permiso insuficiente/, reqId }`                                    |
| 1.3  | Sesión usuario `U-ADM` + batch JSON **fuera de schema** (e.g. `invoices[0].foo=1`, campo extra) y `strict()`.       | 400             | `{ error: /validación|schema/, reqId }`                                       |
| 1.4  | Sesión `U-ADM` + batch size **600** (supera max 500).                                                               | 400             | `{ error: /lote|máximo.*500/, reqId }`                                       |
| 1.5  | Sesión `U-ADM` + lote válido 2 CFDI.                                                                                | 200 / 202       | `{ success:true, created, failed, reqId }`; registro en `auditLog action='IMPORT'` |
| 1.6  | Ejecutar 12 veces API-1.5 en < 1 hora (rate limit 10/hr).                                                          | 429 en la 11ª   | Encabezado `Retry-After`; body `{ error: /límite/, reqId }`                   |

**Regresión asociada:** una vez que API-1.5 pasa y los 2 CFDI fueron insertados, usar la pantalla de "Lista de Comprobantes" y verificar que aparecen con los UUID correctos y el campo `createdBy = U-ADM.id`.

---

### 3.2 Caso 2 — API-02: Path Traversal + IDOR tenant en `/invoices/:id/pdf?file=`

**Objetivo:** bloquear `?file=` arbitrario, escopeo tenant y rate-limit.

| #    | Dato de prueba                                                                                                                  | Expected Status | Expected Body / Cabeceras                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------ |
| 2.1  | Sin sesión.                                                                                                                      | 401             | `{ error:'No autorizado', reqId }`                            |
| 2.2  | Sesión `U-ADM` de Org-A + `?file=..\..\..\windows\system32\drivers\etc\hosts` (URL-encoded), sin invoice-id.                    | 400             | `{ error: /No autorizado|Ruta inválida|solo invoice/, reqId }` |
| 2.3  | Sesión `U-ADM` de Org-A. Invoice-ID: CFDI de Org-B (RFC-B1 emisor). `?file` omitido (flujo normal).                              | 403             | `{ error: /tenant|RFC fuera/, reqId }`                       |
| 2.4  | Sesión `U-ADM` de Org-A. Invoice-ID: CFDI propio de Org-A. `?file` omitido.                                                    | 200             | Cabeceras `Content-Type: application/pdf`; `X-Request-Id` set; tamaño > 1KB |
| 2.5  | Forzar `NODE_ENV=production`. Sesión `U-ADM` Org-A con Invoice-ID propio, con `?file=valid-xml-inside-java-client.xml`.        | 400             | `{ error: /?file.*bloquead|producción/, reqId }`             |
| 2.6  | Invocar flujo 2.4 exitoso **181 veces** en < 1 hora (límite 180/hr).                                                             | 429             | `Retry-After`; `{ error: /límite/, reqId }`                  |

**Regresión asociada:** comprobar que en la pantalla "Detalle de CFDI" el botón "Ver PDF" sigue generando la vista PDF y `Content-Disposition: inline` sigue navegable sin download.

---

### 3.3 Caso 3 — API-03: `/api/dev/sat_invoices` protegido SUPER_ADMIN + NODE_ENV

**Objetivo:** endpoint `dev` accesible solo en dev + SUPER_ADMIN.

| #    | Dato de prueba                                                 | Expected Status | Expected                                      |
| ---- | -------------------------------------------------------------- | --------------- | --------------------------------------------- |
| 3.1  | Sin sesión.                                                    | 401             | `{ error:'No autorizado' }` (o 404 si prod)   |
| 3.2  | `NODE_ENV=production` + cualquier sesión válida.               | 404             | `{ error:'Endpoint no disponible' }`          |
| 3.3  | `NODE_ENV=development`, usuario `U-ADM` (no SA).               | 403             | `{ error: /SUPER_ADMIN/ }`                    |
| 3.4  | `NODE_ENV=development`, usuario `U-SA`, `rfc=ABCD*999` (inválido). | 400         | `{ error:'RFC inválido' }`                    |
| 3.5  | `NODE_ENV=development`, usuario `U-SA`, `rfc=<RFC-A1 válido>`. | 200             | `{ count, invoices[] }` con `rfc` coincidente |
| 3.6  | `limit=999` param.                                             | 200             | length de `invoices.length` ≤ 50 (clamp)      |

**Regresión asociada:** la tabla principal del SAT (screen de Monitoreo Operativo SAT) debe seguir alimentando `satInvoices` desde el flujo normal sin romperse.

---

### 3.4 Caso 4 — API-04: Descarga ZIP `/mass-downloads/download-zip` scoping tenant RFC

**Objetivo:** solo descargar paquetes SAT del RFC perteneciente al tenant.

| #    | Dato de prueba                                                                        | Expected Status | Expected Body                                             |
| ---- | ------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| 4.1  | Sin sesión.                                                                           | 401             | `{ error:'No autorizado' }`                               |
| 4.2  | Sesión `U-ADM` Org-A + `rfc=RFC-B1` (RFC de Org-B). `idPaquete` válido del SAT.      | 403             | `{ error: /RFC no autorizado dentro de tu tenant/ }`      |
| 4.3  | Sesión `U-ADM` Org-A + `rfc=RFC-A1` + `idPaquete=SAT-PAQ-AJENO` (pertenece a Org-B). | 404             | `{ error: /Paquete no encontrado o no asociado/ }`        |
| 4.4  | Sesión `U-ADM` Org-A + `rfc=RFC-A1` + `idPaquete=PAQ-VALIDO-A1`.                     | 200             | `Content-Type: application/zip`; tamaño > 50 bytes; `X-Request-Id` set |
| 4.5  | `rfc=RFC-A1` con símbolos raros (inyección): `' or 1=1 --`.                          | 400             | `{ error:'RFC inválido' }`                                |
| 4.6  | `idPaquete` con 500 caracteres.                                                       | 400             | `{ error:'idPaquete inválido' }`                          |

**Regresión asociada:** en pantalla "Descargas Masivas SAT", botón "Descargar ZIP" de un paquete TERMINADO sigue generando el `.zip` correctamente con el nombre de archivo esperado.

---

### 3.5 Caso 5 — API-05: `/api/dev/seed` NODE_ENV guard + RL + NO clientSecret leak

**Objetivo:** semilla dev no ejecutable en prod / por no-SA.

| #    | Dato de prueba                                                            | Expected Status | Expected                                                                   |
| ---- | ------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| 5.1  | `NODE_ENV=production`, cualquier usuario.                                | 404             | `{ error:'Endpoint no disponible' }`                                       |
| 5.2  | `NODE_ENV=development`, usuario `U-ADM` (no SA).                         | 403             | `{ error: /SUPER_ADMIN/ }`                                                 |
| 5.3  | `NODE_ENV=development`, `U-SA` (primera ejecución, usuario sin Org).      | 200             | `{ success, organizationId, invoicesCreated, machineClient.clientId }`    |
| 5.4  | Verificar **ausencia** de `machineClient.clientSecret` en respuesta 5.3.  | 200             | `!('clientSecret' in body.machineClient)`                                  |
| 5.5  | Repetir la petición 5.3 inmediatamente (segunda vez en 30 min).           | 429             | `{ error: /límite/ }` (rate limit 1/30min).                                |
| 5.6  | En DB, `count(MassDownloadRequest)` y `count(Invoice)` son coherentes.     | 200             | Los 60 invoices demo + 100 satInvoices de CHAU CHU CHIEN son insertados una sola vez |

**Regresión asociada:** el `MachineClient` creado por seed debe continuar autenticando exitosamente las pruebas de import M2M (flujo `java-client`) usando su scope `cfdi.import`.

---

### 3.6 Caso 6 — API-06: Logo compañía (`/companies/:id/logo`) IDOR tenant + COMPANY_UPDATE

**Objetivo:** no permitir subir logo a compañía ajena; requerir `COMPANY_UPDATE`; ext/size/RL.

| #    | Dato de prueba                                                                         | Expected Status | Expected                                                                       |
| ---- | -------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| 6.1  | Sin sesión.                                                                            | 401             | `{ error:'No autorizado' }`                                                    |
| 6.2  | Sesión `U-ADM` Org-A + `id=COMPANY-ID-ORG-B` (CompanyAccess de Org-B).                | 403             | `{ error: /Permisos insuficientes \(sin acceso a compañía\)/ }`                |
| 6.3  | Sesión `U-CAD` (AUDITOR) Org-A + `id=COMPANY-ID-ORG-A` (misma org, pero no `COMPANY_UPDATE`). | 403         | `{ error: /Permisos insuficientes \(company:update\)/ }`                       |
| 6.4  | Sesión `U-SA` + `id=COMPANY-ID-ORG-A` + `file=pdf-malicioso.pdf` (MIME:application/pdf). | 400         | `{ error:'Tipo de archivo no permitido' }` o `'Extensión de archivo no permitida'` |
| 6.5  | Archivo 8MB PNG (supera 5MB).                                                          | 413             | `{ error: /demasiado grande/ }`                                               |
| 6.6  | Formato correcto PNG/JPG de 100KB.                                                     | 200             | `{ success:true, logoUrl, reqId }`; `auditLog` con action='UPDATE' en table=companies |
| 6.7  | Repetir petición 6.6 más de 5 veces en < 1 hora.                                       | 429             | `{ error: /límite/ }`                                                          |

**Regresión asociada:** en pantalla "Editar Empresa" el avatar/logo del lado superior izquierdo muestra el nuevo `logoUrl` actualizado sin F5.

---

### 3.7 Caso 7 — API-07: Eliminado leak `details` en errores 500

**Objetivo:** errores 500 NO devuelven stack / Prisma error / SAT raw.

> Para generar 500 controlado sin tirar la DB: renombrar temporalmente una variable interna (ej. `organizationIdRAR`) vía patch mock, o bien mandar una request con body que active un `throw new Error('forced-500')` temporal en local.

| #    | Endpoint / Escenario                                                                 | Expected Status | Expected Body 500                                            |
| ---- | ------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------ |
| 7.1  | `GET /api/companies/tenant` forzar 500.                                              | 500             | body exacto: `{ error:'Error interno del servidor', reqId }` — no existe `details`. |
| 7.2  | `GET /api/mass-downloads/download-zip` forzar 500 (`downloadMassPackages` throw).    | 500             | exacto: `{ error:'No se pudo descargar el paquete desde el SAT', reqId }` — no existe `details`. |
| 7.3  | `POST /api/import` lanzar 500 no catcheado por Zod.                                  | 500             | `{ error:'Error interno', reqId }` — NO `stack`.             |
| 7.4  | Verificación visual: en Postman inspeccionar respuestas 7.1–7.3 contra schema JSON.  | 500             | **Cada** respuesta NO debe tener claves `details`, `stack`, `prisma`, `sql`. |

**Regresión asociada:** los logs internos de `console.error` SÍ deben tener `{ message, stack, reqId }` (inspeccionar terminal `next dev`).

---

### 3.8 Caso 8 — API-08: Subida FIEL `/mass-downloads/credentials` (tamaño/RL/audit/perm)

**Objetivo:** credenciales FIEL quedan cifradas; no permitir archivos gigantes; rate limit anti-fuerza-bruta password.

| #    | Dato de prueba                                                                   | Expected Status | Expected                                                                    |
| ---- | -------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| 8.1  | Sin sesión.                                                                      | 401             | `{ error:'No autorizado' }`                                                 |
| 8.2  | `U-CAD` (AUDITOR, sin `CFDI_FIEL_CREDENTIALS`) Org-A.                           | 403             | `{ error: /Permiso insuficiente: FIEL/ }`                                   |
| 8.3  | `U-ADM` Org-A + `rfc=RFC-B1` (RFC de Org-B).                                     | 403             | `{ error: /RFC no asociado a tu organización/ }`                            |
| 8.4  | `U-ADM` Org-A + `privateKey` de 32KB ( > 8KB límite).                           | 413             | `{ error: /excede tamaño máximo \(8KB\)/ }`                                 |
| 8.5  | `certificate` de 16KB ( > 10KB límite).                                          | 413             | `{ error: /excede tamaño máximo \(10KB\)/ }`                                |
| 8.6  | `privateKey` con extensión `.txt` (nombre mal).                                  | 400             | `{ error: /extensión .key/ }`                                               |
| 8.7  | Password incorrecta con FIEL válida (validateFiel falsy).                        | 400             | `{ error: /FIEL no es válida/, reqId }`; sin leak info openssl internos     |
| 8.8  | FIEL correcta + RFC válido + Org-A scope.                                        | 200             | `{ success:true, reqId }`. `sat_credentials` tiene `encryptedPrivateKey`. AuditLog creado (action UPDATE/CREATE en `table=sat_credentials`). |
| 8.9  | Ejecutar el caso 8.7 (password malo) 6 veces seguidas en < 1h.                   | 429 en la 6ª    | `{ error: /límite/, reqId }`                                                |

**Regresión asociada:** inmediatamente después del caso 8.8 exitoso, lanzar una descarga masiva SAT (solicitada) para validar que `satCredential` es desencriptado correctamente y firma SOAP exitosamente.

---

### 3.9 Caso 9 — API-09: Importación — Anti XXE / DOCTYPE / Billion Laughs / strict Zod

**Objetivo:** bloqueo inline de XML maliciosos.

| #    | Dato de prueba                                                                                                         | Expected Status | Expected                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| 9.1  | XML payload con `<!DOCTYPE cfdi [` … `<!ENTITY lol "&lol2;&lol2;&lol2;">` (Billion Laughs).                            | 400             | `{ error: /DOCTYPE|ENTITY|malicioso/, reqId }`; NO hay pico de RAM |
| 9.2  | XML payload conteniendo `<!ENTITY xxe SYSTEM "file:///etc/passwd">`.                                                   | 400             | `{ error: /ENTITY|DOCTYPE|malicioso/, reqId }`                   |
| 9.3  | Batch con campo `unknownField=123` fuera de schema `.strict()`.                                                        | 400             | `{ error: /validación|schema|desconocido/, reqId }`              |
| 9.4  | `invoices[0].xmlContent` > 50MB inflado.                                                                               | 413 / 400       | `{ error: /tamaño|Content-Length/, reqId }`                      |
| 9.5  | XML válido normal (lote de 1).                                                                                         | 200 / 202       | `{ success:true }` + registro en tabla `Invoice` y `AuditLog action=IMPORT` |

**Regresión asociada:** ejecutar una importación M2M real con JAR del `java-client` (20 CFDI emitidos típicos). Todos deben insertarse correctamente — verificación `count(Invoice)` + UUIDs.

---

### 3.10 Caso 10 — API-10: Anti Queue-DoS (`sat-69b/sync` + `tenant/update-progress`)

**Objetivo:** deduplicar jobs + rate-limit.

| #     | Dato de prueba                                                                                 | Expected Status         | Expected                                                                   |
| ----- | ---------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| 10.1  | `POST /api/admin/sat-69b/sync` sin sesión.                                                     | 401                     | `{ error:'No autorizado' }`                                                |
| 10.2  | `U-CAD` (AUDITOR Org-A) ejecutar 10.1.                                                         | 403                     | `{ error:'Permisos insuficientes' }`                                       |
| 10.3  | `U-ADM` Org-A. 1ra llamada (exitosa).                                                          | 200                     | `{ success:true, jobId }`. `sat69BBlacklistQueue.getJobs([waiting])` ve 1 job |
| 10.4  | Inmediatamente segunda llamada mientras el primero está `waiting`.                              | 202                     | `{ deduplicated:true, message:'Ya existe una sincronización en curso' }`   |
| 10.5  | Tercera llamada en < 15 min (antes del límite `2/15min`).                                      | 202 (por dedupe) o 429  | Si los primeros 2 pasaron → 429. De lo contrario 202.                     |
| 10.6  | `POST /api/tenant/update-progress`. Owner Org-A.                                               | 200                     | `{ success:true, message:'Progreso del tenant actualizado exitosamente' }` |
| 10.7  | Ejecutar 10.6 inmediatamente de nuevo (dentro de la ventana 5min).                             | 202                     | `{ deduplicated:true, message:'Actualización reciente, omitida' }`         |
| 10.8  | 10.6 con usuario `U-ADM` (no owner).                                                           | 403                     | `{ error:'No tienes permisos' }`                                           |

**Regresión asociada:** después de que expire la ventana, la cola de 69-B SÍ genera 1 nuevo job y actualiza `SatMetadata.blacklistedAt` cuando termine.

---

### 3.11 Caso 11 — API-11: Guardia global `/api/dev/*` NODE_ENV=production

**Objetivo:** todos los `/api/dev/*` existentes son 404 en producción; endpoints normales siguen vivos.

| #     | Dato de prueba                                                                | Expected Status | Expected                                          |
| ----- | ----------------------------------------------------------------------------- | --------------- | ------------------------------------------------- |
| 11.1  | Config `NODE_ENV=production` + reiniciar `next dev`.                          | — setup —       |                                                   |
| 11.2  | `GET /api/dev/sat_invoices`.                                                  | 404             | `{ error:'Endpoint no disponible' }`              |
| 11.3  | `POST /api/dev/seed`.                                                         | 404             | `{ error:'Endpoint no disponible' }`              |
| 11.4  | Endpoints reales: `GET /api/companies/tenant` con sesión válida `U-ADM`.     | 200             | `{ companies[], reqId }` → flujo normal sin tocar |
| 11.5  | Desactivar `NODE_ENV=production`; volver a dev. Ejecutar `U-SA` sobre seed.  | 200 / 403       | Flujo de casos 5.3 y 3.5 se comportan correctamente |

**Regresión asociada:** pantallas Home, Dashboard, Onboarding, Import, CFDI List, Companies list: todas siguen devolviendo 200 en sus API calls (solo `/api/dev/*` se vieron afectadas).

---

### 3.12 Caso 12 — API-12: Scrub 500 + reqId + Audit Importación

**Objetivo:** registro claro de errores 500 en `/api/import` y auditoría de import exitosa / fallida.

| #     | Dato de prueba                                                                    | Expected Status | Expected                                                                                 |
| ----- | --------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| 12.1  | `POST /api/import` — error runtime no capturado (patch mock throw).               | 500             | Body `{ error:'Error interno', reqId }`, sin `stack`. Header `X-Request-Id === body.reqId` |
| 12.2  | Revisar logs de terminal tras 12.1.                                               | OK              | `console.error('[api-import 500]', { message, stack, reqId })` — stack SOLO en server.  |
| 12.3  | Ejecutar importación exitosa lote=2 (Caso 9.5).                                   | 200             | En tabla `audit_logs`: dos filas `action='IMPORT'` con `recordId=invoice.uuid` correcto |
| 12.4  | Ejecutar importación con 1 XML inválido (Zod / parseo).                          | 400             | AuditLog opcional si implementaste `action='SAT_ERROR'`; mínimo: `reqId` en body        |

**Regresión asociada:** el Monitor Operativo / Últimas Importaciones (`AuditLog` screen) lista los 2 `action='IMPORT'` con `userEmail=U-ADM email` correcto.

---

## 4. Matriz de regresión global (post-parches)

Después de ejecutar los 12 casos individuales, correr la siguiente **batería funcional end-to-end** para validar que no se rompió flujo de negocio:

| Paso | Módulo / Flujo                                        | Acción manual                                                                                      | Esperado                                                                 |
| ---- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| R1   | Login + Onboarding                                    | Ingresar con usuario U-ADM nuevo; completar onboarding wizard                                     | No hay pantalla roja; cookies seteadas; Org creada.                     |
| R2   | Empresas                                              | Crear nueva company RFC-A3; aprobarla; asignar a U-ADM vía CompanyAccess                           | `status=APPROVED`; aparece en `GET /companies/tenant`                   |
| R3   | Importación (UI Drag & Drop)                          | Arrastrar 30 XML válidos emitidos/rechazados                                                         | Cola de import: 30 procesados; 0 fallos post 10s                         |
| R4   | Vista PDF                                             | Abrir detalle de cualquier CFDI importado; click "Ver PDF"                                         | Se abre embed PDF sin error 403/400                                      |
| R5   | Descarga ZIP SAT (si el entorno permite conectarse)   | Solicitar emitidos por mes, esperar TERMINADO, presionar "Descargar ZIP"                           | Zip descarga con UUIDs de CFDI                                          |
| R6   | FIEL upload (UI)                                      | Subir FIEL válida desde pantalla "Mis Credenciales SAT"                                            | Alert `success` de Sonner; `sat_credentials` actualizado                |
| R7   | Logo upload (UI)                                      | Subir logo company en pantalla "Editar Empresa"                                                    | Visual refresh del logo sin recarga                                     |
| R8   | Sync 69-B manual (Admin)                              | Click "Sincronizar lista 69-B"                                                                     | Estado de queue pasa a "En curso" → "Completado"                        |
| R9   | Tenant progress                                       | Click "Actualizar progreso tenant"                                                                 | KPIs dashboard recargados sin 403                                        |
| R10  | Seed dev (solo QA)                                    | Ejecutar `/api/dev/seed` con usuario SA                                                            | Escenario CHAU CHU CHIEN consistente; sin `clientSecret` leak           |

---

## 5. Criterio de "pass / fail" del plan completo

El plan completo se considera **PASS** sii TODAS las siguientes condiciones se cumplen:

- [ ] 100% de los casos 3.1 … 3.12 pasan con el expected status/body exacto.
- [ ] La matriz de regresión global R1 … R10 pasa sin errores visuales ni JavaScript no capturado (revisar consola navegador).
- [ ] En **ninguna** respuesta HTTP se devolvieron los keys `stack`, `details`, `sql`, `client_secret`, `password`, `xmlContent` completo.
- [ ] En **ningún** caso cross-tenant (Org-A vs Org-B) se visualizaron / descargaron datos del tenant contrario.
- [ ] `npm run lint` + `npx tsc --noEmit` pasan sin errores de tipo / lint luego de aplicar los 12 parches.

---

## 6. Anexo: plantilla de ejecución (Postman runner)

Para automatizar casos 1.1 a 12.4, crear una colección con **una carpeta por fix**. Cada request debe:

1. Definir variable `{{baseUrl}}` = `http://localhost:3000`
2. Variables por usuario: `{{cookie_sa}}`, `{{cookie_adm}}`, `{{cookie_cad}}`, `{{cookie_oth}}`
3. Tests de ejemplo para cada 401/403/404/429:

```javascript
pm.test("status es 401", () => pm.response.to.have.status(401))
pm.test("body.reqId es un uuid", () => {
  const { reqId } = pm.response.json()
  pm.expect(reqId).to.match(/^[a-f0-9-]{36}$/i)
})
pm.test("sin details leak", () => {
  const j = pm.response.json()
  pm.expect(j).not.to.have.property("details")
  pm.expect(j).not.to.have.property("stack")
})
```

---

**Fin del plan.** Una vez ejecutado, guardar evidencia Postman + screenshots + resultados en carpeta `reports/test-plan-api-sast/` con fecha de ejecución.

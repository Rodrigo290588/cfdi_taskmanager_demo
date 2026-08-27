# Debug Session: import-batch-500
- **Status**: [OPEN]
- **Issue**: El endpoint `POST /api/external/cfdi-import` responde HTTP 500 al enviar lotes desde el cliente Java, aun cuando el token OAuth ya se emite correctamente.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-import-batch-500.ndjson`

## Reproduction Steps
1. Obtener token OAuth válido para el scope `cfdi.import`
2. Ejecutar el cliente Java en modo directorio con envío de lotes
3. Observar respuesta HTTP 500 desde `POST /api/external/cfdi-import`

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | El payload `directoryControl` llega con forma válida, pero el fallo ocurre dentro de `stageExternalCfdiImport` al crear o relacionar `import_directory_sessions` | High | Low | Rejected for small/medium payloads |
| B | La falla ocurre al encolar `enqueueImportRunDispatch`, no en el staging, y está siendo atrapada como 500 antes de responder | Medium | Low | Rejected |
| C | El request JSON contiene valores inesperados (`executionId`, tamaños, items) y rompe validación o parsing antes del staging | Medium | Low | Confirmed for 500-file payloads due body-size limit |
| D | Prisma está fallando por esquema real / columnas / FK en `import_runs.directory_session_id` o `import_directory_sessions` | High | Low | Refined: confirmed timeout under many row inserts, fixed with bulk raw insert |
| E | El error proviene de un helper compartido de M2M/rate limit y no del flujo de importación como tal | Low | Medium | Rejected |

## Log Evidence
Instrumentación agregada en:
- `src/app/api/external/cfdi-import/route.ts`
- `src/lib/external-cfdi-import-staging.ts`

Evidencia pre-fix:
- Lote mínimo de 1 XML con `directoryControl`: `202 Accepted`
- Lote de 100 XML: `500 Internal Server Error`
- Debug log:
  - `route.ts:payload` confirma request válido con `itemCount=100`
  - `external-cfdi-import-staging.ts:transaction` confirma `PrismaClientKnownRequestError`
  - mensaje: `Transaction already closed ... expired transaction ... timeout was 5000 ms, however 5022 ms passed`
- Reproducción grande de 500 XML:
  - `route.ts:catch` confirma `SyntaxError`
  - mensaje: `Unterminated string in JSON at position 10485760`
  - esto demuestra límite efectivo de parseo del body JSON alrededor de 10 MB

Evidencia post-fix:
- `100 XML`: `202 Accepted`
- `500 XML`: `413 Payload Too Large` con mensaje explícito para reducir lote
- Ajuste aplicado en backend:
  - `stageExternalCfdiImport` ahora prepara cifrado/metadata fuera de la transacción
  - inserta `import_run_items` y `import_run_item_blobs` con `INSERT ... VALUES` masivo
- Ajuste aplicado en JAR:
  - el lote por directorio ya no depende solo de `--batch-size`
  - también se corta por presupuesto de payload seguro (`SAFE_MAX_REQUEST_BODY_BYTES`)
  - los errores `4xx` dejan de reintentarse automáticamente

## Verification Conclusion
Root cause confirmada en dos capas:
1. El staging expiraba la transacción Prisma por insertar demasiados registros uno a uno.
2. Los lotes muy grandes del JAR podían exceder el tamaño procesable del body JSON del endpoint.

La corrección backend quedó verificada con requests reales. Falta confirmación del usuario ejecutando nuevamente el JAR corregido.

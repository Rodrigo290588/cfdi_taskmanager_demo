import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

const DEFAULT_SNAPSHOT = path.resolve(
  process.cwd(),
  'reports',
  'db-backups',
  'db-snapshot-sast-pre-tests_2026-08-13T23-31-02.json'
)
const SNAPSHOT_PATH = process.env.SAST_SNAPSHOT_PATH || DEFAULT_SNAPSHOT
const DRY_RUN = process.argv.includes('--dry-run')
const DISABLE_FK_TRIGGERS = process.env.SAST_DISABLE_FK !== '0'

const CHUNK_SIZE = 1000

const TABLE_ORDER_DELETE_FK_SAFE: string[] = [
  'auditLog',
  'invoiceConcept',
  'invoiceBlob',
  'invoiceComplementIndex',
  'invoiceComplementAttribute',
  'invoiceRelatedCfdi',
  'invoicePaymentComplementDetail',
  'satInvoice',
  'providerUploadedCfdi',
  'providerReceivedCfdiDailySummary',
  'invoiceIssuedDailySummary',
  'provider69bBlacklistEntry',
  'providerSatCancellationAlert',
  'satValidationError',
  'providerPaymentUpdate',
  'importDirectorySession',
  'importRun',
  'massDownloadRequest',
  'satCredential',
  'companyAccess',
  'customRole',
  'machineClient',
  'member',
  'fiscalEntity',
  'company',
  'organization',
  'session',
  'verificationToken',
  'apiKey',
  'account',
  'user',
  'seed_dev_flags'
]

const TABLE_ORDER_INSERT_FK_SAFE: string[] = [
  'user',
  'organization',
  'account',
  'session',
  'verificationToken',
  'apiKey',
  'member',
  'customRole',
  'machineClient',
  'fiscalEntity',
  'company',
  'companyAccess',
  'satCredential',
  'invoice',
  'invoiceBlob',
  'invoiceConcept',
  'invoiceComplementIndex',
  'invoiceComplementAttribute',
  'invoiceRelatedCfdi',
  'invoicePaymentComplementDetail',
  'satInvoice',
  'massDownloadRequest',
  'providerUploadedCfdi',
  'providerReceivedCfdiDailySummary',
  'invoiceIssuedDailySummary',
  'provider69bBlacklistEntry',
  'providerSatCancellationAlert',
  'satValidationError',
  'providerPaymentUpdate',
  'importRun',
  'importDirectorySession',
  'auditLog',
  'seed_dev_flags'
]

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function sanitizeRow(table: string, row: any): any {
  if (!row || typeof row !== 'object') return row
  const out: any = { ...row }
  const decimalFields = ['subtotal', 'total', 'discount', 'ivaTransferred', 'ivaWithheld', 'isrWithheld', 'iepsWithheld']
  if (table === 'invoice') {
    for (const f of decimalFields) {
      if (typeof out[f] === 'string' || typeof out[f] === 'number') out[f] = new (global.Prisma || (prisma as any)._runtimeDataModel.Prisma || require('@prisma/client').Prisma).Decimal(String(out[f]))
    }
  }
  return out
}

async function main() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error('❌ SNAPSHOT NO ENCONTRADO:', SNAPSHOT_PATH)
    console.error('   Defina variable SAST_SNAPSHOT_PATH=ruta al json o valide el archivo default.')
    process.exit(2)
  }

  await prisma.$connect()
  console.log('')
  console.log('='.repeat(80))
  console.log('🔄 SAST ROLLBACK · NIVEL 3 · FULL RESTORE DESDE SNAPSHOT JSON')
  console.log('='.repeat(80))
  console.log('Snapshot path:    ', SNAPSHOT_PATH)
  console.log('Modo DRY_RUN:     ', DRY_RUN ? 'SÍ (no escribe BD)' : 'NO (ESCRIBE BD — ¡IRREVERSIBLE!)')
  console.log('Disable FK checks:', DISABLE_FK_TRIGGERS ? 'SÍ (SET CONSTRAINTS ALL IMMEDIATE + session_replication_role)' : 'NO (usa orden FK-safe)')
  console.log('')

  if (!DRY_RUN) {
    console.warn('⚠️  #############################################################')
    console.warn('⚠️  ESTE SCRIPT BORRA (DELETE TRUNCATE-LIKE) LAS TABLAS EN LISTA')
    console.warn('⚠️  Y LUEGO RE-INSERTAR LOS DATOS DEL SNAPSHOT.')
    console.warn('⚠️  · ES IRREVERSIBLE si no haces BACKUP PREVIO MANUAL ADICIONAL.')
    console.warn('⚠️  · Modifica TODO el universo de datos (no solo SAST seed).')
    console.warn('⚠️  · SÓLO USAR SI NIVEL 1 Y NIVEL 2 FALLARON.')
    console.warn('⚠️ #############################################################')
    console.log('')
  }

  const snapshotRaw = fs.readFileSync(SNAPSHOT_PATH, 'utf-8')
  const snapshot: any = JSON.parse(snapshotRaw)

  const tablesInSnapshot = Object.keys(snapshot).filter(k => k !== '_meta' && snapshot[k] && Array.isArray(snapshot[k].rows))
  console.log('Tablas detectadas en snapshot:', tablesInSnapshot.length, '·', tablesInSnapshot.join(', '))
  console.log('_meta.generatedAt:', snapshot._meta?.generatedAt || '(sin metadata)')
  console.log('')

  if (DRY_RUN) {
    console.log('[DRY-RUN] · Resumen de lo que haría en modo real:')
    for (const tbl of TABLE_ORDER_DELETE_FK_SAFE) {
      if (tablesInSnapshot.includes(tbl)) console.log(`  ▸ DELETE from [${tbl}] → ${snapshot[tbl].count} rows; luego INSERT ${snapshot[tbl].rows.length} rows`)
    }
    console.log('')
    console.log('[DRY-RUN] · Ejecución omitida. Remueve --dry-run para efectuar cambios.')
    await prisma.$disconnect()
    process.exit(0)
  }

  await prisma.$transaction(async (tx) => {
    console.log('--- Fase 1/2 · Borrado ordenado (FK-safe descendente) ---')
    for (const tbl of TABLE_ORDER_DELETE_FK_SAFE) {
      if (!tablesInSnapshot.includes(tbl)) { console.log(`  · skip [${tbl}] (no en snapshot) ·`); continue }
      const delegate = (tx as any)[tbl]
      if (!delegate) { console.log(`  · skip [${tbl}] (prisma delegate missing)`); continue }
      try {
        const beforeCount = await delegate.count()
        await delegate.deleteMany({})
        console.log(`  · truncate DELETE [${tbl}] · before=${beforeCount}  →  after=0`)
      } catch (e: any) {
        console.error(`  ❌ FAIL delete [${tbl}]:`, e.message?.slice(0, 200))
        throw e
      }
    }
    console.log('')
    console.log('--- Fase 2/2 · Insertado ordenado (FK-safe ascendente) ---')
    for (const tbl of TABLE_ORDER_INSERT_FK_SAFE) {
      if (!tablesInSnapshot.includes(tbl)) { console.log(`  · skip [${tbl}] (no en snapshot)`); continue }
      const delegate = (tx as any)[tbl]
      if (!delegate) { console.log(`  · skip [${tbl}] (prisma delegate missing)`); continue }
      const rowsRaw: any[] = snapshot[tbl].rows || []
      if (rowsRaw.length === 0) { console.log(`  · insert [${tbl}] · 0 rows (skip chunk)`); continue }
      const chunks = chunkArray(rowsRaw.map(r => sanitizeRow(tbl, r)), CHUNK_SIZE)
      let total = 0
      for (let i = 0; i < chunks.length; i++) {
        try {
          await delegate.createMany({ data: chunks[i], skipDuplicates: true })
          total += chunks[i].length
        } catch (e: any) {
          console.error(`  ❌ FAIL insert [${tbl}] chunk ${i + 1}/${chunks.length}:`, e.message?.slice(0, 250))
          throw e
        }
      }
      console.log(`  · insert [${tbl}] · ${rowsRaw.length} rows en ${chunks.length} chunks ${CHUNK_SIZE} rows`)
    }
    console.log('')
    console.log('=== ✅ TRANSACCIÓN FASE 1+2 COMPLETADA DENTRO DE prisma.$transaction ===')
    console.log('   No se ha hecho COMMIT todavía — la validación corre fuera del tx para Prisma.')
  }, { timeout: 1_800_000 })

  console.log('')
  console.log('=== ✅ FULL RESTORE COMMIT REALIZADO. Ejecutando Post-Validación... ===')
  console.log('')
  const validationErrors: string[] = []
  for (const tbl of tablesInSnapshot) {
    const delegate = (prisma as any)[tbl]
    if (!delegate) continue
    const expected = Number(snapshot[tbl].count || snapshot[tbl].rows?.length || 0)
    let actual = -1
    try { actual = await delegate.count() }
    catch (e: any) { validationErrors.push(`[${tbl}] count failed: ${e.message.slice(0, 120)}`); continue }
    const diff = actual - expected
    const ok = Math.abs(diff) <= 2
    console.log(`  ${ok ? '✅' : '⚠️ '} [${tbl.padEnd(28)}] esperado=${String(expected).padStart(7)}  actual=${String(actual).padStart(7)}  diff=${diff >= 0 ? '+' : ''}${diff}`)
    if (!ok) validationErrors.push(`[${tbl}] desvío. Esperado=${expected}  Actual=${actual}  Diff=${diff}`)
  }
  console.log('')
  if (validationErrors.length === 0) {
    console.log('✅ POST-VALIDACIÓN PASÓ 100%. Restore FULL exitoso.')
    console.log('   Siguiente paso: (1) reiniciar next dev (reset RL store).')
    console.log('                   (2) ejecutar seed-sast-fixtures.mts si necesitas scoping data de nuevo.')
    console.log('                   (3) limpiar archivos uploads/ según RUNBOOK (si corresponde).')
  } else {
    console.log('⚠️  POST-VALIDACIÓN con desvíos:')
    for (const v of validationErrors) console.log('   ·', v)
    console.log('   No es necesariamente fallo (createMany skipDuplicates + tablas que estaban vacías en snapshot).')
    console.log('   Si los números desvían > 5%, restaurar nativo con pg_restore (NIVEL 3.b del RUNBOOK).')
  }
}

main().catch(async (e) => {
  console.error('')
  console.error('❌ FULL RESTORE FALLÓ — Prisma ROLLBACK automático en $transaction (no hubo cambios).')
  console.error('   Error:', (e as Error).message)
  console.error('   Stack:', (e as Error).stack?.slice(0, 1500))
  await prisma.$disconnect()
  process.exit(1)
})

import { loadEnvConfig } from '@next/env'
import { syncSat69BBlacklist } from '../lib/sat-69b-blacklist'

loadEnvConfig(process.cwd())

async function main() {
  const startedAt = Date.now()
  const result = await syncSat69BBlacklist()

  if (result.skipped) {
    console.log('[Sat69BBlacklist] Sincronizacion omitida: configura SAT_69B_SOURCE_FILE_PATH o SAT_69B_SOURCE_URL')
    process.exit(1)
  }

  console.log('[Sat69BBlacklist] Sincronizacion completada')
  console.log(`  Fuente: ${result.source}`)
  console.log(`  Lineas procesadas: ${result.processedLines}`)
  console.log(`  Registros parseados: ${result.parsedEntries}`)
  console.log(`  Registros upsertados: ${result.upsertedEntries}`)
  console.log(`  Registros de riesgo activo: ${result.activeRiskEntries}`)
  console.log(`  Registros obsoletos eliminados: ${result.removedStaleEntries}`)
  console.log(`  Duracion: ${Date.now() - startedAt} ms`)
}

main().catch(error => {
  console.error('[Sat69BBlacklist] Error en sincronizacion manual:', error)
  process.exit(1)
})

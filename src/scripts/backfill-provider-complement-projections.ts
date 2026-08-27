import { loadEnvConfig } from '@next/env'
import { prisma } from '../lib/prisma'
import { decryptXmlContent } from '../lib/provider-cfdi-storage'
import { upsertProviderUploadedCfdiComplementProjection } from '../lib/cfdi-complement-projection-storage'

loadEnvConfig(process.cwd())

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const batchSize = parsePositiveInt(process.env.PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_BATCH_SIZE, 200)
  const dryRun = process.env.PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_DRY_RUN === '1'
  const startAfterId = (process.env.PROVIDER_COMPLEMENT_PROJECTION_BACKFILL_START_AFTER_ID || '').trim() || null

  let lastId = startAfterId
  let processed = 0
  let projected = 0
  let chunk = 0

  console.log('[ProviderComplementProjectionBackfill] Inicio')
  console.log(`  Batch size: ${batchSize}`)
  console.log(`  Dry run: ${dryRun ? 'si' : 'no'}`)
  if (startAfterId) {
    console.log(`  Reanudar despues de id: ${startAfterId}`)
  }

  while (true) {
    const rows = await prisma.providerUploadedCfdi.findMany({
      where: {
        ...(lastId ? { id: { gt: lastId } } : {})
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        organizationId: true,
        providerRfc: true,
        xmlBlob: {
          select: {
            xmlCiphertext: true,
            xmlIv: true,
            xmlAuthTag: true,
            xmlEncryptionAlg: true,
            xmlKeyVersion: true
          }
        }
      }
    })

    if (rows.length === 0) {
      break
    }

    chunk += 1
    processed += rows.length
    lastId = rows[rows.length - 1]?.id || lastId

    for (const row of rows) {
      if (!row.xmlBlob) {
        continue
      }

      const xmlContent = decryptXmlContent({
        ciphertext: row.xmlBlob.xmlCiphertext,
        iv: row.xmlBlob.xmlIv,
        authTag: row.xmlBlob.xmlAuthTag,
        algorithm: row.xmlBlob.xmlEncryptionAlg,
        keyVersion: row.xmlBlob.xmlKeyVersion || undefined,
        aadBindParams: {
          organizationId: row.organizationId,
          providerRfc: row.providerRfc,
          storageId: row.id
        }
      })

      if (!xmlContent) {
        continue
      }

      projected += 1

      if (!dryRun) {
        await upsertProviderUploadedCfdiComplementProjection(prisma, {
          providerUploadedCfdiId: row.id,
          xmlContent
        })
      }
    }

    console.log(`[ProviderComplementProjectionBackfill] Chunk ${chunk} | leidos=${rows.length} | proyectados=${projected} | ultimoId=${lastId}`)
  }

  console.log('[ProviderComplementProjectionBackfill] Fin')
  console.log(`  Registros procesados: ${processed}`)
  console.log(`  Registros proyectados: ${projected}`)
  console.log(`  Ultimo id procesado: ${lastId || 'N/A'}`)
}

main()
  .catch(error => {
    console.error('[ProviderComplementProjectionBackfill] Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

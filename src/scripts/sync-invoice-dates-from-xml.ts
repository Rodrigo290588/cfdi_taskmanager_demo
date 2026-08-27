import { loadEnvConfig } from '@next/env'
import { prisma } from '../lib/prisma'
import { decryptInvoiceXmlContent } from '../lib/invoice-xml-storage'
import { parseCfdiDateTime } from '../lib/cfdi-date'

loadEnvConfig(process.cwd())

function readEnv(name: string) {
  return String(process.env[name] || '').trim()
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function extractAttribute(xml: string, tagPattern: string, attributeName: string) {
  const match = xml.match(new RegExp(`<${tagPattern}[^>]*\\b${attributeName}="([^"]+)"`, 'i'))
  return match?.[1] || ''
}

async function main() {
  const uuid = readEnv('INVOICE_UUID')
  const batchSize = parsePositiveInt(process.env.INVOICE_DATE_SYNC_BATCH_SIZE, 500)
  const startAfterId = readEnv('INVOICE_DATE_SYNC_START_AFTER_ID') || null

  let cursorId = uuid ? null : startAfterId
  let scanned = 0
  let updated = 0
  let chunk = 0

  console.log('[SyncInvoiceDatesFromXml] Inicio')
  console.log(`  UUID unico: ${uuid || 'N/A'}`)
  console.log(`  Batch size: ${batchSize}`)
  if (startAfterId) {
    console.log(`  Reanudar despues de id: ${startAfterId}`)
  }

  while (true) {
    const rows = await prisma.invoice.findMany({
      where: uuid ? { uuid } : (cursorId ? { id: { gt: cursorId } } : {}),
      orderBy: { id: 'asc' },
      take: uuid ? 1 : batchSize,
      select: {
        id: true,
        uuid: true,
        issuanceDate: true,
        certificationDate: true,
        xmlContent: true,
        blob: {
          select: {
            xmlCiphertext: true,
            xmlIv: true,
            xmlAuthTag: true,
            xmlEncryptionAlg: true
          }
        }
      }
    })

    if (rows.length === 0) {
      break
    }

    chunk += 1
    scanned += rows.length

    for (const row of rows) {
      const xmlContent = row.xmlContent?.trim()
        || (row.blob
          ? decryptInvoiceXmlContent({
              ciphertext: row.blob.xmlCiphertext,
              iv: row.blob.xmlIv,
              authTag: row.blob.xmlAuthTag,
              algorithm: row.blob.xmlEncryptionAlg
            })
          : '')

      if (!xmlContent) {
        continue
      }

      const issuanceRaw = extractAttribute(xmlContent, '[^:>]*:?Comprobante', 'Fecha')
      const certificationRaw = extractAttribute(xmlContent, '[^:>]*:?TimbreFiscalDigital', 'FechaTimbrado')

      const nextIssuanceDate = parseCfdiDateTime(issuanceRaw, row.issuanceDate)
      const nextCertificationDate = parseCfdiDateTime(certificationRaw, nextIssuanceDate)

      const issuanceChanged = row.issuanceDate.getTime() !== nextIssuanceDate.getTime()
      const certificationChanged = (row.certificationDate?.getTime() || 0) !== nextCertificationDate.getTime()

      if (!issuanceChanged && !certificationChanged) {
        continue
      }

      await prisma.invoice.update({
        where: { id: row.id },
        data: {
          issuanceDate: nextIssuanceDate,
          certificationDate: nextCertificationDate
        }
      })

      updated += 1

      console.log(JSON.stringify({
        uuid: row.uuid,
        previousIssuanceDate: row.issuanceDate.toISOString(),
        nextIssuanceDate: nextIssuanceDate.toISOString(),
        previousCertificationDate: row.certificationDate?.toISOString() || null,
        nextCertificationDate: nextCertificationDate.toISOString()
      }))
    }

    if (uuid) {
      break
    }

    cursorId = rows[rows.length - 1]?.id || cursorId
    console.log(`[SyncInvoiceDatesFromXml] Chunk ${chunk} | leidos=${rows.length} | escaneados=${scanned} | actualizados=${updated} | ultimoId=${cursorId}`)

    if (rows.length < batchSize) {
      break
    }
  }

  console.log('[SyncInvoiceDatesFromXml] Fin')
  console.log(`  Registros escaneados: ${scanned}`)
  console.log(`  Registros actualizados: ${updated}`)
  console.log(`  Ultimo id procesado: ${cursorId || 'N/A'}`)
}

main()
  .catch(error => {
    console.error('[SyncInvoiceDatesFromXml] Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

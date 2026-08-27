import { loadEnvConfig } from '@next/env'
import { prisma } from '../lib/prisma'
import { decryptXmlContent } from '../lib/provider-cfdi-storage'
import { parseCfdiDateTime } from '../lib/cfdi-date'
import { syncProviderReceivedCfdiSummaryRecordChange } from '../lib/provider-received-cfdi-summary'

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
  const uuid = readEnv('PROVIDER_CFDI_UUID')
  const batchSize = parsePositiveInt(process.env.PROVIDER_CFDI_DATE_SYNC_BATCH_SIZE, 500)
  const startAfterId = readEnv('PROVIDER_CFDI_DATE_SYNC_START_AFTER_ID') || null

  let cursorId = uuid ? null : startAfterId
  let scanned = 0
  let updated = 0
  let chunk = 0

  console.log('[SyncProviderCfdiDatesFromXml] Inicio')
  console.log(`  UUID unico: ${uuid || 'N/A'}`)
  console.log(`  Batch size: ${batchSize}`)
  if (startAfterId) {
    console.log(`  Reanudar despues de id: ${startAfterId}`)
  }

  while (true) {
    const rows = await prisma.providerUploadedCfdi.findMany({
      where: uuid ? { uuid } : (cursorId ? { id: { gt: cursorId } } : {}),
      orderBy: { id: 'asc' },
      take: uuid ? 1 : batchSize,
      select: {
        id: true,
        uuid: true,
        organizationId: true,
        providerRfc: true,
        receiverCompanyId: true,
        issuanceDate: true,
        certificationDate: true,
        cfdiType: true,
        satEstado: true,
        issuerRfc: true,
        issuerName: true,
        paymentMethod: true,
        paymentStatusManual: true,
        total: true,
        transferredTaxesTotal: true,
        withheldTaxesTotal: true,
        validationStatus: true,
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
    scanned += rows.length

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

      const issuanceRaw = extractAttribute(xmlContent, '[^:>]*:?Comprobante', 'Fecha')
      const certificationRaw = extractAttribute(xmlContent, '[^:>]*:?TimbreFiscalDigital', 'FechaTimbrado')

      const nextIssuanceDate = parseCfdiDateTime(issuanceRaw, row.issuanceDate || undefined)
      const nextCertificationDate = parseCfdiDateTime(certificationRaw, nextIssuanceDate)

      const issuanceChanged = (row.issuanceDate?.getTime() || 0) !== nextIssuanceDate.getTime()
      const certificationChanged = (row.certificationDate?.getTime() || 0) !== nextCertificationDate.getTime()

      if (!issuanceChanged && !certificationChanged) {
        continue
      }

      await prisma.$transaction(async tx => {
        await tx.providerUploadedCfdi.update({
          where: { id: row.id },
          data: {
            issuanceDate: nextIssuanceDate,
            certificationDate: nextCertificationDate
          }
        })

        await syncProviderReceivedCfdiSummaryRecordChange({
          db: tx,
          previousRecord: {
            organizationId: row.organizationId,
            receiverCompanyId: row.receiverCompanyId,
            issuanceDate: row.issuanceDate,
            cfdiType: row.cfdiType,
            satEstado: row.satEstado,
            issuerRfc: row.issuerRfc,
            issuerName: row.issuerName,
            paymentMethod: row.paymentMethod,
            paymentStatusManual: row.paymentStatusManual,
            total: row.total,
            transferredTaxesTotal: row.transferredTaxesTotal,
            withheldTaxesTotal: row.withheldTaxesTotal,
            validationStatus: row.validationStatus
          },
          nextRecord: {
            organizationId: row.organizationId,
            receiverCompanyId: row.receiverCompanyId,
            issuanceDate: nextIssuanceDate,
            cfdiType: row.cfdiType,
            satEstado: row.satEstado,
            issuerRfc: row.issuerRfc,
            issuerName: row.issuerName,
            paymentMethod: row.paymentMethod,
            paymentStatusManual: row.paymentStatusManual,
            total: row.total,
            transferredTaxesTotal: row.transferredTaxesTotal,
            withheldTaxesTotal: row.withheldTaxesTotal,
            validationStatus: row.validationStatus
          }
        })
      })

      updated += 1

      console.log(JSON.stringify({
        uuid: row.uuid,
        previousIssuanceDate: row.issuanceDate?.toISOString() || null,
        nextIssuanceDate: nextIssuanceDate.toISOString(),
        previousCertificationDate: row.certificationDate?.toISOString() || null,
        nextCertificationDate: nextCertificationDate.toISOString()
      }))
    }

    if (uuid) {
      break
    }

    cursorId = rows[rows.length - 1]?.id || cursorId
    console.log(`[SyncProviderCfdiDatesFromXml] Chunk ${chunk} | leidos=${rows.length} | escaneados=${scanned} | actualizados=${updated} | ultimoId=${cursorId}`)

    if (rows.length < batchSize) {
      break
    }
  }

  console.log('[SyncProviderCfdiDatesFromXml] Fin')
  console.log(`  Registros escaneados: ${scanned}`)
  console.log(`  Registros actualizados: ${updated}`)
  console.log(`  Ultimo id procesado: ${cursorId || 'N/A'}`)
}

main()
  .catch(error => {
    console.error('[SyncProviderCfdiDatesFromXml] Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

import { loadEnvConfig } from '@next/env'
import { PrismaClient } from '@prisma/client'
// Solucion al TypeError importando desde archivo storage en vez de xml-storage
import { decryptInvoiceXmlContent } from '../lib/invoice-xml-storage'
import { extractTaxes } from '../lib/invoice-import'

const projectDir = process.cwd()
loadEnvConfig(projectDir)

const prisma = new PrismaClient()

type InvoiceBatchItem = {
  id: string
  blob: {
    xmlCiphertext: string
    xmlIv: string
    xmlAuthTag: string
    xmlEncryptionAlg: string
  } | null
}

async function processInvoiceBatch(batch: InvoiceBatchItem[]) {
  const updates = []
  let batchErrorCount = 0

  for (const invoice of batch) {
    try {
      let xml: string | null = null
      if (invoice.blob?.xmlCiphertext) {
        xml = decryptInvoiceXmlContent({
          ciphertext: invoice.blob.xmlCiphertext,
          iv: invoice.blob.xmlIv,
          authTag: invoice.blob.xmlAuthTag,
          algorithm: invoice.blob.xmlEncryptionAlg
        })
      }
      
      if (!xml) {
        continue
      }

      const extractedTaxes = extractTaxes(xml)
      const isPublicGlobal = /<(?:[\w-]+:)?InformacionGlobal/i.test(xml)

      updates.push(
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            iva16Base: extractedTaxes.iva16Base,
            iva16Tax: extractedTaxes.iva16Tax,
            iva8Base: extractedTaxes.iva8Base,
            iva8Tax: extractedTaxes.iva8Tax,
            iva0Base: extractedTaxes.iva0Base,
            ivaExemptBase: extractedTaxes.ivaExemptBase,
            isPublicGlobal
          },
          select: { id: true }
        })
      )
    } catch (e) {
      console.error(`❌ Error parseando factura ${invoice.id}:`, e)
      batchErrorCount++
    }
  }

  if (updates.length > 0) {
    // Ejecutamos actualizaciones en paralelo dentro de una transaccion
    await prisma.$transaction(updates)
  }

  return { updatedCount: updates.length, batchErrorCount }
}

async function main() {
  console.log('🚀 Iniciando script de backfilling histórico de impuestos (IVA, Ventas Globales)...')

  const BATCH_SIZE = 2500
  let cursor: string | undefined
  let processedCount = 0
  let updatedCount = 0
  let errorCount = 0

  do {
    const batch = await prisma.invoice.findMany({
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      select: {
        id: true,
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

    if (batch.length === 0) {
      break
    }

    const { updatedCount: batchUpdated, batchErrorCount } = await processInvoiceBatch(batch)
    
    updatedCount += batchUpdated
    errorCount += batchErrorCount
    processedCount += batch.length
    
    console.log(`✅ Procesadas: ${processedCount} | Actualizadas: ${updatedCount} | Errores: ${errorCount}`)

    cursor = batch.at(-1)?.id
  } while (cursor)

  console.log('🎉 Backfill histórico completado.')
  console.log(`📊 Total procesadas: ${processedCount}`)
  console.log(`✅ Total actualizadas: ${updatedCount}`)
  console.log(`❌ Total errores: ${errorCount}`)
}

main()
  .catch(e => {
    console.error('Error crítico en el backfill:', e)
    process.exit(1)
  })
  .finally(() => {
    prisma.$disconnect().catch(() => {})
  })

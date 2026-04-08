import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BATCH_SIZE = 100

function attrNs(xml, tagNs, attrName) {
  const re = new RegExp(`<${tagNs}[^>]*\\b${attrName}="([^"]+)"`, 'i')
  const m = xml.match(re)
  return m ? m[1] : null
}

function parseDecimal(value, fallback = '0') {
  const normalized = (value || '').replace(/,/g, '').trim()
  if (!normalized) return fallback
  const n = Number(normalized)
  return Number.isFinite(n) ? n.toFixed(2) : fallback
}

async function main() {
  console.log('Iniciando poblado de InvoiceConcept...')

  // Obtener facturas que no tienen conceptos
  const invoices = await prisma.invoice.findMany({
    where: {
      concepts: {
        none: {}
      }
    },
    select: {
      id: true,
      uuid: true,
      xmlContent: true
    }
  })

  console.log(`Se encontraron ${invoices.length} facturas sin conceptos.`)

  let processed = 0
  let conceptsCreated = 0

  for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
    const batch = invoices.slice(i, i + BATCH_SIZE)
    const allConceptsData = []

    for (const inv of batch) {
      if (!inv.xmlContent) continue

      const xml = inv.xmlContent
      const conceptoRegex = /<[^:>]*:?Concepto\b([^>]*)>(.*?)<\/[^:>]*:?Concepto>/gis
      
      for (const match of xml.matchAll(conceptoRegex)) {
        const attrs = match[1]
        
        const productServiceKey = attrNs(`<Tag ${attrs}>`, 'Tag', 'ClaveProdServ') || '01010101'
        const identificationNumber = attrNs(`<Tag ${attrs}>`, 'Tag', 'NoIdentificacion') || null
        const unitQuantity = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'Cantidad'), '1')
        const unitKey = attrNs(`<Tag ${attrs}>`, 'Tag', 'ClaveUnidad') || 'H87'
        const unitDescription = attrNs(`<Tag ${attrs}>`, 'Tag', 'Unidad') || null
        const description = attrNs(`<Tag ${attrs}>`, 'Tag', 'Descripcion') || 'Sin descripcion'
        const unitValue = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'ValorUnitario'), '0')
        const amount = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'Importe'), '0')
        const discount = parseDecimal(attrNs(`<Tag ${attrs}>`, 'Tag', 'Descuento'), '0')
        const objectOfTax = attrNs(`<Tag ${attrs}>`, 'Tag', 'ObjetoImp') || '01'

        allConceptsData.push({
          invoiceId: inv.id,
          productServiceKey,
          identificationNumber,
          unitQuantity,
          unitKey,
          unitDescription,
          description,
          unitValue,
          amount,
          discount,
          objectOfTax,
        })
      }
    }

    if (allConceptsData.length > 0) {
      const result = await prisma.invoiceConcept.createMany({
        data: allConceptsData,
        skipDuplicates: true
      })
      conceptsCreated += result.count
    }

    processed += batch.length
    console.log(`Procesadas ${processed}/${invoices.length} facturas. Conceptos creados hasta ahora: ${conceptsCreated}`)
  }

  console.log('Poblado completado.')
  console.log(`Total facturas procesadas: ${processed}`)
  console.log(`Total conceptos creados: ${conceptsCreated}`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
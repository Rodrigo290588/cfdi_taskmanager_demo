import fs from 'fs/promises'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BATCH_SIZE = 25

async function collectXmlFiles(dir, output = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectXmlFiles(fullPath, output)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
      output.push(fullPath)
    }
  }
  return output
}

function extractUuid(xml) {
  const match = xml.match(/<[^:>]*:?TimbreFiscalDigital[^>]*\bUUID="([^"]+)"/i)
  return match ? match[1] : null
}

async function postBatch(batch) {
  const response = await fetch('http://localhost:3000/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`)
  }
  return data
}

async function main() {
  const xmlDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.cwd(), 'java-client', 'xml-data')

  console.log(`Escaneando XML en: ${xmlDir}`)
  const xmlFiles = await collectXmlFiles(xmlDir)
  console.log(`XML encontrados: ${xmlFiles.length}`)

  const uuidToPayload = new Map()
  for (const file of xmlFiles) {
    try {
      const xmlContent = await fs.readFile(file, 'utf8')
      const uuid = extractUuid(xmlContent)
      if (uuid) {
        uuidToPayload.set(uuid, {
          xmlContent,
          source_file: path.basename(file),
        })
      }
    } catch (error) {
      console.warn(`No se pudo leer ${path.basename(file)}: ${error.message}`)
    }
  }

  const [cfdis, invoices] = await Promise.all([
    prisma.cfdi.findMany({ select: { uuid: true }, orderBy: { fechaEmision: 'asc' } }),
    prisma.invoice.findMany({ select: { uuid: true } }),
  ])

  const existingInvoices = new Set(invoices.map((row) => row.uuid))
  const pending = []
  let missingXml = 0

  for (const cfdi of cfdis) {
    if (existingInvoices.has(cfdi.uuid)) continue
    const payload = uuidToPayload.get(cfdi.uuid)
    if (!payload) {
      missingXml++
      continue
    }
    pending.push(payload)
  }

  console.log(`CFDI pendientes de migrar: ${pending.length}`)
  console.log(`CFDI sin XML localizado: ${missingXml}`)

  let created = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    const result = await postBatch(batch)
    created += result?.summary?.created || 0
    skipped += result?.summary?.skipped || 0
    errors += result?.summary?.errors || 0
    console.log(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: creados=${result?.summary?.created || 0}, omitidos=${result?.summary?.skipped || 0}, errores=${result?.summary?.errors || 0}`)
    if ((result?.summary?.errors || 0) > 0 && Array.isArray(result?.results)) {
      for (const item of result.results.filter((row) => row.status === 'error')) {
        console.log(`  Error: ${item.message || 'Error desconocido'}${item.uuid ? ` (UUID: ${item.uuid})` : ''}`)
      }
    }
  }

  console.log('Resumen de migracion:')
  console.log(`- CFDI revisados: ${cfdis.length}`)
  console.log(`- Invoices creados: ${created}`)
  console.log(`- Omitidos por existir: ${skipped}`)
  console.log(`- Sin XML localizado: ${missingXml}`)
  console.log(`- Errores: ${errors}`)
}

main()
  .catch((error) => {
    console.error('Fallo la migracion cfdis -> invoices:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

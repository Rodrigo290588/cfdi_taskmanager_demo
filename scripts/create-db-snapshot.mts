import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

const OUT_DIR = path.resolve(process.cwd(), 'reports', 'db-backups')
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT_FILE = path.join(OUT_DIR, `db-snapshot-sast-pre-tests_${TIMESTAMP}.json`)

const TABLES: Array<keyof PrismaClient> = [
  'auditLog',
  'company',
  'companyAccess',
  'customRole',
  'fiscalEntity',
  'invoice',
  'invoiceBlob',
  'invoiceConcept',
  'machineClient',
  'massDownloadRequest',
  'member',
  'organization',
  'satCredential',
  'satInvoice',
  'seed_dev_flags',
  'user',
  'verificationToken',
  'session'
] as any

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  await prisma.$connect()

  const snapshot: Record<string, unknown> = {
    _meta: {
      generatedAt: new Date().toISOString(),
      purpose: 'SAST-API PRE-TEST SNAPSHOT',
      restoreHint: 'Restauración manual: usar scripts/restore-db-snapshot.mts o INSERT SQL transaccional segmentado por tabla para no violar FKs. El orden sugerido es el mismo orden del JSON.'
    }
  }

  for (const table of TABLES) {
    const delegate = (prisma as any)[table]
    try {
      const count = await delegate.count()
      const rows = await delegate.findMany({ take: 30_000, orderBy: (table === 'user' || table === 'organization' || table === 'company' || table === 'member' || table === 'fiscalEntity') ? [{ createdAt: 'asc' }] : undefined })
      snapshot[String(table)] = { count, rows }
      console.log('SNAPSHOT_TABLE', String(table), 'rows=', rows.length, '/ total=', count)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('SNAPSHOT_TABLE_SKIP', String(table), msg.slice(0, 200))
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2), 'utf-8')
  const size = fs.statSync(OUT_FILE).size
  console.log('')
  console.log('=== ✅ SNAPSHOT CREADO ===')
  console.log('Ruta absoluta: ', OUT_FILE)
  console.log('Tamaño: ', (size / 1024 / 1024).toFixed(2), 'MB')
  console.log('Para restaurar: revisa scripts/restore-db-snapshot.mts (una vez creado) o corre prisma db seed transaccionalmente con los datos crudos de rows por tabla en orden User → Org → Member → FiscalEntity/Company → CompanyAccess → Invoices → MassDownloadRequest')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error('SNAPSHOT_FAIL', e); await prisma.$disconnect(); process.exit(1) })

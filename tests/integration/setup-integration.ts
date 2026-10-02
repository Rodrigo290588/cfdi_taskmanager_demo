import { PrismaClient } from '@prisma/client'
import {
  isPostgresTestAvailableSync,
  forceIntegrationDatabaseUrl,
  truncateAllIntegrationTables,
} from './helpers/prisma-test-helpers'

const GLOBAL_INIT_KEY = '__INTEGRATION_PRISMA_INIT_DONE__'
const globalAny = globalThis as any

forceIntegrationDatabaseUrl()

const INTEGRATION_DB_AVAILABLE_SYNC: boolean = (() => {
  try {
    return isPostgresTestAvailableSync('localhost', 5434, 2500)
  } catch {
    return false
  }
})()

export let integrationDbAvailable: boolean = INTEGRATION_DB_AVAILABLE_SYNC
export let integrationPrisma: PrismaClient

if (!INTEGRATION_DB_AVAILABLE_SYNC) {
  console.warn(
    '\n⚠️  [integration] postgres-test:5434 NO disponible (sonda sync falló).\n' +
      '   SKIPPEANDO TODOS los tests de integración.\n' +
      '   Para habilitar: npm run db:test:up ; sleep 3 ; npm run db:test:migrate\n'
  )
}

beforeAll(async () => {
  if (!INTEGRATION_DB_AVAILABLE_SYNC) return
  try {
    integrationPrisma = new PrismaClient({ log: ['error'] })
    await integrationPrisma.$connect()
    await truncateAllIntegrationTables(integrationPrisma)
    globalAny[GLOBAL_INIT_KEY] = true
  } catch (e) {
    console.warn('\n⚠️  [integration] Error conectando/migrando DB test:', (e as Error).message)
    integrationDbAvailable = false
    try {
      integrationPrisma && (await integrationPrisma.$disconnect())
    } catch {
      // ignore
    }
  }
}, 30000)

afterAll(async () => {
  try {
    if (integrationPrisma) {
      await truncateAllIntegrationTables(integrationPrisma)
      await integrationPrisma.$disconnect()
    }
  } catch {
    // ignore
  }
})

export function describeIfIntegrationDb(name: string, fn: () => void) {
  const wrapper = integrationDbAvailable ? describe : ((describe as any).skip as typeof describe)
  return wrapper(name, fn)
}

export function beforeEachResetDb() {
  beforeEach(async () => {
    if (!integrationDbAvailable || !integrationPrisma) return
    await truncateAllIntegrationTables(integrationPrisma)
  })
}

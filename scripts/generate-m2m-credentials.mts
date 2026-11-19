import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnvConfig(projectRoot, false)

const prisma = new PrismaClient()
const ORG_NAME = 'Grupo Demo ITComplements'
const REQUIRED_SCOPES = ['cfdi.import:create'] // Scope necesario para ingestar CFDI

function trimOuterHyphens(value: string): string {
  let start = 0
  let end = value.length

  while (value[start] === '-') {
    start++
  }

  while (end > start && value[end - 1] === '-') {
    end--
  }

  return value.slice(start, end)
}

function normalizeSlugForClientId(slug: string) {
  const normalized = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')

  return trimOuterHyphens(normalized).slice(0, 30) || 'org'
}

async function main() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'No se encontró DATABASE_URL en los archivos de configuración del proyecto. Verifica que exista .env o .env.production con la conexión de producción.'
      )
    }

    console.log('[1/3] Buscando la organización configurada...')
    const org = await prisma.organization.findFirst({
      where: { name: ORG_NAME },
      select: { id: true, name: true, slug: true }
    })

    if (!org) {
      throw new Error(
        `No se encontró la organización "${ORG_NAME}" en la base de datos indicada por DATABASE_URL. Verifica que estés usando la conexión de producción correcta.`
      )
    }

    console.log(`✓ Organización encontrada: "${org.name}" (ID: ${org.id})`)

    console.log(`[2/3] Generando credenciales criptográficas M2M seguras...`)
    const normalizedSlug = normalizeSlugForClientId(org.slug)
    const suffix = crypto.randomBytes(4).toString('hex')
    const clientId = `${normalizedSlug}-${suffix}`

    // Generar el secreto en texto plano (32 bytes) y su hash bcrypt (12 rondas)
    const clientSecret = crypto.randomBytes(32).toString('base64url')
    const clientSecretHash = await bcrypt.hash(clientSecret, 12)

    console.log(`[3/3] Registrando las credenciales en la base de datos...`)
    await prisma.machineClient.create({
      data: {
        organizationId: org.id,
        clientId: clientId,
        clientSecretHash: clientSecretHash,
        description: 'Credenciales M2M para componente Java de Ingesta CFDI',
        scopes: REQUIRED_SCOPES,
        isActive: true
      }
    })

    console.log('\n=============================================================================')
    console.log('✅ CREDENCIALES M2M GENERADAS EXITOSAMENTE')
    console.log('=============================================================================')
    console.log('\nCopia y pega las siguientes líneas en tu terminal de PowerShell en Producción:\n')

    console.log(`[Environment]::SetEnvironmentVariable("CFDI_IMPORT_CLIENT_ID", "${clientId}", "User")`)
    console.log(`[Environment]::SetEnvironmentVariable("CFDI_IMPORT_CLIENT_SECRET", "${clientSecret}", "User")`)

    console.log('\n-----------------------------------------------------------------------------')
    console.log('⚠️ PASO FINAL OBLIGATORIO:')
    console.log('Después de ejecutar los comandos de arriba, DEBES CERRAR ESTA VENTANA de PowerShell')
    console.log('y abrir una nueva. Si no lo haces, Windows no recordará las contraseñas.')
    console.log('\nRecuerda guardar el CLIENT_SECRET en un lugar seguro (ej. gestor de contraseñas).')
    console.log('La base de datos conserva un hash irreversible del secreto; no podrá recuperarse después.')
    console.log('-----------------------------------------------------------------------------\n')

  } catch (error) {
    console.error('\n❌ ERROR AL GENERAR CREDENCIALES:')
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

await main()

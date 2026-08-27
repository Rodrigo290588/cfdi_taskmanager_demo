import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(__dirname, '..')
const ENV_TEST = path.join(ROOT, '.env.test')
const ENV_LOCAL = path.join(ROOT, '.env.local')
const ENV_DEV = path.join(ROOT, '.env')

// @ts-expect-error Node types declare NODE_ENV readonly pero Jest / cross-env mutan process.env en runtime antes del módulo, así que la escritura es segura.
process.env.NODE_ENV = process.env.NODE_ENV || 'test'

const envFiles: string[] = []
if (fs.existsSync(ENV_TEST)) envFiles.push(ENV_TEST)
if (fs.existsSync(ENV_LOCAL)) envFiles.push(ENV_LOCAL)
if (fs.existsSync(ENV_DEV)) envFiles.push(ENV_DEV)

for (const f of envFiles) {
  dotenv.config({ path: f })
}

if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) {
  process.env.NEXTAUTH_SECRET = 'sast-test-secret-do-not-use-in-production-1234567890abcdef'
}
if (!process.env.NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
}
if (!process.env.PUBLIC_HOSTS_ALLOWLIST) {
  process.env.PUBLIC_HOSTS_ALLOWLIST = 'localhost:3000,127.0.0.1:3000'
}

const origErr = console.error
const origWarn = console.warn
const SILENT = process.env.TESTS_VERBOSE?.toLowerCase() !== 'true'
if (SILENT) {
  console.error = () => {}
  console.warn = () => {}
}
process.on('beforeExit', () => {
  console.error = origErr
  console.warn = origWarn
})

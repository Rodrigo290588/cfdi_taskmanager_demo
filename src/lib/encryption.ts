import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import {
  assertValidAesGcmAlgorithm,
  assertValidIvHex,
  assertValidAuthTagHex,
  assertValidEncryptionKeyLength,
  INVOICE_CIPHER_WHITELIST,
} from '@/lib/mass-downloads-route-utils'

const ALGORITHM = 'aes-256-gcm'

assertValidAesGcmAlgorithm(ALGORITHM)
void INVOICE_CIPHER_WHITELIST

function getEncryptionKey(): Buffer {
  const keyEnv = process.env.DATA_ENCRYPTION_KEY?.trim()
  const require32 = process.env.DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES === 'true'

  if (!keyEnv || keyEnv.length === 0) {
    if (process.env.NODE_ENV === 'production' || require32) {
      const msg = 'FATAL: DATA_ENCRYPTION_KEY is not defined in environment variables. Configure a 32-byte (64 hex chars) key for AES-256-GCM.'
      console.error(msg)
      throw new Error(msg)
    }
    const msg = 'DATA_ENCRYPTION_KEY not found in environment variables. Default hardcoded dev key is DISABLED for security.'
    console.error(msg)
    throw new Error(msg)
  }

  let keyBuffer: Buffer
  if (keyEnv.length === 64 && /^[0-9A-Fa-f]+$/.test(keyEnv)) {
    keyBuffer = Buffer.from(keyEnv, 'hex')
  } else {
    keyBuffer = createHash('sha256').update(keyEnv).digest()
  }

  assertValidEncryptionKeyLength(keyBuffer)
  return keyBuffer
}

export function encrypt(text: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  assertValidIvHex(iv.toString('hex'))
  assertValidAuthTagHex(authTag.toString('hex'))

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export function decrypt(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid encrypted payload: empty input')
  }
  const parts = text.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format (expected iv:authTag:encrypted)')
  }

  const ivHex = parts[0].trim()
  const authTagHex = parts[1].trim()
  const encrypted = parts[2]

  assertValidIvHex(ivHex)
  assertValidAuthTagHex(authTagHex)

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const key = getEncryptionKey()
  const decipher = createDecipheriv(ALGORITHM, key, iv)

  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

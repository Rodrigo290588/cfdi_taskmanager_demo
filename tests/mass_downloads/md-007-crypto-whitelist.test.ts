import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import {
  assertValidAesGcmAlgorithm,
  assertValidIvHex,
  assertValidAuthTagHex,
  assertValidEncryptionKeyLength,
  INVOICE_CIPHER_WHITELIST,
} from '@/lib/mass-downloads-route-utils'
import { encrypt, decrypt } from '@/lib/encryption'

describe('MD-007 · Crypto Algorithm Whitelist AES-GCM Only', () => {
  it('INVOICE_CIPHER_WHITELIST solo permite aes-256-gcm / aes-128-gcm. Case insensitive trim ok', () => {
    expect(INVOICE_CIPHER_WHITELIST.has('aes-256-gcm')).toBe(true)
    expect(INVOICE_CIPHER_WHITELIST.has('aes-128-gcm')).toBe(true)
    const validNormalized = ['AES-256-GCM', '  aes-128-gcm  ']
    for (const v of validNormalized) {
      const norm = (v || '').toString().trim().toLowerCase()
      expect(INVOICE_CIPHER_WHITELIST.has(norm)).toBe(true)
    }
    const badAlgos = [
      'aes-128-ecb',
      'aes-256-cbc',
      'aes-256-ctr',
      'des-ede3-cbc',
      'rc4',
      'aes-256-gcm-bogus',
      '',
      null as unknown as string,
    ]
    for (const a of badAlgos) {
      const norm = (a || '').toString().trim().toLowerCase()
      expect(INVOICE_CIPHER_WHITELIST.has(norm)).toBe(false)
    }
  })

  it('assertValidAesGcmAlgorithm: invalidos throw Error FAIL CLOSED sin fallback', () => {
    const invalid = ['aes-128-ecb', 'AES-256-CBC', '', 'rc4', 'aes-256-gcm-invalid']
    for (const inv of invalid) {
      expect(() => assertValidAesGcmAlgorithm(inv)).toThrow()
    }
    expect(() => assertValidAesGcmAlgorithm('AES-256-GCM')).not.toThrow()
    expect(() => assertValidAesGcmAlgorithm('  aes-128-gcm  ')).not.toThrow()
    expect(() => assertValidAesGcmAlgorithm('aes-256-gcm ')).not.toThrow()
  })

  it('assertValidIvHex: 12 o 16 bytes SOLAMENTE. IV 6 bytes (MD-PAY-051) → throw', () => {
    expect(() => assertValidIvHex('ab')).toThrow()
    expect(() => assertValidIvHex('010203040506')).toThrow()
    expect(() => assertValidIvHex('zz'.repeat(16))).toThrow()
    expect(() => assertValidIvHex('00'.repeat(12))).not.toThrow()
    expect(() => assertValidIvHex('aa'.repeat(16))).not.toThrow()
    expect(() => assertValidIvHex('')).toThrow()
  })

  it('assertValidAuthTagHex: AEAD GCM requiere authTag 12-16 bytes. 0 bytes vacio → throw (Padding Oracle prevent)', () => {
    expect(() => assertValidAuthTagHex('')).toThrow()
    expect(() => assertValidAuthTagHex('00'.repeat(10))).toThrow()
    expect(() => assertValidAuthTagHex('00'.repeat(12))).not.toThrow()
    expect(() => assertValidAuthTagHex('00'.repeat(16))).not.toThrow()
    expect(() => assertValidAuthTagHex('00'.repeat(20))).toThrow()
  })

  it('assertValidEncryptionKeyLength: 16 o 32 bytes. Key 123 passphrase 16B sin 32B require → throw si env flag true', () => {
    const short16 = Buffer.alloc(16)
    const full32 = Buffer.alloc(32)
    const prevFlag = process.env.DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES
    try {
      Reflect.deleteProperty(process.env, 'DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES')
      expect(() => assertValidEncryptionKeyLength(short16)).not.toThrow()
      expect(() => assertValidEncryptionKeyLength(full32)).not.toThrow()
      expect(() => assertValidEncryptionKeyLength(Buffer.alloc(8))).toThrow()
      process.env.DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES = 'true'
      expect(() => assertValidEncryptionKeyLength(short16)).toThrow(/32 byte/)
      expect(() => assertValidEncryptionKeyLength(full32)).not.toThrow()
    } finally {
      if (prevFlag === undefined) {
        Reflect.deleteProperty(process.env, 'DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES')
      } else {
        process.env.DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES = prevFlag
      }
    }
  })
})

describe('MD-007 · encryption.ts FAIL CLOSED (NO fallback insecure dev key)', () => {
  const OLD_ENV_KEY = process.env.DATA_ENCRYPTION_KEY
  const OLD_NODE_ENV = process.env.NODE_ENV

  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'DATA_ENCRYPTION_KEY')
  })

  afterEach(() => {
    if (OLD_ENV_KEY !== undefined) Reflect.set(process.env, 'DATA_ENCRYPTION_KEY', OLD_ENV_KEY)
    Reflect.set(process.env, 'NODE_ENV', OLD_NODE_ENV)
  })

  it('DATA_ENCRYPTION_KEY missing + NODE_ENV=production → THROW Error inmediato. NO hardcoded "dev-insecure-key-do-not-use-in-prod"', () => {
    Reflect.set(process.env, 'NODE_ENV', 'production')
    expect(() => encrypt('test data')).toThrow(/DATA_ENCRYPTION_KEY is not defined/)
  })

  it('DATA_ENCRYPTION_KEY missing + require32=true → THROW incluso si NODE_ENV!=prod (ambos gates fail closed)', () => {
    Reflect.set(process.env, 'NODE_ENV', 'test')
    Reflect.set(process.env, 'DATA_ENCRYPTION_KEY_REQUIRE_32_BYTES', 'true')
    expect(() => encrypt('hola')).toThrow(/FATAL|not defined/)
  })

  it('Key 64 hex chars válida → encrypt y decrypt roundtrip exitoso + authTag incluido', () => {
    Reflect.set(process.env, 'DATA_ENCRYPTION_KEY', 'a'.repeat(64))
    Reflect.set(process.env, 'NODE_ENV', 'test')
    const payload = JSON.stringify({ rfc: 'ODE8604257UA', fiel: 'secret-data', uuid: 'uuid-test' })
    const blob = encrypt(payload)
    expect(blob.split(':').length).toBe(3)
    const [iv, authTag, enc] = blob.split(':')
    expect(iv.length).toBeGreaterThanOrEqual(24)
    expect(authTag.length).toBeGreaterThanOrEqual(24)
    expect(enc.length).toBeGreaterThan(10)
    const dec = decrypt(blob)
    expect(dec).toBe(payload)
  })

  it('decrypt con authTag byte flip → throw AuthIntegrity (AEAD auth correcto)', () => {
    Reflect.set(process.env, 'DATA_ENCRYPTION_KEY', 'a'.repeat(64))
    Reflect.set(process.env, 'NODE_ENV', 'test')
    const blob = encrypt('mensaje prueba integridad')
    const [iv, tag, enc] = blob.split(':')
    const flipTag = '0' + tag.slice(1)
    expect(() => decrypt(`${iv}:${flipTag}:${enc}`)).toThrow()
  })
})

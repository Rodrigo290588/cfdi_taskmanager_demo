import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import {
  deleteFiscalExport,
  readDecryptedFiscalExport,
  writeEncryptedFiscalExport,
} from '@/lib/fiscal-control-export-storage'

const originalDirectory = process.env.FISCAL_CONTROL_EXPORTS_DIR
const originalKey = process.env.FISCAL_CONTROL_EXPORTS_KEY
let exportsDirectory = ''

beforeEach(async () => {
  exportsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fiscal-control-export-'))
  process.env.FISCAL_CONTROL_EXPORTS_DIR = exportsDirectory
  process.env.FISCAL_CONTROL_EXPORTS_KEY = crypto.randomBytes(32).toString('base64')
})

afterEach(async () => {
  await fs.rm(exportsDirectory, { recursive: true, force: true })
  process.env.FISCAL_CONTROL_EXPORTS_DIR = originalDirectory
  process.env.FISCAL_CONTROL_EXPORTS_KEY = originalKey
})

describe('fiscal control export storage', () => {
  it('encrypts CSV content at rest and decrypts it only for the authorized download flow', async () => {
    const plainCsv = 'UUID,RFC\nsecret-uuid,DMC750410C41\n'
    async function* content(): AsyncIterable<string> {
      yield plainCsv
    }
    const artifact = await writeEncryptedFiscalExport('export_123', content())

    expect(await fs.readFile(artifact.filePath, 'utf8')).not.toContain('DMC750410C41')
    await expect(readDecryptedFiscalExport('export_123')).resolves.toEqual(
      Buffer.from(plainCsv, 'utf8'),
    )

    await deleteFiscalExport('export_123')
    await expect(fs.access(artifact.filePath)).rejects.toThrow()
  })

  it('rejects export identifiers that could escape the protected directory', async () => {
    await expect(readDecryptedFiscalExport('../outside')).rejects.toThrow(
      'Invalid fiscal export job id',
    )
  })
})

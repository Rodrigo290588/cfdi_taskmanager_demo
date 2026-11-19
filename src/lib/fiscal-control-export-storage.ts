import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000

export type FiscalControlExportArtifact = Readonly<{
  filePath: string
  metadataPath: string
  expiresAt: Date
}>

function resolveExportsRoot(): string {
  const configured = process.env.FISCAL_CONTROL_EXPORTS_DIR?.trim()
  if (!configured) {
    throw new Error('FISCAL_CONTROL_EXPORTS_DIR is required for asynchronous fiscal exports')
  }

  return path.resolve(/* turbopackIgnore: true */ configured)
}

function resolveEncryptionKey(): Buffer {
  const raw = process.env.FISCAL_CONTROL_EXPORTS_KEY?.trim()
  if (!raw) {
    throw new Error('FISCAL_CONTROL_EXPORTS_KEY is required for asynchronous fiscal exports')
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('FISCAL_CONTROL_EXPORTS_KEY must be a base64-encoded 32-byte key')
  }

  return key
}

function getArtifactPaths(jobId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) {
    throw new Error('Invalid fiscal export job id')
  }

  const root = resolveExportsRoot()
  return {
    root,
    filePath: path.join(root, `${jobId}.csv.enc`),
    metadataPath: path.join(root, `${jobId}.metadata.json`),
  }
}

export async function writeEncryptedFiscalExport(
  jobId: string,
  content: AsyncIterable<string>,
): Promise<FiscalControlExportArtifact> {
  const { root, filePath, metadataPath } = getArtifactPaths(jobId)
  await fs.mkdir(root, { recursive: true })

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', resolveEncryptionKey(), iv)
  const handle = await fs.open(filePath, 'w', 0o600)

  try {
    for await (const chunk of content) {
      await handle.write(cipher.update(chunk, 'utf8'))
    }
    await handle.write(cipher.final())
    const expiresAt = new Date(Date.now() + EXPORT_TTL_MS)
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        expiresAt: expiresAt.toISOString(),
      }),
      { encoding: 'utf8', mode: 0o600 },
    )
    return { filePath, metadataPath, expiresAt }
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => undefined)
    await fs.rm(metadataPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
}

export async function readDecryptedFiscalExport(jobId: string): Promise<Buffer> {
  const { filePath, metadataPath } = getArtifactPaths(jobId)
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as {
    iv?: string
    authTag?: string
    expiresAt?: string
  }
  if (!metadata.expiresAt || new Date(metadata.expiresAt).getTime() <= Date.now()) {
    await deleteFiscalExport(jobId)
    throw new Error('Fiscal export has expired')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    resolveEncryptionKey(),
    Buffer.from(metadata.iv ?? '', 'base64'),
  )
  decipher.setAuthTag(Buffer.from(metadata.authTag ?? '', 'base64'))
  return Buffer.concat([decipher.update(await fs.readFile(filePath)), decipher.final()])
}

export async function deleteFiscalExport(jobId: string): Promise<void> {
  const { filePath, metadataPath } = getArtifactPaths(jobId)
  await Promise.all([
    fs.rm(filePath, { force: true }),
    fs.rm(metadataPath, { force: true }),
  ])
}
